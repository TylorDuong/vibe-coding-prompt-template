"""Merge adjacent Whisper segments into sentence-oriented lines for UI and matching."""

from __future__ import annotations

import re
from typing import Any


def _text_ends_sentence_boundary(text: str) -> bool:
    t = text.rstrip()
    if not t:
        return False
    return t[-1] in ".?!…"


def _should_merge_adjacent(
    prev: dict[str, Any],
    nxt: dict[str, Any],
    *,
    max_gap_sec: float,
    tight_gap_sec: float,
) -> bool:
    gap = float(nxt["start"]) - float(prev["end"])
    if gap > max_gap_sec:
        return False
    if gap <= tight_gap_sec:
        return True
    prev_text = str(prev.get("text") or "")
    if _text_ends_sentence_boundary(prev_text):
        return False
    return True


def merge_transcript_segments(
    segments: list[dict[str, Any]],
    *,
    max_gap_sec: float = 0.65,
    tight_gap_sec: float = 0.2,
) -> list[dict[str, Any]]:
    """Combine consecutive segments when gap is small and the prior chunk is not a full sentence."""
    if not segments:
        return []

    ordered = sorted(segments, key=lambda s: float(s.get("start", 0.0)))
    groups: list[list[dict[str, Any]]] = []
    cur: list[dict[str, Any]] = [ordered[0]]

    for seg in ordered[1:]:
        prev_seg = cur[-1]
        if _should_merge_adjacent(prev_seg, seg, max_gap_sec=max_gap_sec, tight_gap_sec=tight_gap_sec):
            cur.append(seg)
        else:
            groups.append(cur)
            cur = [seg]
    groups.append(cur)

    out: list[dict[str, Any]] = []
    for g in groups:
        words_out: list[dict[str, Any]] = []
        for s in g:
            w = s.get("words")
            if isinstance(w, list):
                for item in w:
                    if isinstance(item, dict):
                        words_out.append(item)
        texts = [str(s.get("text") or "").strip() for s in g]
        merged_text = re.sub(r"\s+", " ", " ".join(t for t in texts if t)).strip()
        out.append({
            "start": round(float(g[0]["start"]), 3),
            "end": round(float(g[-1]["end"]), 3),
            "text": merged_text,
            "words": words_out,
        })
    return out
