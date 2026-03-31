# System Memory & Context 🧠
<!--
AGENTS: Update this file after every major milestone, structural change, or resolved bug.
DO NOT delete historical context if it is still relevant. Compress older completed items.
-->

## 🏗️ Active Phase & Goal
**Current Phase:** MVP Complete — Post-overlay enhancement pass: caption/graphic styling, timeline src/out times, SFX throttle + per-slot volume, optional face-zoom pulses (`zoompan` + `in_time`), graphic alpha fade, export FFmpeg progress, timeline scrubber + video preview, caption live preview; filler-word stripping removed.
**Status:** Ready for production use; validate new export options with real footage (especially face zoom + FFmpeg drawtext alpha on your installed FFmpeg build).

## 📂 Architectural Decisions
- Electron + React + TypeScript + Tailwind v4 frontend
- Local Python engine via JSON-over-stdin/stdout IPC
- FFmpeg silencedetect + concat demuxer for silence cutting + export
- faster-whisper base model, CPU int8, word-level timestamps
- SBERT all-MiniLM-L6-v2 with sliding window chunking for semantic matching
- attention_length state machine (3000ms default) for SFX injection
- Synthetic WAV SFX assets via FFmpeg lavfi
- Multi-stage pipeline hook with progress reporting
- Python bridge auto-restart (3 attempts), 120s timeout
- Electron Builder with engine files in extraResources
- Vite 7 pinned (electron-vite compat); code signing disabled for MVP
- Native file dialogs (open video, open images, save export) via Electron dialog API
- Input validation: IPC-level (type/path/range checks) + engine-level (absolute paths, extension allowlists, path length limits)

## 🐛 Known Issues & Quirks
- CUDA not available (torch CPU-only); GPU requires reinstalling torch with CUDA
- Windows Developer Mode needed for code-signed builds
- Stay on Vite 7 for electron-vite compatibility
- Drag-and-drop file.path may fail on some Windows configs; use "Choose File" button instead

## 📜 Completed Phases
- [x] Phase 1: Foundation (Electron scaffold, IPC bridge, drag-drop ingest)
- [x] Phase 2: Core Features — 24 tests
- [x] Phase 3: Quality & UX — progress, timeline bar, error hardening
- [x] Phase 4: Launch — packaging, integration tests (30 total), README, checklist
- [x] Launch Checklist: icon, security audit, IPC validation, path validation, export feature
