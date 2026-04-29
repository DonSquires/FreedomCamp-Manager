# Decisions

This file is the historical memory for Bob and Dr Bob.

When a pattern, platform, or architectural decision changes, append a dated note here before asking Bob to extend that area.

## Decision Entry Template

- Date: YYYY-MM-DD
- Decision: one sentence
- Scope: files, services, or modules affected
- Reason: why the decision was made
- Consequences: follow-on constraints Bob must respect

## Current Standing Decisions

- Date: 2026-04-28
- Decision: Bob must run a Change Intent Validation Gate before editing code.
- Scope: all bug fixes, test updates, route changes, and feature work.
- Reason: prevent logical mismatches between route intent, rendered component, role access, expected outcome, and follow-on user flow.
- Consequences: each change must verify: (1) should this item exist here, (2) how it should work, (3) expected visible result, (4) where it goes next, and (5) next behavior on success and failure.

- Date: 2026-04-23
- Decision: Bob must read `system_state.json` before making redesign or new-module claims.
- Scope: architecture advice, `/chat`, `/code/task`, Dr Bob review, truth broadcaster.
- Reason: prevent hallucinated modules, package-manager drift, and ungrounded implementation plans.
- Consequences: any invented module path or ungrounded feature reference is a blocker and scores `0/10` in response logs.

- Date: 2026-04-23
- Decision: Major redesigns follow `spec.md` then self-critique then `plan.md` before implementation.
- Scope: Bob planning, Dr Bob review, architecture prompts, future CI review gates.
- Reason: force grounded design before code generation.
- Consequences: `scripts/review-architecture-artifacts.mjs` should run before implementation claims on major work.
