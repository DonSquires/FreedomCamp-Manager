# Multi-Organization Access Architecture (3-Tier Hierarchy)
**Problem:** Iron Eagle owns the platform → First Security is their client → LINZ/Nelson are First Security's clients. Need recursive access: Iron Eagle sees ALL, First Security sees their clients, Nelson sees ONLY Nelson.

---

## 🏗️ Architecture Overview

### **Three-Tier Organization Hierarchy**

```
Iron Eagle Security (Platform Owner - Level 1)
└── First Security (Service Provider - Level 2, Client of Iron Eagle)
    ├── LINZ (End Client - Level 3, Client of First Security)
    │   ├── Data: Zones, Vehicles, Patrols
    │   └── Users: LINZ employees (restricted to LINZ only)
    └── Nelson City Council (End Client - Level 3, Client of First Security)
        ├── Data: Zones, Vehicles, Patrols
        └── Users: Cari (employed by Nelson - restricted access)
```

**Key Principle:** Each level sees itself + all descendants
- **Iron Eagle** → First Security + LINZ + Nelson (ALL descendants)
- **First Security** → First Security + LINZ + Nelson (direct children only)
- **LINZ** → LINZ only (no children)
- **Nelson** → Nelson only (no children)

### **User Access Levels (3-Tier Model)**

| User Type | organization_id | organization_ids | Access Pattern | Visibility |
|-----------|----------------|------------------|----------------|------------|
| **Iron Eagle Master** | Iron Eagle | [Iron Eagle, First Security, LINZ, Nelson] | See ALL organizations (recursive descendants) | 100% visibility |
| **Iron Eagle Admin** | Iron Eagle | [Iron Eagle, First Security, LINZ, Nelson] | Full access to all data | 100% visibility |
| **First Security Admin** | First Security | [First Security, LINZ, Nelson] | See First Security + clients | First Security + clients only |
| **First Security Officer** | First Security | [First Security, LINZ, Nelson] | Can work jobs for any First Security client | First Security + clients only |
| **Cari (Nelson Employee)** | Nelson | [Nelson] | ONLY see Nelson data | Nelson only |
| **LINZ Employee** | LINZ | [LINZ] | ONLY see LINZ data | LINZ only |

---

## 📊 Database Schema Changes

### **1. Add Parent Organization Relationship (3-Tier Support)**

```sql
-- Add parent_organization_id to organizations table (supports unlimited nesting)
ALTER TABLE organizations
ADD COLUMN parent_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN organizations.parent_organization_id IS 
'Parent organization for multi-tier hierarchy. NULL for root organization (Iron Eagle).';

-- Add organization level for hierarchy tracking
ALTER TABLE organizations
ADD COLUMN organization_level INTEGER DEFAULT 1 CHECK (organization_level >= 1);

COMMENT ON COLUMN organizations.organization_level IS 
'Hierarchy level: 1 = Root (Iron Eagle), 2 = Service Provider (First Security), 3 = End Client (LINZ/Nelson)';

-- Add organization type
ALTER TABLE organizations
ADD COLUMN organization_type TEXT DEFAULT 'client' CHECK (organization_type IN ('owner', 'service_provider', 'client'));

COMMENT ON COLUMN organizations.organization_type IS 
'owner = platform owner (Iron Eagle), service_provider = reseller (First Security), client = end customer (LINZ/Nelson)';

-- Create index for hierarchy queries
CREATE INDEX idx_organizations_parent ON organizations(parent_organization_id);
CREATE INDEX idx_organizations_level ON organizations(organization_level);

-- Example data:
-- Iron Eagle: parent_organization_id = NULL, organization_type = 'owner', level = 1
-- First Security: parent_organization_id = <Iron Eagle ID>, organization_type = 'service_provider', level = 2
-- LINZ: parent_organization_id = <First Security ID>, organization_type = 'client', level = 3
-- Nelson: parent_organization_id = <First Security ID>, organization_type = 'client', level = 3
```

### **2. Create Recursive Descendant Function**

```sql
-- Function to get ALL descendant organizations (recursive)
CREATE OR REPLACE FUNCTION get_descendant_organizations(org_id UUID)
RETURNS UUID[] AS $$
DECLARE
  descendants UUID[];
BEGIN
  -- Get current org + all descendants recursively
  WITH RECURSIVE org_tree AS (
    -- Base case: start with the given organization
    SELECT id, parent_organization_id
    FROM organizations
    WHERE id = org_id
    
    UNION ALL
    
    -- Recursive case: get children of current level
    SELECT o.id, o.parent_organization_id
    FROM organizations o
    INNER JOIN org_tree ot ON o.parent_organization_id = ot.id
  )
  SELECT ARRAY_AGG(id) INTO descendants FROM org_tree;
  
  RETURN descendants;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_descendant_organizations(UUID) IS 
'Returns array of organization ID + all descendant organization IDs (recursive)';

-- Update get_user_organization_ids to use recursive function
CREATE OR REPLACE FUNCTION get_user_organization_ids()
RETURNS UUID[] AS $$
DECLARE
  user_org_id UUID;
  descendant_ids UUID[];
BEGIN
  -- Get user's primary organization
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = auth.uid();
  
  IF user_org_id IS NULL THEN
    RETURN ARRAY[]::UUID[];
  END IF;
  
  -- Get all descendants of user's organization
  descendant_ids := get_descendant_organizations(user_org_id);
  
  RETURN descendant_ids;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_user_organization_ids() IS 
'Returns current user organization + all descendant organizations (for RLS policies)';
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
- ✅ `observations`
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

### **Scenario 1: Iron Eagle Master Reviews ALL Breaches**

```typescript
// User: master@ironeagle.co.nz
// organization_id: <Iron Eagle ID>
// get_user_organization_ids() returns: [<Iron Eagle ID>, <First Security ID>, <LINZ ID>, <Nelson ID>]

// Query breaches (RLS auto-filters)
const { data: breaches } = await supabase
  .from('breach_alerts')
  .select('*, zones(name), organizations(name)')
  .order('created_at', { ascending: false });

// RLS Policy allows:
// WHERE organization_id = ANY(get_user_organization_ids())
// Which evaluates to: ['Iron Eagle', 'First Security', 'LINZ', 'Nelson']

// Result: See breaches from ALL organizations (100% visibility)
```

### **Scenario 1B: First Security Admin Reviews Client Breaches**

```typescript
// User: admin@firstsecurity.co.nz
// organization_id: <First Security ID>
// get_user_organization_ids() returns: [<First Security ID>, <LINZ ID>, <Nelson ID>]

// Query breaches (RLS auto-filters)
const { data: breaches } = await supabase
  .from('breach_alerts')
  .select('*, zones(name), organizations(name)')
  .order('created_at', { ascending: false });

// RLS Policy allows:
// WHERE organization_id = ANY(['First Security', 'LINZ', 'Nelson'])

// Result: See breaches from First Security + clients (NOT Iron Eagle data)
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

### **1. RLS Must Support Recursive Hierarchy**
- Every table with `organization_id` must use `ANY(get_user_organization_ids())`
- `get_user_organization_ids()` function MUST use recursive descendant logic
- Test all 3 levels: Iron Eagle (sees all) → First Security (sees clients) → Nelson (sees only self)
- Do NOT mix single-org and multi-org policies

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

-- Step 1: Add parent organization support (3-tier hierarchy)
ALTER TABLE organizations
ADD COLUMN parent_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
ADD COLUMN organization_level INTEGER DEFAULT 1 CHECK (organization_level >= 1),
ADD COLUMN organization_type TEXT DEFAULT 'client' CHECK (organization_type IN ('owner', 'service_provider', 'client'));

CREATE INDEX idx_organizations_parent ON organizations(parent_organization_id);
CREATE INDEX idx_organizations_level ON organizations(organization_level);

-- Step 2: Set up 3-tier hierarchy
-- Iron Eagle = Level 1 Owner
UPDATE organizations
SET organization_type = 'owner',
    organization_level = 1,
    parent_organization_id = NULL
WHERE name = 'Iron Eagle Security';

-- First Security = Level 2 Service Provider (child of Iron Eagle)
UPDATE organizations
SET organization_type = 'service_provider',
    organization_level = 2,
    parent_organization_id = (SELECT id FROM organizations WHERE name = 'Iron Eagle Security')
WHERE name = 'First Security';

-- LINZ & Nelson = Level 3 Clients (children of First Security)
UPDATE organizations
SET organization_type = 'client',
    organization_level = 3,
    parent_organization_id = (SELECT id FROM organizations WHERE name = 'First Security')
WHERE name IN ('LINZ', 'Nelson City Council');

-- Step 3: Create recursive descendant function
CREATE OR REPLACE FUNCTION get_descendant_organizations(org_id UUID)
RETURNS UUID[] AS $$
DECLARE
  descendants UUID[];
BEGIN
  WITH RECURSIVE org_tree AS (
    SELECT id, parent_organization_id FROM organizations WHERE id = org_id
    UNION ALL
    SELECT o.id, o.parent_organization_id
    FROM organizations o
    INNER JOIN org_tree ot ON o.parent_organization_id = ot.id
  )
  SELECT ARRAY_AGG(id) INTO descendants FROM org_tree;
  RETURN descendants;
END;
$$ LANGUAGE plpgsql STABLE;

-- Step 4: Update get_user_organization_ids to use recursive logic
CREATE OR REPLACE FUNCTION get_user_organization_ids()
RETURNS UUID[] AS $$
DECLARE
  user_org_id UUID;
BEGIN
  SELECT organization_id INTO user_org_id FROM user_profiles WHERE id = auth.uid();
  IF user_org_id IS NULL THEN RETURN ARRAY[]::UUID[]; END IF;
  RETURN get_descendant_organizations(user_org_id);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Step 5: Populate organization_ids for existing users (now automatic via function)
-- No manual population needed - function handles it dynamically

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

1. ✅ Iron Eagle users can see data from ALL organizations (Iron Eagle + First Security + LINZ + Nelson)
2. ✅ First Security admin can see data from First Security + clients (LINZ + Nelson) but NOT Iron Eagle
3. ✅ First Security field officer can work jobs for First Security clients
4. ✅ Cari (Nelson employee) can ONLY see Nelson data
5. ✅ Organization selector shows correct orgs based on user hierarchy level
6. ✅ RLS policies prevent data leaks at all hierarchy levels
7. ✅ Recursive function performance tested with 1000+ organizations
8. ✅ Audit log tracks organization context with hierarchy path

---

**Ready to implement?** Let me know and I'll create the migration + UI updates!
