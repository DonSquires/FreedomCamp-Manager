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

### **PHASE 1: CAMERA CAPTURE & ALPR PROCESSING**

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: Officer Opens Camera (PlateCapture Component)          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Photo Capture                                           │
│  • expo-camera API captures high-res photo                      │
│  • GPS coordinates captured (expo-location)                     │
│  • Photo compressed via expo-image-manipulator                  │
│  • Base64 encoding for transmission                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: Call recognize-plate Edge Function                     │
│  POST /functions/v1/recognize-plate                             │
│  {                                                               │
│    image: "data:image/jpeg;base64,..."                          │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: ALPR Processing (recognize-plate function)             │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ 1. Send photo to Plate Recognizer API                 │    │
│  │    • Region: NZ                                        │    │
│  │    • Returns: plate, confidence, vehicle details      │    │
│  │                                                        │    │
│  │ 2. OnSpace AI Sticker Detection (parallel)            │    │
│  │    • Model: google/gemini-3-flash-preview             │    │
│  │    • Prompt: "Search ENTIRE vehicle for stickers"    │    │
│  │    • Returns: has_green_sticker, has_blue_sticker    │    │
│  │                                                        │    │
│  │ 3. Merge Results                                       │    │
│  │    {                                                   │    │
│  │      plate_number: "ABC123",                          │    │
│  │      confidence: 0.98,                                │    │
│  │      has_green_sticker: false,                        │    │
│  │      has_blue_sticker: true,                          │    │
│  │      vehicle_make: "Toyota",                          │    │
│  │      vehicle_model: "Hiace",                          │    │
│  │      vehicle_color: "White"                           │    │
│  │    }                                                   │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5: Confidence Check                                        │
│  • IF confidence >= 0.8: Auto-accept plate                      │
│  • IF confidence < 0.8: Show OCR overlay for manual correction  │
└─────────────────────────────────────────────────────────────────┘
```

---

### **PHASE 2: PHOTO UPLOAD & DATA ENRICHMENT**

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 6: Upload Evidence Photo to Supabase Storage              │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ 1. Convert base64 → blob                               │    │
│  │ 2. Upload to 'evidence' bucket                         │    │
│  │    Path: {userId}/{timestamp}-{plateNumber}.jpg       │    │
│  │ 3. Generate public URL                                 │    │
│  │ 4. Calculate SHA256 hash (court evidence integrity)   │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 7: Call process-field-scan Edge Function                  │
│  POST /functions/v1/process-field-scan                          │
│  {                                                               │
│    plateNumber: "ABC123",                                       │
│    zoneId: "uuid",                                              │
│    organizationId: "uuid",                                      │
│    imageUrl: "https://...evidence/photo.jpg",                  │
│    gpsLocation: { lat: -41.27, lng: 173.28, accuracy: 10 },   │
│    vehicleDetails: { make: "Toyota", model: "Hiace", ... },    │
│    detectionMethod: "alpr",                                     │
│    confidence: 0.98,                                            │
│    isSelfContained: false,                                      │
│    hasGreenSticker: false,                                      │
│    hasBlueSticker: true                                         │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

### **PHASE 3: BACKEND PROCESSING (process-field-scan)**

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 8: Backend Processing Pipeline                            │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ 1. GPS VALIDATION                                      │    │
│  │    • Check accuracy ≤ 100m (court-ready requirement)  │    │
│  │    • Reject if > 100m with error message              │    │
│  │                                                        │    │
│  │ 2. GET/CREATE CANONICAL VEHICLE                       │    │
│  │    • Normalize plate: ABC123 → ABC123                │    │
│  │    • Check canonical_vehicles table                   │    │
│  │    • If exists: Use existing data, update last_seen  │    │
│  │    • If new: Create new canonical_vehicles record    │    │
│  │                                                        │    │
│  │ 3. DATA ENRICHMENT FROM HISTORY                       │    │
│  │    • Pull make/model/color from previous observations │    │
│  │    • Populate missing fields from scan                │    │
│  │    • Use best available data (history > current)      │    │
│  │                                                        │    │
│  │ 4. CHECK FLAGGED VEHICLES                             │    │
│  │    • Query flagged_vehicles table                     │    │
│  │    • Get flag reason, priority, notes                 │    │
│  │                                                        │    │
│  │ 5. CREATE VEHICLE OBSERVATION                         │    │
│  │    INSERT INTO vehicle_observations {                 │    │
│  │      vehicle_id,                                      │    │
│  │      zone_id,                                         │    │
│  │      organization_id,                                 │    │
│  │      recorded_by,                                     │    │
│  │      is_self_contained,                               │    │
│  │      gps_latitude,                                    │    │
│  │      gps_longitude,                                   │    │
│  │      gps_accuracy,                                    │    │
│  │      evidence_photos,                                 │    │
│  │      notes                                            │    │
│  │    }                                                   │    │
│  │                                                        │    │
│  │ 6. RUN COMPLIANCE CHECK                               │    │
│  │    • Get active zone_compliance_matrix                │    │
│  │    • Call calculate_vehicle_compliance()              │    │
│  │    • Check:                                           │    │
│  │      - Self-contained requirement                     │    │
│  │      - Nights per month limit                         │    │
│  │      - Consecutive nights limit                       │    │
│  │      - Day visit only zones                           │    │
│  │      - Allowed days                                   │    │
│  │    • Create compliance_results record                 │    │
│  │                                                        │    │
│  │ 7. DUPLICATE DETECTION                                │    │
│  │    • Check for same vehicle in last 8 hours           │    │
│  │    • Return duplicate info if found                   │    │
│  │                                                        │    │
│  │ 8. BUILD RESPONSE WITH ALERTS                         │    │
│  │    • "New vehicle" if first observation               │    │
│  │    • "FLAGGED VEHICLE" if on watch list               │    │
│  │    • "Non-compliant" if violations detected           │    │
│  │    • "Self-contained certified" if sticker found      │    │
│  │    • "X prior observations"                           │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 9: Response to Mobile App                                 │
│  {                                                               │
│    success: true,                                               │
│    vehicle_id: "uuid",                                          │
│    observation_id: "uuid",                                      │
│    plate_number: "ABC123",                                      │
│    is_new_vehicle: false,                                       │
│    is_flagged: false,                                           │
│    is_compliant: true,                                          │
│    is_duplicate: false,                                         │
│    prior_observations_count: 5,                                 │
│    alerts: [                                                    │
│      "✅ Self-contained certification detected",                │
│      "📊 5 prior observations in system"                        │
│    ],                                                            │
│    vehicle_details: {                                           │
│      make: "Toyota",                                            │
│      model: "Hiace",                                            │
│      color: "White",                                            │
│      year: "2018"                                               │
│    },                                                            │
│    data_source: "database_history"                             │
│  }                                                               │
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
│ recognize-plate      │ → Plate Recognizer API (ALPR)
│ Edge Function        │ → OnSpace AI (Sticker Detection)
└──────┬───────────────┘
       │ Plate + Confidence + Stickers
       ↓
┌──────────────────────┐
│ Upload to Storage    │ → Supabase Storage (evidence bucket)
│ (Photo Evidence)     │
└──────┬───────────────┘
       │ Photo URL + Hash
       ↓
┌──────────────────────┐
│ process-field-scan   │
│ Edge Function        │
└──────┬───────────────┘
       │
       ├─→ Get/Create canonical_vehicles
       ├─→ Create vehicle_observations
       ├─→ Run calculate_vehicle_compliance()
       ├─→ Create compliance_results
       ├─→ Check flagged_vehicles
       ├─→ Detect duplicates
       │
       ↓
┌──────────────────────┐
│ Response to App      │
│ (Scan Results)       │
└──────┬───────────────┘
       │
       ↓
┌──────────────────────┐
│ Scan Result Modal    │
│ (User Reviews)       │
└──────┬───────────────┘
       │
       ├─→ [Option] Edit Details → Update observation
       ├─→ [Option] Create Incident → Incident report
       ├─→ [Option] Report H&S → Health & Safety report
       └─→ [Close] → Return to scanning or dashboard
```

---

## ⚙️ **REQUIRED CONFIGURATION**

### **1. Environment Variables (Supabase Secrets)**
```bash
PLATE_RECOGNIZER_API_KEY=sk_xxx...    # ALPR service
ONSPACE_AI_API_KEY=sk-xxx...          # OnSpace AI
ONSPACE_AI_BASE_URL=https://api.onspace.ai/v1
```

### **2. Database Tables Involved**
- `canonical_vehicles` - One record per plate globally
- `vehicle_observations` - Every scan/sighting
- `compliance_results` - Compliance evaluation per observation
- `zone_compliance_matrix` - Zone rules (versioned)
- `flagged_vehicles` - Watch list
- `zones` - Geofenced areas with GPS polygons
- `user_profiles` - Officer accounts
- `organizations` - Client organizations

### **3. Storage Buckets**
- `evidence` bucket (public: true, 10MB limit, .jpg/.jpeg/.png/.webp)

### **4. Edge Functions Deployed**
- `recognize-plate` - ALPR + sticker detection
- `process-field-scan` - Full scan processing pipeline
- `analyze-vehicle-photo` - Optional AI enrichment (make/model/color)

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

4. **"OnSpace AI error"**
   - **Cause:** API key missing or invalid
   - **Fix:** Verify `ONSPACE_AI_API_KEY` and `ONSPACE_AI_BASE_URL`

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
