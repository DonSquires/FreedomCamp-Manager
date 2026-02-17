# Organization & User Management - Deployment Guide

**Version:** 5.1.1  
**Date:** 2026-02-18  
**Status:** ✅ Code Complete - Awaiting SQL Deployment

---

## 🚀 Quick Deployment Steps

### Step 1: Apply SQL Migrations (CRITICAL - 15 minutes)

**Order matters!** Apply in this sequence:

#### 1️⃣ **RLS Helper Functions** (BLOCKER - MUST DO FIRST)
```bash
# File: supabase/migrations/20260218_create_rls_helper_functions.sql
# Priority: CRITICAL
# Time: 5 minutes
```

**In Supabase Dashboard:**
1. Go to SQL Editor
2. Copy entire contents of `20260218_create_rls_helper_functions.sql`
3. Click "Run"
4. ✅ Verify you see success messages for all 3 functions:
   - `get_user_role(uuid)`
   - `get_user_organization_id(uuid)`
   - `get_user_organization_ids()` (enhanced)

**Why Critical:** Without these, ALL RLS policies fail with "function does not exist" errors. No users can access any data.

---

#### 2️⃣ **Organization Triggers** (HIGH PRIORITY)
```bash
# File: supabase/migrations/20260218_create_org_triggers.sql
# Priority: HIGH
# Time: 5 minutes
```

**In Supabase Dashboard:**
1. SQL Editor → New Query
2. Copy entire contents of `20260218_create_org_triggers.sql`
3. Click "Run"
4. ✅ Verify you see:
   - Triggers created successfully
   - Organization levels recalculated
   - Hierarchy displayed in console

**Why Important:** Prevents invalid organization hierarchies and auto-manages levels.

---

#### 3️⃣ **User Deactivation Queue** (MEDIUM PRIORITY)
```bash
# File: supabase/migrations/20260218_fix_user_deactivation.sql
# Priority: MEDIUM
# Time: 5 minutes
```

**In Supabase Dashboard:**
1. SQL Editor → New Query
2. Copy entire contents of `20260218_fix_user_deactivation.sql`
3. Click "Run"
4. ✅ Verify:
   - `user_deactivation_queue` table created
   - Trigger installed
   - Helper functions created

**Why Important:** Security - prevents deactivated users from logging in.

---

## ✅ Step 2: Verification Checklist (10 minutes)

### Test 1: RLS Helper Functions
```sql
-- Run in Supabase SQL Editor
SELECT 
  get_user_role(id) as role,
  get_user_organization_id(id) as org_id,
  array_length(get_user_organization_ids(), 1) as accessible_orgs
FROM user_profiles
WHERE email = 'your.email@example.com';
```

**Expected Result:**
- Role: 'admin' or 'master' or 'officer'
- Org ID: Valid UUID
- Accessible orgs: 1 or more

**If fails:** RLS functions not installed - re-run migration 1

---

### Test 2: Organization Hierarchy
```sql
-- Verify organization levels
SELECT 
  name,
  organization_level,
  organization_type,
  (SELECT name FROM organizations p WHERE p.id = o.parent_organization_id) as parent_name
FROM organizations o
ORDER BY organization_level, name;
```

**Expected Result:**
- Level 1: Iron Eagle (no parent)
- Level 2: First Security, JDS Security (parent = Iron Eagle)
- Level 3: LINZ, Nelson, etc. (parent = First Security)

**If wrong levels:** Re-run migration 2

---

### Test 3: User Management Access
1. Login as **admin** user
2. Go to Admin Portal → User Management
3. Should see all users in your org + child orgs
4. Should NOT see error messages
5. Create test user → Should succeed

**If fails:** Check browser console for errors

---

### Test 4: Multi-Organization Dashboard
1. Login as **officer** with `authorized_work_locations` set
2. Go to BI Dashboard
3. Should see observations from ALL authorized locations
4. Verify counts match across multiple zones

**If shows less data than expected:** Clear browser cache and re-login

---

### Test 5: Organization Management (Master Only)
1. Login as **master** user
2. Go to Admin Portal → Organization Management
3. Should see complete hierarchy tree
4. Try creating child organization → Should auto-set level
5. Try setting parent to child → Should block with error

**If fails:** Organization triggers not installed - re-run migration 2

---

## 📋 Step 3: Post-Deployment Tasks (30 minutes)

### Task 1: Backfill Existing User Relationships
If you have existing users that need employer/work locations:

```sql
-- Example: Give all First Security officers access to all clients
UPDATE user_profiles
SET 
  employer_organization_id = (SELECT id FROM organizations WHERE name = 'First Security'),
  authorized_work_locations = ARRAY(
    SELECT id FROM organizations 
    WHERE parent_organization_id = (SELECT id FROM organizations WHERE name = 'First Security')
  )
WHERE organization_id = (SELECT id FROM organizations WHERE name = 'First Security')
  AND role IN ('officer', 'admin_officer');
```

---

### Task 2: Configure Enforcement Workflow
Set workflow per organization:

```sql
-- Set LINZ to officer_first (rapid response)
UPDATE organizations
SET enforcement_workflow = 'officer_first'
WHERE name = 'LINZ';

-- Set Nelson to admin_first (high compliance)
UPDATE organizations
SET enforcement_workflow = 'admin_first'
WHERE name = 'Nelson City Council';
```

---

### Task 3: Test User Deactivation
1. Create test user via User Management
2. Deactivate user (set `is_active = false`)
3. Wait 5 minutes (for Edge Function to process queue)
4. Try logging in as that user → Should fail
5. Reactivate user → Should be able to login again

**Note:** Requires Edge Function `process-user-deactivation` to be deployed (optional)

---

## 🔍 Step 4: Troubleshooting Guide

### Issue 1: "function get_user_role does not exist"

**Symptom:** Error when accessing any page  
**Cause:** RLS helper functions not installed  
**Fix:**
1. Re-run `20260218_create_rls_helper_functions.sql`
2. Verify with: `SELECT proname FROM pg_proc WHERE proname LIKE 'get_user%';`
3. Should return 3 functions

---

### Issue 2: Users can't see data from authorized work locations

**Symptom:** Dashboard/reports show limited data  
**Cause:** Manual org filtering still active OR RLS not using helper functions  
**Fix:**
1. Clear browser cache
2. Logout and login again
3. Check `authorized_work_locations` is populated:
   ```sql
   SELECT email, authorized_work_locations 
   FROM user_profiles 
   WHERE role IN ('officer', 'admin_officer');
   ```

---

### Issue 3: Organization levels are wrong

**Symptom:** Level 2 orgs showing as Level 1, etc.  
**Cause:** Triggers not installed  
**Fix:**
1. Re-run `20260218_create_org_triggers.sql`
2. Triggers will auto-recalculate all levels
3. Verify with hierarchy query from Test 2

---

### Issue 4: Can create circular organization references

**Symptom:** Can set org A parent to B, then B parent to A  
**Cause:** Circular reference trigger not installed  
**Fix:**
1. Re-run `20260218_create_org_triggers.sql`
2. Test by trying to create loop - should fail with error

---

### Issue 5: Deactivated users can still login

**Symptom:** User with `is_active = false` can login  
**Cause:** Deactivation queue not processed  
**Fix (Option 1 - Manual):**
```sql
-- Manually ban user in auth.users
-- This requires admin API access or Edge Function
```

**Fix (Option 2 - Automated):**
1. Deploy Edge Function `process-user-deactivation`
2. Set up Cron job to run every 5 minutes
3. Queue will auto-process

---

## 📊 Step 5: Performance Verification

### Check 1: RLS Policy Performance
```sql
-- Should use indexes, not sequential scans
EXPLAIN ANALYZE
SELECT * FROM vehicle_observations_v2
WHERE organization_id = ANY(get_user_organization_ids());
```

**Expected:** Index scan on `idx_observations_org`

---

### Check 2: Organization Hierarchy Query
```sql
-- Should be fast (<100ms) even with 50+ orgs
EXPLAIN ANALYZE
SELECT org_id FROM get_descendant_organizations(
  (SELECT id FROM organizations WHERE name = 'First Security')
);
```

**Expected:** Recursive CTE, <100ms

---

## 🎯 Success Criteria

✅ All 3 SQL migrations applied without errors  
✅ RLS helper functions return valid data  
✅ Organization levels auto-calculate correctly  
✅ Circular reference prevention works  
✅ User Management shows correct users per role  
✅ Multi-org users see data from all authorized locations  
✅ Dashboard shows accurate counts across organizations  
✅ No "function does not exist" errors in console  
✅ Deactivated users cannot login  
✅ Organization Management shows complete hierarchy  

---

## 📞 Support & Next Steps

### If Everything Works ✅
**Compliance Score: 95%+**

Optional enhancements:
1. Implement enforcement workflow logic in breach detection
2. Deploy `process-user-deactivation` Edge Function
3. Configure advanced permissions per user
4. Set up automated reporting per organization

---

### If Issues Persist ❌
**Compliance Score: <80%**

1. Check `ORGANIZATION_USER_MANAGEMENT_VERIFICATION.md` for detailed diagnostics
2. Run verification SQL queries from Test Scenarios
3. Check browser console for client-side errors
4. Check Supabase logs for RLS policy failures
5. Contact support with:
   - Migration output logs
   - Browser console errors
   - Example user IDs that fail

---

## 🔐 Security Checklist

- [ ] All RLS policies use SECURITY DEFINER helper functions
- [ ] No direct auth.users modifications from frontend
- [ ] User deactivation queue processing is secure
- [ ] Organization CRUD restricted to master role
- [ ] Audit log captures all user/org changes
- [ ] No circular reference loops possible
- [ ] Multi-session prevention active

---

## 📚 Documentation References

- **Workflow:** `ORGANIZATION_USER_MANAGEMENT_WORKFLOW.md`
- **Verification:** `ORGANIZATION_USER_MANAGEMENT_VERIFICATION.md`
- **Migrations:** `supabase/migrations/20260218_*.sql`
- **Code:** `src/pages/OrganizationManagement.tsx`, `UserManagement.tsx`

---

## ✅ Deployment Complete!

**Date Deployed:** _________________  
**Deployed By:** _________________  
**All Tests Passed:** ⬜ Yes  ⬜ No  
**Notes:** _________________________________

---

**Version:** 5.1.1 | **Build:** 2026-02-18 | **Status:** Production Ready
