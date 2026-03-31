"""Full video renderer: composites captions, graphics, and SFX onto the cut video.

Builds a single FFmpeg command with filter_complex that:
  1. Cuts silences (select/aselect)
  2. Draws captions via drawtext (word-chunked by maxWords)
  3. Overlays graphic images at matched timestamps
  4. Mixes SFX audio at per-event timestamps (remapped to output timeline)
"""

from __future__ import annotations

import atexit
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from collections import defaultdict
from typing import Any, Callable

from engine.result import EngineResult
from engine.face_zoom import (
    build_zoom_active_expression,
    compute_zoom_windows_output,
    graphic_overlay_intervals_output,
    sample_face_center_normalized,
)

_FFMPEG_CHILDREN: list[subprocess.Popen] = []
_FFMPEG_CHILDREN_LOCK = threading.Lock()


def _register_ffmpeg_proc(proc: subprocess.Popen) -> None:
    with _FFMPEG_CHILDREN_LOCK:
        _FFMPEG_CHILDREN.append(proc)


def _unregister_ffmpeg_proc(proc: subprocess.Popen) -> None:
    with _FFMPEG_CHILDREN_LOCK:
        try:
            _FFMPEG_CHILDREN.remove(proc)
        except ValueError:
            pass


def _terminate_all_ffmpeg_children() -> None:
    with _FFMPEG_CHILDREN_LOCK:
        procs = list(_FFMPEG_CHILDREN)
    for p in procs:
        if p.poll() is None:
            try:
                p.terminate()
            except (OSError, ProcessLookupError):
                pass
            try:
                p.wait(timeout=4)
            except (subprocess.TimeoutExpired, OSError):
                try:
                    p.kill()
                except (OSError, ProcessLookupError):
                    pass
    with _FFMPEG_CHILDREN_LOCK:
        _FFMPEG_CHILDREN.clear()


atexit.register(_terminate_all_ffmpeg_children)

# EXIF orientation (JPEG/HEIC-style); 1 = no rotation.
_EXIF_ORIENTATION = 274


def _graphic_needs_exif_transpose(path: str) -> bool:
    try:
        from PIL import Image
    except ImportError:
        return False
    try:
        with Image.open(path) as im:
            exif = im.getexif()
            o = exif.get(_EXIF_ORIENTATION)
            return o is not None and o != 1
    except Exception:
        return False


def _prepare_graphic_path_for_ffmpeg(path: str) -> tuple[str, bool]:
    """Apply EXIF orientation so pixel dimensions match how the image is meant to be seen.

    Phone portraits are often stored landscape with Orientation≠1; FFmpeg decodes raw pixels,
    so scale2ref used wrong iw/ih → wide flat overlay that looks 16:9-ish and too small vertically.
    Returns (path_to_use, is_temp_file_to_delete).
    """
    if not _graphic_needs_exif_transpose(path):
        return path, False
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return path, False

    fd, tmp = tempfile.mkstemp(suffix=".png", prefix="splitty_gr_")
    os.close(fd)
    try:
        with Image.open(path) as im:
            out = ImageOps.exif_transpose(im)
            out = out.convert("RGBA")
            out.save(tmp, format="PNG", compress_level=3)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        return path, False
    return tmp, True


def _ffprobe_stream_dimensions(path: str) -> tuple[int, int]:
    """First stream with width/height (video or attached image)."""
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(result.stderr or "ffprobe failed")
    data = json.loads(result.stdout)
    for s in data.get("streams", []):
        w = s.get("width")
        h = s.get("height")
        if w and h:
            return int(w), int(h)
    raise RuntimeError("No dimensions in ffprobe output")


def _graphic_display_dimensions(path: str) -> tuple[int, int]:
    """Width × height as viewers see the file (EXIF orientation applied when Pillow is available)."""
    try:
        from PIL import Image, ImageOps

        with Image.open(path) as im:
            out = ImageOps.exif_transpose(im)
            w, h = out.size
            if w > 0 and h > 0:
                return w, h
    except Exception:
        pass
    return _ffprobe_stream_dimensions(path)


def _video_frame_dimensions(path: str) -> tuple[int, int]:
    """Coded frame size of the first video stream (matches overlay W/H on [vbase])."""
    return _ffprobe_stream_dimensions(path)


def _video_avg_fps(path: str) -> float:
    """Average frame rate of first video stream (fallback 30)."""
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=avg_frame_rate",
        "-of",
        "csv=p=0",
        path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0 or not result.stdout.strip():
            return 30.0
        raw = result.stdout.strip().split("\n")[0].strip()
        if "/" in raw:
            num, den = raw.split("/", 1)
            d = float(den)
            if d <= 0:
                return 30.0
            return max(1.0, min(120.0, float(num) / d))
        return max(1.0, min(120.0, float(raw)))
    except (ValueError, subprocess.SubprocessError, OSError):
        return 30.0


def _stderr_time_sec(line: str) -> float | None:
    """Parse FFmpeg progress stderr into output timeline seconds (best effort)."""
    m = re.search(r"out_time_ms=(\d+)", line)
    if m:
        return int(m.group(1)) / 1000.0
    m = re.search(r"out_time_us=(\d+)", line)
    if m:
        return int(m.group(1)) / 1_000_000.0
    # Prefer HH:MM:SS before bare out_time= digits — out_time=00:00:05 must not parse as 0 us.
    m = re.search(r"time=(\d+):(\d+):(\d+\.?\d*)", line)
    if m:
        h, mm, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
        return h * 3600 + mm * 60 + s
    # Integer microseconds only (5+ digits) — avoids matching out_time=00 from timestamps with colons.
    m = re.search(r"out_time=(\d{5,})\b", line)
    if m:
        return int(m.group(1)) / 1_000_000.0
    return None


def _ffmpeg_stderr_marks_mux_done(line: str) -> bool:
    """True when FFmpeg has finished the encode/mux pass (before process exit)."""
    lo = line.lower()
    if "muxing overhead" in lo:
        return True
    if "lsize=" in lo:
        return True
    return False


def _overlay_dims_uniform(
    frame_w: int,
    frame_h: int,
    img_w: int,
    img_h: int,
    width_frac: float,
) -> tuple[int, int]:
    """Scale image uniformly: target width = frame_w * width_frac unless height would exceed frame_h."""
    if img_w <= 0 or img_h <= 0 or frame_w <= 0 or frame_h <= 0:
        return 2, 2
    wf = max(0.05, min(float(width_frac), 1.0))
    max_w = frame_w * wf
    h_at_max_w = max_w * img_h / img_w
    if h_at_max_w <= frame_h:
        ow = int(round(max_w))
        oh = int(round(max_w * img_h / img_w))
    else:
        oh = int(round(frame_h))
        ow = int(round(frame_h * img_w / img_h))
    ow = max(2, ow - ow % 2)
    oh = max(2, oh - oh % 2)
    return ow, oh


def chunk_words(words: list[dict[str, Any]], max_words: int) -> list[dict[str, Any]]:
    """Group word-level timestamps into display chunks of at most max_words."""
    if not words:
        return []

    chunks: list[dict[str, Any]] = []
    for i in range(0, len(words), max_words):
        group = words[i : i + max_words]
        text = "".join(w.get("word", "") for w in group).strip()
        if not text:
            continue
        chunks.append({
            "text": text,
            "start": group[0]["start"],
            "end": group[-1]["end"],
        })
    return chunks


def build_caption_chunks(
    segments: list[dict[str, Any]],
    max_words: int = 3,
) -> list[dict[str, Any]]:
    """Build display-ready caption chunks from transcript segments."""
    all_chunks: list[dict[str, Any]] = []
    for seg in segments:
        words = seg.get("words", [])
        if words:
            all_chunks.extend(chunk_words(words, max_words))
        elif seg.get("text"):
            all_chunks.append({
                "text": seg["text"],
                "start": seg["start"],
                "end": seg["end"],
            })
    return all_chunks


def source_time_to_output(t: float, keep_segments: list[dict[str, float]]) -> float:
    """Map a timestamp on the source (uncut) timeline to the cut output timeline."""
    out = 0.0
    ordered = sorted(keep_segments, key=lambda s: s["start"])
    for seg in ordered:
        ks = float(seg["start"])
        ke = float(seg["end"])
        if t <= ks:
            return out
        if t < ke:
            return out + (t - ks)
        out += ke - ks
    return out


def remap_interval(
    start: float,
    end: float,
    keep_segments: list[dict[str, float]],
) -> tuple[float, float] | None:
    """Remap [start, end] from source to output; drop if collapsed or invalid."""
    t0 = source_time_to_output(start, keep_segments)
    t1 = source_time_to_output(end, keep_segments)
    if t1 <= t0:
        return None
    return (t0, t1)


def remap_caption_chunks(
    chunks: list[dict[str, Any]],
    keep_segments: list[dict[str, float]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for c in chunks:
        r = remap_interval(float(c["start"]), float(c["end"]), keep_segments)
        if not r:
            continue
        out.append({"text": c["text"], "start": r[0], "end": r[1]})
    return out


def _resolve_drawtext_fontfile(bold: bool = False) -> str | None:
    """Path to a system font for drawtext. Avoids fontconfig (often broken on Windows FFmpeg)."""
    override = os.environ.get("SPLITTY_FFMPEG_FONT", "").strip()
    if override and os.path.isfile(override):
        return override

    candidates: list[str] = []
    if os.name == "nt":
        windir = os.environ.get("WINDIR", r"C:\Windows")
        fonts_dir = os.path.join(windir, "Fonts")
        if bold:
            for fname in (
                "segoeuib.ttf",
                "arialbd.ttf",
                "segoeui.ttf",
                "arial.ttf",
                "calibri.ttf",
            ):
                candidates.append(os.path.join(fonts_dir, fname))
        else:
            for fname in (
                "segoeui.ttf",
                "arial.ttf",
                "calibri.ttf",
                "consola.ttf",
            ):
                candidates.append(os.path.join(fonts_dir, fname))
    elif sys.platform == "darwin":
        candidates.extend(
            [
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/Library/Fonts/Arial.ttf",
            ]
        )
    else:
        candidates.extend(
            [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/TTF/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            ]
        )

    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def _render_font_cwd_and_drawtext_prefix(path: str) -> tuple[str, str]:
    """Use font basename + cwd=font dir so filter options are not split on 'C:'."""
    abspath = os.path.abspath(path)
    font_dir = os.path.dirname(abspath)
    base = os.path.basename(abspath)
    if " " in base or ":" in base or "'" in base:
        safe = base.replace("'", r"'\''")
        prefix = f"fontfile='{safe}':"
    else:
        prefix = f"fontfile={base}:"
    return font_dir, prefix


def _drawtext_fontfile_prefix(bold: bool = False) -> tuple[str | None, str]:
    """(cwd for subprocess or None, optional `fontfile=...:` prefix for each drawtext)."""
    path = _resolve_drawtext_fontfile(bold=bold)
    if not path:
        return None, ""
    font_dir, prefix = _render_font_cwd_and_drawtext_prefix(path)
    return font_dir, prefix


def _escape_drawtext(text: str) -> str:
    """Escape special characters for FFmpeg drawtext filter."""
    text = text.replace("\\", "\\\\\\\\")
    text = text.replace("'", "\u2019")
    text = text.replace(":", "\\:")
    text = text.replace("%", "%%")
    text = text.replace("[", "\\[")
    text = text.replace("]", "\\]")
    text = text.replace(";", "\\;")
    return text


def _hex_to_fontcolor(value: str) -> str:
    h = value.strip().lstrip("#")
    if len(h) == 6 and all(c in "0123456789abcdefABCDEF" for c in h):
        return f"0x{h}"
    return "white"


_ASPECT_TARGET_WH: dict[str, tuple[int, int]] = {
    "16:9": (16, 9),
    "9:16": (9, 16),
    "1:1": (1, 1),
    "4:5": (4, 5),
}


def _center_crop_filter(iw: int, ih: int, aspect_key: str) -> str | None:
    """FFmpeg crop=w:h:x:y for center crop to target aspect; None if original or invalid."""
    key = str(aspect_key or "").strip().lower()
    if key in ("", "original"):
        return None
    tw_th = _ASPECT_TARGET_WH.get(key)
    if not tw_th:
        return None
    tw, th = tw_th
    ar_out = tw / th
    ar_in = iw / ih
    if ar_in > ar_out:
        h = ih - (ih % 2)
        w = int(round(h * ar_out))
        w -= w % 2
        w = min(max(w, 2), iw - (iw % 2))
        h = min(h, ih - (ih % 2))
        x = max(0, (iw - w) // 2)
        y = max(0, (ih - h) // 2)
    else:
        w = iw - (iw % 2)
        h = int(round(w / ar_out))
        h -= h % 2
        h = min(max(h, 2), ih - (ih % 2))
        w = min(w, iw - (iw % 2))
        x = max(0, (iw - w) // 2)
        y = max(0, (ih - h) // 2)
    return f"crop={w}:{h}:{x}:{y}"


def _atempo_segments(speed: float) -> list[str]:
    """FFmpeg atempo values; each in (0.5, 2.0] except last."""
    speed = max(0.25, min(4.0, float(speed)))
    if abs(speed - 1.0) < 1e-6:
        return []
    parts: list[str] = []
    rem = speed
    while rem > 2.0 + 1e-9:
        parts.append("atempo=2.0")
        rem /= 2.0
    while rem < 0.5 - 1e-9:
        parts.append("atempo=0.5")
        rem /= 0.5
    parts.append(f"atempo={rem:.6f}")
    return parts


def _chain_audio_atempo(from_label: str, speed: float, out_label: str) -> str:
    """e.g. from_label=a0 -> [a0]atempo...[out_label]. Empty if speed ~= 1."""
    segs = _atempo_segments(speed)
    if not segs:
        return ""
    cur = from_label
    chunks: list[str] = []
    for i, seg in enumerate(segs):
        nxt = out_label if i == len(segs) - 1 else f"atmp{i}"
        chunks.append(f"[{cur}]{seg}[{nxt}]")
        cur = nxt
    return ";".join(chunks)


def _caption_alpha_expr(start: float, end: float, fade_in: float, fade_out: float) -> str:
    s, e = start, end
    if fade_in <= 0.001 and fade_out <= 0.001:
        return "1"
    core = "1"
    if fade_out > 0.001:
        fo = fade_out
        core = f"if(gt(t\\,{e - fo:.3f})\\,({e:.3f}-t)/{fo:.3f}\\,{core})"
    if fade_in > 0.001:
        fi = fade_in
        core = f"if(lt(t\\,{s + fi:.3f})\\,(t-{s:.3f})/{fi:.3f}\\,{core})"
    return core


def _caption_y_expr(position: str, margin: int) -> str:
    if position == "center":
        return "(h-text_h)/2"
    return f"h-th-{margin}"


def _graphic_overlay_expressions(
    position: str,
    g_start: float,
    g_end: float,
    motion: str,
    anim_in_sec: float,
    margin: int = 24,
) -> tuple[str, str]:
    m = margin
    presets: dict[str, tuple[str, str]] = {
        "center": ("(W-w)/2", "(H-h)/2"),
        "top": ("(W-w)/2", str(m)),
        "bottom": ("(W-w)/2", f"H-h-{m}"),
        "top_right": (f"W-w-{m}", str(m)),
        "top_left": (str(m), str(m)),
        "bottom_right": (f"W-w-{m}", f"H-h-{m}"),
        "bottom_left": (str(m), f"H-h-{m}"),
    }
    xb, yb = presets.get(position, presets["center"])
    gs, ge = g_start, g_end
    dur = max(0.01, ge - gs)
    ai = min(max(0.0, anim_in_sec), dur * 0.49)
    if motion == "slide_in" and ai > 0.001:
        xv = (
            f"if(between(t\\,{gs:.3f}\\,{gs + ai:.3f})\\,"
            f"W+((W-w)/2-W)*((t-{gs:.3f})/{ai:.3f})\\,{xb})"
        )
        return xv, yb
    return xb, yb


def _output_duration_sec(keep_segments: list[dict[str, float]]) -> float:
    return sum(float(s["end"]) - float(s["start"]) for s in keep_segments)


def _face_zoom_zoompan_filter(
    frame_w: int,
    frame_h: int,
    fps: float,
    cx: float,
    cy: float,
    zf: float,
    active_expr: str,
) -> str:
    """Time-varying zoom using zoompan (per-frame `in_time`; crop was unreliable)."""
    w = max(2, frame_w - frame_w % 2)
    h = max(2, frame_h - frame_h % 2)
    fp = max(1.0, min(fps, 120.0))
    z_e = f"if({active_expr}\\,{zf:.6f}\\,1)"
    x_e = f"if(eq(zoom\\,1)\\,0\\,max(0\\,min(iw*{cx:.6f}-iw/zoom/2\\,iw-iw/zoom)))"
    y_e = f"if(eq(zoom\\,1)\\,0\\,max(0\\,min(ih*{cy:.6f}-ih/zoom/2\\,ih-ih/zoom)))"
    return f"zoompan=z='{z_e}':x='{x_e}':y='{y_e}':d=1:s={w}x{h}:fps={fp:.4f}"


def _graphic_fade_filters(gs: float, ge: float, fade_in: float, fade_out: float) -> str:
    """setpts + rgba fades aligned to main timeline (seconds on output)."""
    parts = [f"setpts=PTS+{gs:.6f}/TB", "format=rgba"]
    if fade_in > 0.001:
        parts.append(f"fade=t=in:st={gs:.3f}:d={fade_in:.3f}:alpha=1")
    if fade_out > 0.001 and ge - fade_out > gs + 0.02:
        parts.append(f"fade=t=out:st={ge - fade_out:.3f}:d={fade_out:.3f}:alpha=1")
    return ",".join(parts)


def _sfx_assignments_from_pool(sfx_pool: dict[str, str]) -> list[tuple[str, str, float]]:
    out: list[tuple[str, str, float]] = []
    for tr, fp in sfx_pool.items():
        if fp and os.path.isfile(fp):
            out.append((str(tr), fp, 1.0))
    return out


def _parse_sfx_assignments(raw: list[dict[str, Any]] | None) -> list[tuple[str, str, float]]:
    if not raw:
        return []
    out: list[tuple[str, str, float]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        tr = str(item.get("trigger", "") or "")
        fp = str(item.get("filePath", "") or "")
        try:
            vol = float(item.get("volume", 1.0))
        except (TypeError, ValueError):
            vol = 1.0
        vol = max(0.0, min(vol, 2.0))
        if tr and fp and os.path.isfile(fp):
            out.append((tr, fp, vol))
    return out


def collect_sfx_plays(
    events: list[dict[str, Any]],
    sfx_pool: dict[str, str],
    sfx_assignments_raw: list[dict[str, Any]] | None,
    keep_segments: list[dict[str, float]],
    caption_every_n: int = 1,
    graphic_every_n: int = 1,
) -> list[tuple[str, int, float]]:
    """Build (audio_path, delay_ms, volume_linear) for each sfx event on the output timeline."""
    assignments = _parse_sfx_assignments(sfx_assignments_raw)
    if not assignments:
        assignments = _sfx_assignments_from_pool(sfx_pool)

    by_trigger: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for tr, fp, vol in assignments:
        by_trigger[tr].append((fp, vol))

    trigger_order: dict[str, int] = defaultdict(int)
    event_index: dict[str, int] = defaultdict(int)
    plays: list[tuple[str, int, float]] = []

    for e in events:
        if e.get("type") != "sfx":
            continue
        tr = str(e.get("trigger", "") or "")
        if not tr or tr not in by_trigger:
            continue

        event_index[tr] += 1
        n = event_index[tr]
        if tr == "caption_entry" and caption_every_n <= 0:
            continue
        if tr == "graphic_entry" and graphic_every_n <= 0:
            continue
        if tr == "caption_entry" and caption_every_n > 1:
            if (n % caption_every_n) != 0:
                continue
        if tr == "graphic_entry" and graphic_every_n > 1:
            if (n % graphic_every_n) != 0:
                continue

        opts = by_trigger[tr]
        pick = trigger_order[tr] % len(opts)
        trigger_order[tr] += 1
        path, vol = opts[pick]

        t_src = float(e.get("start", 0.0))
        t_out = source_time_to_output(t_src, keep_segments)
        delay_ms = max(0, int(round(t_out * 1000)))
        plays.append((path, delay_ms, vol))

    return plays


def _build_sfx_audio_filters(
    main_label: str,
    input_index_start: int,
    plays: list[tuple[str, int, float]],
) -> tuple[list[str], list[str], int]:
    """Extra argv (-i ...) pieces, filter_complex audio segments, next input index."""
    if not plays:
        return [], [f"[{main_label}]anull[outa]"], input_index_start

    grouped: dict[tuple[str, str], list[int]] = defaultdict(list)
    for path, delay_ms, vol in plays:
        key = (path, f"{vol:.5f}")
        grouped[key].append(delay_ms)

    extra_argv: list[str] = []
    parts: list[str] = []
    idx = input_index_start
    sfx_labels: list[str] = []

    for (path, vol_s), delays in sorted(grouped.items(), key=lambda x: x[0][0]):
        vol = float(vol_s)
        delays_sorted = sorted(delays)
        extra_argv.extend(["-i", path])
        n = len(delays_sorted)
        vol_part = f"volume={vol:.5f}," if abs(vol - 1.0) > 1e-6 else ""
        if n == 1:
            d = delays_sorted[0]
            lab = f"sfx{idx}"
            parts.append(f"[{idx}:a]{vol_part}adelay={d}|{d},apad=whole_dur=0[{lab}]")
            sfx_labels.append(f"[{lab}]")
        else:
            split_outs = "".join(f"[sp{idx}_{j}]" for j in range(n))
            parts.append(f"[{idx}:a]{vol_part}asplit={n}{split_outs}")
            for j, d in enumerate(delays_sorted):
                lab = f"sfx{idx}_{j}"
                parts.append(f"[sp{idx}_{j}]adelay={d}|{d},apad=whole_dur=0[{lab}]")
                sfx_labels.append(f"[{lab}]")
        idx += 1

    mix_inputs = 1 + len(sfx_labels)
    mix = f"[{main_label}]" + "".join(sfx_labels) + (
        f"amix=inputs={mix_inputs}:duration=first:dropout_transition=0:normalize=0[outa]"
    )
    parts.append(mix)
    return extra_argv, parts, idx


def _write_temp_filter_complex_script(graph: str) -> str:
    """Write filter graph to a temp file for -filter_complex_script.

    Windows CreateProcess limits the full command line (~8191 chars). Long caption
    chains blow past that even when output paths are short; the script avoids it.
    """
    fd, path = tempfile.mkstemp(prefix="splitty_ff_", suffix=".txt")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(graph)
    except BaseException:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise
    return path


def _execute_ffmpeg(
    cmd: list[str],
    *,
    cwd: str | None,
    timeout: int,
    duration_out_sec: float,
    progress_cb: Callable[[int], None] | None,
) -> None:
    """Run FFmpeg; optional stderr time parse → progress_cb(0..100)."""
    if not progress_cb or duration_out_sec <= 0.001:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
        )
        if result.returncode != 0:
            tail = result.stderr[-800:] if result.stderr else ""
            raise RuntimeError(f"FFmpeg exited with code {result.returncode}. {tail}")
        return

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        cwd=cwd,
        bufsize=1,
    )
    _register_ffmpeg_proc(proc)
    stderr_chunks: list[str] = []
    last_emitted = -1

    def drain_stderr() -> None:
        nonlocal last_emitted
        if not proc.stderr:
            return
        for line in iter(proc.stderr.readline, ""):
            stderr_chunks.append(line)
            if _ffmpeg_stderr_marks_mux_done(line):
                if last_emitted < 100:
                    last_emitted = 100
                    progress_cb(100)
            tsec = _stderr_time_sec(line)
            if tsec is None:
                continue
            pct = int(min(99, max(0, 100.0 * tsec / duration_out_sec)))
            if pct > last_emitted:
                last_emitted = pct
                progress_cb(pct)

    reader = threading.Thread(target=drain_stderr, daemon=True)
    reader.start()
    wait_timeout: subprocess.TimeoutExpired | None = None
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired as e:
        wait_timeout = e
    finally:
        _unregister_ffmpeg_proc(proc)
        if proc.poll() is None:
            try:
                proc.terminate()
            except (OSError, ProcessLookupError):
                pass
            try:
                proc.wait(timeout=3)
            except (subprocess.TimeoutExpired, OSError):
                try:
                    proc.kill()
                except (OSError, ProcessLookupError):
                    pass
    reader.join(timeout=5)
    stderr = "".join(stderr_chunks)
    if wait_timeout is not None:
        raise RuntimeError(f"FFmpeg timed out after {timeout}s") from wait_timeout
    if proc.returncode != 0:
        tail = stderr[-800:] if stderr else ""
        raise RuntimeError(f"FFmpeg exited with code {proc.returncode}. {tail}")
    if progress_cb is not None:
        progress_cb(100)


def render_full(
    video_path: str,
    output_path: str,
    segments: list[dict[str, Any]],
    matches: list[dict[str, Any]],
    sfx_pool: dict[str, str],
    keep_segments: list[dict[str, float]],
    events: list[dict[str, Any]],
    max_words: int = 3,
    graphic_display_sec: float = 2.0,
    graphic_width_frac: float = 0.85,
    caption_font_size: int = 24,
    caption_font_color_hex: str = "FFFFFF",
    caption_outline_color_hex: str = "000000",
    caption_position: str = "bottom",
    caption_bold: bool = False,
    caption_box: bool = False,
    caption_border_width: int = 2,
    caption_fade_in_sec: float = 0.0,
    caption_fade_out_sec: float = 0.0,
    graphic_position: str = "center",
    graphic_motion: str = "none",
    graphic_anim_in_sec: float = 0.25,
    sfx_assignments: list[dict[str, Any]] | None = None,
    sfx_caption_every_n: int = 1,
    sfx_graphic_every_n: int = 1,
    graphic_fade_in_sec: float = 0.0,
    graphic_fade_out_sec: float = 0.0,
    face_zoom_enabled: bool = False,
    face_zoom_interval_sec: float = 3.0,
    face_zoom_pulse_sec: float = 0.35,
    face_zoom_strength: float = 0.12,
    output_aspect_ratio: str = "original",
    video_speed: float = 1.0,
    progress_callback: Callable[[int], None] | None = None,
    preview_max_width: int | None = None,
    preview_crf: int = 28,
    preview_max_fps: int | None = None,
) -> EngineResult:
    """Render the final video with captions, graphics, and SFX overlaid."""
    if not video_path or not os.path.isfile(video_path):
        return EngineResult(ok=False, error="Valid video_path required")
    if not output_path:
        return EngineResult(ok=False, error="output_path is required")

    caption_chunks = build_caption_chunks(segments, max_words)
    caption_chunks = remap_caption_chunks(caption_chunks, keep_segments)

    gm_default = str(graphic_motion or "none").strip().lower()
    if gm_default not in ("slide_in", "none"):
        gm_default = "none"

    graphic_inputs: list[dict[str, Any]] = []
    cap_sec = max(0.2, min(float(graphic_display_sec), 60.0))
    for m in matches:
        fp = m.get("graphic", "")
        if fp and os.path.isfile(fp) and m.get("similarity", 0) >= 0.1:
            g_start = float(m["matched_segment_start"])
            g_end_src = float(m.get("matched_segment_end", g_start + 3.0))
            span = min(max(0.0, g_end_src - g_start), cap_sec)
            g_end = g_start + span
            r0 = remap_interval(g_start, g_end, keep_segments)
            if r0:
                graphic_inputs.append({
                    "filePath": fp,
                    "start": r0[0],
                    "end": r0[1],
                    "motion": gm_default,
                    "anim_in_sec": float(graphic_anim_in_sec),
                })

    sfx_plays = collect_sfx_plays(
        events,
        sfx_pool if isinstance(sfx_pool, dict) else {},
        sfx_assignments,
        keep_segments,
        caption_every_n=max(1, int(sfx_caption_every_n)),
        graphic_every_n=max(1, int(sfx_graphic_every_n)),
    )

    cx, cy = 0.5, 0.5
    zoom_expr = ""
    zf = 1.0 + max(0.0, min(float(face_zoom_strength), 0.45))
    zoom_window_count = 0
    if face_zoom_enabled:
        fc = sample_face_center_normalized(video_path)
        if fc:
            cx, cy = fc
        out_dur = _output_duration_sec(keep_segments)
        giv = graphic_overlay_intervals_output(matches, keep_segments, graphic_display_sec)
        zoom_windows = compute_zoom_windows_output(
            out_dur,
            max(0.5, float(face_zoom_interval_sec)),
            max(0.05, min(float(face_zoom_pulse_sec), 2.0)),
            giv,
        )
        zoom_window_count = len(zoom_windows)
        zoom_expr = build_zoom_active_expression(zoom_windows, time_var="in_time")

    prepared_graphics: list[dict[str, Any]] = []
    temp_graphic_paths: list[str] = []
    for item in graphic_inputs:
        use_path, is_temp = _prepare_graphic_path_for_ffmpeg(item["filePath"])
        prepared_graphics.append({**item, "filePath": use_path})
        if is_temp:
            temp_graphic_paths.append(use_path)

    try:
        _run_render(
            video_path,
            output_path,
            keep_segments,
            caption_chunks,
            prepared_graphics,
            sfx_plays,
            graphic_width_frac=max(0.1, min(float(graphic_width_frac), 1.0)),
            caption_font_size=max(8, min(int(caption_font_size), 120)),
            caption_font_color_hex=str(caption_font_color_hex or "FFFFFF"),
            caption_outline_color_hex=str(caption_outline_color_hex or "000000"),
            caption_position=str(caption_position or "bottom"),
            caption_bold=bool(caption_bold),
            caption_box=bool(caption_box),
            caption_border_width=max(0, min(int(caption_border_width), 8)),
            caption_fade_in_sec=max(0.0, float(caption_fade_in_sec)),
            caption_fade_out_sec=max(0.0, float(caption_fade_out_sec)),
            graphic_position=str(graphic_position or "center"),
            graphic_motion_default=gm_default,
            graphic_anim_in_sec=max(0.0, float(graphic_anim_in_sec)),
            graphic_fade_in_sec=max(0.0, float(graphic_fade_in_sec)),
            graphic_fade_out_sec=max(0.0, float(graphic_fade_out_sec)),
            zoom_active_expr=zoom_expr,
            zoom_zf=zf,
            zoom_cx=cx,
            zoom_cy=cy,
            output_aspect_ratio=str(output_aspect_ratio or "original"),
            video_speed=float(video_speed),
            progress_callback=progress_callback,
            preview_scale_max_w=int(preview_max_width) if preview_max_width else 0,
            preview_crf=int(preview_crf),
            preview_max_fps=int(preview_max_fps) if preview_max_fps else 0,
        )
    except Exception as exc:
        return EngineResult(ok=False, error=f"Full export failed: {exc}")
    finally:
        for tp in temp_graphic_paths:
            try:
                os.unlink(tp)
            except OSError:
                pass

    if not os.path.isfile(output_path) or os.path.getsize(output_path) == 0:
        return EngineResult(ok=False, error="Export produced an empty or missing file")

    data_out: dict[str, Any] = {
        "output_path": output_path,
        "captions_rendered": len(caption_chunks),
        "graphics_rendered": len(graphic_inputs),
        "sfx_rendered": len(sfx_plays),
    }
    if face_zoom_enabled:
        data_out["face_zoom_windows"] = zoom_window_count
    return EngineResult(ok=True, data=data_out)


def _run_render(
    video_path: str,
    output_path: str,
    keep_segments: list[dict[str, float]],
    caption_chunks: list[dict[str, Any]],
    graphic_inputs: list[dict[str, Any]],
    sfx_plays: list[tuple[str, int, float]],
    graphic_width_frac: float = 0.85,
    caption_font_size: int = 24,
    caption_font_color_hex: str = "FFFFFF",
    caption_outline_color_hex: str = "000000",
    caption_position: str = "bottom",
    caption_bold: bool = False,
    caption_box: bool = False,
    caption_border_width: int = 2,
    caption_fade_in_sec: float = 0.0,
    caption_fade_out_sec: float = 0.0,
    graphic_position: str = "center",
    graphic_motion_default: str = "none",
    graphic_anim_in_sec: float = 0.25,
    graphic_fade_in_sec: float = 0.0,
    graphic_fade_out_sec: float = 0.0,
    zoom_active_expr: str = "",
    zoom_zf: float = 1.12,
    zoom_cx: float = 0.5,
    zoom_cy: float = 0.5,
    output_aspect_ratio: str = "original",
    video_speed: float = 1.0,
    progress_callback: Callable[[int], None] | None = None,
    preview_scale_max_w: int = 0,
    preview_crf: int = 28,
    preview_max_fps: int = 0,
) -> None:
    """Build and execute the FFmpeg command."""
    between_clauses = "+".join(
        f"between(t\\,{s['start']:.3f}\\,{s['end']:.3f})" for s in keep_segments
    )

    speed = max(0.25, min(4.0, float(video_speed)))
    use_complex = bool(graphic_inputs or sfx_plays)
    aspect_key = str(output_aspect_ratio or "original").strip().lower()
    need_probe = (
        use_complex
        or (zoom_active_expr and zoom_active_expr != "0")
        or (aspect_key not in ("", "original"))
    )
    if need_probe:
        main_w, main_h = _video_frame_dimensions(video_path)
        base_fps = _video_avg_fps(video_path)
    else:
        main_w, main_h = 1280, 720
        base_fps = 30.0

    crop_f = _center_crop_filter(main_w, main_h, aspect_key)
    cw, ch = main_w, main_h
    if crop_f:
        m = re.match(r"crop=(\d+):(\d+):(\d+):(\d+)", crop_f)
        if m:
            cw, ch = int(m.group(1)), int(m.group(2))

    vf_inner_parts = [
        f"select='{between_clauses}'",
        "setpts=N/FRAME_RATE/TB",
    ]
    if crop_f:
        vf_inner_parts.append(crop_f)
    if zoom_active_expr and zoom_active_expr != "0":
        vf_inner_parts.append(
            _face_zoom_zoompan_filter(
                cw,
                ch,
                base_fps,
                zoom_cx,
                zoom_cy,
                zoom_zf,
                zoom_active_expr,
            )
        )

    font_cwd, font_prefix = _drawtext_fontfile_prefix(bold=caption_bold)
    font_color = _hex_to_fontcolor(caption_font_color_hex)
    border_color = _hex_to_fontcolor(caption_outline_color_hex)
    cap_margin = 48

    caption_filter_clauses: list[str] = []
    for chunk in caption_chunks:
        escaped = _escape_drawtext(chunk["text"])
        alpha_part = ""
        if caption_fade_in_sec > 0.001 or caption_fade_out_sec > 0.001:
            ae = _caption_alpha_expr(
                float(chunk["start"]),
                float(chunk["end"]),
                caption_fade_in_sec,
                caption_fade_out_sec,
            )
            alpha_part = f":alpha='{ae}'"
        box_part = ""
        if caption_box:
            box_part = ":box=1:boxcolor=black@0.55:boxborderw=14"
        caption_filter_clauses.append(
            f"drawtext={font_prefix}text='{escaped}'"
            f":fontsize={caption_font_size}"
            f":fontcolor={font_color}"
            f":borderw={caption_border_width}"
            f":bordercolor={border_color}"
            f":x=(w-text_w)/2"
            f":y={_caption_y_expr(caption_position, cap_margin)}"
            f"{alpha_part}"
            f"{box_part}"
            f":enable='between(t\\,{chunk['start']:.3f}\\,{chunk['end']:.3f})'"
        )

    vf_base = ",".join(vf_inner_parts)
    vf_inner = vf_base
    if caption_filter_clauses:
        vf_inner = f"{vf_base},{','.join(caption_filter_clauses)}"
    vf_speed_suffix = f",setpts=PTS/{speed}" if abs(speed - 1.0) >= 1e-6 else ""

    af_select = f"aselect='{between_clauses}',asetpts=N/SR/TB"

    inputs: list[str] = ["-i", video_path]
    map_video: str
    map_audio: str
    extra_args: list[str] = []

    if not use_complex:
        vf_full = f"{vf_inner}{vf_speed_suffix}"
        atempo_chain = _chain_audio_atempo("a0", speed, "afc")
        if atempo_chain:
            filter_complex = f"[0:v]{vf_full}[vfc];[0:a]{af_select}[a0];{atempo_chain}"
        else:
            filter_complex = f"[0:v]{vf_full}[vfc];[0:a]{af_select}[afc]"
        map_video = "[vfc]"
        map_audio = "[afc]"
    else:
        next_idx = 1
        for g in graphic_inputs:
            inputs.extend(["-loop", "1", "-framerate", "30", "-i", g["filePath"]])
            next_idx += 1

        af_main = f"[0:a]{af_select}[mainaud]"

        sfx_argv, sfx_audio_parts, _after_sfx = _build_sfx_audio_filters(
            "mainaud",
            next_idx,
            sfx_plays,
        )
        inputs.extend(sfx_argv)

        if graphic_inputs:
            fc_video = f"[0:v]{vf_base}[vbase]"
            current = "vbase"
        else:
            fc_video = f"[0:v]{vf_inner}[vbase]"
            current = "vbase"
        for i, g in enumerate(graphic_inputs):
            inp_idx = 1 + i
            enable = f"between(t\\,{g['start']:.3f}\\,{g['end']:.3f})"
            out_lab = f"vo{i}"
            vb = f"vb{i}"
            gi = f"gi{i}"
            gs = f"gs{i}"
            gss = f"gss{i}"
            try:
                gw, gh = _graphic_display_dimensions(g["filePath"])
                ow, oh = _overlay_dims_uniform(cw, ch, gw, gh, graphic_width_frac)
            except Exception as exc:
                raise RuntimeError(
                    f"Could not size graphic overlay for {g['filePath']!r}: {exc}"
                ) from exc
            mo = str(g.get("motion", "") or "none")
            if mo not in ("slide_in", "none"):
                mo = graphic_motion_default
            ain = float(g.get("anim_in_sec", graphic_anim_in_sec))
            ox, oy = _graphic_overlay_expressions(
                graphic_position,
                float(g["start"]),
                float(g["end"]),
                mo,
                ain,
            )
            gs0 = f"gss0{i}"
            gf_in = max(0.0, float(graphic_fade_in_sec))
            gf_out = max(0.0, float(graphic_fade_out_sec))
            if gf_in > 0.001 or gf_out > 0.001:
                fade_chain = _graphic_fade_filters(
                    float(g["start"]),
                    float(g["end"]),
                    gf_in,
                    gf_out,
                )
                fc_video += (
                    f";[{inp_idx}:v]setsar=1[{gi}]"
                    f";[{gi}][{current}]scale2ref=w={ow}:h={oh}:force_original_aspect_ratio=disable"
                    f"[{gs}][{vb}]"
                    f";[{gs}]setsar=1[{gs0}];[{gs0}]{fade_chain}[{gss}]"
                    f";[{vb}][{gss}]overlay="
                    f"x='{ox}':y='{oy}'"
                    f":eval=frame"
                    f":enable='{enable}'"
                    f"[{out_lab}]"
                )
            else:
                fc_video += (
                    f";[{inp_idx}:v]setsar=1[{gi}]"
                    f";[{gi}][{current}]scale2ref=w={ow}:h={oh}:force_original_aspect_ratio=disable"
                    f"[{gs}][{vb}]"
                    f";[{gs}]setsar=1[{gss}]"
                    f";[{vb}][{gss}]overlay="
                    f"x='{ox}':y='{oy}'"
                    f":eval=frame"
                    f":enable='{enable}'"
                    f"[{out_lab}]"
                )
            current = out_lab

        if graphic_inputs and caption_filter_clauses:
            for i, cf in enumerate(caption_filter_clauses):
                nxt = f"vcap{i}"
                fc_video += f";[{current}]{cf}[{nxt}]"
                current = nxt

        audio_fc = [af_main] + sfx_audio_parts
        filter_complex = ";".join([fc_video] + audio_fc)
        if abs(speed - 1.0) >= 1e-6:
            fc_video_speed = f"[{current}]setpts=PTS/{speed}[vsped]"
            filter_complex += f";{fc_video_speed}"
            map_video = "[vsped]"
            atail = _chain_audio_atempo("outa", speed, "afspd")
            if atail:
                filter_complex += f";{atail}"
                map_audio = "[afspd]"
            else:
                map_audio = "[outa]"
        else:
            map_video = f"[{current}]"
            map_audio = "[outa]"
        if graphic_inputs:
            extra_args.append("-shortest")

    preview_w = max(0, int(preview_scale_max_w or 0))
    preview_fps = max(0, int(preview_max_fps or 0))
    if preview_w > 0:
        vin = map_video.strip("[]")
        scaled = "vprvlow"
        if preview_fps > 0:
            fps_part = f"fps={preview_fps},"
        else:
            fps_part = ""
        # Cap both axes. Width-only scale (w=min, h=-2) lets portrait / 9:16 frames become
        # extremely tall; some decoders fail and filter graphs edge-case. Fit inside preview_w × preview_h_cap.
        preview_h_cap = max(preview_w, int(round(preview_w * 16 / 9)))
        filter_complex += (
            f";[{vin}]{fps_part}scale=w=min(iw\\,{preview_w}):h=min(ih\\,{preview_h_cap}):"
            f"flags=bilinear:force_original_aspect_ratio=decrease,format=yuv420p[{scaled}]"
        )
        map_video = f"[{scaled}]"

    script_path = _write_temp_filter_complex_script(filter_complex)
    try:
        out_codec: list[str] = []
        if preview_w > 0:
            crf = max(18, min(35, int(preview_crf)))
            if preview_fps > 0:
                gop = max(6, min(72, preview_fps * 2))
            else:
                gop = 48
            out_codec.extend(
                [
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-profile:v",
                    "main",
                    "-crf",
                    str(crf),
                    "-pix_fmt",
                    "yuv420p",
                    "-g",
                    str(gop),
                    "-bf",
                    "0",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "128k",
                    "-movflags",
                    "+faststart",
                ]
            )
        dur_out = _output_duration_sec(keep_segments)
        dur_progress = dur_out / speed if abs(speed - 1.0) >= 1e-6 else dur_out

        output_tail: list[str] = [output_path]
        if preview_w > 0:
            # Preview only: hard-cap mux length so a bad/stuck filter graph cannot encode forever.
            # Small slack beyond nominal output length for A/V tail and rounding.
            t_cap = max(0.25, float(dur_progress) + 3.0)
            output_tail = ["-t", f"{t_cap:.3f}", output_path]

        cmd: list[str] = (
            ["ffmpeg", "-y"]
            + inputs
            + ["-filter_complex_script", script_path, "-map", map_video, "-map", map_audio]
            + extra_args
            + out_codec
            + output_tail
        )
        _execute_ffmpeg(
            cmd,
            cwd=font_cwd,
            timeout=900,
            duration_out_sec=max(0.01, dur_progress),
            progress_cb=progress_callback,
        )
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass
