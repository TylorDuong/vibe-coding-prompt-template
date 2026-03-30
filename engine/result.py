from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any


@dataclass
class EngineResult:
    ok: bool
    data: dict[str, Any] | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
