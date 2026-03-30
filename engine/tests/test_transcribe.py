"""Tests for local transcription via faster-whisper."""

import os
import subprocess
import tempfile

import pytest

from engine.transcribe import transcribe


@pytest.fixture(scope="module")
def speech_video() -> str:
    """Create a 3s video with a 440Hz tone (simulates audio content).

    faster-whisper may produce empty or hallucinated text for a pure tone,
    but the pipeline should still complete without error.
    """
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()

    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
            "-f", "lavfi", "-i", "color=c=black:s=320x240:d=3:r=25",
            "-c:v", "libx264", "-preset", "ultrafast",
            "-c:a", "aac",
            "-shortest",
            tmp.name,
        ],
        capture_output=True,
        check=True,
    )

    yield tmp.name
    os.unlink(tmp.name)


def test_transcribe_returns_segments(speech_video: str) -> None:
    result = transcribe(speech_video)
    assert result.ok is True
    assert result.data is not None
    assert "segments" in result.data
    assert "language" in result.data
    assert "duration" in result.data
    assert result.data["duration"] > 0


def test_transcribe_missing_path() -> None:
    result = transcribe("")
    assert result.ok is False
    assert result.error is not None


def test_transcribe_nonexistent_file() -> None:
    result = transcribe("/tmp/no_such_file.mp4")
    assert result.ok is False
