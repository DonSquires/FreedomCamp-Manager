# Bob's Sandbox Exercise C: Multi-Organization Isolation

**Duration**: 30 minutes  
**Prerequisite**: Exercise B (Data Flow Tracing) completed  
**Goal**: Prove that RLS policies prevent cross-organization data leakage  
**Security Note**: Multi-tenancy is a critical safety feature; this exercise validates it  

---

## Scenario

You'll create two separate test organizations, assign officers to each, and verify:
- ✅ Officer A cannot see Officer B's data
- ✅ Both officers are using the same app instance
- ✅ RLS policies prevent accidental cross-org access
- ✅ Even if someone queries the database, they only see their org's data

---

## Step 1: Create Test Organization A

**Via Supabase Dashboard**:

```sql
INSERT INTO organizations (
  organization_id,
  name,
  type,
  parent_organization_id,
  created_at
) VALUES (
  gen_random_uuid(),
  'Test Org A',
  'service_provider',
  NULL,
  NOW()
)
RETURNING organization_id;

-- Result: Save this UUID as ORG_A_ID
```

---

## Step 2: Create Test Organization B

```sql
INSERT INTO organizations (
  organization_id,
  name,
  type,
  parent_organization_id,
  created_at
) VALUES (
  gen_random_uuid(),
  'Test Org B',
  'service_provider',
  NULL,
  NOW()
)
RETURNING organization_id;

-- Result: Save this UUID as ORG_B_ID
```

---

## Step 3: Create Officer A (for Org A)

```sql
-- First create Supabase user
INSERT INTO auth.users (
  email,
  encrypted_password,
  email_confirmed_at,
  user_metadata
) VALUES (
  'officer_org_a@test.local',
  crypt('password123', gen_salt('bf')),
  NOW(),
  jsonb_build_object('organization_id', ORG_A_ID)
)
RETURNING id;

-- Then create user_profile with officer role
INSERT INTO user_profiles (
  user_id,
  organization_id,
  role,
  name,
  email,
  created_at
) VALUES (
  [USER_ID_FROM_ABOVE],
  ORG_A_ID,
  'officer',
  'Officer A',
  'officer_org_a@test.local',
  NOW()
);
```

---

## Step 4: Create Officer B (for Org B)

```sql
INSERT INTO auth.users (
  email,
  encrypted_password,
  email_confirmed_at,
  user_metadata
) VALUES (
  'officer_org_b@test.local',
  crypt('password456', gen_salt('bf')),
  NOW(),
  jsonb_build_object('organization_id', ORG_B_ID)
)
RETURNING id;

INSERT INTO user_profiles (
  user_id,
  organization_id,
  role,
  name,
  email,
  created_at
) VALUES (
  [USER_ID_FROM_ABOVE],
  ORG_B_ID,
  'officer',
  'Officer B',
  'officer_org_b@test.local',
  NOW()
);
```

---

## Step 5: Log In as Officer A

**In browser**:
```
Email:    officer_org_a@test.local
Password: password123
```

**Verify**: Officer A lands on Officer Portal

---

## Step 6: Officer A Creates Observation

**Follow Exercise A steps**:
1. Start Patrol
2. Scan vehicle (use plate: TEST_ORG_A_001)
3. Submit observation

**After submit**: Observation belongs to Org A

---

## Step 7: Log In as Officer B (Different Org)

**In browser**:
1. Click Profile → Sign Out
2. Log in with:
   ```
   Email:    officer_org_b@test.local
   Password: password456
   ```

**Verify**: Officer B lands on Officer Portal

---

## Step 8: Officer B Tries to Query Org A's Data

**In browser DevTools**, run:

```javascript
// Try to fetch Org A's observations
fetch('https://your-project.supabase.co/rest/v1/observations?organization_id=eq.[ORG_A_ID]', {
  headers: {
    'apikey': 'your-anon-key',
    'Authorization': 'Bearer ' + sessionStorage.getItem('auth.token')
  }
})
.then(r => r.json())
.then(data => console.log('Result:', data))
```

**Expected result**:
```
Result: []  // Empty array — RLS blocked the query!
```

**Why?** The WHERE clause added by RLS policy:
```sql
WHERE organization_id = auth.jwt() ->> 'organization_id'
```

Officer B's JWT contains `organization_id = ORG_B_ID`, so Supabase rejects the query for ORG_A_ID data.

---

## Step 9: Officer B Views Their Own Data

```javascript
// Officer B queries Org B's observations
fetch('https://your-project.supabase.co/rest/v1/observations?organization_id=eq.[ORG_B_ID]', {
  headers: {
    'apikey': 'your-anon-key',
    'Authorization': 'Bearer ' + sessionStorage.getItem('auth.token')
  }
})
.then(r => r.json())
.then(data => console.log('Result:', data))
```

**Expected result**:
```
Result: [
  { observation_id: "xxx", plate_number: "TEST_ORG_A_001", ... }
]
// ✅ Officer B CAN see Org B's observations
```

---

## Step 10: Admin Audit (Cross-Org Access)

**Log in as master** (who has cross-org access):

```
Email:    master_ncc_001@example.com
Password: (from .env.playwright.local)
```

**Query both orgs' data**:

```javascript
// Master can see Org A's data
fetch('https://your-project.supabase.co/rest/v1/observations?organization_id=eq.[ORG_A_ID]', {...})

// Master can see Org B's data
fetch('https://your-project.supabase.co/rest/v1/observations?organization_id=eq.[ORG_B_ID]', {...})

// ✅ Both work (master role overrides RLS)
// ⚠️ But every query is logged to audit_log!
```

---

## Step 11: Verify Audit Logging

**Check audit trail**:

```sql
SELECT action, performed_by, entity_id, organization_id, created_at
FROM audit_log
WHERE action LIKE 'master_%'
ORDER BY created_at DESC
LIMIT 10;

-- Result shows every time master queried data
```

---

## Exercise C Completion Checklist

✅ Created two separate organizations (Org A, Org B)  
✅ Created officer accounts for each org  
✅ Officer A created observation in Org A  
✅ Officer B tried to query Org A data → RLS blocked (empty result)  
✅ Officer B queried Org B data → Success (their own data)  
✅ Master could query both → Success (with audit logging)  
✅ Verified audit trail captured master's cross-org access  

---

## Key Findings

**RLS Policy in Action:**
```sql
CREATE POLICY "officers_view_own_org"
ON observations
FOR SELECT
USING (
  organization_id = auth.jwt() ->> 'organization_id'
  OR auth.jwt() ->> 'role' = 'master'
  OR auth.jwt() ->> 'role' = 'grand_master'
);
```

**This means:**
- ✅ Officers see only their org's data
- ✅ Master sees all data (with audit logging)
- ✅ Even with direct SQL access, cross-org queries are blocked
- ✅ Data isolation is enforced by database, not by app logic

---

## Reflection Questions

1. **Why is organization_id critical for multi-tenancy?**
   - _________________________________

2. **What would happen if RLS policy didn't exist?**
   - _________________________________

3. **Can an officer bypass RLS using DevTools?**
   - _________________________________

4. **Why does master have audit logging for cross-org access?**
   - _________________________________

5. **If we removed the `OR auth.jwt() ->> 'role' = 'master'` clause, what would happen?**
   - _________________________________

---

## Common Scenarios

| Scenario | Result | Why |
|----------|--------|-----|
| Officer A queries Org A data | ✅ Success | Matches their org_id |
| Officer A queries Org B data | ❌ Blocked | RLS policy denies |
| Master queries Org A data | ✅ Success | Master role exempted |
| Officer queries without org_id | ❌ Blocked | RLS requires org_id filter |

---

## Security Implications

**Multi-organization isolation is NOT optional** in FieldOps Manager because:

1. **Data Privacy**: Each organization's breach/observation data is confidential
2. **Compliance**: RLS enforces GDPR/Privacy Act data isolation
3. **Trust**: Service providers must not see each other's operational data
4. **Auditability**: Master access is logged for compliance review

---

## Next Up

Exercise D: Breach Triage Workflow
- 60 minutes
- Complete 9-step admin workflow
- Create observation → automatic breach alert → triage → issue notice
- Understand end-to-end operational flow

See: `docs/BOB_SANDBOX_EMULATOR_GUIDE.md` PART 2.2 for detailed workflow steps
