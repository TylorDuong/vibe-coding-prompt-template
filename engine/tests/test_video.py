"""Tests for video processing (silence detection and cutting)."""

import os
import subprocess
import tempfile

import pytest

from engine.video import (
    validate_input, detect_silence, cut_silences,
    _invert_silences, _pad_segments, _merge_close_segments, _drop_tiny_segments,
)


@pytest.fixture(scope="module")
def sample_video() -> str:
    """Create a synthetic 5s video: 1s tone, 2s silence, 2s tone."""
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()

    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i",
            "sine=frequency=440:duration=1",
            "-f", "lavfi", "-i",
            "anullsrc=r=44100:cl=mono",
            "-f", "lavfi", "-i",
            "sine=frequency=880:duration=2",
            "-filter_complex",
            "[0:a][1:a]concat=n=2:v=0:a=1[mid];[mid]atrim=0:3[trimmed];[trimmed][2:a]concat=n=2:v=0:a=1[out]",
            "-map", "[out]",
            "-c:a", "aac",
            "-f", "mp4",
            tmp.name,
        ],
        capture_output=True,
        check=True,
    )

    yield tmp.name
    os.unlink(tmp.name)


def test_validate_input_real_file(sample_video: str) -> None:
    result = validate_input(sample_video)
    assert result.ok is True
    assert result.data is not None
    assert result.data["duration"] > 0
    assert result.data["extension"] == ".mp4"


def test_detect_silence_finds_gap(sample_video: str) -> None:
    result = detect_silence(sample_video, silence_threshold_db=-30, min_silence_duration_ms=500)
    assert result.ok is True
    assert result.data is not None
    assert result.data["silence_count"] >= 1
    silences = result.data["silences"]
    assert len(silences) >= 1
    assert silences[0]["end"] > silences[0]["start"]


def test_cut_silences_produces_shorter_file(sample_video: str) -> None:
    base, ext = os.path.splitext(sample_video)
    out_path = f"{base}_testcut{ext}"

    try:
        result = cut_silences(
            sample_video,
            output_path=out_path,
            silence_threshold_db=-30,
            min_silence_duration_ms=500,
        )
        assert result.ok is True
        assert result.data is not None
        assert result.data["silences_removed"] >= 1
        assert result.data["new_duration"] < result.data["original_duration"]
        assert os.path.isfile(out_path)
    finally:
        if os.path.exists(out_path):
            os.unlink(out_path)


def test_invert_silences_logic() -> None:
    silences = [{"start": 1.0, "end": 3.0}]
    keep = _invert_silences(silences, 5.0)
    assert keep == [{"start": 0.0, "end": 1.0}, {"start": 3.0, "end": 5.0}]


def test_invert_silences_no_gaps() -> None:
    keep = _invert_silences([], 5.0)
    assert keep == [{"start": 0.0, "end": 5.0}]


def test_pad_segments_extends_both_sides() -> None:
    segments = [{"start": 1.0, "end": 2.0}, {"start": 4.0, "end": 5.0}]
    padded = _pad_segments(segments, 0.2, 6.0)
    assert padded[0]["start"] == pytest.approx(0.8)
    assert padded[0]["end"] == pytest.approx(2.2)
    assert padded[1]["start"] == pytest.approx(3.8)
    assert padded[1]["end"] == pytest.approx(5.2)


def test_pad_segments_clamps_to_bounds() -> None:
    segments = [{"start": 0.05, "end": 4.95}]
    padded = _pad_segments(segments, 0.2, 5.0)
    assert padded[0]["start"] == 0.0
    assert padded[0]["end"] == 5.0


def test_merge_close_segments() -> None:
    segments = [
        {"start": 0.0, "end": 1.0},
        {"start": 1.2, "end": 2.0},
        {"start": 5.0, "end": 6.0},
    ]
    merged = _merge_close_segments(segments, 0.3)
    assert len(merged) == 2
    assert merged[0] == {"start": 0.0, "end": 2.0}
    assert merged[1] == {"start": 5.0, "end": 6.0}


def test_merge_overlapping_segments() -> None:
    segments = [
        {"start": 0.0, "end": 1.5},
        {"start": 1.3, "end": 3.0},
    ]
    merged = _merge_close_segments(segments, 0.3)
    assert len(merged) == 1
    assert merged[0] == {"start": 0.0, "end": 3.0}


def test_drop_tiny_segments() -> None:
    segments = [
        {"start": 0.0, "end": 0.05},
        {"start": 1.0, "end": 2.0},
        {"start": 3.0, "end": 3.1},
    ]
    kept = _drop_tiny_segments(segments, 0.15)
    assert len(kept) == 1
    assert kept[0] == {"start": 1.0, "end": 2.0}
