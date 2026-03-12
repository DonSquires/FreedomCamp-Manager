# 🚨 Field Officer Portal - ALPR & Observation Recording Flow

## 📱 **SYSTEM ARCHITECTURE OVERVIEW**

```
┌─────────────────────────────────────────────────────────────────┐
│                    FIELD OFFICER PORTAL                          │
│                  (React Native Mobile App)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      SUPABASE BACKEND                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Database   │  │ Edge Functions│  │  Storage Buckets    │  │
│  │  PostgreSQL  │  │   (Deno)     │  │  (Photo Evidence)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   THIRD-PARTY SERVICES                           │
│  ┌──────────────────┐           ┌────────────────────────┐      │
│  │ Plate Recognizer │           │   OnSpace AI (Gemini)  │      │
│  │  ALPR Service    │           │  Vehicle/Sticker AI    │      │
│  └──────────────────┘           └────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 **COMPLETE SCAN FLOW (End-to-End)**

### **PHASE 1: CAMERA CAPTURE & PRE-DETECTION**

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: Officer Opens Camera (CameraCapture / ScanScreen)      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Photo Capture                                           │
│  • Camera captures high-res photo                               │
│  • GPS coordinates captured                                     │
│  • Photo converted to data URL for ingest payload               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: Upload Image to Storage                                │
│  Bucket: scans                                                   │
│  {                                                               │
│    path: {userId}/{timestamp}-{uniqueId}.jpg                    │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: Optional ALPR Pre-Detection (alpr-process)             │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ 1. Call /functions/v1/alpr-process with photo_url     │    │
│  │    • Best-effort hint only                             │    │
│  │    • Failure does not block save                       │    │
│  │                                                        │    │
│  │ 2. Extract detected plate + confidence when available  │    │
│  │                                                        │    │
│  │ 3. Prepare ingest payload                              │    │
│  │    {                                                   │    │
│  │      plate: "ABC123" | null,                          │    │
│  │      confidence: 0.98,                                │    │
│  │      requires_manual_entry: false                      │    │
│  │    }                                                   │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5: Continue to Ingest                                     │
│  • ALPR success: pass detected plate/confidence                 │
│  • ALPR failure: save with requires_manual_entry=true           │
└─────────────────────────────────────────────────────────────────┘
```

---

### **PHASE 2: UNIFIED OBSERVATION INGEST**

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 6: Call vehicle-ingest Edge Function                      │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ POST /functions/v1/vehicle-ingest                      │    │
│  │ {                                                       │    │
│  │   image: "data:image/jpeg;base64,...",                │    │
│  │   gpsLatitude, gpsLongitude, gpsAccuracy,              │    │
│  │   recordedAt, officerId, organizationId, zoneId,       │    │
│  │   idempotencyKey, weather,                             │    │
│  │   plate, confidence, requires_manual_entry             │    │
│  │ }                                                       │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 7: Ingest Validation + Insert                              │
│  • Auth/JWT checked                                              │
│  • GPS/zone/organization/idempotency required                    │
│  • Image uploaded (storage) + SHA-256 hash generated             │
│  • Observation inserted into observations table                  │
│  • Canonical vehicle created/updated as needed                   │
└─────────────────────────────────────────────────────────────────┘
```

---

### **PHASE 3: RESPONSE & OFFICER UX**

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 8: Response to Client                                      │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ success: true                                          │    │
│  │ observation_id: "uuid"                                │    │
│  │ source: "onspace_fallback" | "railway_inference"       │    │
│  │ plate: "ABC123" | null                                │    │
│  │ confidence: 0.87 | null                                │    │
│  │ requires_manual_entry: boolean                         │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 9: Officer UX Outcome                                      │
│  • Success toast shown immediately                               │
│  • Scan appears in recent observations                           │
│  • Manual review required if no reliable plate detected          │
└─────────────────────────────────────────────────────────────────┘
```

---

### **PHASE 4: MOBILE APP UI DISPLAY**

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 10: Scan Result Modal (ScanResultModal Component)         │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  ╔═══════════════════════════════════════════════════╗ │    │
│  │  ║  🚗 ABC123                         ✅ COMPLIANT  ║ │    │
│  │  ║                                                   ║ │    │
│  │  ║  📸 [Photo Preview]                               ║ │    │
│  │  ║                                                   ║ │    │
│  │  ║  📋 VEHICLE DETAILS                               ║ │    │
│  │  ║  Make: Toyota                                     ║ │    │
│  │  ║  Model: Hiace                                     ║ │    │
│  │  ║  Color: White                                     ║ │    │
│  │  ║  Year: 2018                                       ║ │    │
│  │  ║                                                   ║ │    │
│  │  ║  ⚠️ ALERTS                                        ║ │    │
│  │  ║  ✅ Self-contained certification detected         ║ │    │
│  │  ║  📊 5 prior observations in system                ║ │    │
│  │  ║                                                   ║ │    │
│  │  ║  📍 LOCATION                                      ║ │    │
│  │  ║  Zone: Wakatu Carpark                            ║ │    │
│  │  ║  GPS: -41.27155, 173.28300 (±10m)               ║ │    │
│  │  ║                                                   ║ │    │
│  │  ║  [Edit Details] [Create Incident] [Report H&S]  ║ │    │
│  │  ║  [Close]                                          ║ │    │
│  │  ╚═══════════════════════════════════════════════════╝ │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 **DATA FLOW DIAGRAM**

```
┌──────────────┐
│ Mobile App   │
│ (Camera)     │
└──────┬───────┘
       │ Photo + GPS
       ↓
┌──────────────────────┐
│ alpr-process (hint)  │ → Best-effort pre-detection from photo_url
│ Edge Function        │ → Non-blocking, may return null plate
└──────┬───────────────┘
       │ Plate + Confidence + Stickers
       ↓
┌──────────────────────┐
│ Upload to Storage    │ → Supabase Storage (scans bucket)
│ (Photo Evidence)     │
└──────┬───────────────┘
   │ Photo URL
       ↓
┌──────────────────────┐
│ vehicle-ingest       │
│ Edge Function        │
└──────┬───────────────┘
       │
   ├─→ Validate payload/auth
   ├─→ Upload/hash image internally
   ├─→ Get/Create canonical_vehicles
   ├─→ Create observations record
       │
       ↓
┌──────────────────────┐
│ Response to App      │
│ (Scan Results)       │
└──────┬───────────────┘
       │
       ↓
┌──────────────────────┐
│ Field Portal UI      │
│ (Success + History)  │
└──────┬───────────────┘
       │
   ├─→ [Option] Create Incident → Incident report
   ├─→ [Option] Report H&S → Health & Safety report
   └─→ [Close] → Return to scanning/dashboard
```

---

## ⚙️ **REQUIRED CONFIGURATION**

### **1. Environment Variables (Supabase Secrets)**
```bash
PLATE_RECOGNIZER_API_KEY=sk_xxx...    # ALPR service (Plate Recognizer)
# AI features — get key at https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=                      # Leave blank for OpenAI; set for alternative providers
```

### **2. Database Tables Involved**
- `canonical_vehicles` - One record per plate globally
- `observations` - Every scan/sighting
- `compliance_results` - Compliance evaluation per observation
- `zone_compliance_matrix` - Zone rules (versioned)
- `flagged_vehicles` - Watch list
- `zones` - Geofenced areas with GPS polygons
- `user_profiles` - Officer accounts
- `organizations` - Client organizations

### **3. Storage Buckets**
- `scans` bucket (web/mobile capture uploads)
- `evidence` bucket (used by ingest/internal evidence pipeline)

### **4. Edge Functions Deployed**
- `alpr-process` - ALPR pipeline + enrichment (best-effort pre-detection)
- `vehicle-ingest` - Canonical observation ingest pipeline
- `get-weather` - Optional weather enrichment

---

## 🚨 **FAILURE POINTS & TROUBLESHOOTING**

### **Common Issues:**

1. **"No GPS accuracy" error**
   - **Cause:** Mobile app not requesting location permissions
   - **Fix:** Check expo-location permissions in mobile app

2. **"GPS accuracy too poor" (>100m)**
   - **Cause:** Indoor/urban canyon GPS signal
   - **Fix:** Move to open area, retry scan

3. **"Plate Recognizer API error"**
   - **Cause:** API key invalid or rate limit exceeded
   - **Fix:** Verify `PLATE_RECOGNIZER_API_KEY` in Supabase secrets

4. **"AI service error"**
   - **Cause:** API key missing or invalid
   - **Fix:** Verify `OPENAI_API_KEY` in Supabase secrets
     (get key at https://platform.openai.com/api-keys)

5. **"Zone not selected"**
   - **Cause:** User didn't select zone or zones not loaded
   - **Fix:** Ensure zones exist for organization, check RLS policies

6. **Low confidence (<0.8)**
   - **Cause:** Poor photo quality, obscured plate
   - **Fix:** Retake photo with better lighting/angle
   - **Fallback:** Manual OCR overlay appears for correction

7. **Photo upload fails**
   - **Cause:** Large file size (>10MB) or network timeout
   - **Fix:** Compress photo via expo-image-manipulator
   - **Fallback:** Offline queue stores scan for later sync

---

## 📱 **MOBILE APP COMPONENTS (React Native)**

### **Key Components:**
1. **PlateCapture** - Camera interface with ALPR trigger
2. **ScanResultModal** - Displays scan results with alerts
3. **VehicleEditDrawer** - Edit vehicle details post-scan
4. **IncidentCreationForm** - Create incident from scan
5. **HSReportingForm** - Health & Safety reporting
6. **OfflineQueueView** - Manage offline scans

### **Services:**
1. **vehicleObservation.ts** - Handles observation submission
2. **offlineQueue.ts** - Offline persistence & sync
3. **patrolService.ts** - GPS tracking & welfare monitoring

---

## 🔒 **SECURITY & COMPLIANCE**

1. **Photo Evidence Integrity:**
   - SHA256 hash calculated on upload
   - Stored in `photo_metadata` table
   - Court-ready evidence chain

2. **GPS Validation:**
   - Server-side accuracy check (≤100m)
   - Reject scans with poor GPS for evidentiary use

3. **RLS Policies:**
   - Officers can only see own organization's data
   - Admins see all org data
   - Master users see all organizations

4. **Data Retention:**
   - Photos retained per `photo_retention_policies`
   - Court-ready photos excluded from auto-deletion
   - Configurable retention periods

---

## 📈 **PERFORMANCE METRICS**

- **Average scan time:** 3-5 seconds (camera → result)
- **ALPR accuracy:** 95%+ confidence for clear plates
- **Sticker detection:** 85%+ accuracy with good lighting
- **Offline capability:** Full scan works offline, syncs when online
- **GPS accuracy target:** ≤50m for optimal compliance checks

---

This comprehensive schematic shows the complete end-to-end flow from camera capture to database storage, including all backend processing, AI analysis, compliance checking, and user interface feedback.
