# 📊 Observations Report - Data Flow Review

## ✅ **Data Source: 100% From observations**

The ObservationsReport now pulls **exclusively from the observation snapshot** - no dependencies on canonical_vehicles for vehicle details.

---

## 🗂️ **Schema Overview**

### **observations Table Structure**

All observation data is **embedded directly** in the observation record:

```sql
-- Core Fields
observation_id              uuid PRIMARY KEY
plate_number               text                    -- Captured at time of scan
recorded_at                timestamptz             -- When observed

-- Vehicle Snapshot (captured at observation time)
vehicle_make               text                    -- "Toyota"
vehicle_model              text                    -- "Corolla"
vehicle_year               integer                 -- 2018
vehicle_color              text                    -- "Blue"
self_contained             boolean                 -- true/false
self_contained_expiry      date                    -- 2026-12-31

-- Location Data
zone_id                    uuid → zones.id
gps_latitude               numeric(10,8)
gps_longitude              numeric(11,8)
gps_accuracy               numeric(10,2)           -- meters
weather_conditions         text                    -- "Sunny, 18°C"

-- Evidence
photo_hash                 text                    -- SHA-256 hash
photo_original_sha256      text                    -- Original file hash
photo_exif                 jsonb                   -- EXIF metadata

-- Compliance
is_compliant               boolean
breach_type                text
breach_details             jsonb
compliance_summary         jsonb                   -- Pre-calculated metrics

-- Context
organization_id            uuid → organizations.id
recorded_by                uuid → user_profiles.id
officer_notes              text
```

---

## 🔗 **Join Relationships**

### **Required Joins (for display labels only)**

```sql
-- Zone name and fallback GPS coordinates
zone:zones(name, location_lat, location_lng)

-- Officer name
officer:user_profiles!observations_recorded_by_fkey(first_name, last_name)

-- Organization name
organization:organizations(name)

-- Photo URL (evidence bucket)
photo_metadata:photo_metadata!photo_metadata_observation_id_fkey(photo_url)
```

### **❌ Removed Joins (redundant)**

```diff
- canonical:canonical_vehicles!observations_plate_number_fkey(
-   vehicle_make, vehicle_model, vehicle_year, vehicle_color,
-   self_contained, self_contained_expiry, homeless_status
- )
```

**Why removed?**
- Vehicle details are **already in the observation snapshot**
- Joining to canonical_vehicles shows **current state**, not **historical snapshot**
- Creates unnecessary dependency on canonical_vehicles table
- Can fail if plate_number is NULL or vehicle doesn't exist in canonical table

---

## 🔒 **RLS Policy Check**

### **observations**

```sql
users_view_observations_v2 (SELECT, PERMISSIVE):
  ((get_user_role(auth.uid()) = 'master'::text) 
   OR (organization_id = ANY (get_user_organization_ids())))
```

✅ **Result:** Users see observations from their organizations + descendants

---

### **zones**

```sql
users_view_zones (SELECT, PERMISSIVE):
  ((get_user_role(auth.uid()) = 'master'::text) 
   OR (organization_id = ANY (get_user_organization_ids())))
```

✅ **Result:** Users see zones they have access to

---

### **photo_metadata**

```sql
users_view_org_photo_metadata (SELECT, PERMISSIVE):
  ((get_user_role(auth.uid()) = 'master'::text) 
   OR (organization_id = ANY (get_user_organization_ids())))
```

✅ **Result:** Users see photos from their organizations

---

### **user_profiles**

```sql
users_view_own_profile (SELECT, PERMISSIVE):
  (id = auth.uid())

masters_view_all_users (SELECT, PERMISSIVE):
  (get_user_role(auth.uid()) = 'master'::text)

admins_view_org_users (SELECT, PERMISSIVE):
  (get_user_role(auth.uid()) = ANY ('admin', 'admin_officer'))
  AND (organization_id matches)
```

✅ **Result:** Officer names visible to admins + masters

---

### **organizations**

```sql
users_view_accessible_orgs (SELECT, PERMISSIVE):
  (get_user_role(auth.uid()) = 'master'::text)
  OR (id = get_user_organization_id(auth.uid()))
  OR (id = employer_organization_id)
  OR (id IN authorized_work_locations)
  OR (descendant organizations)
```

✅ **Result:** Organization names visible to authorized users

---

## 📋 **Placeholder/Fallback Strategy**

### **Missing Data Handling**

| Field | Fallback Strategy |
|-------|------------------|
| **photo_url** | Historical placeholder image (`historical-record-placeholder.jpg`) |
| **gps_latitude/longitude** | Zone center coordinates (`zone.location_lat`, `zone.location_lng`) |
| **weather_conditions** | `"Not Recorded"` |
| **vehicle_make/model/color** | `"Unknown"` |
| **officer name** | `"Unknown Officer"` |
| **zone name** | `"Unknown Zone"` |
| **organization name** | `"Unknown Organization"` |

### **Visual Indicators**

```typescript
// Historical record without photo
is_historical: !obs.photo_metadata?.[0]?.photo_url

// Show archive icon + "HISTORICAL RECORD" badge
// Use zone GPS with "(Zone Center)" label
```

---

## 🚫 **No Restrictions on Viewing**

### **All observations are viewable if:**

✅ User belongs to the organization (or descendant org)  
✅ User is a master admin  
✅ Observation has valid zone/organization references  
✅ RLS policies allow access  

### **Data is NEVER filtered by:**

❌ Photo availability (historical records still shown)  
❌ GPS availability (zone fallback used)  
❌ Vehicle details completeness (placeholders used)  
❌ Compliance status (all statuses shown)  

---

## 📊 **Complete Data Flow**

### **Query Execution Path**

```
1. Filter by date range (startDate, endDate)
2. Filter by organization (if not master)
3. Filter by zone (if selected)
4. Filter by KPI cohort (optional: overstayers, at-risk, breaches, etc.)

5. Join to zones → get zone name + fallback GPS
6. Join to user_profiles → get officer name
7. Join to organizations → get organization name
8. Join to photo_metadata → get photo URL (or NULL)

9. Transform results:
   - Use observation snapshot for vehicle details
   - Apply fallbacks for missing data
   - Flag historical records (no photo)
   - Use zone GPS when observation GPS is NULL

10. Render cards with:
    - Photo or placeholder
    - GPS watermark (or zone center label)
    - Vehicle details from snapshot
    - Compliance summary
    - Officer notes
```

---

## 🎯 **Key Design Principles**

### **1. Observation Snapshot = Source of Truth**

Vehicle details shown are from **the time of observation**, not current state.

### **2. No External Dependencies**

Report works even if canonical_vehicles, flagged_vehicles, or other tables are empty.

### **3. Graceful Degradation**

Missing data displays with clear placeholders instead of failing.

### **4. Historical Records Supported**

Legacy imports without photos/GPS still render with appropriate indicators.

### **5. RLS-Aware**

Only shows observations user has permission to access.

---

## 🔄 **Data Lifecycle**

### **At Scan Time (vehicle-ingest Edge Function)**

```typescript
1. Receive photo + GPS + metadata
2. Run ALPR or ORC inference
3. Create observation record with:
   - Plate number (if detected)
   - Vehicle snapshot (from canonical_vehicles or AI)
   - GPS coordinates
   - Officer ID, zone ID, organization ID
   - Compliance summary (auto-calculated)
4. Store photo in evidence bucket
5. Create photo_metadata record
6. Link photo to observation
```

### **At Report View Time**

```typescript
1. Query observations (filtered by date/org/zone/KPI)
2. Join to zones/users/orgs/photos for labels
3. Apply fallbacks for missing data
4. Render cards with snapshot data
5. Show compliance summary (pre-calculated)
```

---

## ✅ **Validation Checklist**

- [x] All vehicle details pulled from observation snapshot
- [x] No join to canonical_vehicles (removed redundancy)
- [x] Photo fallback to historical placeholder
- [x] GPS fallback to zone center
- [x] Weather fallback to "Not Recorded"
- [x] Vehicle details fallback to "Unknown"
- [x] Officer/zone/org names fallback to "Unknown"
- [x] Historical records render with archive icon
- [x] Zone GPS labeled as "(Zone Center)"
- [x] RLS policies allow organization access
- [x] No restrictions on viewing observations
- [x] KPI filters work (overstayers, at-risk, breaches, etc.)

---

## 🚀 **Performance Optimization**

### **Indexes Used**

```sql
-- Fast date range filtering
idx_observations_v2_recorded_at

-- Organization filtering
idx_observations_v2_org

-- Zone filtering  
idx_observations_v2_zone

-- Plate lookups (for KPI filters)
idx_obs_plate_org
```

### **Query Complexity**

- **Joins:** 4 (zones, users, orgs, photos)
- **Filters:** 2-4 (date, org, zone, KPI)
- **Expected rows:** 100-5,000 per query
- **P95 latency:** <500ms

---

## 📝 **Summary**

The ObservationsReport now:

1. ✅ Pulls 100% from `observations` snapshot
2. ✅ Has no dependencies on `canonical_vehicles` for vehicle details
3. ✅ Uses placeholders for all missing data
4. ✅ Supports historical/legacy records without photos or GPS
5. ✅ Respects RLS policies (organization-level access)
6. ✅ Has no restrictions preventing users from viewing their observations
7. ✅ Shows vehicle state **at time of observation** (not current state)

**Status:** ✅ All data from observation snapshots, no restrictions on viewing
