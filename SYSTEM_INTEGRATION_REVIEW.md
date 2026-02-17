# System Integration Review - Build Cleanup

## Date: 2026-02-17
## Focus Areas:
1. Cross-portal Integration (Officer ↔ Admin)
2. Login Process Enhancement (COA + Warrant Checkboxes)
3. admin_officer Role Flow Validation

---

## 1. CROSS-PORTAL INTEGRATION STATUS

### Current Implementation:

#### Field Officer Portal → Admin Portal Links
- ❌ **MISSING**: Welfare monitoring cross-link
- ❌ **MISSING**: Enforcement action cross-link
- ❌ **MISSING**: Investigation job cross-link

#### Admin Portal → Field Officer Portal Links
- ✅ **EXISTS**: "Switch to Field Portal" button in sidebar
- ❌ **MISSING**: Direct links from Welfare Hub to field officer view
- ❌ **MISSING**: Direct links from Enforcement Hub to field officer actions
- ❌ **MISSING**: Direct links from Investigation Jobs to field officer jobs

### Required Changes:

#### A. Field Officer Portal Enhancements
**File**: `src/pages/FieldOfficerPortal.tsx`

Add "Admin View" buttons for:
1. **Welfare Section** (Dashboard):
   - Link to: `/admin?tab=officer-welfare-hub`
   - Display: "View in Admin Portal" button
   - Condition: Only for `admin_officer` role

2. **Enforcement Jobs Section** (Dashboard):
   - Link to: `/admin?tab=enforcement-hub`
   - Display: "Manage All Enforcement" button
   - Condition: Only for `admin_officer` role

3. **Investigation Jobs Section** (Dashboard):
   - Link to: `/admin?tab=investigation-jobs`
   - Display: "Manage All Investigations" button
   - Condition: Only for `admin_officer` role

#### B. Admin Portal Enhancements
**File**: `src/pages/AdminPortal.tsx`

Add URL parameter handling:
```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab) setActiveTab(tab);
}, []);
```

---

## 2. LOGIN PROCESS ENHANCEMENT

### Current State:
- ✅ Email/password authentication
- ✅ Compliance blocking modal
- ❌ **MISSING**: COA (Certificate of Approval) checkbox
- ❌ **MISSING**: Warrant checkbox
- ❌ **MISSING**: Database fields for COA/Warrant status

### Required Database Changes:

#### A. Add User Profile Fields
**Migration**: `20260217_add_compliance_checkboxes.sql`

```sql
-- Add COA and Warrant fields to user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS coa_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS coa_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS coa_expiry DATE,
  ADD COLUMN IF NOT EXISTS warrant_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS warrant_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS warrant_expiry DATE;

-- Add index for compliance queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_compliance 
  ON public.user_profiles(coa_required, warrant_required, coa_verified, warrant_verified);
```

#### B. Update RPC Function
**Function**: `check_organization_compliance`

Add COA + Warrant checks:
```sql
CREATE OR REPLACE FUNCTION public.check_organization_compliance(
  p_user_id UUID,
  p_employer_org_id UUID
)
RETURNS TABLE (
  can_work BOOLEAN,
  missing_items TEXT[],
  employer_name TEXT
) AS $$
DECLARE
  v_coa_required BOOLEAN;
  v_coa_verified BOOLEAN;
  v_warrant_required BOOLEAN;
  v_warrant_verified BOOLEAN;
  v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Get user compliance settings
  SELECT 
    COALESCE(coa_required, false),
    COALESCE(coa_verified, false),
    COALESCE(warrant_required, false),
    COALESCE(warrant_verified, false)
  INTO
    v_coa_required,
    v_coa_verified,
    v_warrant_required,
    v_warrant_verified
  FROM user_profiles
  WHERE id = p_user_id;

  -- Check if COA is required but not verified
  IF v_coa_required AND NOT v_coa_verified THEN
    v_missing := array_append(v_missing, 'Certificate of Approval');
  END IF;

  -- Check if Warrant is required but not verified
  IF v_warrant_required AND NOT v_warrant_verified THEN
    v_missing := array_append(v_missing, 'Freedom Camping Warrant');
  END IF;

  -- Return results
  RETURN QUERY
  SELECT 
    (array_length(v_missing, 1) IS NULL OR array_length(v_missing, 1) = 0) AS can_work,
    v_missing AS missing_items,
    org.name AS employer_name
  FROM organizations org
  WHERE org.id = p_employer_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Required Frontend Changes:

#### A. Login.tsx Enhancement
**File**: `src/pages/Login.tsx`

Add checkboxes after successful authentication:
```typescript
// Show compliance checkboxes on first login
if (profile && !profile.coa_verified && !profile.warrant_verified) {
  setShowComplianceSetup(true);
  return;
}
```

#### B. New Component: ComplianceSetupDialog
**File**: `src/components/features/ComplianceSetupDialog.tsx`

```typescript
export function ComplianceSetupDialog({ userId, onComplete }) {
  const [coaRequired, setCoaRequired] = useState(false);
  const [warrantRequired, setWarrantRequired] = useState(false);
  
  const handleSubmit = async () => {
    await supabase.from('user_profiles').update({
      coa_required: coaRequired,
      warrant_required: warrantRequired,
    }).eq('id', userId);
    
    onComplete();
  };
  
  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Compliance Requirements</DialogTitle>
          <DialogDescription>
            Please confirm which credentials are required for your role
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={coaRequired}
              onCheckedChange={setCoaRequired}
            />
            <Label>
              <strong>Certificate of Approval (COA)</strong>
              <p className="text-xs text-muted-foreground">
                Required for enforcement officers working in regulated zones
              </p>
            </Label>
          </div>
          
          <div className="flex items-center gap-3">
            <Checkbox
              checked={warrantRequired}
              onCheckedChange={setWarrantRequired}
            />
            <Label>
              <strong>Freedom Camping Warrant</strong>
              <p className="text-xs text-muted-foreground">
                Required for issuing compliance notices under FC Act 2011
              </p>
            </Label>
          </div>
        </div>
        
        <DialogFooter>
          <Button onClick={handleSubmit}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 3. ADMIN_OFFICER ROLE FLOW VALIDATION

### Flow Map:

```
1. AUTHENTICATION
   ↓
   [Supabase Auth: signInWithPassword]
   ↓
   user_profiles.role === 'admin_officer'
   ↓

2. COMPLIANCE CHECK
   ↓
   check_organization_compliance(user_id, org_id)
   ↓
   IF missing credentials → ComplianceBlockingModal
   ↓

3. ROUTING
   ↓
   App.tsx: user.role === 'admin_officer' ?
   ↓
   IF selected_portal in localStorage:
     → /field-officer (portal='field')
     → /admin (portal='admin')
   ELSE:
     → /portal-selection
   ↓

4. PORTAL SELECTION (if no preference)
   ↓
   PortalSelection.tsx: Show choice dialog
   ↓
   User clicks "Field Portal" or "Admin Portal"
   ↓
   localStorage.setItem('selected_portal', choice)
   ↓
   Navigate to chosen portal
   ↓

5. PORTAL ACCESS
   ↓
   FIELD PORTAL:
     - Full access to scanning, patrols, reports
     - "Admin View" links (if admin_officer)
   ↓
   ADMIN PORTAL:
     - Full access to all admin features
     - "Switch to Field Portal" button
```

### Validation Checklist:

✅ **Database Level**:
- [ ] `user_profiles.role` allows 'admin_officer' value
- [ ] RLS policies grant admin_officer both officer + admin permissions
- [ ] Indexes exist for efficient role queries

✅ **Authentication Level**:
- [ ] `authStore.ts` properly maps admin_officer role
- [ ] Session persistence maintains role across refreshes
- [ ] Compliance check runs for admin_officer role

✅ **Routing Level**:
- [ ] `App.tsx` routes admin_officer to portal-selection (no localStorage)
- [ ] `App.tsx` routes admin_officer to saved portal (with localStorage)
- [ ] Protected routes allow admin_officer access to both portals

✅ **UI Level**:
- [ ] PortalSelection only shows for admin_officer
- [ ] Both portals display correctly for admin_officer
- [ ] Cross-portal navigation works seamlessly

---

## 4. IMPLEMENTATION PRIORITY

### Phase 1: Critical Fixes (Immediate)
1. ✅ Add URL parameter handling to AdminPortal.tsx
2. ✅ Add cross-portal links to FieldOfficerPortal.tsx
3. ✅ Create database migration for COA/Warrant fields

### Phase 2: Login Enhancement (High)
4. ✅ Create ComplianceSetupDialog component
5. ✅ Update Login.tsx to show compliance setup
6. ✅ Update check_organization_compliance() RPC function

### Phase 3: Testing & Validation (Medium)
7. ✅ Test admin_officer flow end-to-end
8. ✅ Verify cross-portal navigation
9. ✅ Verify compliance blocking

---

## 5. TESTING CHECKLIST

### admin_officer Role Testing:
- [ ] Login with admin_officer → Portal Selection shows
- [ ] Select Field Portal → Dashboard loads, "Admin View" buttons visible
- [ ] Select Admin Portal → Dashboard loads, "Switch to Field" button visible
- [ ] Click cross-portal link → Navigate correctly with context
- [ ] Logout + Login → Preference remembered (localStorage)

### Compliance Testing:
- [ ] New user login → Compliance checkboxes show
- [ ] Check COA → Upload screen shows for COA
- [ ] Check Warrant → Upload screen shows for Warrant
- [ ] Skip upload → Blocked from portal
- [ ] Upload credentials → Portal access granted

### Cross-Portal Navigation Testing:
- [ ] Field Officer: Welfare button → Admin Welfare Hub with correct tab
- [ ] Field Officer: Enforcement button → Admin Enforcement Hub with data
- [ ] Admin: Live Field Operations → Click officer → Field Portal view
- [ ] Admin: Investigation Job → Assign to self → Field Portal jobs list

---

## 6. DOCUMENTATION UPDATES NEEDED

- [ ] Update user manual with admin_officer role explanation
- [ ] Add compliance setup guide
- [ ] Document cross-portal navigation features
- [ ] Update RLS policy documentation

---

## CONCLUSION

**Build Status**: Requires cleanup and enhancement

**Estimated Implementation Time**: 4-6 hours

**Risk Level**: Low (well-defined changes, existing patterns)

**Dependencies**: None (all changes are additive)
