# Organization & User Management Workflow

## 1. Organization Hierarchy System

### Structure
```
Iron Eagle Security (Level 1, Type: Security Company)
├── First Security NZ (Level 2, Type: Security Company)
│   ├── LINZ (Level 3, Type: Client)
│   ├── Nelson City Council (Level 3, Type: Client)
│   └── Wellington Council (Level 3, Type: Client)
└── JDS Security (Level 2, Type: Security Company)
    └── Auckland Council (Level 3, Type: Client)
```

### Organization Fields
- **id**: UUID (Primary Key)
- **name**: Organization name
- **parent_organization_id**: Links to parent org
- **organization_level**: Auto-calculated depth (1, 2, 3...)
- **organization_type**: 'security_company' | 'client' | 'contractor'
- **enforcement_workflow**: 'admin_first' | 'officer_first'
- **contact_email**, **contact_phone**: Contact details
- **is_active**: Enable/disable organization

### Business Rules
1. **Level 1 (Root)**: Top-level security companies (Iron Eagle)
2. **Level 2**: Regional branches or subsidiary companies
3. **Level 3+**: Client organizations (councils, companies)
4. Only **master** users can create/edit organizations
5. Deleting org with children is blocked
6. Deactivating org cascades to all users

---

## 2. User-Organization Relationships

### Three-Tier Relationship Model

#### A. Primary Organization (`organization_id`)
- The organization the user **belongs to**
- Determines base RLS access (what data they see)
- Required for all users except master
- Example: Officer belongs to "First Security NZ"

#### B. Employer Organization (`employer_organization_id`)
- The **security company** that employs the user
- Used for payroll, HR, welfare tracking
- Always a Level 1 or Level 2 organization
- Example: Officer employed by "Iron Eagle Security"

#### C. Authorized Work Locations (`authorized_work_locations[]`)
- Array of organization IDs user can access
- Enables cross-organization work
- Example: Officer can work at LINZ, Nelson, and Wellington

### User Scenarios

**Scenario 1: Standard Officer**
- organization_id: `first-security-nz`
- employer_organization_id: `iron-eagle-security`
- authorized_work_locations: `[linz, nelson-council]`
- **Access**: Can see data from LINZ and Nelson, employed by Iron Eagle

**Scenario 2: Admin**
- organization_id: `first-security-nz`
- employer_organization_id: `iron-eagle-security`
- authorized_work_locations: `[]` (sees all descendant orgs)
- **Access**: Sees all First Security branches and clients automatically

**Scenario 3: Master User**
- organization_id: `null` (not bound to any org)
- employer_organization_id: `iron-eagle-security`
- authorized_work_locations: `[]`
- **Access**: Sees everything across all organizations

---

## 3. User Roles & Permissions

### Role Hierarchy (High to Low)
1. **master**: System-wide access, can manage all orgs/users
2. **admin**: Manages their organization + descendants
3. **admin_officer**: Dual role - can use field + admin portals
4. **officer**: Field operations only

### Permission Matrix

| Feature | master | admin | admin_officer | officer |
|---------|--------|-------|---------------|---------|
| Create Organizations | ✅ | ❌ | ❌ | ❌ |
| Manage Users (Own Org) | ✅ | ✅ | ❌ | ❌ |
| Manage Users (Child Orgs) | ✅ | ✅ | ❌ | ❌ |
| Edit Compliance Rules | ✅ | ✅ | ❌ | ❌ |
| View All Data | ✅ | Own+Descendants | Own+Authorized | Own+Authorized |
| Field Scanning | ✅ | ✅ | ✅ | ✅ |
| Admin Portal | ✅ | ✅ | ✅ | ❌ |
| Portal Selection | ❌ | ❌ | ✅ | ❌ |
| Database Maintenance | ✅ | ❌ | ❌ | ❌ |

### Special Permissions (JSON Array)
```json
["super_delete", "direct_db_access", "export_all_data"]
```
- Only for specific master users (e.g., don.squire@firstsecurity.co.nz)

---

## 4. Enforcement Workflow System

### Workflow Types

#### A. Admin First (`admin_first`)
**Flow:** Officer → Admin Review → Enforcement Action
1. Officer detects breach
2. Breach alert created with status "pending"
3. Admin reviews and approves/rejects
4. If approved, enforcement action is created
5. Assigned to officer for execution

**Use Case:** High-compliance environments, legal-sensitive areas

#### B. Officer First (`officer_first`)
**Flow:** Officer → Enforcement Action → Admin Notification
1. Officer detects breach
2. Officer creates enforcement action immediately
3. Admin receives notification
4. Admin can review/modify if needed

**Use Case:** High-volume areas, trusted officers, rapid response

### Configuration
- Set at **organization level**
- Inherited by all zones in that organization
- Can override per-zone if needed
- Default: `admin_first`

---

## 5. Login & Authentication Flow

### Step 1: User Login
```typescript
// Supabase Auth (email + password)
const { data, error } = await supabase.auth.signInWithPassword({
  email: user.email,
  password: user.password
});
```

### Step 2: Fetch User Profile
```typescript
// Get user_profiles record (linked via auth.users.id)
const { data: profile } = await supabase
  .from('user_profiles')
  .select(`
    id,
    first_name,
    last_name,
    email,
    role,
    organization_id,
    employer_organization_id,
    authorized_work_locations,
    permissions,
    is_active,
    organization:organizations!organization_id(id, name, enforcement_workflow)
  `)
  .eq('id', user.id)
  .single();
```

### Step 3: Authorization Check
```typescript
// Check if user is active
if (!profile.is_active) {
  throw new Error('Account deactivated');
}

// Store in auth store
setUser(profile);
```

### Step 4: Portal Routing
```typescript
if (role === 'admin_officer') {
  // Show portal selection
  navigate('/portal-selection');
} else if (role === 'officer') {
  // Force field portal
  navigate('/field-officer');
} else if (role === 'admin' || role === 'master') {
  // Force admin portal
  navigate('/admin');
}
```

---

## 6. RLS & Data Access Rules

### Helper Functions (SECURITY DEFINER)

#### `get_user_role(user_id UUID)`
Returns user's role (bypasses RLS to prevent recursion)

#### `get_user_organization_id(user_id UUID)`
Returns user's primary organization_id

#### `get_user_organization_ids(user_id UUID)`
Returns array of all accessible org IDs:
- Primary organization_id
- All authorized_work_locations
- All descendant orgs (if admin/master)

#### `get_descendant_organizations(org_id UUID)`
Returns all child organizations recursively

### RLS Policy Patterns

**Pattern 1: Masters See Everything**
```sql
CREATE POLICY "masters_view_all"
  ON table_name FOR SELECT
  USING (get_user_role(auth.uid()) = 'master');
```

**Pattern 2: Users See Own + Authorized Orgs**
```sql
CREATE POLICY "users_view_accessible"
  ON table_name FOR SELECT
  USING (
    get_user_role(auth.uid()) = 'master' OR
    organization_id = ANY(get_user_organization_ids())
  );
```

**Pattern 3: Admins Manage Org + Descendants**
```sql
CREATE POLICY "admins_manage_org_tree"
  ON user_profiles FOR UPDATE
  USING (
    get_user_role(auth.uid()) IN ('admin', 'master') AND
    (
      organization_id = get_user_organization_id(auth.uid()) OR
      organization_id IN (
        SELECT org_id FROM get_descendant_organizations(get_user_organization_id(auth.uid()))
      )
    )
  );
```

---

## 7. Welfare System Integration

### Welfare Monitoring Requirements
1. **View Officer Locations**: Real-time GPS tracking
2. **Activity Logs**: Last scan, check-in times
3. **Welfare Alerts**: Inactivity warnings
4. **Officer Profiles**: Contact info, emergency contacts

### Access Rules
- **Admins** can see all officers in their org + descendants
- **Masters** can see all officers system-wide
- **Officers** cannot see other officers' welfare data
- Welfare system uses `employer_organization_id` to group officers by company

### Queries
```sql
-- Admin viewing officers under their management
SELECT 
  id, 
  first_name, 
  last_name, 
  email, 
  phone,
  last_activity_at,
  gps_latitude,
  gps_longitude
FROM user_profiles
WHERE 
  role IN ('officer', 'admin_officer') AND
  is_active = true AND
  (
    employer_organization_id = get_user_organization_id(auth.uid()) OR
    employer_organization_id IN (
      SELECT org_id FROM get_descendant_organizations(get_user_organization_id(auth.uid()))
    )
  );
```

---

## 8. Organization Management Page Design

### Features
1. **Hierarchical Tree View**: Visual org chart
2. **CRUD Operations**: Create, edit, delete orgs (master only)
3. **Enforcement Workflow Toggle**: Switch between admin_first/officer_first
4. **User Count**: Show # of users per org
5. **Active Zones**: Show # of zones per org
6. **Cascade Warnings**: Warn before deactivating org with users

### UI Layout
```
┌─────────────────────────────────────────────────────────┐
│ Organization Management                   [+ New Org]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 📁 Iron Eagle Security (Level 1)           [Edit]      │
│   ├─ 📁 First Security NZ (Level 2)        [Edit]      │
│   │   ├─ 🏢 LINZ (Level 3)                 [Edit]      │
│   │   │   Users: 12 | Zones: 5                         │
│   │   │   Enforcement: Admin First                     │
│   │   ├─ 🏢 Nelson City Council            [Edit]      │
│   │   └─ 🏢 Wellington Council              [Edit]      │
│   └─ 📁 JDS Security (Level 2)             [Edit]      │
│       └─ 🏢 Auckland Council                [Edit]      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 9. User Management Page Design

### Features
1. **Organization Filter**: Filter by org (admins see their tree only)
2. **Role Filter**: Filter by role
3. **Multi-Organization Assignment**: Assign authorized work locations
4. **Invite System**: Create user → send invite email → user sets password
5. **Session Management**: View/terminate active sessions
6. **Deactivate (not Delete)**: Preserve audit trail

### UI Layout
```
┌─────────────────────────────────────────────────────────┐
│ User Management                          [+ Invite User]│
├─────────────────────────────────────────────────────────┤
│ Filters: [Organization ▼] [Role ▼] [Status ▼]          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ┌─────────────────────────────────────────────────┐   │
│ │ Don Squires                               [Edit]│   │
│ │ don.squire@firstsecurity.co.nz                  │   │
│ │ Role: Master | Org: Iron Eagle Security         │   │
│ │ Last Login: 2 hours ago | Status: Active        │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ ┌─────────────────────────────────────────────────┐   │
│ │ Chris Harris                              [Edit]│   │
│ │ chris.harris@firstsecurity.co.nz                │   │
│ │ Role: Admin Officer | Org: First Security NZ    │   │
│ │ Works At: LINZ, Nelson Council                  │   │
│ │ Last Login: 1 day ago | Status: Active          │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Critical Business Logic

### User Creation Flow
1. Admin fills invite form
2. System creates `auth.users` record (via Edge Function)
3. System creates `user_profiles` record
4. System sends invite email with temp password
5. User logs in and must change password
6. `user_profiles.is_active = true` by default

### User Deletion Rules
- **NEVER hard delete** (preserve audit trail)
- Use `is_active = false` to deactivate
- Deactivated users cannot login
- Data remains in observations/incidents for legal compliance

### Organization Deletion Rules
- Cannot delete if has child organizations
- Cannot delete if has active users
- Cannot delete if has zones with observations
- Must deactivate first, then delete after cleanup

---

## 11. Edge Cases & Validations

### Preventing Circular Hierarchies
```sql
-- Trigger: prevent_circular_org_reference
-- Checks parent chain doesn't loop back to self
```

### Enforcing Organization Level
```sql
-- Trigger: auto_calculate_org_level
-- Calculates depth from root automatically
```

### User-Organization Validation
- Cannot assign user to org that doesn't exist
- Cannot assign user to descendant org if admin (must be own org)
- authorized_work_locations must be valid org IDs

### Multi-Session Prevention
- Only 1 active session per user
- New login terminates old session
- Tracked in `user_sessions` table

---

## 12. Implementation Checklist

### Database
- [x] Organizations table with hierarchy
- [x] user_profiles with 3-tier org relationship
- [x] RLS helper functions (SECURITY DEFINER)
- [x] Triggers for org level calculation
- [x] Circular reference prevention

### Backend (Edge Functions)
- [ ] create-user: Invite system
- [ ] update-user-password: Password reset
- [x] RLS policies for all tables

### Frontend Components
- [ ] OrganizationManagement.tsx (new)
- [ ] UserManagement.tsx (rebuild)
- [ ] OrganizationSelector component
- [ ] UserInviteModal
- [ ] UserEditDrawer

### Integration Points
- [x] Welfare system uses employer_organization_id
- [x] Enforcement workflow reads org settings
- [x] RLS uses get_user_organization_ids()
- [x] Login flow checks is_active

---

## Summary

This workflow establishes:
1. **Clear hierarchy**: Security companies → Clients
2. **Flexible access**: Users can work across multiple orgs
3. **Proper segregation**: Officers see authorized data only
4. **Welfare integration**: Tracks officers by employer
5. **Enforcement flexibility**: Per-org workflow settings
6. **Audit compliance**: Never delete, always deactivate
7. **RLS security**: Helper functions prevent recursion
8. **Master override**: Top-level access for system management
