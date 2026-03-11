# THOROUGH INVESTIGATION: TWO PAGES RETURNING NO RESULTS

## Executive Summary

**Two pages have critical database schema mismatches that prevent data from displaying:**

1. **Incident Management Page** - Missing 4 required columns
2. **Vehicle Management Page** - 6 column name/type mismatches

Both issues cause queries to fail silently or return empty result sets.

---

## DETAILED FINDINGS

### PAGE 1: INCIDENT MANAGEMENT (`/src/pages/IncidentManagement.tsx`)

#### Supabase Query Structure

The page executes a single query to fetch incidents:

```typescript
let query = supabase
  .from('incidents')
  .select('*')
  .order('recorded_at', { ascending: false })

// Applied filters:
if (startDate) { query = query.gte('recorded_at', startDate) }
if (endDate) { query = query.lte('recorded_at', endDate) }
if (effectiveOrganizationId) { query = query.eq('organization_id', effectiveOrganizationId) }
if (zoneId) { query = query.eq('zone_id', zoneId) }
if (statusFilter && statusFilter !== 'all') { query = query.eq('status', statusFilter) }
if (searchTerm) { query = query.or(`plate_number.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`) }

const { data, error } = await query.limit(100)
```

**Query targets:** `incidents` table with filters on organization_id, zone_id, status, recorded_at

#### Actual Database Schema (Migration: 20260224000003_incident_evidence_system.sql)

```sql
CREATE TABLE IF NOT EXISTS public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'processing', 'complete', 'failed')),
  plate_number TEXT,
  alpr_confidence NUMERIC(3,2),
  alpr_provider TEXT,
  alpr_raw_response JSONB,
  alpr_processed_at TIMESTAMPTZ,
  alpr_retry_count INTEGER DEFAULT 0,
  evidence_count INTEGER DEFAULT 0,
  primary_evidence_url TEXT,
  location_lat NUMERIC(10,8),
  location_lng NUMERIC(11,8),
  location_address TEXT,
  retention_hold BOOLEAN DEFAULT FALSE,
  retention_until TIMESTAMPTZ,
  retention_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  incident_type TEXT,
  description TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);
```

#### Frontend Expected Schema (TypeScript Interface, Lines 14-26)

```typescript
interface Incident {
  id: string                    // ✅ EXISTS
  organization_id: string       // ✅ EXISTS
  zone_id: string              // ❌ MISSING
  plate_number: string          // ✅ EXISTS
  incident_type: string         // ✅ EXISTS
  severity: string             // ❌ MISSING
  status: string               // ✅ EXISTS
  description: string          // ✅ EXISTS
  recorded_at: string          // ❌ MISSING (table has created_at)
  created_at: string           // ✅ EXISTS
  attachments: any[]           // ❌ MISSING
}
```

#### Critical Issues

| # | Issue | Location | Problem | Impact | Fix |
|---|-------|----------|---------|--------|-----|
| 1 | Missing `zone_id` | Line 57-58 | Filter references non-existent column | **BLOCKING** - Query fails or returns empty | ADD COLUMN zone_id UUID REFERENCES zones(id) |
| 2 | Missing `severity` | Lines 19, 73-81 | Column doesn't exist; interface expects it | UI renders undefined; severity badges fail | ADD COLUMN severity TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low')) |
| 3 | Wrong timestamp | Lines 45, 49-52 | Code uses `recorded_at` but table has `created_at` | Date filters & ordering don't work | Either ADD recorded_at OR change code to created_at |
| 4 | Missing `attachments` | Lines 25, 178-184 | Column doesn't exist; code tries to access .length | UI crashes on rendering | ADD COLUMN attachments JSONB DEFAULT '[]'::jsonb |

#### Why Page Returns "No Incidents Found"

**Primary blocking issue:** Line 57-58
```typescript
if (zoneId) {
  query = query.eq('zone_id', zoneId)  // ❌ zone_id column doesn't exist
}
```

When a zoneId is provided in the global filter:
- Supabase attempts to filter on non-existent `zone_id` column
- PostgreSQL returns an error: "column 'zone_id' of relation 'incidents' does not exist"
- Error is caught in error handler (line 68): `if (error) throw error`
- Frontend treats this as zero results
- User sees: "No incidents found"

**If zoneId is not filtered**, secondary issue occurs:
- Code orders by `recorded_at` (line 45) which doesn't exist
- Returns empty set or error
- Same "No incidents found" result

---

### PAGE 2: VEHICLE MANAGEMENT (`/src/pages/VehicleManagement.tsx`)

#### Supabase Query Structure

The page executes two related queries:

**Query 1 - Match observations by filters (Lines 108-127):**
```typescript
let matchingObservationsQuery = supabase
  .from('observations')
  .select('plate_number')

if (effectiveOrganizationId) {
  matchingObservationsQuery = matchingObservationsQuery.eq('organization_id', effectiveOrganizationId)
}
if (zoneId) {
  matchingObservationsQuery = matchingObservationsQuery.eq('zone_id', zoneId)
}
if (dateFrom) {
  matchingObservationsQuery = matchingObservationsQuery.gte('recorded_at', `${dateFrom}T00:00:00Z`)
}
if (dateTo) {
  matchingObservationsQuery = matchingObservationsQuery.lte('recorded_at', `${dateTo}T23:59:59Z`)
}

const { data: matchingObservations, error: matchingObsError } = await matchingObservationsQuery
```

**Query 2 - Get canonical vehicles (Lines 101-156):**
```typescript
let query = supabase
  .from('canonical_vehicles')
  .select('*')
  .order('plate_number', { ascending: true })

// ... apply status filters ...

if (searchQuery) {
  query = query.or(`plate_number.ilike.%${searchQuery}%,make.ilike.%${searchQuery}%,model.ilike.%${searchQuery}%`)
}

if (statusFilter === 'compliant') {
  query = query.eq('total_breaches', 0)
} else if (statusFilter === 'breaches') {
  query = query.gt('total_breaches', 0)
} else if (statusFilter === 'homeless') {
  query = query.in('homeless_status', HOMELESS_UI_STATUSES)
} else if (statusFilter === 'exempt') {
  query = query.eq('is_exempt', true)  // ❌ Column doesn't exist
}

const { data, error } = await query
```

**Query 3 - Fetch photos for vehicles with missing photos (Lines 164-175):**
```typescript
let latestObsQuery = supabase
  .from('observations')
  .select('plate_number, photo_url, recorded_at')
  .in('plate_number', missingPhotoPlates)
  .not('photo_url', 'is', null)
  .order('recorded_at', { ascending: false })
```

#### Actual Database Schema

**canonical_vehicles (Migration: 20250203000002_rebuild_vehicle_architecture.sql):**

| Schema Column | Type | Frontend Expected | Match? | Notes |
|---|---|---|---|---|
| plate_number | TEXT PRIMARY KEY | id (should be string) | ❌ WRONG | Frontend expects id field; schema uses plate_number as PK |
| vehicle_make | TEXT | make | ❌ NAME MISMATCH | Column is vehicle_make; code references make |
| vehicle_model | TEXT | model | ❌ NAME MISMATCH | Column is vehicle_model; code references model |
| vehicle_year | INTEGER | year | ❌ NAME MISMATCH | Column is vehicle_year; code references year |
| vehicle_color | TEXT | colour | ❌ SPELLING MISMATCH | US spelling 'color' vs UK spelling 'colour' |
| self_contained | BOOLEAN | self_contained | ✅ | Exact match |
| self_contained_expiry | DATE | self_contained_expiry | ✅ | Exact match |
| homeless_status | TEXT | homeless_status | ✅ | Exact match |
| is_flagged | BOOLEAN | is_exempt | ❌ WRONG COLUMN | Code expects is_exempt; table has is_flagged (different meaning) |
| profile_photo | TEXT | profile_photo | ✅ | Exact match |
| total_observations | INTEGER | total_observations | ✅ | Exact match |
| total_breaches | INTEGER | total_breaches | ✅ | Exact match |
| — | — | enforcement_count | ❌ MISSING | Code expects this column; doesn't exist |
| — | — | last_enforcement_at | ❌ MISSING | Code expects this column; doesn't exist |

#### Frontend Expected Schema (Lines 23-39)

```typescript
interface Vehicle {
  id: string                              // ❌ Primary key mismatch
  plate_number: string                    // ✅ EXISTS
  make: string | null                     // ❌ Schema: vehicle_make
  model: string | null                    // ❌ Schema: vehicle_model
  year: number | null                     // ❌ Schema: vehicle_year
  colour: string | null                   // ❌ Schema: vehicle_color
  self_contained: boolean                 // ✅ EXISTS
  self_contained_expiry: string | null    // ✅ EXISTS
  homeless_status: string | null          // ✅ EXISTS
  is_exempt: boolean                      // ❌ Schema: is_flagged
  enforcement_count: number               // ❌ MISSING
  last_enforcement_at: string | null      // ❌ MISSING
  profile_photo: string | null            // ✅ EXISTS
  total_observations: number              // ✅ EXISTS
  total_breaches: number                  // ✅ EXISTS
}
```

#### Critical Issues

| # | Issue | Location | Problem | Impact | Fix |
|---|-------|----------|---------|--------|-----|
| 1 | Column name: make | Line 140 | Search filter uses `make` not `vehicle_make` | **BLOCKING** - Search query fails | RENAME vehicle_make TO make OR update code |
| 2 | Column name: model | Line 140 | Search filter uses `model` not `vehicle_model` | **BLOCKING** - Search query fails | RENAME vehicle_model TO model OR update code |
| 3 | Column name: year | Line 140, 476 | Display uses `year` not `vehicle_year` | Display field undefined; breaks UI | RENAME vehicle_year TO year OR update code |
| 4 | Spelling: colour vs color | Line 29, 480, 582 | Schema has `vehicle_color`; code uses `colour` | Color display undefined; data access fails | RENAME vehicle_color TO vehicle_colour OR use color |
| 5 | Wrong exemption column | Line 150 | Tries to filter on `is_exempt` which doesn't exist; table has `is_flagged` | **BLOCKING** - Filter query fails | ADD is_exempt BOOLEAN OR rename is_flagged |
| 6 | Missing enforcement fields | Lines 34-35, 599 | Code expects `enforcement_count` and `last_enforcement_at` | Cannot display enforcement stats; UI crashes | ADD COLUMNS to canonical_vehicles OR query from enforcement_cases |
| 7 | Primary key mismatch | Line 24 | Code expects `id` field but canonical_vehicles uses `plate_number` as PK | Row identification fails; sorting may break | ADD id UUID PRIMARY KEY OR change code |

#### Why Page Returns "No Vehicles Found"

**Primary blocking issue:** Line 140
```typescript
if (searchQuery) {
  query = query.or(`plate_number.ilike.%${searchQuery}%,make.ilike.%${searchQuery}%,model.ilike.%${searchQuery}%`)
  //                                                    ^^^^                   ^^^^^
  // ❌ Columns 'make' and 'model' don't exist; table has 'vehicle_make' and 'vehicle_model'
}
```

When searchQuery is provided:
- Supabase attempts to filter on non-existent `make` and `model` columns
- PostgreSQL returns error: "column 'make' of relation 'canonical_vehicles' does not exist"
- Error is caught in error handler (line 155): `if (error) throw error`
- Frontend treats this as zero results
- User sees: "No vehicles found"

**Secondary blocking issue:** Line 150
```typescript
} else if (statusFilter === 'exempt') {
  query = query.eq('is_exempt', true)  // ❌ is_exempt column doesn't exist
}
```

When exempt filter is selected:
- Query tries to filter on `is_exempt` which doesn't exist
- Returns error or empty set
- User sees: "No vehicles found"

**Tertiary issue:** Lines 143-146
```typescript
if (statusFilter === 'compliant') {
  query = query.eq('total_breaches', 0)
} else if (statusFilter === 'breaches') {
  query = query.gt('total_breaches', 0)
}
```

These work (columns exist), but if combined with search or exempt filter above, final query fails.

---

## COMPARISON TABLE

| Aspect | Incidents Page | Vehicle Management Page |
|--------|---|---|
| **Table exists?** | ✅ Yes | ✅ Yes |
| **Primary blocking issue** | Missing zone_id column | Column name mismatches (make, model) |
| **Query fails on** | Line 57-58 zone filter | Line 140 search filter |
| **Missing columns** | 4 (zone_id, severity, recorded_at, attachments) | 6 total: 3 name mismatches + 2 missing + 1 PK mismatch |
| **Name mismatches** | 0 | 4 (make, model, year/vehicle_year, colour/color) |
| **Timestamp issues** | recorded_at doesn't exist | observations has recorded_at ✓ |
| **Severity of impact** | Query-blocking when filters applied | Query-blocking on search or exempt filter |

---

## RECOMMENDED SOLUTIONS

### IMMEDIATE FIX (Frontend Code - 30 minutes)

**VehicleManagement.tsx:**
1. Line 140: Change `make` → `vehicle_make`, `model` → `vehicle_model`
2. Line 29: Change `colour` → `color` (and update all references)
3. Line 150: Remove or comment out `is_exempt` filter
4. Lines 34-35: Remove enforcement_count and last_enforcement_at from Vehicle interface
5. Line 24: Use plate_number as the unique identifier instead of id

**IncidentManagement.tsx:**
1. Line 45: Change `recorded_at` → `created_at` in order()
2. Lines 49-52: Change `recorded_at` → `created_at` in filters
3. Lines 57-58: Remove zone_id filter (replace with different logic or remove entirely)
4. Line 25: Remove attachments from Incident interface
5. Lines 73-81: Remove severity display or set default value

### PROPER FIX (Database Schema - 1-2 hours)

Create new migration file (e.g., `20260401_fix_schema_mismatches.sql`):

```sql
-- ============================================================================
-- FIX SCHEMA MISMATCHES FOR INCIDENT AND VEHICLE PAGES
-- ============================================================================

-- 1. FIX INCIDENTS TABLE
ALTER TABLE public.incidents
ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES public.zones(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low')),
ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ DEFAULT created_at,
ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_incidents_zone ON public.incidents(zone_id);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON public.incidents(severity);

-- 2. FIX CANONICAL_VEHICLES TABLE
-- Add missing columns
ALTER TABLE canonical_vehicles
ADD COLUMN IF NOT EXISTS id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS is_exempt BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS enforcement_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_enforcement_at TIMESTAMPTZ;

-- Rename columns for consistency with frontend expectations
ALTER TABLE canonical_vehicles
RENAME COLUMN vehicle_make TO make;

ALTER TABLE canonical_vehicles
RENAME COLUMN vehicle_model TO model;

ALTER TABLE canonical_vehicles
RENAME COLUMN vehicle_year TO year;

ALTER TABLE canonical_vehicles
RENAME COLUMN vehicle_color TO colour;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_is_exempt ON canonical_vehicles(is_exempt);
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_enforcement ON canonical_vehicles(enforcement_count);
```

Then update TypeScript interfaces to match the new schema.

---

## VERIFICATION CHECKLIST

After implementing fixes, verify:

- [ ] Incident Management page: loads incidents when global filters applied
- [ ] Incident Management page: zone filter works correctly
- [ ] Incident Management page: date filters work correctly
- [ ] Incident Management page: severity badges display with colors
- [ ] Vehicle Management page: search by make/model works
- [ ] Vehicle Management page: exempt filter works
- [ ] Vehicle Management page: color field displays correctly
- [ ] Vehicle Management page: all status filters work (compliant, breaches, homeless, exempt)
- [ ] Both pages: no console errors when loading data
- [ ] Both pages: TypeScript compiles without type errors

---

## ROOT CAUSE ANALYSIS

**Why did this happen?**

1. **Schema Evolution:** The database schema was built incrementally through migrations, with some columns using prefixes (vehicle_make, vehicle_color) and others using short names.

2. **Frontend Assumptions:** The frontend code was written with assumptions about column names that don't match the actual schema (make vs vehicle_make, colour vs vehicle_color).

3. **Lack of Synchronization:** No validation or integration tests to ensure frontend and database schema remain synchronized.

4. **Missing Columns:** New columns (zone_id in incidents, enforcement tracking in vehicles) were never added even though frontend code references them.

5. **Silent Failures:** Supabase query errors are caught and treated as "no results" rather than logged or displayed, making debugging difficult.

---

## PREVENTION RECOMMENDATIONS

1. **Code Generation:** Generate TypeScript types from database schema (e.g., using Supabase's type generation)
2. **Integration Tests:** Add tests that verify frontend pages can fetch data (with valid test data)
3. **Type Safety:** Use strict type checking to catch column name mismatches at compile time
4. **Schema Validation:** Add database constraints and checks for commonly-mismatched columns
5. **Error Logging:** Log all Supabase errors instead of silently treating them as empty results
6. **Documentation:** Keep a mapping document of schema column names vs frontend names

