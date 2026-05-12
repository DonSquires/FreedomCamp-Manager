# Event Family Contract — FieldOps Manager

**Date**: 2026-05-04  
**Status**: Phase A — Approved  
**Owner**: Data Platform Lead  
**Related Migration**: `supabase/migrations/20260504000002_case_model.sql`

---

## Overview

Every meaningful operational event in FieldOps Manager is attached to an `operational_cases` record. Three core event families form the Phase A foundation; additional families are added in Phases C–E.

All event tables share the following design constraints:

1. Every event row carries an `organization_id` — org isolation is enforced via RLS.
2. Every event row links to an `operational_cases.id` via `case_id` (FK, `ON DELETE CASCADE`).
3. `event_timestamp` is always `TIMESTAMPTZ` in the `Pacific/Auckland` timezone context.
4. Event tables are **append-only** — records are never updated after insert. Corrections become new events.

---

## Core Event Families (Phase A)

### 1. `patrol_events`

**Purpose**: Records every step in a patrol run, from start through observations to completion.

**Event Types**:
| `event_type` | Meaning |
|---|---|
| `patrol_start` | Officer begins a patrol run |
| `patrol_location_update` | GPS location broadcast during patrol |
| `patrol_observation` | Officer logs a freedom camping observation |
| `patrol_complete` | Patrol run closed out |
| `patrol_cancelled` | Patrol aborted before completion |

**Key Columns**:
```sql
id              UUID PRIMARY KEY
case_id         UUID REFERENCES operational_cases(id) ON DELETE CASCADE
organization_id UUID NOT NULL
officer_id      UUID REFERENCES user_profiles(id)
event_type      TEXT NOT NULL  -- (enum above)
event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
payload         JSONB          -- event-specific data
```

**Sample JSON Payload — `patrol_observation`**:
```json
{
  "zone_id": "uuid-...",
  "vehicle_plate": "ABC123",
  "occupation_type": "overnight",
  "compliance_status": "non_compliant",
  "location": { "lat": -41.2865, "lng": 174.7762 }
}
```

**RLS Rule**: `organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())`

---

### 2. `dispatch_events`

**Purpose**: Records the full lifecycle of a dispatch job — creation, acceptance, on-scene, resolution.

**Event Types**:
| `event_type` | Meaning |
|---|---|
| `dispatch_created` | New dispatch job opened |
| `dispatch_assigned` | Job assigned to officer |
| `dispatch_acknowledged` | Officer acknowledges receipt |
| `dispatch_enroute` | Officer en route |
| `dispatch_on_scene` | Officer on scene |
| `dispatch_resolved` | Job closed/resolved |
| `dispatch_cancelled` | Job cancelled |

**Key Columns**:
```sql
id                        UUID PRIMARY KEY
case_id                   UUID REFERENCES operational_cases(id) ON DELETE CASCADE
organization_id           UUID NOT NULL
dispatch_job_id           UUID REFERENCES dispatch_jobs(id)
event_type                TEXT NOT NULL
event_timestamp           TIMESTAMPTZ NOT NULL DEFAULT now()
status_at_event           TEXT
escalation_level_at_event INTEGER DEFAULT 0
payload                   JSONB
```

**Sample JSON Payload — `dispatch_on_scene`**:
```json
{
  "officer_id": "uuid-...",
  "location": { "lat": -36.8485, "lng": 174.7633 },
  "notes": "Two vehicles present, no response to knock",
  "elapsed_seconds": 420
}
```

**RLS Rule**: Same org-scoped pattern as `patrol_events`.

---

### 3. `enforcement_events`

**Purpose**: Records every enforcement action taken — notices, warnings, trespass orders, escalations.

**Event Types**:
| `event_type` | Meaning |
|---|---|
| `enforcement_notice_issued` | Formal notice issued to occupant |
| `verbal_warning` | Verbal warning recorded |
| `trespass_order` | Trespass order issued |
| `escalation` | Incident escalated (e.g., to Police) |
| `enforcement_completed` | Enforcement chain closed |

**Key Columns**:
```sql
id              UUID PRIMARY KEY
case_id         UUID REFERENCES operational_cases(id) ON DELETE CASCADE
organization_id UUID NOT NULL
officer_id      UUID REFERENCES user_profiles(id)
event_type      TEXT NOT NULL
event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
payload         JSONB
```

**Sample JSON Payload — `trespass_order`**:
```json
{
  "subject_name": "John Doe",
  "vehicle_plate": "XYZ999",
  "location": "Nelson Bus Hub South Bay",
  "order_number": "NCC-2026-0042",
  "duration_days": 30,
  "issued_by": "uuid-officer-..."
}
```

**RLS Rule**: Same org-scoped pattern.

---

## Org Isolation Rules (All Families)

1. **Storage**: `organization_id` column is NOT NULL; enforced at DB constraint level.
2. **Retrieval**: RLS policy on every event table ensures `organization_id` matches the authenticated user's org.
3. **Realtime**: Supabase Realtime channels must be subscribed with a filter: `organization_id=eq.<org_id>`.
4. **Exports**: CSV/PDF export routes must add `WHERE organization_id = :org_id` to all queries.
5. **Cross-org delegation**: Only allowed via the `authorized_work_locations` table — never via direct RLS bypass.

---

## Future Event Families (Phase Roadmap)

| Phase | New Event Families |
|---|---|
| Phase A | `patrol_events`, `dispatch_events`, `enforcement_events` (schema only) |
| Phase B | Activate data writes to all 3 families; live in bootstrap routes |
| Phase C | `security_events` (site-guard, access control), `assistive_events` (welfare, PTT) |
| Phase D | `approval_events`, `transition_events` (handoff, offline sync) |
| Phase E | `audit_events` (full read/write audit trail consolidation) |

See [EVENT_SEQUENCING_ROADMAP.md](./EVENT_SEQUENCING_ROADMAP.md) for full phase-by-phase rollout detail.

---

## Validation Checklist

- [ ] All 3 event tables have `organization_id NOT NULL` constraint
- [ ] All 3 event tables have RLS enabled and org-scoped SELECT + INSERT policy
- [ ] Org isolation tests verify cross-org read isolation for `operational_cases` and all 3 event families
- [ ] Realtime channel subscriptions in codebase include `organization_id` filter
- [ ] Export routes (CSV, PDF) scope queries to `organization_id`
