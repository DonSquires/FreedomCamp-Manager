# Bob PM Evidence Packet

Generated: 2026-05-18T09:49:54.397Z

## Executive Summary

- Overall PM posture: partial-pass
- Smoke recommendation: evidence-backed-assistive
- ALPR inference: reference-inventory-attached-manual-review
- Face review: human-reviewed-only

## Smoke Evaluation Evidence

- Corpus path: data/smoke-ablation-evals.jsonl
- Records: 14
- Best variant: sfa_only
- Reviewer sampling packet attached: yes
- Independent reviewer sign-off complete: no

### Action distribution

| Action | Count |
|---|---|
| no_action | 3 |
| verbal_warning | 3 |
| abatement_notice | 4 |
| infringement_notice | 3 |
| prosecution_referral | 1 |

### Variant metrics

| Variant | Sample size | Action accuracy | Excessive F1 | Avg confidence | Override rate |
|---|---|---|---|---|---|
| sfa_only | 14 | 1 | 1 | 0.718 | 0 |
| sfa_with_duration | 14 | 1 | 0.8571 | 0.7907 | 0 |
| sfa_contextual | 14 | 1 | 1 | 0.8669 | 0 |

## ALPR Readiness

- Contract path: docs/INFERENCE_CONTRACT_V1.md
- Runtime path: supabase/functions/alpr-process/index.ts
- Corpus inventory attached: yes
- Inventory scope: local-reference-attached
- PM posture: reference-inventory-attached-manual-review

## Face Review Readiness

- Migration anchors: supabase/migrations/20260426000001_poi_face_matching.sql, supabase/migrations/20260426000002_poi_face_matching_v2.sql
- Human adjudication artifact attached: yes
- Adjudicated case sample attached: yes
- PM posture: human-reviewed-only

## Blocking Gaps

1. ALPR production observation corpus is still not checked into the repository; the attached inventory covers local reference assets and UI snapshots only.
2. Smoke reviewer sampling packet is attached, but independent human reviewer sign-off is still pending.
3. Face redacted sample set is attached, but treat it as a starter corpus until more adjudicated examples are added.

## Rules For PM Presentation

1. Present smoke as evidence-backed assistive recommendation quality, not autonomous enforcement.
2. Present ALPR as a contract-defined inference path backed by local reference inventory until a production observation corpus is attached.
3. Present face review as human-reviewed matching support only, unless a redacted adjudicated case set is attached.
4. Keep unknown, inconclusive, and manual-review states visible.

