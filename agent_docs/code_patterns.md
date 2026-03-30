# Code Patterns

## Architectural Pattern
- **UI Layer (`src/`, `main/`):** Handles views, user interactions, and IPC invocation only.
- **Engine Layer (`engine/`):** Owns transcription, semantic matching, FFmpeg orchestration, and processing policies.
- **Contract Layer:** Typed payload contracts between Electron and Python; keep these explicit and versionable.

## Folder & File Patterns
- React features grouped by domain (`components/Upload`, `components/Timeline`, etc.).
- Python modules grouped by pipeline concern (`transcribe.py`, `match.py`, `video.py`).
- Tests colocated by layer (`src/**/*.test.tsx`, `engine/tests/test_*.py`).

## Type & Validation Pattern (TypeScript)
```ts
type ProcessVideoRequest = {
  videoPath: string;
  graphics: Array<{ filePath: string; tag: string }>;
  silenceThresholdMs: number;
};

function isProcessVideoRequest(value: unknown): value is ProcessVideoRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.videoPath === "string" && typeof v.silenceThresholdMs === "number";
}
```

## IPC Pattern (Renderer -> Main -> Python)
```ts
// Renderer
const result = await window.electron.invoke("engine:processVideo", payload);

// Main process (conceptual)
ipcMain.handle("engine:processVideo", async (_event, payload) => {
  // validate payload, call python process, return structured result
});
```

## Python Pipeline Pattern
```python
def process_video(video_path: str, graphics: list[dict], silence_ms: int) -> dict:
    transcript = transcribe(video_path)
    chunks = chunk_transcript(transcript)
    matches = semantic_match(chunks, graphics)
    timeline = build_timeline(video_path, transcript, matches, silence_ms)
    return render_video(timeline)
```

## Error Handling Rules
- Return structured errors from engine (`code`, `message`, `details`).
- Show actionable UI messages (input error vs processing failure).
- Capture and log FFmpeg stderr for debugging; avoid swallowing exceptions.

## Naming Rules
- **Components/Types:** PascalCase
- **Variables/Functions:** camelCase (TS), snake_case (Python)
- **Constants:** UPPER_SNAKE_CASE
- **IPC Channels:** `domain:action` format (`engine:getStatus`)
