# Case Model API Contract

## Purpose

This document publishes the Phase A shared case model and event family contract for patrol, dispatch, and enforcement timelines.

Authoritative schema source:

- `supabase/migrations/202605_case_model.sql`
- `src/types/database.ts`
- `src/hooks/useOperationalCases.ts`

## Tables

### `operational_cases`

Central case record linking operational activity under a single org-scoped timeline.

Key fields:

- `id: UUID`
- `organization_id: UUID`
- `case_type: 'dispatch' | 'patrol' | 'enforcement' | 'investigation' | 'audit'`
- `case_number: string | null`
- `dispatch_job_id: UUID | null`
- `created_from: 'dispatch' | 'patrol' | 'breach' | 'observation' | 'manual'`
- `status: 'active' | 'pending_review' | 'completed' | 'archived' | 'cancelled'`
- `title: string | null`
- `summary: string | null`
- `officer_notes: string | null`

### `patrol_events`

Patrol timeline events attached to an operational case.

Key fields:

- `id: UUID`
- `organization_id: UUID`
- `case_id: UUID`
- `officer_id: UUID`
- `zone_id: UUID | null`
- `patrol_type: 'routine' | 'response' | 'follow_up' | 'surveillance' | 'escort'`
- `event_type: 'patrol_start' | 'patrol_location_update' | 'patrol_observation' | 'patrol_complete' | 'patrol_cancelled'`
- `status: 'active' | 'completed' | 'cancelled'`
- `event_timestamp: timestamptz`
- `gps_lat: number | null`
- `gps_lng: number | null`
- `observation_text: string | null`
- `photo_urls: string[] | null`

### `dispatch_events`

Dispatch lifecycle state changes attached to an operational case.

Key fields:

- `id: UUID`
- `organization_id: UUID`
- `case_id: UUID`
- `dispatch_job_id: UUID`
- `event_type: 'dispatch_created' | 'dispatch_assigned' | 'dispatch_awaiting_ack' | 'dispatch_acknowledged' | 'dispatch_en_route' | 'dispatch_on_scene' | 'dispatch_completed' | 'dispatch_cancelled' | 'dispatch_escalated'`
- `event_timestamp: timestamptz`
- `status: 'recorded' | 'acknowledged' | 'processed'`
- `assigned_to: UUID | null`
- `status_at_event: string | null`
- `escalation_level_at_event: number | null`
- `notes: string | null`
- `triggered_by: UUID | null`

### `enforcement_events`

Enforcement activity attached to an operational case.

Key fields:

- `id: UUID`
- `organization_id: UUID`
- `case_id: UUID`
- `event_type: 'enforcement_initiated' | 'enforcement_warning_issued' | 'enforcement_ticket_issued' | 'enforcement_apprehension' | 'enforcement_completed' | 'enforcement_cancelled'`
- `event_timestamp: timestamptz`
- `status: 'active' | 'completed' | 'cancelled'`
- `officer_id: UUID`
- `subject_type: string | null`
- `subject_identifier: string | null`
- `violation_type: string | null`
- `action_taken: string | null`
- `outcome: string | null`
- `photo_urls: string[] | null`
- `evidence_notes: string | null`

### `case_comments`

Org-scoped comments attached to an operational case.

## Helper Function

### `create_case_from_dispatch_job(dispatch_job_id UUID) -> UUID`

Creates an `operational_cases` row using the source dispatch job and returns the new `case_id`.

## Sample Payloads

### Operational Case

```json
{
  "id": "5c79d2df-5d0d-489f-a089-3a25f8898fd8",
  "organization_id": "cb9b4d85-7c99-46d2-b0ab-f6e9590aa1cb",
  "case_type": "dispatch",
  "case_number": "CASE-2026-000421",
  "dispatch_job_id": "6f77eca8-7e27-4ce4-8cad-67ea0de23f93",
  "created_from": "dispatch",
  "status": "active",
  "title": "Noise complaint dispatch",
  "summary": "Resident reported repeated after-hours disturbance.",
  "officer_notes": null,
  "created_at": "2026-05-05T09:10:00Z",
  "updated_at": "2026-05-05T09:10:00Z",
  "closed_at": null,
  "created_by": "8f0a520f-7e0d-4175-b6bd-4fb7dd52f1f2"
}
```

### Patrol Event

```json
{
  "id": "1b57f6d2-968f-4356-bd60-bdf787d68a6d",
  "organization_id": "cb9b4d85-7c99-46d2-b0ab-f6e9590aa1cb",
  "case_id": "5c79d2df-5d0d-489f-a089-3a25f8898fd8",
  "officer_id": "8f0a520f-7e0d-4175-b6bd-4fb7dd52f1f2",
  "zone_id": "50b5d0b0-8bf4-440b-b40a-9f976770f06b",
  "patrol_type": "response",
  "event_type": "patrol_location_update",
  "status": "active",
  "event_timestamp": "2026-05-05T09:14:00Z",
  "gps_lat": -41.2706,
  "gps_lng": 173.2839,
  "observation_text": "Officer arrived on scene and began assessment.",
  "photo_urls": []
}
```

### Dispatch Event

```json
{
  "id": "af0ed54b-f57f-459d-b0e7-d14d7c3c87f9",
  "organization_id": "cb9b4d85-7c99-46d2-b0ab-f6e9590aa1cb",
  "case_id": "5c79d2df-5d0d-489f-a089-3a25f8898fd8",
  "dispatch_job_id": "6f77eca8-7e27-4ce4-8cad-67ea0de23f93",
  "event_type": "dispatch_assigned",
  "event_timestamp": "2026-05-05T09:11:00Z",
  "status": "recorded",
  "assigned_to": "8f0a520f-7e0d-4175-b6bd-4fb7dd52f1f2",
  "status_at_event": "assigned",
  "escalation_level_at_event": 0,
  "notes": "Assigned to on-duty response officer.",
  "triggered_by": "2c495dfc-98d2-418d-96b0-e260b1d41f0d"
}
```

### Enforcement Event

```json
{
  "id": "eb74e491-ed8a-486d-a4ab-d3b35685e54e",
  "organization_id": "cb9b4d85-7c99-46d2-b0ab-f6e9590aa1cb",
  "case_id": "5c79d2df-5d0d-489f-a089-3a25f8898fd8",
  "event_type": "enforcement_warning_issued",
  "event_timestamp": "2026-05-05T09:22:00Z",
  "status": "completed",
  "officer_id": "8f0a520f-7e0d-4175-b6bd-4fb7dd52f1f2",
  "subject_type": "site",
  "subject_identifier": "SITE-0042",
  "violation_type": "after_hours_noise",
  "action_taken": "warning",
  "outcome": "compliance_requested",
  "photo_urls": [],
  "evidence_notes": "Warning delivered to site contact."
}
```

### Case Comment

```json
{
  "id": "357ce67d-b090-45d1-8672-9b302db46d7a",
  "organization_id": "cb9b4d85-7c99-46d2-b0ab-f6e9590aa1cb",
  "case_id": "5c79d2df-5d0d-489f-a089-3a25f8898fd8",
  "author_id": "8f0a520f-7e0d-4175-b6bd-4fb7dd52f1f2",
  "comment_text": "Resident advised that the disturbance stopped after contact.",
  "created_at": "2026-05-05T09:25:00Z",
  "updated_at": "2026-05-05T09:25:00Z",
  "edited_by": null
}
```

## Route Usage

- Patrol and Respond: `src/pages/FieldOfficerDispatch.tsx`
- Dispatch and Command: case-model backed via `src/hooks/useOperationalCases.ts`
- Breaches / enforcement timeline: case-model backed via `src/hooks/useOperationalCases.ts`

## Validation References

- `tests/e2e/bootstrap-routes.test.ts`
- `tests/integration/org-isolation.test.ts`
- `tests/e2e/org-isolation-api.spec.ts`
