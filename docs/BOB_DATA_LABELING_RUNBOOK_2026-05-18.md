# Bob Data Labeling Runbook

Date: 2026-05-18
Owner: ML Engineer (primary), LLM Engineer (reviewer), PM/Product oversight (acceptance)
Status: Active

## Purpose

This runbook defines how Bob training and evaluation data must be labeled, reviewed, and promoted so operator-visible AI behavior stays grounded in evidence instead of anecdote.

This document applies to three currently verified annotation surfaces in this repository:

1. ALPR and sticker image annotation aligned to `docs/INFERENCE_CONTRACT_V1.md`
2. Smoke-control decision labeling aligned to `data/smoke-ablation-evals.jsonl`
3. Face-record matching review aligned to the POI face-matching migrations and related operational logs

## Labeling Principles

1. Label what the operator or reviewer can actually observe from the source evidence.
2. Separate observable facts from downstream enforcement decisions.
3. Use `unknown`, `inconclusive`, or manual-review states instead of forcing certainty.
4. Preserve org, privacy, and audit boundaries for every dataset slice.
5. Any operator-visible confidence, decision band, or recommendation must be traceable to labeled examples or evaluation artifacts.

## Annotation Surface A: ALPR, Vehicle, and Sticker Images

### Source of truth

- `docs/INFERENCE_CONTRACT_V1.md`
- `supabase/functions/alpr-process/index.ts`

### Required annotation units

| Unit | Type | Required | Notes |
|---|---|---|---|
| `vehicle_bbox` | bbox | Yes | The primary vehicle region in the image |
| `plate_region_bbox` | bbox | When visible | Required for plate-legibility review sets |
| `sticker_presence` | enum | Yes | `present`, `absent`, `inconclusive` |
| `sticker_bbox` | bbox | When `sticker_presence=present` | Null otherwise |
| `sticker_color` | enum | When visible | `blue`, `green`, `unknown` |
| `movement_reference_match` | enum | Optional | `same_vehicle`, `different_vehicle`, `cannot_determine` |
| `manual_review_required` | boolean | Yes | True when image quality or occlusion prevents reliable labeling |

### Bounding-box rules

1. Boxes must be tight to the visible object without clipping visible edges.
2. Do not guess hidden geometry behind occlusion.
3. For multiple vehicles, annotate only the primary evidence vehicle unless the dataset slice is explicitly multi-object.
4. If the plate exists but is unreadable, annotate the visible plate region and set legibility notes separately.
5. If sticker presence is unclear because of glare, angle, or blur, set `sticker_presence=inconclusive` and `manual_review_required=true`.

### ALPR label taxonomy

| Field | Allowed values |
|---|---|
| `sticker_presence` | `present`, `absent`, `inconclusive` |
| `sticker_color` | `blue`, `green`, `unknown` |
| `movement_reference_match` | `same_vehicle`, `different_vehicle`, `cannot_determine` |
| `quality_grade` | `usable`, `degraded`, `reject` |

### ALPR rejection criteria

Reject an image from training or evaluation use when any of the following apply:

1. The primary vehicle cannot be localized with a reliable bounding box.
2. The image is corrupted, duplicated, or rotated enough to invalidate annotation.
3. The source lacks permission or audit lineage.
4. The image contains privacy-sensitive collateral that has not been approved for the dataset purpose.

## Annotation Surface B: Smoke-Control Decision Labels

### Source of truth

- `data/smoke-ablation-evals.jsonl`
- `docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md`

### Observed source fields in current corpus

| Group | Fields |
|---|---|
| Visual smoke severity | `opacity`, `color`, `opacity_score`, `color_toxicity` |
| Duration and continuity | `continuous`, `duration_minutes` |
| Context and spread | `smoke_drifting`, `smoke_affecting_road` |
| Site context | `fire_type`, `is_naive_burn_off`, `is_dubious_burn_off` |
| Harm indicators | `prohibited_materials_suspected`, `odor_offensive`, `sfa_score` |

### Required decision labels

| Field | Allowed values |
|---|---|
| `ground_truth_action` | `no_action`, `verbal_warning`, `abatement_notice`, `infringement_notice`, `prosecution_referral` |
| `ground_truth_excessive` | `true`, `false` |
| `review_status` | `draft`, `reviewed`, `adjudicated` |
| `evidence_quality` | `complete`, `partial`, `weak` |

### Decision-label rules

1. Label the observed scenario, not what the model predicted.
2. `ground_truth_excessive` must reflect the case facts, even if the action label remains low because context mitigates it.
3. Ambiguous cases must be promoted to adjudication rather than silently normalized.
4. If duration or contextual fields are missing, set `evidence_quality=partial` and require reviewer sign-off before the row is used for promotion evidence.

### Adjudication triggers

Escalate a row for adjudication when:

1. Two reviewers disagree on `ground_truth_action`.
2. The action would shift between warning, abatement, or prosecution bands.
3. The example is intended for calibration-threshold review.
4. The example reflects a recent policy or operational change.

## Annotation Surface C: Face-Record and POI Matching Review

### Source of truth

- `supabase/migrations/20260426000001_poi_face_matching.sql`
- `supabase/migrations/20260426000002_poi_face_matching_v2.sql`

### Required review labels

| Field | Allowed values |
|---|---|
| `identity_match` | `match`, `non_match`, `inconclusive` |
| `poi_status` | `poi`, `non_poi`, `unknown` |
| `image_quality` | `usable`, `degraded`, `reject` |
| `duplicate_face_record` | `true`, `false` |
| `manual_escalation_required` | `true`, `false` |

### Face-review rules

1. Never force an identity link from poor-quality imagery.
2. Use `inconclusive` when angle, occlusion, lighting, or crop quality prevents a defensible match.
3. Treat duplicate handling as a separate label from identity certainty.
4. Any law-enforcement-sensitive or watchlist-sensitive outcome requires human confirmation before operational use.

## Review Workflow

1. Annotator creates or updates the example with required labels.
2. Reviewer checks taxonomy compliance, evidence quality, and privacy handling.
3. Adjudicator resolves disagreements for high-impact or ambiguous cases.
4. Dataset steward updates the dataset manifest and freshness date.
5. Only reviewed or adjudicated examples may be cited in promotion evidence.

## Minimum Quality Gates

No dataset slice may be used for PM readiness or model promotion unless all are true:

1. Taxonomy is documented and consistent with runtime fields.
2. At least one reviewer other than the original annotator has sampled the slice.
3. `unknown` and `inconclusive` cases are preserved rather than relabeled away.
4. Dataset source, freshness date, and intended use are recorded in the manifest.
5. Privacy handling and org-scope constraints are documented for the slice.

## Evidence Required For PM Review

For every AI capability presented to PM, provide:

1. The dataset entry from the manifest
2. The applicable taxonomy from this runbook
3. The latest evaluation or canary artifact
4. Any unresolved gaps, waivers, or manual-review dependencies

## Immediate Backlog

1. Add a dedicated image-annotation export spec for ALPR review tooling when the source export path is finalized.
2. Add reviewer sampling targets per dataset slice once production corpus counts are known.
3. Add a disagreement-rate metric once annotation review logging is persisted.