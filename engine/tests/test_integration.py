"""Full pipeline integration test: ingest → silence → transcribe → match → polish."""

import json
import os
import subprocess
import tempfile

import pytest

from engine.main import handle


@pytest.fixture(scope="module")
def test_video() -> str:
    """Create a 5s video: 1s tone, 2s silence, 2s tone — with video track."""
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()

    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i",
            "sine=frequency=440:duration=1",
            "-f", "lavfi", "-i",
            "anullsrc=r=44100:cl=mono",
            "-f", "lavfi", "-i",
            "sine=frequency=880:duration=2",
            "-f", "lavfi", "-i",
            "color=c=black:s=320x240:d=5:r=25",
            "-filter_complex",
            "[0:a][1:a]concat=n=2:v=0:a=1[mid];"
            "[mid]atrim=0:3[trimmed];"
            "[trimmed][2:a]concat=n=2:v=0:a=1[audio]",
            "-map", "[audio]",
            "-map", "3:v",
            "-c:v", "libx264", "-preset", "ultrafast",
            "-c:a", "aac",
            "-shortest",
            tmp.name,
        ],
        capture_output=True,
        check=True,
    )
    yield tmp.name
    os.unlink(tmp.name)


def test_health() -> None:
    result = handle({"command": "health"})
    assert result.ok is True


def test_ingest(test_video: str) -> None:
    result = handle({"command": "ingest", "videoPath": test_video})
    assert result.ok is True
    assert result.data is not None
    assert result.data["duration"] > 0
    assert result.data["extension"] == ".mp4"


def test_detect_silence(test_video: str) -> None:
    result = handle({
        "command": "detectSilence",
        "videoPath": test_video,
        "silenceThresholdDb": -30,
        "minSilenceDurationMs": 500,
    })
    assert result.ok is True
    assert result.data is not None
    assert result.data["silence_count"] >= 1


def test_full_process_no_graphics(test_video: str) -> None:
    result = handle({
        "command": "process",
        "videoPath": test_video,
        "graphics": [],
        "silenceThresholdMs": 500,
    })
    assert result.ok is True
    assert result.data is not None

    timeline = result.data["timeline"]
    assert "video" in timeline
    assert "segments" in timeline
    assert "silences" in timeline
    assert "events" in timeline
    assert "eventCounts" in timeline

    assert timeline["video"]["duration"] > 0
    assert len(timeline["silences"]) >= 1
    assert len(timeline["events"]) > 0

    event_types = {e["type"] for e in timeline["events"]}
    assert "caption" in event_types or "silence_cut" in event_types


def test_full_process_with_graphics(test_video: str) -> None:
    """Graphics are sent to the engine; matching may or may not find hits
    depending on transcript content (synthetic audio produces hallucinated text).
    The key assertion is that the pipeline completes without error."""
    result = handle({
        "command": "process",
        "videoPath": test_video,
        "graphics": [
            {"filePath": "diagram.png", "tag": "audio frequency tone"},
        ],
        "silenceThresholdMs": 500,
    })
    assert result.ok is True
    timeline = result.data["timeline"]

    assert "matches" in timeline
    assert "events" in timeline
    assert len(timeline["events"]) > 0


def test_full_pipeline_json_roundtrip(test_video: str) -> None:
    """Verify the result is JSON-serializable (as it would be over IPC)."""
    result = handle({
        "command": "process",
        "videoPath": test_video,
        "graphics": [{"filePath": "chart.png", "tag": "sound wave pattern"}],
        "silenceThresholdMs": 500,
    })
    serialized = json.dumps(result.to_dict())
    parsed = json.loads(serialized)
    assert parsed["ok"] is True
    assert len(parsed["data"]["timeline"]["events"]) > 0
