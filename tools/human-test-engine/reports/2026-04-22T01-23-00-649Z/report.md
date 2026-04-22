# Human Test Engine Report

- Run ID: 2026-04-22T01-23-00-649Z
- Started: 2026-04-22T01:23:00.662Z
- Ended: 2026-04-22T01:25:16.263Z
- Reliability: 80%
- Stability: 100%
- Operational Readiness: 87%

## Totals

- Pass: 16
- Fail: 0
- Infra: 4
- Skipped: 0

## UX Signals

- A11y violations: 0
- Auth-blocked flows: 0
- Flow breaks: 0

## Findings

- [MEDIUM] secret-alignment.supabase-service-role: SUPABASE_SERVICE_ROLE_KEY not set; admin/document probes may be limited
- [MEDIUM] multimodal.speak: Speech synthesis failed (404)
- [MEDIUM] multimodal.listen: Transcription failed (404)
- [MEDIUM] multimodal.document_extract: new row violates row-level security policy
- [MEDIUM] secret-alignment: 1 required or recommended secret group(s) missing

## Test Results

- PASS secret-alignment.supabase-url: Aligned across VITE_SUPABASE_URL
- PASS secret-alignment.inference-url: Aligned across BOB_SERVICE_URL, INFERENCE_SERVICE_URL, VITE_INFERENCE_SERVICE_URL
- PASS secret-alignment.inference-key: Aligned across VITE_INFERENCE_API_KEY
- PASS secret-alignment.runpod-url: Aligned across RUNPOD_URL, BOB_SERVICE_URL, INFERENCE_SERVICE_URL, VITE_INFERENCE_SERVICE_URL
- PASS secret-alignment.runpod-key: Aligned across RUNPOD_API_KEY
- INFRA secret-alignment.supabase-service-role: SUPABASE_SERVICE_ROLE_KEY not set; admin/document probes may be limited
- PASS secret-alignment.test-user-email: Test-user email sources align
- PASS auth.signin: Authenticated test account
- PASS auth.resolve_org: organization_id=f3a3cabf-77fb-49f9-be6d-96e3d6060a11
- PASS secret-alignment.org-context: Derived org context from authenticated test account: f3a3cabf-77fb-49f9-be6d-96e3d6060a11
- PASS external.check_railway_health: HTTP 200
- PASS multimodal.chat_response: HTTP 200
- INFRA multimodal.speak: Speech synthesis failed (404)
- INFRA multimodal.listen: Transcription failed (404)
- PASS multimodal.image_assess: HTTP 200
- INFRA multimodal.document_extract: new row violates row-level security policy
- PASS ui.agentic.login-health: result=completed, a11y_violations=0
- PASS ui.agentic.tender-shadow: result=completed, a11y_violations=0
- PASS ui.agentic.ptt-zindex: result=completed, a11y_violations=0
- PASS ui.playwright.crm_visual_sweep: Playwright sweep passed
