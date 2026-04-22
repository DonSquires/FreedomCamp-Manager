# Human Test Engine Report

- Run ID: 2026-04-22T01-43-01-914Z
- Started: 2026-04-22T01:43:01.927Z
- Ended: 2026-04-22T01:43:08.521Z
- Reliability: 93%
- Stability: 93%
- Operational Readiness: 93%

## Totals

- Pass: 13
- Fail: 1
- Infra: 0
- Skipped: 2

## UX Signals

- A11y violations: 0
- Auth-blocked flows: 0
- Flow breaks: 0

## Findings

- [HIGH] multimodal.document_extract: Could not find the table 'public.tender_reference_materials' in the schema cache

## Test Results

- PASS secret-alignment.supabase-url: Aligned across VITE_SUPABASE_URL
- PASS secret-alignment.inference-url: Aligned across BOB_SERVICE_URL, INFERENCE_SERVICE_URL, VITE_INFERENCE_SERVICE_URL
- PASS secret-alignment.inference-key: Aligned across VITE_INFERENCE_API_KEY
- PASS secret-alignment.runpod-url: Aligned across RUNPOD_URL, BOB_SERVICE_URL, INFERENCE_SERVICE_URL, VITE_INFERENCE_SERVICE_URL
- PASS secret-alignment.runpod-key: Aligned across RUNPOD_API_KEY
- PASS secret-alignment.supabase-service-role: SUPABASE_SERVICE_ROLE_KEY present
- PASS secret-alignment.test-user-email: Test-user email sources align
- PASS auth.signin: Authenticated test account
- PASS auth.resolve_org: organization_id=f3a3cabf-77fb-49f9-be6d-96e3d6060a11
- PASS secret-alignment.org-context: Derived org context from authenticated test account: f3a3cabf-77fb-49f9-be6d-96e3d6060a11
- PASS external.check_railway_health: HTTP 200
- PASS multimodal.chat_response: HTTP 200
- SKIPPED multimodal.speak: Inference service reported offline in external health check
- SKIPPED multimodal.listen: Inference service reported offline in external health check
- PASS multimodal.image_assess: HTTP 200
- FAIL multimodal.document_extract: Could not find the table 'public.tender_reference_materials' in the schema cache
