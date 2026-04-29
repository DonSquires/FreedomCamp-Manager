# Human Test Engine

This repository includes a unified human-like test harness at scripts/human-test-engine.mjs.

It composes:

- Functional and visual route checks (Playwright)
- Goal-driven human interaction emulation (agentic UI shadow packs)
- Multimodal probes (chat response, speech synthesis, transcription, image assessment, document extraction)
- External dev service health checks
- Secret presence, alias match, and alignment checks

## Why This Exists

Single-route or single-layer tests miss usability failures. This harness tests what a human does:

- Sees pages and flow structure
- Clicks through realistic paths
- Sends speech and receives speech output
- Submits images and documents through real processing paths
- Detects disorganization, non-human flow breaks, and clarity issues

It also checks secret hygiene before runtime execution:

- Missing required secrets
- Mismatched alias pairs such as BOB_SERVICE_URL vs INFERENCE_SERVICE_URL
- Frontend/backend secret drift such as VITE_SUPABASE_URL vs SUPABASE_URL
- Test-account alignment such as API_TEST_EMAIL vs PLAYWRIGHT_ADMIN_EMAIL

## Prerequisites

Set these env vars in .env/.env.local/.env.playwright.local or runtime injection:

- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- API_TEST_EMAIL
- API_TEST_PASSWORD

Optional but recommended for multimodal depth:

- BOB_SERVICE_URL or INFERENCE_SERVICE_URL or VITE_INFERENCE_SERVICE_URL
- BOB_INFERENCE_API_KEY or INFERENCE_API_KEY

Optional for document probe fallback:

- SUPABASE_SERVICE_ROLE_KEY

Notes:
- The harness accepts Bob/RunPod URL aliases and will normalize local script access from `VITE_INFERENCE_SERVICE_URL` when backend aliases are unset.
- Org context does not have to be pre-seeded for local runs when the test account can authenticate; the harness derives it from `auth.resolve_org` if `BOB_ORG_ID`, `ORG_ID`, and `DEFAULT_ORG_ID` are absent.

## Run

Full run:

```bash
bun run test:human-engine
```

Fast run (skip heavy UI checks):

```bash
node scripts/human-test-engine.mjs --skip-ui true
```

Skip secret alignment only:

```bash
node scripts/human-test-engine.mjs --skip-secret-alignment true
```

API and multimodal only:

```bash
node scripts/human-test-engine.mjs --skip-ui true --skip-external false --skip-multimodal false
```

## Output

Reports are written to tools/human-test-engine/reports/run-id/

- report.json: machine-readable full output
- report.md: human summary with findings and readiness score

Scoring:

- Reliability: pass ratio over pass+fail+infra
- Stability: inverse of fail ratio
- Operational Readiness: weighted score for release confidence

## Profile

Default profile:

- tools/human-test-engine/profiles/default.json

Override profile:

```bash
node scripts/human-test-engine.mjs --profile tools/human-test-engine/profiles/default.json
```

## Bob Agentic Test Orchestrator

For full autonomous Bob-driven validation across workflows, supporting functions,
desktop/mobile emulation modes, and visual suites:

```bash
bun run test:agentic:bob
```

Quick mode (faster, still multi-project + visual):

```bash
bun run test:agentic:bob:quick
```

Batch runs (split long campaigns into resumable chunks):

```bash
bun run test:agentic:bob:core
bun run test:agentic:bob:workflows
bun run test:agentic:bob:visual
bun run test:agentic:bob:human
```

Resume the latest run (skips stages that already passed):

```bash
bun run test:agentic:bob:resume
```

Advanced CLI examples:

```bash
node scripts/bob-agentic-test-orchestrator.mjs --list-batches
node scripts/bob-agentic-test-orchestrator.mjs --batch workflows --from-stage workflow-e2e-all-projects
node scripts/bob-agentic-test-orchestrator.mjs --resume-run <run-id>
```

Notes:

- Uses Bob pre/post assist per stage via `scripts/run-test-with-bob-assist.mjs`.
- Mobile coverage uses Playwright emulation projects (`Mobile Chrome`, `Mobile Safari`).
- Reports are written to `tools/bob-agentic-test-runs/<run-id>/`.

## Bob Collaboration Loop

Recommended daily loop:

1. Run the harness.
2. Feed report.md and report.json into Bob for triage.
3. Bob suggests top 3 fixes by severity and user-friction impact.
4. Re-run harness after fixes.

This gives a practical human-like quality gate for code, UX, speech, listening, images, and documents in one engine.
