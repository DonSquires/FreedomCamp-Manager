# 📋 STREAMLINED REPORTING & ALERT WORKFLOW

**Date:** February 11, 2026  
**Status:** ✅ **IMPLEMENTATION READY**

---

## 🎯 **EXECUTIVE SUMMARY**

The field officer reporting and alert system has been redesigned with:

1. **Unified Report Creation** - Single interface for Incident/H&S/Maintenance attachable to Vehicle, Zone, Person, or Standalone
2. **Person Records System** - Track individuals (tent dwellers, homeless persons) with full interaction history
3. **Priority-Based Alert Queue** - Critical alerts cannot be dismissed, all alerts work in background, full audit trail
4. **Background Notifications** - Service worker integration ensures alerts work even when app is backgrounded

---

## 📊 **CURRENT STATE vs. STREAMLINED STATE**

### **BEFORE (Current Implementation)**

```
Report Creation:
├── IncidentCreationForm.tsx (vehicle-only)
├── HSReportingForm.tsx (vehicle-only)
└── MaintenanceReportForm.tsx (vehicle-only)

Alerts:
├── AlertAcknowledgementModal.tsx (4 types, disconnected)
├── DuplicateScanModal.tsx (separate logic)
└── OfficerWelfareWarningModal.tsx (can be dismissed)

Person Records:
└── ❌ No UI (database table exists but unused)
```

**Issues:**
- ❌ Can't report tent encampments (no zone-only reports)
- ❌ Can't track individual people
- ❌ Alerts don't work in background
- ❌ No audit trail for acknowledgements
- ❌ Welfare alerts can be ignored

---

### **AFTER (Streamlined Implementation)**

```
Unified Report Creation:
└── UnifiedReportModal.tsx
    ├── Type: Incident | H&S | Maintenance
    ├── Attach To: Vehicle | Zone | Person | Standalone
    ├── Person Selector (inline creation)
    ├── GPS Auto-capture
    └── Photo Upload

Person Records:
└── PersonRecordsManager.tsx
    ├── Create/Edit Person
    ├── Link to Zones/Vehicles
    ├── View Interaction History
    └── Homeless Status Tracking

Alert System:
└── UnifiedAlertQueue.tsx
    ├── Priority Levels (Critical → Low)
    ├── Background Service Worker
    ├── Mandatory Acknowledgement (Critical)
    └── Full Audit Trail

Database:
├── alert_queue (priority-based)
├── alert_acknowledgements (audit)
└── person_interactions (history)
```

**Benefits:**
- ✅ Zone-based reports (tent encampments, H&S issues)
- ✅ Person tracking with full history
- ✅ Background alerts via service worker
- ✅ Auditable acknowledgements
- ✅ Critical alerts cannot be dismissed

---

## 🗂️ **DATABASE SCHEMA ENHANCEMENTS**

### **1. Alert Queue Table**

```sql
CREATE TABLE IF NOT EXISTS alert_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  -- Alert classification
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'breach_detected',
    'homeless_in_breach',
    'flagged_vehicle',
    'hs_issue',
    'welfare_warning',
    'welfare_critical',
    'duplicate_scan',
    'new_vehicle',
    'compliant_scan'
  )),
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  
  -- Alert content
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  
  -- Linked entities
  vehicle_id UUID REFERENCES canonical_vehicles(plate_number) ON DELETE SET NULL,
  zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  person_id UUID REFERENCES person_records(id) ON DELETE SET NULL,
  observation_id UUID REFERENCES observations(observation_id) ON DELETE SET NULL,
  
  -- Alert state
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'actioned', 'expired')),
  requires_acknowledgement BOOLEAN DEFAULT TRUE,
  can_dismiss BOOLEAN DEFAULT TRUE, -- Critical alerts set to FALSE
  expires_at TIMESTAMPTZ,
  
  -- Acknowledgement tracking
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  acknowledgement_notes TEXT,
  
  -- Background notification
  push_sent BOOLEAN DEFAULT FALSE,
  push_sent_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT nz_now(),
  updated_at TIMESTAMPTZ DEFAULT nz_now()
);

CREATE INDEX idx_alert_queue_user_status ON alert_queue(user_id, status);
CREATE INDEX idx_alert_queue_priority ON alert_queue(priority DESC, created_at DESC);
CREATE INDEX idx_alert_queue_type ON alert_queue(alert_type);
CREATE INDEX idx_alert_queue_pending ON alert_queue(user_id, status) WHERE status = 'pending';
```

### **2. Person Interactions Table**

```sql
CREATE TABLE IF NOT EXISTS person_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES person_records(id) ON DELETE CASCADE,
  
  -- Interaction details
  interaction_type TEXT NOT NULL CHECK (interaction_type IN (
    'first_contact',
    'welfare_check',
    'incident_report',
    'hs_report',
    'maintenance_report',
    'trespass_notice',
    'homeless_verification',
    'id_verification',
    'follow_up'
  )),
  
  -- Location
  zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  gps_latitude NUMERIC(10,8),
  gps_longitude NUMERIC(11,8),
  
  -- Officer
  officer_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  officer_notes TEXT,
  
  -- Linked records
  vehicle_id UUID REFERENCES canonical_vehicles(plate_number) ON DELETE SET NULL,
  incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  hs_report_id UUID REFERENCES health_safety_reports(id) ON DELETE SET NULL,
  
  -- Evidence
  photos TEXT[],
  attachments JSONB,
  
  -- Outcome
  outcome TEXT,
  requires_follow_up BOOLEAN DEFAULT FALSE,
  follow_up_date DATE,
  
  interaction_at TIMESTAMPTZ DEFAULT nz_now(),
  created_at TIMESTAMPTZ DEFAULT nz_now()
);

CREATE INDEX idx_person_interactions_person ON person_interactions(person_id, interaction_at DESC);
CREATE INDEX idx_person_interactions_officer ON person_interactions(officer_id, interaction_at DESC);
CREATE INDEX idx_person_interactions_type ON person_interactions(interaction_type);
CREATE INDEX idx_person_interactions_follow_up ON person_interactions(requires_follow_up, follow_up_date);
```

### **3. Enhanced Person Records**

```sql
-- Add additional fields to person_records
ALTER TABLE person_records
  ADD COLUMN IF NOT EXISTS tent_location_description TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_association UUID REFERENCES canonical_vehicles(plate_number) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS freedom_camping_act_applies BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trespass_notice_issued BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trespass_notice_date DATE,
  ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_interactions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical'));

COMMENT ON COLUMN person_records.tent_location_description IS 'Description of tent/structure location within zone';
COMMENT ON COLUMN person_records.vehicle_association IS 'Vehicle this person is associated with (if applicable)';
COMMENT ON COLUMN person_records.freedom_camping_act_applies IS 'Whether Freedom Camping Act regulations apply to this person';
COMMENT ON COLUMN person_records.trespass_notice_issued IS 'Whether a trespass notice has been issued';
COMMENT ON COLUMN person_records.risk_level IS 'Risk assessment level for officer safety';
```

---

## 🎨 **COMPONENT ARCHITECTURE**

### **1. UnifiedReportModal**

**File:** `src/components/features/UnifiedReportModal.tsx`

**Features:**
- Single modal for all report types
- Step-based wizard:
  1. Select Report Type (Incident/H&S/Maintenance)
  2. Select Attachment (Vehicle/Zone/Person/Standalone)
  3. Capture Details (GPS, Photos, Notes)
  4. Review & Submit
- Inline person creation
- Photo capture with GPS tagging
- Template-based forms for each type

**Props:**
```typescript
interface UnifiedReportModalProps {
  open: boolean;
  onClose: () => void;
  
  // Pre-fill options (from context)
  defaultType?: 'incident' | 'hs' | 'maintenance';
  defaultVehicle?: { plateNumber: string; vehicleId?: string };
  defaultZone?: { zoneId: string; zoneName: string };
  defaultPerson?: { personId: string; personName: string };
  
  onSuccess: (reportId: string) => void;
}
```

---

### **2. PersonRecordsManager**

**File:** `src/components/features/PersonRecordsManager.tsx`

**Features:**
- List all person records with filters
- Create new person record (inline or modal)
- Edit existing records
- View full interaction history
- Link to vehicles and zones
- Homeless verification workflow
- ID verification tracking

**Views:**
- **List View**: Grid of person cards with key info
- **Detail View**: Full person profile with interaction timeline
- **Create/Edit Form**: Person details capture
- **Interaction History**: Timeline of all contacts

---

### **3. UnifiedAlertQueue**

**File:** `src/components/features/UnifiedAlertQueue.tsx`

**Features:**
- Priority-based alert display (Critical → Low)
- Background notification integration
- Mandatory acknowledgement for critical alerts
- Detail capture on acknowledgement
- Alert expiry handling
- Audit trail display

**Alert Priority Mapping:**
```typescript
const ALERT_PRIORITY_MAP = {
  // CRITICAL - Cannot dismiss, requires action
  welfare_critical: { priority: 'critical', canDismiss: false },
  flagged_vehicle: { priority: 'critical', canDismiss: false },
  
  // HIGH - Requires acknowledgement
  breach_detected: { priority: 'high', canDismiss: true },
  hs_issue: { priority: 'high', canDismiss: true },
  welfare_warning: { priority: 'high', canDismiss: true },
  
  // MEDIUM - Requires review
  duplicate_scan: { priority: 'medium', canDismiss: true },
  
  // LOW - Informational (auto-dismiss)
  homeless_fc_exempt: { priority: 'low', canDismiss: true }, // NEW: Homeless vehicles exempt from FC Act
  new_vehicle: { priority: 'low', canDismiss: true },
  compliant_scan: { priority: 'low', canDismiss: true },
};

// ⚠️ CRITICAL CHANGE: homeless_in_breach removed - homeless vehicles are FC Act exempt
```

---

## 🔄 **WORKFLOW EXAMPLES**

### **Example 1: Tent Encampment Report**

```
Officer arrives at zone and sees tent with person
    ↓
1. Tap "Create Report" → Select "H&S Report"
    ↓
2. Attach To: "Person + Zone"
    ↓
3. Create Person:
   - Name: John Doe
   - DOB: Unknown
   - Tent Location: "Near south carpark, blue tent"
   - Homeless Status: Claimed
    ↓
4. Capture Evidence:
   - GPS: Auto-captured
   - Photos: Tent + surroundings
   - Notes: "Person claims homeless status, tent setup appears recent"
    ↓
5. Submit → Creates:
   - Person Record
   - H&S Report (linked to person + zone)
   - Person Interaction Log
   - Alert (if H&S issue detected)
```

---

### **Example 2: Homeless Vehicle Detected (FC Act Exempt)**

```
Officer scans vehicle → Homeless status detected
    ↓
LOW-LEVEL INFORMATIONAL ALERT:
"ℹ️ HOMELESS VEHICLE (FC ACT EXEMPT)
ABC123 - Homeless status confirmed
ℹ️ Freedom Camping Act does NOT apply - observation recorded for tracking"
    ↓
Officer sees informational bubble:
- Amber warning color
- "Homeless (FC Exempt)" message
- Auto-dismisses after 3 seconds
    ↓
No mandatory action required:
- Observation recorded automatically
- Zone compliance checked (informational only)
- Officer can optionally add notes via vehicle details
    ↓
Continue scanning - no workflow interruption
```

**Key Change:** Homeless vehicles are **exempt from Freedom Camping Act enforcement**. Officers still record observations for tracking purposes, but no critical alerts or mandatory evidence capture required.

---

### **Example 3: Welfare Alert (Critical)**

```
Officer hasn't responded to GPS ping in 15 minutes
    ↓
Backend creates CRITICAL WELFARE ALERT
    ↓
Service Worker sends PUSH NOTIFICATION:
"🚨 WELFARE CHECK REQUIRED
Officer [Name] - Last seen 15 min ago at [Location]"
    ↓
Admin sees alert in dashboard:
- Cannot dismiss
- Must acknowledge with action:
  1. "Contact Officer" → Phone call initiated
  2. "Escalate" → Emergency services notified
  3. "Resolved" → Requires notes: "Officer confirmed safe, phone issue"
    ↓
All actions logged in alert_acknowledgements table
```

---

## 📱 **BACKGROUND NOTIFICATION SYSTEM**

### **Service Worker Integration**

```typescript
// public/sw.js enhancement
self.addEventListener('push', (event) => {
  const data = event.data.json();
  
  // Show notification even if app is closed
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.message,
      icon: '/jds-security-logo.png',
      badge: '/jds-security-logo.png',
      tag: data.alertId,
      requireInteraction: data.priority === 'critical', // Persist until acknowledged
      data: {
        alertId: data.alertId,
        alertType: data.alertType,
        url: data.url || '/field',
      },
      actions: data.priority === 'critical' ? [
        { action: 'open', title: 'Open App' },
        { action: 'acknowledge', title: 'Acknowledge' },
      ] : [
        { action: 'open', title: 'View' },
      ],
    })
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'acknowledge') {
    // Send acknowledgement to backend
    fetch('/api/acknowledge-alert', {
      method: 'POST',
      body: JSON.stringify({ alertId: event.notification.data.alertId }),
    });
  }
  
  // Open app to relevant screen
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
```

---

## 🔍 **AUDIT TRAIL**

### **Alert Acknowledgement Tracking**

Every alert acknowledgement creates an audit record:

```sql
CREATE TABLE IF NOT EXISTS alert_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES alert_queue(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  -- Acknowledgement details
  acknowledged_at TIMESTAMPTZ DEFAULT nz_now(),
  acknowledgement_type TEXT NOT NULL CHECK (acknowledgement_type IN (
    'dismissed',
    'actioned',
    'escalated',
    'resolved'
  )),
  
  -- Evidence
  notes TEXT,
  action_taken TEXT,
  evidence_photos TEXT[],
  
  -- Linked actions
  report_created_id UUID, -- Links to incidents/hs_reports/etc
  follow_up_required BOOLEAN DEFAULT FALSE,
  follow_up_date DATE,
  
  -- Device context
  gps_latitude NUMERIC(10,8),
  gps_longitude NUMERIC(11,8),
  device_info JSONB,
  
  created_at TIMESTAMPTZ DEFAULT nz_now()
);

CREATE INDEX idx_alert_acks_alert ON alert_acknowledgements(alert_id);
CREATE INDEX idx_alert_acks_user ON alert_acknowledgements(user_id, acknowledged_at DESC);
```

**Audit Query Example:**
```sql
-- Get all welfare alerts that were dismissed vs. actioned
SELECT 
  aq.alert_type,
  aq.priority,
  aq.created_at,
  aa.acknowledgement_type,
  aa.acknowledged_at,
  aa.notes,
  up.first_name || ' ' || up.last_name AS officer_name
FROM alert_queue aq
JOIN alert_acknowledgements aa ON aa.alert_id = aq.id
JOIN user_profiles up ON up.id = aa.user_id
WHERE aq.alert_type LIKE 'welfare_%'
  AND aq.created_at >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY aq.created_at DESC;
```

---

## ✅ **IMPLEMENTATION CHECKLIST**

### **Phase 1: Unified Report Creation (30 min)**
- [ ] Create `UnifiedReportModal.tsx`
- [ ] Implement step-based wizard UI
- [ ] Person selector with inline creation
- [ ] GPS auto-capture
- [ ] Photo upload integration
- [ ] Submit handlers for all 3 report types

### **Phase 2: Person Records System (20 min)**
- [ ] Create `PersonRecordsManager.tsx`
- [ ] Person list view with filters
- [ ] Person detail view with interaction history
- [ ] Create/edit person form
- [ ] Link person to vehicles/zones
- [ ] Homeless verification workflow

### **Phase 3: Unified Alert Queue (40 min)**
- [ ] Create `UnifiedAlertQueue.tsx`
- [ ] Priority-based alert sorting
- [ ] Critical alert mandatory acknowledgement
- [ ] Detail capture on acknowledgement
- [ ] Background notification integration
- [ ] Audit trail display

### **Phase 4: Database Migrations (15 min)**
- [ ] Create `alert_queue` table
- [ ] Create `alert_acknowledgements` table
- [ ] Create `person_interactions` table
- [ ] Enhance `person_records` table
- [ ] Create indexes

### **Phase 5: Service Worker Enhancement (15 min)**
- [ ] Update `public/sw.js` for push notifications
- [ ] Add notification click handlers
- [ ] Test background notifications
- [ ] Test critical alert persistence

### **Phase 6: Integration & Testing (30 min)**
- [ ] Replace existing report forms with unified modal
- [ ] Replace alert modals with unified queue
- [ ] Test all workflows (vehicle, zone, person)
- [ ] Test background notifications
- [ ] Verify audit trail creation
- [ ] Test offline functionality

**Total Estimated Time:** ~2.5 hours

---

## 🎯 **SUMMARY**

The streamlined reporting and alert system provides:

✅ **Unified Report Creation**
- Single modal for Incident/H&S/Maintenance
- Attachable to Vehicle, Zone, Person, or Standalone
- Inline person creation
- GPS and photo capture built-in

✅ **Person Records System**
- Track individuals (tent dwellers, homeless)
- Full interaction history
- Link to zones and vehicles
- Homeless status verification

✅ **Priority-Based Alert Queue**
- Critical alerts cannot be dismissed
- Background notifications via service worker
- Mandatory acknowledgement for critical alerts
- Full audit trail

✅ **Background Capability**
- Service worker integration
- Push notifications work when app closed
- Critical alerts persist until acknowledged
- All alerts audited in database

✅ **Freedom Camping Act Exemption for Homeless**
- Homeless vehicles are **exempt** from FC Act enforcement
- Low-level informational alerts (no mandatory action)
- Observations still recorded for tracking
- Zone compliance checked (informational only)
- Officers can optionally add notes/evidence

**Status:** ✅ **READY FOR IMPLEMENTATION**
