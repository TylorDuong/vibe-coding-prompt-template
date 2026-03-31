"""Optional face-centered zoom pulses for export (local OpenCV Haar cascade)."""

from __future__ import annotations

import os
from typing import Any


def _source_time_to_output(t: float, keep_segments: list[dict[str, float]]) -> float:
    out = 0.0
    ordered = sorted(keep_segments, key=lambda s: s["start"])
    for seg in ordered:
        ks = float(seg["start"])
        ke = float(seg["end"])
        if t <= ks:
            return out
        if t < ke:
            return out + (t - ks)
        out += ke - ks
    return out


def sample_face_center_normalized(video_path: str, max_samples: int = 16) -> tuple[float, float] | None:
    """Sample frames uniformly; return average face center in 0..1, or None if never detected."""
    try:
        import cv2
    except ImportError:
        return None

    if not video_path or not os.path.isfile(video_path):
        return None

    cascade_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
    if not os.path.isfile(cascade_path):
        return None

    face_cascade = cv2.CascadeClassifier(cascade_path)
    if face_cascade.empty():
        return None

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None

    try:
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        n = max(1, min(max_samples, 24))
        indices: list[int] = []
        if frame_count > 0:
            for i in range(n):
                indices.append(min(frame_count - 1, int((i + 0.5) * frame_count / n)))
        else:
            indices = [0]

        centers: list[tuple[float, float]] = []
        for fi in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(48, 48))
            h, w = gray.shape[:2]
            if len(faces) == 0:
                continue
            x, y, fw, fh = max(faces, key=lambda r: r[2] * r[3])
            cx = (x + fw / 2) / max(w, 1)
            cy = (y + fh / 2) / max(h, 1)
            centers.append((cx, cy))

        if not centers:
            return None
        ax = sum(c[0] for c in centers) / len(centers)
        ay = sum(c[1] for c in centers) / len(centers)
        return (max(0.05, min(0.95, ax)), max(0.05, min(0.95, ay)))
    finally:
        cap.release()


def graphic_overlay_intervals_output(
    matches: list[dict[str, Any]],
    keep_segments: list[dict[str, float]],
) -> list[tuple[float, float]]:
    """Output-timeline intervals [start,end) where a graphic is shown (full match span)."""
    out: list[tuple[float, float]] = []
    for m in matches:
        fp = m.get("graphic", "")
        if not fp or m.get("similarity", 0) < 0.1:
            continue
        g_start = float(m["matched_segment_start"])
        g_end_src = float(m.get("matched_segment_end", g_start + 3.0))
        span = max(0.0, g_end_src - g_start)
        g_end = g_start + (span if span >= 0.05 else 0.2)
        t0 = _source_time_to_output(g_start, keep_segments)
        t1 = _source_time_to_output(g_end, keep_segments)
        if t1 > t0:
            out.append((t0, t1))
    return sorted(out)


def _subtract_intervals_from_pulse(
    pulse_start: float,
    pulse_end: float,
    blocks: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Return sub-intervals of [pulse_start,pulse_end) not covered by blocks (merged)."""
    if pulse_end <= pulse_start:
        return []
    windows = [(pulse_start, pulse_end)]
    for bs, be in sorted(blocks):
        nxt: list[tuple[float, float]] = []
        for a, b in windows:
            if be <= a or bs >= b:
                nxt.append((a, b))
                continue
            if bs > a:
                nxt.append((a, min(bs, b)))
            if be < b:
                nxt.append((max(be, a), b))
        windows = [(x, y) for x, y in nxt if y - x > 0.02]
    return windows


def compute_zoom_windows_output(
    out_duration: float,
    interval_sec: float,
    pulse_sec: float,
    graphic_intervals: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Output-time windows where zoom pulse applies (excluding graphic overlap)."""
    if out_duration <= 0 or interval_sec <= 0.5 or pulse_sec <= 0.05:
        return []
    merged_graphics = _merge_intervals(graphic_intervals)
    windows: list[tuple[float, float]] = []
    t0 = 0.0
    while t0 < out_duration:
        ps, pe = t0, min(t0 + pulse_sec, out_duration)
        windows.extend(_subtract_intervals_from_pulse(ps, pe, merged_graphics))
        t0 += interval_sec
    return _merge_intervals(windows)


def _merge_intervals(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if not intervals:
        return []
    s = sorted(intervals)
    merged: list[tuple[float, float]] = [s[0]]
    for a, b in s[1:]:
        la, lb = merged[-1]
        if a <= lb + 0.001:
            merged[-1] = (la, max(lb, b))
        else:
            merged.append((a, b))
    return merged


def build_zoom_active_expression(
    windows: list[tuple[float, float]],
    time_var: str = "t",
) -> str:
    """FFmpeg expr fragment: 1 inside any window, else 0.

    Use time_var='t' for drawtext/overlay on the cut timeline; use 'in_time' inside zoompan.

    Implemented as a flat sum of between() terms + gt(sum,0) instead of deeply nested if().
    Long presets (large pulse_sec × long output) used to build 40+ nested if() calls and
    could break FFmpeg's expression parser or zoompan, which surfaced as preview encode failure.
    """
    if not windows:
        return "0"
    max_windows = 96
    parts = [
        f"between({time_var}\\,{a:.3f}\\,{b:.3f})" for a, b in windows[:max_windows]
    ]
    if len(parts) == 1:
        return parts[0]
    summed = "+".join(parts)
    return f"gt({summed}\\,0)"
