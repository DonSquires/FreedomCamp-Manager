# On-Call Rostering, Callout Shifts & Travel Allowances

## Executive Summary

This document describes the comprehensive on-call rostering system that supports:

1. **On-Call Periods** — Staff rostered for availability with fixed rates
2. **Callout Shifts** — Ad-hoc shifts triggered from on-call with minimum hour guarantees
3. **Travel Allowances** — Reimbursement for travel time, distance, or both
4. **Rate Configuration** — Flexible rate structures per organization/officer

---

## 1. On-Call Rostering Overview

### 1.1 Problem Statement

Security and enforcement operations require 24/7 coverage, but staffing full shifts around the clock is expensive. The solution is **on-call rostering** where officers:

- Are paid a fixed rate just for being **available** to respond
- Don't work unless called out (no hours logged)
- Receive premium pay when actually called out
- Get travel allowances for callout travel

### 1.2 Key Business Rules

| Rule | Description |
|------|-------------|
| **On-Call Pay** | Fixed rate for availability period (not per hour worked) |
| **Split Periods** | On-call can be before/after a regular shift with different rates |
| **Callout Minimum** | **3 hours minimum** pay per callout regardless of actual duration |
| **Hours Above Minimum** | Worked beyond 3hrs = 3hrs × base_rate + excess × after_minimum_rate |
| **Travel Allowance** | Paid by time traveled, km traveled, or both |
| **Jurisdiction Rule** | Travel may only be paid outside normal jurisdiction |

---

## 2. Database Schema

### 2.1 Core Tables

```
office_locations          on_call_rates              officer_on_call_rates
       │                        │                             │
       │                        │                             │
       ▼                        ▼                             ▼
┌─────────────┐          ┌─────────────┐              ┌─────────────┐
│ id          │          │ id          │              │ id          │
│ org_id      │          │ org_id      │              │ officer_id  │
│ name        │          │ name        │              │ flat_rate   │
│ address     │          │ period_type │              │ hourly_rate │
│ lat/lng     │          │ flat_rate   │              │ callout_min │
│ jurisdiction│          │ hourly_rate │              │ ...override │
└─────────────┘          │ callout_min │              └─────────────┘
       │                 │ travel_rates│                      │
       │                 └─────────────┘                      │
       │                        │                             │
       ▼                        ▼                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                       on_call_periods                           │
│ id, org_id, officer_id, start_time, end_time, period_type       │
│ on_call_rate_id, flat_rate_amount, status                       │
│ callout_count, total_callout_hours, on_call_pay_amount          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │    callout_shifts     │
                    │ id, org_id, officer_id│
                    │ on_call_period_id     │
                    │ actual_work_hours     │
                    │ minimum_hours = 3     │
                    │ billable_hours        │
                    │ callout_hourly_rate   │
                    │ total_pay_amount      │
                    └───────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   travel_allowances   │
                    │ distance_km           │
                    │ travel_duration_mins  │
                    │ rate_per_km           │
                    │ rate_per_hour         │
                    │ distance_pay_amount   │
                    │ time_pay_amount       │
                    └───────────────────────┘
```

### 2.2 Table Details

#### `office_locations`
Reference points for travel distance calculation.

```sql
CREATE TABLE office_locations (
  id                UUID PRIMARY KEY,
  organization_id   UUID NOT NULL,
  name              TEXT NOT NULL,           -- 'Auckland HQ'
  address           TEXT,
  latitude          NUMERIC(10, 7),
  longitude         NUMERIC(10, 7),
  jurisdiction_radius_km  NUMERIC(8, 2),     -- Simple radius boundary
  jurisdiction_geom       GEOMETRY(POLYGON), -- Complex polygon boundary
  is_primary        BOOLEAN DEFAULT false,
  is_active         BOOLEAN DEFAULT true
);
```

#### `on_call_rates`
Configurable rate structures per organization.

```sql
CREATE TABLE on_call_rates (
  id                UUID PRIMARY KEY,
  organization_id   UUID NOT NULL,
  name              TEXT NOT NULL,           -- 'Standard On-Call'
  
  -- Period type
  period_type       TEXT NOT NULL,           -- standard, before_shift, after_shift, overnight, weekend, public_holiday
  
  -- On-call availability pay
  flat_rate_per_period  NUMERIC(10, 2),      -- $50 for 12hr on-call
  hourly_rate           NUMERIC(10, 2),      -- OR $5/hr for availability
  
  -- Callout rates
  callout_minimum_hours      NUMERIC(5, 2) DEFAULT 3,   -- 3hr minimum
  callout_hourly_rate        NUMERIC(10, 2),            -- Rate per hour
  callout_after_minimum_rate NUMERIC(10, 2),            -- Rate for hours > minimum
  
  -- Travel defaults
  travel_time_rate_per_hour  NUMERIC(10, 2),
  travel_distance_rate_per_km NUMERIC(10, 4),
  travel_includes_return     BOOLEAN DEFAULT true,
  travel_in_jurisdiction_only BOOLEAN DEFAULT false,
  
  is_default         BOOLEAN DEFAULT false,
  effective_from     DATE DEFAULT CURRENT_DATE
);
```

#### `on_call_periods`
Individual on-call rostering assignments.

```sql
CREATE TABLE on_call_periods (
  id                UUID PRIMARY KEY,
  organization_id   UUID NOT NULL,
  officer_id        UUID NOT NULL,
  
  -- On-call window
  start_time        TIMESTAMPTZ NOT NULL,
  end_time          TIMESTAMPTZ NOT NULL,
  
  -- Type & linked shift
  period_type       TEXT DEFAULT 'standard',
  linked_roster_shift_id UUID,               -- If before/after a regular shift
  
  -- Rate configuration
  on_call_rate_id   UUID,
  flat_rate_amount       NUMERIC(10, 2),
  
  -- Status
  status            TEXT DEFAULT 'scheduled', -- scheduled, active, completed, cancelled
  
  -- Summary (populated on completion)
  callout_count      INTEGER DEFAULT 0,
  total_callout_hours NUMERIC(8, 2) DEFAULT 0,
  on_call_pay_amount    NUMERIC(10, 2),       -- Pay for being on-call
  callout_pay_amount    NUMERIC(10, 2),       -- Pay for actual callouts
  travel_pay_amount     NUMERIC(10, 2),       -- Travel allowance total
  total_pay_amount      NUMERIC(10, 2)        -- Grand total
);
```

#### `callout_shifts`
Ad-hoc shifts from on-call callouts with 3-hour minimum.

```sql
CREATE TABLE callout_shifts (
  id                UUID PRIMARY KEY,
  organization_id   UUID NOT NULL,
  officer_id        UUID NOT NULL,
  on_call_period_id UUID NOT NULL,           -- Parent on-call period
  
  -- Callout details
  callout_reason    TEXT,
  callout_address   TEXT,
  callout_latitude  NUMERIC(10, 7),
  callout_longitude NUMERIC(10, 7),
  
  -- Timing
  callout_received_at   TIMESTAMPTZ,
  departed_at           TIMESTAMPTZ,
  arrived_at            TIMESTAMPTZ,
  work_started_at       TIMESTAMPTZ,
  work_ended_at         TIMESTAMPTZ,
  returned_at           TIMESTAMPTZ,
  
  -- Hours (THE KEY BUSINESS RULE)
  actual_work_hours     NUMERIC(8, 2),       -- What they actually worked
  minimum_hours         NUMERIC(5, 2) DEFAULT 3,  -- 3hr minimum
  billable_hours        NUMERIC(8, 2),       -- MAX(actual, minimum)
  
  -- Pay calculation
  callout_hourly_rate        NUMERIC(10, 2),
  callout_after_minimum_rate NUMERIC(10, 2),
  base_pay_amount       NUMERIC(10, 2),      -- minimum × rate
  additional_pay_amount NUMERIC(10, 2),      -- (billable - minimum) × after_rate
  total_pay_amount      NUMERIC(10, 2),
  
  status            TEXT DEFAULT 'in_progress'
);
```

#### `travel_allowances`
Per-callout travel tracking.

```sql
CREATE TABLE travel_allowances (
  id                UUID PRIMARY KEY,
  organization_id   UUID NOT NULL,
  officer_id        UUID NOT NULL,
  callout_shift_id  UUID,                    -- Link to callout
  
  -- Journey
  journey_type      TEXT DEFAULT 'round_trip', -- outbound, return, round_trip
  origin_office_id  UUID,                    -- Reference office
  distance_km           NUMERIC(10, 2),
  is_outside_jurisdiction BOOLEAN DEFAULT false,
  
  -- Time tracking
  travel_duration_minutes INTEGER,
  
  -- Rates
  rate_per_km           NUMERIC(10, 4),
  rate_per_hour         NUMERIC(10, 2),
  
  -- Pay
  distance_pay_amount   NUMERIC(10, 2),      -- km × rate_per_km
  time_pay_amount       NUMERIC(10, 2),      -- hours × rate_per_hour
  total_pay_amount      NUMERIC(10, 2),
  
  status            TEXT DEFAULT 'pending'   -- pending, approved, rejected, paid
);
```

---

## 3. Pay Calculation Examples

### 3.1 Example: Short Callout (Under Minimum)

**Scenario:** Officer on-call for 12 hours (6pm-6am). Gets called out at 2am for a noise complaint. Works 45 minutes on scene.

| Component | Calculation | Amount |
|-----------|-------------|--------|
| On-Call Pay | 12hr × $0 (flat rate $60) | $60.00 |
| Callout Work | 0.75hrs actual, **3hrs billable** | |
| Base Pay | 3hrs × $45/hr | $135.00 |
| Additional Pay | 0hrs × $35/hr | $0.00 |
| Travel (40km round trip) | 40 × $0.85/km | $34.00 |
| Travel Time (1hr total) | 1hr × $25/hr | $25.00 |
| **Total** | | **$254.00** |

### 3.2 Example: Long Callout (Over Minimum)

**Scenario:** Same officer, but works 5 hours on a major incident.

| Component | Calculation | Amount |
|-----------|-------------|--------|
| On-Call Pay | Flat rate | $60.00 |
| Callout Work | 5hrs actual, **5hrs billable** | |
| Base Pay | 3hrs × $45/hr | $135.00 |
| Additional Pay | 2hrs × $35/hr | $70.00 |
| Travel (40km) | 40 × $0.85/km | $34.00 |
| Travel Time (1hr) | 1hr × $25/hr | $25.00 |
| **Total** | | **$324.00** |

### 3.3 Example: Split On-Call (Before/After Shift)

**Scenario:** Officer works regular 8-hour shift (7am-3pm) but is on-call 5am-7am before and 3pm-8pm after.

| Period | Duration | Rate Type | Amount |
|--------|----------|-----------|--------|
| Before Shift (5am-7am) | 2hrs | Before-shift rate $30 flat | $30.00 |
| Regular Shift | 8hrs | Normal hourly | (separate pay) |
| After Shift (3pm-8pm) | 5hrs | After-shift rate $40 flat | $40.00 |
| **On-Call Total** | | | **$70.00** |

---

## 4. Helper Functions

### 4.1 Distance Calculation

```sql
-- Calculate distance between two GPS points (Haversine formula)
SELECT calculate_distance_km(
  -36.8485, 174.7633,  -- Auckland CBD
  -36.7201, 174.6972   -- North Shore
);
-- Returns: 15.2 (km)
```

### 4.2 Jurisdiction Check

```sql
-- Check if location is within office jurisdiction
SELECT is_within_jurisdiction(
  'office-uuid-here',    -- Office ID
  -36.8485,              -- Latitude
  174.7633               -- Longitude
);
-- Returns: true/false
```

### 4.3 Callout Pay Calculation

```sql
-- Calculate callout pay with 3hr minimum rule
SELECT * FROM calculate_callout_pay(
  0.75,    -- actual_hours (45 min)
  3,       -- minimum_hours
  45.00,   -- callout_rate
  35.00    -- after_minimum_rate
);
-- Returns:
--   billable_hours: 3.00
--   base_pay: 135.00
--   additional_pay: 0.00
--   total_pay: 135.00

SELECT * FROM calculate_callout_pay(
  5.0,     -- actual_hours (5 hours)
  3,       -- minimum_hours
  45.00,   -- callout_rate
  35.00    -- after_minimum_rate
);
-- Returns:
--   billable_hours: 5.00
--   base_pay: 135.00
--   additional_pay: 70.00
--   total_pay: 205.00
```

---

## 5. Workflow

### 5.1 Creating On-Call Periods

```typescript
// Admin creates on-call period for officer
const { data, error } = await supabase
  .from('on_call_periods')
  .insert({
    organization_id: orgId,
    officer_id: officerId,
    start_time: '2026-05-15T18:00:00+12:00',
    end_time: '2026-05-16T06:00:00+12:00',
    period_type: 'overnight',
    on_call_rate_id: rateId,
    flat_rate_amount: 60.00
  });
```

### 5.2 Officer Accepts On-Call

```typescript
// Officer accepts on-call assignment
await supabase
  .from('on_call_periods')
  .update({
    officer_accepted: true,
    officer_accepted_at: new Date().toISOString()
  })
  .eq('id', periodId)
  .eq('officer_id', currentUserId);
```

### 5.3 Dispatcher Creates Callout

```typescript
// When a callout is needed
const { data: callout } = await supabase
  .from('callout_shifts')
  .insert({
    organization_id: orgId,
    officer_id: officerId,
    on_call_period_id: periodId,
    callout_reason: 'Noise complaint at 123 Main St',
    callout_address: '123 Main Street, Auckland',
    callout_latitude: -36.8485,
    callout_longitude: 174.7633,
    callout_hourly_rate: 45.00,
    callout_after_minimum_rate: 35.00,
    minimum_hours: 3
  });
```

### 5.4 Officer Completes Callout

```typescript
// Officer completes work
await supabase
  .from('callout_shifts')
  .update({
    work_ended_at: new Date().toISOString(),
    status: 'completed'
  })
  .eq('id', calloutId);

// Trigger auto-calculates billable_hours and pay amounts
```

### 5.5 Adding Travel Allowance

```typescript
// Travel allowance for the callout
await supabase
  .from('travel_allowances')
  .insert({
    organization_id: orgId,
    officer_id: officerId,
    callout_shift_id: calloutId,
    journey_type: 'round_trip',
    origin_office_id: officeId,
    distance_km: 40,
    travel_duration_minutes: 60,
    rate_per_km: 0.85,
    rate_per_hour: 25.00,
    distance_pay_amount: 34.00,
    time_pay_amount: 25.00,
    total_pay_amount: 59.00
  });
```

---

## 6. RLS Policies

| Table | Role | Access |
|-------|------|--------|
| `office_locations` | Admin | Full CRUD |
| `office_locations` | Officer | Read only |
| `on_call_rates` | Admin | Full CRUD |
| `on_call_rates` | Officer | Read own org rates |
| `officer_on_call_rates` | Admin | Full CRUD |
| `officer_on_call_rates` | Officer | Read own |
| `on_call_periods` | Admin | Full CRUD |
| `on_call_periods` | Officer | Read/update own |
| `callout_shifts` | Admin | Full CRUD |
| `callout_shifts` | Officer | Full CRUD own (pending/in_progress) |
| `travel_allowances` | Admin | Full CRUD |
| `travel_allowances` | Officer | Full CRUD own (pending only) |

---

## 7. Integration Points

### 7.1 Roster Planner Integration

On-call periods can be linked to roster shifts:

```sql
-- On-call before a shift
INSERT INTO on_call_periods (
  ...
  period_type = 'before_shift',
  linked_roster_shift_id = 'shift-uuid'
);
```

### 7.2 Dispatch Console Integration

Callouts can be created from the dispatch console when jobs come in during on-call hours.

### 7.3 Timesheet/Payroll Integration

The `total_pay_amount` from `on_call_periods` flows into payroll:
- `on_call_pay_amount` — Pay for availability
- `callout_pay_amount` — Pay for actual work (with 3hr minimum)
- `travel_pay_amount` — Travel reimbursement

---

## 8. Future Enhancements

### Phase 2: On-Call Reporting
- Dashboard showing on-call coverage gaps
- Cost analysis per period/officer
- Callout frequency analytics

### Phase 3: Mobile Officer App
- On-call acceptance via mobile
- One-tap callout start
- GPS auto-tracking for travel

### Phase 4: Automated Scheduling
- AI-suggested on-call rotations
- Fatigue management (max on-call hours)
- Holiday/public holiday premiums

---

## 9. Migration Reference

**Migration File:** `20260511000001_oncall_rostering_and_callout_shifts.sql`

**Tables Created:**
1. `office_locations` — Travel reference points
2. `on_call_rates` — Rate configurations
3. `officer_on_call_rates` — Per-officer overrides
4. `on_call_periods` — On-call assignments
5. `callout_shifts` — Ad-hoc callout work
6. `travel_allowances` — Travel reimbursement

**Functions Created:**
- `calculate_distance_km(lat1, lng1, lat2, lng2)` — GPS distance
- `is_within_jurisdiction(office_id, lat, lng)` — Jurisdiction check
- `calculate_callout_billable_hours(actual, minimum)` — Min hours rule
- `calculate_callout_pay(actual, min, rate, after_rate)` — Full pay calc

**Triggers:**
- `trg_auto_calculate_callout_pay` — Auto-calc on callout completion
- `trg_update_on_call_period_summary` — Update period totals

---

*Document Version: 1.0*
*Created: May 2026*
*Author: Platform Enhancement Team*
