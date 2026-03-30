# Tech Stack & Tools

- **Frontend:** Electron + React + TypeScript + Tailwind CSS
- **Backend/Engine:** Local Python process spawned by Electron
- **Media Processing:** `ffmpeg-python` (FFmpeg orchestration)
- **Transcription:** `faster-whisper` (local GPU-accelerated ASR)
- **Semantic Matching:** `sentence-transformers` (SBERT-style embeddings + cosine similarity)
- **Distribution:** Electron Builder (`.exe` packaging)
- **AI Workflow Tools:** Cursor (primary IDE), Gemini CLI / agent-first IDE workflows for implementation support

## Setup Commands
```bash
# JavaScript/Electron side
npm install
npm run dev
npm run build

# Python engine side
python -m venv .venv
# Windows PowerShell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python engine/main.py
```

## Project Structure (From Tech Design)
```text
splitty-ai/
├── main/                 # Electron main process (Node.js)
│   ├── main.ts           # App window creation
│   └── ipcHandlers.ts    # Bridge between UI and Python
├── src/                  # React Frontend
│   ├── components/       # UI (UploadZone, Timeline, Config)
│   ├── App.tsx
│   └── index.css         # Tailwind
├── engine/               # Python Backend
│   ├── main.py           # CLI entry point or API server
│   ├── transcribe.py     # Whisper logic
│   ├── match.py          # SBERT logic
│   └── video.py          # FFmpeg logic
├── package.json
└── requirements.txt
```

## Error Handling Pattern
```python
# Canonical engine error handling pattern:
# - Validate inputs at module boundaries
# - Return structured errors to Electron IPC
# - Keep FFmpeg/ML failures actionable

from dataclasses import dataclass
from typing import Any, Dict

@dataclass
class EngineResult:
    ok: bool
    data: Dict[str, Any] | None = None
    error: str | None = None

def run_pipeline(video_path: str) -> EngineResult:
    try:
        if not video_path:
            return EngineResult(ok=False, error="Missing video_path")
        # pipeline steps...
        return EngineResult(ok=True, data={"status": "processed"})
    except FileNotFoundError:
        return EngineResult(ok=False, error="Input video not found")
    except Exception as exc:
        return EngineResult(ok=False, error=f"Unhandled engine error: {exc}")
```

## Naming Conventions
- **React components:** PascalCase (`UploadZone.tsx`)
- **TypeScript utilities/hooks:** camelCase (`useTimelineState.ts`)
- **Python modules:** snake_case (`transcribe.py`, `video_pipeline.py`)
- **IPC channels:** namespaced strings (`engine:processVideo`, `engine:getStatus`)
- **Data contracts:** explicit typed interfaces on TS side and typed dataclasses/models on Python side
