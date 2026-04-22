# Human Test Engine Report

- Run ID: 2026-04-21T22-36-37-841Z
- Started: 2026-04-21T22:36:37.852Z
- Ended: 2026-04-21T22:38:14.620Z
- Reliability: 50%
- Stability: 100%
- Operational Readiness: 68%

## Totals

- Pass: 4
- Fail: 0
- Infra: 4
- Skipped: 0

## UX Signals

- A11y violations: 0
- Auth-blocked flows: 0
- Flow breaks: 0

## Findings

- [MEDIUM] multimodal.chat_response: This operation was aborted
- [MEDIUM] multimodal.speak: Speech synthesis failed (404)
- [MEDIUM] multimodal.listen: Transcription failed (404)
- [MEDIUM] multimodal.document_extract: new row violates row-level security policy

## Test Results

- PASS auth.signin: Authenticated test account
- PASS auth.resolve_org: organization_id=f3a3cabf-77fb-49f9-be6d-96e3d6060a11
- PASS external.check_railway_health: HTTP 200
- INFRA multimodal.chat_response: This operation was aborted
- INFRA multimodal.speak: Speech synthesis failed (404)
- INFRA multimodal.listen: Transcription failed (404)
- PASS multimodal.image_assess: HTTP 200
- INFRA multimodal.document_extract: new row violates row-level security policy
