"""Engine CLI — JSON-over-stdin/stdout protocol for Electron IPC bridge.

Reads one JSON object per line from stdin, dispatches to the appropriate
module, and writes one JSON response per line to stdout.

Protocol:
  → {"command": "health"}
  ← {"ok": true, "data": {"status": "ok"}}

  → {"command": "ingest", "videoPath": "..."}
  ← {"ok": true, "data": {"filename": "...", ...}}

  → {"command": "process", "videoPath": "...", "graphics": [...], "silenceThresholdMs": 500}
  ← {"ok": true, "data": {"timeline": {...}}}
"""

from __future__ import annotations

import json
import sys

from engine.result import EngineResult
from engine.video import validate_input, detect_silence, cut_silences
from engine.transcribe import transcribe
from engine.match import semantic_match
from engine.polish import build_events


def handle(message: dict) -> EngineResult:
    command = message.get("command")

    if command == "health":
        return EngineResult(ok=True, data={"status": "ok"})

    if command == "ingest":
        return validate_input(message.get("videoPath", ""))

    if command == "detectSilence":
        return detect_silence(
            message.get("videoPath", ""),
            silence_threshold_db=message.get("silenceThresholdDb", -30),
            min_silence_duration_ms=message.get("minSilenceDurationMs", 500),
        )

    if command == "cutSilences":
        return cut_silences(
            message.get("videoPath", ""),
            output_path=message.get("outputPath"),
            silence_threshold_db=message.get("silenceThresholdDb", -30),
            min_silence_duration_ms=message.get("minSilenceDurationMs", 500),
        )

    if command == "process":
        video_path = message.get("videoPath", "")
        graphics = message.get("graphics", [])
        silence_ms = message.get("silenceThresholdMs", 500)

        ingest_result = validate_input(video_path)
        if not ingest_result.ok:
            return ingest_result

        total_duration = (ingest_result.data or {}).get("duration", 0) or 0

        silence_result = detect_silence(video_path, min_silence_duration_ms=silence_ms)
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
            attention_length_ms=3000,
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
