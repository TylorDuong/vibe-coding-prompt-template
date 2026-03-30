"""FFmpeg-based video processing: ingestion, silence detection, cutting, thumbnails."""

from __future__ import annotations

import base64
import json
import os
import subprocess
import tempfile

from engine.result import EngineResult

PADDING_SEC = 0.20
MERGE_GAP_SEC = 0.30
MIN_KEEP_SEC = 0.15


def validate_input(video_path: str) -> EngineResult:
    """Check that the input file exists and return basic metadata via ffprobe."""
    if not video_path:
        return EngineResult(ok=False, error="video_path is required")

    if not os.path.isfile(video_path):
        return EngineResult(ok=False, error=f"File not found: {video_path}")

    try:
        probe = _ffprobe(video_path)
    except Exception as exc:
        stat = os.stat(video_path)
        return EngineResult(
            ok=True,
            data={
                "filename": os.path.basename(video_path),
                "size_bytes": stat.st_size,
                "extension": os.path.splitext(video_path)[1].lower(),
                "duration": None,
                "probe_error": str(exc),
            },
        )

    duration = float(probe.get("format", {}).get("duration", 0))
    stat = os.stat(video_path)
    return EngineResult(
        ok=True,
        data={
            "filename": os.path.basename(video_path),
            "size_bytes": stat.st_size,
            "extension": os.path.splitext(video_path)[1].lower(),
            "duration": duration,
        },
    )


def detect_silence(
    video_path: str,
    silence_threshold_db: int = -40,
    min_silence_duration_ms: int = 800,
) -> EngineResult:
    """Run FFmpeg silencedetect and return a list of silent intervals."""
    if not video_path or not os.path.isfile(video_path):
        return EngineResult(ok=False, error="Valid video_path required")

    min_dur_sec = min_silence_duration_ms / 1000.0
    cmd = [
        "ffmpeg", "-i", video_path,
        "-af", f"silencedetect=noise={silence_threshold_db}dB:d={min_dur_sec}",
        "-f", "null", "-"
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        return EngineResult(ok=False, error="FFmpeg silence detection timed out after 5 minutes")
    except FileNotFoundError:
        return EngineResult(ok=False, error="FFmpeg not found. Please install FFmpeg and ensure it is on your PATH.")

    if result.returncode != 0 and "Invalid data found" in result.stderr:
        return EngineResult(ok=False, error=f"Unsupported video format or corrupt file: {os.path.basename(video_path)}")

    stderr = result.stderr

    silences: list[dict[str, float]] = []
    start: float | None = None

    for line in stderr.splitlines():
        if "silence_start:" in line:
            try:
                start = float(line.split("silence_start:")[1].strip().split()[0])
            except (ValueError, IndexError):
                start = None
        elif "silence_end:" in line and start is not None:
            try:
                parts = line.split("silence_end:")[1].strip().split()
                end = float(parts[0])
                silences.append({"start": start, "end": end})
            except (ValueError, IndexError):
                pass
            start = None

    probe = _ffprobe(video_path)
    total_duration = float(probe.get("format", {}).get("duration", 0))

    return EngineResult(
        ok=True,
        data={
            "silences": silences,
            "total_duration": total_duration,
            "silence_count": len(silences),
        },
    )


def cut_silences(
    video_path: str,
    output_path: str | None = None,
    silence_threshold_db: int = -40,
    min_silence_duration_ms: int = 800,
    padding_ms: int = 200,
) -> EngineResult:
    """Detect silence, then produce a new video with silent segments removed."""
    detect_result = detect_silence(
        video_path, silence_threshold_db, min_silence_duration_ms
    )
    if not detect_result.ok or not detect_result.data:
        return detect_result

    silences = detect_result.data["silences"]
    total_duration = detect_result.data["total_duration"]

    if not silences:
        return EngineResult(
            ok=True,
            data={
                "output_path": video_path,
                "original_duration": total_duration,
                "new_duration": total_duration,
                "segments_kept": [{"start": 0.0, "end": total_duration}],
                "silences_removed": 0,
            },
        )

    padding_sec = padding_ms / 1000.0
    keep_segments = _invert_silences(silences, total_duration)
    keep_segments = _pad_segments(keep_segments, padding_sec, total_duration)
    keep_segments = _merge_close_segments(keep_segments, MERGE_GAP_SEC)
    keep_segments = _drop_tiny_segments(keep_segments, MIN_KEEP_SEC)

    if not keep_segments:
        return EngineResult(ok=False, error="No audible segments found — entire file is silent")

    if output_path is None:
        base, ext = os.path.splitext(video_path)
        output_path = f"{base}_cut{ext}"

    try:
        _filter_cut(video_path, keep_segments, output_path)
    except Exception as exc:
        return EngineResult(ok=False, error=f"Export failed: {exc}")

    new_duration = sum(s["end"] - s["start"] for s in keep_segments)

    return EngineResult(
        ok=True,
        data={
            "output_path": output_path,
            "original_duration": total_duration,
            "new_duration": round(new_duration, 3),
            "segments_kept": keep_segments,
            "silences_removed": len(silences),
        },
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _ffprobe(video_path: str) -> dict:
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format", "-show_streams",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def _invert_silences(
    silences: list[dict[str, float]], total_duration: float
) -> list[dict[str, float]]:
    """Convert silence intervals into keep intervals."""
    keep: list[dict[str, float]] = []
    cursor = 0.0

    for s in sorted(silences, key=lambda x: x["start"]):
        if s["start"] > cursor:
            keep.append({"start": cursor, "end": s["start"]})
        cursor = s["end"]

    if cursor < total_duration:
        keep.append({"start": cursor, "end": total_duration})

    return keep


def _pad_segments(
    segments: list[dict[str, float]],
    padding: float,
    total_duration: float,
) -> list[dict[str, float]]:
    """Extend each segment by `padding` seconds on both sides, clamped to [0, total_duration]."""
    padded: list[dict[str, float]] = []
    for s in segments:
        padded.append({
            "start": max(0.0, s["start"] - padding),
            "end": min(total_duration, s["end"] + padding),
        })
    return padded


def _merge_close_segments(
    segments: list[dict[str, float]],
    max_gap: float,
) -> list[dict[str, float]]:
    """Merge segments that are closer than `max_gap` seconds apart (or overlapping)."""
    if not segments:
        return []

    sorted_segs = sorted(segments, key=lambda s: s["start"])
    merged: list[dict[str, float]] = [sorted_segs[0].copy()]

    for seg in sorted_segs[1:]:
        prev = merged[-1]
        if seg["start"] - prev["end"] <= max_gap:
            prev["end"] = max(prev["end"], seg["end"])
        else:
            merged.append(seg.copy())

    return merged


def _drop_tiny_segments(
    segments: list[dict[str, float]],
    min_duration: float,
) -> list[dict[str, float]]:
    """Remove segments shorter than `min_duration` seconds."""
    return [s for s in segments if (s["end"] - s["start"]) >= min_duration]


def _filter_cut(
    video_path: str,
    segments: list[dict[str, float]],
    output_path: str,
) -> None:
    """Use FFmpeg select/aselect filters to keep segments in a single pass."""
    between_clauses = "+".join(
        f"between(t\\,{s['start']:.3f}\\,{s['end']:.3f})" for s in segments
    )

    vf = f"select='{between_clauses}',setpts=N/FRAME_RATE/TB"
    af = f"aselect='{between_clauses}',asetpts=N/SR/TB"

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", vf,
        "-af", af,
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        stderr_tail = result.stderr[-500:] if result.stderr else ""
        raise RuntimeError(
            f"FFmpeg exited with code {result.returncode}. {stderr_tail}"
        )


def generate_thumbnail(video_path: str, time_sec: float = 1.0) -> EngineResult:
    """Extract a single frame from the video and return it as a base64 JPEG."""
    if not video_path or not os.path.isfile(video_path):
        return EngineResult(ok=False, error="Valid video_path required")

    tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    tmp.close()

    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(time_sec),
                "-i", video_path,
                "-vframes", "1",
                "-q:v", "5",
                "-vf", "scale=320:-1",
                tmp.name,
            ],
            capture_output=True,
            timeout=30,
        )

        if not os.path.isfile(tmp.name) or os.path.getsize(tmp.name) == 0:
            return EngineResult(ok=False, error="Failed to extract thumbnail frame")

        with open(tmp.name, "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")

        return EngineResult(ok=True, data={"thumbnail": f"data:image/jpeg;base64,{data}"})
    except Exception as exc:
        return EngineResult(ok=False, error=f"Thumbnail extraction failed: {exc}")
    finally:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)
