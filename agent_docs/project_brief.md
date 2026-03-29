# Project Brief (Persistent)

- **Product vision:** Build a fully local, zero-cost desktop video editor that automates retention-focused short-form editing with semantic graphic matching.
- **Target audience:** Startup founders and tech creators producing "edutainment" content with limited time and budget.
- **Primary value proposition:** Replace hours of manual timeline editing with a 5-minute local processing flow while keeping full privacy.

## Core Conventions
- **Architecture:** Electron/React UI orchestrates a Python engine via IPC; keep business logic in engine/services, not UI handlers.
- **Type safety:** Strict TypeScript; avoid `any`.
- **Scope discipline:** Stay inside defined MVP features and active phase tasks.
- **Local-first:** No cloud dependencies in MVP execution path.

## Quality Gates
- Run lint, tests, and type checks before marking tasks complete.
- Use incremental implementation (one feature slice at a time).
- Update `MEMORY.md` for every milestone, notable bug, or architecture change.
- Keep AGENTS/tool config files synchronized as the project evolves.

## Key Commands
- `npm install`
- `npm run dev`
- `npm run test`
- `npm run lint`
- `npm run build`
- `pip install -r requirements.txt`

## Update Cadence
- **After each completed feature:** update `MEMORY.md` and relevant `agent_docs/` pages.
- **After stack/tooling changes:** update `tech_stack.md` and tool config files.
- **Before handoff/review:** confirm checklist in `REVIEW-CHECKLIST.md`.
