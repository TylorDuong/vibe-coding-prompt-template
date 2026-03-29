# System Memory & Context 🧠
<!--
AGENTS: Update this file after every major milestone, structural change, or resolved bug.
DO NOT delete historical context if it is still relevant. Compress older completed items.
-->

## 🏗️ Active Phase & Goal
**Current Task:** Phase 1 setup for Splitty AI MVP (foundation + local processing pipeline bootstrap)
**Next Steps:**
1. Scaffold Electron + React + TypeScript + Tailwind project structure.
2. Implement Python engine entrypoint and Electron IPC bridge.
3. Deliver first vertical slice: ingest video -> process -> preview/export stub.

## 📂 Architectural Decisions
- 2026-03-29 - Chosen architecture: Electron + React UI with local Python child process for AI/media pipeline.
- 2026-03-29 - Chosen local-first strategy: no cloud dependency; all media processing remains on-device.
- 2026-03-29 - Semantic matching approach: transcript chunk embeddings vs user graphic-description embeddings via sentence-transformers.
- 2026-03-29 - Distribution strategy: Electron Builder packages desktop app and engine dependencies.

## 🐛 Known Issues & Quirks
- No implementation bugs logged yet (setup stage only).
- Tech Design timeline conflict noted: summary recommends 1-week MVP while some referenced roadmap sections extend further; treat 1-week MVP as immediate target.

## 📜 Completed Phases
- [x] Workspace instruction templates instantiated from `templates/`
- [ ] Initial scaffold
- [ ] Database schema creation (if needed later for local metadata)
- [ ] Auth integration (not required for MVP local-first flow)
