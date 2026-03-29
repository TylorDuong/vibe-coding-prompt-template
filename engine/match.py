"""Semantic graphic matching via sentence-transformers (stub for Phase 1)."""

from __future__ import annotations

from engine.result import EngineResult


def semantic_match(
    segments: list[dict],
    graphics: list[dict],
) -> EngineResult:
    """Match graphics to transcript segments by cosine similarity.

    In Phase 2 this will use SBERT embeddings for real semantic matching.
    """
    if not segments:
        return EngineResult(ok=False, error="No transcript segments provided")

    matches: list[dict] = []
    for graphic in graphics:
        matches.append({
            "graphic": graphic.get("filePath", ""),
            "tag": graphic.get("tag", ""),
            "matched_segment_start": segments[0]["start"] if segments else 0.0,
            "similarity": 0.0,
        })

    return EngineResult(ok=True, data={"matches": matches})
