"""FFmpeg-based video processing (stub for Phase 1)."""

from __future__ import annotations

import os

from engine.result import EngineResult


def validate_input(video_path: str) -> EngineResult:
    """Check that the input file exists and return basic metadata."""
    if not video_path:
        return EngineResult(ok=False, error="video_path is required")

    if not os.path.isfile(video_path):
        return EngineResult(ok=False, error=f"File not found: {video_path}")

    stat = os.stat(video_path)
    return EngineResult(
        ok=True,
        data={
            "filename": os.path.basename(video_path),
            "size_bytes": stat.st_size,
            "extension": os.path.splitext(video_path)[1].lower(),
        },
    )


def render_video(timeline: dict) -> EngineResult:
    """Render the final MP4 from a timeline definition.

    In Phase 2 this will drive FFmpeg for silence cutting and compositing.
    """
    return EngineResult(
        ok=True,
        data={
            "status": "render_stub",
            "output_path": "[stub] output.mp4",
            "timeline_events": len(timeline.get("events", [])),
        },
    )
