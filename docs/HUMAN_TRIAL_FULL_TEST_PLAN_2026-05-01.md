# Human Trial Full Test Plan (2026-05-01)

## Goal

Ship a repeatable pre-human-trial gate that only passes when:

1. Build and lint pass.
2. Critical API tests pass.
3. High-risk UI and workflow tests pass.
4. Cross-browser sanity passes in a glibc-compatible runtime.
5. Bob training wiring and Bob runtime pathways are verified.
6. Artifacts are produced for human review.

## Ground Truth From This Repo

1. Local build works in current workspace.
2. Local Playwright browser execution on Alpine fails with symbol relocation errors.
3. Current pod fallback is blocked by RunPod supply constraints for attempted GPU types.
4. Existing workflows and scripts already cover most pieces:
   - Build and lint: [ci-build-high-memory.yml](.github/workflows/ci-build-high-memory.yml)
   - Deep cross-browser: [playwright-deep-functional-cross-browser.yml](.github/workflows/playwright-deep-functional-cross-browser.yml)
   - Bob serverless self-test: [ops-bob-self-test.yml](.github/workflows/ops-bob-self-test.yml)
   - Human module sweep script: [run-human-module-suite.mjs](scripts/run-human-module-suite.mjs)
   - Bob UX audit: [bob-human-ux-audit.mjs](scripts/bob-human-ux-audit.mjs)

## External Constraints Incorporated

1. Playwright official Docker guidance confirms glibc-based images and explicitly states Alpine and musl are not supported for Firefox/WebKit.
2. RunPod worker lifecycle includes throttled and supply-constrained states, so pod availability cannot be assumed for release gates.
3. RunPod balance is currently sufficient, but capacity is the blocker, not funds.

## Why The Adjust Link Is Not Part Of The Build Path

Provided link redirects to a marketing attribution target and is not a build, browser runtime, CI, or test orchestration service. It can be used for campaign attribution in mobile growth flows, but it does not improve test execution reliability for this stack.

## Execution Strategy (Will Work With Current Stack)

### Stage 1: Deterministic Build Gate (Required)

Run in CI (Ubuntu runner):

1. bun install --frozen-lockfile
2. bun run lint
3. bun run test:nav-parity
4. bun run build

Pass criteria:

1. Exit code 0 on all steps.
2. Build artifacts generated.

### Stage 2: API And Focused Regression Gate (Required)

Run immediately after Stage 1 in same CI job:

1. bun run test:api
2. bun run test:focused

Pass criteria:

1. API suite passes.
2. Focused Chromium suite passes.

### Stage 3: Module Interaction Coverage (Required)

Run same job, sequentially:

1. bun run test:human:modules

Pass criteria:

1. Module sweep passes.
2. Input and continue interactions are exercised.
3. Logout interaction reaches auth context.

### Stage 4: Cross-Browser Functional Gate (Required)

Run on Ubuntu using existing deep config:

1. bunx playwright test tests/e2e/deep-functional.spec.ts tests/e2e/tender-workspace.spec.ts --config=playwright.deep-lite.config.ts --project=webkit --project="Mobile Safari" --reporter=list

Pass criteria:

1. Deep functional tests pass for both configured projects.
2. Artifacts uploaded for any failures.

### Stage 5: Bob Readiness Gate (Required)

Run after functional coverage:

1. node scripts/verify-bob-training-wiring.mjs --json-only
2. node scripts/bob-capability-gate.mjs --mode serverless --required chat,run_playwright --strict

Optional (non-blocking first rollout):

1. node scripts/bob-human-ux-audit.mjs --scope quick --movements human --max-retries 0

Pass criteria:

1. Training wiring check passes.
2. Serverless Bob capability gate passes.
3. Optional UX audit report generated (can be advisory in phase 1).

## Pod Path Policy

Pod path is fallback, not primary release gate, until capacity stabilizes.

If pod capacity is available:

1. Start or recreate one pod from worker template.
2. Validate health endpoint and run helper route.
3. Use pod for extended long-running packs only.

If pod capacity is unavailable:

1. Do not block release gate on pod creation.
2. Continue with Ubuntu CI gate and serverless Bob checks.
3. Log pod capacity failure as infra incident artifact.

## CI Orchestration Plan

Use one sequential workflow job to avoid cross-session auth invalidation.

Order:

1. Install and browsers.
2. Build gate.
3. API gate.
4. Focused suite.
5. Human modules suite.
6. Deep cross-browser suite.
7. Bob readiness checks.
8. Upload artifacts.

## Human Trial Go/No-Go Rubric

Go when all are true:

1. Stage 1 through Stage 5 required checks pass.
2. No unresolved blocker-level defects in test artifacts.
3. No auth/session instability in sequential run.

No-go when any are true:

1. Build or lint fails.
2. Deep functional cross-browser fails on core workflows.
3. Bob training wiring or required Bob capability fails.
4. Runtime environment fallback hides unresolved production issue.

## First Implementation Tasks

1. Commit and enable unified workflow file added in this branch:
   - [human-trial-release-gate.yml](.github/workflows/human-trial-release-gate.yml)
2. Ensure required repo secrets are present for Playwright and Supabase.
3. Run workflow from GitHub UI (or with a token that has workflow dispatch rights).
4. Review uploaded artifacts and produce trial-readiness summary.

## Operational Risks And Mitigations

1. Risk: GitHub CLI token cannot dispatch workflows.
   - Mitigation: run from GitHub Actions UI or use PAT with workflow scope.
2. Risk: Pod supply constraints.
   - Mitigation: pod is non-blocking fallback; use Ubuntu CI as primary gate.
3. Risk: Flaky auth across concurrent browser jobs.
   - Mitigation: sequential execution in single job, shared fallback credential flags.
4. Risk: Alpine local runner confusion.
   - Mitigation: do not use Alpine as source of truth for browser pass/fail.

## Deliverables For Human Trial Handoff

1. CI run URL and status for unified gate.
2. Build and test artifact bundle.
3. Bob readiness summary.
4. Defect list grouped by blocker, major, minor.
5. Explicit go or no-go decision with reason.
