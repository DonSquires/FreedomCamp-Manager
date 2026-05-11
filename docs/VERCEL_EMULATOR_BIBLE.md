# Vercel Emulator Bible

## Purpose

This document is the operating doctrine for Vercel-emulated and human-style browser testing in this repository.

Core principle:
- The test acts like a real user.
- If it fails, assume a real product issue until evidence proves otherwise.
- Do not classify failures as flaky by default.

This is the gold-standard posture for enterprise UX quality.

## Non-Negotiable Rules

1. Do not change test settings to force green results.
2. Only change environment details required to achieve an active, valid login session.
3. Treat emulator failures as UX-contract failures first, test-harness failures second.
4. Do not remove or weaken assertions without proving the UI contract itself changed intentionally.
5. Always collect evidence before making code changes.

## What "Vercel Emulator" Means Here

In this repo, emulator coverage is delivered through two complementary paths:

1. Agentic shadow-user flows:
- Script: scripts/agentic-ui-shadow-user.mjs
- Packs: login-health, tender-shadow, ptt-zindex, crm-business-crossover, client-portal-isolation, admin, admin-bug-reports
- Output: tools/agentic-ui-reports/.../report.json plus step screenshots

2. Human-style Playwright suites:
- Script: scripts/run-human-module-suite.mjs
- Specs: route/module/UI workflows on chromium and Mobile Chrome
- Auth bootstrap: tests/e2e/global-setup.ts -> tests/e2e/auth.ts

Both paths are designed to mimic user behavior, not unit-level internals.

## Active Login Setup (Only Allowed Settings Work)

Use credential setup to unlock meaningful emulator coverage. Do not alter test logic to bypass auth behavior.

### 1. Provide role credentials (preferred)

The global setup enforces role credential preflight unless shared fallback is explicitly enabled.

Required role users are resolved via tests/e2e/auth.ts and tests/e2e/global-setup.ts.

Recommended local file:
- .env.playwright.local

Minimum practical env set for reliable login-driven suites:
- PLAYWRIGHT_MASTER_EMAIL
- PLAYWRIGHT_MASTER_PASSWORD
- PLAYWRIGHT_ADMIN_ORG1_EMAIL
- PLAYWRIGHT_ADMIN_ORG1_PASSWORD
- PLAYWRIGHT_OFFICER_ORG1_EMAIL
- PLAYWRIGHT_OFFICER_ORG1_PASSWORD

Optional fallback mode (less deterministic across role-matrix scenarios):
- PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=1
- PLAYWRIGHT_SKIP_ROLE_ASSERTIONS=1

### 2. Set the correct base URL

For emulator runs against deployed web:
- PLAYWRIGHT_BASE_URL=https://your-vercel-preview-or-production-url

For local parity checks:
- PLAYWRIGHT_BASE_URL=http://localhost:5173

### 3. Keep server reuse enabled for local runs

The human module runner already defaults this behavior:
- PLAYWRIGHT_REUSE_EXISTING_SERVER=1

This prevents false failures due to local port conflicts.

### 4. Run without modifying test behavior

Agentic packs:
- bun run agentic:ui:all3

Admin and bug reports packs (use for admin/master role validation):
- bun scripts/agentic-ui-shadow-user.mjs --pack=admin --no-planner --evidence-dir=tools/agentic-ui-reports/admin
- bun scripts/agentic-ui-shadow-user.mjs --pack=admin-bug-reports --no-planner --evidence-dir=tools/agentic-ui-reports/admin-bug-reports

Single pack:
- bun scripts/agentic-ui-shadow-user.mjs --pack=login-health --no-planner --evidence-dir=tools/agentic-ui-reports/login-health

Human module suite:
- bun run test:human:modules

Focused Playwright spec:
- bunx playwright test tests/e2e/ptt-radio-smoke.spec.ts --project=chromium

## Emulator Result Language: How to Read It Correctly

From scripts/agentic-ui-shadow-user.mjs report.json:

- completed
  - Meaning: the planned user flow reached completion.
  - Action: verify assertions still map to intended UX contract.

- blocked_auth
  - Meaning: flow reached login submission but did not leave /login.
  - Usually caused by missing/invalid credentials, not a product route failure.
  - Action: fix credentials first, then re-run before judging feature behavior.

- failed
  - Meaning: a user-visible action could not be completed.
  - Action: treat as product defect candidate and triage immediately.

- failed_launch
  - Meaning: browser runtime could not start.
  - Action: infrastructure/runtime remediation (install browser, set executable path).

- max-steps-reached
  - Meaning: flow never converged, often due to redirects, modal gates, or missing success transition.
  - Action: inspect screenshots + report steps; likely UX flow contract issue.

From scripts/human-test-engine.mjs interpretation:
- blocked_auth is tracked as infra for reliability scoring.
- This does not mean "ignore it"; it means "credentials gate blocked full UX validation".

## Enterprise Triage Doctrine (Do Not Assume the Test Is Wrong)

When a human-style test fails, apply this order:

1. Prove auth and role context are valid.
- If still on /login after submit: credential/identity issue.
- If redirected to portal selection unexpectedly: resolve role path and portal choice.

2. Prove route and required backend context exist.
- Confirm URL transition happened.
- Confirm expected API/edge-function request was made.
- Confirm UI state mutation occurred after response.

3. Treat missing UI state as a real bug until disproven.
- If expected mode, label, button, or workflow state never appears, this is a product contract failure candidate.

4. Only after product checks pass, evaluate test mismatch.
- Selector mismatch is valid only if UX contract intentionally changed and documented.
- Update test to the new contract, not to hide failures.

## Current Session Findings (Ground Truth)

Observed in ptt-radio-smoke:

- Tactical mode assertion passes.
- Delegated Diplomatic mode assertion fails in a human-style scenario.
- Multiplex request can be observed, but Diplomatic mode still does not consistently render.

Interpretation:
- This is not automatically a flaky test.
- It signals a real state-resolution or UX-contract gap in delegated multiplex behavior.
- Next debugging must focus on context derivation and mode state transition, not assertion weakening.

## Evidence-First Workflow

For every emulator failure:

1. Save report artifacts.
- report.json
- per-step screenshots
- Playwright screenshot/video/error-context when available

2. Capture a concise failure statement.
- Expected human-visible behavior
- Actual behavior
- Role/org/session context

3. Classify with one primary label.
- AUTH_GATE
- ROUTE_GUARD
- STATE_RESOLUTION
- UI_RENDER_CONTRACT
- INFRA_RUNTIME

4. Fix product or fixture context.
- Do not skip assertion unless requirement is intentionally removed.

5. Re-run same scenario unchanged.
- Green only counts when identical user path now passes.

## Login and Role Context Pitfalls (Repository-Specific)

1. Shared fallback credentials can collapse role-specific expectations.
- Useful for quick smoke, risky for role-contract validation.

2. Portal selection is part of real user flow for some roles.
- tests/e2e/auth.ts already resolves this; do not bypass silently.

3. Synthetic organization context can be required for deterministic org-scoped behavior.
- Use applySyntheticOrganization fixtures where org identity drives state.

4. If a mode depends on async edge-function context, waiting for request alone is insufficient.
- You must also verify post-response UI state transition.

## Standard Command Set

Credential preflight and module suite:
- bun run test:human:modules

Agentic packs:
- bun run agentic:ui:all3

Admin and bug reports packs (use for admin/master role validation):
- bun scripts/agentic-ui-shadow-user.mjs --pack=admin --no-planner --evidence-dir=tools/agentic-ui-reports/admin
- bun scripts/agentic-ui-shadow-user.mjs --pack=admin-bug-reports --no-planner --evidence-dir=tools/agentic-ui-reports/admin-bug-reports

Single pack with explicit URL:
- PLAYWRIGHT_BASE_URL=https://your-preview-url bun scripts/agentic-ui-shadow-user.mjs --pack=login-health --no-planner --evidence-dir=tools/agentic-ui-reports/login-health

Focused regression:
- bunx playwright test tests/e2e/ptt-radio-smoke.spec.ts --project=chromium

## Definition of Done for Emulator-Based Validation

A scenario is considered truly fixed only when all are true:

1. Login is active and role context is correct.
2. The same human-style scenario passes without loosening expectations.
3. Evidence artifacts confirm the expected user-visible state.
4. No test setting was altered except what was required for valid login/context.
5. The fix is explainable in product terms, not test-only terms.

## Final Reminder

Human-style emulator failures are product feedback.

If the test fails, it is highlighting a real user-facing contract break until proven otherwise.