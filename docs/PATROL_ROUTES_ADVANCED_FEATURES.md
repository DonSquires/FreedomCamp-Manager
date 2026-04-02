# Patrol Routes & Advanced Features Enhancement

## Executive Summary

This document outlines the comprehensive enhancement of the patrol management system to support:
1. **Named Patrol Routes** — Permanent patrol definitions with checkpoints
2. **User Rostering** — Assigning officers to patrol routes on a schedule
3. **Job Dispatch to Patrols** — Sending work to active patrol routes
4. **GPS Geofence Automation** — Auto check-in/out, presence verification
5. **Welfare Check Automation** — Movement-aware wellness monitoring
6. **Cross-Organization PTT/Chat** — Authorization-based communication channels

---

## 1. Named Patrol Routes System

### 1.1 Problem Statement

Currently, patrols are created ad-hoc per zone/date. There's no concept of:
- **Permanent patrol routes** (e.g., "Nelson CBD Evening", "Airport Perimeter Night")
- **Checkpoint sequences** within a route
- **Expected patrol duration** and coverage metrics

### 1.2 Solution: Patrol Route Templates

```sql
-- ============================================================================
-- PATROL ROUTES — Permanent named patrol templates
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.patrol_routes (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Route identification
  route_name            TEXT        NOT NULL,               -- "Nelson CBD Evening Patrol"
  route_code            TEXT        UNIQUE,                 -- "NCC-EVE-01" for dispatch
  description           TEXT,
  
  -- Route type
  route_type            TEXT        NOT NULL DEFAULT 'regular'
                          CHECK (route_type IN (
                            'regular',       -- Standard patrol
                            'mobile',        -- Vehicle-based patrol
                            'static',        -- Fixed-post security
                            'roving',        -- Random coverage
                            'response'       -- Alarm/incident response
                          )),
  
  -- Default timing
  default_shift         TEXT        DEFAULT 'day' CHECK (default_shift IN ('day', 'swing', 'night')),
  default_start_time    TIME,       -- e.g., '18:00'
  default_end_time      TIME,       -- e.g., '06:00'
  expected_duration_minutes INTEGER,
  
  -- Coverage
  primary_zone_id       UUID        REFERENCES public.zones(id),
  secondary_zone_ids    UUID[]      DEFAULT '{}',
  client_site_ids       UUID[]      DEFAULT '{}',  -- Client sites covered
  
  -- Checkpoint configuration
  checkpoint_mode       TEXT        DEFAULT 'sequential'
                          CHECK (checkpoint_mode IN (
                            'sequential',    -- Must visit in order
                            'any_order',     -- Visit all, any order
                            'random',        -- Visit X of N checkpoints
                            'none'           -- No checkpoints required
                          )),
  min_checkpoints_required INTEGER,  -- For 'random' mode
  
  -- Recurrence
  active_days           INTEGER[]   DEFAULT '{1,2,3,4,5,6,7}',  -- 1=Mon, 7=Sun
  is_active             BOOLEAN     DEFAULT TRUE,
  
  -- Metadata
  color                 TEXT        DEFAULT '#3B82F6',  -- For UI display
  icon                  TEXT        DEFAULT 'route',
  tags                  TEXT[]      DEFAULT '{}',
  
  created_by            UUID        REFERENCES public.user_profiles(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PATROL CHECKPOINTS — Required scan/visit points within a route
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.patrol_route_checkpoints (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_route_id       UUID        NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  
  -- Checkpoint info
  name                  TEXT        NOT NULL,               -- "Main Entrance", "Loading Bay"
  description           TEXT,
  
  -- Location (for GPS verification)
  location_lat          DECIMAL(10, 7),
  location_lng          DECIMAL(11, 7),
  geofence_radius_meters INTEGER    DEFAULT 50,
  
  -- Sequence
  sequence_order        INTEGER     NOT NULL DEFAULT 0,     -- For sequential routes
  
  -- Scan requirements
  scan_type             TEXT        DEFAULT 'gps'
                          CHECK (scan_type IN (
                            'gps',           -- GPS proximity
                            'nfc',           -- NFC tag scan
                            'qr',            -- QR code scan
                            'manual'         -- Manual confirmation
                          )),
  nfc_tag_id            TEXT,       -- For NFC scans
  qr_code_data          TEXT,       -- For QR scans
  
  -- Timing
  expected_arrival_offset_minutes INTEGER,  -- Minutes from patrol start
  max_time_at_checkpoint_minutes INTEGER DEFAULT 15,
  
  -- Task requirements
  required_actions      JSONB       DEFAULT '[]',
  /* Example:
  [
    {"type": "photo", "description": "Photo of locked gate"},
    {"type": "checklist", "items": ["Doors locked", "Lights off", "Alarm set"]},
    {"type": "reading", "field": "meter_reading"}
  ]
  */
  
  is_mandatory          BOOLEAN     DEFAULT TRUE,
  is_active             BOOLEAN     DEFAULT TRUE,
  
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_patrol_routes_org ON patrol_routes(organization_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_patrol_checkpoints_route ON patrol_route_checkpoints(patrol_route_id);
```

### 1.3 Route Assignment to Zones/Sites

```sql
-- Many-to-many: Routes can cover multiple zones
CREATE TABLE IF NOT EXISTS public.patrol_route_zones (
  patrol_route_id       UUID        NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  zone_id               UUID        NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  coverage_priority     INTEGER     DEFAULT 1,  -- Higher = more important
  PRIMARY KEY (patrol_route_id, zone_id)
);

-- Many-to-many: Routes can cover multiple client sites
CREATE TABLE IF NOT EXISTS public.patrol_route_sites (
  patrol_route_id       UUID        NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  site_id               UUID        NOT NULL REFERENCES public.client_sites(id) ON DELETE CASCADE,
  coverage_priority     INTEGER     DEFAULT 1,
  PRIMARY KEY (patrol_route_id, site_id)
);
```

---

## 2. User Rostering System

### 2.1 Problem Statement

Officers need to be assigned to patrol routes on a recurring basis (rostered), not just ad-hoc daily assignments.

### 2.2 Solution: Roster Management

```sql
-- ============================================================================
-- ROSTER TEMPLATES — Weekly/monthly roster patterns
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.roster_templates (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  name                  TEXT        NOT NULL,               -- "Week A", "Standard Rotation"
  description           TEXT,
  
  -- Template type
  template_type         TEXT        DEFAULT 'weekly'
                          CHECK (template_type IN ('weekly', 'fortnightly', 'monthly')),
  
  -- Active period
  effective_from        DATE,
  effective_to          DATE,
  
  is_active             BOOLEAN     DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- ROSTER ASSIGNMENTS — Officer assignments to patrol routes
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.roster_assignments (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  roster_template_id    UUID        REFERENCES public.roster_templates(id) ON DELETE SET NULL,
  
  -- Who
  officer_id            UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  -- What
  patrol_route_id       UUID        NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  
  -- When (for recurring)
  day_of_week           INTEGER     CHECK (day_of_week BETWEEN 1 AND 7),  -- 1=Mon
  shift                 TEXT        NOT NULL CHECK (shift IN ('day', 'swing', 'night')),
  start_time            TIME,
  end_time              TIME,
  
  -- OR specific date (for one-off)
  specific_date         DATE,
  
  -- Status
  assignment_status     TEXT        DEFAULT 'scheduled'
                          CHECK (assignment_status IN (
                            'scheduled',
                            'confirmed',     -- Officer accepted
                            'declined',      -- Officer declined
                            'swapped',       -- Swapped with another officer
                            'cancelled'
                          )),
  
  -- Swap tracking
  swapped_with_id       UUID        REFERENCES public.roster_assignments(id),
  swap_reason           TEXT,
  
  -- Notification
  notification_sent_at  TIMESTAMPTZ,
  accepted_at           TIMESTAMPTZ,
  declined_at           TIMESTAMPTZ,
  decline_reason        TEXT,
  
  created_by            UUID        REFERENCES public.user_profiles(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraint: Either recurring (day_of_week) or specific (specific_date)
  CHECK (
    (day_of_week IS NOT NULL AND specific_date IS NULL) OR
    (day_of_week IS NULL AND specific_date IS NOT NULL)
  )
);

-- Index for efficient roster lookup
CREATE INDEX IF NOT EXISTS idx_roster_officer ON roster_assignments(officer_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_roster_route ON roster_assignments(patrol_route_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_roster_date ON roster_assignments(specific_date) WHERE specific_date IS NOT NULL;
```

### 2.3 Roster Notification Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Roster Created │────▶│  Notify Officer │────▶│ Officer Reviews │
│   (Admin/Master)│     │  (Push + In-App)│     │   (Mobile App)  │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                        ┌────────────────────────────────┼────────────────────────────────┐
                        │                                │                                │
                        ▼                                ▼                                ▼
              ┌─────────────────┐            ┌─────────────────┐            ┌─────────────────┐
              │    Accepted     │            │    Declined     │            │   Swap Request  │
              │ (Auto-schedule) │            │ (Re-assign req) │            │ (Peer approval) │
              └─────────────────┘            └─────────────────┘            └─────────────────┘
```

---

## 3. Job Dispatch to Patrol Routes

### 3.1 Problem Statement

When a job/task is created, it should be dispatchable to:
1. A specific officer
2. The officer currently on a specific patrol route
3. Any available officer in a zone

### 3.2 Solution: Enhanced Dispatch System

```sql
-- Add patrol_route_id to dispatch_jobs
ALTER TABLE public.dispatch_jobs ADD COLUMN IF NOT EXISTS
  patrol_route_id UUID REFERENCES public.patrol_routes(id);

-- Function to find the current officer on a route
CREATE OR REPLACE FUNCTION get_officer_on_patrol_route(
  p_route_id UUID,
  p_organization_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_officer_id UUID;
BEGIN
  -- Find active patrol on this route
  SELECT p.assigned_to INTO v_officer_id
  FROM patrols p
  WHERE p.patrol_route_id = p_route_id
    AND p.status = 'in_progress'
    AND (p_organization_id IS NULL OR p.organization_id = p_organization_id)
  ORDER BY p.started_at DESC
  LIMIT 1;
  
  RETURN v_officer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to dispatch job to patrol route
CREATE OR REPLACE FUNCTION dispatch_job_to_route(
  p_job_id UUID,
  p_route_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_officer_id UUID;
  v_job RECORD;
BEGIN
  -- Find current officer on route
  SELECT get_officer_on_patrol_route(p_route_id) INTO v_officer_id;
  
  IF v_officer_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'No officer currently on this patrol route'
    );
  END IF;
  
  -- Update job
  UPDATE dispatch_jobs
  SET assigned_to = v_officer_id,
      patrol_route_id = p_route_id,
      status = 'dispatched',
      dispatched_at = NOW()
  WHERE id = p_job_id
  RETURNING * INTO v_job;
  
  -- Create notification
  INSERT INTO notifications (
    user_id, organization_id, type, title, body, data
  ) VALUES (
    v_officer_id,
    v_job.organization_id,
    'job_dispatched',
    'New Job: ' || v_job.title,
    v_job.description,
    jsonb_build_object('job_id', p_job_id, 'route_id', p_route_id)
  );
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'officer_id', v_officer_id,
    'job_id', p_job_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 3.3 Officer Job Notification Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Job Created    │────▶│ Dispatch to     │────▶│ Find Officer on │
│  (Dispatcher)   │     │ Patrol Route    │     │ Active Patrol   │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                        ┌────────────────────────────────┘
                        ▼
              ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
              │  Push Notif +   │────▶│  Officer Acks   │────▶│  Status Updates │
              │  In-App Alert   │     │  on Mobile      │     │  en_route → done│
              └─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## 4. GPS Geofence Automation

### 4.1 Current State

The system already has `src/lib/geofence.ts` with:
- `detectCurrentZones()` — Find zones containing a GPS point
- `autoStartPatrol()` — Start patrol when entering geofence
- `autoStopPatrol()` — Stop patrol when leaving geofence
- `monitorGeofenceAndPatrol()` — Main monitoring function

### 4.2 Enhancement: Checkpoint Auto-Scan

```typescript
// Enhanced geofence.ts additions

interface CheckpointProximity {
  checkpoint_id: string;
  checkpoint_name: string;
  distance_meters: number;
  within_geofence: boolean;
}

/**
 * Check proximity to patrol checkpoints
 */
export async function checkCheckpointProximity(
  patrolId: string,
  userLat: number,
  userLng: number
): Promise<CheckpointProximity[]> {
  // Fetch checkpoints for this patrol's route
  const { data: patrol } = await supabase
    .from('patrols')
    .select('patrol_route_id')
    .eq('id', patrolId)
    .single();
  
  if (!patrol?.patrol_route_id) return [];
  
  const { data: checkpoints } = await supabase
    .from('patrol_route_checkpoints')
    .select('id, name, location_lat, location_lng, geofence_radius_meters')
    .eq('patrol_route_id', patrol.patrol_route_id)
    .eq('is_active', true);
  
  if (!checkpoints) return [];
  
  return checkpoints.map(cp => {
    const distance = calculateDistance(
      userLat, userLng,
      cp.location_lat, cp.location_lng
    );
    return {
      checkpoint_id: cp.id,
      checkpoint_name: cp.name,
      distance_meters: distance,
      within_geofence: distance <= (cp.geofence_radius_meters ?? 50)
    };
  });
}

/**
 * Auto-scan checkpoint when officer enters geofence
 */
export async function autoScanCheckpoint(
  patrolId: string,
  checkpointId: string,
  gpsLat: number,
  gpsLng: number
): Promise<{ success: boolean; message: string }> {
  try {
    const { data, error } = await supabase.rpc('auto_scan_checkpoint', {
      p_patrol_id: patrolId,
      p_checkpoint_id: checkpointId,
      p_gps_lat: gpsLat,
      p_gps_lng: gpsLng
    });
    
    if (error) throw error;
    
    if (data?.success) {
      toast.success(`Checkpoint scanned: ${data.checkpoint_name}`);
    }
    
    return data;
  } catch (error) {
    console.error('Auto-scan checkpoint error:', error);
    return { success: false, message: 'Failed to auto-scan checkpoint' };
  }
}
```

### 4.3 Database Support for Auto-Scan

```sql
-- Checkpoint scan records
CREATE TABLE IF NOT EXISTS public.patrol_checkpoint_scans (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_id             UUID        NOT NULL REFERENCES public.patrols(id) ON DELETE CASCADE,
  checkpoint_id         UUID        NOT NULL REFERENCES public.patrol_route_checkpoints(id),
  
  -- Scan details
  scanned_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scan_method           TEXT        NOT NULL DEFAULT 'gps'
                          CHECK (scan_method IN ('gps', 'nfc', 'qr', 'manual')),
  
  -- Location at scan
  gps_lat               DECIMAL(10, 7),
  gps_lng               DECIMAL(11, 7),
  gps_accuracy_meters   INTEGER,
  
  -- Verification
  auto_verified         BOOLEAN     DEFAULT FALSE,
  verified_by           UUID        REFERENCES public.user_profiles(id),
  
  -- Actions completed
  actions_completed     JSONB       DEFAULT '[]',
  notes                 TEXT,
  
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Function for auto-scanning
CREATE OR REPLACE FUNCTION auto_scan_checkpoint(
  p_patrol_id UUID,
  p_checkpoint_id UUID,
  p_gps_lat DECIMAL,
  p_gps_lng DECIMAL
)
RETURNS JSONB AS $$
DECLARE
  v_checkpoint RECORD;
  v_distance FLOAT;
  v_existing UUID;
BEGIN
  -- Get checkpoint details
  SELECT * INTO v_checkpoint
  FROM patrol_route_checkpoints
  WHERE id = p_checkpoint_id;
  
  IF v_checkpoint IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Checkpoint not found');
  END IF;
  
  -- Check if already scanned today
  SELECT id INTO v_existing
  FROM patrol_checkpoint_scans
  WHERE patrol_id = p_patrol_id
    AND checkpoint_id = p_checkpoint_id
    AND scanned_at::DATE = CURRENT_DATE;
  
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Already scanned today');
  END IF;
  
  -- Calculate distance
  v_distance := earth_distance(
    ll_to_earth(v_checkpoint.location_lat, v_checkpoint.location_lng),
    ll_to_earth(p_gps_lat, p_gps_lng)
  );
  
  -- Verify within geofence
  IF v_distance > COALESCE(v_checkpoint.geofence_radius_meters, 50) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'Not within checkpoint geofence',
      'distance', v_distance
    );
  END IF;
  
  -- Record scan
  INSERT INTO patrol_checkpoint_scans (
    patrol_id, checkpoint_id, scan_method, gps_lat, gps_lng, auto_verified
  ) VALUES (
    p_patrol_id, p_checkpoint_id, 'gps', p_gps_lat, p_gps_lng, TRUE
  );
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'message', 'Checkpoint scanned',
    'checkpoint_name', v_checkpoint.name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 5. Movement-Aware Welfare Monitoring

### 5.1 Problem Statement

Current welfare check-ins are time-based only. If an officer is actively patrolling (GPS moving, scanning plates), they shouldn't need manual check-ins.

### 5.2 Solution: Activity-Based Welfare

```sql
-- Enhanced welfare settings
ALTER TABLE public.officer_welfare_settings ADD COLUMN IF NOT EXISTS
  activity_bypass_enabled     BOOLEAN     DEFAULT TRUE,
  activity_window_minutes     INTEGER     DEFAULT 15,  -- Activity within last N minutes = OK
  min_gps_updates_for_bypass  INTEGER     DEFAULT 3,   -- Min GPS updates in window
  min_actions_for_bypass      INTEGER     DEFAULT 1;   -- Min scans/actions in window

-- Function to check if officer is actively working
CREATE OR REPLACE FUNCTION check_officer_activity(
  p_officer_id UUID,
  p_window_minutes INTEGER DEFAULT 15
)
RETURNS JSONB AS $$
DECLARE
  v_gps_count INTEGER;
  v_action_count INTEGER;
  v_last_gps TIMESTAMPTZ;
  v_last_action TIMESTAMPTZ;
BEGIN
  -- Count GPS updates in window
  SELECT COUNT(*), MAX(recorded_at)
  INTO v_gps_count, v_last_gps
  FROM officer_locations
  WHERE officer_id = p_officer_id
    AND recorded_at >= NOW() - (p_window_minutes || ' minutes')::INTERVAL;
  
  -- Count actions (observations, checkpoint scans, etc.) in window
  SELECT COUNT(*), MAX(recorded_at)
  INTO v_action_count, v_last_action
  FROM (
    SELECT recorded_at FROM observations WHERE recorded_by = p_officer_id
    UNION ALL
    SELECT scanned_at FROM patrol_checkpoint_scans pcs
      JOIN patrols p ON p.id = pcs.patrol_id
      WHERE p.assigned_to = p_officer_id
  ) actions
  WHERE recorded_at >= NOW() - (p_window_minutes || ' minutes')::INTERVAL;
  
  RETURN jsonb_build_object(
    'gps_updates', v_gps_count,
    'actions', v_action_count,
    'last_gps', v_last_gps,
    'last_action', v_last_action,
    'is_active', (v_gps_count >= 3 OR v_action_count >= 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Modified welfare check function
CREATE OR REPLACE FUNCTION should_send_welfare_reminder(
  p_officer_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_settings RECORD;
  v_activity JSONB;
  v_last_checkin TIMESTAMPTZ;
  v_due_at TIMESTAMPTZ;
BEGIN
  -- Get settings
  SELECT * INTO v_settings
  FROM officer_welfare_settings
  WHERE officer_id = p_officer_id;
  
  IF v_settings IS NULL OR v_settings.check_in_interval_minutes = 0 THEN
    RETURN FALSE;  -- Disabled
  END IF;
  
  -- Get last check-in
  SELECT MAX(checked_in_at) INTO v_last_checkin
  FROM welfare_checkins
  WHERE officer_id = p_officer_id;
  
  v_due_at := COALESCE(v_last_checkin, NOW() - INTERVAL '1 hour')
              + (v_settings.check_in_interval_minutes || ' minutes')::INTERVAL;
  
  -- Not yet due
  IF NOW() < v_due_at - INTERVAL '10 minutes' THEN
    RETURN FALSE;
  END IF;
  
  -- Check activity bypass
  IF v_settings.activity_bypass_enabled THEN
    v_activity := check_officer_activity(
      p_officer_id,
      v_settings.activity_window_minutes
    );
    
    IF (v_activity->>'is_active')::BOOLEAN THEN
      -- Auto-extend welfare check
      INSERT INTO welfare_checkins (
        officer_id, organization_id, check_type, notes
      ) VALUES (
        p_officer_id, v_settings.organization_id, 'activity_auto', 'Auto check-in via activity detection'
      );
      RETURN FALSE;  -- No reminder needed
    END IF;
  END IF;
  
  RETURN TRUE;  -- Send reminder
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 5.3 Geofence Entry = Auto Check-In

```typescript
// In geofence.ts - monitorGeofenceAndPatrol()

// After detecting zone entry:
if (enteredNewZone) {
  // Auto welfare check-in on zone entry
  if (options?.autoWelfareOnGeofence !== false) {
    await supabase.rpc('auto_welfare_checkin_geofence', {
      p_officer_id: userId,
      p_zone_id: primaryZone.id,
      p_gps_lat: userLat,
      p_gps_lng: userLng
    });
  }
}
```

---

## 6. Cross-Organization PTT/Chat Authorization

### 6.1 Current State

PTT channels are scoped to:
- `org:<uuid>` — Organization-wide
- `team:<uuid>` — Team/deployment
- `incident:<uuid>` — Incident-specific
- `direct:<uuid>` — 1:1 calls

### 6.2 Problem Statement

Security contractors (e.g., First Security) need to communicate with council staff (e.g., Nelson City Council) when authorized for that contract.

### 6.3 Solution: Authorization-Based Channels

```sql
-- ============================================================================
-- PTT CHANNEL AUTHORIZATIONS — Cross-org communication permissions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ptt_channel_authorizations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- The channel being accessed
  channel_organization_id UUID      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_type          TEXT        NOT NULL DEFAULT 'contract'
                          CHECK (channel_type IN (
                            'contract',      -- Contractor authorized for client
                            'mutual_aid',    -- Inter-agency mutual aid
                            'emergency',     -- Emergency coordination
                            'inter_org'      -- General inter-org comm
                          )),
  
  -- Who is authorized
  authorized_org_id     UUID        REFERENCES public.organizations(id) ON DELETE CASCADE,
  authorized_user_id    UUID        REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  -- Either org OR user, not both
  
  -- Authorization details
  authorization_name    TEXT,       -- "First Security - NCC Contract"
  authorization_reason  TEXT,
  
  -- Validity
  valid_from            TIMESTAMPTZ DEFAULT NOW(),
  valid_until           TIMESTAMPTZ,
  
  -- Permissions
  can_listen            BOOLEAN     DEFAULT TRUE,
  can_transmit          BOOLEAN     DEFAULT TRUE,
  can_create_channels   BOOLEAN     DEFAULT FALSE,
  
  -- Status
  is_active             BOOLEAN     DEFAULT TRUE,
  
  created_by            UUID        REFERENCES public.user_profiles(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  
  CHECK (
    (authorized_org_id IS NOT NULL AND authorized_user_id IS NULL) OR
    (authorized_org_id IS NULL AND authorized_user_id IS NOT NULL)
  )
);

-- Contract-based authorizations (linked to CRM contracts)
CREATE TABLE IF NOT EXISTS public.ptt_contract_authorizations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           UUID        NOT NULL REFERENCES public.crm_contracts(id) ON DELETE CASCADE,
  
  -- Provider org (e.g., First Security)
  provider_org_id       UUID        NOT NULL REFERENCES public.organizations(id),
  
  -- Client org (e.g., Nelson City Council)
  client_org_id         UUID        NOT NULL REFERENCES public.organizations(id),
  
  -- Auto-created channel
  channel_key           TEXT        UNIQUE,  -- "contract:<contract_id>"
  channel_name          TEXT,
  
  -- Which provider staff can access
  all_provider_staff    BOOLEAN     DEFAULT FALSE,
  authorized_roles      TEXT[]      DEFAULT '{}',
  authorized_users      UUID[]      DEFAULT '{}',
  
  -- Status
  is_active             BOOLEAN     DEFAULT TRUE,
  
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (contract_id, provider_org_id, client_org_id)
);
```

### 6.4 Enhanced Token Validation

```typescript
// In ptt-signaling-token/index.ts

// Add contract-based authorization check
async function checkContractAuthorization(
  userId: string,
  userOrgId: string,
  targetOrgId: string
): Promise<{ authorized: boolean; channel?: string; reason?: string }> {
  // Check if user's org has an active contract with target org
  const { data: auth } = await supabase
    .from('ptt_contract_authorizations')
    .select('*, contract:crm_contracts(*)')
    .eq('provider_org_id', userOrgId)
    .eq('client_org_id', targetOrgId)
    .eq('is_active', true)
    .gte('contract.end_date', new Date().toISOString())
    .single();
  
  if (!auth) {
    // Check reverse (client accessing provider channel)
    const { data: reverseAuth } = await supabase
      .from('ptt_contract_authorizations')
      .select('*, contract:crm_contracts(*)')
      .eq('client_org_id', userOrgId)
      .eq('provider_org_id', targetOrgId)
      .eq('is_active', true)
      .single();
    
    if (!reverseAuth) {
      return { authorized: false, reason: 'No active contract authorization' };
    }
    
    return {
      authorized: true,
      channel: `contract:${reverseAuth.contract_id}`
    };
  }
  
  // Check if user is specifically authorized
  if (!auth.all_provider_staff) {
    const isAuthorized = auth.authorized_users.includes(userId) ||
      auth.authorized_roles.some(role => userProfile.role === role);
    
    if (!isAuthorized) {
      return { authorized: false, reason: 'User not authorized for this contract' };
    }
  }
  
  return {
    authorized: true,
    channel: `contract:${auth.contract_id}`
  };
}
```

### 6.5 Channel Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PTT Channel Authorization Flow                        │
└─────────────────────────────────────────────────────────────────────────────┘

  First Security Officer                  Nelson City Council Staff
         │                                        │
         │ "Connect to NCC channel"               │
         ▼                                        │
  ┌─────────────┐                                 │
  │ Check Auth  │◀────────────────────────────────┘
  │ - User org? │    "Connect to First Security channel"
  │ - Contract? │
  │ - Active?   │
  └──────┬──────┘
         │
         ▼
  ┌─────────────────────────────────────┐
  │  ptt_contract_authorizations        │
  │  ─────────────────────────────────  │
  │  contract_id: NCC-FS-2024-001       │
  │  provider_org: First Security       │
  │  client_org: Nelson City Council    │
  │  all_provider_staff: true           │
  │  is_active: true                    │
  └──────┬──────────────────────────────┘
         │
         ▼
  ┌─────────────┐     ┌─────────────┐
  │ PTT Token   │────▶│ Join Channel│
  │ Minted      │     │ contract:*  │
  └─────────────┘     └─────────────┘
```

---

## 7. Implementation Priority

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] `patrol_routes` table and CRUD
- [ ] `patrol_route_checkpoints` table
- [ ] Link existing `patrols` table to `patrol_routes`

### Phase 2: Rostering (Week 3-4)
- [ ] `roster_templates` and `roster_assignments` tables
- [ ] Roster UI in admin portal
- [ ] Officer mobile roster view
- [ ] Notification system for roster changes

### Phase 3: Geofence Automation (Week 5-6)
- [ ] Checkpoint auto-scan via GPS
- [ ] Activity-based welfare bypass
- [ ] Geofence entry auto check-in
- [ ] Zone presence verification

### Phase 4: Cross-Org PTT (Week 7-8)
- [ ] `ptt_channel_authorizations` table
- [ ] `ptt_contract_authorizations` linked to CRM contracts
- [ ] Enhanced token validation
- [ ] Cross-org channel UI

### Phase 5: Job Dispatch Enhancement (Week 9-10)
- [ ] Dispatch to patrol route
- [ ] Route-aware job notifications
- [ ] SLA tracking per route

---

## 8. Industry Inspiration

### 8.1 Apps Reviewed

| App | Key Features Adopted |
|-----|---------------------|
| **TrackTik** | Checkpoint touring, guard tour verification, geofencing |
| **Silvertrac** | Activity-based reporting, incident management |
| **GuardMetrics** | Panic button, GPS tracking, tour tracking |
| **Bringg** | Route optimization, real-time dispatch |
| **ServiceTitan** | Job dispatch, customer notifications |
| **Housecall Pro** | Scheduling, route optimization |
| **Deputy** | Rostering, shift swaps, availability management |
| **When I Work** | Schedule templates, team messaging |

### 8.2 Key Differentiators for FieldOps Manager

1. **NZ Regulatory Focus** — Freedom Camping Act, PSPLA compliance
2. **Multi-Module** — Parking, camping, noise, security in one platform
3. **CRM Integration** — Contracts drive PTT authorizations
4. **Welfare-First** — Lone worker safety built into patrol flow

---

## 9. Database Migration Summary

```sql
-- New tables in this enhancement:
-- 1. patrol_routes
-- 2. patrol_route_checkpoints
-- 3. patrol_route_zones (junction)
-- 4. patrol_route_sites (junction)
-- 5. roster_templates
-- 6. roster_assignments
-- 7. patrol_checkpoint_scans
-- 8. ptt_channel_authorizations
-- 9. ptt_contract_authorizations

-- Modified tables:
-- 1. patrols — Add patrol_route_id column
-- 2. dispatch_jobs — Add patrol_route_id column
-- 3. officer_welfare_settings — Add activity bypass columns
```

---

## 10. API Endpoints Required

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/patrol-routes` | GET, POST | List/create patrol routes |
| `/api/patrol-routes/:id` | GET, PUT, DELETE | Route CRUD |
| `/api/patrol-routes/:id/checkpoints` | GET, POST | Checkpoint management |
| `/api/roster/templates` | GET, POST | Roster template management |
| `/api/roster/assignments` | GET, POST, PUT | Assignment management |
| `/api/roster/my-schedule` | GET | Officer's upcoming shifts |
| `/api/dispatch/to-route/:routeId` | POST | Dispatch job to route |
| `/api/ptt/contract-channels` | GET | List contract-authorized channels |
| `/api/ptt/authorize-org` | POST | Create cross-org authorization |

---

## Appendix: Competitive Analysis

### TrackTik (Enterprise Guard Management)
- ✅ Checkpoint touring with NFC/QR
- ✅ Geofence automation
- ✅ Incident management
- ❌ No NZ-specific compliance

### Silvertrac (Security Officer Tracking)
- ✅ GPS tracking
- ✅ Activity reporting
- ✅ Client portals
- ❌ No freedom camping module

### What FieldOps Manager Does Better
1. **Integrated compliance** — PSPLA, Privacy Act, Freedom Camping Act
2. **Multi-enforcement** — Parking + camping + noise + security
3. **CRM-driven** — Contracts drive everything
4. **PTT built-in** — Not an add-on

---

*Document Version: 1.0*
*Created: March 2026*
*Author: Platform Enhancement Team*
