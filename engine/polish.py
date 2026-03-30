"""Timeline enrichment: insert SFX cue markers and cut markers.

Walks the raw timeline and produces a flat list of timed events
(captions, graphics, sfx, cuts) that the renderer can consume.

SFX events carry only a trigger type; playback uses files from the user SFX pool
in the exporter (no bundled placeholder audio).
"""

from __future__ import annotations

from typing import Any

from engine.result import EngineResult


def build_events(
    segments: list[dict[str, Any]],
    matches: list[dict[str, Any]],
    silences: list[dict[str, Any]],
    total_duration: float,
    attention_length_ms: int = 3000,
) -> EngineResult:
    """Produce an ordered event list from pipeline outputs.

    Event types:
      - caption: a transcript segment to display
      - graphic: a matched graphic to overlay
      - sfx: sound cue (trigger only; user must assign audio in the SFX pool to hear it)
      - silence_cut: a removed silence interval
    """
    events: list[dict[str, Any]] = []

    for seg in segments:
        events.append({
            "type": "caption",
            "start": seg["start"],
            "end": seg["end"],
            "text": seg.get("text", ""),
            "words": seg.get("words", []),
        })
        events.append({
            "type": "sfx",
            "start": seg["start"],
            "trigger": "caption_entry",
        })

    for m in matches:
        if m.get("similarity", 0) < 0.1:
            continue
        t = m["matched_segment_start"]
        events.append({
            "type": "graphic",
            "start": t,
            "end": m.get("matched_segment_end", t + 3.0),
            "filePath": m.get("graphic", ""),
            "tag": m.get("tag", ""),
            "similarity": m.get("similarity", 0),
            "animation": "slide_in",
        })
        events.append({
            "type": "sfx",
            "start": t,
            "trigger": "graphic_entry",
        })

    for s in silences:
        events.append({
            "type": "silence_cut",
            "start": s["start"],
            "end": s["end"],
        })
        events.append({
            "type": "sfx",
            "start": s["end"],
            "trigger": "silence_cut",
        })

    events.sort(key=lambda e: e["start"])

    events = _inject_attention_sfx(events, total_duration, attention_length_ms)

    return EngineResult(
        ok=True,
        data={
            "events": events,
            "event_counts": _count_types(events),
            "total_duration": total_duration,
        },
    )


def _inject_attention_sfx(
    events: list[dict[str, Any]],
    total_duration: float,
    attention_length_ms: int,
) -> list[dict[str, Any]]:
    """Insert attention-fill SFX markers at gaps longer than attention_length."""
    if total_duration <= 0 or attention_length_ms <= 0:
        return events

    attention_sec = attention_length_ms / 1000.0

    visual_times = sorted(
        e["start"] for e in events if e["type"] in ("graphic", "caption")
    )

    if not visual_times:
        return events

    extra: list[dict[str, Any]] = []
    prev = 0.0

    for t in visual_times:
        gap = t - prev
        if gap > attention_sec:
            inject_at = prev + attention_sec
            extra.append({
                "type": "sfx",
                "start": inject_at,
                "trigger": "attention_fill",
            })
        prev = t

    if extra:
        events = events + extra
        events.sort(key=lambda e: e["start"])

    return events


def _count_types(events: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for e in events:
        t = e.get("type", "unknown")
        counts[t] = counts.get(t, 0) + 1
    return counts
