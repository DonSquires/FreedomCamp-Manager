# Mobile APK Offline-First Architecture Guide
## FreedomCamp Manager - Field Officer APK

---

## 🎯 Core Requirements

### Business Objectives
- **Offline-First Operation**: Function completely offline for 3-4 days
- **Self-Contained Data**: Pre-load all necessary organization data on login
- **Speed Priority**: Local processing, no network calls during field operations
- **Compliance Assessment**: Real-time vehicle overstay/breach detection using cached data
- **Incident Creation**: Offline incident report creation with photo capture
- **Zone-Specific**: All operations scoped to specific zones

### Technical Constraints
- **Platform**: Android APK (React Native/Expo recommended)
- **Storage**: Local SQLite database for cached data
- **Sync**: Background sync when network available
- **GPS**: Continuous location tracking
- **Photos**: Local storage with upload queue
- **Battery**: Optimized for 8-12 hour field shifts

---

## 📊 Network Architecture

### Data Sync Strategy

#### **Phase 1: Login & Initial Sync (WiFi/4G)**

```
┌─────────────────────────────────────────────────────────────┐
│  LOGIN FLOW                                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Authenticate User                                       │
│     ↓                                                       │
│  2. Fetch User Profile (organization_id, role, zones)      │
│     ↓                                                       │
│  3. Select Organization (if master user)                   │
│     ↓                                                       │
│  4. Download Organization Data Package (~5-10 MB)          │
│     ├─ Zones (all active zones for org)                   │
│     ├─ Compliance Matrix (current + last 3 versions)      │
│     ├─ Flagged Vehicles (last 90 days)                    │
│     ├─ Recent Observations (last 7 days)                  │
│     ├─ Vehicle History (top 500 plates by frequency)      │
│     ├─ Canonical Vehicles (metadata for known plates)     │
│     └─ User Profiles (team members for incident reports)  │
│     ↓                                                       │
│  5. Store in Local SQLite Database                         │
│     ↓                                                       │
│  6. Mark Sync Timestamp                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**API Endpoints Required:**
```typescript
// New Edge Function: sync-organization-data
POST /functions/v1/sync-organization-data
Body: { 
  organization_id: string,
  last_sync: timestamp | null,
  days_back: 7 // Download last 7 days of observations
}

Response: {
  zones: Zone[],
  compliance_matrix: ComplianceMatrix[],
  flagged_vehicles: FlaggedVehicle[],
  recent_observations: Observation[],
  vehicle_history: VehicleStaySummary[],
  canonical_vehicles: CanonicalVehicle[],
  team_members: UserProfile[],
  sync_timestamp: timestamp
}
```

#### **Phase 2: Offline Operation (No Network)**

```
┌─────────────────────────────────────────────────────────────┐
│  OFFLINE WORKFLOW                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SCAN VEHICLE                                               │
│    ↓                                                        │
│  Read Plate Number (Camera OCR or Manual Input)            │
│    ↓                                                        │
│  Check Local Database                                      │
│    ├─ Flagged Vehicle? → Show Alert                       │
│    ├─ Recent Observations? → Calculate Stay Duration      │
│    ├─ Compliance Matrix? → Assess Breach Status           │
│    └─ Vehicle History? → Show Past Violations             │
│    ↓                                                        │
│  Display Compliance Assessment (Local Calculation)         │
│    ├─ Consecutive Nights: X/3                             │
│    ├─ Monthly Nights: Y/28                                │
│    ├─ Status: COMPLIANT | WARNING | BREACH                │
│    └─ Last Seen: Date/Time                                │
│    ↓                                                        │
│  ACTIONS (All Offline)                                     │
│    ├─ Record Observation → Local Queue                    │
│    ├─ Take Photos → Local Storage                         │
│    ├─ Create Incident → Local Queue                       │
│    └─ Add Notes → Local Storage                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### **Phase 3: Background Sync (When Network Available)**

```
┌─────────────────────────────────────────────────────────────┐
│  BACKGROUND SYNC QUEUE                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Every 30 minutes (when network detected):                 │
│                                                             │
│  1. Check Network Status (WiFi preferred, 4G acceptable)   │
│     ↓                                                       │
│  2. Process Upload Queue (FIFO order)                      │
│     ├─ Upload Photos First (batch 5 at a time)            │
│     ├─ Sync Observations (batch 20 at a time)             │
│     ├─ Sync Incidents (batch 10 at a time)                │
│     └─ Sync Notes/Edits (batch 50 at a time)              │
│     ↓                                                       │
│  3. Mark Synced Items in Local DB                          │
│     ↓                                                       │
│  4. Download Updates (Incremental)                         │
│     ├─ New Flagged Vehicles                               │
│     ├─ New Observations from Team                         │
│     └─ Compliance Matrix Changes                          │
│     ↓                                                       │
│  5. Update Sync Timestamp                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Conflict Resolution Strategy:**
- **Server Wins**: For flagged vehicles, compliance matrix
- **Client Wins**: For observations, incidents, photos (field data always preserved)
- **Merge**: For notes (append with timestamp)
- **Fail-Safe**: Never delete local data until server confirms receipt

---

## 🗄️ Local Database Schema (SQLite)

### Core Tables

```sql
-- Sync Metadata
CREATE TABLE sync_metadata (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER -- Unix timestamp
);

-- Zones (Full Download)
CREATE TABLE zones (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  name TEXT,
  self_contained_required INTEGER, -- Boolean (0/1)
  nights_per_month INTEGER,
  max_consecutive_nights INTEGER,
  day_visit_only INTEGER, -- Boolean
  allowed_days TEXT, -- JSON array
  homeless_exemption INTEGER, -- Boolean
  last_updated INTEGER
);

-- Compliance Matrix (Current + Last 3 Versions)
CREATE TABLE compliance_matrix (
  id TEXT PRIMARY KEY,
  zone_id TEXT,
  version INTEGER,
  effective_from INTEGER, -- Unix timestamp
  effective_to INTEGER,
  self_contained_required INTEGER,
  nights_per_month INTEGER,
  max_consecutive_nights INTEGER,
  day_visit_only INTEGER,
  allowed_days TEXT, -- JSON
  homeless_exemption INTEGER
);

-- Flagged Vehicles (Last 90 Days)
CREATE TABLE flagged_vehicles (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  plate_number TEXT,
  priority TEXT, -- 'low', 'medium', 'high', 'critical'
  reason TEXT,
  notes TEXT,
  flagged_at INTEGER,
  is_active INTEGER
);

-- Recent Observations (Last 7 Days)
CREATE TABLE recent_observations (
  observation_id TEXT PRIMARY KEY,
  plate_number TEXT,
  zone_id TEXT,
  recorded_at INTEGER, -- Unix timestamp
  recorded_by TEXT,
  officer_notes TEXT,
  self_contained INTEGER,
  is_compliant INTEGER,
  is_breach INTEGER,
  breach_type TEXT,
  gps_latitude REAL,
  gps_longitude REAL,
  synced INTEGER DEFAULT 0 -- Local flag
);

-- Vehicle History (Top 500 Plates)
CREATE TABLE vehicle_history (
  plate_number TEXT PRIMARY KEY,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  self_contained INTEGER,
  homeless_status TEXT, -- 'none', 'claimed', 'confirmed'
  is_flagged INTEGER,
  total_observations INTEGER,
  total_breaches INTEGER,
  last_seen_at INTEGER,
  first_seen_at INTEGER
);

-- Vehicle Stay Summary (Compliance Calculation)
CREATE TABLE vehicle_monthly_stays (
  id TEXT PRIMARY KEY,
  plate_number TEXT,
  zone_id TEXT,
  calendar_month TEXT, -- 'YYYY-MM'
  nights_stayed INTEGER,
  consecutive_nights INTEGER,
  last_observation_date INTEGER,
  observation_ids TEXT -- JSON array
);

-- Upload Queue (Offline Actions)
CREATE TABLE upload_queue (
  id TEXT PRIMARY KEY,
  action_type TEXT, -- 'observation', 'incident', 'photo', 'note'
  payload TEXT, -- JSON
  created_at INTEGER,
  upload_attempts INTEGER DEFAULT 0,
  uploaded INTEGER DEFAULT 0, -- Boolean
  server_id TEXT -- After successful upload
);

-- Photos (Local Storage)
CREATE TABLE local_photos (
  id TEXT PRIMARY KEY,
  local_path TEXT, -- File system path
  plate_number TEXT,
  observation_id TEXT,
  incident_id TEXT,
  captured_at INTEGER,
  gps_latitude REAL,
  gps_longitude REAL,
  uploaded INTEGER DEFAULT 0, -- Boolean
  server_url TEXT -- After successful upload
);

-- Incidents (Offline Creation)
CREATE TABLE local_incidents (
  id TEXT PRIMARY KEY,
  plate_number TEXT,
  zone_id TEXT,
  incident_type TEXT,
  description TEXT,
  severity TEXT,
  happened_at INTEGER,
  gps_latitude REAL,
  gps_longitude REAL,
  photo_ids TEXT, -- JSON array of local photo IDs
  officer_notes TEXT,
  created_at INTEGER,
  synced INTEGER DEFAULT 0
);
```

---

## 📱 App Design & UI/UX

### Screen Hierarchy

```
APP STRUCTURE
│
├─ Login Screen
│   └─ Organization Selection (master users only)
│
├─ Sync Screen (During Initial Download)
│   ├─ Progress Bar (Zones, Vehicles, Observations...)
│   ├─ Data Size Indicator
│   └─ Cancel Button (return to login)
│
├─ Main Dashboard (Home)
│   ├─ Network Status Indicator (Online/Offline)
│   ├─ Last Sync Time
│   ├─ Upload Queue Count
│   ├─ Quick Stats
│   │   ├─ Scans Today
│   │   ├─ Incidents Created
│   │   ├─ Breaches Detected
│   │   └─ Flagged Vehicles Encountered
│   ├─ Zone Selector (Dropdown)
│   └─ Primary Action Button: "Scan Vehicle"
│
├─ Vehicle Scan Screen
│   ├─ Camera View (Plate OCR)
│   ├─ Manual Input Field
│   ├─ GPS Status Indicator
│   ├─ Zone Override Button
│   └─ Submit Button
│
├─ Vehicle Assessment Screen (After Scan)
│   ├─ Plate Number (Large, Bold)
│   ├─ Flagged Alert Banner (if applicable)
│   │   └─ Priority, Reason, Notes
│   ├─ Vehicle Details Card
│   │   ├─ Make/Model/Color
│   │   ├─ Self-Contained Status
│   │   └─ Last Seen
│   ├─ Compliance Status Card
│   │   ├─ Visual Indicator (Green/Yellow/Red)
│   │   ├─ Consecutive Nights: X/3
│   │   ├─ Monthly Nights: Y/28
│   │   ├─ Status: COMPLIANT | WARNING | BREACH
│   │   └─ Calculation Details
│   ├─ Recent Observations List
│   │   └─ Date, Zone, Officer
│   ├─ Actions
│   │   ├─ Record Observation
│   │   ├─ Take Photo
│   │   ├─ Create Incident
│   │   └─ Add Note
│   └─ Back Button
│
├─ Record Observation Screen
│   ├─ Pre-filled Data
│   │   ├─ Plate Number
│   │   ├─ Zone (GPS-detected)
│   │   ├─ Timestamp (current)
│   │   └─ GPS Coordinates
│   ├─ Editable Fields
│   │   ├─ Self-Contained (Yes/No/Unknown)
│   │   ├─ Officer Notes
│   │   └─ Photos (Attach)
│   ├─ Save Button (to Upload Queue)
│   └─ Cancel Button
│
├─ Create Incident Screen
│   ├─ Pre-filled Data
│   │   ├─ Plate Number
│   │   ├─ Zone
│   │   ├─ Timestamp
│   │   └─ GPS Coordinates
│   ├─ Required Fields
│   │   ├─ Incident Type (Dropdown)
│   │   ├─ Description (Text Area)
│   │   ├─ Severity (Low/Medium/High/Critical)
│   │   └─ Photos (Attach, min 1 required)
│   ├─ Optional Fields
│   │   ├─ Homeless Status (Yes/No/Unknown)
│   │   ├─ H&S Issues (Yes/No)
│   │   └─ Enforcement Required (Yes/No)
│   ├─ Save to Queue Button
│   └─ Cancel Button
│
├─ Photo Capture Screen
│   ├─ Camera View
│   ├─ Flash Toggle
│   ├─ Front/Back Camera Toggle
│   ├─ GPS Overlay (Lat/Lng, Accuracy)
│   ├─ Timestamp Overlay
│   ├─ Capture Button
│   └─ Gallery Preview (Thumbnails)
│
├─ Upload Queue Screen
│   ├─ Queue Stats
│   │   ├─ Total Items
│   │   ├─ Photos Pending
│   │   ├─ Observations Pending
│   │   └─ Incidents Pending
│   ├─ Sync Status
│   │   ├─ Last Sync Time
│   │   ├─ Next Sync (if scheduled)
│   │   └─ Network Status
│   ├─ Queue List
│   │   └─ Item Type, Created Time, Sync Status
│   ├─ Force Sync Button (when online)
│   └─ Clear Failed Button (admin)
│
├─ Recent Scans (History)
│   ├─ Today's Scans
│   ├─ Filters (Zone, Status)
│   ├─ Search (Plate Number)
│   └─ Scan Cards
│       ├─ Plate Number
│       ├─ Time
│       ├─ Zone
│       ├─ Status (Compliant/Breach)
│       └─ Tap to View Details
│
└─ Settings
    ├─ User Profile
    ├─ Organization Info
    ├─ Last Sync Time
    ├─ Force Full Sync
    ├─ Clear Local Cache
    ├─ Upload Queue Management
    ├─ GPS Accuracy Settings
    ├─ Camera Settings
    └─ Logout
```

---

## ⚙️ Core Functionality Specifications

### 1. Offline Compliance Calculation

**Objective**: Calculate compliance status locally without network calls

**Algorithm** (matches `calculate_vehicle_compliance` database function):

```typescript
interface ComplianceResult {
  isCompliant: boolean;
  isBreach: boolean;
  breachType: 'consecutive_nights' | 'monthly_nights' | 'day_visit' | null;
  consecutiveNights: number;
  monthlyNights: number;
  maxConsecutiveAllowed: number;
  maxMonthlyAllowed: number;
  violationReasons: string[];
}

async function calculateLocalCompliance(
  plateNumber: string,
  zoneId: string,
  checkDate: Date
): Promise<ComplianceResult> {
  // Step 1: Get zone compliance matrix
  const matrix = await db.query(
    `SELECT * FROM compliance_matrix 
     WHERE zone_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
     ORDER BY effective_from DESC LIMIT 1`,
    [zoneId, checkDate.getTime(), checkDate.getTime()]
  );

  if (!matrix) {
    return { isCompliant: true, isBreach: false, breachType: null }; // Default if no matrix
  }

  // Step 2: Get vehicle history for this zone in current month
  const monthKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}`;
  const monthlyStay = await db.query(
    `SELECT * FROM vehicle_monthly_stays 
     WHERE plate_number = ? AND zone_id = ? AND calendar_month = ?`,
    [plateNumber, zoneId, monthKey]
  );

  const monthlyNights = monthlyStay?.nights_stayed || 0;
  const consecutiveNights = monthlyStay?.consecutive_nights || 0;

  // Step 3: Check homeless exemption
  const vehicle = await db.query(
    `SELECT homeless_status FROM vehicle_history WHERE plate_number = ?`,
    [plateNumber]
  );
  
  const isHomeless = vehicle?.homeless_status === 'confirmed';
  if (isHomeless && matrix.homeless_exemption) {
    return {
      isCompliant: true,
      isBreach: false,
      breachType: null,
      consecutiveNights,
      monthlyNights,
      maxConsecutiveAllowed: matrix.max_consecutive_nights,
      maxMonthlyAllowed: matrix.nights_per_month,
      violationReasons: [],
    };
  }

  // Step 4: Check day visit only zones
  if (matrix.day_visit_only) {
    // Check if observation is during allowed hours (8am-8pm)
    const hour = checkDate.getHours();
    const isDayTime = hour >= 8 && hour < 20;
    
    if (!isDayTime) {
      return {
        isCompliant: false,
        isBreach: true,
        breachType: 'day_visit',
        consecutiveNights: 0,
        monthlyNights: 0,
        maxConsecutiveAllowed: 0,
        maxMonthlyAllowed: 0,
        violationReasons: ['Observed after hours in day-visit-only zone'],
      };
    }
  }

  // Step 5: Check consecutive nights limit
  const violationReasons: string[] = [];
  let breachType: 'consecutive_nights' | 'monthly_nights' | null = null;

  if (consecutiveNights > matrix.max_consecutive_nights) {
    violationReasons.push(
      `Exceeded consecutive nights limit (${consecutiveNights}/${matrix.max_consecutive_nights})`
    );
    breachType = 'consecutive_nights';
  }

  // Step 6: Check monthly nights limit
  if (monthlyNights > matrix.nights_per_month) {
    violationReasons.push(
      `Exceeded monthly nights limit (${monthlyNights}/${matrix.nights_per_month})`
    );
    if (!breachType) breachType = 'monthly_nights';
  }

  const isBreach = violationReasons.length > 0;

  return {
    isCompliant: !isBreach,
    isBreach,
    breachType,
    consecutiveNights,
    monthlyNights,
    maxConsecutiveAllowed: matrix.max_consecutive_nights,
    maxMonthlyAllowed: matrix.nights_per_month,
    violationReasons,
  };
}
```

---

### 2. Upload Queue Management

**Objective**: Queue all offline actions for background sync

**Queue Item Structure**:
```typescript
interface QueueItem {
  id: string; // UUID
  action_type: 'observation' | 'incident' | 'photo' | 'note';
  payload: any; // JSON serialized data
  created_at: number; // Unix timestamp
  upload_attempts: number;
  uploaded: boolean;
  server_id: string | null; // After successful upload
}
```

**Queue Processing Logic**:
```typescript
async function processUploadQueue() {
  // Check network status
  if (!navigator.onLine) return;

  // Get pending items (not uploaded, ordered by creation time)
  const pendingItems = await db.query(
    `SELECT * FROM upload_queue WHERE uploaded = 0 ORDER BY created_at ASC LIMIT 50`
  );

  for (const item of pendingItems) {
    try {
      let response;

      switch (item.action_type) {
        case 'photo':
          response = await uploadPhoto(item.payload);
          break;
        case 'observation':
          response = await uploadObservation(item.payload);
          break;
        case 'incident':
          response = await uploadIncident(item.payload);
          break;
        case 'note':
          response = await uploadNote(item.payload);
          break;
      }

      // Mark as uploaded
      await db.execute(
        `UPDATE upload_queue SET uploaded = 1, server_id = ? WHERE id = ?`,
        [response.id, item.id]
      );

      console.log(`✅ Synced ${item.action_type} - ${item.id}`);

    } catch (error) {
      // Increment attempt counter
      await db.execute(
        `UPDATE upload_queue SET upload_attempts = upload_attempts + 1 WHERE id = ?`,
        [item.id]
      );

      console.error(`❌ Failed to sync ${item.action_type} - ${item.id}:`, error);

      // Remove from queue after 5 failed attempts
      if (item.upload_attempts >= 5) {
        await db.execute(
          `DELETE FROM upload_queue WHERE id = ?`,
          [item.id]
        );
        console.error(`🗑️ Removed failed item from queue: ${item.id}`);
      }
    }
  }
}

// Run every 30 minutes when online
setInterval(() => {
  if (navigator.onLine) {
    processUploadQueue();
  }
}, 30 * 60 * 1000);
```

---

### 3. Photo Capture & Local Storage

**Objective**: Capture photos with GPS metadata and store locally

**Photo Storage Strategy**:
- Store photos in app's private directory: `/data/data/com.freedomcamp.officer/files/photos/`
- Filename format: `{plate_number}_{timestamp}_{uuid}.jpg`
- Compress to 80% quality, max resolution 1920x1080
- Embed GPS coordinates and timestamp in EXIF metadata

**Photo Upload Flow**:
```typescript
async function capturePhoto(plateNumber: string) {
  // Get current GPS location
  const location = await getCurrentLocation();
  
  // Capture photo with camera
  const photo = await Camera.takePictureAsync({
    quality: 0.8,
    base64: false,
    exif: true,
  });

  // Generate unique filename
  const timestamp = Date.now();
  const uuid = generateUUID();
  const filename = `${plateNumber}_${timestamp}_${uuid}.jpg`;
  const localPath = `${FileSystem.documentDirectory}photos/${filename}`;

  // Move photo to permanent storage
  await FileSystem.moveAsync({
    from: photo.uri,
    to: localPath,
  });

  // Save metadata to database
  await db.execute(
    `INSERT INTO local_photos (id, local_path, plate_number, captured_at, gps_latitude, gps_longitude, uploaded)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [uuid, localPath, plateNumber, timestamp, location.latitude, location.longitude]
  );

  // Add to upload queue
  await db.execute(
    `INSERT INTO upload_queue (id, action_type, payload, created_at)
     VALUES (?, 'photo', ?, ?)`,
    [generateUUID(), JSON.stringify({ photo_id: uuid, local_path: localPath }), timestamp]
  );

  return { id: uuid, localPath };
}
```

---

### 4. GPS Tracking & Zone Detection

**Objective**: Continuous GPS tracking with automatic zone detection

**GPS Strategy**:
- Request `location.requestForegroundPermissionsAsync()` on app launch
- Enable background location updates during patrol shifts
- Update location every 10 seconds (configurable)
- Minimum accuracy: 50 meters (warn user if worse)

**Zone Detection Algorithm**:
```typescript
interface Zone {
  id: string;
  name: string;
  center_lat: number;
  center_lng: number;
  radius: number; // Meters
}

async function detectCurrentZone(latitude: number, longitude: number): Promise<Zone | null> {
  // Get all zones from local database
  const zones = await db.query(`SELECT * FROM zones WHERE organization_id = ?`, [currentOrgId]);

  // Calculate distance to each zone center
  for (const zone of zones) {
    const distance = calculateDistance(
      latitude,
      longitude,
      zone.center_lat,
      zone.center_lng
    );

    // Check if within zone radius (default 500m if not specified)
    const radius = zone.radius || 500;
    if (distance <= radius) {
      return zone;
    }
  }

  return null; // Not in any zone
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}
```

---

### 5. Incident Report Creation (Offline)

**Objective**: Create court-ready incident reports with photos and GPS

**Incident Structure**:
```typescript
interface OfflineIncident {
  id: string; // Local UUID
  plate_number: string;
  zone_id: string;
  zone_name: string; // For display
  incident_type: string; // 'breach', 'health_safety', 'environmental', 'behavioral', 'other'
  description: string; // Required, min 20 characters
  severity: 'low' | 'medium' | 'high' | 'critical';
  happened_at: number; // Unix timestamp
  gps_latitude: number;
  gps_longitude: number;
  gps_accuracy: number; // Meters
  photo_ids: string[]; // Array of local photo IDs (min 1 required)
  homeless_status: 'yes' | 'no' | 'unknown';
  hs_issues: boolean;
  enforcement_required: boolean;
  officer_notes: string;
  created_at: number;
  synced: boolean;
}
```

**Incident Creation Flow**:
```typescript
async function createOfflineIncident(incidentData: OfflineIncident) {
  // Validate required fields
  if (!incidentData.description || incidentData.description.length < 20) {
    throw new Error('Description must be at least 20 characters');
  }

  if (!incidentData.photo_ids || incidentData.photo_ids.length === 0) {
    throw new Error('At least one photo is required');
  }

  // Generate local ID
  const id = generateUUID();
  const created_at = Date.now();

  // Save to local database
  await db.execute(
    `INSERT INTO local_incidents (
      id, plate_number, zone_id, incident_type, description, severity,
      happened_at, gps_latitude, gps_longitude, photo_ids, officer_notes,
      created_at, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      incidentData.plate_number,
      incidentData.zone_id,
      incidentData.incident_type,
      incidentData.description,
      incidentData.severity,
      incidentData.happened_at,
      incidentData.gps_latitude,
      incidentData.gps_longitude,
      JSON.stringify(incidentData.photo_ids),
      incidentData.officer_notes,
      created_at,
    ]
  );

  // Add to upload queue
  await db.execute(
    `INSERT INTO upload_queue (id, action_type, payload, created_at)
     VALUES (?, 'incident', ?, ?)`,
    [generateUUID(), JSON.stringify({ incident_id: id }), created_at]
  );

  console.log(`✅ Incident created offline: ${id}`);
  return { id, created_at };
}
```

---

## 🔄 Sync Edge Function Specifications

### New Edge Function: `sync-organization-data`

**Purpose**: Download all necessary data for offline operation

**Request**:
```typescript
{
  organization_id: string;
  last_sync: number | null; // Unix timestamp of last sync (null for first sync)
  days_back: number; // Download last N days of observations (default 7)
}
```

**Response**:
```typescript
{
  zones: Zone[]; // All active zones for org
  compliance_matrix: ComplianceMatrix[]; // Current + last 3 versions
  flagged_vehicles: FlaggedVehicle[]; // Last 90 days
  recent_observations: Observation[]; // Last N days
  vehicle_history: VehicleStaySummary[]; // Top 500 plates by frequency
  canonical_vehicles: CanonicalVehicle[]; // Metadata for known plates
  team_members: UserProfile[]; // For incident reports
  sync_timestamp: number; // Server timestamp for next incremental sync
}
```

**Implementation**:
```typescript
// supabase/functions/sync-organization-data/index.ts

Deno.serve(async (req) => {
  const { organization_id, last_sync, days_back = 7 } = await req.json();

  // Calculate date range
  const now = new Date();
  const startDate = new Date(now.getTime() - days_back * 24 * 60 * 60 * 1000);

  // Fetch all zones
  const { data: zones } = await supabase
    .from('zones')
    .select('*')
    .eq('organization_id', organization_id)
    .eq('is_active', true);

  // Fetch compliance matrix (current + last 3 versions)
  const { data: compliance_matrix } = await supabase
    .from('zone_compliance_matrix')
    .select('*')
    .eq('organization_id', organization_id)
    .order('effective_from', { ascending: false })
    .limit(4);

  // Fetch flagged vehicles (last 90 days)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const { data: flagged_vehicles } = await supabase
    .from('flagged_vehicles')
    .select('*')
    .eq('organization_id', organization_id)
    .eq('is_active', true)
    .gte('flagged_at', ninetyDaysAgo.toISOString());

  // Fetch recent observations (last N days)
  const { data: recent_observations } = await supabase
    .from('vehicle_observations_v2')
    .select('*')
    .eq('organization_id', organization_id)
    .gte('recorded_at', startDate.toISOString())
    .order('recorded_at', { ascending: false })
    .limit(10000); // Max 10k observations

  // Fetch vehicle stay summary (top 500 plates)
  const { data: vehicle_history } = await supabase
    .from('canonical_vehicles')
    .select('*')
    .order('total_observations', { ascending: false })
    .limit(500);

  // Fetch team members
  const { data: team_members } = await supabase
    .from('user_profiles')
    .select('id, first_name, last_name, role, phone')
    .eq('organization_id', organization_id)
    .eq('is_active', true);

  return new Response(
    JSON.stringify({
      zones,
      compliance_matrix,
      flagged_vehicles,
      recent_observations,
      vehicle_history,
      team_members,
      sync_timestamp: Date.now(),
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
```

---

## 🚀 Recommended Tech Stack

### Core Framework
- **React Native + Expo** (recommended for rapid development)
  - Expo SDK 51+
  - Expo Camera
  - Expo Location
  - Expo SQLite
  - Expo FileSystem
  - Expo Network

### State Management
- **Zustand** (lightweight, same as web portal)
- **React Query** (for sync operations when online)

### Database
- **Expo SQLite** (local database)
- **WatermelonDB** (optional, for better performance with large datasets)

### UI Components
- **NativeBase** or **React Native Paper** (Material Design)
- **React Navigation** (screen navigation)
- **React Native Reanimated** (smooth animations)

### Camera & OCR
- **Expo Camera** (photo capture)
- **Tesseract.js** or **Google ML Kit** (plate number OCR)

### GPS & Maps
- **Expo Location** (GPS tracking)
- **React Native Maps** (optional, for zone visualization)

### Build & Deployment
- **EAS Build** (Expo Application Services)
- **CodePush** (over-the-air updates)

---

## 📋 Development Checklist

### Phase 1: Foundation (Week 1-2)
- [ ] Setup React Native + Expo project
- [ ] Implement SQLite database schema
- [ ] Build authentication flow
- [ ] Create organization selection (master users)
- [ ] Implement `sync-organization-data` Edge Function
- [ ] Build initial sync screen with progress

### Phase 2: Core Features (Week 3-4)
- [ ] Implement local compliance calculation algorithm
- [ ] Build vehicle scan screen (camera + manual input)
- [ ] Create vehicle assessment screen with compliance display
- [ ] Implement flagged vehicle alerts
- [ ] Build observation recording flow
- [ ] Create upload queue system

### Phase 3: Incident Reports (Week 5)
- [ ] Build incident creation screen
- [ ] Implement photo capture with GPS metadata
- [ ] Create local photo storage system
- [ ] Build incident photo gallery
- [ ] Implement incident validation

### Phase 4: Sync & Queue (Week 6)
- [ ] Build background sync service
- [ ] Implement upload queue processing
- [ ] Create network status monitoring
- [ ] Build conflict resolution logic
- [ ] Add sync progress indicators

### Phase 5: GPS & Zones (Week 7)
- [ ] Implement GPS tracking service
- [ ] Build zone detection algorithm
- [ ] Create zone auto-selection
- [ ] Add GPS accuracy warnings
- [ ] Build location permission handling

### Phase 6: Polish & Testing (Week 8)
- [ ] Build upload queue screen
- [ ] Create recent scans history
- [ ] Add settings screen
- [ ] Implement force sync
- [ ] Build clear cache function
- [ ] Comprehensive offline testing
- [ ] Performance optimization
- [ ] Battery usage optimization

### Phase 7: Deployment
- [ ] Build APK with EAS
- [ ] Test on multiple Android versions
- [ ] Setup CodePush for updates
- [ ] Create user documentation
- [ ] Deploy to internal testing

---

## 🔒 Security Considerations

1. **Data Encryption**: Encrypt SQLite database with `SQLCipher`
2. **Secure Storage**: Use `expo-secure-store` for auth tokens
3. **Photo Privacy**: Store photos in app-private directory (not gallery)
4. **Network Security**: Enforce HTTPS for all API calls
5. **Token Refresh**: Implement automatic JWT refresh before expiry
6. **Local Auth**: Require PIN/biometric unlock after app background
7. **Data Cleanup**: Clear cache on logout

---

## 📊 Performance Targets

- **Initial Sync Time**: < 60 seconds for 7 days of data (4G)
- **Offline Operation**: 3-4 days without connectivity
- **Battery Usage**: < 15% per 8-hour shift
- **Database Size**: < 100 MB for typical org (500 vehicles, 7 days)
- **Photo Storage**: < 500 MB for typical patrol (50 photos)
- **Sync Speed**: 20 observations/second upload
- **Photo Upload**: 5 photos/minute (4G)
- **GPS Accuracy**: < 50 meters 90% of the time

---

## 🎯 Success Criteria

1. ✅ Officer can work 3+ days completely offline
2. ✅ Compliance assessment is instant (< 1 second)
3. ✅ All observations/incidents are preserved in queue
4. ✅ Background sync is transparent to user
5. ✅ App never crashes due to network errors
6. ✅ GPS tracking doesn't drain battery excessively
7. ✅ Photos are high quality with metadata intact
8. ✅ Incident reports are court-ready when synced

---

## 📞 Support & Maintenance

**Data Integrity**:
- Daily health checks on upload queue
- Monitor sync failure rates
- Alert admins if queue > 1000 items

**App Updates**:
- Use CodePush for minor updates (bugfixes, UI tweaks)
- Use full APK releases for database schema changes
- Maintain backward compatibility for 2 versions

**User Training**:
- In-app tutorial on first launch
- Offline mode walkthrough
- Sync troubleshooting guide
- Video demos for incident creation

---

**END OF SPECIFICATION**
