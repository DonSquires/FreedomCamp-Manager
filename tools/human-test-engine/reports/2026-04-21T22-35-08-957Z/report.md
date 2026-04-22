# Human Test Engine Report

- Run ID: 2026-04-21T22-35-08-957Z
- Started: 2026-04-21T22:35:08.969Z
- Ended: 2026-04-21T22:36:03.279Z
- Reliability: 50%
- Stability: 50%
- Operational Readiness: 50%

## Totals

- Pass: 4
- Fail: 4
- Infra: 0
- Skipped: 0

## UX Signals

- A11y violations: 0
- Auth-blocked flows: 0
- Flow breaks: 0

## Findings

- [HIGH] multimodal.chat_response: This operation was aborted
- [HIGH] multimodal.speak: Speech synthesis failed (404)
- [HIGH] multimodal.listen: Transcription failed (404)
- [HIGH] multimodal.document_extract: new row violates row-level security policy

## Test Results

- PASS auth.signin: Authenticated test account
- PASS auth.resolve_org: organization_id=f3a3cabf-77fb-49f9-be6d-96e3d6060a11
- PASS external.check_railway_health: HTTP 200
- FAIL multimodal.chat_response: This operation was aborted
- FAIL multimodal.speak: Speech synthesis failed (404)
- FAIL multimodal.listen: Transcription failed (404)
- PASS multimodal.image_assess: HTTP 200
- FAIL multimodal.document_extract: new row violates row-level security policy
