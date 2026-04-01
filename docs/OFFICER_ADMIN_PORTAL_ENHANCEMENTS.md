# Officer & Admin Portal Enhancement — Industry Inspiration

## Executive Summary

Based on analysis of Wilson Security's WILSAR system, their mobile app "Wilson: OnTime", and industry leaders like TrackTik, PatrolX, QR-Patrol, and GuardTrack, this document outlines enhancements to elevate FreedomCamp Manager's officer and admin portals to enterprise-grade standards.

---

## 1. Officer Portal Enhancements (Inspired by Wilson: OnTime)

### 1.1 Current Features vs. Wilson: OnTime

| Feature | FreedomCamp Manager | Wilson: OnTime | Gap |
|---------|---------------------|----------------|-----|
| View Rosters | ✅ RosterPlanner | ✅ | — |
| Shift Sign On/Off | ✅ Clock in/out | ✅ | — |
| Welfare Checks | ✅ "I'm OK" button | ✅ | — |
| Duress/SOS Alarm | ⚠️ Basic | ✅ Discrete duress | **Enhance** |
| Payslips | ❌ | ✅ | **Add** |
| Site Details | ⚠️ Zone info only | ✅ Comprehensive | **Enhance** |
| Cold Start Registration | ❌ | ✅ | **Add** |
| GPS Patrol Tracking | ✅ | ✅ | — |
| Checkpoint Scanning | ⚠️ GPS only | ✅ NFC/QR/GPS | **Add NFC/QR** |
| Incident Reporting | ✅ Observations | ✅ | — |
| Offline Mode | ⚠️ Limited | ✅ Full | **Enhance** |

### 1.2 New Features to Add

#### A. Cold Start Registration
Allow officers to indicate intention to attend a shift ahead of time:

```typescript
// Officer Portal - Cold Start Button
interface ColdStartRegistration {
  shift_id: string
  officer_id: string
  registered_at: timestamp
  expected_arrival_time?: timestamp
  notes?: string
  status: 'registered' | 'confirmed' | 'cancelled'
}
```

**UI**: Add "I'm Coming" button on upcoming shifts, visible 2 hours before shift start.

#### B. Discrete Duress Alarm (SOS)
Enhanced panic button with:
- Triple-tap anywhere on screen to trigger
- Fake "call ended" screen while silently alerting NOC
- Sends GPS, audio recording, and alerts supervisors
- Integrates with National Operations Centre

```sql
CREATE TABLE public.duress_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id UUID NOT NULL REFERENCES user_profiles(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Alert details
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_method TEXT CHECK (trigger_method IN ('button', 'triple_tap', 'voice', 'fall_detection')),
  
  -- Location
  gps_lat DECIMAL(10, 7),
  gps_lng DECIMAL(11, 7),
  gps_accuracy_meters INTEGER,
  address TEXT,
  
  -- Evidence
  audio_recording_url TEXT,
  video_url TEXT,
  
  -- Response
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES user_profiles(id),
  response_notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolution TEXT,
  
  -- False alarm handling
  is_false_alarm BOOLEAN DEFAULT FALSE,
  false_alarm_reason TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### C. NFC/QR Checkpoint Scanning
Add hardware-based checkpoint verification:

```typescript
// Enhanced checkpoint scan
interface CheckpointScan {
  checkpoint_id: string
  patrol_id: string
  
  // Scan method
  scan_type: 'gps' | 'nfc' | 'qr' | 'manual'
  
  // NFC data
  nfc_tag_uid?: string
  nfc_payload?: string
  
  // QR data  
  qr_code_data?: string
  
  // GPS verification (always captured)
  gps_lat: number
  gps_lng: number
  gps_accuracy: number
  
  // Timestamp
  scanned_at: timestamp
  device_time: timestamp // Local device time
  
  // Evidence
  photo_url?: string
  notes?: string
}
```

**NFC Implementation**:
```typescript
// Use Web NFC API (Chrome Android only)
async function scanNFCCheckpoint(): Promise<string> {
  if (!('NDEFReader' in window)) {
    throw new Error('NFC not supported on this device')
  }
  
  const ndef = new NDEFReader()
  await ndef.scan()
  
  return new Promise((resolve, reject) => {
    ndef.onreading = (event) => {
      const record = event.message.records[0]
      resolve(new TextDecoder().decode(record.data))
    }
    ndef.onerror = reject
  })
}
```

#### D. Site Information Hub
Comprehensive site details accessible to officers:

```typescript
interface SiteInfo {
  // Basic
  name: string
  address: string
  client_name: string
  
  // Contacts
  key_holder_contacts: Contact[]
  emergency_contacts: Contact[]
  client_contacts: Contact[]
  
  // Access
  access_instructions: string
  alarm_codes?: string  // Only shown when on-site
  key_location?: string
  
  // Standing orders
  patrol_instructions: string
  checkpoint_requirements: Checkpoint[]
  special_instructions: string[]
  
  // Documents
  site_map_url?: string
  emergency_procedures_url?: string
  
  // History
  recent_incidents: Incident[]
  common_issues: string[]
}
```

#### E. Payslip Access
If integrated with payroll:

```typescript
interface Payslip {
  id: string
  officer_id: string
  pay_period_start: Date
  pay_period_end: Date
  gross_pay: number
  deductions: Deduction[]
  net_pay: number
  hours_worked: number
  overtime_hours: number
  pdf_url: string
  paid_date: Date
}
```

---

## 2. Admin Portal Enhancements (Inspired by WILSAR/DASH)

### 2.1 WILSAR-Style Features

#### A. Centralized Operations Dashboard
Real-time command centre showing:
- Live officer locations on map
- Active patrols with progress indicators
- Pending dispatch jobs with SLA timers
- Welfare check status (green/yellow/red)
- Duress alerts (flashing)
- Checkpoint completion rates

```typescript
interface OperationsDashboard {
  // Officers
  officers_on_duty: number
  officers_with_active_patrol: number
  officers_needing_welfare_check: number
  officers_in_duress: number
  
  // Jobs
  pending_jobs: number
  dispatched_jobs: number
  jobs_breaching_sla: number
  
  // Patrols
  active_patrols: number
  patrols_behind_schedule: number
  checkpoints_scanned_today: number
  checkpoint_completion_rate: number
  
  // Incidents
  open_incidents: number
  incidents_today: number
  
  // Map data
  officer_positions: OfficerPosition[]
  job_locations: JobLocation[]
  zone_boundaries: Zone[]
}
```

#### B. Dispatch Integration (Like Patriot)
Enhanced dispatch workflow:

```typescript
interface DispatchWorkflow {
  // Sources
  sources: ('manual' | 'alarm_monitoring' | 'client_portal' | 'api')[]
  
  // Auto-assignment
  auto_assign_enabled: boolean
  assignment_rules: AssignmentRule[]
  
  // Escalation
  escalation_levels: EscalationLevel[]
  
  // Status updates
  status_updates_to_client: boolean
  client_notification_preferences: NotificationPreference[]
}

interface AssignmentRule {
  priority: number
  conditions: {
    job_type?: string[]
    zone_id?: string
    client_id?: string
    time_of_day?: { start: string; end: string }
  }
  assign_to: {
    type: 'nearest_officer' | 'specific_officer' | 'patrol_route' | 'skill_based'
    officer_id?: string
    route_id?: string
    required_skills?: string[]
  }
}
```

#### C. Client Self-Service Portal (DASH-Style)
Allow clients to:
- View patrol reports and checkpoint scans
- See incident reports for their sites
- Download compliance reports
- Request additional patrols
- View officer assigned to their site

```sql
CREATE TABLE public.client_portal_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Access credentials
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  
  -- Permissions
  can_view_patrol_reports BOOLEAN DEFAULT TRUE,
  can_view_incidents BOOLEAN DEFAULT TRUE,
  can_request_patrols BOOLEAN DEFAULT FALSE,
  can_view_officer_details BOOLEAN DEFAULT FALSE,
  can_download_reports BOOLEAN DEFAULT TRUE,
  
  -- Sites access
  site_ids UUID[] DEFAULT '{}',  -- Empty = all sites
  
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### D. Real-Time Accountability
Like TrackTik's "verified patrol accountability":

```typescript
interface PatrolAccountability {
  patrol_id: string
  
  // Expected vs Actual
  expected_checkpoints: number
  scanned_checkpoints: number
  missed_checkpoints: Checkpoint[]
  
  // Timing
  expected_duration_minutes: number
  actual_duration_minutes: number
  
  // GPS verification
  gps_coverage_percent: number  // % of time with valid GPS
  
  // Exceptions
  exceptions: PatrolException[]
}

interface PatrolException {
  type: 'missed_checkpoint' | 'late_start' | 'early_end' | 'off_route' | 'no_gps'
  timestamp: timestamp
  details: string
  acknowledged: boolean
  explanation?: string
}
```

---

## 3. Mobile-First Best Practices (2024 Industry Standards)

### 3.1 Offline-First Architecture
```typescript
// Service Worker for offline patrol tracking
interface OfflineCapabilities {
  // Queue actions when offline
  queuedActions: OfflineAction[]
  
  // Cached data
  cachedSites: Site[]
  cachedCheckpoints: Checkpoint[]
  cachedPatrolRoutes: PatrolRoute[]
  
  // Sync status
  lastSyncAt: timestamp
  pendingSync: number
}

// Auto-sync when back online
async function syncOfflineData() {
  const actions = await getQueuedActions()
  for (const action of actions) {
    try {
      await executeAction(action)
      await markActionSynced(action.id)
    } catch (error) {
      // Retry later
      await incrementRetryCount(action.id)
    }
  }
}
```

### 3.2 Evidence-Rich Incident Reporting
```typescript
interface IncidentReport {
  // Classification
  incident_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  
  // Location
  gps_lat: number
  gps_lng: number
  address: string
  site_id?: string
  
  // Evidence
  photos: Photo[]
  videos: Video[]
  audio_notes: AudioNote[]
  
  // People involved
  witnesses: Witness[]
  subjects: Subject[]
  
  // Actions taken
  actions_taken: string[]
  authorities_notified: string[]
  
  // Follow-up
  follow_up_required: boolean
  assigned_to?: string
}
```

### 3.3 Smart Notifications
```typescript
interface NotificationPreferences {
  // Channels
  push_enabled: boolean
  sms_enabled: boolean
  email_enabled: boolean
  
  // Categories
  shift_reminders: boolean
  welfare_alerts: boolean
  dispatch_jobs: boolean
  roster_changes: boolean
  duress_alerts: boolean  // Always on for supervisors
  
  // Timing
  quiet_hours_start?: string
  quiet_hours_end?: string
  
  // Frequency
  digest_mode: boolean  // Batch non-urgent notifications
}
```

---

## 4. Implementation Roadmap

### Phase 1: Officer Portal Quick Wins (Week 1-2)
- [ ] Add Cold Start registration button
- [ ] Enhance site info display with contacts and instructions
- [ ] Add discrete duress trigger (triple-tap)
- [ ] Improve offline capabilities

### Phase 2: Checkpoint Scanning (Week 3-4)
- [ ] Add QR code scanning (camera-based)
- [ ] Add NFC scanning (Chrome Android)
- [ ] Photo evidence on checkpoint scan
- [ ] Checklist completion at checkpoints

### Phase 3: Admin Dashboard (Week 5-6)
- [ ] Real-time operations dashboard
- [ ] Live map with officer/job pins
- [ ] SLA breach alerts
- [ ] Patrol accountability reports

### Phase 4: Client Portal (Week 7-8)
- [ ] Client login system
- [ ] Report viewing
- [ ] Patrol request form
- [ ] Compliance report downloads

### Phase 5: Advanced Features (Week 9-10)
- [ ] Auto-dispatch rules
- [ ] Escalation workflows
- [ ] Analytics dashboard
- [ ] Payslip integration (if applicable)

---

## 5. Database Schema Additions

```sql
-- Cold start registrations
CREATE TABLE public.shift_cold_starts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES rostered_shifts(id),
  officer_id UUID NOT NULL REFERENCES user_profiles(id),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_arrival_time TIMESTAMPTZ,
  notes TEXT,
  status TEXT DEFAULT 'registered' CHECK (status IN ('registered', 'confirmed', 'cancelled')),
  UNIQUE (shift_id, officer_id)
);

-- Duress alerts (SOS)
CREATE TABLE public.duress_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id UUID NOT NULL REFERENCES user_profiles(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_method TEXT CHECK (trigger_method IN ('button', 'triple_tap', 'voice', 'fall_detection', 'timer')),
  gps_lat DECIMAL(10, 7),
  gps_lng DECIMAL(11, 7),
  gps_accuracy_meters INTEGER,
  address TEXT,
  audio_recording_url TEXT,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES user_profiles(id),
  response_notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolution TEXT,
  is_false_alarm BOOLEAN DEFAULT FALSE,
  false_alarm_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Client portal access
CREATE TABLE public.client_portal_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  can_view_patrol_reports BOOLEAN DEFAULT TRUE,
  can_view_incidents BOOLEAN DEFAULT TRUE,
  can_request_patrols BOOLEAN DEFAULT FALSE,
  can_view_officer_details BOOLEAN DEFAULT FALSE,
  can_download_reports BOOLEAN DEFAULT TRUE,
  site_ids UUID[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Patrol exceptions/accountability
CREATE TABLE public.patrol_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_id UUID NOT NULL REFERENCES patrols(id),
  exception_type TEXT NOT NULL CHECK (exception_type IN (
    'missed_checkpoint', 'late_start', 'early_end', 'off_route', 
    'no_gps', 'extended_break', 'unauthorized_area'
  )),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details TEXT,
  checkpoint_id UUID REFERENCES patrol_route_checkpoints(id),
  gps_lat DECIMAL(10, 7),
  gps_lng DECIMAL(11, 7),
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_by UUID REFERENCES user_profiles(id),
  acknowledged_at TIMESTAMPTZ,
  explanation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Client patrol requests
CREATE TABLE public.client_patrol_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID REFERENCES client_sites(id),
  requested_by UUID REFERENCES client_portal_users(id),
  request_type TEXT NOT NULL CHECK (request_type IN (
    'additional_patrol', 'welfare_check', 'alarm_response', 'escort', 'other'
  )),
  description TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  requested_date DATE,
  requested_time_start TIME,
  requested_time_end TIME,
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'scheduled', 'completed', 'cancelled'
  )),
  notes TEXT,
  handled_by UUID REFERENCES user_profiles(id),
  handled_at TIMESTAMPTZ,
  dispatch_job_id UUID REFERENCES dispatch_jobs(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 6. UI/UX Recommendations

### Officer Portal
1. **Bottom Navigation**: Home, Jobs, Patrol, Welfare, More
2. **Quick Actions**: Floating action button for common tasks
3. **Status Bar**: Always visible shift/patrol status
4. **One-Tap Actions**: Minimize form filling in the field
5. **High Contrast Mode**: For outdoor/night use

### Admin Portal  
1. **Dashboard First**: Operations overview as landing page
2. **Map-Centric**: Large interactive map as primary view
3. **Real-Time Updates**: WebSocket for live data
4. **Drill-Down**: Click anything to see details
5. **Export Everything**: PDF/Excel for compliance

---

*Document Version: 1.0*
*Created: March 2026*
*Based on: Wilson Security WILSAR, TrackTik, PatrolX, QR-Patrol, GuardTrack*
