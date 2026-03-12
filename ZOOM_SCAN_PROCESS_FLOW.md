# Zoom Scan Complete Process Flow

## ✅ **End-to-End Process Verification**

This document verifies that the zoom scan implements the complete expected workflow from capture to queue notification.

---

## 🔄 **Complete Process Flow**

### **1. User Scans Vehicle**
```
Frontend: ZoomScanQueue.tsx
├─ captureAndProcess() called
├─ Video frame captured from camera
├─ Converted to JPEG data URL (95% quality)
└─ Status: ✅ Photo captured
```

### **2. ALPR Reads Number Plate**
```
Frontend → Edge Function: recognize-plate
├─ Send image data URL
├─ Plate Recognizer API call
├─ Extract: plate_number, vehicle_make, vehicle_model, vehicle_color
└─ Status: ✅ Plate recognition complete OR ❌ Recognition failed
```

**If ALPR fails:**
- ✅ Prompt manual entry
- ✅ Officer types plate manually
- ✅ Continue with manual data (no ALPR enrichment)

### **3. Creates Observation**
```
Edge Function: process-field-scan
├─ Normalize plate number (uppercase, alphanumeric only)
├─ Check for same-day duplicate (BEFORE insertion)
│  ├─ If duplicate found → Return 409 error
│  └─ If no duplicate → Continue
├─ GPS-based zone detection (if GPS available with accuracy ≤100m)
│  ├─ Match GPS to polygon geofences
│  ├─ Fallback to point+radius (100m)
│  └─ If no match → Assign to "Other Location"
├─ Insert into observations table
└─ Status: ✅ Observation created
```

### **4. Enrich Data from Canonical Records**
```
Edge Function: process-field-scan → upsert_canonical_vehicle
├─ Check if canonical_vehicles record exists for plate
│  ├─ If exists → Update with new data (make, model, color, SC status)
│  └─ If not exists → Create new canonical record
├─ Auto-populate observation from canonical_vehicles (via trigger)
│  └─ populate_observation_from_canonical trigger fires
├─ Update canonical_vehicles stats
│  ├─ total_observations++
│  ├─ last_seen_at = now()
│  ├─ first_seen_at (if first observation)
│  └─ total_breaches, total_incidents updated via triggers
└─ Status: ✅ Canonical vehicle enriched
```

**Canonical Vehicle Contains:**
- `plate_number` (PRIMARY KEY)
- `vehicle_make`, `vehicle_model`, `vehicle_year`, `vehicle_color`
- `self_contained`, `self_contained_expiry`
- `homeless_status` ('none', 'claimed', 'confirmed')
- `is_flagged`, `flagged_priority`, `flagged_reason`
- `total_observations`, `total_breaches`, `total_incidents`
- `first_seen_at`, `last_seen_at`

### **5. Measure Against Monthly Stays and Zone Matrix**
```
Edge Function: process-field-scan → calculate_vehicle_compliance_with_results
├─ Get active zone compliance matrix (zone_compliance_matrix)
│  └─ Rules: self_contained_required, nights_per_month, max_consecutive_nights
├─ Query vehicle_monthly_stays for this plate+zone+month
│  ├─ nights_stayed (how many nights already stayed)
│  └─ consecutive_nights (current consecutive streak)
├─ Calculate compliance:
│  ├─ Check self-contained requirement
│  ├─ Check nights_per_month limit
│  └─ Check max_consecutive_nights limit
├─ Evaluate "at risk" scenarios:
│  ├─ nights_stayed + 1 >= nights_per_month → "Final night for month"
│  ├─ consecutive_nights + 1 >= max_consecutive_nights → "Last consecutive night"
│  └─ Will breach if stays overnight → "At risk - potential morning breach"
├─ Store result in compliance_results table
│  └─ Links: observation_id, matrix_id, matrix_version
└─ Status: ✅ Compliance evaluated and stored
```

**Compliance Results Table:**
- `observation_id` → Links to observations
- `matrix_id` → Which zone_compliance_matrix was used
- `is_compliant` → True/false
- `violation_reasons` → Array of breach reasons
- `matrix_snapshot` → Full matrix rules at evaluation time (audit trail)

### **6. Compliance Status Determination**

#### **A. If Breach (Non-Compliant + Not Homeless)**
```
Backend Response:
├─ is_compliant: false
├─ fc_act_exempt: false
├─ alerts: ["⚠️ Non-compliant with zone requirements", "BREACH: Exceeded X nights"]
└─ compliance_result: { violation_reasons: [...] }

Frontend Action:
├─ status = 'breach' (🔴 red)
├─ complianceDetails = "BREACH: [reason from alerts]"
├─ playSounds.violationAlert()
├─ Add to queue with red badge
├─ Show full-screen safety alert modal
└─ Requires manual dismissal (no auto-dismiss)
```

**Breach Enrichment:**
- Auto-creates record in `breach_alerts` table (via trigger)
- Links to: observation_id, plate_number, zone_id, organization_id
- `breach_type`: 'consecutive_nights', 'monthly_limit', 'self_contained', 'after_hours'
- `status`: 'pending' (awaits admin review or enforcement action)

#### **B. If One Night Left (At Risk - Final Night)**
```
Backend Response:
├─ is_compliant: true (not yet breached)
├─ alerts: ["🟡 Final night allowed this month - will breach if stays again"]
└─ compliance_result: { nights_stayed: 27, nights_per_month: 28 }

Frontend Action:
├─ status = 'at_risk' (🟡 yellow)
├─ complianceDetails = "🟡 Final night for month - Monitor compliance"
├─ playSounds.violationAlert()
├─ Add to queue with yellow badge
├─ Enrich observation: flagged_warning = true
└─ Requires manual dismissal (no auto-dismiss)
```

**Observation Enrichment:**
- `breach_warning`: true
- `breach_warning_reason`: "Final night allowed - next stay creates breach"
- Admin dashboard shows "At Risk" filter

#### **C. If Will Breach in Morning (At Risk - Next Overnight)**
```
Backend Response:
├─ is_compliant: true (currently compliant during day scan)
├─ alerts: ["🟡 At Risk - Will breach if stays overnight"]
├─ Background function check-almost-breaches detects:
│  └─ will_breach_if_stays_tonight: true
└─ compliance_result: { consecutive_nights: 2, max_consecutive: 3 }

Frontend Action:
├─ status = 'at_risk' (🟡 yellow)
├─ complianceDetails = "🟡 At Risk - Monitor compliance"
├─ playSounds.violationAlert()
├─ Add to queue with yellow badge
├─ Enrich observation: flagged_warning = true
└─ Requires manual dismissal (no auto-dismiss)
```

**Observation Enrichment:**
- `breach_warning`: true
- `breach_warning_reason`: "Will breach if stays overnight"
- Background breach prediction logged

#### **D. If Compliant**
```
Backend Response:
├─ is_compliant: true
├─ alerts: ["✅ Compliant with zone requirements"]
└─ compliance_result: { is_compliant: true }

Frontend Action:
├─ status = 'compliant' (🟢 green)
├─ complianceDetails = "Vehicle is compliant"
├─ playSounds.processingComplete()
├─ Add to queue with green badge
└─ Auto-dismiss after 5 seconds ⏱️
```

#### **E. If Homeless (FC Act Exempt)**
```
Backend Response:
├─ is_compliant: false (may have zone violations)
├─ fc_act_exempt: true
├─ homeless_status: 'confirmed' or 'claimed'
├─ alerts: ["ℹ️ Homeless vehicle (FC Act Exempt)", "ℹ️ Zone rule breach detected (homeless exemption)"]
└─ compliance_result: { is_compliant: false, but fc_act_exempt applies }

Frontend Action:
├─ status = 'fc_exempt' (💜 purple)
├─ complianceDetails = "💜 Homeless (FC Act Exempt)"
├─ playSounds.homeless()
├─ Add to queue with purple badge
├─ Follow homeless support process (referrals, welfare checks)
└─ Auto-dismiss after 5 seconds ⏱️
```

**Homeless Process:**
- No enforcement actions created (protected by FC Act)
- Optional: Link to homeless support resources
- Optional: Welfare check notification to social services
- Logged for statistical reporting (homeless vehicle counts)

---

## 📋 **Queue Display Behavior**

### **Queue Item Structure**
```typescript
interface QueueItem {
  id: string;                          // observation_id
  plateNumber: string;                 // ABC123
  vehicleMake?: string;                // Toyota
  vehicleModel?: string;               // Hiace
  vehicleColor?: string;               // White
  photoUrl?: string;                   // Public storage URL
  status: 'compliant' | 'at_risk' | 'breach' | 'fc_exempt';
  complianceDetails: string;           // Human-readable summary
  timestamp: Date;                     // Scan time
  vehicleId?: string;                  // canonical_vehicles ID
  observationId?: string;              // observations ID
}
```

### **Auto-Dismiss Rules**
✅ **Compliant:** 5 seconds  
✅ **Homeless (FC Exempt):** 5 seconds  
❌ **At Risk:** Manual dismissal only  
❌ **Breach:** Manual dismissal only  
❌ **Flagged:** Manual dismissal only

### **Visual Queue Layout**
```
┌─────────────────────────────────────────┐
│ TOP 1/4 SCREEN: Queue Results          │
├─────────────────────────────────────────┤
│ 📋 Scan Queue [3 results] 🔴 1 Action   │
├─────────────────────────────────────────┤
│ [Photo] ABC123 🔴 BREACH                │
│         Toyota Hiace • White            │
│         ⚠️ Exceeded 3 consecutive nights│
│         [💬 Advise Owner] [✓ Dismiss]   │
├─────────────────────────────────────────┤
│ [Photo] XYZ789 🟡 AT RISK               │
│         Mazda Bongo • Silver            │
│         🟡 Final night for month        │
│         [✓ Dismiss]                     │
├─────────────────────────────────────────┤
│ [Photo] DEF456 🟢 COMPLIANT             │
│         Ford Ranger • Blue              │
│         Vehicle is compliant (⏱️ 3s)    │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ BOTTOM 3/4 SCREEN: Live Camera Feed    │
│                                         │
│        [Zone Name & GPS Header]        │
│                                         │
│                                         │
│       📹 Live Camera View               │
│                                         │
│                                         │
│     [Zoom Controls Right Side]         │
│                                         │
│                                         │
│    [Large Capture Button Bottom]       │
│                                         │
└─────────────────────────────────────────┘
```

---

## ✅ **Process Verification Checklist**

- [x] **Step 1:** User scans vehicle (photo captured)
- [x] **Step 2:** ALPR reads plate (or manual entry fallback)
- [x] **Step 3:** Creates observation (observations)
- [x] **Step 4:** Enriches from canonical_vehicles (upsert + auto-populate)
- [x] **Step 5:** Measures against monthly stays + zone matrix
- [x] **Step 6A:** If breach → Red badge, alert modal, manual dismiss
- [x] **Step 6B:** If final night → Yellow badge, warning, manual dismiss
- [x] **Step 6C:** If will breach overnight → Yellow badge, manual dismiss
- [x] **Step 6D:** If compliant → Green badge, auto-dismiss 5s
- [x] **Step 6E:** If homeless → Purple badge, auto-dismiss 5s, follow homeless process
- [x] **Queue:** Results displayed with photos, vehicle details, status badges
- [x] **Audio:** Different sounds for breach/at-risk/compliant/homeless/flagged
- [x] **Actions:** "Advise Owner" button for breaches (admin_first workflow)

---

## 🎯 **Key Implementation Details**

### **Backend (process-field-scan Edge Function)**
- ✅ Upserts canonical_vehicles via RPC function
- ✅ Auto-populates observation from canonical (trigger)
- ✅ Calculates compliance with results table population
- ✅ Evaluates "at risk" scenarios (final night, next overnight breach)
- ✅ Checks for flagged vehicles
- ✅ Respects FC Act exemption for homeless
- ✅ Returns comprehensive response with all enriched data

### **Frontend (ZoomScanQueue.tsx)**
- ✅ Capture → Watermark → Upload → ALPR → Process
- ✅ Manual entry fallback on ALPR failure
- ✅ Parses backend response and determines queue status
- ✅ Visual queue display with color-coded badges
- ✅ Audio feedback for each status type
- ✅ Full-screen safety alerts for breaches
- ✅ Auto-dismiss compliant (5s) and homeless (5s)
- ✅ Persistent queue with localStorage

### **Database Triggers & Functions**
- ✅ `populate_observation_from_canonical` → Auto-fills observation from canonical
- ✅ `update_canonical_stats_v2` → Updates canonical_vehicles aggregates
- ✅ `update_monthly_stays_on_observation` → Updates vehicle_monthly_stays
- ✅ `auto_create_compliance_result` → Creates compliance_results record
- ✅ `create_breach_alert_from_observation` → Auto-creates breach_alerts

---

## 📊 **Expected Outcomes**

| Scenario | Queue Badge | Auto-Dismiss | Action Required |
|----------|-------------|--------------|-----------------|
| Compliant | 🟢 Green | 5 seconds | None |
| Homeless (compliant or not) | 💜 Purple | 5 seconds | Homeless support process |
| Final night for month | 🟡 Yellow | Manual | Monitor closely |
| Will breach if stays overnight | 🟡 Yellow | Manual | Monitor closely |
| Active breach | 🔴 Red | Manual | Enforcement action |
| Flagged vehicle | 🔴 Red | Manual | Safety alert + enforcement |

---

**Status:** ✅ Complete process flow verified and documented  
**Last Updated:** 2026-02-18  
**Auto-Dismiss:** Compliant (5s), Homeless (5s), At-Risk/Breach (Manual)
