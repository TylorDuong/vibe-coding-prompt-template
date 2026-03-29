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
from engine.video import validate_input
from engine.transcribe import transcribe
from engine.match import semantic_match


def handle(message: dict) -> EngineResult:
    command = message.get("command")

    if command == "health":
        return EngineResult(ok=True, data={"status": "ok"})

    if command == "ingest":
        return validate_input(message.get("videoPath", ""))

    if command == "process":
        video_path = message.get("videoPath", "")
        graphics = message.get("graphics", [])
        silence_ms = message.get("silenceThresholdMs", 500)

        ingest_result = validate_input(video_path)
        if not ingest_result.ok:
            return ingest_result

        transcript_result = transcribe(video_path)
        if not transcript_result.ok:
            return transcript_result

        segments = transcript_result.data["segments"] if transcript_result.data else []
        match_result = semantic_match(segments, graphics)

        return EngineResult(
            ok=True,
            data={
                "timeline": {
                    "video": ingest_result.data,
                    "segments": segments,
                    "matches": match_result.data["matches"] if match_result.data else [],
                    "silenceThresholdMs": silence_ms,
                    "events": [],
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
