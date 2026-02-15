# Employer and Authorized Work Locations Architecture

**Status:** ✅ **Backend Complete** | ✅ **Frontend Complete** | ⏳ **Testing Needed**

---

## 🎯 **Overview**

This system clarifies the relationship between **who employs an officer** (payroll, HR, legal responsibility) vs **where they're authorized to work** (which client organizations they can access data for).

### **Problem Solved:**

Before this change, `organization_id` was ambiguous:
- Did it mean the officer's employer (First Security)?
- Or the client organization they're working for (LINZ)?

Now we have:
- **`employer_organization_id`**: Who employs the officer (payroll, HR, legal responsibility)
- **`authorized_work_locations`**: Array of organization IDs the officer can work for

---

## 📋 **Database Schema**

### **Fields Added to `user_profiles`:**

```sql
alter table user_profiles
add column employer_organization_id uuid references organizations(id),
add column authorized_work_locations uuid[] default array[]::uuid[];

comment on column user_profiles.employer_organization_id is 
'Organization that employs this user (payroll, HR, legal responsibility). E.g., First Security employs the officer.';

comment on column user_profiles.authorized_work_locations is 
'Array of organization IDs this user is authorized to work for. E.g., First Security officer authorized for [First Security, LINZ, Nelson]. Must be employer + descendants only.';
```

### **Example Data:**

| User | Employer | Authorized Work Locations |
|------|----------|---------------------------|
| John (First Security officer) | First Security | [First Security, LINZ, Nelson] |
| Sarah (First Security officer - LINZ only) | First Security | [LINZ] |
| Mike (Nelson officer) | Nelson City Council | [Nelson] |
| Admin Emma (Iron Eagle) | Iron Eagle | [Iron Eagle, First Security, LINZ, Nelson] |

---

## 🔐 **Access Control Logic**

### **RLS Policy Pattern:**

All RLS policies now use:

```sql
organization_id = ANY(get_user_organization_ids())
```

This function returns:
- User's `employer_organization_id`
- User's `authorized_work_locations`
- All descendants of authorized organizations (recursive)

### **Example:**

**Sarah (First Security officer, authorized for LINZ only):**
- Can see: LINZ data
- Cannot see: Nelson data, First Security data

**John (First Security officer, authorized for all clients):**
- Can see: First Security, LINZ, Nelson data
- Cannot see: Iron Eagle data (unless authorized)

---

## 🖥️ **Frontend Implementation**

### **User Management Form:**

1. **Employer Organization Dropdown** (single select):
   - Shows all organizations
   - Required for officers
   - Example: "First Security (Level 2)"

2. **Authorized Work Locations Multi-Select** (checkboxes):
   - Only shows **employer + descendants**
   - Example: If employer = First Security, shows:
     - ☑ First Security (Employer)
     - ☑ LINZ
     - ☑ Nelson City Council
   - Officer can be authorized for 1+ locations
   - Admin selects which clients the officer can work for

### **User Management UI Code:**

```tsx
{/* Employer Organization */}
{(formData.role === 'officer' || formData.role === 'admin_officer') && (
  <div>
    <Label>Employer Organization (Who Employs This Officer) *</Label>
    <Select 
      value={formData.employerOrgId} 
      onValueChange={(value) => {
        setFormData({ 
          ...formData, 
          employerOrgId: value,
          authorizedWorkLocations: [] // Reset when employer changes
        });
      }}
    >
      {organizations?.map((org) => (
        <SelectItem value={org.id}>
          {org.name} (Level {org.organization_level})
        </SelectItem>
      ))}
    </Select>
  </div>
)}

{/* Authorized Work Locations */}
{formData.employerOrgId && (
  <div>
    <Label>Authorized Work Locations (Multi-Select) *</Label>
    <div className="border rounded-md p-3 space-y-2">
      {getAvailableWorkLocations().map((org) => (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.authorizedWorkLocations.includes(org.id)}
            onChange={(e) => {
              // Add/remove from authorized locations
            }}
          />
          <Label>{org.name} {org.id === formData.employerOrgId && '(Employer)'}</Label>
        </div>
      ))}
    </div>
  </div>
)}
```

---

## 🛠️ **Backend Updates**

### **Edge Function: `create-user`**

Updated to accept and store:
- `employer_organization_id`
- `authorized_work_locations`
- `permissions`

```typescript
const { 
  employer_organization_id,
  authorized_work_locations,
  permissions 
} = await req.json();

await supabaseAdmin
  .from('user_profiles')
  .update({
    employer_organization_id: employer_organization_id || null,
    authorized_work_locations: authorized_work_locations || [],
    permissions: permissions || [],
  })
  .eq('id', authData.user.id);
```

---

## 📊 **Use Cases**

### **Use Case 1: First Security Officer Authorized for All Clients**

**Profile:**
- Employer: First Security
- Authorized Work Locations: [First Security, LINZ, Nelson]

**Access:**
- ✅ Can work patrols in LINZ zones
- ✅ Can work patrols in Nelson zones
- ✅ Can see all First Security data
- ✅ Enforcement actions show employer = First Security in audit trail

---

### **Use Case 2: First Security Officer Authorized for LINZ Only**

**Profile:**
- Employer: First Security
- Authorized Work Locations: [LINZ]

**Access:**
- ✅ Can work patrols in LINZ zones
- ❌ Cannot see Nelson data
- ❌ Cannot see First Security data (unless LINZ is a descendant)
- ✅ Enforcement actions show employer = First Security

**Why restrict?** Contract may specify this officer only works LINZ jobs.

---

### **Use Case 3: Nelson City Council Officer**

**Profile:**
- Employer: Nelson City Council
- Authorized Work Locations: [Nelson]

**Access:**
- ✅ Can work patrols in Nelson zones
- ❌ Cannot see LINZ data
- ❌ Cannot see First Security data
- ✅ Doesn't need COA (council employee)

---

### **Use Case 4: Iron Eagle Master User**

**Profile:**
- Employer: Iron Eagle
- Authorized Work Locations: [Iron Eagle, First Security, LINZ, Nelson] (all)

**Access:**
- ✅ Can see ALL organizations (100% visibility)
- ✅ Can manage ALL users
- ✅ Can access ALL zones

---

## ✅ **Testing Checklist**

### **Create User:**
- [ ] Create First Security officer with employer = First Security
- [ ] Select authorized locations: [First Security, LINZ]
- [ ] Verify officer can only see LINZ + First Security data

### **Edit User:**
- [ ] Edit existing officer
- [ ] Change authorized locations from [LINZ] to [LINZ, Nelson]
- [ ] Verify officer can now see both LINZ and Nelson data

### **Access Control:**
- [ ] Login as officer authorized for LINZ only
- [ ] Verify cannot see Nelson vehicles/zones
- [ ] Verify CAN see LINZ vehicles/zones

### **Audit Trail:**
- [ ] Officer creates enforcement action
- [ ] Verify `audit_log` shows correct `employer_organization_id`
- [ ] Verify enforcement action shows employer name in reports

---

## 🚧 **Pending Tasks**

1. ✅ Database schema migration (DONE: `20260215_multi_organization_hierarchy.sql`)
2. ✅ RLS policies updated (DONE: uses `get_user_organization_ids()`)
3. ✅ User Management frontend updated (DONE: employer dropdown + work locations checkboxes)
4. ✅ Edge function updated (DONE: `create-user` accepts new fields)
5. ⏳ **BACKFILL EXISTING USERS** (PENDING):
   - Iron Eagle users → employer = Iron Eagle, authorized = all
   - First Security users → employer = First Security, authorized = [First Security, LINZ, Nelson]
   - Nelson users → employer = Nelson, authorized = [Nelson]
6. ⏳ **TEST END-TO-END** (PENDING):
   - Create officer with LINZ-only authorization
   - Verify access control works
   - Verify audit trail shows correct employer

---

## 🎯 **Benefits**

### **Before (Ambiguous):**
- ❌ `organization_id` unclear (employer or work location?)
- ❌ Officer access rights not clear
- ❌ Audit trail doesn't show who employs the officer
- ❌ Can't restrict First Security officers to specific clients

### **After (Clear):**
- ✅ `employer_organization_id` = payroll/HR responsibility
- ✅ `authorized_work_locations` = which clients they can work for
- ✅ Audit trail shows employer in enforcement actions
- ✅ Can restrict officers to specific clients (contract requirements)
- ✅ Better reporting: track actions by employer vs employee

---

## 📝 **Next Steps**

1. **Backfill existing users** with correct employer + authorized locations
2. **Test access control** with restricted officers
3. **Update audit_log** table to include `employer_organization_id`
4. **Add employer context** to all enforcement action triggers
5. **Test end-to-end** with real data

---

## 📚 **Related Migrations**

- `20260215_multi_organization_hierarchy.sql` - Added employer fields + recursive access function
- `20260215_officer_compliance_credentials.sql` - Uses `employer_organization_id` for COA checks
- `20260215_enhanced_compliance_credentials.sql` - Organization-specific compliance requirements

---

**Status:** ✅ Backend + Frontend Complete | ⏳ Testing + Backfill Needed
