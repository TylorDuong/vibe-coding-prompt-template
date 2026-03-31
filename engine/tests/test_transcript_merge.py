"""Tests for transcript segment merging."""

from engine.transcript_merge import merge_transcript_segments


def test_merge_joins_short_gaps_without_sentence_end() -> None:
    segs = [
        {"start": 0.0, "end": 1.0, "text": "Hello there", "words": []},
        {"start": 1.1, "end": 2.0, "text": "friend.", "words": []},
    ]
    out = merge_transcript_segments(segs)
    assert len(out) == 1
    assert out[0]["start"] == 0.0
    assert out[0]["end"] == 2.0
    assert "Hello there" in out[0]["text"] and "friend" in out[0]["text"]


def test_merge_respects_sentence_boundary_and_gap() -> None:
    segs = [
        {"start": 0.0, "end": 1.0, "text": "Done.", "words": []},
        {"start": 2.0, "end": 3.0, "text": "Next.", "words": []},
    ]
    out = merge_transcript_segments(segs)
    assert len(out) == 2
