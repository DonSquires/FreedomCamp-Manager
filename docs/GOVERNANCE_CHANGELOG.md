# Governance Change Log

Use this file to record governance wording, approval-flow, and route-contract updates in a lightweight changelog format.

## 2026-05-18

- Governance wording updates were aligned across the instruction manual, Bob Gatekeeper Playbook, and release-note template.
- Source files updated in this changeset:
  - [docs/INSTRUCTION_MANUAL.md](docs/INSTRUCTION_MANUAL.md)
  - [docs/BOB_GATEKEEPER_PLAYBOOK_2026-05-18.md](docs/BOB_GATEKEEPER_PLAYBOOK_2026-05-18.md)
  - [docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md](docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md)
  - [docs/BOB_SECURITY_GOVERNANCE_AUDIT_2026-05-18.md](docs/BOB_SECURITY_GOVERNANCE_AUDIT_2026-05-18.md)
  - [docs/BOB_RETENTION_POLICY_2026-05-18.md](docs/BOB_RETENTION_POLICY_2026-05-18.md)

- Bob decision-log and approval-artifact retention now has an explicit 7-year policy with hold and archive rules.
- Source files updated in this changeset:
  - [docs/BOB_RETENTION_POLICY_2026-05-18.md](docs/BOB_RETENTION_POLICY_2026-05-18.md)
  - [docs/DECISIONS.md](docs/DECISIONS.md)
  - [supabase/migrations/20260710000004_phase_d1_bob_approval_contracts.sql](supabase/migrations/20260710000004_phase_d1_bob_approval_contracts.sql)

## 2026-05-21

- Cleaned working-tree noise before PR #736 merge prep by removing generated local artifacts and reverting unrelated JSX text-escape churn.
- Hardened CI/E2E auth bootstrap to reduce false negatives when Playwright credentials exist but account state drifts.
- Added explicit Node-side WebSocket transport dependency for Supabase realtime usage in CI runners without global `WebSocket` support.
- Source files updated in this changeset:
  - [tests/e2e/auth.ts](tests/e2e/auth.ts)
  - [src/pages/RosterPlanner.tsx](src/pages/RosterPlanner.tsx)
  - [package.json](package.json)
  - [package-lock.json](package-lock.json)
