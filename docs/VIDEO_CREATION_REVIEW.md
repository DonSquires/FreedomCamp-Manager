# Bob Video Creation Review

## Current State

Implemented now:
- Speech and voice synthesis pipelines are operational.
- Vision analysis hooks exist for image-oriented workflows.
- UI patterns for Bob media actions and exports exist.

Not fully implemented:
- End-to-end video generation API and encoding pipeline.
- Video-specific schema and RLS coverage.
- Video consent and revocation governance.
- Full E2E validation for video creation lifecycle.

## Blockers

1. No production video generation endpoint contract.
2. No dedicated video artifact schema with org-scoped RLS.
3. No approved video consent ADR and policy baseline.
4. No completion-tested flow for generate -> store -> retrieve -> revoke.

## Completion Plan

1. Governance
- Approve ADR 010 and policy controls.

2. Data Layer
- Apply video generation foundation migration.
- Add RLS and indexes.

3. API Layer
- Add generation/revocation/audit endpoints.
- Enforce role + org + purpose checks.

4. UI Layer
- Add admin video generation workflow and audit views.

5. Validation
- Add unit and E2E coverage for all lifecycle actions.

## Definition of Done

Video creation is considered production-ready when:
- authorized org-scoped generation succeeds
- unauthorized access is denied
- audit trail includes source/output hash + model metadata
- revocation works and retention controls are enforced
- lint/build/test gates pass on main
