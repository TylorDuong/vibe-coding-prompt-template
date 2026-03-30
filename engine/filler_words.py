"""Remove common filler tokens from transcript word lists (caption text only; audio unchanged)."""

from __future__ import annotations

import copy
from typing import Any

# Lowercase, no surrounding punctuation — matched after normalizing each token.
_FILLER_NORMALIZED: frozenset[str] = frozenset({
    "um",
    "umm",
    "uh",
    "uhh",
    "er",
    "erm",
    "hm",
    "hmm",
    "like",
    "basically",
    "literally",
    "actually",
    "you know",
    "sort of",
    "kind of",
})


def _normalize_token(word: str) -> str:
    w = word.strip().lower().strip(".,!?;:\"'")
    return w


def strip_filler_words_from_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deep-copy segments and drop filler words from `words`; rebuild `text` from remaining words."""
    out: list[dict[str, Any]] = []
    for seg in segments:
        seg_copy = copy.deepcopy(seg)
        words = seg_copy.get("words")
        if isinstance(words, list) and words:
            kept: list[dict[str, Any]] = []
            for w in words:
                if not isinstance(w, dict):
                    continue
                raw = str(w.get("word", "") or "")
                if _normalize_token(raw) in _FILLER_NORMALIZED:
                    continue
                kept.append(w)
            seg_copy["words"] = kept
            seg_copy["text"] = "".join(str(x.get("word", "") or "") for x in kept).strip()
        out.append(seg_copy)
    return out
