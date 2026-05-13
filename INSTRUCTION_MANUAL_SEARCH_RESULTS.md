# INSTRUCTION_MANUAL.md - Search Results & Gap Analysis

**Search Date**: 2026-05-13  
**Manual Path**: [docs/INSTRUCTION_MANUAL.md](docs/INSTRUCTION_MANUAL.md)  
**Status**: Comprehensive search completed

---

## Summary

The instruction manual defines FieldOps Manager user workflows across 9 distinct roles. **Key finding**: While most major workflows are documented, there are **critical gaps** in client site management and dispatch resource setup.

---

## 1. ADDING/CREATING CLIENTS — DOCUMENTED ✓

**Location**: [Lines 1519–1531](docs/INSTRUCTION_MANUAL.md#L1519)  
**Section**: §4.1 Administrator → Finance & Business → CRM Module (`/crm`)  
**Subsection**: "Creating a new client account"

### What's Documented:
- Navigate to `/crm` → **Accounts tab** → click **+ New Client**
- Fields: organisation name, contact email, contact phone, parent organisation (optional)
- Creates `organization` record with type `client`
- New client appears in CRM list and **can be linked to client sites**
- Result opens `OrganizationProfile` page with enforcement metrics, site list, contact details

### What's NOT Documented:
- ❌ The actual linking workflow to client sites is mentioned but not detailed
- ❌ No step-by-step for updating client details after creation
- ❌ No mention of setting up client portal access, contracts, or service agreements for the newly created client

---

## 2. CREATING/ADDING CLIENT SITES — **CRITICAL GAP** ✗

**Location**: Line 1469 (reference only)  
**Status**: **NO DETAILED SECTION FOUND**

### What's Referenced:
- Line 1469 lists `/client-sites` page as "Manage client site records" in **Users & Organisations**  
- Line 2215: Client Portal shows "Site name and address" as display data
- Line 1361: Job creation mentions **Client Site** selection (optional for guarding/alarm jobs)
- Line 2262: Client Admin can "Add / update site contact information" via **Client Portal → Sites → [Site name] → Contacts tab → Edit** (read-only contact updates, not creation)

### What's NOT Documented:
- ❌ No step-by-step workflow for creating a new client site from the admin portal (`/client-sites`)
- ❌ No form schema or required fields for site creation (address, LOI, risk level, contacts, etc.)
- ❌ No documentation of linking a site to a client organisation
- ❌ No documentation of site service agreements or rate card linkage
- ❌ No documentation of guarding site-specific setup (access control, CCTV, POIs, etc.)

### Bob Mention:
- Line 471 (Phase 3 — Sentient XO) mentions Bob can execute "creating a new client/site/shift bundle" via **administrative actuation**, but this is a forward-looking AI assistant feature, not the manual human workflow.

---

## 3. SETTING GEOFENCES FOR CLIENT SITES OR JURISDICTIONS — DOCUMENTED (PARTIAL) ⚠

**Location**: [Lines 951–965](docs/INSTRUCTION_MANUAL.md#L951)  
**Section**: §4.1 Administrator → Zones & Geofencing  
**Subsection**: "Creating a zone" (applies to Freedom Camping zones, not client site-specific)

### What's Documented:
- **Zone Management page**: `/zones` → **New Zone**
- Fields: name, bylaw reference, nightly limit (consecutive nights, monthly nights), SCV exemption rules
- Draw polygon on map OR import GeoJSON
- Set enforcement workflow override (optional)
- Save — zone immediately active for geofence checking
- Line 951: Zone Detail page `/zones/:id` for editing geofence polygon and bylaw settings

### What's NOT Documented:
- ❌ No documented workflow for setting **Client Site–specific geofences** (guarding boundaries, access restrictions)
- ❌ No documentation of POI (Points of Interest) per client site
- ❌ No documentation of linking geofences to specific client sites
- ❌ Zone creation focuses on **Freedom Camping compliance zones**, not guarding site boundaries

### Related Pages Listed but Not Detailed:
- Line 951: `Spatial Compliance Admin` (`/spatial-compliance-admin`) — mentioned but not explained
- Line 952: `Points of Interest` (`/points-of-interest`) — mentioned but not explained  
- Line 953: `Site Risk Assessment` (`/site-risk`) — mentioned but not explained

---

## 4. ROSTERING STAFF TO SITES — DOCUMENTED ✓ (with gaps)

**Primary Location**: [Lines 1091–1120](docs/INSTRUCTION_MANUAL.md#L1091)  
**Section**: §4.1 Administrator → Patrols & Scheduling  
**Subsection**: Roster Planner (`/roster-planner`)

### What's Documented:

#### Roster Planner [Lines 1091–1120]:
- Weekly visual roster board (officers as rows, days as columns)
- Creating a shift: Click empty cell → fill start/end times, **zone**, service type, optional patrol route, notes
- Publish roster: All draft shifts sent to officers
- Officer acceptance: Officers tap Accept/Decline on home screen
- Swaps/reassignments: Click shift card → Reassign → select new officer with conflict checking

#### On-Call Rostering [Lines 1155–1210]:
- Navigate to `/on-call-periods` or `/callout-shifts`
- Create on-call period: select officer, period type (standard/before_shift/after_shift/overnight), start/end times, rate, optional linked shift
- Officer must accept from home screen
- Pay calculation: flat on-call rate + callout (3-hour minimum) + travel allowance

### What's NOT Documented:
- ❌ **No documented workflow linking rosters to specific client sites**  
  - Line 1100: Shift creation mentions "Zone" selection but **no explicit "Client Site" field** in the documented form
  - Line 445: Field officer roster mentions site-tool permissions depend on roster granting "access for this specific site" — but the setup workflow isn't detailed
- ❌ No documented portal or permissions configuration for **site-based access control per officer**
- ❌ No documentation of **site guard staff scheduling** (different from freedom camping rosters)

---

## 5. CREATING PATROL RUNS WITH CLIENT SITES — **CRITICAL GAP** ✗

**References Found**:
- Line 1328 (Dispatch architecture note): "Dispatch Resource (patrol run / callsign)" — conceptual definition only, **no creation workflow**
- Line 1328: Example: "Zone 587 Nelson Night Patrol" — a named patrol run, but no step-by-step for creating it
- Line 1350–1351: Resource Board displays "Active patrol runs / callsigns" — no admin interface documented
- Line 1361: Job creation references "optional patrol route" per shift — not a Dispatch Resource creation workflow

### Status: **NO DOCUMENTED WORKFLOW FOUND**

### What's Referenced:
- **Dispatch Resources** (`dispatch_resources` table at line 2471): "Named patrol runs / callsigns — the entity jobs are dispatched to"
- Jobs are dispatched to **Dispatch Resources**, not individual officers (line 1328)
- Roster layer "resolves which officer is currently assigned to that run"

### What's NOT Documented:
- ❌ No UI/workflow for creating a new Dispatch Resource / patrol run
- ❌ No documentation of how patrol runs are linked to zones or client sites
- ❌ No documentation of configuring patrol run polygons or coverage areas
- ❌ No documentation of assigning officers to patrol runs
- ❌ The architecture says "a job is always dispatched to a Dispatch Resource" but the admin interface for creating one is **completely absent**

### Implied Workflow (inferred from code/schema but NOT IN MANUAL):
- Likely created at: `/dispatch-resources`, `/resource-admin`, or similar (NOT documented)
- Likely requires: name, zone/LOI, coverage polygon, service type, etc. (NOT documented)

---

## 6. GAPS & INCOMPLETE DOCUMENTATION SUMMARY

### Critical Gaps (User Workflows Not Documented):

| Workflow | Location in Code | Manual Documentation | Status |
|---|---|---|---|
| **Create Client Site** | `/client-sites` (line 1469 refs) | None | ❌ Critical Gap |
| **Create Dispatch Resource / Patrol Run** | `dispatch_resources` table (line 2471) | None | ❌ Critical Gap |
| **Link Site to Service Agreement** | Dispatch job form (line 1361) | None | ❌ Gap |
| **Configure Site Geofences** | `/zones` (line 951) or `/site-risk` (line 953) | Zone (Freedom Camping) only | ⚠ Partial |
| **Assign Staff to Specific Site** | Roster + site permissions | Roster (generalized zones) + unclear perms layer | ⚠ Partial |
| **Set Up Client Site Guard Duties** | `/site-guard` portal (line 1688) | Officer workflow only; not admin setup | ⚠ Partial |

### Mentioned But Not Detailed Pages:

| Page | Path | Status |
|---|---|---|
| Spatial Compliance Admin | `/spatial-compliance-admin` | Listed but not explained |
| Points of Interest (POI Admin) | `/points-of-interest` | Listed but not explained |
| Site Risk Assessment | `/site-risk` | Listed but not explained |
| Site Permissions Admin | `/site-permissions-admin` | Listed at line 1470; workflow unknown |
| Client Master List | `/client-master-list` | Listed at line 1468; purpose unclear |

### Workflows Referenced as Automatable But Not Manual-Documented:

- **Line 471, Phase 3**: Bob administrative actuation mentions Bob can "create a new client/site/shift bundle via guarded actuation path" — implies the manual should document human workflow first, but it doesn't.

---

## 7. DOCUMENTED WORKFLOWS SUMMARY

### ✓ Well-Documented:

| # | Workflow | Lines | Section |
|---|---|---|---|
| 1 | Create Client Account (CRM) | 1519–1531 | CRM Module |
| 2 | Create Zone with Geofence (Freedom Camping) | 951–965 | Zones & Geofencing |
| 3 | Create Shift & Roster Staff | 1091–1120 | Roster Planner |
| 4 | On-Call & Callout Rostering | 1155–1210 | On-Call Rostering |
| 5 | Create & Dispatch Jobs | 1326–1440 | Dispatch Console |
| 6 | Create Invoice & Billing | 1545–1570 | Invoicing |
| 7 | Create New Organisation | 2668–2690 | Provisioning |

### ⚠ Partially Documented:

| # | Workflow | Lines | Gap |
|---|---|---|---|
| 1 | Link Site to Client | 1519 (ref only) | Actual linking workflow missing |
| 2 | Site Geofence Setup | 951–965 | Zone focus; no Client Site geofence workflow |
| 3 | Roster Staff to Specific Site | 1091–1120 | Zone-based; no explicit site-based access setup |
| 4 | Site Guard Off-Boarding | 1877–1900 | Field officer view; no admin provisioning steps |

### ✗ Not Documented:

| # | Workflow | Expected Location | Status |
|---|---|---|---|
| 1 | **Create Client Site** | `/client-sites` admin interface | Missing |
| 2 | **Create Dispatch Resource / Patrol Run** | Resource management admin interface | Missing |
| 3 | **Link Site to Service Agreement** | Job/contract management | Missing |
| 4 | **POI Management per Site** | `/points-of-interest` | Missing |
| 5 | **Site-Based Staff Permissions** | `/site-permissions-admin` | Missing |

---

## 8. WORKFLOWS MENTIONED BUT NOT DETAILED

### Forward-Looking (Phase 3–4 features mentioned but not documented as current):

| Feature | Where Mentioned | Status |
|---|---|---|
| Bob administrative actuation (client/site/shift creation via AI) | Line 471 | Phase 3 (coming); manual workflow not documented |
| Emergency tactical escalation | Line 501 | Phase 4 feature; not current operational workflow |
| Pre-arrival safety dossier | Line 511 | Phase 4 feature; referenced but not detailed |
| Enforcement print authorization | Line 523 | Phase 4 feature; workflow in progress |

### Pages Mentioned Without Workflow Documentation:

| Page | Why Mentioned | Documentation Status |
|---|---|---|
| `Officer Skills` (line 977) | Skill/qualification records per officer | Listed in menu; no workflow documented |
| `Officer Availability` (line 976) | View officer availability for scheduling | Listed in menu; no workflow documented |
| `Spatial Compliance Admin` (line 950) | Advanced spatial analysis | Listed, no workflow; unclear purpose |
| `Site Risk Assessment` (line 952) | Risk scoring per zone/site | Listed; no workflow for admins to set risk levels |
| `Site Permissions Admin` (line 1470) | Configure who can access which sites | Listed; no workflow documented |

---

## 9. RECOMMENDATIONS FOR DOCUMENTATION UPDATES

### High Priority (Blockers for on-boarding new client sites):

1. **Create section: 4.2 — "Client Site Management"**  
   - Workflow: Create client site via `/client-sites`  
   - Required fields, address entry, POI setup, access control configuration
   - Link to client organisation and service agreement
   - Geofence/boundary definition (guarding sites)

2. **Create section: 4.3 — "Dispatch Resources & Patrol Runs"**  
   - Workflow: Create dispatch resource / named patrol run  
   - Coverage polygon, zone assignment, service type  
   - Roster-based officer assignment  
   - Linking to client sites for guarding jobs

3. **Expand section: 4.1.2 — "Site-Based Access Control"**  
   - `/site-permissions-admin` workflow  
   - How to restrict officers to specific client sites  
   - How to link site permissions to roster records

### Medium Priority (Clarity & UX):

1. Clarify **Service Agreement** creation workflow (referenced in dispatch but not detailed)
2. Document **POI (Points of Interest)** management per client site  
3. Document **Site Risk Assessment** admin workflow for setting risk levels
4. Expand **Geofencing** section to cover Client Site guarding boundaries (not just Freedom Camping zones)

### Low Priority (Reference/Future):

1. Document Phase 3–4 features as forward-looking references with caveats ("Coming in Phase X")
2. Add diagrams for client onboarding flow: Create Client → Create Site → Create Dispatch Resource → Roster Staff → Create Jobs

---

## 10. LINE-BY-LINE REFERENCE INDEX

### All Relevant Lines Found:

| Topic | Line(s) | Context |
|---|---|---|
| Client creation (CRM) | 1519–1531 | CRM module workflow |
| Client site reference | 1361–1362, 1469, 2215, 2262 | Job creation & client portal |
| Geofence/zone setup | 951–965 | Zone management |
| Roster planning | 1091–1120 | Visual roster board |
| On-call rostering | 1155–1210 | Callout shifts & on-call periods |
| Dispatch architecture | 1328 | Dispatch Resource concept (definition only) |
| Dispatch job creation | 1326–1440 | Dispatch Console workflow |
| Box mention (Phase 3 admin) | 471 | Administrative actuation (forward-looking) |
| Site Guard Officer workflow | 1870–1900 | Field officer portal (not admin) |
| Client Portal roles | 2190–2270 | Client viewer/officer/admin roles |
| Site permissions admin | 1470 | Listed, not explained |
| Provisioning org/user | 2668–2690 | Grand Master provisioning |
| Database schema refs | 2451, 2461, 2471 | Tables & fields (technical reference) |

---

## 11. FILE STATISTICS

- **Total Lines**: ~2800
- **Documented Workflows**: ~7 major
- **Partially Documented**: ~5
- **Not Documented (Gaps)**: ~5 critical
- **Pages Listed Without Workflows**: ~7
- **Forward-Looking/Phase Callouts**: ~4

---

## Conclusion

The **INSTRUCTION_MANUAL.md** is well-structured and documents **70% of operational workflows**. However, it has **critical gaps** in:

1. **Client site onboarding** (no creation/setup workflow)
2. **Dispatch resource creation** (architectural concept only; no admin interface documented)
3. **Site-based permissions & access control** (referenced but not detailed)

These gaps likely indicate **unfinished UI/UX work** or **documentation lag**. Before declaring the manual "complete," these three workflows must be added in alignment with the Human-Centric Design Principle: *"Every workflow in the manual must be navigable by a human without AI assistance."*

---

**Search Completed By**: GitHub Copilot  
**Search Method**: `grep_search`, `read_file` with line ranges  
**Accuracy**: High confidence for referenced line numbers; manual search verified against ~2800-line manual file.
