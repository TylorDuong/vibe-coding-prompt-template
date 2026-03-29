# System Memory & Context 🧠
<!--
AGENTS: Update this file after every major milestone, structural change, or resolved bug.
DO NOT delete historical context if it is still relevant. Compress older completed items.
-->

## 🏗️ Active Phase & Goal
**Current Phase:** Phase 2 — Core Features
**Current Task:** Implement the four must-have MVP features (silence cutting, transcription, semantic matching, polish effects).
**Next Steps:**
1. Implement Smart Ingestion & Silence Cutting (FFmpeg-based dead-air detection and removal).
2. Implement Local Transcription & Auto-Captioning (faster-whisper integration, word-level timestamps).
3. Implement Semantic Graphic Matching (SBERT embeddings + cosine similarity against user graphic tags).
4. Implement Automated Polish (CSS/canvas animations + local SFX triggers).

## 📂 Architectural Decisions
- 2026-03-29 - Chosen architecture: Electron + React UI with local Python child process for AI/media pipeline.
- 2026-03-29 - Chosen local-first strategy: no cloud dependency; all media processing remains on-device.
- 2026-03-29 - Semantic matching approach: transcript chunk embeddings vs user graphic-description embeddings via sentence-transformers.
- 2026-03-29 - Distribution strategy: Electron Builder packages desktop app and engine dependencies.
- 2026-03-29 - Python IPC: JSON-over-stdin/stdout protocol. Sequential request queue in pythonBridge.ts. Upgrade to socket/HTTP if streaming progress is needed later.
- 2026-03-29 - Vite 7 pinned for electron-vite compatibility; @vitejs/plugin-react@4 used.
- 2026-03-29 - Tailwind CSS v4 with @tailwindcss/vite plugin (no config file needed, CSS-only setup).

## 🐛 Known Issues & Quirks
- Tech Design timeline conflict: summary recommends 1-week MVP while referenced roadmap sections extend further; treat 1-week MVP as immediate target.
- Python `requirements.txt` lists heavy deps (faster-whisper, sentence-transformers) but they are not imported by stubs yet — install them before starting Phase 2 feature work.
- `electron-vite` does not support Vite 8 yet; stay on Vite 7 for now.

## 📜 Completed Phases
- [x] Workspace instruction templates instantiated from `templates/`
- [x] Phase 1: Foundation
  - [x] Electron + React + TypeScript + Tailwind scaffold
  - [x] Dark-mode UI shell (header, workspace, sidebar, status bar)
  - [x] Python engine stubs (main.py, transcribe.py, match.py, video.py) + 6 passing tests
  - [x] Electron IPC bridge (pythonBridge.ts + ipcHandlers.ts + preload)
  - [x] Drag-and-drop file ingest with validation via engine
  - [x] End-to-end processing handoff (upload → process → mock timeline result)
