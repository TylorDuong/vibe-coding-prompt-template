"""Filler word stripping for captions."""

from engine.filler_words import strip_filler_words_from_segments


def test_strip_filler_removes_um_from_words() -> None:
    segments = [
        {
            "start": 0.0,
            "end": 1.0,
            "text": "um hello",
            "words": [
                {"word": " um", "start": 0.0, "end": 0.2},
                {"word": " hello", "start": 0.2, "end": 0.8},
            ],
        },
    ]
    out = strip_filler_words_from_segments(segments)
    assert len(out) == 1
    assert "hello" in out[0]["text"]
    assert "um" not in out[0]["text"].lower()
    assert len(out[0]["words"]) == 1


def test_strip_filler_preserves_segment_without_words() -> None:
    segments = [{"start": 0.0, "end": 1.0, "text": "only text"}]
    out = strip_filler_words_from_segments(segments)
    assert out[0]["text"] == "only text"
