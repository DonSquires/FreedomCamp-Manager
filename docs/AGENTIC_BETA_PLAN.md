# Agentic Beta Plan

**Branch**: `fix/human-emulator-org-create-signal`
**PR**: #797
**Focus**: pre-beta transport hardening for dispatch, welfare, messaging, org isolation, and readiness gates.

## Objectives

1. Keep staging readiness green with npm-only workflows.
2. Validate the dispatch create flow, patrol navigation, and monitor visibility after recent hardening.
3. Preserve tenant isolation by treating cross-org reads as hard failures in strict mode.
4. Track readiness evidence in generated artifacts rather than ad hoc notes.
5. Treat translation as always available, anywhere, with the same operational availability expectation as PTT.

## Current State

1. Staging wiring is healthy after regenerating [docs/BOB_BRAIN_DUMP.md](BOB_BRAIN_DUMP.md).
2. Targeted pre-beta regressions exposed a remaining dispatch-create behavior gap.
3. Org-isolation checks now support strict enforcement via `PLAYWRIGHT_STRICT_ORG_ISOLATION=1`.
4. Translation should not be roster-restricted or context-restricted; it must remain accessible any time and in any place where PTT is available.

## Planned Regression Order

1. `npm run build`
2. `npm run lint`
3. Focused Playwright regression for dispatch create and monitor flow.
4. Org isolation API proof with strict mode enabled.
5. Welfare consistency and messaging sync smoke coverage.
6. Bob operational readiness gate and staging check rerun.

## Exit Criteria

1. No failing pre-beta regressions on dispatch, welfare, messaging, or navigation.
2. No unapproved tenant-isolation bleed in strict mode.
3. Staging readiness and Bob operational gates remain green.
4. Changes are captured in the generated evidence files and PR notes.