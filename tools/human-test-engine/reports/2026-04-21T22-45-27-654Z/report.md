# Human Test Engine Report

- Run ID: 2026-04-21T22-45-27-654Z
- Started: 2026-04-21T22:45:27.666Z
- Ended: 2026-04-21T22:48:41.364Z
- Reliability: 45%
- Stability: 95%
- Operational Readiness: 63%

## Totals

- Pass: 9
- Fail: 1
- Infra: 10
- Skipped: 0

## UX Signals

- A11y violations: 0
- Auth-blocked flows: 3
- Flow breaks: 1

## Findings

- [HIGH] ui.playwright.crm_visual_sweep: t: test-results/crm-service-provider-visua-84e5c-for-CRM-and-enabled-modules-chromium/error-context.md

  1 failed
    [chromium] › tests/e2e/crm-service-provider-visual.spec.ts:70:3 › CRM full visual provisioning and module sweep › visual route sweep for CRM and enabled modules 
  1 passed (46.1s)

- [MEDIUM] secret-alignment.runpod-url: No value set for RUNPOD_GATEWAY_URL, RUNPOD_SERVERLESS_URL, RUNPOD_URL
- [MEDIUM] secret-alignment.org-context: No value set for BOB_ORG_ID, ORG_ID, DEFAULT_ORG_ID
- [MEDIUM] secret-alignment.supabase-service-role: SUPABASE_SERVICE_ROLE_KEY not set; admin/document probes may be limited
- [MEDIUM] multimodal.chat_response: This operation was aborted
- [MEDIUM] multimodal.speak: Speech synthesis failed (404)
- [MEDIUM] multimodal.listen: Transcription failed (404)
- [MEDIUM] multimodal.document_extract: new row violates row-level security policy
- [MEDIUM] ui.agentic.login-health: flow blocked by authentication credentials
- [MEDIUM] ui.agentic.tender-shadow: flow blocked by authentication credentials
- [MEDIUM] ui.agentic.ptt-zindex: flow blocked by authentication credentials
- [MEDIUM] ux-auth-flow: 3 flow(s) were blocked by authentication
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
- INFRA ui.agentic.login-health: flow blocked by authentication credentials
- INFRA ui.agentic.tender-shadow: flow blocked by authentication credentials
- INFRA ui.agentic.ptt-zindex: flow blocked by authentication credentials
- FAIL ui.playwright.crm_visual_sweep: t: test-results/crm-service-provider-visua-84e5c-for-CRM-and-enabled-modules-chromium/error-context.md

  1 failed
    [chromium] › tests/e2e/crm-service-provider-visual.spec.ts:70:3 › CRM full visual provisioning and module sweep › visual route sweep for CRM and enabled modules 
  1 passed (46.1s)

