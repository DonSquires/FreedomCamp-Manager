# Row Level Security (RLS) Policies Documentation

**Project:** FreedomCamp Manager  
**Database:** Supabase PostgreSQL  
**Last Updated:** January 27, 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Core Principles](#core-principles)
3. [Helper Functions](#helper-functions)
4. [Policy Patterns](#policy-patterns)
5. [Complete RLS Policy Reference](#complete-rls-policy-reference)
6. [Testing & Validation](#testing--validation)
7. [Common Issues & Solutions](#common-issues--solutions)

---

## Overview

**ALL tables in FreedomCamp Manager have Row Level Security (RLS) enabled.** RLS policies enforce data isolation between organizations, role-based access control, and officer safety overrides.

### Key Roles

- **master**: System administrator - full access across all organizations
- **admin**: Organization administrator - full access within own organization
- **officer**: Field patrol officer - create/view data in own organization, limited edit

### Key Concepts

- **Organization Isolation**: Users can only access data from their assigned organization(s)
- **Officer Safety Override**: All officers can view flagged vehicles and incidents (read-only)
- **Service Role Bypass**: Edge Functions use service role for unrestricted database operations
- **Super Delete Permission**: Special permission for designated admin to permanently delete records

---

## Core Principles

### 1. Defense in Depth
- RLS policies are the PRIMARY security layer
- Application-level checks are SECONDARY
- Never trust client-side filtering

### 2. Explicit Deny by Default
- If no policy matches, access is denied
- Each operation (SELECT, INSERT, UPDATE, DELETE) requires a policy
- Separate policies for `anon` and `authenticated` roles

### 3. Policy Composition
- Multiple policies for same operation = OR logic
- All policies must return boolean (true/false)
- Use `USING (condition)` for SELECT/UPDATE/DELETE
- Use `WITH CHECK (condition)` for INSERT/UPDATE

---

## Helper Functions

Located in: `supabase/migrations/` (function definitions)

### 1. `get_user_role(user_id UUID) RETURNS TEXT`

**Purpose:** Returns the user's role from `user_profiles`  
**Usage:** `get_user_role(auth.uid())`  
**Example:**
```sql
USING (get_user_role(auth.uid()) = 'master')
```

---

### 2. `get_user_organization_id(user_id UUID) RETURNS UUID`

**Purpose:** Returns the user's primary organization ID  
**Usage:** `get_user_organization_id(auth.uid())`  
**Example:**
```sql
USING (organization_id = get_user_organization_id(auth.uid()))
```

---

### 3. `get_user_organization_ids(user_id UUID) RETURNS UUID[]`

**Purpose:** Returns all organization IDs for master users  
**Usage:** `get_user_organization_ids(auth.uid())`  
**Example:**
```sql
USING (organization_id = ANY(get_user_organization_ids(auth.uid())))
```

---

### 4. `check_user_has_role(role_name TEXT) RETURNS BOOLEAN`

**Purpose:** Checks if current user has specified role  
**Usage:** `check_user_has_role('admin')`  
**Example:**
```sql
USING (check_user_has_role('admin') OR check_user_has_role('master'))
```

---

## Policy Patterns

### Pattern 1: Organization Isolation (Most Common)

**Use Case:** Users can only access data from their organization

```sql
CREATE POLICY "users_view_own_org_data"
ON table_name FOR SELECT
TO authenticated
USING (
  get_user_role(auth.uid()) = 'master'  -- Masters see all
  OR organization_id = get_user_organization_id(auth.uid())  -- Users see own org
);
```

---

### Pattern 2: Role-Based Access

**Use Case:** Only admins/masters can perform an action

```sql
CREATE POLICY "admins_manage_data"
ON table_name FOR ALL
TO authenticated
USING (
  get_user_role(auth.uid()) = ANY (ARRAY['admin', 'master'])
  AND (
    get_user_role(auth.uid()) = 'master'  -- Masters manage all
    OR organization_id = get_user_organization_id(auth.uid())  -- Admins manage own org
  )
);
```

---

### Pattern 3: User Ownership

**Use Case:** Users can only edit records they created

```sql
CREATE POLICY "users_update_own_records"
ON table_name FOR UPDATE
TO authenticated
USING (created_by = auth.uid());
```

---

### Pattern 4: Time-Based Restrictions

**Use Case:** Officers can edit recent records within 24 hours

```sql
CREATE POLICY "officers_edit_recent_records"
ON table_name FOR UPDATE
TO authenticated
USING (
  recorded_by = auth.uid()
  AND created_at >= (now() - interval '24 hours')
);
```

---

### Pattern 5: Officer Safety Override

**Use Case:** All officers can view flagged vehicles (read-only)

```sql
CREATE POLICY "officers_view_all_for_safety"
ON flagged_vehicles FOR SELECT
TO authenticated
USING (true);  -- All authenticated users can view
```

---

### Pattern 6: Service Role Full Access

**Use Case:** Edge Functions need unrestricted access

```sql
CREATE POLICY "service_role_full_access"
ON table_name FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
```

---

### Pattern 7: Super Delete Permission

**Use Case:** Only Don Squire with super_delete permission can delete

```sql
CREATE POLICY "super_delete_table"
ON table_name FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND email = 'don.squire@firstsecurity.co.nz'
    AND permissions @> '["super_delete"]'::jsonb
  )
);
```

---

## Complete RLS Policy Reference

### Table: `user_profiles`

**Purpose:** User account management

#### Policies:

##### 1. `users_select_own_profile` (SELECT)
```sql
TO authenticated
USING (id = auth.uid())
```
- Users can view their own profile

##### 2. `users_insert_own_profile` (INSERT)
```sql
TO authenticated
WITH CHECK (id = auth.uid())
```
- Users can create their own profile

##### 3. `users_update_own_profile` (UPDATE)
```sql
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid())
```
- Users can update their own profile

##### 4. `users_view_same_org_profiles` (SELECT)
```sql
TO authenticated
USING (
  id <> auth.uid()
  AND organization_id = get_user_org_id()
  AND organization_id IS NOT NULL
)
```
- Users can view other users in their organization

##### 5. `admins_manage_other_profiles` (ALL)
```sql
TO authenticated
USING (
  id <> auth.uid()
  AND (check_user_has_role('admin') OR check_user_has_role('master'))
)
WITH CHECK (
  check_user_has_role('admin') OR check_user_has_role('master')
)
```
- Admins/masters can manage other user profiles

##### 6. `service_role_full_access` (ALL)
```sql
TO service_role
USING (true)
WITH CHECK (true)
```
- Service role (Edge Functions) has full access

##### 7. `anon_insert_profile_on_signup` (INSERT)
```sql
TO anon
WITH CHECK (true)
```
- Allow anonymous user profile creation during signup

##### 8. `super_delete_profiles` (DELETE)
```sql
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.email = 'don.squire@firstsecurity.co.nz'
    AND up.permissions @> '["super_delete"]'::jsonb
  )
)
```
- Only Don Squire with super_delete permission can delete users

---

### Table: `organizations`

#### Policies:

##### 1. `users_can_view_own_organization` (SELECT)
```sql
TO authenticated
USING (
  id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role = 'master'
  )
)
```
- Users can view their organization
- Masters can view all organizations

##### 2. `master_users_insert_organizations` (INSERT)
```sql
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role = 'master'
  )
)
```
- Only masters can create organizations

##### 3. `master_users_update_organizations` (UPDATE)
```sql
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role = 'master'
  )
)
```
- Only masters can update organizations

##### 4. `master_users_delete_organizations` (DELETE)
```sql
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role = 'master'
  )
)
```
- Only masters can delete organizations

##### 5. `super_delete_organizations` (DELETE)
```sql
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND email = 'don.squire@firstsecurity.co.nz'
    AND permissions @> '["super_delete"]'::jsonb
  )
)
```
- Super delete permission override

---

### Table: `zones`

#### Policies:

##### 1. `users_view_zones` (SELECT)
```sql
TO authenticated
USING (
  get_user_role(auth.uid()) = 'master'
  OR organization_id = get_user_organization_id(auth.uid())
)
```
- Masters can view all zones
- Users can view zones in their organization

##### 2. `admins_manage_zones` (ALL)
```sql
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND role = ANY (ARRAY['admin', 'master'])
    AND (
      role = 'master'
      OR organization_id = zones.organization_id
    )
  )
)
```
- Admins can manage zones in their organization
- Masters can manage all zones

##### 3. `super_delete_zones` (DELETE)
```sql
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND email = 'don.squire@firstsecurity.co.nz'
    AND permissions @> '["super_delete"]'::jsonb
  )
)
```
- Super delete permission override

---

### Table: `canonical_vehicles`

#### Policies:

##### 1. `users_view_canonical_vehicles` (SELECT)
```sql
TO authenticated
USING (true)
```
- All authenticated users can view canonical vehicles (safety)

##### 2. `officers_readonly_canonical_vehicles` (SELECT)
```sql
TO authenticated
USING (true)
```
- Duplicate for clarity - officers can read for safety

##### 3. `admins_manage_canonical_vehicles` (ALL)
```sql
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND role = ANY (ARRAY['admin', 'master'])
  )
)
```
- Admins/masters can manage canonical vehicles

##### 4. `super_delete_canonical_vehicles` (DELETE)
```sql
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND email = 'don.squire@firstsecurity.co.nz'
    AND permissions @> '["super_delete"]'::jsonb
  )
)
```
- Super delete permission override

---

### Table: `vehicle_observations`

#### Policies:

##### 1. `users_view_observations` (SELECT)
```sql
TO authenticated
USING (
  get_user_role(auth.uid()) = 'master'
  OR organization_id = get_user_organization_id(auth.uid())
)
```
- Organization isolation + master override

##### 2. `users_create_observations` (INSERT)
```sql
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid()
  )
)
```
- All authenticated users can create observations

##### 3. `officers_edit_own_recent_observations` (UPDATE)
```sql
TO authenticated
USING (
  recorded_by = auth.uid()
  AND created_at >= (now() - interval '24 hours')
)
```
- Officers can edit own observations within 24 hours

##### 4. `admins_edit_org_observations` (UPDATE)
```sql
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND role = ANY (ARRAY['admin', 'master'])
    AND (
      role = 'master'
      OR organization_id = vehicle_observations.organization_id
    )
  )
)
```
- Admins can edit observations in their organization

##### 5. `admins_manage_observations` (ALL)
```sql
TO authenticated
USING (
  get_user_role(auth.uid()) = ANY (ARRAY['admin', 'master'])
  AND (
    get_user_role(auth.uid()) = 'master'
    OR organization_id = get_user_organization_id(auth.uid())
  )
)
```
- Consolidated admin management policy

##### 6. `super_delete_observations` (DELETE)
```sql
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND email = 'don.squire@firstsecurity.co.nz'
    AND permissions @> '["super_delete"]'::jsonb
  )
)
```
- Super delete permission override

---

### Table: `compliance_results`

#### Policies:

##### 1. `users_view_org_compliance_results` (SELECT)
```sql
TO authenticated
USING (
  get_user_role(auth.uid()) = 'master'
  OR organization_id = get_user_organization_id(auth.uid())
)
```
- Organization isolation + master override

##### 2. `system_insert_compliance_results` (INSERT)
```sql
TO authenticated
WITH CHECK (true)
```
- System can insert compliance results (triggered by Edge Functions)

---

### Table: `incidents`

#### Policies:

##### 1. `org_users_select_incidents` (SELECT)
```sql
TO authenticated
USING (
  get_user_role(auth.uid()) = 'master'
  OR organization_id = get_user_organization_id(auth.uid())
)
```
- Organization isolation + master override

##### 2. `officers_view_incidents_for_safety` (SELECT)
```sql
TO authenticated
USING (true)
```
- All officers can view incidents (safety override)

##### 3. `users_insert_incidents` (INSERT)
```sql
TO authenticated
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  )
  OR (
    SELECT role FROM user_profiles WHERE id = auth.uid()
  ) = 'master'
)
```
- Users can create incidents in their organization

##### 4. `officers_create_incidents` (INSERT)
```sql
TO authenticated
WITH CHECK (
  organization_id = get_user_organization_id(auth.uid())
  AND user_id = auth.uid()
)
```
- Officers can create incidents (must be assigned to them)

##### 5. `officers_update_own_incidents` (UPDATE)
```sql
TO authenticated
USING (
  user_id = auth.uid()
  AND court_ready = false
)
```
- Officers can update own incidents (only if not court-ready)

##### 6. `admin_manage_incidents` (ALL)
```sql
TO authenticated
USING (
  get_user_role(auth.uid()) = ANY (ARRAY['admin', 'master'])
  AND (
    get_user_role(auth.uid()) = 'master'
    OR organization_id = get_user_organization_id(auth.uid())
  )
)
```
- Admins can manage all incidents in their organization

##### 7. `super_delete_incidents` (DELETE)
```sql
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND email = 'don.squire@firstsecurity.co.nz'
    AND permissions @> '["super_delete"]'::jsonb
  )
)
```
- Super delete permission override

---

### Table: `flagged_vehicles`

#### Policies:

##### 1. `org_users_select_flagged_vehicles` (SELECT)
```sql
TO authenticated
USING (
  get_user_role(auth.uid()) = 'master'
  OR organization_id = get_user_organization_id(auth.uid())
)
```
- Organization isolation + master override

##### 2. `officers_view_all_flagged_vehicles_for_safety` (SELECT)
```sql
TO authenticated
USING (is_active = true)
```
- All officers can view active flagged vehicles (safety)

##### 3. `users_insert_flagged_vehicles` (INSERT)
```sql
TO authenticated
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  )
  OR (
    SELECT role FROM user_profiles WHERE id = auth.uid()
  ) = 'master'
)
```
- Users can flag vehicles in their organization

##### 4. `admin_manage_flagged_vehicles` (ALL)
```sql
TO authenticated
USING (
  (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND (
      SELECT role FROM user_profiles WHERE id = auth.uid()
    ) = ANY (ARRAY['admin', 'master'])
  )
  OR (
    SELECT role FROM user_profiles WHERE id = auth.uid()
  ) = 'master'
)
```
- Admins can manage flagged vehicles in their organization

##### 5. `super_delete_flagged_vehicles` (DELETE)
```sql
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND email = 'don.squire@firstsecurity.co.nz'
    AND permissions @> '["super_delete"]'::jsonb
  )
)
```
- Super delete permission override

---

### Storage Buckets

#### Bucket: `evidence` (public)

##### Policies:

###### 1. `public_read_evidence` (SELECT)
```sql
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'evidence')
```
- Public can read evidence photos

###### 2. `authenticated_users_insert_evidence` (INSERT)
```sql
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'evidence'
  AND auth.uid() IS NOT NULL
)
```
- Authenticated users can upload evidence

###### 3. `authenticated_users_update_own_evidence` (UPDATE)
```sql
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'evidence'
  AND (auth.uid())::text = (storage.foldername(name))[1]
)
```
- Users can update their own evidence files

###### 4. `authenticated_users_delete_own_evidence` (DELETE)
```sql
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'evidence'
  AND (auth.uid())::text = (storage.foldername(name))[1]
  AND created_at > (now() - interval '24 hours')
)
```
- Users can delete own evidence within 24 hours

###### 5. `service_role_all_operations` (ALL)
```sql
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'evidence')
WITH CHECK (bucket_id = 'evidence')
```
- Service role full access

---

#### Bucket: `incident-evidence` (private)

##### Policies:

###### 1. `users_view_incident_evidence` (SELECT)
```sql
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'incident-evidence')
```
- Authenticated users can view incident evidence
- **Note:** Actual access controlled by incident RLS policies on metadata

###### 2. `Allow public reads for incident evidence` (SELECT)
```sql
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'incident-evidence')
```
- Public can read incident evidence (for court/authority sharing)
- **Added:** January 27, 2026 (Critical Fix #4)

###### 3. `officers_upload_incident_evidence` (INSERT)
```sql
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'incident-evidence'
  AND auth.uid() IS NOT NULL
)
```
- Authenticated users can upload incident evidence

###### 4. `admins_delete_incident_evidence` (DELETE)
```sql
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'incident-evidence'
  AND get_user_role(auth.uid()) = ANY (ARRAY['admin', 'master'])
)
```
- Admins/masters can delete incident evidence

---

## Testing & Validation

### Manual Testing

#### Test as Master User
```sql
SET LOCAL ROLE authenticated;
SET request.jwt.claims.sub = '<master_user_uuid>';

-- Should see ALL organizations
SELECT * FROM organizations;

-- Should see ALL zones
SELECT * FROM zones;

-- Should see ALL observations
SELECT * FROM vehicle_observations;
```

#### Test as Admin User
```sql
SET LOCAL ROLE authenticated;
SET request.jwt.claims.sub = '<admin_user_uuid>';

-- Should see only own organization
SELECT * FROM organizations;

-- Should see only zones in own organization
SELECT * FROM zones WHERE organization_id = '<own_org_id>';

-- Should NOT see zones in other organizations
SELECT * FROM zones WHERE organization_id = '<other_org_id>';  -- Empty result
```

#### Test as Officer User
```sql
SET LOCAL ROLE authenticated;
SET request.jwt.claims.sub = '<officer_user_uuid>';

-- Should see all flagged vehicles (safety)
SELECT * FROM flagged_vehicles WHERE is_active = true;

-- Should be able to create observations
INSERT INTO vehicle_observations (...);

-- Should be able to update own recent observations
UPDATE vehicle_observations SET notes = 'Updated'
WHERE recorded_by = '<officer_user_uuid>'
AND created_at >= now() - interval '24 hours';

-- Should NOT be able to update old observations
UPDATE vehicle_observations SET notes = 'Updated'
WHERE recorded_by = '<officer_user_uuid>'
AND created_at < now() - interval '24 hours';  -- Permission denied
```

### Automated Testing

#### Policy Test Template
```sql
-- Create test users
INSERT INTO auth.users (id, email) VALUES
  ('<master_uuid>', 'master@test.com'),
  ('<admin_uuid>', 'admin@test.com'),
  ('<officer_uuid>', 'officer@test.com');

INSERT INTO user_profiles (id, role, organization_id) VALUES
  ('<master_uuid>', 'master', NULL),
  ('<admin_uuid>', 'admin', '<org_1_uuid>'),
  ('<officer_uuid>', 'officer', '<org_1_uuid>');

-- Test: Master can view all organizations
SET LOCAL ROLE authenticated;
SET request.jwt.claims.sub = '<master_uuid>';
SELECT COUNT(*) FROM organizations;  -- Should = total count

-- Test: Admin can only view own organization
SET request.jwt.claims.sub = '<admin_uuid>';
SELECT COUNT(*) FROM organizations WHERE id = '<org_1_uuid>';  -- Should = 1
SELECT COUNT(*) FROM organizations WHERE id = '<org_2_uuid>';  -- Should = 0

-- Cleanup
RESET ROLE;
DELETE FROM user_profiles WHERE id IN ('<master_uuid>', '<admin_uuid>', '<officer_uuid>');
DELETE FROM auth.users WHERE id IN ('<master_uuid>', '<admin_uuid>', '<officer_uuid>');
```

---

## Common Issues & Solutions

### Issue 1: "Permission Denied" when creating records

**Symptom:** Users can't INSERT even though they have correct role

**Cause:** INSERT policy uses `WITH CHECK` not `USING`

**Solution:**
```sql
-- Wrong
CREATE POLICY "users_create_records" ON table_name FOR INSERT
USING (organization_id = get_user_organization_id(auth.uid()));

-- Correct
CREATE POLICY "users_create_records" ON table_name FOR INSERT
WITH CHECK (organization_id = get_user_organization_id(auth.uid()));
```

---

### Issue 2: Service role queries failing

**Symptom:** Edge Functions can't query tables

**Cause:** Missing service role policy

**Solution:**
```sql
CREATE POLICY "service_role_full_access" ON table_name FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
```

---

### Issue 3: Masters can't see all data

**Symptom:** Master users only see own organization

**Cause:** Missing master override in policy

**Solution:**
```sql
-- Wrong
USING (organization_id = get_user_organization_id(auth.uid()))

-- Correct
USING (
  get_user_role(auth.uid()) = 'master'
  OR organization_id = get_user_organization_id(auth.uid())
)
```

---

### Issue 4: Infinite recursion in helper functions

**Symptom:** "stack depth limit exceeded" error

**Cause:** Helper function calls itself or creates circular reference

**Solution:** Ensure helper functions query base tables, not other helpers

```sql
-- Wrong
CREATE FUNCTION get_user_org_id() RETURNS UUID AS $$
  SELECT get_user_organization_id(auth.uid())  -- Circular!
$$ LANGUAGE SQL;

-- Correct
CREATE FUNCTION get_user_org_id() RETURNS UUID AS $$
  SELECT organization_id FROM user_profiles WHERE id = auth.uid()
$$ LANGUAGE SQL;
```

---

### Issue 5: Super delete not working

**Symptom:** Don Squire can't delete records despite permission

**Cause:** Permission check syntax error

**Solution:**
```sql
-- Check permissions field is JSONB array
SELECT permissions FROM user_profiles WHERE email = 'don.squire@firstsecurity.co.nz';
-- Should return: ["super_delete"]

-- Ensure containment operator is correct
permissions @> '["super_delete"]'::jsonb  -- Correct
```

---

## Migration Checklist

When creating a new table, ensure:

- [ ] RLS is enabled: `ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;`
- [ ] SELECT policy for authenticated users (organization isolation)
- [ ] INSERT policy (WITH CHECK)
- [ ] UPDATE policy (USING + WITH CHECK)
- [ ] DELETE policy (admin-only typically)
- [ ] Service role full access policy
- [ ] Master user override in SELECT policy
- [ ] Super delete policy (if applicable)
- [ ] Test policies with different roles
- [ ] Document policies in this file

---

## References

- **Supabase RLS Docs:** https://supabase.com/docs/guides/auth/row-level-security
- **PostgreSQL RLS:** https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- **Project Database Architecture:** `DATABASE_ARCHITECTURE.md`
- **Edge Functions:** `supabase/functions/`

---

**END OF RLS DOCUMENTATION**
