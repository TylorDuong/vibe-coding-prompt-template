"""Engine CLI — JSON-over-stdin/stdout protocol for Electron IPC bridge.

Reads one JSON object per line from stdin, dispatches to the appropriate
module, and writes one JSON response per line to stdout.
"""

from __future__ import annotations

import json
import sys

from engine.result import EngineResult
from engine.validation import validate_video_path, validate_output_path, sanitize_number
from engine.video import (
    validate_input, detect_silence, cut_silences, generate_thumbnail,
    _invert_silences, _pad_segments, _merge_close_segments, _drop_tiny_segments,
)
from engine.transcribe import transcribe
from engine.match import semantic_match
from engine.polish import build_events
from engine.render import render_full


def handle(message: dict) -> EngineResult:
    command = message.get("command")

    if command == "health":
        return EngineResult(ok=True, data={"status": "ok"})

    if command == "ingest":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err
        return validate_input(video_path)

    if command == "thumbnail":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err
        return generate_thumbnail(video_path)

    if command == "detectSilence":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err
        return detect_silence(
            video_path,
            silence_threshold_db=int(sanitize_number(message.get("silenceThresholdDb"), -60, 0, -30)),
            min_silence_duration_ms=int(sanitize_number(message.get("minSilenceDurationMs"), 100, 5000, 500)),
        )

    if command == "cutSilences":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err
        output_path = message.get("outputPath")
        if output_path:
            out_err = validate_output_path(output_path)
            if out_err:
                return out_err
        return cut_silences(
            video_path,
            output_path=output_path,
            silence_threshold_db=int(sanitize_number(message.get("silenceThresholdDb"), -60, 0, -30)),
            min_silence_duration_ms=int(sanitize_number(message.get("minSilenceDurationMs"), 100, 5000, 500)),
        )

    if command == "process":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err

        graphics = message.get("graphics", [])
        if not isinstance(graphics, list):
            graphics = []

        silence_db = int(sanitize_number(message.get("silenceThresholdDb"), -60, 0, -40))
        silence_ms = int(sanitize_number(message.get("minSilenceDurationMs"), 100, 5000, 800))
        padding_ms = int(sanitize_number(message.get("paddingMs"), 0, 1000, 200))
        merge_gap_ms = int(sanitize_number(message.get("mergeGapMs"), 0, 2000, 300))
        min_keep_ms = int(sanitize_number(message.get("minKeepMs"), 0, 1000, 150))
        attention_ms = int(sanitize_number(message.get("attentionLengthMs"), 500, 60000, 3000))

        ingest_result = validate_input(video_path)
        if not ingest_result.ok:
            return ingest_result

        ingest_duration = float((ingest_result.data or {}).get("duration", 0) or 0)
        total_duration = float(sanitize_number(message.get("totalDuration"), 0, 86400 * 4, 0))
        if total_duration <= 0:
            total_duration = ingest_duration

        pre_silences = message.get("silences")
        if isinstance(pre_silences, list):
            silences = []
            for item in pre_silences:
                if not isinstance(item, dict):
                    continue
                try:
                    silences.append({
                        "start": float(item["start"]),
                        "end": float(item["end"]),
                    })
                except (KeyError, TypeError, ValueError):
                    continue
        else:
            silence_result = detect_silence(
                video_path, silence_threshold_db=silence_db, min_silence_duration_ms=silence_ms
            )
            silences = silence_result.data.get("silences", []) if silence_result.ok and silence_result.data else []

        transcript_result = transcribe(video_path)
        if not transcript_result.ok:
            return transcript_result

        segments = transcript_result.data["segments"] if transcript_result.data else []
        matches_list: list = []
        if graphics:
            match_result = semantic_match(segments, graphics)
            if match_result.ok and match_result.data:
                matches_list = match_result.data["matches"]

        polish_result = build_events(
            segments=segments,
            matches=matches_list,
            silences=silences,
            total_duration=total_duration,
            attention_length_ms=attention_ms,
        )
        events = polish_result.data["events"] if polish_result.ok and polish_result.data else []
        event_counts = polish_result.data.get("event_counts", {}) if polish_result.ok and polish_result.data else {}

        return EngineResult(
            ok=True,
            data={
                "timeline": {
                    "video": ingest_result.data,
                    "segments": segments,
                    "matches": matches_list,
                    "silences": silences,
                    "silenceThresholdMs": silence_ms,
                    "events": events,
                    "eventCounts": event_counts,
                }
            },
        )

    if command == "exportFull":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err
        output_path = message.get("outputPath", "")
        out_err = validate_output_path(output_path)
        if out_err:
            return out_err

        segments = message.get("segments", [])
        matches = message.get("matches", [])
        sfx_pool = message.get("sfxPool", {})
        max_words = int(sanitize_number(message.get("maxWords"), 1, 20, 3))
        silence_db = int(sanitize_number(message.get("silenceThresholdDb"), -60, 0, -40))
        silence_ms = int(sanitize_number(message.get("minSilenceDurationMs"), 100, 5000, 800))
        padding_ms = int(sanitize_number(message.get("paddingMs"), 0, 1000, 200))
        merge_gap_ms = int(sanitize_number(message.get("mergeGapMs"), 0, 2000, 300))
        min_keep_ms = int(sanitize_number(message.get("minKeepMs"), 0, 1000, 150))
        attention_ms = int(sanitize_number(message.get("attentionLengthMs"), 500, 60000, 3000))
        graphic_sec = float(sanitize_number(message.get("graphicDisplaySec"), 0.5, 30.0, 2.0))
        graphic_w_pct = float(sanitize_number(message.get("graphicWidthPercent"), 10.0, 100.0, 85.0))
        graphic_width_frac = graphic_w_pct / 100.0

        silence_result = detect_silence(video_path, silence_threshold_db=silence_db, min_silence_duration_ms=silence_ms)
        total_duration = silence_result.data.get("total_duration", 0) if silence_result.ok and silence_result.data else 0
        silences = silence_result.data.get("silences", []) if silence_result.ok and silence_result.data else []

        keep_segments = _invert_silences(silences, total_duration)
        keep_segments = _pad_segments(keep_segments, padding_ms / 1000.0, total_duration)
        keep_segments = _merge_close_segments(keep_segments, merge_gap_ms / 1000.0)
        keep_segments = _drop_tiny_segments(keep_segments, min_keep_ms / 1000.0)

        if not keep_segments:
            keep_segments = [{"start": 0.0, "end": total_duration}]

        segs = segments if isinstance(segments, list) else []
        mats = matches if isinstance(matches, list) else []
        ev_result = build_events(
            segs,
            mats,
            silences,
            float(total_duration),
            attention_length_ms=attention_ms,
        )
        events = ev_result.data.get("events", []) if ev_result.ok and ev_result.data else []

        result = render_full(
            video_path=video_path,
            output_path=output_path,
            segments=segs,
            matches=mats,
            sfx_pool=sfx_pool if isinstance(sfx_pool, dict) else {},
            keep_segments=keep_segments,
            events=events,
            max_words=max_words,
            graphic_display_sec=graphic_sec,
            graphic_width_frac=graphic_width_frac,
        )
        if result.ok and result.data is not None:
            new_dur = sum(float(s["end"]) - float(s["start"]) for s in keep_segments)
            result.data["original_duration"] = float(total_duration)
            result.data["new_duration"] = round(new_dur, 3)
            result.data["silences_removed"] = len(silences)
        return result

    return EngineResult(ok=False, error=f"Unknown command: {command}")


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            result = EngineResult(ok=False, error=f"Invalid JSON: {exc}")
            sys.stdout.write(json.dumps(result.to_dict()) + "\n")
            sys.stdout.flush()
            continue

        result = handle(message)
        sys.stdout.write(json.dumps(result.to_dict()) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
