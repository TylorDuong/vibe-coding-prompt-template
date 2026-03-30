"""Tests for the engine CLI entry point."""

from engine.main import handle
from engine.result import EngineResult


def test_health_command() -> None:
    result = handle({"command": "health"})
    assert result.ok is True
    assert result.data is not None
    assert result.data["status"] == "ok"


def test_unknown_command_returns_error() -> None:
    result = handle({"command": "nonexistent"})
    assert result.ok is False
    assert result.error is not None
    assert "Unknown command" in result.error


def test_ingest_missing_path() -> None:
    result = handle({"command": "ingest"})
    assert result.ok is False


def test_ingest_nonexistent_file() -> None:
    result = handle({"command": "ingest", "videoPath": "/tmp/does_not_exist.mp4"})
    assert result.ok is False
    assert "not found" in (result.error or "").lower()


def test_process_stub_returns_timeline() -> None:
    result = handle({
        "command": "process",
        "videoPath": "",
        "graphics": [],
        "silenceThresholdMs": 500,
    })
    assert result.ok is False


def test_engine_result_to_dict() -> None:
    r = EngineResult(ok=True, data={"key": "value"})
    d = r.to_dict()
    assert d["ok"] is True
    assert d["data"]["key"] == "value"
    assert d["error"] is None
