# Bob Canonical vs Stale Matrix

Date: 2026-05-26
Owner: GitHub Copilot
Purpose: Distinguish current authority documents from historical or potentially stale guidance so future Bob work starts from reliable truth.

## Authority Rules

1. If two Bob docs conflict, prefer runtime-truth and safe-contract docs first.
2. Prefer files that explicitly define current guardrails, constraints, and source-of-truth behavior.
3. Treat setup snapshots, historical summaries, and generated context dumps as secondary unless validated against current canonical docs.

## Matrix

| Document | Current Status | Why | Action for Future Use |
|---|---|---|---|
| docs/BOB_MASTER_RUNTIME_TRUTH.md | Canonical | Explicitly defines current runtime topology and trust posture | Read first for architecture/runtime decisions |
| docs/BOB_SAFE_RUNTIME_CONTRACT.md | Canonical | Defines permission boundaries, simulation constraints, and approval expectations | Required before any Bob mutation/governance work |
| BOB_INSTRUCTIONS.md | Canonical | Active operating rules for Bob behavior, grounding, and workflow discipline | Treat as mandatory execution contract |
| docs/BOB_MASTER_TRAINING_FRAMEWORK.md | Canonical | Consolidates training and quality expectations for Bob lifecycle work | Use for training and scorecard changes |
| docs/BOB_SYSTEM_ROUTE_MAP.md | Canonical | Route and system mapping reference for Bob surfaces | Use for route-claim verification |
| docs/BOB_RESTRICTION_SHEET.md | Canonical | Explicit restriction and safety controls | Must be checked before high-impact actions |
| docs/BOB_PM_READINESS_GATE_2026-05-18.md | Canonical for PM claims | Defines evidence thresholds for externally-facing Bob capability claims | Required for PM messaging and readiness assertions |
| tools/bob-pm-evidence/latest/bob-pm-evidence.md | Canonical evidence companion | Current evidence pack for PM/readiness claims | Pair with PM readiness gate before claims |
| docs/BOB_TRAINING_TRUTH_PROTOCOL.md | Canonical support | Grounding and truth protocol details | Use as process enforcement reference |
| docs/BOB_WORKFLOW_RULES.md | Mixed/possibly drifted | Overlaps with root BOB_WORKFLOW_RULES.md and may diverge in toolchain/runtime assumptions | Validate against canonical runtime docs before use |
| BOB_WORKFLOW_RULES.md | Mixed/possibly drifted | Overlaps with docs version and may include historical assumptions | Validate against canonical runtime docs before use |
| docs/BOB_PRODUCTION_RAILWAY_SETUP.md | Historical/special-case | Useful for older deployment context but may conflict with newer runtime-truth positioning | Use only when explicitly targeting Railway deployment path |
| BOB_INFERENCE_SECRET_CONFIGURATION.md | Historical/special-case | Secret wiring guidance that may not reflect current canonical topology | Cross-check with runtime truth and env reference first |
| BOBS_COMPLETE_REMEDIATION_SYSTEM.md | Aspirational/historical | Documents a broad autonomous remediation vision, not always current enforced contract | Treat as intent unless corroborated by active workflows/scripts |
| BOBS_REMEDIATION_SYSTEM_LIVE.md | Aspirational/historical | Claims live behavior that may not match current governance constraints | Treat as historical snapshot and validate before adoption |
| docs/BOB_BRAIN_DUMP.md | Generated secondary context | Auto-generated aggregation can duplicate old statements and stale assumptions | Use for broad context only, never as final tie-breaker |
| BOB_SESSION_SUMMARY_20260430.md | Historical | Session-era status summary, not live contract | Use for historical context only |
| BOB_ANALYSIS_SESSION.md | Historical | Point-in-time analysis notes | Use for background context only |
| BOB_JOINT_DIAGNOSIS.md | Historical | Incident/session specific diagnosis | Use for retrospective context only |

## Practical Tie-Break Order

1. docs/BOB_MASTER_RUNTIME_TRUTH.md
2. docs/BOB_SAFE_RUNTIME_CONTRACT.md
3. BOB_INSTRUCTIONS.md
4. docs/BOB_MASTER_TRAINING_FRAMEWORK.md
5. docs/BOB_SYSTEM_ROUTE_MAP.md
6. docs/BOB_RESTRICTION_SHEET.md
7. docs/BOB_PM_READINESS_GATE_2026-05-18.md plus tools/bob-pm-evidence/latest/bob-pm-evidence.md

## Known Drift Themes to Re-Check Per Session

1. Runtime host assumptions (RunPod-first vs Railway-first wording).
2. Package manager and toolchain assumptions (npm-only vs older Bun-oriented notes).
3. Autonomy claims that exceed current approval-gated operational contract.
4. Any capability claims lacking corroborating scripts, tests, or evidence artifacts.
