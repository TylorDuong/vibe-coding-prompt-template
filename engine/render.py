"""Full video renderer: composites captions, graphics, and SFX onto the cut video.

Builds a single FFmpeg command with filter_complex that:
  1. Cuts silences (select/aselect)
  2. Draws captions via drawtext (word-chunked by maxWords)
  3. Overlays graphic images at matched timestamps
  4. Mixes SFX audio at per-event timestamps (remapped to output timeline)
"""

from __future__ import annotations

import os
import subprocess
from collections import defaultdict
from typing import Any

from engine.result import EngineResult
from engine.video import detect_silence, _invert_silences, _pad_segments, _merge_close_segments, _drop_tiny_segments


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
    builtin = event.get("sfx_path", "")
    if isinstance(builtin, str) and builtin and os.path.isfile(builtin):
        return builtin
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

    try:
        _run_render(
            video_path,
            output_path,
            keep_segments,
            caption_chunks,
            graphic_inputs,
            sfx_plays,
        )
    except Exception as exc:
        return EngineResult(ok=False, error=f"Full export failed: {exc}")

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
) -> None:
    """Build and execute the FFmpeg command."""
    between_clauses = "+".join(
        f"between(t\\,{s['start']:.3f}\\,{s['end']:.3f})" for s in keep_segments
    )

    vf_inner_parts = [
        f"select='{between_clauses}'",
        "setpts=N/FRAME_RATE/TB",
    ]
    for chunk in caption_chunks:
        escaped = _escape_drawtext(chunk["text"])
        vf_inner_parts.append(
            f"drawtext=text='{escaped}'"
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

    if not use_complex:
        af_inner = f"aselect='{between_clauses}',asetpts=N/SR/TB"
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vf", vf_inner,
            "-af", af_inner,
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
        if result.returncode != 0:
            stderr_tail = result.stderr[-800:] if result.stderr else ""
            raise RuntimeError(f"FFmpeg exited with code {result.returncode}. {stderr_tail}")
        return

    inputs: list[str] = ["-i", video_path]
    next_idx = 1

    for g in graphic_inputs:
        inputs.extend(["-i", g["filePath"]])
        next_idx += 1

    sfx_argv, sfx_audio_parts, after_sfx_idx = _build_sfx_audio_filters(
        "mainaud",
        next_idx,
        sfx_plays,
    )
    inputs.extend(sfx_argv)

    fc_video = f"[0:v]{vf_inner}[vbase]"
    current = "vbase"
    for i, g in enumerate(graphic_inputs):
        inp_idx = 1 + i
        enable = f"between(t\\,{g['start']:.3f}\\,{g['end']:.3f})"
        out_lab = f"vo{i}"
        fc_video += (
            f";[{inp_idx}:v]scale=iw/3:-1[gs{i}]"
            f";[{current}][gs{i}]overlay="
            f"x=(W-w)/2:y=(H-h)/2"
            f":enable='{enable}'"
            f"[{out_lab}]"
        )
        current = out_lab

    af_main = f"[0:a]aselect='{between_clauses}',asetpts=N/SR/TB[mainaud]"
    audio_fc = [af_main] + sfx_audio_parts
    filter_complex = ";".join([fc_video] + audio_fc)

    cmd = (
        ["ffmpeg", "-y"]
        + inputs
        + ["-filter_complex", filter_complex]
        + ["-map", f"[{current}]", "-map", "[outa]"]
        + [output_path]
    )

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if result.returncode != 0:
        stderr_tail = result.stderr[-800:] if result.stderr else ""
        raise RuntimeError(f"FFmpeg exited with code {result.returncode}. {stderr_tail}")
