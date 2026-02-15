# Multi-Organization Access Architecture
**Problem:** First Security has multiple clients (LINZ, Nelson). Admins need to see all client data, field officers need to work across clients, but client employees should only see their own org.

---

## 🏗️ Architecture Overview

### **Organization Hierarchy Model**

```
First Security (Parent Org)
├── LINZ (Client Org)
│   ├── Data: Zones, Vehicles, Patrols
│   └── Users: Field officers assigned to LINZ jobs
└── Nelson City Council (Client Org)
    ├── Data: Zones, Vehicles, Patrols
    └── Users: Cari (employed by Nelson - restricted access)
```

### **User Access Levels**

| User Type | organization_id | organization_ids | Access Pattern |
|-----------|----------------|------------------|----------------|
| **First Security Admin** | First Security | [First Security, LINZ, Nelson] | See ALL data from all clients |
| **First Security Officer** | First Security | [First Security, LINZ, Nelson] | Can work jobs for any client |
| **Cari (Nelson Employee)** | Nelson | [Nelson] | ONLY see Nelson data |
| **LINZ Employee** | LINZ | [LINZ] | ONLY see LINZ data |

---

## 📊 Database Schema Changes

### **1. Add Parent Organization Relationship**

```sql
-- Add parent_organization_id to organizations table
ALTER TABLE organizations
ADD COLUMN parent_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN organizations.parent_organization_id IS 
'Parent organization for multi-client service companies. NULL for independent orgs.';

-- Add organization type
ALTER TABLE organizations
ADD COLUMN organization_type TEXT DEFAULT 'client' CHECK (organization_type IN ('parent', 'client'));

COMMENT ON COLUMN organizations.organization_type IS 
'parent = service company with clients, client = end organization';

-- Create index for hierarchy queries
CREATE INDEX idx_organizations_parent ON organizations(parent_organization_id);

-- Example data:
-- First Security: parent_organization_id = NULL, organization_type = 'parent'
-- LINZ: parent_organization_id = <First Security ID>, organization_type = 'client'
-- Nelson: parent_organization_id = <First Security ID>, organization_type = 'client'
```

### **2. Update user_profiles.organization_ids Usage**

```sql
-- organization_ids array already exists - we'll populate it correctly

-- For First Security users:
UPDATE user_profiles
SET organization_ids = ARRAY(
  SELECT id FROM organizations 
  WHERE parent_organization_id = (SELECT id FROM organizations WHERE name = 'First Security')
  OR id = (SELECT id FROM organizations WHERE name = 'First Security')
)
WHERE organization_id = (SELECT id FROM organizations WHERE name = 'First Security');

-- For client-employed users (Cari at Nelson):
UPDATE user_profiles
SET organization_ids = ARRAY[organization_id]
WHERE organization_id != (SELECT id FROM organizations WHERE name = 'First Security');
```

---

## 🔐 RLS Policy Updates

### **Current Problem:**
Most RLS policies use `organization_id = get_user_organization_id()` which only checks single org.

### **Solution:**
Change to `organization_id = ANY(get_user_organization_ids())` to check array.

### **Example RLS Updates:**

```sql
-- BEFORE: Single org check
CREATE POLICY "users_view_zones"
ON zones FOR SELECT
TO authenticated
USING (organization_id = get_user_organization_id());

-- AFTER: Multi-org check
DROP POLICY "users_view_zones" ON zones;

CREATE POLICY "users_view_zones"
ON zones FOR SELECT
TO authenticated
USING (organization_id = ANY(get_user_organization_ids()));
```

### **Tables Requiring RLS Updates:**
- ✅ `zones`
- ✅ `vehicle_observations_v2`
- ✅ `compliance_results`
- ✅ `breach_alerts`
- ✅ `enforcement_actions`
- ✅ `incidents`
- ✅ `investigation_jobs`
- ✅ `patrols`
- ✅ `vehicle_records`
- ✅ `flagged_vehicles`
- ✅ `health_safety_reports`
- ✅ `canonical_vehicles` (global - no change needed)
- ✅ `person_records`

---

## 🎨 UI Changes

### **1. Organization Selector (Admin Portal & Field Officer Portal)**

**When to Show:**
- ✅ Master users: Always show (all orgs)
- ✅ First Security users: Show if `organization_ids.length > 1`
- ❌ Client employees (Cari): Hide (only 1 org)

**Implementation:**

```typescript
// src/components/features/OrganizationSelector.tsx
export function OrganizationSelector() {
  const { user } = useAuthStore();
  const [organizations, setOrganizations] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);

  useEffect(() => {
    const loadOrgs = async () => {
      // Get user's accessible organizations
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_ids')
        .eq('id', user?.id)
        .single();

      if (profile?.organization_ids?.length > 1) {
        // Multi-org user - show selector
        const { data } = await supabase
          .from('organizations')
          .select('id, name, organization_type')
          .in('id', profile.organization_ids)
          .order('organization_type', { ascending: false }); // Parent first

        setOrganizations(data || []);
        setSelectedOrg(data?.[0]?.id || null);
      }
    };

    loadOrgs();
  }, [user?.id]);

  // If single org, don't render selector
  if (organizations.length <= 1) return null;

  return (
    <Select value={selectedOrg} onValueChange={setSelectedOrg}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select Organization" />
      </SelectTrigger>
      <SelectContent>
        {organizations.map(org => (
          <SelectItem key={org.id} value={org.id}>
            {org.name}
            {org.organization_type === 'parent' && (
              <Badge variant="outline" className="ml-2">Parent</Badge>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

### **2. Field Officer Portal - Zone Filter by Selected Org**

```typescript
// When loading zones in Field Officer Portal
useEffect(() => {
  const loadZones = async () => {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_ids')
      .eq('id', user?.id)
      .single();

    // Load zones from selected organization (or all accessible orgs)
    const { data: zones } = await supabase
      .from('zones')
      .select('id, name, organization_id')
      .in('organization_id', profile?.organization_ids || [])
      .eq('is_active', true)
      .order('name');

    setAvailableZones(zones || []);
  };

  loadZones();
}, [user?.id]);
```

### **3. Admin Portal - Organization Filter**

```typescript
// Admin Portal - Add organization selector to header
<div className="flex items-center gap-4 p-4 border-b">
  <h1 className="text-xl font-bold">Admin Portal</h1>
  <OrganizationSelector
    value={selectedOrgId}
    onChange={setSelectedOrgId}
  />
</div>

// Filter all queries by selected organization
const { data: breaches } = await supabase
  .from('breach_alerts')
  .select('*')
  .eq('organization_id', selectedOrgId) // Filter by selected org
  .order('created_at', { ascending: false });
```

---

## 🔄 User Management Workflow

### **Creating a First Security User (Multi-Org Access)**

```typescript
// Admin creates user for First Security
const createFirstSecurityUser = async (email: string, firstName: string, lastName: string, role: string) => {
  // Step 1: Create auth user
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: generateTemporaryPassword(),
    email_confirm: true,
  });

  if (authError) throw authError;

  // Step 2: Get First Security org + all clients
  const { data: firstSecurity } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('name', 'First Security')
    .single();

  const { data: clients } = await supabase
    .from('organizations')
    .select('id')
    .eq('parent_organization_id', firstSecurity.id);

  const accessibleOrgIds = [
    firstSecurity.id,
    ...(clients?.map(c => c.id) || [])
  ];

  // Step 3: Create user profile with multi-org access
  const { error: profileError } = await supabase
    .from('user_profiles')
    .insert({
      id: authUser.user.id,
      email,
      first_name: firstName,
      last_name: lastName,
      role,
      organization_id: firstSecurity.id, // Primary org
      organization_ids: accessibleOrgIds, // Access to all clients
      is_active: true,
    });

  if (profileError) throw profileError;

  // Step 4: Send invite email
  await sendInviteEmail(email, firstName);
};
```

### **Creating a Client Employee (Single-Org Access)**

```typescript
// Admin creates user for Nelson City Council
const createClientUser = async (email: string, firstName: string, lastName: string, role: string, organizationId: string) => {
  // Step 1: Create auth user
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: generateTemporaryPassword(),
    email_confirm: true,
  });

  if (authError) throw authError;

  // Step 2: Create user profile with single-org access
  const { error: profileError } = await supabase
    .from('user_profiles')
    .insert({
      id: authUser.user.id,
      email,
      first_name: firstName,
      last_name: lastName,
      role,
      organization_id: organizationId, // Nelson City Council
      organization_ids: [organizationId], // ONLY Nelson
      is_active: true,
    });

  if (profileError) throw profileError;

  // Step 3: Send invite email
  await sendInviteEmail(email, firstName);
};
```

---

## 📋 Implementation Checklist

### **Phase 1: Database Schema (2 hours)**
- [ ] Create migration for `parent_organization_id` and `organization_type`
- [ ] Update existing organizations:
  - [ ] Set First Security as `organization_type = 'parent'`
  - [ ] Set LINZ and Nelson as `parent_organization_id = <First Security ID>`
- [ ] Populate `user_profiles.organization_ids` for existing users
- [ ] Test hierarchy queries

### **Phase 2: RLS Policy Updates (3 hours)**
- [ ] Identify all tables with `organization_id` column
- [ ] Update RLS policies to use `ANY(get_user_organization_ids())`
- [ ] Test data access for:
  - [ ] Master user (all orgs)
  - [ ] First Security admin (parent + clients)
  - [ ] Cari (Nelson only)
- [ ] Verify data isolation (Cari can't see LINZ data)

### **Phase 3: UI Updates (4 hours)**
- [ ] Create `OrganizationSelector` component
- [ ] Add selector to Admin Portal header
- [ ] Add selector to Field Officer Portal zone selection
- [ ] Update User Management to set `organization_ids` on creation
- [ ] Test organization switching in UI

### **Phase 4: Testing (2 hours)**
- [ ] Test First Security admin seeing all data
- [ ] Test field officer working across LINZ and Nelson jobs
- [ ] Test Cari only seeing Nelson data
- [ ] Test organization selector UI
- [ ] Test RLS policies don't leak data

---

## 🔍 Example Scenarios

### **Scenario 1: First Security Admin Reviews All Breaches**

```typescript
// User: don.squire@firstsecurity.co.nz
// organization_id: <First Security ID>
// organization_ids: [<First Security ID>, <LINZ ID>, <Nelson ID>]

// Query breaches (RLS auto-filters)
const { data: breaches } = await supabase
  .from('breach_alerts')
  .select('*, zones(name), organizations(name)')
  .order('created_at', { ascending: false });

// RLS Policy allows:
// WHERE organization_id = ANY(['First Security', 'LINZ', 'Nelson'])

// Result: See breaches from ALL organizations
```

### **Scenario 2: Field Officer Assigned to LINZ Job**

```typescript
// User: officer@firstsecurity.co.nz
// organization_id: <First Security ID>
// organization_ids: [<First Security ID>, <LINZ ID>, <Nelson ID>]

// Admin assigns job to LINZ zone
const { data: job } = await supabase
  .from('investigation_jobs')
  .insert({
    organization_id: '<LINZ ID>', // Job for LINZ
    zone_id: '<LINZ Zone ID>',
    assigned_to: officer.id,
    job_type: 'Homeless Occupation',
  });

// Officer selects LINZ in organization selector
// Loads LINZ zones and can work the job
```

### **Scenario 3: Cari (Nelson Employee) Restricted Access**

```typescript
// User: cari@nelsoncitycouncil.govt.nz
// organization_id: <Nelson ID>
// organization_ids: [<Nelson ID>] // ONLY Nelson

// Query breaches (RLS auto-filters)
const { data: breaches } = await supabase
  .from('breach_alerts')
  .select('*')
  .order('created_at', { ascending: false });

// RLS Policy allows:
// WHERE organization_id = ANY(['Nelson'])

// Result: ONLY see Nelson breaches
// LINZ and First Security data is INVISIBLE
```

---

## 🚨 Critical Security Considerations

### **1. RLS Must Be 100% Consistent**
- Every table with `organization_id` must use `ANY(get_user_organization_ids())`
- Do NOT mix single-org and multi-org policies
- Test thoroughly before production

### **2. UI Must Prevent Cross-Org Data Leaks**
- Organization selector must filter ALL queries
- Never expose org IDs in URLs/localStorage if not accessible
- Validate organization access before mutations

### **3. Audit Trail**
- Log organization switches in audit_log
- Track which org user was working for when action taken
- Include organization context in all enforcement actions

---

## 📝 Migration Script Preview

```sql
-- 20260215_multi_organization_hierarchy.sql

-- Step 1: Add parent organization support
ALTER TABLE organizations
ADD COLUMN parent_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
ADD COLUMN organization_type TEXT DEFAULT 'client' CHECK (organization_type IN ('parent', 'client'));

CREATE INDEX idx_organizations_parent ON organizations(parent_organization_id);

-- Step 2: Set up First Security hierarchy
UPDATE organizations
SET organization_type = 'parent'
WHERE name = 'First Security';

UPDATE organizations
SET parent_organization_id = (SELECT id FROM organizations WHERE name = 'First Security')
WHERE name IN ('LINZ', 'Nelson City Council');

-- Step 3: Populate organization_ids for existing users
-- First Security users get all clients
UPDATE user_profiles
SET organization_ids = (
  SELECT ARRAY_AGG(id) FROM organizations
  WHERE parent_organization_id = (SELECT id FROM organizations WHERE name = 'First Security')
  OR id = (SELECT id FROM organizations WHERE name = 'First Security')
)
WHERE organization_id = (SELECT id FROM organizations WHERE name = 'First Security');

-- Client users get only their org
UPDATE user_profiles
SET organization_ids = ARRAY[organization_id]
WHERE organization_id != (SELECT id FROM organizations WHERE name = 'First Security')
AND (organization_ids IS NULL OR organization_ids = '{}');

-- Step 4: Update RLS policies (example)
-- zones table
DROP POLICY IF EXISTS "users_view_zones" ON zones;
CREATE POLICY "users_view_zones"
ON zones FOR SELECT
TO authenticated
USING (
  (get_user_role(auth.uid()) = 'master') OR
  (organization_id = ANY(get_user_organization_ids()))
);

-- Repeat for all tables...
```

---

## ✅ Success Criteria

1. ✅ First Security admin can see data from LINZ, Nelson, and First Security
2. ✅ First Security field officer can work jobs for any client
3. ✅ Cari (Nelson employee) can ONLY see Nelson data
4. ✅ Organization selector shows correct orgs based on user access
5. ✅ RLS policies prevent data leaks
6. ✅ No performance degradation from `ANY()` array checks
7. ✅ Audit log tracks organization context

---

**Ready to implement?** Let me know and I'll create the migration + UI updates!
