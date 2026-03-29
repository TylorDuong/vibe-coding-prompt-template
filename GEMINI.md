# GEMINI.md — Gemini CLI / Agent-First IDE Configuration for Splitty AI

## Project Context
**App:** Splitty AI  
**Stack:** Electron + React + TypeScript + Tailwind + local Python engine (`ffmpeg-python`, `faster-whisper`, `sentence-transformers`)  
**Stage:** MVP Development  
**User Level:** B (Developer)

## Directives
1. **Master Plan:** Always read `AGENTS.md` first for current phase and constraints.
2. **Documentation:** Use `agent_docs/` for stack details, requirements, patterns, and testing.
3. **Plan-First:** Propose a brief plan and wait for approval before coding.
4. **Incremental Build:** Implement one small feature slice at a time.
5. **Verify:** Run tests/lint/type checks after each feature; fix failures immediately.
6. **Scope Discipline:** Do not add features outside the current phase/MVP.
7. **Concise Communication:** Keep responses short, actionable, and explicit about trade-offs.

## What NOT To Do
- Do NOT delete files without explicit confirmation.
- Do NOT bypass failing tests or hooks.
- Do NOT add cloud dependencies to MVP execution flow.
- Do NOT use `any` when typing TypeScript logic.

## Commands
- `npm run dev` — Start development app flow
- `npm test` — Run frontend tests
- `npm run lint` — Run lint checks
- `npx tsc --noEmit` — Run type checks
- `pytest` — Run Python engine tests
