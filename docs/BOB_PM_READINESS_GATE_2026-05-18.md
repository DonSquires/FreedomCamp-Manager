# Bob PM Readiness Gate

Date: 2026-05-18
Owner: Product + ML + LLM joint review
Status: Active

## Purpose

This gate translates Bob quality and labeling evidence into a form that can survive product-manager scrutiny.

The question it answers is simple: can we show PM what Bob does, what it is grounded on, what remains human-reviewed, and what still needs work without overclaiming?

## PM Gate Criteria

Bob is ready to present for a capability only when all required checks below pass.

| Area | Required evidence | Pass condition |
|---|---|---|
| Capability scope | Instruction manual + runtime contract | Capability exists in product docs and repo behavior, with no invented surface area |
| Dataset grounding | `docs/BOB_DATASET_MANIFEST_2026-05-18.md` | A manifest entry exists for the capability and names its actual labels |
| Label taxonomy | `docs/BOB_DATA_LABELING_RUNBOOK_2026-05-18.md` | Observable labels, unknown states, and review workflow are defined |
| Evaluation evidence | Quality baseline artifacts or dataset-eval evidence | Latest evidence is current enough for the stated claim |
| Human boundary | Instruction manual + runbook | Human-review-only and approval-gated boundaries are explicit |
| Drift/freshness | `docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md` | Freshness window is satisfied or waiver is documented |
| Open gaps | This gate doc + staging log | Risks and blockers are explicitly disclosed, not hidden |

## Capability Review Table

| Capability | Current evidence | PM posture |
|---|---|---|
| Smoke recommendation quality | Labeled eval corpus exists in `data/smoke-ablation-evals.jsonl`; sampling packet exists in `tools/bob-pm-evidence/latest/smoke-reviewer-sampling-packet.md` | Present as evidence-backed assistive recommendation capability; note reviewer sign-off is pending |
| ALPR sticker / movement inference | Runtime contract and storage mapping exist; local image inventory exists in `tools/bob-pm-evidence/latest/alpr-local-image-inventory.md` | Present as contract-defined inference pipeline with local reference assets and manual-review dependency |
| Face matching / POI review | Migration-backed review surface exists; adjudication packet exists in `tools/bob-pm-evidence/latest/face-review-adjudication-packet.md`; human-confirmation boundary required | Present narrowly as human-reviewed matching workflow, not autonomous identity resolution |

## Non-Negotiable PM Rules

1. Do not describe contract definitions as if they were validated datasets.
2. Do not describe assistive recommendations as autonomous enforcement.
3. Do not hide `unknown`, `inconclusive`, or manual-review states.
4. Do not claim calibration or freshness unless the supporting artifact is current.
5. Do not broaden a capability beyond what the repo can prove today.

## Current Pass/Fail Snapshot

### Pass

1. Smoke-control evaluation has a real labeled corpus in-repo.
2. ALPR inference outputs and sticker/movement fields are concretely documented, and a local reference inventory is attached.
3. Face-matching surface is bounded by manual review and policy sensitivity, and an adjudication packet is attached.
4. Quality baseline already defines freshness, drift, and promotion expectations.

### Fails or partials

1. ALPR production observation corpus is not yet stored in the repository; attached inventory is local-reference-only.
2. Face-review redacted adjudicated case samples are not yet attached as a dataset artifact.
3. Independent reviewer sign-off is not yet logged for the smoke evaluation corpus, even though the sampling packet is attached.

## Evidence Packet

Repeatable evidence generation:

1. Run `npm run bob:evidence:pm` to generate the latest PM evidence packet.
2. Run `npm run bob:evidence:pm:strict` to enforce required evidence artifacts and freshness.
3. Review the generated artifacts in `tools/bob-pm-evidence/latest/`.
4. Use that packet during PM review so claims match the repo's current evidence.

Redacted sample-set format for next-step corpus attachment:

1. `tools/bob-pm-evidence/redacted-format/alpr-redacted-sample.schema.json`
2. `tools/bob-pm-evidence/redacted-format/alpr-redacted-sample-template.json`
3. `tools/bob-pm-evidence/redacted-format/face-review-redacted-sample.schema.json`
4. `tools/bob-pm-evidence/redacted-format/face-review-redacted-sample-template.json`

## PM Demo Script Guidance

Use this order when presenting Bob:

1. Start with capability boundaries and human approval rules.
2. Show the exact dataset or contract evidence behind each claim.
3. Show evaluation evidence or say explicitly that the capability is contract-defined but still human-reviewed.
4. Close with the current gaps and the next remediation step.

## Exit Condition

This gate is considered improved when each Bob capability shown to PM can be traced in one hop to:

1. Product/manual authority
2. Label taxonomy
3. Dataset manifest entry
4. Evaluation artifact or explicit manual-review caveat