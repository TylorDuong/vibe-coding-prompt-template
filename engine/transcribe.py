"""Local transcription using faster-whisper (CTranslate2 backend)."""

from __future__ import annotations

import os
import subprocess
import tempfile
from typing import Any

from engine.result import EngineResult

_model_instance: Any = None


def _get_model() -> Any:
    """Lazy-load and cache the Whisper model to avoid re-downloading."""
    global _model_instance
    if _model_instance is None:
        from faster_whisper import WhisperModel

        _model_instance = WhisperModel(
            "base",
            device="cpu",
            compute_type="int8",
        )
    return _model_instance


def _extract_audio(video_path: str) -> str:
    """Extract audio from video to a temporary WAV file."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    result = subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            tmp.name,
        ],
        capture_output=True,
    )
    if result.returncode != 0:
        os.unlink(tmp.name)
        stderr = result.stderr.decode() if isinstance(result.stderr, bytes) else result.stderr
        if "does not contain any stream" in stderr or "Output file is empty" in stderr:
            raise RuntimeError("Video has no audio track. Transcription requires audio.")
        raise RuntimeError(f"Audio extraction failed (FFmpeg exit {result.returncode})")

    if os.path.getsize(tmp.name) == 0:
        os.unlink(tmp.name)
        raise RuntimeError("Extracted audio file is empty. The video may have no audible content.")

    return tmp.name


def transcribe(video_path: str) -> EngineResult:
    """Transcribe audio from a video file and return timestamped segments."""
    if not video_path:
        return EngineResult(ok=False, error="video_path is required")

    if not os.path.isfile(video_path):
        return EngineResult(ok=False, error=f"File not found: {video_path}")

    audio_path: str | None = None
    try:
        audio_path = _extract_audio(video_path)
        model = _get_model()
        raw_segments, info = model.transcribe(
            audio_path,
            beam_size=5,
            word_timestamps=True,
        )

        segments: list[dict[str, Any]] = []
        for seg in raw_segments:
            words = []
            if seg.words:
                for w in seg.words:
                    words.append({
                        "word": w.word,
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "probability": round(w.probability, 3),
                    })
            segments.append({
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip(),
                "words": words,
            })

        return EngineResult(
            ok=True,
            data={
                "segments": segments,
                "language": info.language,
                "language_probability": round(info.language_probability, 3),
                "duration": round(info.duration, 3),
            },
        )
    except Exception as exc:
        return EngineResult(ok=False, error=f"Transcription failed: {exc}")
    finally:
        if audio_path and os.path.exists(audio_path):
            os.unlink(audio_path)
