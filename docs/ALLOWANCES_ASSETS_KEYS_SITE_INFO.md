# Allowances, Assets, Key Management & Site Information System

## Executive Summary

This document describes the comprehensive workforce management enhancements that support:

1. **Allowance Types & Officer Allowances** — Higher duties, meals, uniforms, and custom allowances
2. **Enhanced Officer Skills** — Site clearances, inductions, training levels, driver licences
3. **Asset Management** — Equipment tracking (uniforms, phones, laptops)
4. **Site Information** — SOPs, maps, assignment instructions, access codes
5. **Key Management (Wilsar-style)** — Key custody tracking with full audit trail

---

## 1. Allowances System

### 1.1 Overview

The allowances system provides flexible, user-definable allowance types that organizations can configure without schema changes. This supports:

- **Higher Duties Allowances** — When officers act in a higher role
- **Meal Allowances** — Per-shift meal reimbursement
- **Uniform Allowances** — Uniform purchase/maintenance
- **Travel Allowances** — Extends the existing travel system
- **Custom Allowances** — Organizations define their own

### 1.2 Key Business Rules

| Rule | Description |
|------|-------------|
| **Flexible Types** | Organizations define their own allowance types with custom rates |
| **Rate Types** | Flat, hourly, daily, percentage, per-km, per-unit |
| **Approval Workflow** | Optional approval requirement for certain allowance types |
| **Role Eligibility** | Allowances can be restricted to specific roles |
| **Custom Fields** | JSONB allows adding custom data without schema changes |

### 1.3 Database Schema

```
allowance_types                    officer_allowances
       │                                  │
       │ defines                          │ assigned to
       ▼                                  ▼
┌─────────────┐                   ┌─────────────┐
│ id          │◄──────────────────│ allowance_  │
│ org_id      │                   │ type_id     │
│ code        │                   │ officer_id  │
│ name        │                   │ effective_  │
│ category    │                   │ date        │
│ rate_type   │                   │ rate        │
│ default_rate│                   │ quantity    │
│ is_taxable  │                   │ total_amount│
│ requires_   │                   │ status      │
│ approval    │                   │ approved_by │
│ custom_fields│                  │ custom_data │
└─────────────┘                   └─────────────┘
```

### 1.4 Allowance Categories

| Category | Description | Example |
|----------|-------------|---------|
| `higher_duties` | Acting in a higher role | Supervisor allowance |
| `meal` | Meal reimbursement | Overtime meal |
| `uniform` | Uniform costs | Boot allowance |
| `travel` | Travel costs | Mileage |
| `on_call` | On-call availability | Weekend on-call |
| `tool` | Tool/equipment | Equipment allowance |
| `first_aid` | First aid officer | First aid allowance |
| `training` | Training | Training allowance |
| `remote` | Remote/isolated | Remote area allowance |
| `hazard` | Hazardous duty | Hazard pay |
| `shift` | Shift loading | Night shift loading |
| `general` | Miscellaneous | Varies |
| `custom` | User-defined | Varies |

### 1.5 Usage Examples

#### Creating a Higher Duties Allowance Type

```sql
INSERT INTO allowance_types (
  organization_id, code, name, category, 
  rate_type, default_rate, requires_approval
)
VALUES (
  'org-uuid', 'HD-SUP', 'Supervisor Higher Duties',
  'higher_duties', 'hourly', 5.50, true
);
```

#### Assigning Higher Duties to an Officer

```sql
INSERT INTO officer_allowances (
  organization_id, officer_id, allowance_type_id,
  effective_date, rate, rate_type, quantity,
  acting_role, substantive_role, roster_shift_id
)
VALUES (
  'org-uuid', 'officer-uuid', 'allowance-type-uuid',
  '2026-05-12', 5.50, 'hourly', 8,  -- 8 hours
  'Supervisor', 'Officer', 'shift-uuid'
);
```

---

## 2. Enhanced Officer Skills

### 2.1 New Skill Categories

The existing `officer_skills` table has been enhanced with additional categories:

| Category | Description | Example |
|----------|-------------|---------|
| `site_clearance` | Site-specific access clearance | Airport security clearance |
| `site_induction` | Completed site induction | Hospital induction |
| `noise_warrant` | Noise control warrant holder | NZ RMA noise warrant |
| `driver_licence` | Driver licence with classes | Class 2 Heavy Rigid |
| `training_level` | Training/competency level | Team Leader Level 2 |
| `first_aid` | First aid qualifications | First Aid Level 2 |
| `security_licence` | Security-specific licences | CoA, PSL |

### 2.2 New Skill Columns

| Column | Type | Description |
|--------|------|-------------|
| `site_id` | UUID | Links skill to specific site (for clearances/inductions) |
| `skill_level` | TEXT | beginner, intermediate, advanced, expert, trainer |
| `endorsements` | TEXT[] | Driver licence endorsements (e.g., P, V, I, O, D, F, R, T, W) |
| `licence_class` | TEXT | Driver licence class (1, 2, 3, 4, 5, 6) |
| `renewal_reminder_date` | DATE | When to remind about renewal |

### 2.3 Example: Site Clearance

```sql
INSERT INTO officer_skills (
  officer_id, organization_id, skill_name, skill_category,
  site_id, certification_number, expires_at, is_verified
)
VALUES (
  'officer-uuid', 'org-uuid', 'Auckland Airport Clearance',
  'site_clearance', 'site-uuid', 'AC-12345',
  '2027-05-12', true
);
```

### 2.4 Example: Driver Licence

```sql
INSERT INTO officer_skills (
  officer_id, organization_id, skill_name, skill_category,
  licence_class, endorsements, certification_number, expires_at
)
VALUES (
  'officer-uuid', 'org-uuid', 'Full NZ Driver Licence',
  'driver_licence', '2', ARRAY['P', 'V'], 'DL12345678',
  '2028-01-15'
);
```

---

## 3. Asset Management System

### 3.1 Overview

Track equipment and assets assigned to officers:

- **Uniforms** — Shirts, pants, jackets, boots
- **Communication** — Phones, radios
- **Computing** — Laptops, tablets
- **PPE** — Hard hats, vests, safety gear
- **Access** — ID cards, fobs
- **Vehicles** — Company vehicles

### 3.2 Database Schema

```
asset_types                       officer_assets
       │                                 │
       │ defines                         │ assigned to
       ▼                                 ▼
┌─────────────┐                  ┌─────────────┐
│ id          │◄─────────────────│ asset_type_id│
│ org_id      │                  │ officer_id  │
│ code        │                  │ serial_number│
│ name        │                  │ asset_tag   │
│ category    │                  │ condition   │
│ requires_   │                  │ issued_date │
│ serial      │                  │ returned_date│
│ replacement_│                  │ status      │
│ cost        │                  │ acknowledged│
└─────────────┘                  └─────────────┘
```

### 3.3 Asset Categories

| Category | Description |
|----------|-------------|
| `uniform` | Uniforms, clothing |
| `ppe` | Personal protective equipment |
| `communication` | Phones, radios |
| `computing` | Laptops, tablets |
| `vehicle` | Company vehicles |
| `tool` | Tools, equipment |
| `access` | Access cards, keys |
| `other` | Miscellaneous |

### 3.4 Asset Lifecycle

```
Created → Issued → (Damaged?) → Returned → (Disposed?)
                        │
                        ▼
                     Lost → Report Generated
```

### 3.5 Usage Examples

#### Creating an Asset Type

```sql
INSERT INTO asset_types (
  organization_id, code, name, category,
  requires_serial_number, requires_return, replacement_cost
)
VALUES (
  'org-uuid', 'PHONE-CORP', 'Corporate Phone',
  'communication', true, true, 899.00
);
```

#### Issuing an Asset

```sql
INSERT INTO officer_assets (
  organization_id, officer_id, asset_type_id,
  serial_number, make, model, condition, issued_date, issued_by
)
VALUES (
  'org-uuid', 'officer-uuid', 'asset-type-uuid',
  'IMEI-123456789', 'Samsung', 'Galaxy A54',
  'new', '2026-05-12', 'admin-uuid'
);
```

---

## 4. Site Information System

### 4.1 Overview

Provide officers with comprehensive site information:

- **SOPs** — Standard Operating Procedures
- **Site Maps** — Floor plans, patrol routes
- **Assignment Instructions** — Site-specific duties
- **Emergency Procedures** — Evacuation plans
- **Access Codes** — Alarm codes, gate codes

### 4.2 Site Documents

```
site_documents
┌─────────────────────┐
│ id                  │
│ organization_id     │
│ client_site_id      │
│ document_type       │ ← sop, site_map, assignment, emergency, etc.
│ title               │
│ document_url        │ ← Storage bucket URL
│ content             │ ← Or inline text
│ version             │
│ visibility          │ ← officers, supervisors, admins
│ requires_           │
│ acknowledgement     │
└─────────────────────┘
```

### 4.3 Document Types

| Type | Description |
|------|-------------|
| `sop` | Standard Operating Procedure |
| `site_map` | Site map/floor plan |
| `assignment` | Assignment instructions |
| `emergency` | Emergency procedures |
| `contact_list` | Contact information |
| `hazard_info` | Hazard information |
| `patrol_route` | Patrol route map |
| `access_info` | Access instructions |
| `training` | Training material |

### 4.4 Site Access Codes (Sensitive)

```
site_access_codes
┌─────────────────────┐
│ id                  │
│ client_site_id      │
│ code_type           │ ← alarm, gate, door, safe, wifi, key_box
│ name                │
│ code_value          │ ← The actual code (encrypted at rest)
│ visibility          │ ← officers, supervisors, admins
│ last_accessed_at    │ ← Audit when accessed
│ access_count        │ ← How many times accessed
└─────────────────────┘
```

### 4.5 Code Types

| Type | Description |
|------|-------------|
| `alarm` | Alarm system code |
| `gate` | Gate access PIN |
| `door` | Door lock code |
| `safe` | Safe combination |
| `wifi` | WiFi password |
| `key_box` | Key lock box code |
| `elevator` | Elevator key/code |

### 4.6 Example: Adding Site SOP

```sql
INSERT INTO site_documents (
  organization_id, client_site_id, document_type,
  title, content, visibility
)
VALUES (
  'org-uuid', 'site-uuid', 'sop',
  'Night Patrol Procedure', 
  '1. Check in at reception\n2. Collect keys from lock box\n3. Complete perimeter check...',
  'officers'
);
```

---

## 5. Key Management System (Wilsar-Style)

### 5.1 Overview

A comprehensive key custody tracking system similar to Wilsar:

- **Key Sets** — Groups of keys (bunches)
- **Individual Keys** — Each key with description
- **Custody Tracking** — Check-out/return with signatures
- **Full Audit Trail** — Every action logged

### 5.2 Database Schema

```
key_sets                    keys                      key_custody
       │                       │                            │
       │ contains              │ belongs to                 │ tracks
       ▼                       ▼                            ▼
┌─────────────┐         ┌─────────────┐            ┌─────────────┐
│ id          │◄────────│ key_set_id  │            │ key_set_id  │
│ org_id      │         │ key_number  │            │ officer_id  │
│ site_id     │         │ name        │            │ checked_out_│
│ name        │         │ key_type    │            │ at          │
│ cabinet_no  │         │ opens_      │            │ returned_at │
│ hook_no     │         │ description │            │ status      │
│ status      │         └─────────────┘            │ signature   │
│ holder_id   │                                    └─────────────┘
└─────────────┘                                           │
       │                                                  │
       └──────────────────────────────────────────────────┤
                                                          ▼
                                               ┌───────────────────┐
                                               │  key_audit_log    │
                                               │ action, details,  │
                                               │ performed_by,     │
                                               │ performed_at      │
                                               └───────────────────┘
```

### 5.3 Key Set Workflow

```
Available → Checked Out → Returned → Available
     │            │           │
     │            └───────────┤→ Overdue
     │                        │
     └────────────────────────┴→ Lost/Missing
```

### 5.4 Helper Functions

#### Check Out Keys

```sql
SELECT checkout_key_set(
  'key-set-uuid'::UUID,          -- Key set to checkout
  'officer-uuid'::UUID,          -- Officer receiving keys
  'Night patrol duty',           -- Purpose
  'Building A',                  -- Location
  now() + interval '8 hours'     -- Expected return
);
```

#### Return Keys

```sql
SELECT return_key_set(
  'key-set-uuid'::UUID,          -- Key set being returned
  'good',                        -- Condition: good, damaged, keys_missing, partial
  'All keys present'             -- Notes
);
```

### 5.5 Key Types

| Type | Description |
|------|-------------|
| `standard` | Regular cut key |
| `master` | Master key (opens multiple locks) |
| `sub_master` | Sub-master key |
| `fob` | Electronic fob |
| `card` | Access card |
| `combination` | Combination lock |
| `biometric` | Biometric access |

### 5.6 Example: Setting Up Keys

```sql
-- Create key set
INSERT INTO key_sets (
  organization_id, client_site_id, name,
  storage_location, cabinet_number, hook_number
)
VALUES (
  'org-uuid', 'site-uuid', 'Building A Master Keys',
  'Main Office Key Cabinet', 'CAB-1', 'H-12'
)
RETURNING id;

-- Add individual keys to the set
INSERT INTO keys (key_set_id, organization_id, key_number, name, opens_description)
VALUES 
  ('key-set-uuid', 'org-uuid', '1', 'Front Door', 'Main entrance'),
  ('key-set-uuid', 'org-uuid', '2', 'Back Door', 'Rear emergency exit'),
  ('key-set-uuid', 'org-uuid', '3', 'Office Suite', 'All offices on Level 2');
```

### 5.7 Audit Log Actions

| Action | Description |
|--------|-------------|
| `created` | Key set created |
| `updated` | Key set updated |
| `deleted` | Key set deleted |
| `checked_out` | Keys checked out |
| `returned` | Keys returned |
| `marked_lost` | Keys marked as lost |
| `marked_found` | Lost keys found |
| `transferred` | Keys transferred between officers |
| `inventory_check` | Physical inventory check |
| `key_added` | Key added to set |
| `key_removed` | Key removed from set |

---

## 6. Views and Queries

### 6.1 Keys Currently Checked Out

```sql
SELECT * FROM v_keys_checked_out
WHERE return_status = 'overdue';
```

### 6.2 Officer Assets Summary

```sql
SELECT * FROM v_officer_assets_summary
WHERE officer_id = 'officer-uuid';
```

### 6.3 Officer Allowances Summary

```sql
SELECT * FROM v_officer_allowances_summary
WHERE organization_id = 'org-uuid'
  AND allowance_category = 'higher_duties';
```

---

## 7. Integration with Rostering

### 7.1 Automatic Allowance Application

Allowances can be automatically applied based on roster rules:

- When officer is assigned to a site requiring certain clearances
- When shift is overnight (shift loading)
- When officer acts as supervisor (higher duties)

### 7.2 Skills Matching

Skills can be matched to shift requirements:

```sql
-- Find officers with required skills for a shift
SELECT up.id, up.first_name, up.last_name
FROM user_profiles up
WHERE EXISTS (
  SELECT 1 FROM officer_skills os
  WHERE os.officer_id = up.id
    AND os.skill_name = ANY(ARRAY['First Aid Level 2', 'CCTV Operator'])
    AND (os.expires_at IS NULL OR os.expires_at > CURRENT_DATE)
    AND os.is_verified = true
);
```

---

## 8. Security Considerations

### 8.1 Access Codes

- Access codes are encrypted at rest by Supabase
- Access is logged with timestamp and user
- Visibility can be restricted to supervisors/admins only
- Regular rotation reminders can be set

### 8.2 Key Management

- Full audit trail of all key movements
- Signature capture for checkout/return
- Overdue alerts for unreturned keys
- Lost key reporting with incident tracking

### 8.3 Asset Tracking

- Serial numbers required for high-value items
- Acknowledgement required for asset receipt
- Condition documented on return
- Depreciation tracking for asset value

---

## 9. API Examples

### 9.1 Frontend Integration (React Query)

```typescript
// Fetch officer's current keys
const { data: checkedOutKeys } = useQuery({
  queryKey: ['keys', 'checked-out', officerId],
  queryFn: async () => {
    const { data } = await supabase
      .from('v_keys_checked_out')
      .select('*')
      .eq('officer_id', officerId)
    return data
  }
})

// Fetch site documents for officer
const { data: siteDocs } = useQuery({
  queryKey: ['site-documents', siteId],
  queryFn: async () => {
    const { data } = await supabase
      .from('site_documents')
      .select('*')
      .eq('client_site_id', siteId)
      .eq('is_active', true)
      .order('document_type')
    return data
  }
})
```

### 9.2 Checkout Keys (RPC)

```typescript
const checkoutKeys = async (keySetId: string, purpose: string) => {
  const { data, error } = await supabase.rpc('checkout_key_set', {
    p_key_set_id: keySetId,
    p_officer_id: currentUserId,
    p_purpose: purpose,
    p_expected_return: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
  })
  
  if (error) throw error
  return data // Returns custody record ID
}
```

---

## 10. Migration Summary

| Table | Purpose |
|-------|---------|
| `allowance_types` | User-definable allowance types |
| `officer_allowances` | Allowances assigned to officers |
| `asset_types` | Equipment type definitions |
| `officer_assets` | Equipment assigned to officers |
| `site_documents` | SOPs, maps, instructions |
| `site_access_codes` | Sensitive access codes |
| `key_sets` | Key bunches/groups |
| `keys` | Individual keys |
| `key_custody` | Check-out/return tracking |
| `key_audit_log` | Full audit trail |

Enhanced tables:
- `officer_skills` — Added site_id, skill_level, endorsements, licence_class

Helper functions:
- `checkout_key_set()` — Check out keys to officer
- `return_key_set()` — Return keys
- `log_site_access_code_access()` — Log access to sensitive codes

Views:
- `v_keys_checked_out` — Currently checked out keys
- `v_officer_assets_summary` — Assets by officer
- `v_officer_allowances_summary` — Allowances by officer
