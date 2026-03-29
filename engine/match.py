"""Semantic graphic matching via sentence-transformers (SBERT)."""

from __future__ import annotations

from typing import Any

from engine.result import EngineResult

_model_instance: Any = None


def _get_model() -> Any:
    """Lazy-load and cache the SBERT model."""
    global _model_instance
    if _model_instance is None:
        from sentence_transformers import SentenceTransformer

        _model_instance = SentenceTransformer("all-MiniLM-L6-v2")
    return _model_instance


def _chunk_segments(
    segments: list[dict], window_size: int = 3
) -> list[dict]:
    """Create overlapping text chunks from transcript segments.

    Each chunk combines `window_size` consecutive segments into a single
    text block, keeping the start time of the first segment and the end
    time of the last.
    """
    if not segments:
        return []

    chunks: list[dict] = []
    for i in range(len(segments)):
        window = segments[i : i + window_size]
        text = " ".join(s["text"] for s in window if s.get("text"))
        if not text.strip():
            continue
        chunks.append({
            "text": text.strip(),
            "start": window[0]["start"],
            "end": window[-1]["end"],
            "segment_indices": list(range(i, i + len(window))),
        })
    return chunks


def semantic_match(
    segments: list[dict],
    graphics: list[dict],
) -> EngineResult:
    """Match graphics to transcript segments by cosine similarity.

    Each graphic should have:
      - filePath: str
      - tag: str (text description of the graphic)

    Returns the best matching timestamp for each graphic.
    """
    if not segments:
        return EngineResult(ok=False, error="No transcript segments provided")

    if not graphics:
        return EngineResult(ok=True, data={"matches": []})

    tags = [g.get("tag", "") for g in graphics]
    if not any(tags):
        return EngineResult(ok=True, data={"matches": [
            {
                "graphic": g.get("filePath", ""),
                "tag": "",
                "matched_segment_start": 0.0,
                "matched_segment_end": 0.0,
                "matched_text": "",
                "similarity": 0.0,
            }
            for g in graphics
        ]})

    chunks = _chunk_segments(segments)
    if not chunks:
        return EngineResult(ok=False, error="No usable transcript text for matching")

    try:
        model = _get_model()

        chunk_texts = [c["text"] for c in chunks]
        chunk_embeddings = model.encode(chunk_texts, convert_to_tensor=True)
        tag_embeddings = model.encode(tags, convert_to_tensor=True)

        from sentence_transformers import util

        cos_scores = util.cos_sim(tag_embeddings, chunk_embeddings)

        matches: list[dict[str, Any]] = []
        for i, graphic in enumerate(graphics):
            tag = tags[i]
            if not tag:
                matches.append({
                    "graphic": graphic.get("filePath", ""),
                    "tag": "",
                    "matched_segment_start": 0.0,
                    "matched_segment_end": 0.0,
                    "matched_text": "",
                    "similarity": 0.0,
                })
                continue

            scores = cos_scores[i]
            best_idx = int(scores.argmax())
            best_score = float(scores[best_idx])
            best_chunk = chunks[best_idx]

            matches.append({
                "graphic": graphic.get("filePath", ""),
                "tag": tag,
                "matched_segment_start": best_chunk["start"],
                "matched_segment_end": best_chunk["end"],
                "matched_text": best_chunk["text"],
                "similarity": round(best_score, 4),
            })

        return EngineResult(ok=True, data={"matches": matches})

    except Exception as exc:
        return EngineResult(ok=False, error=f"Semantic matching failed: {exc}")
