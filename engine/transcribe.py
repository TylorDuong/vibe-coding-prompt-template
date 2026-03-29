"""Whisper-based local transcription (stub for Phase 1)."""

from __future__ import annotations

from engine.result import EngineResult


def transcribe(video_path: str) -> EngineResult:
    """Transcribe audio from a video file and return timestamped segments.

    In Phase 2 this will use faster-whisper for GPU-accelerated ASR.
    """
    if not video_path:
        return EngineResult(ok=False, error="video_path is required")

    return EngineResult(
        ok=True,
        data={
            "segments": [
                {"start": 0.0, "end": 2.5, "text": "[stub] Hello world"},
                {"start": 2.5, "end": 5.0, "text": "[stub] This is a placeholder transcript"},
            ]
        },
    )
