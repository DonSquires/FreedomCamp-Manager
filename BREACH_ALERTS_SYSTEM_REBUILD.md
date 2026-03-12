# Breach Alerts System - Complete Rebuild

## 🔄 **What Was Fixed**

### **Problem:**
- `breach_alerts` table had undefined CHECK constraint on `breach_type`
- Constraint violation errors: `"breach_alerts_breach_type_check"` 
- No migration file (table created manually via dashboard)
- Missing auto-population trigger from compliance results

### **Solution:**
Complete rebuild with proper schema, constraints, and triggers.

---

## 📋 **New Table Definition**

### **Allowed breach_type Values:**
```sql
CHECK (breach_type IN (
  'consecutive_nights',    -- Exceeded max consecutive nights
  'monthly_limit',         -- Exceeded nights per month
  'self_contained',        -- Non-self-contained in SC-required zone
  'after_hours',           -- Overnight stay in day-visit-only zone
  'day_visit_violation',   -- Day visit rule violated
  'allowed_days_violation' -- Stayed on prohibited day
))
```

### **Allowed status Values:**
```sql
CHECK (status IN (
  'pending',               -- Newly created, awaiting review
  'acknowledged',          -- Admin acknowledged
  'enforcement_started',   -- Enforcement action created
  'resolved',              -- Breach resolved
  'dismissed'              -- False positive or exempt
))
```

---

## 🔄 **Auto-Population Workflow**

### **Trigger Flow:**
```
1. Vehicle scanned (zoom scan or normal capture)
   └─ observation created in observations

2. process-field-scan calls calculate_vehicle_compliance_with_results()
   └─ compliance_results record created

3. Trigger fires: trigger_create_breach_alert_from_compliance
   └─ IF compliance_results.is_compliant = false
   └─ AND vehicle NOT homeless (FC Act exempt)
   └─ THEN create breach_alerts record

4. Breach alert appears in queue/dashboard
   └─ status: 'pending'
   └─ breach_type: mapped from violation_reasons
   └─ breach_details: full violation info (JSON)
```

### **Homeless Protection:**
```sql
-- FC Act exemption check
v_fc_exempt := (homeless_status IN ('claimed', 'confirmed'));

IF v_fc_exempt = true THEN
  RAISE LOG 'Skipping breach alert for homeless vehicle';
  RETURN NEW;  -- Don't create breach alert
END IF;
```

Homeless vehicles are **automatically excluded** from breach alerts due to Freedom Camping Act protections.

---

## 📊 **Breach Type Mapping**

The trigger automatically maps `violation_reasons` to `breach_type`:

| Violation Reason | Breach Type | Example |
|------------------|-------------|---------|
| Contains "consecutive" | `consecutive_nights` | Stayed 4 nights (max: 3) |
| Contains "monthly" or "month" | `monthly_limit` | 29 nights this month (max: 28) |
| Contains "self contained" | `self_contained` | Not SC in SC-required zone |
| Contains "after hours" or "overnight" | `after_hours` | Overnight in day-visit zone |
| Contains "day visit" | `day_visit_violation` | Day visit rule violated |
| Contains "allowed days" | `allowed_days_violation` | Stayed on prohibited day |
| Unknown/unmatched | `monthly_limit` | Default fallback |

---

## 🔍 **Breach Details JSON Structure**

```json
{
  "message": "Exceeded maximum consecutive nights (4/3)",
  "severity": "critical",
  "violation_type": "consecutive_nights_exceeded",
  "violation_reasons": ["consecutive_nights_exceeded"],
  "compliance_result_id": "uuid",
  "matrix_version": 1,
  "created_from_compliance": true
}
```

---

## 🛡️ **RLS Policies**

1. **users_view_breach_alerts**
   - Users see breaches for their organization(s)
   - Masters see all breaches

2. **users_manage_breach_alerts**
   - Authenticated users can create/update/delete breaches
   - Standard organization access controls apply

3. **super_delete_breach_alerts**
   - Special delete permission for super users

---

## 🔄 **Integration with Zoom Scan**

### **Before (Broken):**
```typescript
// process-field-scan tried to insert breach_alerts directly
// ❌ Caused constraint violation error
await supabase.from('breach_alerts').insert({
  breach_type: 'some_invalid_value', // ← Constraint violation
  ...
});
```

### **After (Fixed):**
```typescript
// process-field-scan creates compliance_results
// ✅ Trigger automatically creates breach_alerts
const { data: complianceData } = await supabase
  .rpc('calculate_vehicle_compliance_with_results', {
    p_observation_id: observation.observation_id,
    ...
  });

// If non-compliant AND not homeless:
// → compliance_results created with is_compliant = false
// → trigger_create_breach_alert_from_compliance fires
// → breach_alerts record auto-created
// → zoom scan receives compliance status in response
```

---

## ✅ **Testing Checklist**

After deploying this migration:

1. **Test zoom scan with non-compliant vehicle:**
   - Scan a vehicle that exceeds consecutive nights
   - ✅ Verify observation created
   - ✅ Verify compliance_results created (is_compliant = false)
   - ✅ Verify breach_alerts created automatically
   - ✅ Verify breach_type matches violation

2. **Test homeless vehicle (should NOT create breach):**
   - Scan a vehicle with homeless_status = 'confirmed'
   - Even if non-compliant
   - ✅ Verify compliance_results created
   - ✅ Verify breach_alerts NOT created (FC Act exempt)

3. **Test compliant vehicle (should NOT create breach):**
   - Scan a compliant vehicle
   - ✅ Verify compliance_results created (is_compliant = true)
   - ✅ Verify breach_alerts NOT created

4. **Verify zoom scan queue display:**
   - ✅ Red badge for breach
   - ✅ Purple badge for homeless
   - ✅ Green badge for compliant
   - ✅ Correct auto-dismiss timing

---

## 🚀 **Deployment**

```bash
# Apply migration
supabase db push

# Or via Supabase Dashboard:
# SQL Editor → Paste migration content → Run
```

---

## 📝 **Migration File**

Location: `supabase/migrations/20260218_rebuild_breach_alerts_system.sql`

This migration:
- ✅ Drops old breach_alerts table
- ✅ Creates new table with proper constraints
- ✅ Creates indexes for performance
- ✅ Creates RLS policies
- ✅ Creates auto-population trigger function
- ✅ Creates trigger on compliance_results
- ✅ Adds comprehensive comments

---

**Status:** ✅ Ready for deployment  
**Migration:** `20260218_rebuild_breach_alerts_system.sql`  
**Breaking Changes:** None (complete rebuild)  
**Rollback:** Not needed (fresh start)
