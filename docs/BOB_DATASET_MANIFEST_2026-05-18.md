# Bob Dataset Manifest

Date: 2026-05-18
Owner: ML Engineer
Status: Active

## Purpose

This manifest is the inventory of verified Bob training and evaluation datasets currently grounded in the repository.

Each entry records modality, label surface, source of truth, freshness expectations, and whether the slice is ready to support PM-facing model claims.

## Dataset Inventory

| Dataset key | Path / source | Modality | Primary labels | Intended use | Freshness owner | PM-ready status |
|---|---|---|---|---|---|---|
| `smoke_ablation_evals_v1` | `data/smoke-ablation-evals.jsonl` + `tools/bob-pm-evidence/latest/smoke-reviewer-sampling-packet.md` | Structured tabular / decision-eval | `ground_truth_action`, `ground_truth_excessive` | Smoke recommendation evaluation, confidence calibration review, drift checks | ML Engineer | Sampling packet attached; reviewer sign-off pending |
| `alpr_inference_contract_v1` | `docs/INFERENCE_CONTRACT_V1.md` + `supabase/functions/alpr-process/index.ts` + `tools/bob-pm-evidence/latest/alpr-local-image-inventory.md` | Image annotation contract + local reference inventory | `vehicle_bbox`, `sticker_presence`, `sticker_bbox`, `sticker_color`, `movement_reference_match` | Annotation schema alignment, runtime-contract review, local asset inventory | ML Engineer + Backend Engineer | Local reference inventory attached; production corpus not in-repo |
| `poi_face_matching_review_v1` | `supabase/migrations/20260426000001_poi_face_matching.sql` + `supabase/migrations/20260426000002_poi_face_matching_v2.sql` + `tools/bob-pm-evidence/latest/face-review-adjudication-packet.md` | Face-match review metadata + adjudication packet | `identity_match`, `poi_status`, `image_quality`, `duplicate_face_record` | Human review and face-match adjudication | ML Engineer + Security reviewer | Adjudication packet attached; redacted case samples pending |

## Entry Requirements

Every future dataset entry must include:

1. Dataset key and canonical path or source reference
2. Modality and intended use
3. Label taxonomy reference
4. Review owner
5. Freshness expectation and last verified date
6. PM-ready status with blockers if not ready

## Current Readiness Notes

### `smoke_ablation_evals_v1`

- Strengths:
  - Repository-grounded labeled examples already exist.
  - Clear action and excessive/non-excessive labels support evaluation.
  - Existing baseline policy already expects dataset freshness and calibration review.
- Gaps:
  - No explicit `review_status` field is persisted in the current JSONL rows.
  - Independent reviewer sign-off should be recorded before any high-stakes PM claim.

### `alpr_inference_contract_v1`

- Strengths:
  - Runtime payload contract already documents bbox and sticker outputs.
  - The edge-function enrichment path shows how labels map into stored observation fields.
- Gaps:
  - No dedicated production observation corpus is inventoried in this repository yet.
  - Annotation export format and reviewer sampling volume are not yet defined.

### `poi_face_matching_review_v1`

- Strengths:
  - Policy-sensitive face-review capability is explicitly represented in migrations.
  - The surface is suitable for manual-review-first operation.
- Gaps:
  - No redacted adjudicated case sample set is inventoried in-repo.
  - PM claims must remain narrow until review evidence is attached.

## Promotion Rule

No Bob capability may be described to PM as trained, calibrated, production-ready, or autonomously reliable unless the supporting dataset entry is present here and references a live runbook taxonomy plus current evaluation evidence.