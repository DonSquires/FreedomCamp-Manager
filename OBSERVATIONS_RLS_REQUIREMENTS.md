# Observations Table - RLS Requirements

**Date**: 2025-02-27  
**Status**: ✅ **ACTIVE**

---

## 🔐 Required RLS Policies

### 1. **INSERT Policy for SERVICE_ROLE (Edge Functions)**

```sql
CREATE POLICY "service_role_insert_observations"
  ON observations
  FOR INSERT
  TO service_role
  WITH CHECK (true);
```

**Purpose**: Allow Edge Functions (using SERVICE_ROLE_KEY) to bypass RLS entirely  
**Required Fields in Payload**: ALL fields must be provided by the Edge Function  
**Security**: Safe because SERVICE_ROLE_KEY is secret and only Edge Functions have access

---

### 2. **INSERT Policy for Authenticated Users (Direct Client Inserts)**

```sql
CREATE POLICY "authenticated_insert_own_observations"
  ON observations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
  );
```

**Purpose**: Allow authenticated users to insert observations where they are the recorder  
**Required Fields**:
- ✅ `recorded_by` MUST equal `auth.uid()` (current user's ID)

---

### 3. **SELECT Policy for Users (View Observations)**

```sql
CREATE POLICY "users_view_observations"
  ON observations
  FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master'::text) OR 
    (organization_id = ANY (get_user_organization_ids()))
  );
```

**Purpose**: Allow users to view observations from their organization(s)  
**Access Rules**:
- ✅ Masters can view ALL observations
- ✅ Users can view observations where `organization_id` matches their assigned organizations

---

### 4. **UPDATE Policy for Admins**

```sql
CREATE POLICY "admins_update_observations"
  ON observations
  FOR UPDATE
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'master'::text])) AND
    (
      (get_user_role(auth.uid()) = 'master'::text) OR 
      (organization_id = get_user_organization_id(auth.uid()))
    )
  );
```

**Purpose**: Allow admins to update observations in their organization  
**Access Rules**:
- ✅ Masters can update ALL observations
- ✅ Admins can update observations in their organization only

---

### 5. **DELETE Policy (Super Delete Only)**

```sql
CREATE POLICY "super_delete_observations"
  ON observations
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM user_profiles
      WHERE id = auth.uid() 
        AND email = 'don.squire@firstsecurity.co.nz'
        AND permissions @> '["super_delete"]'::jsonb
    )
  );
```

**Purpose**: Only specific super-admin can hard delete observations  
**Access Rules**:
- ✅ Only user with email `don.squire@firstsecurity.co.nz` AND `super_delete` permission

---

## 📋 Required Fields for Successful INSERT

When using **vehicle-ingest Edge Function** (SERVICE_ROLE mode):

### Mandatory Fields:
| Field | Type | Source | Example |
|-------|------|--------|---------|
| `idempotency_key` | text | Generated | `"user-id-1709056800000"` |
| `plate_number` | text | ALPR/OCR/Manual | `"ABC123"` |
| `photo_url` | text | Storage upload | `"https://..."` |
| `photo_hash` | text | SHA-256 hash | `"a1b2c3d4..."` |
| `recorded_at` | timestamp | Device time | `"2025-02-27T20:00:00Z"` |
| `zone_id` | uuid | GPS/Geofence | `"zone-uuid"` |
| `organization_id` | uuid | User profile | `"org-uuid"` |
| `gps_latitude` | numeric | GPS API | `-36.8485` |
| `gps_longitude` | numeric | GPS API | `174.7633` |
| `recorded_by` | uuid | Auth session | `"user-uuid"` |

### Optional Fields:
| Field | Type | Default | Example |
|-------|------|---------|---------|
| `gps_accuracy` | numeric | null | `15.0` |
| `officer_notes` | text | null | `"Vehicle parked overnight"` |
| `weather_conditions` | text | null | `"Clear"` |
| `vehicle_make` | text | null | `"Toyota"` |
| `vehicle_model` | text | null | `"Hiace"` |
| `vehicle_year` | integer | null | `2015` |
| `vehicle_color` | text | null | `"White"` |
| `self_contained` | boolean | false | `true` |
| `self_contained_expiry` | date | null | `"2025-12-31"` |

---

## 🛡️ Security Validation Flow

```
1. User clicks "Open Scanner" in Field Officer Portal
   ↓
2. Pre-flight validation (BEFORE camera opens):
   - user.id exists? ✅
   - user.organization_id exists? ✅
   - zoneId selected (auto-detected or manual)? ✅
   ↓
3. Camera opens, photo captured
   ↓
4. Photo uploaded to Supabase Storage:
   - SHA-256 hash generated
   - Public URL obtained
   ↓
5. ALPR/OCR processing (Onspace AI or Railway)
   ↓
6. Edge Function (vehicle-ingest) called with JWT token in Authorization header
   ↓
7. Edge Function validates JWT:
   - Extracts user_id from token
   - Verifies token is valid
   ↓
8. Edge Function uses SERVICE_ROLE_KEY to create Supabase client
   ↓
9. Edge Function inserts observation with ALL required fields:
   {
     idempotency_key: "user-id-timestamp",
     plate_number: "ABC123",
     photo_url: "https://...",
     photo_hash: "sha256-hash",
     recorded_at: "2025-02-27T20:00:00Z",
     zone_id: "zone-uuid",
     organization_id: "org-uuid",
     gps_latitude: -36.8485,
     gps_longitude: 174.7633,
     recorded_by: "user-uuid",
     ... (other fields)
   }
   ↓
10. RLS Policy Check:
    - SERVICE_ROLE bypasses all RLS checks ✅
    ↓
11. INSERT succeeds
    ↓
12. Database triggers run:
    - Update monthly stays
    - Calculate compliance
    - Create breach alerts if needed
```

---

## ❌ Common RLS Errors and Fixes

### Error: "new row violates row-level security policy"

**Cause**: Required fields are NULL or missing

**Fix**:
```typescript
// ❌ WRONG - Missing fields
const { error } = await supabase.from('observations').insert({
  plate_number: "ABC123",
  photo_url: "https://..."
  // Missing: recorded_by, organization_id, zone_id
})

// ✅ CORRECT - All required fields
const { error } = await supabase.from('observations').insert({
  plate_number: "ABC123",
  photo_url: "https://...",
  recorded_by: user.id,              // ← REQUIRED
  organization_id: user.organization_id, // ← REQUIRED
  zone_id: selectedZone,             // ← REQUIRED
  ... // other fields
})
```

---

### Error: "permission denied for table observations"

**Cause**: User doesn't have access to view/edit observations

**Fix**: Check user's organization membership
```sql
-- Check user's organizations
SELECT 
  organization_id,
  employer_organization_id,
  authorized_work_locations
FROM user_profiles
WHERE id = auth.uid();
```

---

## 🧪 Testing RLS Policies

### Test 1: Officer Can Insert Own Observation
```sql
-- Run as officer user
INSERT INTO observations (
  plate_number, photo_url, photo_hash, recorded_at,
  zone_id, organization_id, gps_latitude, gps_longitude,
  recorded_by, idempotency_key
) VALUES (
  'TEST123', 'https://test.jpg', 'test_hash', now(),
  '<zone_id>', '<org_id>', -36.8485, 174.7633,
  auth.uid(), -- ✅ MUST be current user
  'test-key-123'
);
-- Expected: SUCCESS
```

### Test 2: Officer Cannot Insert for Another User
```sql
-- Run as officer user
INSERT INTO observations (
  plate_number, photo_url, photo_hash, recorded_at,
  zone_id, organization_id, gps_latitude, gps_longitude,
  recorded_by, idempotency_key
) VALUES (
  'TEST123', 'https://test.jpg', 'test_hash', now(),
  '<zone_id>', '<org_id>', -36.8485, 174.7633,
  '<other_user_id>', -- ❌ NOT current user
  'test-key-123'
);
-- Expected: ERROR - RLS violation
```

### Test 3: Officer Can View Own Organization's Observations
```sql
-- Run as officer user
SELECT * FROM observations
WHERE organization_id = '<my_org_id>';
-- Expected: SUCCESS - sees all observations in their org
```

### Test 4: Officer Cannot View Other Organization's Observations
```sql
-- Run as officer user
SELECT * FROM observations
WHERE organization_id = '<other_org_id>';
-- Expected: NO ROWS (RLS blocks access)
```

---

## 📊 RLS Policy Summary

| Operation | Role | Condition | Allowed? |
|-----------|------|-----------|----------|
| INSERT | service_role | Always | ✅ Yes (bypass RLS) |
| INSERT | authenticated | recorded_by = auth.uid() | ✅ Yes |
| INSERT | authenticated | recorded_by ≠ auth.uid() | ❌ No |
| SELECT | master | Any organization | ✅ Yes |
| SELECT | authenticated | Own organization(s) | ✅ Yes |
| SELECT | authenticated | Other organization | ❌ No |
| UPDATE | master | Any organization | ✅ Yes |
| UPDATE | admin | Own organization | ✅ Yes |
| UPDATE | officer | Any | ❌ No |
| DELETE | super_admin | Has permission | ✅ Yes |
| DELETE | anyone else | - | ❌ No |

---

**Status**: ✅ **PRODUCTION READY**  
**Last Updated**: 2025-02-27  
**Approved By**: Build System Audit
