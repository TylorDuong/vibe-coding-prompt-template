"""Tests for the full video renderer (caption chunking and render_full)."""

import os
import subprocess
import tempfile

import pytest

from engine.render import (
    chunk_words,
    build_caption_chunks,
    render_full,
    source_time_to_output,
    remap_interval,
    _overlay_dims_uniform,
)


def test_chunk_words_basic() -> None:
    words = [
        {"word": " Today", "start": 0.0, "end": 0.3},
        {"word": " we", "start": 0.3, "end": 0.5},
        {"word": " are", "start": 0.5, "end": 0.7},
        {"word": " going", "start": 0.7, "end": 1.0},
        {"word": " to", "start": 1.0, "end": 1.2},
    ]
    chunks = chunk_words(words, max_words=3)
    assert len(chunks) == 2
    assert "Today" in chunks[0]["text"]
    assert chunks[0]["start"] == 0.0
    assert chunks[0]["end"] == 0.7
    assert "going" in chunks[1]["text"]


def test_chunk_words_single_word() -> None:
    words = [{"word": "Hello", "start": 0.0, "end": 0.5}]
    chunks = chunk_words(words, max_words=3)
    assert len(chunks) == 1
    assert chunks[0]["text"] == "Hello"


def test_chunk_words_empty() -> None:
    assert chunk_words([], max_words=3) == []


def test_build_caption_chunks_from_segments() -> None:
    segments = [
        {
            "start": 0.0, "end": 2.0, "text": "Hello world",
            "words": [
                {"word": " Hello", "start": 0.0, "end": 0.5},
                {"word": " world", "start": 0.5, "end": 1.0},
            ],
        },
    ]
    chunks = build_caption_chunks(segments, max_words=1)
    assert len(chunks) == 2
    assert chunks[0]["text"] == "Hello"
    assert chunks[1]["text"] == "world"


def test_build_caption_chunks_fallback_no_words() -> None:
    segments = [{"start": 0.0, "end": 2.0, "text": "Fallback text"}]
    chunks = build_caption_chunks(segments, max_words=3)
    assert len(chunks) == 1
    assert chunks[0]["text"] == "Fallback text"


def test_source_time_to_output_no_cuts() -> None:
    keep = [{"start": 0.0, "end": 10.0}]
    assert source_time_to_output(2.5, keep) == 2.5


def test_source_time_to_output_skips_gap() -> None:
    keep = [{"start": 0.0, "end": 2.0}, {"start": 5.0, "end": 8.0}]
    assert source_time_to_output(1.0, keep) == 1.0
    assert source_time_to_output(5.0, keep) == 2.0
    assert source_time_to_output(6.0, keep) == 3.0


def test_remap_interval_collapses_in_gap() -> None:
    keep = [{"start": 0.0, "end": 2.0}, {"start": 5.0, "end": 8.0}]
    assert remap_interval(2.5, 4.5, keep) is None


@pytest.fixture(scope="module")
def test_video_with_audio() -> str:
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


def test_render_full_captions_only(test_video_with_audio: str) -> None:
    """Render with captions only (no graphics, no SFX)."""
    out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    out.close()

    segments = [
        {
            "start": 0.0, "end": 1.5, "text": "Test caption",
            "words": [
                {"word": " Test", "start": 0.0, "end": 0.5},
                {"word": " caption", "start": 0.5, "end": 1.0},
            ],
        },
    ]

    try:
        result = render_full(
            video_path=test_video_with_audio,
            output_path=out.name,
            segments=segments,
            matches=[],
            sfx_pool={},
            keep_segments=[{"start": 0.0, "end": 3.0}],
            events=[],
            max_words=3,
            graphic_display_sec=2.0,
        )
        assert result.ok is True, result.error
        assert result.data is not None
        assert result.data["captions_rendered"] == 1
        assert os.path.isfile(out.name)
        assert os.path.getsize(out.name) > 0
    finally:
        if os.path.exists(out.name):
            os.unlink(out.name)


def test_overlay_dims_square_on_vertical_frame() -> None:
    """9:16 frame, square image: output must stay square at ~95% frame width."""
    ow, oh = _overlay_dims_uniform(1080, 1920, 1000, 1000, 0.95)
    assert ow == oh
    assert ow == 1026


def test_overlay_dims_tall_on_vertical_frame() -> None:
    """Very tall image: height hits frame_h first, width shrinks."""
    ow, oh = _overlay_dims_uniform(1080, 1920, 400, 2000, 0.95)
    assert oh == 1920
    assert ow == 384
