"""Tests for semantic graphic matching."""

from engine.match import semantic_match, _chunk_segments


SAMPLE_SEGMENTS = [
    {"start": 0.0, "end": 2.0, "text": "Today we are going to talk about software architecture"},
    {"start": 2.0, "end": 4.0, "text": "Specifically about microservices and scalability"},
    {"start": 4.0, "end": 6.0, "text": "Let me show you a diagram of the system"},
    {"start": 6.0, "end": 8.0, "text": "Our revenue has been growing rapidly this quarter"},
    {"start": 8.0, "end": 10.0, "text": "Thanks for watching and please subscribe"},
]


def test_chunk_segments_creates_windows() -> None:
    chunks = _chunk_segments(SAMPLE_SEGMENTS, window_size=2)
    assert len(chunks) == 5
    assert chunks[0]["start"] == 0.0
    assert chunks[0]["end"] == 4.0
    assert "architecture" in chunks[0]["text"]
    assert "microservices" in chunks[0]["text"]


def test_semantic_match_finds_best_timestamp() -> None:
    graphics = [
        {"filePath": "diagram.png", "tag": "system architecture diagram"},
        {"filePath": "chart.png", "tag": "revenue growth chart"},
    ]
    result = semantic_match(SAMPLE_SEGMENTS, graphics)
    assert result.ok is True
    assert result.data is not None

    matches = result.data["matches"]
    assert len(matches) == 2

    arch_match = matches[0]
    assert arch_match["similarity"] > 0.3
    assert arch_match["matched_segment_start"] <= 6.0

    rev_match = matches[1]
    assert rev_match["similarity"] > 0.3
    assert rev_match["matched_segment_start"] >= 4.0


def test_semantic_match_no_graphics() -> None:
    result = semantic_match(SAMPLE_SEGMENTS, [])
    assert result.ok is True
    assert result.data is not None
    assert result.data["matches"] == []


def test_semantic_match_no_segments() -> None:
    result = semantic_match([], [{"filePath": "x.png", "tag": "hello"}])
    assert result.ok is False


def test_semantic_match_empty_tag_skipped() -> None:
    graphics = [{"filePath": "x.png", "tag": ""}]
    result = semantic_match(SAMPLE_SEGMENTS, graphics)
    assert result.ok is True
    assert result.data is not None
    assert result.data["matches"][0]["similarity"] == 0.0
