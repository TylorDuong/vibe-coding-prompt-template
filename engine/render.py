"""Full video renderer: composites captions, graphics, and SFX onto the cut video.

Builds a single FFmpeg command with filter_complex that:
  1. Cuts silences (select/aselect)
  2. Draws captions via drawtext (word-chunked by maxWords)
  3. Overlays graphic images at matched timestamps
  4. Mixes SFX audio at per-event timestamps (remapped to output timeline)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from collections import defaultdict
from typing import Any

from engine.result import EngineResult
from engine.video import detect_silence, _invert_silences, _pad_segments, _merge_close_segments, _drop_tiny_segments

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


def _resolve_drawtext_fontfile() -> str | None:
    """Path to a system font for drawtext. Avoids fontconfig (often broken on Windows FFmpeg)."""
    override = os.environ.get("SPLITTY_FFMPEG_FONT", "").strip()
    if override and os.path.isfile(override):
        return override

    candidates: list[str] = []
    if os.name == "nt":
        windir = os.environ.get("WINDIR", r"C:\Windows")
        fonts_dir = os.path.join(windir, "Fonts")
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


def _drawtext_fontfile_prefix() -> tuple[str | None, str]:
    """(cwd for subprocess or None, optional `fontfile=...:` prefix for each drawtext)."""
    path = _resolve_drawtext_fontfile()
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


def _resolve_sfx_path(event: dict[str, Any], sfx_pool: dict[str, str]) -> str:
    trigger = str(event.get("trigger", "") or "")
    pool_path = sfx_pool.get(trigger, "")
    if pool_path and os.path.isfile(pool_path):
        return pool_path
    return ""


def collect_sfx_plays(
    events: list[dict[str, Any]],
    sfx_pool: dict[str, str],
    keep_segments: list[dict[str, float]],
) -> list[tuple[str, int]]:
    """Build (audio_path, delay_ms) for each sfx event on the output timeline."""
    plays: list[tuple[str, int]] = []
    for e in events:
        if e.get("type") != "sfx":
            continue
        path = _resolve_sfx_path(e, sfx_pool)
        if not path:
            continue
        t_src = float(e.get("start", 0.0))
        t_out = source_time_to_output(t_src, keep_segments)
        delay_ms = max(0, int(round(t_out * 1000)))
        plays.append((path, delay_ms))
    return plays


def _build_sfx_audio_filters(
    main_label: str,
    input_index_start: int,
    plays: list[tuple[str, int]],
) -> tuple[list[str], list[str], int]:
    """Extra argv (-i ...) pieces, filter_complex audio segments, next input index."""
    if not plays:
        return [], [f"[{main_label}]anull[outa]"], input_index_start

    by_path: dict[str, list[int]] = defaultdict(list)
    for path, delay_ms in plays:
        by_path[path].append(delay_ms)

    extra_argv: list[str] = []
    parts: list[str] = []
    idx = input_index_start
    sfx_labels: list[str] = []

    for path in sorted(by_path.keys()):
        delays = sorted(by_path[path])
        extra_argv.extend(["-i", path])
        n = len(delays)
        if n == 1:
            d = delays[0]
            lab = f"sfx{idx}"
            parts.append(f"[{idx}:a]adelay={d}|{d},apad=whole_dur=0[{lab}]")
            sfx_labels.append(f"[{lab}]")
        else:
            split_outs = "".join(f"[sp{idx}_{j}]" for j in range(n))
            parts.append(f"[{idx}:a]asplit={n}{split_outs}")
            for j, d in enumerate(delays):
                lab = f"sfx{idx}_{j}"
                parts.append(f"[sp{idx}_{j}]adelay={d}|{d},apad=whole_dur=0[{lab}]")
                sfx_labels.append(f"[{lab}]")
        idx += 1

    mix_inputs = 1 + len(sfx_labels)
    # normalize=1 divides level by sqrt(inputs) and makes speech nearly silent when many SFX branches exist
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
) -> EngineResult:
    """Render the final video with captions, graphics, and SFX overlaid."""
    if not video_path or not os.path.isfile(video_path):
        return EngineResult(ok=False, error="Valid video_path required")
    if not output_path:
        return EngineResult(ok=False, error="output_path is required")

    caption_chunks = build_caption_chunks(segments, max_words)
    caption_chunks = remap_caption_chunks(caption_chunks, keep_segments)

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
                })

    sfx_plays = collect_sfx_plays(events, sfx_pool, keep_segments)

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

    return EngineResult(ok=True, data={
        "output_path": output_path,
        "captions_rendered": len(caption_chunks),
        "graphics_rendered": len(graphic_inputs),
        "sfx_rendered": len(sfx_plays),
    })


def _run_render(
    video_path: str,
    output_path: str,
    keep_segments: list[dict[str, float]],
    caption_chunks: list[dict[str, Any]],
    graphic_inputs: list[dict[str, Any]],
    sfx_plays: list[tuple[str, int]],
    graphic_width_frac: float = 0.85,
) -> None:
    """Build and execute the FFmpeg command."""
    between_clauses = "+".join(
        f"between(t\\,{s['start']:.3f}\\,{s['end']:.3f})" for s in keep_segments
    )

    vf_inner_parts = [
        f"select='{between_clauses}'",
        "setpts=N/FRAME_RATE/TB",
    ]
    font_cwd, font_prefix = _drawtext_fontfile_prefix()
    for chunk in caption_chunks:
        escaped = _escape_drawtext(chunk["text"])
        vf_inner_parts.append(
            f"drawtext={font_prefix}text='{escaped}'"
            f":fontsize=24"
            f":fontcolor=white"
            f":borderw=2"
            f":bordercolor=black"
            f":x=(w-text_w)/2"
            f":y=h-th-40"
            f":enable='between(t\\,{chunk['start']:.3f}\\,{chunk['end']:.3f})'"
        )
    vf_inner = ",".join(vf_inner_parts)

    use_complex = bool(graphic_inputs or sfx_plays)
    af_select = f"aselect='{between_clauses}',asetpts=N/SR/TB"

    inputs: list[str] = ["-i", video_path]
    map_video: str
    map_audio: str
    extra_args: list[str] = []

    if not use_complex:
        filter_complex = f"[0:v]{vf_inner}[vfc];[0:a]{af_select}[afc]"
        map_video = "[vfc]"
        map_audio = "[afc]"
    else:
        next_idx = 1
        for g in graphic_inputs:
            # Still images decode as a single frame; loop + fps so overlay enable= has frames to show.
            inputs.extend(["-loop", "1", "-framerate", "30", "-i", g["filePath"]])
            next_idx += 1

        sfx_argv, sfx_audio_parts, _after_sfx = _build_sfx_audio_filters(
            "mainaud",
            next_idx,
            sfx_plays,
        )
        inputs.extend(sfx_argv)

        # Compute pixel-accurate overlay size in Python (Pillow + ffprobe). FFmpeg expression
        # scale2ref(iw/ih) has been unreliable for some square stills vs 16:9 sources on Windows.
        main_w, main_h = _video_frame_dimensions(video_path)

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
                ow, oh = _overlay_dims_uniform(main_w, main_h, gw, gh, graphic_width_frac)
            except Exception as exc:
                raise RuntimeError(
                    f"Could not size graphic overlay for {g['filePath']!r}: {exc}"
                ) from exc
            fc_video += (
                f";[{inp_idx}:v]setsar=1[{gi}]"
                f";[{gi}][{current}]scale2ref=w={ow}:h={oh}:force_original_aspect_ratio=disable"
                f"[{gs}][{vb}]"
                f";[{gs}]setsar=1[{gss}]"
                f";[{vb}][{gss}]overlay="
                f"x=(W-w)/2:y=(H-h)/2"
                f":enable='{enable}'"
                f"[{out_lab}]"
            )
            current = out_lab

        af_main = f"[0:a]{af_select}[mainaud]"
        audio_fc = [af_main] + sfx_audio_parts
        filter_complex = ";".join([fc_video] + audio_fc)
        map_video = f"[{current}]"
        map_audio = "[outa]"
        if graphic_inputs:
            extra_args.append("-shortest")

    script_path = _write_temp_filter_complex_script(filter_complex)
    try:
        cmd: list[str] = (
            ["ffmpeg", "-y"]
            + inputs
            + ["-filter_complex_script", script_path, "-map", map_video, "-map", map_audio]
            + extra_args
            + [output_path]
        )
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=900,
            cwd=font_cwd,
        )
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass

    if result.returncode != 0:
        stderr_tail = result.stderr[-800:] if result.stderr else ""
        raise RuntimeError(f"FFmpeg exited with code {result.returncode}. {stderr_tail}")
