# Human Test Engine Report

- Run ID: 2026-04-22T01-15-30-117Z
- Started: 2026-04-22T01:15:30.129Z
- Ended: 2026-04-22T01:18:52.870Z
- Reliability: 65%
- Stability: 100%
- Operational Readiness: 77%

## Totals

- Pass: 13
- Fail: 0
- Infra: 7
- Skipped: 0

## UX Signals

- A11y violations: 0
- Auth-blocked flows: 0
- Flow breaks: 0

## Findings

- [MEDIUM] secret-alignment.runpod-url: No value set for RUNPOD_GATEWAY_URL, RUNPOD_SERVERLESS_URL, RUNPOD_URL
- [MEDIUM] secret-alignment.org-context: No value set for BOB_ORG_ID, ORG_ID, DEFAULT_ORG_ID
- [MEDIUM] secret-alignment.supabase-service-role: SUPABASE_SERVICE_ROLE_KEY not set; admin/document probes may be limited
- [MEDIUM] multimodal.chat_response: This operation was aborted
- [MEDIUM] multimodal.speak: Speech synthesis failed (404)
- [MEDIUM] multimodal.listen: Transcription failed (404)
- [MEDIUM] multimodal.document_extract: new row violates row-level security policy
- [MEDIUM] secret-alignment: 3 required or recommended secret group(s) missing

## Test Results

- PASS secret-alignment.supabase-url: Aligned across VITE_SUPABASE_URL
- PASS secret-alignment.inference-url: Aligned across VITE_INFERENCE_SERVICE_URL
- PASS secret-alignment.inference-key: Aligned across VITE_INFERENCE_API_KEY
- INFRA secret-alignment.runpod-url: No value set for RUNPOD_GATEWAY_URL, RUNPOD_SERVERLESS_URL, RUNPOD_URL
- PASS secret-alignment.runpod-key: Aligned across RUNPOD_API_KEY
- INFRA secret-alignment.org-context: No value set for BOB_ORG_ID, ORG_ID, DEFAULT_ORG_ID
- INFRA secret-alignment.supabase-service-role: SUPABASE_SERVICE_ROLE_KEY not set; admin/document probes may be limited
- PASS secret-alignment.test-user-email: Test-user email sources align
- PASS auth.signin: Authenticated test account
- PASS auth.resolve_org: organization_id=f3a3cabf-77fb-49f9-be6d-96e3d6060a11
- PASS external.check_railway_health: HTTP 200
- INFRA multimodal.chat_response: This operation was aborted
- INFRA multimodal.speak: Speech synthesis failed (404)
- INFRA multimodal.listen: Transcription failed (404)
- PASS multimodal.image_assess: HTTP 200
- INFRA multimodal.document_extract: new row violates row-level security policy
- PASS ui.agentic.login-health: result=completed, a11y_violations=0
- PASS ui.agentic.tender-shadow: result=completed, a11y_violations=0
- PASS ui.agentic.ptt-zindex: result=completed, a11y_violations=0
- PASS ui.playwright.crm_visual_sweep: Playwright sweep passed
