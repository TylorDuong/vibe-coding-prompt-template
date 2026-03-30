# Testing Strategy

## Frameworks
- **Unit Tests (Frontend):** Vitest (recommended for React + TypeScript)
- **Unit Tests (Python Engine):** Pytest
- **E2E Tests (Desktop UX):** Playwright (for UI flow and core interactions)

## Rules & Requirements
- **Coverage target:** Aim for at least 80% coverage on core pipeline modules and shared utilities.
- **Before commit:** Run lint + type checks + tests. Do not skip failures.
- **Failure policy:** If a test breaks, fix root cause first; no bypasses without explicit approval.
- **Verification loop:** Run checks after each feature slice (Plan -> Execute -> Verify).

## Manual Checks (MVP Critical)
- Upload a standard MP4/MOV and confirm ingest succeeds.
- Confirm silence cutting removes pauses above configured threshold.
- Confirm local transcription generates timestamped caption data.
- Confirm semantic matching places graphics near relevant transcript segments.
- Confirm animation/SFX triggers align with visual insertions.
- Confirm export produces playable MP4.
- Confirm app remains stable on 60-second sample workload.

## Pre-Commit Hooks
- **Lint:** `npm run lint`
- **Type Check:** `npx tsc --noEmit`
- **Frontend Tests:** `npm test`
- **Engine Tests:** `pytest`

## Execution Commands
- **Run all frontend tests:** `npm test`
- **Run all Python tests:** `pytest`
- **Run one frontend test file:** `npm test -- src/components/UploadZone.test.tsx`
- **Run one Python test file:** `pytest engine/tests/test_transcribe.py -q`
