# Bob Decision Log and Approval Artifact Retention Policy

Date: 2026-05-18  
Owner: Security / Compliance, with Bob governance review

## Scope

This policy covers Bob decision logs and approval artifacts, including:

1. `bob_action_proposals`
2. `bob_action_proposal_events`
3. Approval and rejection notes attached to proposals
4. Execution outcome metadata and event metadata
5. Governance screenshots or review evidence stored for release verification

## Retention Rules

1. Keep proposal rows and proposal-event rows for 7 years from the final terminal status date (`approved`, `rejected`, `executed`, or `execution_failed`).
2. Keep pending proposals for at least 90 days after their due date if they were never resolved, unless a legal hold or investigation requires longer.
3. Apply legal hold or investigation hold immediately when the proposal or event trail is needed for compliance review, dispute, or incident response.
4. Do not delete or redact terminal records while a hold is active.
5. Retain the event trail even if a proposal is superseded; the audit chain must remain reconstructable.

## Archive and Disposal

1. After 90 days, terminal artifacts may be exported to an immutable archive for operational access reduction.
2. After 7 years and no active hold, records may be purged according to the organization’s approved disposal process.
3. Disposal must preserve a minimal deletion audit marker: record type, record id, disposed_at, and disposition reason.

## Operational Notes

1. Any change to retention windows, archive format, or hold rules must be reflected in this document and the corresponding decision log entry.
2. Bob UI and approvals must continue to surface audit-chain evidence even when old records are archived.
