"""Tests for timeline enrichment and polish."""

from engine.polish import build_events, _inject_attention_sfx


SEGMENTS = [
    {"start": 0.0, "end": 2.0, "text": "Hello world"},
    {"start": 2.0, "end": 5.0, "text": "Testing the pipeline"},
    {"start": 8.0, "end": 10.0, "text": "Final segment"},
]

MATCHES = [
    {
        "graphic": "diagram.png",
        "tag": "architecture",
        "matched_segment_start": 2.0,
        "matched_segment_end": 5.0,
        "matched_text": "Testing the pipeline",
        "similarity": 0.85,
    },
]

SILENCES = [
    {"start": 5.0, "end": 8.0},
]


def test_build_events_produces_all_types() -> None:
    result = build_events(SEGMENTS, MATCHES, SILENCES, total_duration=10.0)
    assert result.ok is True
    assert result.data is not None

    events = result.data["events"]
    types = {e["type"] for e in events}
    assert "caption" in types
    assert "graphic" in types
    assert "sfx" in types
    assert "silence_cut" in types


def test_build_events_sorted_by_start() -> None:
    result = build_events(SEGMENTS, MATCHES, SILENCES, total_duration=10.0)
    events = result.data["events"]
    starts = [e["start"] for e in events]
    assert starts == sorted(starts)


def test_build_events_counts() -> None:
    result = build_events(SEGMENTS, MATCHES, SILENCES, total_duration=10.0)
    counts = result.data["event_counts"]
    assert counts["caption"] == 3
    assert counts["graphic"] == 1
    assert counts["silence_cut"] == 1
    assert counts.get("sfx", 0) >= 1


def test_sfx_triggers_include_caption_cut_and_graphic() -> None:
    result = build_events(SEGMENTS, MATCHES, SILENCES, total_duration=10.0)
    events = result.data["events"]
    triggers = {e.get("trigger") for e in events if e["type"] == "sfx"}
    assert "caption_entry" in triggers
    assert "graphic_entry" in triggers
    assert "silence_cut" in triggers


def test_low_similarity_match_excluded() -> None:
    low_matches = [
        {
            "graphic": "x.png",
            "tag": "",
            "matched_segment_start": 0.0,
            "matched_segment_end": 0.0,
            "matched_text": "",
            "similarity": 0.0,
        },
    ]
    result = build_events(SEGMENTS, low_matches, [], total_duration=10.0)
    graphic_events = [e for e in result.data["events"] if e["type"] == "graphic"]
    assert len(graphic_events) == 0


def test_attention_sfx_injected_for_long_gap() -> None:
    events = [
        {"type": "caption", "start": 0.0},
        {"type": "caption", "start": 10.0},
    ]
    enriched = _inject_attention_sfx(events, total_duration=12.0, attention_length_ms=3000)
    sfx_events = [e for e in enriched if e["type"] == "sfx"]
    assert len(sfx_events) >= 1
    assert sfx_events[0]["trigger"] == "attention_fill"
