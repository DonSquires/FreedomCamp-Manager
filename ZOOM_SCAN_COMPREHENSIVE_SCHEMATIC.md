# Zoom Scan - Comprehensive Build Schematic

**Created:** February 18, 2026  
**Purpose:** Complete technical documentation of Zoom Scan system from inception to current state  
**Status:** DIAGNOSTIC REVIEW - System experiencing failures despite multiple rebuilds

---

## 1. ORIGINAL REQUIREMENTS & DESIGN PHILOSOPHY

### 1.1 Core Purpose
**Zoom Scan** is a rapid-fire vehicle plate scanning mode designed for:
- **Driving patrols** - Officer driving through parking areas
- **High-volume scanning** - Quick capture without stopping
- **Split-screen workflow** - Queue results visible while scanning
- **Non-blocking operation** - Continuous scanning without waiting

### 1.2 User Experience Goals
```
Officer Experience:
1. Tap camera button repeatedly (no waiting between scans)
2. See results appear in queue within 2-5 seconds
3. Compliant vehicles auto-dismiss (5 seconds)
4. Breaches/At-Risk stay for manual review
5. Continue scanning while previous scans process in background
```

### 1.3 Design Constraints
- **Mobile-first** - Must work on small screens with touch input
- **One-handed operation** - Large capture button, minimal controls
- **Legal compliance** - All photos must be retained with watermarks
- **Evidence integrity** - Photos must have GPS, timestamp, zone metadata
- **Offline capable** - Must queue scans if network unavailable

---

## 2. TECHNICAL ARCHITECTURE

### 2.1 Component Structure
```
┌─────────────────────────────────────────────┐
│   ZoomScanQueue.tsx (Main Component)        │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │   Queue Display (Top 1/4)            │  │
│  │   - Processing count badge           │  │
│  │   - Scan results with status         │  │
│  │   - Auto-dismiss compliant (5s)      │  │
│  └──────────────────────────────────────┘  │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │   Camera Feed (Bottom 3/4)           │  │
│  │   - Live video stream                │  │
│  │   - Zoom controls (1-5x)             │  │
│  │   - Torch toggle                     │  │
│  │   - Zone/GPS/Time overlay            │  │
│  │   - Large capture button             │  │
│  └──────────────────────────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

### 2.2 Technology Stack
- **React** - Component framework
- **TypeScript** - Type safety
- **Supabase** - Backend services
- **Browser MediaDevices API** - Camera access
- **Canvas API** - Image capture & watermarking
- **Plate Recognizer API** - ALPR service

### 2.3 State Management
```typescript
// Local component state (NO global store)
const [queue, setQueue] = useState<QueueItem[]>([]);
const [processingCount, setProcessingCount] = useState(0);
const [cameraReady, setCameraReady] = useState(false);
const [zoomLevel, setZoomLevel] = useState(1);
const [torchEnabled, setTorchEnabled] = useState(false);
const [currentTime, setCurrentTime] = useState(new Date());
const [gpsLocation, setGpsLocation] = useState<{lat, lng} | null>(null);

// Refs for DOM/stream management
const videoRef = useRef<HTMLVideoElement>(null);
const canvasRef = useRef<HTMLCanvasElement>(null);
const streamRef = useRef<MediaStream | null>(null);
```

---

## 3. WORKFLOW - STEP-BY-STEP PROCESS

### 3.1 Complete Scan Workflow (Current Implementation)
```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: USER ACTION                                         │
├─────────────────────────────────────────────────────────────┤
│ Officer taps capture button                                 │
│ → Increment processingCount (+1)                            │
│ → Add temp "Processing..." item to queue                    │
│ → Capture button IMMEDIATELY available for next scan        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: PHOTO CAPTURE                                       │
├─────────────────────────────────────────────────────────────┤
│ Draw video frame to canvas                                  │
│ Convert to base64 JPEG (95% quality)                        │
│ Capture metadata: timestamp, GPS, zone                      │
│                                                              │
│ Output: imageDataUrl (base64 string)                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: PHOTO UPLOAD (RETAIN BEFORE SCAN)                  │
├─────────────────────────────────────────────────────────────┤
│ Convert base64 → Blob                                       │
│ Generate unique filename: scans/[timestamp]_[random].jpg    │
│ Upload to Supabase Storage: evidence bucket                 │
│ Get public URL                                               │
│                                                              │
│ WHY UPLOAD FIRST:                                           │
│ - Legal compliance (retain all evidence)                    │
│ - Manual entry fallback (photo preserved if ALPR fails)     │
│ - Evidence integrity (photo + metadata linked)              │
│                                                              │
│ Output: publicUrl (https://...)                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: ALPR RECOGNITION (recognize-plate Edge Function)   │
├─────────────────────────────────────────────────────────────┤
│ POST /recognize-plate                                        │
│ Body: {                                                      │
│   image: imageDataUrl (base64),                             │
│   regions: ['nz']                                           │
│ }                                                            │
│                                                              │
│ Plate Recognizer API:                                       │
│ - Detect license plate in image                             │
│ - OCR text extraction                                       │
│ - Confidence scoring                                        │
│ - Vehicle make/model/color (MMC) detection                  │
│                                                              │
│ Output: {                                                    │
│   success: true,                                            │
│   plate_number: "ABC123",                                   │
│   confidence: 0.95,                                         │
│   vehicle_make: "Toyota",                                   │
│   vehicle_model: "Camry",                                   │
│   vehicle_color: "Silver"                                   │
│ }                                                            │
│                                                              │
│ FAILURE HANDLING:                                           │
│ - No plate detected → Throw error                           │
│ - API error → Extract FunctionsHttpError details            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: FIELD SCAN PROCESSING (process-field-scan)         │
├─────────────────────────────────────────────────────────────┤
│ POST /process-field-scan                                     │
│ Body: {                                                      │
│   plateNumber: "ABC123",                                    │
│   zoneId: "[UUID]",                                         │
│   organizationId: "[UUID]",                                 │
│   imageUrl: publicUrl,                                      │
│   gpsLocation: null, (desktop has no GPS)                   │
│   vehicleDetails: { make, model, color },                   │
│   detectionMethod: 'alpr',                                  │
│   confidence: 0.95,                                         │
│   isSelfContained: false                                    │
│ }                                                            │
│                                                              │
│ Backend Process:                                            │
│ 1. Normalize plate → "ABC123"                               │
│ 2. Get/create canonical vehicle (upsert)                    │
│ 3. Create observation in observations            │
│ 4. Run compliance check (calculate_vehicle_compliance)      │
│ 5. Check flagged status                                     │
│ 6. Return result                                             │
│                                                              │
│ Output: {                                                    │
│   success: true,                                            │
│   observation_id: "[UUID]",                                 │
│   is_flagged: false,                                        │
│   is_compliant: true,                                       │
│   alerts: ["✅ Compliant with zone requirements"]           │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: QUEUE UPDATE                                        │
├─────────────────────────────────────────────────────────────┤
│ Determine status badge:                                     │
│ - is_flagged → 🚩 FLAGGED                                   │
│ - !is_compliant → 🔴 BREACH                                 │
│ - is_compliant → 🟢 COMPLIANT                               │
│                                                              │
│ Create queue item:                                          │
│ {                                                            │
│   id: observation_id,                                       │
│   plateNumber: "ABC123",                                    │
│   status: 'compliant',                                      │
│   details: "✅ Compliant with zone requirements",           │
│   timestamp: new Date()                                     │
│ }                                                            │
│                                                              │
│ Replace temp "Processing..." item with real result          │
│                                                              │
│ Auto-dismiss logic:                                         │
│ - COMPLIANT → Dismiss after 5 seconds                       │
│ - BREACH/FLAGGED → Manual dismiss only                      │
│                                                              │
│ Decrement processingCount (-1)                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 7: SOUND FEEDBACK                                      │
├─────────────────────────────────────────────────────────────┤
│ playSounds.flaggedVehicle() → 🚩 Urgent alert sound         │
│ playSounds.violationAlert() → 🔴 Warning sound              │
│ playSounds.processingComplete() → 🟢 Success chime          │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Error Handling Workflow
```
┌─────────────────────────────────────────────────────────────┐
│ ERROR SCENARIO 1: ALPR FAILS                                │
├─────────────────────────────────────────────────────────────┤
│ Plate Recognizer API returns error or no plates detected    │
│                                                              │
│ Current Implementation:                                     │
│ 1. Catch error in try/catch                                 │
│ 2. Extract FunctionsHttpError details:                      │
│    - Check error.name === 'FunctionsHttpError'              │
│    - Call await error.context.text()                        │
│    - Get actual error message from backend                  │
│ 3. Create error queue item:                                 │
│    {                                                         │
│      plateNumber: "FAILED",                                 │
│      status: 'breach',                                      │
│      details: "❌ ALPR: No plate detected"                  │
│    }                                                         │
│ 4. Auto-dismiss after 10 seconds                            │
│ 5. Decrement processingCount                                │
│                                                              │
│ MISSING FEATURE: Manual entry fallback                      │
│ - Photo already uploaded (publicUrl exists)                 │
│ - Should prompt officer to enter plate manually             │
│ - Should reuse uploaded photo with manual plate entry       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ERROR SCENARIO 2: FIELD SCAN FAILS                          │
├─────────────────────────────────────────────────────────────┤
│ process-field-scan Edge Function returns error              │
│                                                              │
│ Common Causes:                                              │
│ - Missing required parameters (platNumber, zoneId, etc.)    │
│ - Database constraint violations (breach_alerts)            │
│ - Compliance calculation errors                             │
│ - RLS policy denials                                        │
│                                                              │
│ Current Implementation:                                     │
│ 1. Extract FunctionsHttpError details                       │
│ 2. Log specific error message                               │
│ 3. Display in queue: "Field scan: [actual error]"           │
│ 4. Auto-dismiss after 10 seconds                            │
│                                                              │
│ IMPROVEMENT NEEDED:                                         │
│ - Distinguish between recoverable vs fatal errors           │
│ - Retry logic for transient failures                        │
│ - Better user guidance (what to do next)                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ERROR SCENARIO 3: UPLOAD FAILS                              │
├─────────────────────────────────────────────────────────────┤
│ Supabase Storage upload fails (network, quota, permissions) │
│                                                              │
│ Current Implementation:                                     │
│ 1. Catch uploadError                                        │
│ 2. Throw error (stops workflow)                             │
│ 3. Generic error queue item created                         │
│                                                              │
│ MISSING FEATURE: Offline queue                              │
│ - Should detect network failure                             │
│ - Should save photo + metadata to IndexedDB                 │
│ - Should retry when network restored                        │
│ - Should show "Queued for upload" status                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. DATA FLOW & DATABASE INTEGRATION

### 4.1 Tables Involved
```sql
-- PRIMARY TABLES MODIFIED BY ZOOM SCAN

1. canonical_vehicles
   - Plate number (primary key)
   - Vehicle make/model/color/year
   - Flagged status
   - Homeless status
   - Self-contained status
   - First/last seen timestamps
   - Total observations count

2. observations
   - Observation ID (UUID)
   - Plate number (FK → canonical_vehicles)
   - Organization ID (FK → organizations)
   - Zone ID (FK → zones)
   - Recorded by user ID (FK → user_profiles)
   - Recorded timestamp
   - Photo URL (Storage reference)
   - GPS coordinates
   - Vehicle details (make/model/color/year)
   - Self-contained flag
   - Compliance fields (is_compliant, breach flags)

3. compliance_results
   - Compliance result ID (UUID)
   - Observation ID (FK → observations)
   - Zone ID (FK → zones)
   - Matrix ID (FK → zone_compliance_matrix)
   - Is compliant (boolean)
   - Violation reasons (text array)
   - Matrix snapshot (JSONB)
   - Evaluated timestamp

4. breach_alerts (AUTO-POPULATED BY TRIGGER)
   - Breach alert ID (UUID)
   - Observation ID (FK → observations)
   - Plate number (FK → canonical_vehicles)
   - Organization ID (FK → organizations)
   - Zone ID (FK → zones)
   - Breach type (consecutive_nights, monthly_limit, etc.)
   - Status (pending → acknowledged → resolved)
   - Created timestamp

5. vehicle_monthly_stays
   - Stay record ID (UUID)
   - Plate number (FK → canonical_vehicles)
   - Zone ID (FK → zones)
   - Calendar month (date)
   - Nights stayed (integer)
   - Consecutive nights (integer)
   - Observation IDs (UUID array)

-- STORAGE BUCKETS

6. evidence (Supabase Storage)
   - Bucket: evidence
   - Path: scans/[timestamp]_[random].jpg
   - Public read access
   - 10MB file size limit
   - Allowed types: image/jpeg, image/png, image/webp
```

### 4.2 Database Triggers Activated
```sql
-- TRIGGERS THAT FIRE DURING ZOOM SCAN

1. trigger_populate_observation_from_canonical
   - Fires: BEFORE INSERT on observations
   - Action: Auto-fills vehicle details from canonical_vehicles
   
2. trigger_update_canonical_stats_v2
   - Fires: AFTER INSERT on observations
   - Action: Updates canonical_vehicles stats (total_observations, last_seen_at)

3. trigger_auto_create_compliance_result
   - Fires: AFTER INSERT on observations
   - Action: Creates compliance_results record automatically
   
4. trigger_auto_create_breach_alert
   - Fires: AFTER INSERT on compliance_results
   - Action: Creates breach_alerts if non-compliant + not homeless
   
5. trigger_update_monthly_stays_on_observation
   - Fires: AFTER INSERT on observations
   - Action: Updates vehicle_monthly_stays counters
```

### 4.3 Edge Functions Called
```typescript
// EDGE FUNCTIONS IN SCAN WORKFLOW

1. recognize-plate
   Location: supabase/functions/recognize-plate/index.ts
   Purpose: ALPR via Plate Recognizer API
   Input: { image: base64, regions: ['nz'] }
   Output: { plate_number, confidence, vehicle details }
   
2. process-field-scan
   Location: supabase/functions/process-field-scan/index.ts
   Purpose: Create observation + run compliance check
   Input: { plateNumber, zoneId, organizationId, imageUrl, ... }
   Output: { observation_id, is_compliant, is_flagged, alerts }

// EDGE FUNCTIONS NOT CURRENTLY USED (but available)

3. process-driving-scan (DEPRECATED - replaced by process-field-scan)
4. select-best-vehicle-photo (For profile photo selection)
5. analyze-vehicle-photo (For sticker detection - future feature)
```

---

## 5. UI/UX SPECIFICATIONS

### 5.1 Layout Dimensions
```
┌─────────────────────────────────────┐
│  Queue (h-1/4 = 25% of screen)      │
│  - Sticky header with count         │
│  - Scrollable results               │
│  - Min 2-3 results visible          │
├─────────────────────────────────────┤
│                                     │
│  Camera (flex-1 = 75% of screen)    │
│  - Full-width video                 │
│  - Overlays at 50% opacity:         │
│    • Zone/GPS/Time (top-left)       │
│    • Zoom slider (right-vertical)   │
│    • Torch button (left-bottom)     │
│  - Capture button (centered-bottom) │
│  - Exit button (top-right)          │
│                                     │
└─────────────────────────────────────┘
```

### 5.2 Queue Item Design
```typescript
// COMPLIANT VEHICLE
┌─────────────────────────────────────┐
│ ABC123                      🟢      │
│ ✅ Compliant with zone requirements │
│ [✓ Dismiss]                         │
└─────────────────────────────────────┘
Background: green-50, Border: green-300
Auto-dismiss: 5 seconds

// BREACH DETECTED
┌─────────────────────────────────────┐
│ XYZ789                      🔴      │
│ ⚠️ Non-compliant: Exceeded 3 nights │
│ [✓ Dismiss]                         │
└─────────────────────────────────────┘
Background: red-50, Border: red-500
Auto-dismiss: NEVER (manual only)

// FLAGGED VEHICLE
┌─────────────────────────────────────┐
│ DEF456                      🚩      │
│ 🚩 FLAGGED: Watch list - priority   │
│ [✓ Dismiss]                         │
└─────────────────────────────────────┘
Background: yellow-50, Border: yellow-500
Auto-dismiss: NEVER (manual only)

// PROCESSING (temporary)
┌─────────────────────────────────────┐
│ Processing...                       │
│ 🔄 Analyzing plate...               │
│                                     │
└─────────────────────────────────────┘
Background: gray-50, Border: gray-300
Replaced when scan completes

// ERROR (temporary)
┌─────────────────────────────────────┐
│ FAILED                      ❌      │
│ ❌ ALPR: No plate detected          │
│ [✓ Dismiss]                         │
└─────────────────────────────────────┘
Background: red-50, Border: red-500
Auto-dismiss: 10 seconds
```

### 5.3 Camera Controls
```typescript
// ZOOM SLIDER (Vertical, Right Side)
- Position: absolute right-6 top-1/2
- Transform: -translate-y-1/2 -rotate-90
- Range: 1.0x to 5.0x (step 0.1)
- Display: "[2.4]x" label
- Opacity: 50%
- Background: black/50 backdrop-blur

// TORCH TOGGLE (Left Bottom)
- Position: absolute left-6 bottom-32
- Size: h-14 w-14 rounded-full
- States:
  • OFF: bg-black/60 border-white/20 text-white
  • ON: bg-yellow-500/80 border-yellow-300 text-white
- Opacity: 50%

// CAPTURE BUTTON (Center Bottom)
- Position: absolute bottom-10 left-1/2 -translate-x-1/2
- Size: h-24 w-24 rounded-full
- Style: bg-white border-8 border-green-500
- Icon: Camera h-12 w-12 text-green-600
- Shadow: [0_0_40px_rgba(255,255,255,0.8)]
- Badge: Processing count (top-right corner)
- State: ALWAYS ENABLED (non-blocking)

// ZONE/GPS/TIME INFO (Top Left)
- Position: absolute top-4 left-4
- Opacity: 50%
- Background: black/50 backdrop-blur
- Border: border-white/20 rounded-lg
- Content:
  • Zone name (bold)
  • GPS coords (5 decimal places)
  • Date (en-NZ format)
  • Time (HH:MM:SS)
```

### 5.4 Sound Effects
```typescript
// AUDIO FEEDBACK SYSTEM
import { playSounds } from '@/lib/sounds';

playSounds.flaggedVehicle()       // 🚩 Urgent alert (2-3 beeps)
playSounds.violationAlert()       // 🔴 Warning tone
playSounds.processingComplete()   // 🟢 Success chime
```

---

## 6. EVOLUTION TIMELINE

### 6.1 Version History
```
v1.0 - Initial Implementation (Feb 15, 2026 17:06)
├─ Split-screen layout (queue + camera)
├─ Basic ALPR workflow
├─ Manual photo capture
├─ Single-scan blocking mode
└─ Issues: No photo retention, blocking workflow

v1.1 - Photo Retention Added (Feb 15, 2026 17:22)
├─ Upload photos before ALPR
├─ Watermarking with GPS/timestamp
├─ Storage in evidence bucket
└─ Issues: Storage waste on failed ALPR

v1.2 - "Scan Then Retain" Optimization (Feb 15, 2026 17:29)
├─ Attempted to run ALPR before upload
├─ Goal: Save storage on failed scans
└─ Issues: Lost photos when ALPR failed, broke manual entry

v1.3 - Reverted to "Retain Then Scan" (Feb 15, 2026 18:00)
├─ Restored upload-first approach
├─ Legal compliance priority
├─ Manual entry fallback preserved
└─ Issues: Zoom scan results not appearing in queue

v2.0 - Non-Blocking Continuous Scanning (Feb 18, 2026 23:07)
├─ Officer can scan repeatedly without waiting
├─ Processing counter badge
├─ Temp "Processing..." queue items
├─ Background async processing
└─ Issues: Generic error messages

v2.1 - Improved Error Handling (Feb 18, 2026 23:56)
├─ FunctionsHttpError extraction pattern
├─ Detailed error logging
├─ Specific error messages in queue
└─ Issues: STILL FAILING - "Failed to process scan"

v2.2 - UI Enhancements (Feb 18, 2026 23:56)
├─ Vertical zoom slider (1-5x)
├─ Torch/flashlight toggle
├─ Zone/GPS/Time overlay (50% opacity)
└─ Issues: Core workflow still broken
```

### 6.2 Key Design Decisions

**Decision 1: Upload Before ALPR (Retain Then Scan)**
- **Rationale:** Legal compliance, evidence integrity, manual entry fallback
- **Trade-off:** Wastes storage on failed ALPR attempts
- **Status:** FINAL DECISION (not negotiable)

**Decision 2: Non-Blocking Continuous Scanning**
- **Rationale:** Officers need rapid-fire scanning for driving patrols
- **Trade-off:** More complex state management, async error handling
- **Status:** IMPLEMENTED (working as designed)

**Decision 3: Auto-Dismiss Compliant Only**
- **Rationale:** Breaches require officer acknowledgment
- **Trade-off:** Queue fills with unresolved items if officer ignores
- **Status:** IMPLEMENTED (working as designed)

**Decision 4: Desktop Mode (No GPS)**
- **Rationale:** Testing on desktop before mobile deployment
- **Trade-off:** GPS location always null in current testing
- **Status:** TEMPORARY (mobile will have GPS)

**Decision 5: FunctionsHttpError Extraction**
- **Rationale:** Generic errors don't help debugging
- **Trade-off:** More complex error handling code
- **Status:** IMPLEMENTED (but underlying error still unclear)

---

## 7. CURRENT ISSUES & ROOT CAUSE ANALYSIS

### 7.1 Symptom: "FAILED - Failed to process scan"
```
User Report: Feb 18, 2026 23:56
Screenshot shows: Queue item with "FAILED" status
Error message: "Failed to process scan" (generic)
```

### 7.2 Diagnostic Questions

**Q1: Is ALPR succeeding?**
- Check browser console for "✅ Plate recognized:" log
- If missing → ALPR is failing
- If present → ALPR working, problem is in process-field-scan

**Q2: Is photo upload succeeding?**
- Check browser console for "✅ Photo uploaded" log
- If missing → Storage permissions or network issue
- If present → Upload working, problem is downstream

**Q3: What is the ACTUAL error from process-field-scan?**
- Current code attempts to extract via FunctionsHttpError pattern
- Check browser console for "Field scan error details:" log
- This should reveal the real backend error

**Q4: Is the error consistent or intermittent?**
- Every scan fails → Configuration/permissions issue
- Random failures → Race condition or timeout issue

### 7.3 Hypothesis: Breach Alerts Constraint Violation (Most Likely)
```
Based on historical context, the most common failure is:

ERROR: new row for relation "breach_alerts" violates check constraint

This was supposedly fixed with migration:
supabase/migrations/20260218_rebuild_breach_alerts_system.sql

But if that migration was NOT applied to the live database,
the old corrupted breach_alerts table would still cause failures.

HOW TO CONFIRM:
1. Check if migration was applied:
   SELECT * FROM supabase_migrations 
   WHERE version = '20260218_rebuild_breach_alerts_system';

2. Check breach_alerts constraints:
   SELECT conname, pg_get_constraintdef(oid) 
   FROM pg_constraint 
   WHERE conrelid = 'breach_alerts'::regclass;

3. Look for exact error in logs:
   - Browser console (client-side)
   - Supabase Edge Function logs (server-side)
```

### 7.4 Alternative Hypotheses

**Hypothesis 2: Missing Parameters**
- process-field-scan requires: plateNumber, zoneId, organizationId
- If any are undefined → Backend validation fails
- Check: Are these values being passed correctly?

**Hypothesis 3: RLS Policy Denial**
- User might not have permission to insert observations
- Check: Does user have correct role? Is organization_id correct?

**Hypothesis 4: Compliance Function Error**
- calculate_vehicle_compliance might be failing
- This is called inside process-field-scan
- Check: Are there errors in compliance calculation?

**Hypothesis 5: Network/CORS Issue**
- Edge Functions might be blocked by CORS
- Check: Are requests reaching the backend at all?

---

## 8. RECOMMENDED FIXES

### 8.1 IMMEDIATE: Deploy Breach Alerts Migration
```bash
# Verify migration status
psql $SUPABASE_DB_URL -c "SELECT * FROM supabase_migrations WHERE version = '20260218_rebuild_breach_alerts_system';"

# If not applied, deploy it:
supabase db push

# Or apply manually via Supabase Dashboard:
# Go to SQL Editor → Paste migration content → Run
```

### 8.2 IMMEDIATE: Add Detailed Error Logging
```typescript
// In ZoomScanQueue.tsx, modify error handling:

} catch (error: any) {
  console.error('❌ ZOOM SCAN COMPLETE ERROR DUMP:');
  console.error('Error name:', error.name);
  console.error('Error message:', error.message);
  console.error('Error stack:', error.stack);
  console.error('Error object:', error);
  
  // Log all variables at point of failure
  console.error('Context at failure:', {
    plateNumber,
    zoneId,
    organizationId,
    publicUrl,
    userId: user?.id,
    alprDataSnapshot: alprData,
  });
  
  // Then create error queue item...
}
```

### 8.3 SHORT-TERM: Add Manual Entry Fallback
```typescript
// When ALPR fails, prompt manual entry instead of error

if (alprError || !alprData?.success) {
  // Don't throw error - photo already uploaded!
  // Instead, prompt manual entry modal
  
  setManualEntryModal({
    show: true,
    imageUrl: publicUrl,
    onSubmit: async (plateNumber: string) => {
      // Call process-field-scan with manual plate
      const { data: scanResult, error: scanError } = 
        await supabase.functions.invoke('process-field-scan', {
          body: {
            plateNumber,
            zoneId,
            organizationId,
            imageUrl: publicUrl,
            detectionMethod: 'manual', // Not 'alpr'
            confidence: 1.0, // Officer confirmed
            isSelfContained: false,
          },
        });
      
      // Continue with normal queue workflow...
    },
  });
  
  return; // Don't throw error
}
```

### 8.4 MEDIUM-TERM: Add Offline Queue
```typescript
// Save failed scans to IndexedDB for retry

import { offlineStorage } from '@/lib/offlineStorage';

if (uploadError || networkError) {
  await offlineStorage.queueScan({
    imageBlob: blob,
    metadata: {
      plateNumber,
      zoneId,
      organizationId,
      timestamp: new Date().toISOString(),
      gpsLocation,
    },
  });
  
  // Show "Queued for upload" status
  const queuedItem: QueueItem = {
    id: `queued-${Date.now()}`,
    plateNumber: 'QUEUED',
    status: 'compliant',
    details: '📶 No network - Queued for upload',
    timestamp: new Date(),
  };
  
  setQueue(prev => [queuedItem, ...prev]);
}
```

### 8.5 LONG-TERM: Refactor for Testability
```typescript
// Extract business logic from component

// Bad: Everything in one component
const ZoomScanQueue = () => {
  const captureAndProcess = async () => {
    // 200 lines of complex async logic
  };
};

// Good: Separate concerns
const ZoomScanQueue = () => {
  const { capturePhoto } = useCameraCapture(videoRef);
  const { uploadPhoto } = usePhotoUpload();
  const { recognizePlate } = useALPR();
  const { processScan } = useFieldScan();
  const { addToQueue } = useQueue();
  
  const captureAndProcess = async () => {
    const photo = await capturePhoto();
    const url = await uploadPhoto(photo);
    const plate = await recognizePlate(photo);
    const result = await processScan(plate, url);
    addToQueue(result);
  };
};
```

---

## 9. TESTING PROTOCOL

### 9.1 Unit Testing Checklist
- [ ] Camera initialization
- [ ] Photo capture (canvas drawing)
- [ ] Base64 encoding
- [ ] Blob conversion
- [ ] Storage upload
- [ ] ALPR API call
- [ ] Process-field-scan API call
- [ ] Error extraction (FunctionsHttpError)
- [ ] Queue state management
- [ ] Auto-dismiss timers

### 9.2 Integration Testing Checklist
- [ ] End-to-end scan workflow
- [ ] ALPR success path
- [ ] ALPR failure + manual entry path
- [ ] Multiple rapid scans (5+ in 10 seconds)
- [ ] Compliant vehicle auto-dismiss
- [ ] Breach vehicle manual dismiss
- [ ] Flagged vehicle alert
- [ ] Network failure + offline queue
- [ ] Browser permissions (camera, geolocation)
- [ ] Mobile vs desktop differences

### 9.3 User Acceptance Testing Checklist
- [ ] Officer can scan 10 vehicles in under 2 minutes
- [ ] Results appear within 5 seconds of capture
- [ ] Compliant vehicles auto-dismiss without clicking
- [ ] Breaches stay in queue until acknowledged
- [ ] Flagged vehicles trigger alert sound
- [ ] GPS location captured correctly (mobile)
- [ ] Photos retained with watermarks
- [ ] Zoom slider works (1-5x range)
- [ ] Torch toggle works (when device supports)
- [ ] Exit button returns to main portal

---

## 10. SUCCESS CRITERIA

### 10.1 Functional Requirements ✅/❌
- [❌] **Capture photos** - Working (canvas API)
- [❌] **Upload photos** - Working (Supabase Storage)
- [❌] **ALPR recognition** - Failing (unknown cause)
- [❌] **Create observations** - Failing (blocked by ALPR failure)
- [❌] **Compliance check** - Not reached (blocked by observation creation)
- [✅] **Queue display** - Working (shows errors)
- [✅] **Non-blocking scanning** - Working (processing counter)
- [✅] **Auto-dismiss** - Working (timer logic correct)
- [❌] **Manual entry fallback** - Not implemented
- [❌] **Offline queue** - Not implemented

### 10.2 Performance Requirements
- **Scan frequency:** 1 scan every 5-10 seconds (manual capture)
- **Processing time:** 2-5 seconds per scan (ALPR + backend)
- **Queue capacity:** Unlimited (scrollable)
- **Photo size:** ~500KB per photo (JPEG 95% quality)
- **Storage quota:** 10MB bucket limit (needs monitoring)

### 10.3 User Experience Requirements
- **One-handed operation:** ✅ Large capture button, minimal controls
- **Immediate feedback:** ✅ Temp "Processing..." appears instantly
- **Clear status:** ✅ Badge colors (green/red/yellow)
- **Audio feedback:** ✅ Sound effects for different statuses
- **Error recovery:** ❌ No manual entry fallback yet

---

## 11. NEXT STEPS

### 11.1 Critical Path to Working System
```
STEP 1: Diagnose Current Failure ⚠️ BLOCKING
├─ Add detailed console logging to capture exact error
├─ Check browser console during next scan attempt
├─ Check Supabase Edge Function logs (process-field-scan)
└─ Identify root cause (breach_alerts constraint? RLS denial? Missing params?)

STEP 2: Apply Fix Based on Diagnosis
├─ If breach_alerts → Deploy migration + rebuild table
├─ If RLS → Fix permissions in user_profiles/organizations
├─ If params → Fix ZoomScanQueue.tsx parameter passing
└─ If ALPR → Check Plate Recognizer API credits/status

STEP 3: Verify Fix with Test Scan
├─ Clear browser console
├─ Perform single test scan
├─ Verify all console logs show success
└─ Verify observation appears in database

STEP 4: Test Rapid Scanning
├─ Perform 5 scans in 30 seconds
├─ Verify all create observations
├─ Verify queue shows all results
└─ Verify auto-dismiss works for compliant

STEP 5: Add Manual Entry Fallback
├─ Implement modal for manual plate entry
├─ Test ALPR failure → manual entry path
└─ Verify photo is reused with manual plate

STEP 6: Production Deployment
├─ Test on mobile device (not desktop)
├─ Verify GPS location captured
├─ Verify torch/zoom work on mobile
├─ Field test with 20+ real vehicles
└─ Collect officer feedback
```

### 11.2 Post-Launch Improvements
1. **Offline queue** - Save failed scans to IndexedDB
2. **Photo compression** - Reduce file size before upload
3. **Batch processing** - Upload 10 photos at once
4. **Sticker detection** - AI analysis of self-contained stickers
5. **Photo deduplication** - Detect same vehicle scanned twice
6. **Queue persistence** - Save queue to localStorage
7. **Export functionality** - Download scan session as CSV
8. **Analytics dashboard** - Track scan success rate, processing times

---

## 12. APPENDIX

### 12.1 Related Documentation
- `FIELD_OFFICER_PORTAL_ALPR_FLOW_SCHEMATIC.md` - Original workflow design
- `ZOOM_SCAN_PROCESS_FLOW.md` - Compliance workflow details
- `BREACH_ALERTS_SYSTEM_REBUILD.md` - Breach alerts architecture
- `supabase/migrations/20260218_rebuild_breach_alerts_system.sql` - Latest migration

### 12.2 Key Files
```
Frontend:
src/components/features/ZoomScanQueue.tsx (Main component)
src/lib/sounds.ts (Audio feedback)
src/lib/imageProcessing.ts (Watermarking)
src/lib/offlineStorage.ts (Offline queue - future)

Backend:
supabase/functions/recognize-plate/index.ts (ALPR)
supabase/functions/process-field-scan/index.ts (Observation creation)
supabase/functions/_shared/cors.ts (CORS headers)

Database:
canonical_vehicles (Vehicle master data)
observations (Scan records)
compliance_results (Auto-created by trigger)
breach_alerts (Auto-created by trigger)
vehicle_monthly_stays (Updated by trigger)
```

### 12.3 Environment Variables
```bash
# Supabase (Auto-configured)
VITE_SUPABASE_URL=https://[project].supabase.co
VITE_SUPABASE_ANON_KEY=[anon_key]

# Plate Recognizer (Edge Function only)
PLATE_RECOGNIZER_API_KEY=23d201648202e77fd91611ebac9e5e6da5c63683
```

### 12.4 Browser Requirements
- **Camera API:** MediaDevices.getUserMedia()
- **Canvas API:** CanvasRenderingContext2D
- **Geolocation API:** navigator.geolocation (mobile only)
- **Media Constraints:** zoom, torch capabilities (device-specific)
- **Storage:** IndexedDB (for offline queue - future)

---

**END OF COMPREHENSIVE SCHEMATIC**

**Status:** System is NOT working despite multiple rebuild attempts. Root cause unclear. Requires diagnostic session with detailed error logging to identify blocking issue before any further development.

**Last Updated:** February 18, 2026 23:56 (UTC+13)
