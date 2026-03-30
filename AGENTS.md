# AGENTS.md — Master Plan for Splitty AI

## Project Overview & Stack
**App:** Splitty AI  
**Overview:** Splitty AI is a local-first, open-source desktop app that automates short-form video editing (silence cutting, captioning, semantic graphic timing, and polish effects) for startup founders and tech creators who need high-output content without cloud subscriptions.  
**Stack:** Electron + React + TypeScript + Tailwind CSS (frontend), local Python engine (ffmpeg-python, faster-whisper, sentence-transformers), Electron Builder (distribution).  
**Critical Constraints:** 100% local execution, $0 budget for infrastructure/APIs, open-source commercially viable libraries, desktop-first UX, and processing targets suitable for standard consumer hardware.

## How I Should Think
1. **Understand Intent First**: Before answering, identify what the user actually needs.
2. **Ask If Unsure**: If critical information is missing, ask before proceeding.
3. **Plan Before Coding**: Propose a plan, ask for approval, then implement.
4. **Verify After Changes**: Run tests/linters or manual checks after each change.
5. **Explain Trade-offs**: When recommending something, mention alternatives.

## Plan -> Execute -> Verify
1. **Plan:** Outline a brief approach and ask for approval before coding.
2. **Execute:** Implement one feature at a time in small, reviewable changes.
3. **Verify:** Run tests/lints/manual checks after each feature and fix failures before moving on.

## Setup & Commands
Use these baseline commands unless the repository scripts evolve:
- **Setup:** `npm install` and `pip install -r requirements.txt`
- **Development:** `npm run dev` (Electron + React), `python engine/main.py` (engine path/testing)
- **Testing:** `npm test`
- **Linting & Formatting:** `npm run lint`
- **Build:** `npm run build`

## Context Files (Progressive Disclosure)
Load only what is needed for the current task:
- `MEMORY.md` — Active phase, decisions, and known issues
- `REVIEW-CHECKLIST.md` — Verification gates before marking complete
- `agent_docs/tech_stack.md` — Stack details and setup
- `agent_docs/code_patterns.md` — Naming, architecture, and implementation patterns
- `agent_docs/project_brief.md` — Persistent conventions and quality gates
- `agent_docs/product_requirements.md` — MVP scope, stories, and constraints
- `agent_docs/testing.md` — Test strategy and command expectations
- `agent_docs/resources.md` — Advanced references for implementation depth

## Protected Areas
Do NOT modify these areas without explicit human approval:
- **Infrastructure:** `infrastructure/`, Dockerfiles, and deployment workflows (`.github/workflows/`)
- **Database Migrations:** Existing migration files
- **Third-Party Integrations:** Auth/payment/credentialed integrations

## Coding Conventions
- **TypeScript Strictness:** Use strict typing. `any` is forbidden; use `unknown` and type guards.
- **Architecture Boundaries:** Routes/controllers handle request/response only; business logic belongs in `services/` or `core/`.
- **Dependency Discipline:** Check existing dependencies before adding new ones; prefer native APIs where practical.
- **Incremental Work:** Refactor over rewrite; preserve existing behavior unless explicitly changing it.
- **Testing Expectation:** Add/update tests for new logic, and keep verification green.

## What NOT To Do
- Do NOT delete files without explicit confirmation.
- Do NOT modify database schemas without a backup/migration plan.
- Do NOT add features not in the active phase.
- Do NOT skip tests for "simple" changes.
- Do NOT bypass failing hooks/tests to force completion.
- Do NOT use deprecated libraries or patterns.

## Engineering Constraints (Developer Mode)
### Type Safety (No Compromises)
- `any` type is forbidden.
- All function parameters and returns must be typed.
- Use runtime validation where boundary inputs are uncertain.

### Architectural Sovereignty
- Keep UI concerns in React/Electron UI layers.
- Keep media/AI pipeline logic in Python engine modules.
- Keep IPC as a contract layer, not a business-logic container.

### Workflow Discipline
- Verification must pass before task completion.
- Update `MEMORY.md` after major milestones or architecture decisions.
- Keep this file and `agent_docs/` updated as the project scales.

## Current State
**Last Updated:** 2026-03-29  
**Current Phase:** MVP Complete  
**Working On:** All 4 phases done. Ready for first real-world usage.

## Roadmap
### Phase 1: Foundation (COMPLETE)
- [x] Initialize Electron + React + TypeScript + Tailwind scaffold
- [x] Wire Electron IPC to Python engine process
- [x] Validate local file ingest and processing handoff

### Phase 2: Core Features (COMPLETE)
- [x] Smart Ingestion & Silence Cutting
- [x] Local Transcription & Auto-Captioning
- [x] Semantic Graphic Matching
- [x] Automated Polish (Animations & SFX)

### Phase 3: Quality & UX (COMPLETE)
- [x] Progress indicators for transcription/matching/rendering
- [x] Preview and timeline adjustment UX
- [x] Error handling hardening and stability tuning

### Phase 4: Launch (COMPLETE)
- [x] Package desktop build with Electron Builder
- [x] Validate with integration tests (30 passing)
- [x] Prepare launch checklist and README
