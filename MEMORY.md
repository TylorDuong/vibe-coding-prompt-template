# System Memory & Context 🧠
<!--
AGENTS: Update this file after every major milestone, structural change, or resolved bug.
DO NOT delete historical context if it is still relevant. Compress older completed items.
-->

## 🏗️ Active Phase & Goal
**Current Phase:** Phase 3 — Quality & UX
**Current Task:** Polish the user experience and harden error handling.
**Next Steps:**
1. Add real-time progress indicators (transcribing... matching... rendering...).
2. Build timeline preview/adjustment UX.
3. Harden error handling across all pipeline stages.
4. Mobile/responsive viewport tuning (desktop-first but test smaller monitors).

## 📂 Architectural Decisions
- 2026-03-29 - Chosen architecture: Electron + React UI with local Python child process for AI/media pipeline.
- 2026-03-29 - Chosen local-first strategy: no cloud dependency; all media processing remains on-device.
- 2026-03-29 - Semantic matching: SBERT all-MiniLM-L6-v2, sliding window chunking (window_size=3), cosine similarity.
- 2026-03-29 - Distribution strategy: Electron Builder packages desktop app and engine dependencies.
- 2026-03-29 - Python IPC: JSON-over-stdin/stdout protocol. Sequential request queue in pythonBridge.ts.
- 2026-03-29 - Vite 7 pinned for electron-vite compatibility; @vitejs/plugin-react@4 used.
- 2026-03-29 - Tailwind CSS v4 with @tailwindcss/vite plugin.
- 2026-03-29 - Silence detection: FFmpeg silencedetect filter → invert intervals → concat demuxer for cutting.
- 2026-03-29 - Transcription: faster-whisper base model, CPU int8 compute, word-level timestamps.
- 2026-03-29 - Polish engine: attention_length state machine (3000ms default), random SFX from local pool.
- 2026-03-29 - SFX assets: synthetic WAV files generated via FFmpeg lavfi (pop, whoosh, chime).

## 🐛 Known Issues & Quirks
- CUDA not available to Python (torch installed CPU-only). GPU acceleration requires reinstalling torch with CUDA. Functional on CPU.
- HuggingFace cache symlink warning on Windows (cosmetic, no impact on functionality).
- `electron-vite` does not support Vite 8 yet; stay on Vite 7.
- Processing a 1-minute video with all 4 pipeline stages takes ~30-60s on CPU (within PRD target of <5x).

## 📜 Completed Phases
- [x] Workspace instruction templates instantiated from `templates/`
- [x] Phase 1: Foundation
  - Electron + React + TypeScript + Tailwind scaffold, dark-mode UI, IPC bridge, drag-drop ingest
- [x] Phase 2: Core Features (24 passing tests)
  - [x] Smart Ingestion & Silence Cutting (FFmpeg silencedetect + concat)
  - [x] Local Transcription & Auto-Captioning (faster-whisper base, word timestamps)
  - [x] Semantic Graphic Matching (SBERT all-MiniLM-L6-v2, cosine similarity)
  - [x] Automated Polish (attention_length SFX injection, local WAV assets)
  - [x] Full pipeline wired: process command runs all 4 stages end-to-end
  - [x] Graphics sidebar with drag-drop images + tag input
  - [x] Timeline preview with color-coded event types
