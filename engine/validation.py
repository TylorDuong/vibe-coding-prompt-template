"""Shared input validation utilities for engine modules."""

from __future__ import annotations

import os

from engine.result import EngineResult

ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".ts"}
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}
MAX_PATH_LENGTH = 1024


def validate_video_path(video_path: str) -> EngineResult | None:
    """Return an error EngineResult if the path is invalid, or None if OK."""
    if not video_path or not isinstance(video_path, str):
        return EngineResult(ok=False, error="video_path is required")

    if len(video_path) > MAX_PATH_LENGTH:
        return EngineResult(ok=False, error="File path is too long")

    if not os.path.isabs(video_path):
        return EngineResult(ok=False, error="File path must be absolute")

    resolved = os.path.realpath(video_path)
    if not os.path.isfile(resolved):
        return EngineResult(ok=False, error=f"File not found: {os.path.basename(video_path)}")

    ext = os.path.splitext(resolved)[1].lower()
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        return EngineResult(
            ok=False,
            error=f"Unsupported video format: {ext}. Supported: {', '.join(sorted(ALLOWED_VIDEO_EXTENSIONS))}",
        )

    return None


def validate_output_path(output_path: str) -> EngineResult | None:
    """Return an error EngineResult if the output path is invalid, or None if OK."""
    if not output_path or not isinstance(output_path, str):
        return EngineResult(ok=False, error="output_path is required")

    if len(output_path) > MAX_PATH_LENGTH:
        return EngineResult(ok=False, error="Output path is too long")

    if not os.path.isabs(output_path):
        return EngineResult(ok=False, error="Output path must be absolute")

    parent = os.path.dirname(os.path.realpath(output_path))
    if not os.path.isdir(parent):
        return EngineResult(ok=False, error=f"Output directory does not exist: {parent}")

    return None


def sanitize_number(value: object, min_val: float, max_val: float, default: float) -> float:
    """Clamp a numeric value to a safe range."""
    try:
        n = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return max(min_val, min(max_val, n))
