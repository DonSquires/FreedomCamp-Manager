# Bob Gatekeeper Playbook (Operations One-Page)

Date: 2026-05-18  
Audience: Master, Grand Master, Admin Officer, Dispatch supervisors

## Purpose

Operate Bob safely as a governed assistant by using explicit approval states, reason codes, and emergency precedence rules.

## Gate States (Canonical)

1. Proposal submitted: Bob generated an actionable recommendation and queued it for review.
2. Awaiting approver: action is waiting for Master/Grand Master approval.
3. Approved: action was approved and can execute within policy boundaries.
4. Blocked by policy: action was denied by contract, role, or emergency-priority rules.

## Operator Workflow

1. Review the recommendation summary and affected entity.
2. Check gate reason and decision reason codes before approval.
3. Validate confidence context:
   - Composite confidence
   - Gate confidence
   - Command confidence
4. Approve only if evidence and route context match the operational intent.
5. Reject with explicit reason when context is incomplete, contract is mismatched, or policy blocks apply.

## Emergency Priority Rule

If emergency-priority mode is active:

1. Non-safety administrative mutations are blocked.
2. Safety-first operations continue in assistive mode.
3. Do not bypass this rule through manual retries; escalate to supervisor if uncertain.

## Required Audit Fields

Every governed action should preserve:

1. Actor identity (`actor`)
2. Operator role (`operator`)
3. Organization scope (`org`)
4. Decision state (`approved`, `rejected`, `blocked`, `pending`)
5. Decision reason code(s)

## Escalation Triggers

Escalate to Master/Grand Master when any of these occur:

1. Repeated policy block with unclear route/entity mapping.
2. Confidence below operational threshold for high-impact action.
3. Emergency-priority conflict with requested administrative write.
4. Contract mismatch between requested operation and approved mutation catalog.

## Shift-Start and Shift-End Checks

Shift-start:

1. Confirm gate status strip is visible and states are understandable to staff.
2. Confirm approval queue is reachable for approver roles.

Shift-end:

1. Review unresolved pending proposals.
2. Confirm blocked items include reason codes and notes.
3. Record anomalies in governance review notes for next daily ops review.
