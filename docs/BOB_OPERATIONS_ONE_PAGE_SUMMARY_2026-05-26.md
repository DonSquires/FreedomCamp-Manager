# Bob Operations One-Page Summary

Date: 2026-05-26
Owner: GitHub Copilot
Audience: Engineering, PM, operations, and governance reviewers

## What Bob Is in This Repo

Bob is a governed, tenant-aware, approval-bounded operations assistant that supports triage, analysis, workflow assistance, and controlled actuation paths. Bob is not an unconstrained autonomous actor for production-critical changes.

## Current Operating Model (Documented)

1. Runtime shape:
   RunPod inference path plus platform orchestration and persistence layers, with routing and behavior constrained by documented contracts.
2. Safety shape:
   Approval gates, role-aware permissions, and restrictive mutation boundaries for high-impact operations.
3. Tenant shape:
   Organization scoping and isolation are mandatory for reads, writes, and decision flows.
4. Governance shape:
   Capability claims must be evidence-backed and remain explicit about unknown/manual-review states.

## Canonical Docs to Read First

1. docs/BOB_MASTER_RUNTIME_TRUTH.md
2. docs/BOB_SAFE_RUNTIME_CONTRACT.md
3. BOB_INSTRUCTIONS.md
4. docs/BOB_MASTER_TRAINING_FRAMEWORK.md
5. docs/BOB_SYSTEM_ROUTE_MAP.md
6. docs/BOB_RESTRICTION_SHEET.md
7. docs/BOB_PM_READINESS_GATE_2026-05-18.md
8. tools/bob-pm-evidence/latest/bob-pm-evidence.md

## High-Confidence Invariants

1. Grounding first: do not claim modules, routes, runtime status, or capabilities without current evidence.
2. Tenant isolation is strict: cross-org leakage is never acceptable.
3. Approval boundaries are mandatory for impactful actions.
4. Simulation paths must remain explicitly labeled and auditable.
5. PM/commercial statements must map to the readiness gate plus evidence artifacts.

## Known Drift Risks to Watch

1. Runtime drift:
   Older Railway-first guidance may conflict with newer runtime-truth positioning.
2. Toolchain drift:
   Older Bun-centric setup notes may conflict with current npm-oriented operating instructions.
3. Autonomy drift:
   Historical remediation docs may imply broader autonomous behavior than current safe contract allows.
4. Generated context drift:
   Large generated summaries can echo stale statements if treated as authority.

## Working Agreement for Bob-Related Changes

1. Read Tier 1 canonical docs before edits or claims.
2. Validate route/access assumptions against current route map and restrictions.
3. For any architecture-impacting change, update staging and manual/governance documentation in the same change set.
4. Preserve explicit evidence trails for readiness, quality, and remediation outcomes.

## Quick Escalation Signals

Escalate before continuing when any of the following is true:

1. Two canonical docs disagree on runtime topology or safety boundaries.
2. A capability claim cannot be traced to tests, scripts, or evidence artifacts.
3. A change would cross tenant boundaries or bypass approval controls.
4. Deployment instructions conflict with current runtime-truth contract.
