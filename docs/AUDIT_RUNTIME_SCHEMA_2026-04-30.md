# Runtime + Schema Alignment Audit (2026-04-30)

## Scope and Method (Current-State Only)

- Used current source in `src/`, `supabase/functions/`, and `scripts/`.
- Ran live checks against currently deployed edge functions and current env credentials.
- Avoided historical docs as primary evidence.

## Live Runtime Findings

### P0-1: Bob inference chat path is degraded in production

Evidence:
- `onspace-ai-chat` currently returns fallback provider/model even when called with `provider: "inference"`.
- Live response diagnostics: `inference: The signal has been aborted | ollama: Ollama chat returned 404: 404 page not found`.

Impact:
- Bob does not serve model responses from intended inference provider; users get failsafe text instead.

Likely causes to verify next:
- RunPod runsync worker availability/cold-start behavior at runtime.
- RunPod endpoint/model worker deployment consistency.
- Inference fallback chain behavior and timeout interactions.

---

### P0-2: Face scan endpoint was hard-failing due stack mismatch

Evidence:
- `process-face-scan` live run returned 500 with `Application not found` from upstream.
- Root mismatch: function expects `/infer/*` API shape while current configured inference URL is RunPod serverless shape.

Status:
- Mitigation shipped: function now returns explicit 503 configuration error with remediation hint instead of opaque 500.
- Added support for `FACE_INFERENCE_SERVICE_URL` override.

Residual action:
- Configure `FACE_INFERENCE_SERVICE_URL` to inference-service base URL exposing `/infer/face` and `/infer/compare`.

---

### P1-1: Health check and runtime chat checks are not equivalent

Evidence:
- `check-services-health` reports inference `ok` using provider health endpoint.
- `onspace-ai-chat` still degrades to fallback during real chat.

Impact:
- Green health signal can mask user-visible degradation.

Recommendation:
- Add synthetic chat probe in health telemetry (non-user path) that validates end-to-end response, not only worker health.

## Org Scoping Findings (Static + Current Code)

### P0-3: High count of org-filter gaps in client query sites

Evidence:
- Fresh audit output: 49 missing required org filters, 57 review-needed.
- Generated files:
  - `data/org-scoping-audit-2026-04-25.json`
  - `docs/ORG_ID_SCOPING_AUDIT_2026-04-25.md`

High-risk examples include:
- incidents, patrols, observations, breach_alerts, zones, dispatch_jobs query paths.

Impact:
- Potential cross-org data visibility risk (depending on RLS coverage and role paths).
- Inconsistent UX where some pages appear empty or produce 400/403 depending on caller path.

## Contract Drift / 400 Error Risk

### P1-2: Multiple edge functions enforce strict 400 contracts with mixed client payload aliases

Evidence:
- Numerous edge functions return explicit 400 for missing required fields.
- Some functions accept aliases (`org_id` and `organization_id`), others remain strict.

Impact:
- Intermittent 400s when callers use old payload names or omit org context under master role flows.

Recommendation:
- Build a generated contract matrix from edge function schema comments + edgeFunctions wrappers.
- Enforce payload validation at wrapper boundary and normalize aliases centrally.

## Changes Made During Audit

1. Removed stale test assumptions in live harness:
   - `scripts/live-functional-check.mjs`
   - RunPod serverless URLs now skip direct `/infer` checks and report provider shape.

2. Hardened face-scan function for current stack:
   - `supabase/functions/process-face-scan/index.ts`
   - Added `FACE_INFERENCE_SERVICE_URL` override.
   - Added graceful 503 response for RunPod endpoint mismatch (`Application not found` case).

## Immediate Next Steps (Execution Order)

1. Fix Bob inference runtime path (P0-1)
   - Add deterministic trace logging for candidate URL and runpod run id.
   - Verify RunPod worker target model and runsync response under real auth path.

2. Wire dedicated face inference URL (P0-2)
   - Set `FACE_INFERENCE_SERVICE_URL` secret.
   - Re-test `process-face-scan` detect and compare actions.

3. Close org scoping gaps in batches (P0-3)
   - Batch A: incidents/patrols/zones hooks.
   - Batch B: observations/breachs/dispatch query layers.
   - Batch C: residual review-needed paths.

4. Build contract harness for 400 prevention (P1-2)
   - Add request-shape validators in `src/lib/edgeFunctions.ts` for critical endpoints.
   - Add CI test that executes required-field and org-context payload checks.
