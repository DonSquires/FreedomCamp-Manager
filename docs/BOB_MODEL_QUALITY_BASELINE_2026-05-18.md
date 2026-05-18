# Bob Model Quality Baseline and Lifecycle Policy

Date: 2026-05-18  
Owner: ML Engineer (primary), LLM Engineer (reviewer for operator-visible semantics)

## 1) Baseline Quality Scorecard (Active)

Capability classes and baseline checks:

| Capability class | Baseline source | Pass signal |
|---|---|---|
| Domain recommendation quality (biosecurity/noise/parking) | `scripts/mlops-domain-inference-canary.mjs` | Valid structured JSON response + domain match + recommended action + legal basis for each domain |
| Runtime reliability | Domain canary artifact + GitHub workflow summary | All domain probes pass under strict mode with no missing required fields |
| Runtime latency/throughput tradeoff | `inference-service/scripts/benchmark-onnx-runtime-profiles.mjs` + `scripts/summarize-onnx-runtime-benchmark.mjs` | Profile benchmark artifact produced with p95/mean/throughput and recommended default profile |
| Promotion readiness | `scripts/mlops-canary-promotion-gate.mjs` | Required consecutive successful canary runs reached (`MLOPS_REQUIRED_CONSECUTIVE_GREEN`, default 3) |
| Policy safety parity | `scripts/bob-llm-regression-suite.mjs` + policy tests | Emergency-priority blocking and execution-review payload contract tests pass |

Primary artifacts:

- `tools/mlops/domain-canary/<run-id>/domain-canary.json`
- `tools/mlops/domain-canary/promotion-gate/<run-id>/promotion-gate.json`
- `tools/llm-regression/<run-id>/bob-llm-regression-report.json`
- `inference-service/data/onnx-runtime-benchmark-<run-id>.json`
- `inference-service/data/onnx-runtime-benchmark-<run-id>.md`

## 2) Confidence Calibration Method

Operator-visible confidence must be mapped to calibrated bands, not raw model logits.

Banding policy:

| Composite confidence | Label | Operator guidance |
|---|---|---|
| `>= 0.90` | High | Suitable for standard approval workflow review |
| `0.75 - 0.89` | Medium | Require additional evidence review before execution |
| `< 0.75` | Low | Assistive-only recommendation; do not auto-progress approval |

Calibration approach:

1. Collect scored outcomes from Bob policy/evaluation logs per capability class.
2. Bucket predictions into deciles.
3. Compare expected confidence to observed success rate per bucket.
4. Adjust confidence-to-label thresholds quarterly or after major model/runtime updates.
5. Any threshold change must be reviewed by LLM Engineer before operator-facing rollout.

## 3) Retraining Triggers and Dataset Freshness

Retraining trigger thresholds:

- Domain canary failure in strict mode for 2 consecutive daily runs.
- Promotion gate cannot reach required consecutive green runs within 7 days.
- Repeated policy or hallucination failure pattern count `>= 3` in failure summary window.
- Significant schema/product shift: >10 new migrations or major route/workflow contract updates.

Dataset freshness criteria:

- Training/eval corpus refresh at least every 30 days.
- Emergency and governance edge-case examples refreshed after every major incident or policy change.
- Any stale corpus older than 60 days requires explicit waiver in governance review notes.

## 4) Promotion Gates (Offline Before Runtime Rollout)

Model/runtime promotion sequence:

1. Pass domain canary checks (`ops-mlops-domain-canary.yml`) in strict mode.
2. Pass promotion gate (`ops-mlops-domain-promotion-gate.yml`) with required consecutive green threshold.
3. Pass Bob policy regression suite for emergency and payload-contract safety.
4. Confirm docs/runtime drift checks are green before production promotion.

## 5) Drift Detection and Retraining Cadence

Cadence:

- Daily: domain canary workflow (quality/reliability drift signal).
- Daily: promotion-gate workflow (trend and stability signal).
- Daily/nightly: docs/router and governance drift workflows (contract drift signal).
- Weekly: ONNX runtime profile benchmark workflow (`ops-onnx-runtime-profile-benchmark.yml`) for host-level latency/throughput drift and recommended default profile review.
- Weekly: ML/LLM review of canary, promotion, and failure summaries; decide retraining action.
- Monthly: governance checkpoint review for threshold recalibration.

Retraining recommendation policy:

- Trigger immediate retraining planning when two or more independent drift signals fail in the same week.
- Trigger prioritized data curation when drift appears in one domain class only.
- Trigger rollback consideration when production safety/policy regressions occur despite canary pass.

## 6) Current Runtime Tuning Baseline (Measured)

Validated benchmark run:

- Workflow run: `ops-onnx-runtime-profile-benchmark.yml` run id `26011565908` (GitHub Actions).
- Host snapshot: Ubuntu runner, 2 CPU cores, 20 iterations, 5 warmup.
- Recommendation: `ONNX_RUNTIME_PROFILE=balanced`.

Observed key metrics from artifact (`onnx-runtime-benchmark-26011565908`):

- `latency / yolo`: mean 114.05 ms, p95 115.46 ms, throughput 8.77 req/s
- `balanced / yolo`: mean 113.39 ms, p95 115.05 ms, throughput 8.82 req/s
- `throughput / yolo`: mean 194.75 ms, p95 210.14 ms, throughput 5.13 req/s

Active production default policy:

1. Keep `ONNX_RUNTIME_PROFILE=balanced` as default.
2. Keep explicit thread overrides unset unless host-specific benchmark evidence requires pinning.
3. Revisit defaults when weekly benchmark artifacts show sustained p95 or throughput regression.
