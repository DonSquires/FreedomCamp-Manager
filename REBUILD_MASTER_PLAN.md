# 🏗️ COMPLETE SYSTEM REBUILD - MASTER PLAN

## 🎯 OBJECTIVE
Rebuild the entire Freedom Camping Compliance System from the ground up using clean architecture principles while preserving 17,000+ vehicle records and critical data.

---

## 📊 DATA TO PRESERVE (CRITICAL - NO DATA LOSS)

### ✅ Core Tables (Keep As-Is)
1. **canonical_vehicles** - 17,000+ vehicle records (plate_number PK)
2. **vehicle_observations_v2** - All observation history
3. **zones** - Location definitions with compliance rules
4. **organizations** - Tenant data
5. **user_profiles** - User accounts and permissions
6. **zone_compliance_matrix** - Historical compliance rules with versioning

### ⚠️ Supporting Tables (Keep Data, Rebuild Structure)
1. **vehicle_monthly_stays** - Stay tracking (keep data, optimize schema)
2. **enforcement_actions** - Enforcement history (keep data)
3. **incidents** - Incident reports (keep data)
4. **health_safety_reports** - H&S records (keep data)
5. **patrols** - Patrol assignments (keep data)

### ❌ Tables to Deprecate/Remove
1. **canonical_vehicles_backup_20250203** - Old backup (migrate if needed)
2. **vehicle_observations** - Old schema (already migrated to v2)
3. **vehicle_records** - Deprecated (consolidated into canonical_vehicles)
4. **flagged_vehicles** - Merged into canonical_vehicles.is_flagged
5. All audit/migration staging tables

---

## 🏛️ NEW ARCHITECTURE PRINCIPLES

### 1. **Single Source of Truth**
- `canonical_vehicles` = Master vehicle registry (permanent data)
- `vehicle_observations_v2` = Event stream (time-series data)
- NO duplicate storage of vehicle attributes

### 2. **Simplified Data Flow**
```
SCAN → Plate Recognizer API → Edge Function → Database → Real-time UI
```

### 3. **Clean Separation of Concerns**
- **Frontend**: Pure UI/UX (React components)
- **Edge Functions**: Business logic only
- **Database**: Data integrity via constraints/triggers
- **RLS Policies**: Security only

### 4. **Consolidated Functions**
- 1 Edge Function for plate recognition (unified ALPR/OCR/AI)
- 1 Edge Function for field scan processing
- 1 Edge Function for compliance evaluation
- 1 Edge Function for breach detection
- All others are utilities (exports, reports, enrichment)

---

## 🗄️ PHASE 1: DATABASE CLEANUP & OPTIMIZATION

### Step 1.1: Backup Current State
```sql
-- Create full database backup BEFORE any changes
-- Export to CSV: canonical_vehicles, vehicle_observations_v2, all critical tables
```

### Step 1.2: Remove Deprecated Tables
```sql
DROP TABLE IF EXISTS canonical_vehicles_backup_20250203 CASCADE;
DROP TABLE IF EXISTS vehicle_observations CASCADE;
DROP TABLE IF EXISTS vehicle_records CASCADE;
DROP TABLE IF EXISTS flagged_vehicles CASCADE;
DROP TABLE IF EXISTS verification_results CASCADE;
DROP TABLE IF EXISTS plate_history CASCADE;
```

### Step 1.3: Optimize Core Tables
```sql
-- canonical_vehicles: Add missing indexes
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_plate_number ON canonical_vehicles(plate_number);
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_updated_at ON canonical_vehicles(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_flagged_homeless ON canonical_vehicles(is_flagged, homeless_status);

-- vehicle_observations_v2: Add composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_observations_v2_plate_zone_date ON vehicle_observations_v2(plate_number, zone_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_v2_org_date ON vehicle_observations_v2(organization_id, recorded_at DESC);
```

### Step 1.4: Rebuild Compliance Architecture
```sql
-- 1. Drop old compliance function
DROP FUNCTION IF EXISTS calculate_vehicle_compliance CASCADE;
DROP FUNCTION IF EXISTS calculate_vehicle_compliance_with_results CASCADE;
DROP FUNCTION IF EXISTS evaluate_compliance CASCADE;

-- 2. Create NEW unified compliance function
CREATE FUNCTION check_vehicle_compliance_v3(
  p_plate_number TEXT,
  p_zone_id UUID,
  p_observation_id UUID,
  p_check_date DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (
  is_compliant BOOLEAN,
  violation_type TEXT,
  violation_message TEXT,
  consecutive_nights INTEGER,
  month_nights INTEGER,
  fc_act_exempt BOOLEAN
);

-- 3. Create compliance results tracking (simplified)
-- Uses plate_number directly (no foreign key complexity)
```

### Step 1.5: Consolidate Triggers
```sql
-- Remove all duplicate triggers
-- Keep only essential triggers:
-- 1. Update canonical_vehicles stats on new observation
-- 2. Sync homeless status from observations to canonical
-- 3. Update monthly_stays on new observation
-- 4. Auto-generate compliance_results on observation insert
```

---

## 🔧 PHASE 2: EDGE FUNCTIONS REBUILD

### Core Functions (4 Total)
1. **recognize-plate** (ALPR/OCR/AI unified)
   - Single Plate Recognizer API call
   - Returns: plate, make, model, color, year, stickers
   
2. **process-field-scan** (Observation creation + compliance)
   - Upserts canonical_vehicles
   - Creates vehicle_observations_v2
   - Runs compliance check
   - Returns: all vehicle data + compliance status
   
3. **check-breach-status** (Real-time breach detection)
   - Checks consecutive/monthly limits
   - Returns: will_breach_if_stays_tonight
   - Triggers alerts if needed
   
4. **enrich-vehicle-data** (Background enrichment)
   - Motorweb integration
   - AI photo analysis
   - NZSCV verification
   - Updates canonical_vehicles

### Utility Functions (Keep Minimal)
- `generate-leadership-pack`
- `generate-incident-pdf`
- `export-compliance-data`
- `send-push-notification`

### Functions to Remove
- All duplicate compliance functions
- All duplicate breach check functions
- All staging/migration functions
- All experimental functions

---

## 🎨 PHASE 3: FRONTEND REBUILD

### Core Components (Streamlined)
1. **PlateCapture.tsx** - Camera + unified processing
2. **VehicleDetailsPopup.tsx** - Review before adding
3. **ComplianceResultModal.tsx** - Show compliance status
4. **FieldOfficerPortal.tsx** - Main officer interface
5. **AdminPortal.tsx** - Consolidated admin hub

### Remove Duplicate Components
- Old ScanResultModal (replaced by VehicleDetailsPopup)
- Old compliance modals (consolidated)
- Experimental/unused components

### Simplified Workflows
1. **Handheld Mode**: Scan → Details Popup → Check → Compliance Modal → Continue/Evidence
2. **Driving Mode**: Auto-scan → Background processing → Queue review

---

## 📋 PHASE 4: EXECUTION PLAN

### Week 1: Database Foundation
- Day 1: Full backup + remove deprecated tables
- Day 2: Optimize indexes + rebuild compliance function
- Day 3: Consolidate triggers + test with existing data
- Day 4: Verify all 17k records intact + compliance works
- Day 5: Performance testing + optimization

### Week 2: Edge Functions
- Day 1: Rebuild recognize-plate (unified)
- Day 2: Rebuild process-field-scan (clean)
- Day 3: Rebuild check-breach-status (simplified)
- Day 4: Rebuild enrich-vehicle-data (Motorweb + AI)
- Day 5: Remove deprecated functions + testing

### Week 3: Frontend
- Day 1: PlateCapture.tsx cleanup
- Day 2: VehicleDetailsPopup.tsx optimization
- Day 3: ComplianceResultModal.tsx consolidation
- Day 4: FieldOfficerPortal.tsx streamlining
- Day 5: Full integration testing

### Week 4: Testing & Deployment
- Day 1-2: End-to-end testing with real data
- Day 3: Performance benchmarking
- Day 4: User acceptance testing
- Day 5: Production deployment

---

## 🚨 CRITICAL SUCCESS FACTORS

### Data Integrity
- ✅ ZERO data loss from 17k+ vehicle records
- ✅ All observations preserved with full history
- ✅ All user accounts and permissions intact
- ✅ All zone configurations preserved

### Performance Targets
- ⚡ Scan-to-result: <3 seconds
- ⚡ Compliance check: <1 second
- ⚡ Database queries: <500ms (95th percentile)
- ⚡ Real-time updates: <2 seconds

### Code Quality
- 📏 Max function size: 150 lines
- 📏 Max file size: 500 lines
- 📏 No duplicate logic
- 📏 100% TypeScript strict mode

---

## 🎯 IMMEDIATE NEXT STEPS

1. **BACKUP EVERYTHING** - Full database export
2. **Create migration script** - Safe data preservation
3. **Start with database cleanup** - Remove deprecated tables
4. **Rebuild compliance function** - Single source of truth
5. **Test with existing data** - Verify 17k records work

---

## 📞 DECISION POINTS

Before proceeding, confirm:
1. ✅ Backup strategy approved?
2. ✅ OK to remove deprecated tables?
3. ✅ Ready for 4-week rebuild timeline?
4. ✅ User acceptance testing plan in place?

**Let's start with Phase 1: Database Cleanup** - I'll create the migration scripts now.
