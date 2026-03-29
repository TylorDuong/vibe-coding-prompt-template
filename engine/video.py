"""FFmpeg-based video processing: ingestion, silence detection, and cutting."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile

from engine.result import EngineResult


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
    silence_threshold_db: int = -30,
    min_silence_duration_ms: int = 500,
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

    result = subprocess.run(cmd, capture_output=True, text=True)
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
    silence_threshold_db: int = -30,
    min_silence_duration_ms: int = 500,
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

    keep_segments = _invert_silences(silences, total_duration)

    if not keep_segments:
        return EngineResult(ok=False, error="No audible segments found — entire file is silent")

    if output_path is None:
        base, ext = os.path.splitext(video_path)
        output_path = f"{base}_cut{ext}"

    _concat_segments(video_path, keep_segments, output_path)

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


def _concat_segments(
    video_path: str,
    segments: list[dict[str, float]],
    output_path: str,
) -> None:
    """Use FFmpeg concat demuxer to join kept segments."""
    tmp_dir = tempfile.mkdtemp(prefix="splitty_")
    segment_files: list[str] = []

    for i, seg in enumerate(segments):
        seg_path = os.path.join(tmp_dir, f"seg_{i:04d}.ts")
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", video_path,
                "-ss", str(seg["start"]),
                "-to", str(seg["end"]),
                "-c", "copy",
                "-avoid_negative_ts", "make_zero",
                seg_path,
            ],
            capture_output=True,
            check=True,
        )
        segment_files.append(seg_path)

    concat_list = os.path.join(tmp_dir, "concat.txt")
    with open(concat_list, "w") as f:
        for sf in segment_files:
            f.write(f"file '{sf}'\n")

    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", concat_list,
            "-c", "copy",
            output_path,
        ],
        capture_output=True,
        check=True,
    )

    for sf in segment_files:
        os.remove(sf)
    os.remove(concat_list)
    os.rmdir(tmp_dir)
