# System Memory & Context 🧠
<!--
AGENTS: Update this file after every major milestone, structural change, or resolved bug.
DO NOT delete historical context if it is still relevant. Compress older completed items.
-->

## 🏗️ Active Phase & Goal
**Current Phase:** MVP Complete — All 4 phases delivered.
**Status:** Ready for first real-world usage with a recorded video.
**Remaining items:** See `LAUNCH-CHECKLIST.md` for pre-launch validation tasks.

## 📂 Architectural Decisions
- Electron + React + TypeScript + Tailwind v4 frontend
- Local Python engine via JSON-over-stdin/stdout IPC
- FFmpeg silencedetect + concat demuxer for silence cutting
- faster-whisper base model, CPU int8, word-level timestamps
- SBERT all-MiniLM-L6-v2 with sliding window chunking for semantic matching
- attention_length state machine (3000ms default) for SFX injection
- Synthetic WAV SFX assets via FFmpeg lavfi
- Multi-stage pipeline hook with progress reporting
- Python bridge auto-restart (3 attempts), 120s timeout
- Electron Builder with engine files in extraResources
- Vite 7 pinned (electron-vite compat); code signing disabled for MVP

## 🐛 Known Issues & Quirks
- CUDA not available (torch CPU-only); GPU requires reinstalling torch with CUDA
- Windows Developer Mode needed for code-signed builds (symlink issue in winCodeSign)
- Stay on Vite 7 for electron-vite compatibility
- Pure tone audio produces hallucinated Whisper output (expected; real speech works correctly)

## 📜 Completed Phases
- [x] Phase 1: Foundation (Electron scaffold, IPC bridge, drag-drop ingest)
- [x] Phase 2: Core Features — 24 tests
  - Silence cutting, transcription, semantic matching, automated polish
- [x] Phase 3: Quality & UX
  - Progress indicators, visual timeline bar, config controls, error hardening
- [x] Phase 4: Launch — 30 total tests
  - Electron Builder packaging, integration tests, README, launch checklist
