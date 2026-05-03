# FieldOps Manager — Instruction Manual

**Platform**: Iron Eagle Security / OnSpace AI — Field Operations Management  
**Version**: 2026 (multi-organisation edition)  
**Timezone**: All dates and times operate in **NZ Standard / Daylight Time (Pacific/Auckland)**

> **Living document** — this manual is updated automatically when source files change.  
> See [`.github/workflows/docs-update-instruction-manual.yml`](../.github/workflows/docs-update-instruction-manual.yml) for the update trigger rules.  
> Last reviewed: 2026-05-03

---

## Table of Contents

1. [Introduction & Overview](#1-introduction--overview)
2. [Getting Started — Login & Navigation](#2-getting-started--login--navigation)
3. [PART A — Owner](#part-a--owner)
   - [3.1 Grand Master](#31-grand-master)
   - [3.2 Master](#32-master)
4. [PART B — Service Provider](#part-b--service-provider)
   - [4.1 Administrator](#41-administrator)
   - [4.2 Admin Officer (Dual Role)](#42-admin-officer-dual-role)
   - [4.3 NZSCV Monitor](#43-nzscv-monitor)
5. [PART C — Field Roles (Officer Portals)](#part-c--field-roles-officer-portals)
   - [5.1 Field Officer — Freedom Camping Patrol](#51-field-officer--freedom-camping-patrol)
   - [5.2 Site Guard Officer](#52-site-guard-officer)
   - [5.3 Parking Enforcement Officer](#53-parking-enforcement-officer)
   - [5.4 Noise Control Officer](#54-noise-control-officer)
   - [5.5 Biosecurity Inspection Officer](#55-biosecurity-inspection-officer)
   - [5.6 Smoke Complaint Officer (OOH)](#56-smoke-complaint-officer-ooh)
   - [5.7 EMS Officer](#57-ems-officer)
6. [PART D — Client Organisation](#part-d--client-organisation)
   - [6.1 Client Viewer](#61-client-viewer)
   - [6.2 Client Officer](#62-client-officer)
   - [6.3 Client Admin](#63-client-admin)
7. [PART E — Technical Reference (Systems Administrator)](#part-e--technical-reference-systems-administrator)
   - [7.1 Architecture Overview](#71-architecture-overview)
   - [7.2 Environment Setup](#72-environment-setup)
   - [7.3 Database & Migrations](#73-database--migrations)
   - [7.4 Edge Functions](#74-edge-functions)
   - [7.5 AI Services (Bob / Inference)](#75-ai-services-bob--inference)
   - [7.6 PTT / Push-to-Talk](#76-ptt--push-to-talk)
   - [7.7 System Diagnostics & Health](#77-system-diagnostics--health)
   - [7.8 User & Organisation Provisioning](#78-user--organisation-provisioning)
   - [7.9 Data Integrity & Cleanup](#79-data-integrity--cleanup)
   - [7.10 Security & Compliance Notes](#710-security--compliance-notes)
8. [Appendix A — Enforcement Document Quick Reference](#appendix-a--enforcement-document-quick-reference)
9. [Appendix B — Role Access Matrix](#appendix-b--role-access-matrix)
10. [Appendix C — Common Troubleshooting](#appendix-c--common-troubleshooting)

---

## 1. Introduction & Overview

**FieldOps Manager** is a web-based operational command centre for freedom camping and multi-service field enforcement in New Zealand, operated by Iron Eagle Security / OnSpace AI. It consolidates:

- Live patrol monitoring and GPS tracking
- Automatic License Plate Recognition (ALPR) and vehicle compliance
- Breach detection, infringement notices, and enforcement workflows
- Zone geofencing and bylaw management
- Officer welfare, rosters, and shift management
- Multi-organisation (council, security company, client) access control
- Noise, parking, biosecurity, and smoke-complaint specialist modules
- Push-to-Talk (PTT) radio communication
- AI-assisted assessment via **Bob** (biosecurity, noise, smoke, triage)
- CRM, invoicing, reporting, and audit logging

The platform uses a **role-based access control (RBAC)** model with nine distinct roles organised across three tenancy tiers:

| Tier | Roles |
|---|---|
| **Owner** | `grand_master`, `master` |
| **Service Provider** | `admin`, `admin_officer`, `nzscv_monitor` |
| **Client Organisation** | `client_admin`, `client_officer`, `client_viewer` |
| **Field** | `officer` (auto-routed per service type) |

---

## 2. Getting Started — Login & Navigation

### 2.1 Signing In

1. Open the application URL in any modern browser (Chrome, Edge, or Safari recommended).
2. You will see the **FieldOps Manager** login screen branded with the Iron Eagle Security logo.
3. Enter your **assigned email address** and **password**.
4. Click **Sign In**. The system requests fullscreen automatically on supported browsers for an optimised field experience.

> **First-time users**: If your account was created by an administrator, you will receive an invitation email with a link. Click the link and you will be placed directly into **Create Your Password** mode. Enter a password of at least 8 characters and confirm it.

> **Forgot password?**: Enter your email on the login form and click **Forgot password?** — a reset link will be sent to your inbox. After clicking the link, set your new password.

### 2.2 Session Lock & Inactivity

The platform automatically locks your session after a period of inactivity. You will see a lock screen requiring you to re-enter your password. Your data and open tabs are preserved — you do not need to log out and back in.

### 2.3 Portal Selection (Admin Officer role only)

If your account carries the `admin_officer` (dual) role, you will be presented with the **Portal Selection** screen after login. Choose the workspace that matches your current shift:

| Portal | Purpose |
|---|---|
| Admin Portal | Compliance, enforcement, reports, operations management |
| Field Officer | Live patrol scanning, breach detection |
| Site Guard | Site security, checkpoints, POI, face recognition |
| Parking Enforcement | Chalk pass, permit checks, notices |
| Noise Control | RMA assessments and notices |
| EMS | Electronic Monitoring device management |
| Client Organisation Portal | Read-only view for contracted clients |

If you have a **rostered shift**, it is displayed at the top of the selector with a **Go to Shift** shortcut that routes you directly to the correct portal and site.

### 2.4 Navigation Overview

#### Finding your way around

Every portal has the same layout skeleton:

| Element | Location | Purpose |
|---|---|---|
| **Sidebar** | Left edge (desktop) / hamburger menu (mobile) | All modules available to your role. Expand/collapse with the chevron at the top. |
| **Top bar** | Across the top | Organisation selector, universal search (🔍), notifications bell, your profile avatar, settings cog |
| **Global Filter Ribbon** | Below the top bar on admin pages | Date-range picker and organisation filter — applies to all compliance and reporting screens on the current tab |
| **Bob AI Button** | Floating bottom-right | Opens the Bob AI assistant panel. Available on all pages for admin roles. |
| **PTT Bar** | Bottom of screen (officer portals) | Push-to-talk transmit button and channel indicator |
| **Field Safety Bar** | Top of screen (officer portals) | Welfare check-in status, man-down detection indicator, emergency button |

#### How to navigate to any module

1. **From the Sidebar**: Click the relevant group heading to expand it, then click the module name. The current page is highlighted.
2. **From the universal search**: Click the 🔍 icon in the top bar (or press `/`). Type a module name, vehicle plate, person name, or zone. Results include direct links to pages and records.
3. **From the Admin Hub** (`/admin`): Admins land here after login. Each card on the hub links directly to a major module. Click **→** on any card to open it.
4. **From breadcrumb links**: Detail pages (vehicle, zone, breach) have breadcrumbs at the top — click a breadcrumb to navigate back without losing your filter state.
5. **Direct URL**: Every page has a stable URL. Bookmark frequently used pages.

#### Using the Global Filter Ribbon

The Global Filter Ribbon appears at the top of all admin compliance and reporting screens. Changes here apply to **all currently open tabs** in the admin area.

1. Click the **date range** field — a calendar picker opens. Select a start and end date.
2. Click the **organisation** dropdown if you have access to multiple organisations — select the one you want to filter to, or choose **All** to see everything your role permits.
3. The page refreshes automatically. A blue indicator shows when a non-default filter is active.
4. Click **Reset** (×) to return to the default (today, all accessible orgs).

---

## PART A — Owner

### 3.1 Grand Master

**Role code**: `grand_master`  
**Access**: Unrestricted — bypasses all role and area restrictions across all organisations.  
**Landing page**: `/platform` (the Platform overview)

The Grand Master is the platform operator (OnSpace AI). This role has a dedicated landing page at `/platform` and access to all features, all organisations, and all data.

#### How to reach the Platform page

After login, the Grand Master lands automatically on `/platform`. From any other page, click **Platform** in the sidebar (top of the navigation, marked with a globe icon).

#### Platform Overview (`/platform`)

The Platform page is a cross-organisation executive dashboard. When you first open it you will see:

1. **Stats bar** — four headline tiles across the top: Total organisations, Total users, Scans in period, and Active breaches.
2. **Tabs** — switch between: Overview · Organisations · System · Feedback & Bugs
3. **Period picker** — adjust the reporting period using the date range in the top-right of the stats bar.

**Overview tab:**
- Cross-organisation compliance summary — breach totals, notice count, infringement count, open disputes
- Per-organisation usage table showing officer count, scan count, breach count, notice count

**Organisations tab:**
- Full list of all organisations on the platform with type, level, active status, officer count, and usage metrics
- Click any row to open the organisation's profile

**System tab:**
- Live system health indicator (Supabase connectivity, inference service, PTT service, proxy server)
- Click **Run Diagnostics** to execute a full health check — this calls the `check-services-health` edge function and displays results per service

**Feedback & Bugs tab:**
- All bug reports and feedback submitted across the platform grouped by severity
- Click **Analyse** on any report to run a Bob AI analysis — the report status updates to `analysed` and AI findings are displayed inline
- Click **Acknowledge** or **Resolve** to update the report lifecycle

#### Exclusive Grand Master Modules

To access any of these from the sidebar:

| Module | Sidebar location | Path |
|---|---|---|
| **Grandmaster Code Studio** | Owner Tools → Code Studio | `/grandmaster-code-studio` |
| **Compliance Escalations** | Compliance → Escalations | `/compliance-escalations` |
| **Bob Assistant Studio** | AI & Intelligence → Bob Studio | `/bob-studio` |
| **Bob Intake Queue** | AI & Intelligence → Intake Queue | `/bob-intake` |
| **Ops Live Plan Review** | AI & Intelligence → Plan Reviews | `/ops-live-plan-review` |
| **Intel Approval Queue** | AI & Intelligence → Intel Approvals | `/intel-approval` |
| **Organisation Management** | Owner Tools → Organisations | `/organizations` |
| **System Diagnostics** | Owner Tools → Diagnostics | `/diagnostics` |

#### Managing Organisations

**To navigate to Organisation Management:**  
Sidebar → Owner Tools → **Organisations** (or go directly to `/organizations`).

The list shows all organisations with type, level, status, and enforcement workflow.

**To create a new organisation:**
1. Click **New Organisation** in the top-right.
2. Fill in name, type (`owner` / `service_provider` / `client` / `contractor`), enforcement workflow, overnight verification mode, and contact details.
3. Set `parent_organization_id` to place it in the hierarchy.
4. Click **Save** — the organisation is created and immediately visible in the list.
5. Navigate to **User Management** (`/users`) to create the first admin user for the new organisation.

**Enforcement Workflow modes:**

| Mode | Description |
|---|---|
| `admin_first` | Admin reviews and approves breach records before officers issue notices |
| `officer_direct` | Officers can issue notices directly in the field without admin approval |
| `hybrid` | Both modes are available; officers choose based on situation |

**Overnight Verification modes:**

| Mode | Description |
|---|---|
| `two_photo_verification` | Two photos per vehicle required to confirm overnight stay |
| `one_photo_per_day_inference` | Single photo per day; AI infers overnight presence |

#### Bob Assistant Studio (`/bob-studio`)

**To navigate:** Sidebar → AI & Intelligence → **Bob Studio**.

1. Select the Bob **capability module** to configure (chat, assess, triage, noise, biosecurity, smoke).
2. Adjust the system prompt, temperature, and context window settings.
3. Use the **Test** panel on the right to send a sample input and review the output live.
4. Click **Save Configuration** — changes take effect immediately for all new Bob sessions.

---

### 3.2 Master

**Role code**: `master`  
**Access**: All modules within their organisation and all child organisations.  
**Landing page**: `/admin` (Admin Hub)

The Master role is typically the operations director or senior manager of the security company. They see every admin module and additionally have exclusive access to organisation management, system diagnostics, pricing, and the full tender workspace.

#### How to navigate as Master

After login you land on the **Admin Hub** (`/admin`). The hub is a card grid — each card represents a major module. Click any card to open that area. The sidebar on the left lists all available modules grouped by category.

Modules exclusive to Master (not available to standard `admin`):

| Module | How to navigate | Path |
|---|---|---|
| **Organisation Management** | Sidebar → Owner Tools → Organisations | `/organizations` |
| **System Diagnostics** | Sidebar → Owner Tools → Diagnostics | `/diagnostics` |
| **Pricing Page** | Sidebar → Finance → Pricing | `/pricing` |
| **Tender Workspace** | Sidebar → Business → Tenders | `/tenders` |
| **Intel Approval Queue** | Sidebar → AI & Intelligence → Intel Approvals | `/intel-approval` |
| **Service Provider Access Settings** | Sidebar → Access → Service Provider Access | `/admin/service-provider-access` |

#### Key Master Workflows

**Viewing all child organisations:**
1. Open the **Organisation Management** page (`/organizations`).
2. The tree view shows your organisation and all child orgs with their status, user counts, and recent activity.
3. Click any child org row to switch context — the Global Filter Ribbon at the top updates to scope all data to that org.
4. To return to your own org, click the organisation selector in the top bar and choose your org.

**Approving intelligence reports:**
1. Navigate to Sidebar → AI & Intelligence → **Intel Approval Queue** (`/intel-approval`).
2. AI-generated intelligence reports submitted by officers or Bob are listed with status `pending_review`.
3. Click a report to review it. You can **Approve** (publishes to the compliance dashboard), **Reject with Note** (returns to the submitter), or **Escalate** (flags for Grand Master review).

All other admin workflows for Master are identical to the Administrator role — see [§4.1 Administrator](#41-administrator) for the full details.

---

## PART B — Service Provider

### 4.1 Administrator

**Role code**: `admin`  
**Access**: Full admin portal for their assigned organisation.  
**Landing page**: `/admin` → **Admin Hub**

#### Admin Hub (`/admin`)

After login, the Admin Hub is your home screen. It is a card-based dashboard with live metrics.

**Reading the dashboard:**
- The top row of KPI tiles shows: **Total Scans Today**, **Active Breaches**, **Patrols Running**, and **Officer Welfare Alerts** — all live and scoped to your current organisation and date filter.
- The **Compliance Trend Chart** below shows daily scan-vs-breach ratio over the selected date range. Hover over a data point to see the day's exact figures.
- The **SCV Enforcement Countdown** shows days remaining until the mandatory SCV certificate check date.
- Quick-navigation cards for each major module are below — click any card's **→** arrow to open that section.

**Changing the date range or organisation:**  
Use the **Global Filter Ribbon** at the top of the page. Click the date field to open the calendar picker. Click the organisation dropdown to switch between orgs you have access to.

---

##### Operations Centre (`/admin/dashboard`)

**How to navigate:** Sidebar → Dashboard → **Operations Centre**, or click the Admin Hub card for "Operations".

The full operational dashboard. Contains:
- **KPI tiles**: Total scans today, active breaches, patrols running, officer welfare alerts
- **Compliance Trend Chart**: Daily scan-vs-breach ratio over the selected date range
- **SCV Enforcement Countdown**: Days remaining until the mandatory SCV certificate date
- **Quick navigation tiles**: Jump to any major module

---

##### Compliance & Enforcement

**How to navigate to this section:** Sidebar → **Compliance** group. Each sub-item takes you directly to the relevant page.

| Page | Path | How to navigate |
|---|---|---|
| Compliance Dashboard | `/admin/compliance` | Sidebar → Compliance → Dashboard |
| Compliance Analytics | `/admin/compliance-analytics` | Sidebar → Compliance → Analytics |
| Breach Alerts | `/breaches` | Sidebar → Compliance → Breach Alerts |
| Breach Notices | `/breach-notices` | Sidebar → Compliance → Breach Notices |
| Infringement Notices | `/infringement-notices` | Sidebar → Compliance → Infringements |
| Notice to Vacate | `/notice-to-vacate` | Sidebar → Compliance → Notice to Vacate |
| Enforcement Actions | `/enforcement-actions` | Sidebar → Compliance → Enforcement Actions |
| Enforcement Command Centre | `/enforcement-command-centre` | Sidebar → Compliance → Command Centre |
| Enforcement Review | `/enforcement-review` | Sidebar → Compliance → Review |
| Disputes | `/disputes` | Sidebar → Compliance → Disputes |
| Compliance Recalculation | `/compliance-recalculation` | Sidebar → Data → Recalculate |
| Compliance Escalations | `/compliance-escalations` | Sidebar → Compliance → Escalations (master/grand_master only) |

---

**Compliance Dashboard (`/admin/compliance`)**

The Compliance Dashboard shows real-time compliance rates by zone.

1. Open the page — a grid of zone cards loads, each showing: zone name, vehicles checked today, breach count, compliance rate (%), and an RAG (red/amber/green) status indicator.
2. Click any zone card to drill into that zone's detail: full breach list, scan history, and trend chart.
3. Use the **Global Filter Ribbon** to change the date range — the dashboard refreshes automatically.
4. Click **Export** to download the zone-by-zone compliance summary as CSV.

---

**Breach Alerts (`/breaches`)**

The active breach queue. Every vehicle that has triggered a breach condition appears here until actioned.

1. Navigate to Sidebar → Compliance → **Breach Alerts**.
2. Each row shows: plate number, vehicle photo thumbnail, zone, breach type, first detected date, current status, and assigned officer.
3. **To take action on a breach:**
   - Click the breach row to open the breach detail panel.
   - Review the scan history, overnight counts, and any prior warnings.
   - Choose an action: **Issue Warning**, **Issue NTV**, **Issue Infringement**, or **Mark Resolved**.
   - The selected action creates the appropriate document and updates the breach status.
4. **Filtering**: Use the filter bar at the top to filter by zone, status (`active`, `pending_review`, `actioned`), or date range.
5. **Bulk action**: Select multiple breach rows using the checkboxes → click **Bulk Action** → choose an action to apply to all selected records.

---

**Infringement Notices (`/infringement-notices`)**

**To issue an Infringement Notice:**
1. Navigate to Sidebar → Compliance → **Infringements** (`/infringement-notices`).
2. Click **+ Issue Notice** in the top-right.
3. Link the notice to a breach record or scan record using the search field.
4. Fill in offence description, legal basis (default: `FCA 2011 s.20`), fine amount ($200 default), service method (hand delivery, post, vehicle), and officer details.
5. Click **Issue Notice** — a unique notice number is generated (format: `INF-YYYYMMDD-XXXX`).
6. Click **Print** for a print-ready HTML document, or **Email** to send directly to the registered address.

**To search existing notices:**
- Use the search bar at the top of the Infringement Notices page to search by plate number, notice number, or address.
- Filter by status: `draft`, `issued`, `paid`, `disputed`, `withdrawn`.
- Click a notice row to open the full notice detail.

---

**Notice to Vacate (`/notice-to-vacate`)**

1. Navigate to Sidebar → Compliance → **Notice to Vacate**.
2. Click **+ New Notice**.
3. Search for the vehicle plate — the form pre-fills with the vehicle's last known zone and officer.
4. Confirm or update: zone, address, legal basis (`FCA 2011 s.32` or council bylaw reference), reason for vacation.
5. Set the **Vacate By** time (default: 7:00 AM next morning for overnight campers).
6. Click **Issue** — the notice is saved and printable immediately.

---

**Enforcement Command Centre (`/enforcement-command-centre`)**

A supervisor overview of all open enforcement actions across the organisation.

1. Navigate to Sidebar → Compliance → **Command Centre**.
2. The page shows four columns: **Pending Review** · **In Progress** · **Escalated** · **Resolved** (kanban-style).
3. Click any card to see the full enforcement record, officer notes, and action history.
4. Drag a card between columns to update the status, or open the record and use the **Update Status** button.
5. The **Escalation filter** at the top lets you isolate records at escalation level 2+ (requiring supervisor sign-off).

---

**Disputes (`/disputes`)**

Manages infringement notices that have been formally disputed.

1. Navigate to Sidebar → Compliance → **Disputes**.
2. The dispute list shows: notice number, plate, dispute received date, grounds, and current status.
3. **To process a dispute:**
   - Click the dispute row to open it.
   - Review the dispute grounds, officer notes, photographic evidence, and original notice.
   - Choose: **Uphold Notice** (dispute rejected, notice stands), **Withdraw Notice** (dispute accepted, notice cancelled), or **Refer for Review** (send to senior officer or council).
   - Add a decision note — this is the official decision record.
   - Click **Save Decision** — the notice and dispute statuses update accordingly.
4. Upheld disputes: the infringement notice remains active. Withdrawn disputes: the notice is marked withdrawn and the fine is zeroed.

---

##### Vehicles & ALPR

**How to navigate:** Sidebar → **Vehicles** group.

| Page | Path | How to navigate |
|---|---|---|
| Vehicle Management | `/vehicles` | Sidebar → Vehicles → All Vehicles |
| Vehicle Registry | `/vehicle-registry` | Sidebar → Vehicles → Registry |
| Vehicle Detail | `/vehicles/:id` | Click any vehicle row in the list |
| Vehicle Discrepancies | `/vehicle-discrepancies` | Sidebar → Vehicles → Discrepancies |
| NZSCV Monitor | `/admin/nzscv` | Sidebar → Vehicles → NZSCV Monitor |
| Canonical Records Manager | `/canonical-records` | Sidebar → Data → Canonical Records |

---

**Vehicle Management (`/vehicles`)**

1. Navigate to Sidebar → Vehicles → **All Vehicles**.
2. The list shows all vehicles known to the system — plate number, make, model, colour, compliance status, last seen zone, and last scan date.
3. **To search for a vehicle**: type a plate number (full or partial) in the search box at the top. Results filter as you type.
4. **To view full history**: click the vehicle row → Vehicle Detail page opens showing:
   - All scans linked to this vehicle with dates, zones, officers, and photo thumbnails
   - Compliance record: nights logged per zone, breach history, issued notices
   - NZSCV SCV certification status (green tick / red cross / unknown)
   - Any person records linked to this vehicle
5. **To add a manual vehicle record**: click **+ Add Vehicle** → enter plate, make, model, colour, and any known details → **Save**.
6. **To flag a vehicle as Vehicle of Interest (VOI)**: from the Vehicle Detail page, click **Flag as VOI** → enter the reason and alert level. Officers will see a VOI warning when this plate is scanned in the field.

---

**NZSCV Monitor (`/admin/nzscv`)**

Monitors the New Zealand Self-Contained Vehicle (SCV) certification database.

1. Navigate to Sidebar → Vehicles → **NZSCV Monitor**.
2. The monitor shows a live list of vehicles in your system with their NZSCV status: `certified`, `expired`, `not_found`, `pending`.
3. The **Enforcement Countdown** tile shows the days remaining until the next mandatory SCV check date — this is set per zone.
4. **To check a specific plate**: enter the plate number in the search bar at the top. The system queries the NZSCV proxy in real time and returns the current certification status.
5. **To refresh all statuses**: click **Bulk Refresh** — this re-queries NZSCV for all vehicles active in your zones within the selected date range. This may take several minutes.
6. Vehicles with expired or missing SCV certification in SCV-required zones are highlighted red.

---

**Vehicle Discrepancies (`/vehicle-discrepancies`)**

Flags inconsistencies in vehicle data — e.g. plate numbers that have been captured with different makes/models, or plates where officer-entered data contradicts NZSCV records.

1. Navigate to Sidebar → Vehicles → **Discrepancies**.
2. Each discrepancy row shows the plate, the conflicting data fields, the source of each value, and a confidence score.
3. **To resolve a discrepancy**: click the row → review the conflicting data → click **Accept Primary** (keep the most-trusted value) or **Merge Manually** to enter a corrected value.
4. Resolved discrepancies are archived and a note is added to the vehicle record.

---

##### Zones & Geofencing

| Page | Path | Purpose |
|---|---|---|
| Zone Management | `/zones` | Create and configure enforcement zones |
| Zone Detail | `/zones/:id` | Edit geofence polygon, bylaw settings, nightly limits |
| Spatial Compliance Admin | `/spatial-compliance-admin` | Advanced spatial analysis and zone compliance overview |
| Points of Interest | `/points-of-interest` | Manage POIs linked to zones |
| Site Risk Assessment | `/site-risk` | Risk scoring per zone/site |
| Hotspots Map | `/hotspots` | Live heatmap of breach concentration |
| Live Map | `/live-map` | Real-time officer and vehicle positions |
| Operations Map | `/operations-map` | Full operational overview map |
| Job Map | `/job-map` | Dispatch jobs overlaid on map |

**Creating a zone:**
1. Go to `/zones` → **New Zone**.
2. Enter name, bylaw reference, nightly limit (consecutive nights, monthly nights), and SCV exemption rules.
3. Draw the polygon on the map (or import GeoJSON).
4. Set the enforcement workflow override (leave blank to inherit from organisation).
5. Save — the zone is immediately active for geofence checking.

---

##### Patrols & Scheduling

| Page | Path | Purpose |
|---|---|---|
| Live Patrol Monitor | `/live-patrol-monitor` | Real-time officer locations and patrol status |
| Live Officer Tracking | `/live-officer-tracking` | Map view of all active officers |
| Patrol Checkpoint Management | `/patrol-checkpoints` | Manage QR checkpoint locations |
| Patrol Schedule Management | `/patrol-schedules` | Set up recurring patrol routes |
| Patrol KPI Dashboard | `/patrol-kpi` | Performance metrics per officer and zone |
| Roster Planner | `/roster-planner` | Build and publish shift rosters |
| Open Shifts | `/open-shifts` | View and fill unfilled shifts |
| Timesheet Review | `/timesheets` | Review and approve officer timesheets |
| Officer Availability | `/officer-availability` | View officer availability for scheduling |
| Officer Skills | `/officer-skills` | Skill and qualification records per officer |

---

###### Patrol Schedule Management (`/patrol-schedules`)

Patrol schedules define *when* and *where* officers are expected to patrol. A patrol schedule record is an admin-authored template that generates individual patrol session records when an officer starts their shift.

**Creating a patrol schedule:**

1. Navigate to `/patrol-schedules` → **New Schedule**.
2. Fill in the schedule fields:
   - **Zone** — enforcement zone the patrol covers
   - **Assigned officer** — pre-assign or leave blank for open assignment
   - **Date** — patrol date
   - **Shift** — `morning`, `afternoon`, `night`, or `overnight`
   - **Patrol route** — optional named route to guide the officer
   - **Notes** — briefing notes visible to the officer
3. Click **Create** — the schedule appears in the schedule list with status `scheduled`.
4. The assigned officer receives a notification and can view the upcoming patrol from their home screen.

**Patrol status lifecycle:**

| Status | Meaning |
|---|---|
| `scheduled` | Admin created; officer not yet started |
| `in_progress` | Officer started patrol (tapped **Start Patrol** in the field portal) |
| `completed` | Officer completed the session |
| `cancelled` | Admin or officer cancelled before starting |

**Starting a patrol (admin view):**  
Admin can manually advance a patrol status from `scheduled` to `in_progress` or mark it cancelled. Field officers start their own patrols from the field portal — this action also creates a `patrols` table record linked to the schedule.

**Completing a patrol (admin view):**  
Click **Complete** on an in-progress patrol to close the session. The system prompts for a completion note and records the end time. Completing a patrol does not affect active scan records — all observations remain linked to the patrol.

---

###### Live Patrol Monitor (`/live-patrol-monitor`)

The Live Patrol Monitor is the supervisor's real-time dashboard for all active patrols.

**Panel layout:**

| Panel | Description |
|---|---|
| **Active Patrols** | Cards for each currently in-progress patrol showing officer name, zone, shift start time, vehicles checked, duration, and GPS freshness |
| **Officer GPS** | Last known GPS fix per officer with timestamp; colour-coded green (< 5 min) → amber (5–15 min) → red (> 15 min stale) |
| **Welfare Status** | Welfare check-in status per officer: On Time / Overdue / Man Down |
| **Patrol Summary** | Count summary: active, scheduled, completed today |

**Actions available from the monitor:**

- **Refresh** (manual or auto-interval) — re-fetches all patrol data
- **Radio** — opens PTT panel pre-scoped to the officer's channel
- **View patrol** — drills into the full patrol record including scan history
- **Live map** — opens `/live-map` with the officer's GPS trace highlighted

**Missed patrol alerts:**  
If an officer has a `scheduled` patrol that has not transitioned to `in_progress` within 15 minutes of the scheduled start time, the Live Patrol Monitor highlights it in amber. Supervisors can either contact the officer via PTT or reassign the patrol from the Dispatch Console.

---

###### Patrol Checkpoint Management (`/patrol-checkpoints`)

QR checkpoints define physical locations on a patrol route that officers must scan to prove attendance.

**Creating a checkpoint:**

1. Navigate to `/patrol-checkpoints` → **New Checkpoint**.
2. Enter the checkpoint name, description, and GPS coordinates (or use the map pin tool to place it).
3. Select the zone this checkpoint belongs to.
4. Click **Save** — a unique QR code is generated and downloadable.
5. Print the QR code and affix it to the physical location (e.g. gate post, parking sign).

**Assigning checkpoints to a patrol route:**

1. Go to the patrol route record.
2. Add checkpoints in sequence order — the expected scan order is enforced during patrol.
3. Set an optional time window per checkpoint (e.g. "arrive between 23:00–01:00").

**Missed checkpoint handling:**  
If an officer has a patrol route instance open and fails to scan a checkpoint within its time window, the system flags the stop as `missed`. The Live Patrol Monitor highlights missed checkpoints in red. Supervisors are notified via the Notifications Centre.

**Checkpoint scan results visible to admin:**  
Navigate to a completed patrol → **Checkpoint Log** to see each stop with scan time, GPS fix, deviation from expected time, and any notes.

---

###### Patrol KPI Dashboard (`/patrol-kpi`)

Provides performance metrics for patrols and officers across the selected date range and organisation.

**Key metrics:**

| Metric | Description |
|---|---|
| **Patrols completed** | Count of completed patrol sessions |
| **Patrols missed / cancelled** | Sessions that did not start or were cancelled |
| **Average patrol duration** | Mean shift length in minutes |
| **Vehicles checked per patrol** | Scan productivity per session |
| **Checkpoint compliance rate** | % of expected checkpoints scanned on time |
| **Welfare alert rate** | Welfare escalations triggered per 100 patrol hours |
| **SLA breach rate** | % of dispatched jobs that exceeded response SLA |

Filters available: date range, organisation, zone, officer, and service type.

---

###### Roster Planner (`/roster-planner`)

The Roster Planner provides a **weekly visual roster board** — officers as rows, days as columns, shift cards in cells — inspired by InTime / Deputy workforce management tools.

**Navigating the roster:**

- Use the **← Previous week** / **Next week →** arrows to move between weeks.
- Each cell shows the officer's shift card (if rostered) or an empty slot.
- Shift cards display: start time, end time, zone, service type, and status (draft / published / accepted / declined).

**Creating a shift:**

1. Click an empty cell for a day/officer combination.
2. A **New Shift** dialog opens — fill in:
   - Start time / end time
   - Zone
   - Service type (`freedom_camping`, `parking`, `noise`, etc.)
   - Optional patrol route
   - Notes
3. Click **Save as Draft** or **Publish** (published shifts notify officers immediately).

**Publishing a roster:**

Draft shifts are visible to admins only. Click **Publish Week** to publish all draft shifts for the current week at once. Officers receive a notification with their shift details.

**Officer acceptance:**  
Officers see upcoming shifts on their home screen. They can tap **Accept** or **Decline**. Declined shifts appear in amber on the Roster Planner and are automatically surfaced on the Open Shifts page.

**Swaps and replacements:**  
To reassign a shift: click the shift card → **Reassign** → select a new officer from the available pool. The system checks for conflicts with other shifts and flags overlaps.

---

###### Open Shifts (`/open-shifts`)

Displays all unfilled or declined shifts for the current and upcoming weeks.

- Admins can assign an open shift to any available officer.
- Officers with the `open_shift_notifications` preference enabled are notified of new open shifts.
- Shift urgency is colour-coded: shifts starting within 24 hours are highlighted red.

---

###### Timesheet Review (`/timesheets`)

Review, edit, and approve officer timesheets.

**Workflow:**

1. At shift end, the system auto-generates a timesheet record from the officer's session start/end times, GPS data, and manual check-out.
2. Admins review timesheets: verify actual hours vs. scheduled, add approved overtime, or flag discrepancies.
3. Click **Approve** — the timesheet is locked and forwarded to payroll export.
4. Click **Reject with Note** — the officer is notified to correct their entry.

**Export:**  
Use **Export CSV** to download approved timesheets for the selected period for payroll processing.

---

##### Personnel & Welfare

| Page | Path | Purpose |
|---|---|---|
| Officer Welfare Settings | `/officer-welfare-settings` | Configure welfare check intervals and escalation paths |
| Notifications Centre | `/notifications` | View all system and welfare alerts |
| Identity Verification | `/identity-verification` | Verify officer identity documents |

---

##### Communications

| Page | Path | Purpose |
|---|---|---|
| PTT Radio | `/radio` | Push-to-Talk voice radio interface |
| PTT Transmission Log | `/ptt-log` | Archive of all PTT transmissions |
| PTT Audit Dashboard | `/radio/audit` | Radio usage analytics and audit metrics |
| Team Chat | `/messages` | Text-based team messaging |

---

###### PTT Radio (`/radio`)

The PTT (Push-to-Talk) radio feature provides real-time voice communication between officers and supervisors over a WebRTC channel — no physical radio hardware required.

**Using PTT:**

1. Navigate to `/radio` or tap the **Radio** icon on any portal page.
2. Your organisation's default channel loads automatically.
3. **To transmit:** Press and hold the **PTT Button** (large orange button). Speak clearly. Release to end the transmission.
4. **To listen:** Transmissions from other channel members play automatically through the device speaker.
5. **Emergency broadcast:** Tap the **Emergency** button (red) to send a priority emergency transmission that interrupts all other channel audio and triggers a supervisor alert.

**Channel access:**  
Officers are assigned to one or more PTT channels via their user profile. Admins configure channel assignments in **User Management** → PTT Channel Access. By default, all officers in the same organisation share one primary channel.

**Transcription and translation (Phase 1):**  
When the inference service is connected, PTT transmissions are automatically transcribed. Transcripts are stored in `radio_transcript_segments` and are searchable from the PTT Transmission Log. Translation to a secondary language is available when configured.

> **Voice consent**: Officers must provide consent before their voice profile is registered. Consent is managed via `radio_voice_consents` and is fully revocable at any time from their profile settings.

---

###### PTT Transmission Log (`/ptt-log`)

Full archive of all voice transmissions for the organisation.

- Searchable by date, officer, channel, and keyword (requires transcription enabled)
- Each row shows: officer, channel, duration, transmission start time, and emergency flag
- Click a row to play back the audio recording (if stored) and view the full transcript
- Export for compliance or investigation purposes

---

###### PTT Audit Dashboard (`/radio/audit`)

Analytics on radio usage across the organisation.

**Metrics:**

| Metric | Description |
|---|---|
| **Total transmissions** | Count of PTT events in the period |
| **Coverage rate** | % of patrols with at least one radio transmission |
| **Average transmission duration** | Mean transmission length in seconds |
| **Low-confidence transcripts** | Transmissions where transcription confidence < threshold |
| **Emergency transmissions** | Count of emergency-flagged broadcasts |
| **Per-officer breakdown** | Individual radio activity summary |

> **Access**: Admin, admin_officer, master, grand_master.

---

###### Team Chat (`/messages`)

Text-based messaging for team coordination. Available to all authenticated users.

**Features:**

- **Organisation channel** — a shared team-wide message thread
- **Direct messages** — one-to-one messaging between any two users in the same organisation
- **Job-linked messages** — dispatch jobs can be annotated with chat messages visible to all assigned officers and supervisors
- **File attachments** — images and documents can be shared within a chat thread
- **Notification badges** — unread message count shown on the navigation icon

**When to use PTT vs. Team Chat:**

| Scenario | Recommended |
|---|---|
| Urgent field update, hands-free | PTT Radio |
| Real-time incident coordination | PTT Radio |
| Non-urgent admin note | Team Chat |
| Sharing a document or photo | Team Chat |
| Handover notes at shift change | Team Chat |

---

##### Reports & Analytics

| Page | Path | Purpose |
|---|---|---|
| Reports Hub | `/reports-hub` | Central reports landing page |
| Reports | `/reports` | Pre-built report library |
| Custom Report Builder | `/custom-reports` | Build and save custom report templates |
| Observations View | `/observations` | View all officer observation records |
| Observations Report | `/observations-report` | Observation summary report |
| Observation Records | `/observation-records` | Full observation record management |
| Incident Reports | `/incident-reports` | Structured incident report library |
| Incident Management | `/incidents` | Manage open incidents |
| AI Analysis | `/ai-analysis` | AI-generated compliance insights |
| Compliance Analytics | `/admin/compliance-analytics` | Trend and comparison analytics |
| Audit Log | `/audit-log` | Full audit trail of all system actions |
| PTT Transmission Log | `/ptt-log` | Push-to-Talk communication archive |

---

##### Dispatch

| Page | Path | Purpose |
|---|---|---|
| Dispatch Console | `/dispatch-console` | Create and assign dispatch jobs |
| Dispatch Monitor | `/dispatch-monitor` | Live job queue and officer assignment overview |
| Dispatch Wizard | `/dispatch-wizard` | Guided job creation for complex situations |
| Dispatched Jobs List | `/dispatched-jobs` | Historical job list with status |

---

###### Dispatch Console (`/dispatch-console`)

The Dispatch Console is the **real-time operational board** for creating, assigning, and tracking dispatch jobs — modelled on CAD (Computer-Aided Dispatch) systems used in emergency services.

**Layout:**

| Panel | Description |
|---|---|
| **Job Queue (left)** | Priority-sorted list of all active jobs: `pending` → `dispatched` → `acknowledged` → `en_route` → `on_scene` → `completed` |
| **Officer Board (right)** | Available officers with their current GPS status and last known location |
| **SLA Timer** | Each job displays a countdown clock; overdue SLA jobs are highlighted in red |

**Creating a new job:**

1. Click **+ New Job** in the top-right of the console.
2. Fill in the job form:
   - **Job type** — `patrol_check`, `alarm_response`, `welfare_check`, `noise_complaint`, `parking`, `trespass`, `general_enquiry`, `freedom_camping`, etc.
   - **Priority** — `low` / `normal` / `high` / `urgent`
   - **Title and description** — brief summary of the situation
   - **Address** — full street address (auto-geocoded to GPS coordinates)
   - **Caller details** — caller name and phone (if applicable)
   - **Client site** — optionally link to a contracted client site
   - **Zone** — enforcement zone if applicable
   - **Response SLA** — default is set per job type; override if needed
3. Click **Create Job** — the job appears in the queue with status `pending`.

**Assigning a job to an officer:**

1. Click the pending job in the queue — it highlights.
2. Click an officer in the Officer Board who is available (green status).
3. Click **Dispatch** — the job moves to `dispatched` status.
4. The officer receives an in-app push notification with the job address and description.

**Job lifecycle status codes:**

| Status | Meaning | Triggered by |
|---|---|---|
| `pending` | Created, awaiting assignment | Admin (console or wizard) |
| `dispatched` | Assigned to officer | Admin (dispatch action) |
| `acknowledged` | Officer confirmed receipt | Officer (field portal) |
| `en_route` | Officer is travelling to scene | Officer (field portal) |
| `on_scene` | Officer arrived | Officer (field portal) or geofence trigger |
| `completed` | Job closed with outcome | Officer or admin |
| `cancelled` | Job cancelled before completion | Admin |

**SLA management:**  
Jobs that exceed their response SLA without reaching `on_scene` status are automatically:
- Highlighted red in the Dispatch Console
- Flagged with `sla_breached = true` in the database
- Surfaced on the Dispatch Monitor escalation board

**Alarm types:**  
The job record supports an optional `alarm_type` field for integration with alarm monitoring panels (e.g. duress, intrusion, hold-up). Alarm type codes are configurable per organisation and used to pre-fill job descriptions and priority.

**Auto-replan:**  
The `useDispatchReplan` hook supports automated reassignment of jobs when an officer goes offline or declines. Admins can enable auto-replan per organisation from the Dispatch Console settings.

---

###### Dispatch Monitor (`/dispatch-monitor`)

The Dispatch Monitor provides a **supervisor-level overview** of the entire job queue without the assignment controls of the console.

- Displays all active jobs grouped by status
- Shows officer locations on the integrated map panel
- Highlights SLA breaches in real time
- Does not allow assignment actions — use the Dispatch Console for that

**Use case:** A second supervisor watching the board without needing to interact — or a display screen in a control room.

---

###### Dispatch Wizard (`/dispatch-wizard`)

A guided step-by-step job creation flow for complex or multi-resource situations (e.g. large events, multi-zone incidents).

**Steps:**

1. **Situation type** — select from a pre-defined scenario list (noise event, suspicious vehicle, medical assist, etc.)
2. **Location** — enter address or drop pin on map
3. **Resource selection** — the wizard recommends the nearest available officer(s) based on GPS proximity and service type
4. **Briefing notes** — free-text briefing for the assigned officers
5. **Review & dispatch** — confirm and create the job(s)

The wizard supports **multi-resource dispatch** — create multiple linked jobs in one workflow (e.g. primary officer + backup officer + supervisory notification).

---

###### Dispatched Jobs List (`/dispatched-jobs`)

Historical record of all dispatch jobs for the selected organisation and date range.

- Filterable by status, job type, officer, zone, client site, and date
- Each row links to the full job detail view (timeline, officer updates, GPS trace, evidence)
- **Export CSV** available for reporting and billing purposes
- SLA breach rate is summarised at the top of the list

---

##### Users & Organisations

| Page | Path | Purpose |
|---|---|---|
| User Management | `/users` | Create, edit, and deactivate user accounts |
| Access Control | `/access-control` | Configure portal area access per user |
| Client Master List | `/client-master-list` | All client organisations and contacts |
| Client Sites | `/client-sites` | Manage client site records |
| Site Permissions Admin | `/site-permissions-admin` | Configure who can access which sites |
| Asset Management | `/assets` | Manage vehicles, radios, and equipment assigned to officers |

**Creating a user:**
1. Go to `/users` → **Invite User**.
2. Enter first name, last name, email, role, and assign to an organisation.
3. Set required credentials: Certificate of Authority (COA) number/expiry, Warrant number/expiry.
4. Set driver's licence requirement if needed.
5. Assign portal area access codes (restricts which modules the user can access).
6. Optionally configure PTT channel access.
7. Click **Send Invite** — the user receives an email with a link to set their password.

---

##### Finance & Business

| Page | Path | Purpose |
|---|---|---|
| Invoicing | `/invoicing` | Create, manage, and export invoices |
| Pricing Page | `/pricing` | Subscription and service pricing |
| CRM Module | `/crm` | Client accounts, contacts, and opportunities |
| Tender Workspace | `/tenders` | RFP and tender management |
| Tender Reference Library | `/tender-library` | Clause and template library for tenders |

---

##### Data Management

| Page | Path | Purpose |
|---|---|---|
| Data Management Hub | `/data-management-hub` | Central data management landing page |
| Data Management | `/data` | Import/export and data overview |
| Import Data | `/import-data` | Import scan, breach, or vehicle data |
| Import Historical Data | `/import-historical` | Batch import of historical records |
| Cleanup and Recalculate | `/cleanup-recalculate` | Remove duplicate records and recalculate compliance scores |
| Photo Reingest | `/photo-reingest` | Reprocess failed or missing plate photos |
| Evidence Photo Linker | `/evidence-photo-linker` | Manually link orphaned photos to scan records |
| Data Cleanup Utility | `/data-cleanup` | Targeted data-quality tools |
| Data Integrity Dashboard | `/data-integrity` | Monitor data health metrics |
| Person Records | `/person-records` | Canonical person registry management |
| Face Recognition | `/face-recognition` | AI face recognition management |

---

##### Specialist Service Portals (Admin Overview)

| Page | Path | Purpose |
|---|---|---|
| Parking Enforcement Portal | `/parking-enforcement` | Supervisor view of parking enforcement |
| Noise Control Portal | `/noise-control` | Supervisor view of noise control operations |
| Biosecurity Control Page | `/biosecurity-control` | Supervisor view of biosecurity operations |
| Smoke Complaint Control | `/smoke-control` | Supervisor view of smoke complaint operations |
| EMS Portal | `/ems` | Electronic Monitoring device management (admin view) |
| Site Guard Portal | `/site-guard` | Static guarding site management |

---

### 4.2 Admin Officer (Dual Role)

**Role code**: `admin_officer`  
**Access**: Full admin portal **plus** all officer portals. Must choose a portal on each login session.

The Admin Officer role is designed for supervisors who both manage compliance from the office and work field shifts. After login, they are presented with the **Portal Selection** screen (see [§2.3](#23-portal-selection-admin-officer-role-only)).

- When in **Admin Portal** mode: identical access to `admin` (see [§4.1](#41-administrator)).
- When in a **Field Officer** portal: identical access to the relevant officer role (see [Part C](#part-c--field-roles-officer-portals)).
- The portal choice is stored for the session — switching requires starting a new session or navigating back to `/portal-selection`.

---

### 4.3 NZSCV Monitor

**Role code**: `nzscv_monitor`  
**Access**: Restricted to the NZSCV Vehicle Registry monitor and basic account pages.

This read-only role is for users who only need to check the New Zealand Self-Contained Vehicle (NZSCV) certification database.

**Available pages:**
- `/admin/nzscv` — NZSCV status monitor
- `/vehicle-registry` — Read-only vehicle registry
- `/search` — Universal search
- `/profile` — Own profile
- `/settings` — Account settings

---

## PART C — Field Roles (Officer Portals)

Officers are auto-routed to the correct portal based on their **rostered shift service type**. If no roster exists, they land at `/officer-home` or `/field-officer`.

### General Officer Features (All Portals)

- **Welfare Check-ins**: Officers receive periodic welfare prompts. If not acknowledged within the configured interval, the system escalates to supervisors.
- **Man Down Detection**: If a device detects no movement for a configurable period, an automatic Man Down alert is triggered.
- **GPS Logging**: Officer location is logged continuously during active sessions.
- **PTT Radio**: Push-to-Talk is available on all portals — tap the PTT button to broadcast to the org channel.
- **Offline Queue**: Scans and actions captured without internet are queued and synced automatically when connectivity is restored.
- **Post-Shift Feedback**: At the end of each shift, officers complete a brief feedback form.

---

### 5.1 Field Officer — Freedom Camping Patrol

**Service type**: `freedom_camping`  
**Portal path**: `/field-officer?service=freedom_camping`

This is the primary patrol portal for freedom camping enforcement under the Freedom Camping Act 2011.

#### Starting a Shift

1. Navigate to the portal (or wait for auto-routing from your rostered shift).
2. **Select your zone** — choose the zone you are patrolling from the dropdown.
3. The system confirms your geofence status — a green banner means you are inside the zone.
4. Tap **Start Patrol** to begin session GPS logging.

#### Vehicle Scanning (ALPR)

1. Tap the **Camera** icon (or **Scan Vehicle** button).
2. Point the device camera at the vehicle's number plate. The scan pipeline:
   - Captures the plate image
   - Reads the plate number using ALPR (on-device or server-side OCR)
   - Checks the NZSCV self-contained certification database
   - Cross-references overnight history for the zone
   - Returns a compliance verdict within seconds
3. **Scan result codes:**
   - 🟢 **Compliant**: Vehicle meets all zone rules. No action needed.
   - 🟡 **At Risk**: Vehicle is approaching a threshold (e.g. 2 of 3 permitted nights). Log a monitoring note.
   - 🔴 **Breach**: Vehicle has exceeded limits or is non-certified in an SCV-required zone. Action required.
   - ⚫ **Unknown**: Plate could not be read or vehicle not found. Add manual entry.

4. For a **Breach** result, you will see the breach type and suggested action. Options:
   - **Warning**: Issue a verbal/written warning (recorded in the system).
   - **Notice to Vacate (NTV)**: Tap **Issue NTV** to generate a notice.
   - **Infringement Notice**: If prior warning exists, tap **Issue Infringement**.
   - **Print Ticket**: Print a physical notice if a Bluetooth printer is connected.

#### Bulk Scan Session

For high-volume locations, use **Bulk Scan** mode:
1. Tap **Bulk Scan** — the camera activates in continuous sweep mode.
2. Each detected plate is queued automatically.
3. Review and confirm each record after the sweep. Anomalies are flagged for review.

#### QR Checkpoint Scanning

For patrol route checkpoints:
1. Tap **QR Scan** on the portal.
2. Scan the QR code at each checkpoint.
3. The system records your arrival time, GPS position, and links it to the patrol route.
4. Missed checkpoints are flagged to supervisors automatically.

#### VOI (Vehicle of Interest) Lookup

1. Tap **VOI Lookup** — enter a plate number manually.
2. The system shows the full compliance history, prior warnings, active alerts, linked person records, and any registered interest flags.

#### Follow-Up Queue

Vehicles flagged for follow-up from previous shifts appear in the **Follow-Up Queue**. Work through these systematically before beginning new scans in the same zone.

#### Incident Reporting

1. Tap **New Incident** to log an on-scene incident (confrontation, property damage, welfare concern, etc.).
2. Fill in type, description, severity, and optionally attach a photo or GPS pin.
3. Incidents are immediately visible to supervisors in the admin portal.

---

### 5.2 Site Guard Officer

**Service type**: `guarding`  
**Portal path**: `/site-guard`

Used for static guarding duties at contracted client sites.

#### Starting a Guarding Shift

1. The portal auto-loads if you are rostered to a specific site. Otherwise, select your site from the dropdown.
2. Review the site brief: risk profile, access rules, key contacts, and current alerts.

#### Key Features

| Feature | Description |
|---|---|
| **Checkpoint Scanning** | Scan QR codes at site checkpoints to log your patrol route |
| **Incidents** | Log incidents directly from the portal |
| **Points of Interest (POI)** | View and manage site POIs (CCTV locations, key lock boxes, entry points) |
| **Camera Review** | Review CCTV snapshots associated with the site |
| **Face Recognition** | For sites with access control, use face scan to verify visitor/contractor identity |
| **Access Control** | Log access events (entry/exit) for the site |
| **Emergency Assist** | One-tap emergency assistance request to supervisors |

#### Reporting

At the end of a guarding shift, complete the **Post-Shift Feedback** form summarising key events, observations, and any maintenance issues.

---

### 5.3 Parking Enforcement Officer

**Service type**: `parking`  
**Portal path**: `/parking-officer`

For council and private parking enforcement operations.

#### Core Workflow

1. Select your patrol area/zone from the zone selector.
2. **Chalk pass**: Log a chalk time against a vehicle — the system records the time and plate. Returning to the same area will flag timed-out vehicles automatically.
3. **Permit check**: Scan or manually enter a plate to check for valid permits. The system checks the permit database for the zone.
4. **Notice issuance**: Issue a parking infringement notice from the breach record. The system generates a unique notice number.
5. **Photo evidence**: Capture before/after photos attached to each notice.

---

### 5.4 Noise Control Officer

**Service type**: `noise`  
**Portal path**: `/noise-officer`

For after-hours noise control operations under the Resource Management Act 1991.

#### Noise Assessment Workflow

1. Receive a complaint from dispatch or create a new attendance record.
2. **Bob AI Assessment**: Tap **Assess with Bob** — Bob analyses the complaint context and suggests the appropriate notice type (Abatement, Direction, or Enforcement).
3. Choose the notice type:

| Notice | When to issue |
|---|---|
| **Abatement Notice** | First attendance — occupant must reduce noise |
| **Direction Notice** | Prior Abatement Notice exists and noise has recurred |
| **Enforcement Notice** | Serious, persistent, or uncooperative occupant |

4. Complete the notice form with:
   - Address
   - Offence description (specific and accurate)
   - Legal basis (`RMA 1991 s.326` or `s.327`)
   - Officer details
5. Issue and print the notice.
6. Log the outcome (noise abated, refused, escalated, etc.).

---

### 5.5 Biosecurity Inspection Officer

**Service type**: `biosecurity_inspection`  
**Portal path**: `/biosecurity-officer`

For biosecurity compliance inspections.

#### Inspection Workflow

1. Navigate to the inspection site.
2. Complete the inspection form fields (pest records, hygiene, compliance items).
3. **Bob AI Assessment**: Bob analyses inspection inputs and flags high-risk items for escalation.
4. Issue an **Abatement Notice** or **Enforcement Notice** as required.
5. Attach photographic evidence.
6. Submit the inspection report — auto-routed to the compliance dashboard.

---

### 5.6 Smoke Complaint Officer (OOH)

**Service type**: `smoke_complaint_ooh`  
**Portal path**: `/smoke-officer`

For out-of-hours smoke complaint response.

#### Smoke Complaint Workflow

1. Receive a complaint reference from dispatch.
2. Attend the address and assess the situation.
3. **Bob AI Assessment**: Bob analyses the complaint type (domestic burning, industrial, nuisance) and recommends a response pathway.
4. Issue the appropriate notice or log a no-action outcome.
5. Complete the post-attendance report.

---

### 5.7 EMS Officer

**Service type**: `ems`  
**Portal path**: `/ems`

For Electronic Monitoring (EM) bail device management.

#### EMS Operations

| Task | Steps |
|---|---|
| **Device Fit** | Log the device serial number, recipient details, GPS anchor address, and fit conditions |
| **Device Check** | Scan device QR code to log a welfare check and signal quality assessment |
| **Device Removal** | Record the removal with reason, condition, and return details |
| **Tamper Alert Response** | Respond to system-generated tamper alerts — log attendance, outcome, and evidence |

---

## PART D — Client Organisation

Client users access a read-only portal scoped to their own organisation's contracted sites and services.

### 6.1 Client Viewer

**Role code**: `client_viewer`  
**Access**: Read-only. All data scoped to their organisation. Route: `/client-portal`.

#### Client Portal Modules

| Module | Description |
|---|---|
| **Guard Activity Feed** | Chronological list of all officer scan and incident events at their sites |
| **Compliance KPI Tiles** | Summary metrics: scans today, active breaches, compliance rate, incidents open |
| **Sites Overview** | Status of each contracted site with guard coverage indicator |
| **Infringements** | All infringement notices issued at their sites |
| **Risk Assessments** | Site risk assessment records |
| **Observations** | Officer observation records relevant to their sites |
| **Contact** | Service provider contact details and escalation contacts |

Clients cannot create records, issue notices, or modify any data. All views update in real time as officers complete work.

---

### 6.2 Client Officer

**Role code**: `client_officer`  
**Access**: Same as Client Viewer. In some configurations, a Client Officer may log incidents from the client portal. Access is determined by their organisation's settings.

---

### 6.3 Client Admin

**Role code**: `client_admin`  
**Access**: Client portal plus the ability to manage client-side contacts and site access settings. This role can:
- Add/update site contact information
- Request additional users for their organisation (subject to service provider approval)
- View and respond to disputes

---

## PART E — Technical Reference (Systems Administrator)

This section is for the systems administrator, DevOps engineer, or platform operator responsible for deploying, configuring, and maintaining FieldOps Manager.

---

### 7.1 Architecture Overview

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript, Vite, Tailwind CSS v3, shadcn/ui (Radix UI) |
| State | Zustand (persistent in `sessionStorage`), TanStack Query v5 |
| Routing | react-router-dom v6 with lazy-loaded page chunks |
| Backend | Supabase (PostgreSQL + Edge Functions + Row Level Security) |
| AI Services | `inference-service/` (ONNX/Ollama, Node), Bob AI (Ollama + function calling) |
| ALPR Proxy | `proxy-server/` (Node/Express — wraps NZSCV and MotorWeb APIs) |
| PTT Radio | WebRTC push-to-talk bridge (`ptt-server/`, `ptt-bridge/`) |
| Deploy | Vercel (frontend), Railway (proxy-server), Supabase cloud or self-hosted |
| Package Manager | **bun** (root), npm (sub-services) |

**Code structure:**

```
src/
  pages/          — 80+ page components
  components/
    ui/           — shadcn/ui primitives (do not modify)
    features/     — App-specific feature components
    layout/       — Navigation, AppLayout
  hooks/          — Custom React hooks
  stores/         — Zustand stores (authStore, globalFiltersStore, etc.)
  lib/            — supabase.ts, edgeFunctions.ts, fileUpload.ts, geocoding.ts
  types/          — database.ts (Supabase-generated types)
supabase/
  functions/      — 30 production Edge Functions (Deno/TypeScript)
  migrations/     — 70+ SQL migrations (prefix YYYYMMDD_*)
proxy-server/     — NZSCV/MotorWeb proxy (own package.json)
inference-service/ — ONNX AI inference (own package.json)
```

---

### 7.2 Environment Setup

#### Prerequisites

- Node.js 18+ or Bun 1.0+
- Supabase CLI
- A Supabase project (cloud or local)

#### Environment Variables

Copy `.env.example` to `.env` and set:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Additional variables for sub-services are documented in [`docs/ENVIRONMENT_VARIABLES.md`](./ENVIRONMENT_VARIABLES.md) and [`docs/SECRETS_REGISTRY.md`](./SECRETS_REGISTRY.md).

#### Build Commands

```bash
# Install dependencies
bun install

# Development server (http://localhost:5173)
bun run dev

# Production build (output in dist/)
bun run build

# Lint (ESLint 9 flat config)
bun run lint

# Sub-services
cd proxy-server && npm install && npm run dev
cd inference-service && npm install && npm run dev
```

---

### 7.3 Database & Migrations

The database is hosted on Supabase (PostgreSQL). Migrations are in `supabase/migrations/` prefixed by date (`YYYYMMDD_*`).

#### Running Migrations

```bash
# Apply all pending migrations (against local Supabase)
supabase db push

# Apply to remote project
supabase db push --linked
```

#### Key Tables

| Table | Purpose |
|---|---|
| `user_profiles` | User accounts — role, org assignments, credentials |
| `organizations` | All orgs (owner, service_provider, client, contractor) |
| `zones` | Enforcement zones with geofence polygons |
| `vehicles` | Vehicle master records |
| `patrols` | Patrol session records |
| `breach_records` | Breach records with status workflow |
| `infringement_notices` | Issued notices |
| `incidents` | Incident reports |
| `observations` | Officer observations |
| `dispatch_jobs` | Jobs dispatched to officers |
| `dispatch_resources` | Patrol runs and callsigns |
| `radio_transmissions` | PTT transmission audit trail (speaker, channel, emergency flag, start/end) |
| `radio_transcript_segments` | Transcript segments per transmission (sequence, confidence, final flag) |
| `radio_translation_segments` | Per-segment translated caption output |
| `radio_tts_renders` | Synthetic translated-audio render artifacts (always synthetic-tagged) |
| `radio_voice_profiles` | Voice profile registry (consent-governed, revocable) |
| `radio_voice_consents` | Auditable consent/revocation records for voice profiles |
| `canonical_persons` | Master person registry |
| `canonical_vehicles` | Deduplicated vehicle registry |
| `client_sites` | Contracted client sites (unique on `organization_id + site_code`) |
| `person_observations` | Person scan history |
| `bug_reports` | Manual feedback, auto error reports, live-session diagnostics |

#### Row-Level Security (RLS)

All tables enforce RLS. The key function is `get_user_organization_ids()`:

| Role | Scope |
|---|---|
| `officer`, `admin`, `admin_officer` | Own org + `authorized_work_locations` + `extra_organization_ids` + descendants |
| `master` | Own org + all child orgs |
| `grand_master` | All orgs |
| `client_viewer/officer/admin` | Own client org only |

> **Never bypass RLS** using the service role key in frontend code. Service role is for server-to-server Edge Function calls only.

#### Multi-Org Access Pattern

The `get_user_organization_ids()` SQL function returns the full set of org IDs accessible to a user. All data queries in Edge Functions must filter by `organization_id = ANY(get_user_organization_ids())`.

---

### 7.4 Edge Functions

Located in `supabase/functions/<name>/index.ts`. All functions are Deno TypeScript.

**30 production Edge Functions** are active. Key ones:

| Function | Purpose |
|---|---|
| `process-officer-scan` | Full ALPR scan pipeline (OCR → NZSCV → compliance → breach) |
| `check-services-health` | Service health aggregator (proxy, inference, PTT, Supabase) |
| `cleanup-and-recalculate` | Remove duplicates and recalculate compliance scores |
| `render-infringement-notice` | Generate print-ready infringement notice HTML |
| `check-nzscv-status` | Query NZSCV API for SCV certification |
| `enrich-from-motorweb` | Vehicle metadata enrichment from MotorWeb |
| `analyze-vehicle-photo` | AI photo analysis for vehicle identification |
| `sync-spatial-layers` | Sync GeoJSON zone layers to PostGIS |
| `live-session-diagnostics-ingest` | Ingest live session diagnostics to `bug_reports` |
| `live-session-diagnostics-summary` | AI summary of session diagnostics |
| `check-railway-health` | Legacy alias → delegates to `check-services-health` |
| `radio-token` | Mints scoped PTT JWT + creates `radio_transmissions` audit row |
| `radio-audit` | Org-scoped radio audit metrics (coverage, low-confidence, per-transmission confidence rollups, synthetic-tagging) |

**Conventions (mandatory for new Edge Functions):**

```typescript
import { corsHeaders } from '../_shared/cors.ts'

// Always handle OPTIONS preflight
if (req.method === 'OPTIONS') {
  return new Response('ok', { headers: corsHeaders })
}
// All responses must include corsHeaders
```

**Deploying Edge Functions:**

```bash
supabase functions deploy <function-name>
# Deploy all
supabase functions deploy
```

---

### 7.5 AI Services (Bob / Inference)

**Bob** is the in-platform AI assistant for compliance, noise, biosecurity, smoke, and operational triage.

#### Inference Service

The `inference-service/` directory contains an ONNX/Ollama inference server.

```bash
cd inference-service && npm install && npm run dev
```

Environment variable: `OLLAMA_BASE_URL=http://ollama:11434` (use service name in Docker, not container IP).

#### Bob AI Configuration

- Bob's capabilities are configured via the **Bob Assistant Studio** (`/bob-studio`) — grand_master only.
- Bob conversations are persisted per user per org in the `conversations` and `messages` tables.
- `currentConversationId` is stored in `sessionStorage` under `bob-conversation-id-${organizationId}`.
- Bob uses `SUPABASE_SERVICE_ROLE_KEY` for background tasks (never exposed to the browser).
- Tenant context is passed via `x-org-id` header on all Bob requests.

#### Bob Capability Modules

| Module | Purpose |
|---|---|
| `chat` | General compliance and operations Q&A |
| `assess` | Structured assessment of noise/biosecurity/smoke situations |
| `ping` | Health/connectivity check (serverless mode — `/runsync`) |
| `triage` | Operational triage — priority ranking of open work |

> **Note**: Bob operates in **serverless mode** via `/runsync` actions. The `health` endpoint (`GET /health`) is pod-only and is not available in serverless mode.

---

### 7.6 PTT / Push-to-Talk

The PTT system provides real-time radio communication between officers and supervisors.

#### Components

| Component | Path | Purpose |
|---|---|---|
| PTT Server | `ptt-server/` | WebRTC signalling server |
| PTT Bridge | `ptt-bridge/` | Audio bridge between PTT and team channels |
| PTT Bridge Python | `ptt-bridge-python/` | Mumble integration |
| Mumble Stack | `mumble-stack/` | Self-hosted Mumble server config |

#### Radio Control Plane (current production contract)

| API / Service | Purpose |
|---|---|
| `supabase/functions/radio-token` | Policy-plane token minting and transmission audit row creation |
| `ptt-server/radio-router.js` | SFU control endpoints and transmission-scoped JWT verification |
| `ptt-server/speech-worker.js` | Redis queue consumer for speech lifecycle events |
| `inference-service/server.js` `/radio/speech-event` | Speech ingress endpoint (authenticated, async 202 acceptance) |

#### Auth Model

1. `radio-token` is called with user bearer auth and returns a scoped radio JWT.
2. SFU/session endpoints in `ptt-server` require `Authorization: Bearer <radio-jwt>`.
3. Transmission scope is enforced server-side (`claims.transmission_id` must match request transmission).

#### Speech Pipeline (Phase 1)

1. Producer/session lifecycle events are enqueued in Redis (`radio:speech:events`).
2. `speech-worker.js` forwards events to inference webhook with retry/backoff and DLQ.
3. `radio-speech-processor` writes transcript segments when enabled and updates `ended_at` on session close.
4. AI-off/stub mode is supported and must not block original audio traffic.

#### Configuration

Officers are assigned PTT channel access via the `ptt_channel_access` array on their `user_profiles` record. Administrators configure channels via **User Management** → PTT Channel Access Control.

**Channel scope**: By default, officers connect to their own organisation's PTT channel. Additional channels can be granted per-user via `ptt_channel_access`.

---

### 7.7 System Diagnostics & Health

Navigate to `/diagnostics` (`master` or `grand_master` role required).

#### Health Checks

| Check | What it tests |
|---|---|
| **Supabase Edge Functions** | Basic function connectivity |
| **Proxy Server** | NZSCV/MotorWeb proxy health (via `check-services-health`) |
| **Inference Service** | Bob/ONNX service ping |
| **PTT Service** | Push-to-Talk WebRTC signalling |
| **Database Connectivity** | Supabase read/write round-trip |

#### Radio-Specific Health Endpoints

| Endpoint | Service | Meaning |
|---|---|---|
| `GET /radio/health` | `ptt-server` | SFU readiness, worker count, active sessions, router totals |
| `GET /health` → `radio_pipeline` | `inference-service` | Speech processor mode (`stub`/`whisper`), processor enabled flag, model/config visibility |

Use these endpoints during incident response before escalating a radio outage.

#### Phase 1 Validation Workflow

The dedicated CI gate is [`.github/workflows/phase1-radio-validation.yml`](../.github/workflows/phase1-radio-validation.yml) and executes:

1. Role-scoped radio access tests
2. Org isolation tests (transcripts + translations)
3. Reconnect resilience tests
4. Emergency-channel latency tests
5. AI-off degradation tests
6. Voice consent/revocation tests

Expected behavior: when optional org2/inference secrets are not present, environment-gated tests skip instead of failing unrelated deployment checks.

#### Data Integrity

The **Data Integrity** check (run from `/diagnostics`) invokes the `check-data-integrity` Edge Function, which:
1. Scans for duplicate scan records
2. Flags invalid plate formats
3. Checks orphaned breach records (no linked scan)
4. Reports action taken (duplicates deleted, invalid plates marked)

Results show: records processed, duplicates removed, invalid plates flagged, and a severity-classified issue list.

#### Live Session Diagnostics

The `useLiveSessionDiagnostics` hook (mounted globally in `App.tsx`) captures JavaScript errors, performance metrics, and network failures during active sessions. Data is written to the `bug_reports` table — one row per session (`Live session diagnostics <sessionId>`), updated continuously.

---

### 7.8 User & Organisation Provisioning

#### Creating a New Organisation

1. Grand Master or Master navigates to `/organizations`.
2. Click **New Organisation**.
3. Set organisation type:
   - `owner` — Platform operator (Iron Eagle / OnSpace AI)
   - `service_provider` — Security company operating the service
   - `client` — Council or organisation receiving enforcement services
   - `contractor` — Sub-contracted service providers
4. Set `parent_organization_id` to establish the org hierarchy.
5. Set enforcement workflow and overnight verification mode.

#### User Roles Summary

| Role | Landing page | Typical use case |
|---|---|---|
| `grand_master` | `/platform` | Platform owner (OnSpace AI) |
| `master` | `/admin` | Operations director at security company |
| `admin` | `/admin` | Operations manager / compliance officer |
| `admin_officer` | `/portal-selection` | Supervisor who also does field shifts |
| `officer` | Auto-routed by roster | Field enforcement officer |
| `nzscv_monitor` | `/admin/nzscv` | NZSCV database monitor only |
| `client_viewer` | `/client-portal` | Read-only client contact |
| `client_officer` | `/client-portal` | Client site officer (limited) |
| `client_admin` | `/client-portal` | Client admin with site management rights |

#### Portal Area Access Codes

Restrict which admin modules a user can access by setting **portal area codes** in their profile. If `portal_access` is empty, the user has access to all areas their role permits. Codes are defined in `src/hooks/usePermissions.ts` and include: `field_officer`, `users`, `reports`, `invoicing`, `crm`, and others.

---

### 7.9 Data Integrity & Cleanup

#### Compliance Recalculation

When historical data is imported or corrected, compliance scores must be recalculated:

1. Navigate to `/compliance-recalculation` or `/cleanup-recalculate`.
2. Select date range and organisation.
3. Click **Recalculate** — the `cleanup-and-recalculate` Edge Function runs server-side.
4. Results show records updated, breaches re-evaluated, and any anomalies flagged.

> **Requires**: `org_id` (accepts `org_id` or `organization_id`). All vehicle queries are scoped by `organization_id`.

#### Photo Reingest

If vehicle scan photos failed to process during capture:

1. Navigate to `/photo-reingest`.
2. Select the date range and optionally filter by zone.
3. Click **Reingest** — orphaned photos are reprocessed through the scan pipeline.

#### Data Cleanup Utility

`/data-cleanup` provides targeted tools:
- Remove duplicate vehicle records
- Merge duplicate person records
- Flag and archive stale zone records
- Correct malformed plate numbers

---

### 7.10 Security & Compliance Notes

#### Authentication

- Authentication is managed by Supabase Auth (JWTs).
- On login, all previous sessions for that user are revoked (`signOut({ scope: 'others' })`).
- Session state is stored in `sessionStorage` (cleared on tab close).
- Passwords must be a minimum of 8 characters.
- `admin_officer` portal choice is gated via `sessionStorage` key `adminOfficerPortalChoice === 'selected'`.

#### Data Residency

All data is stored in Supabase. For New Zealand government contracts, ensure the Supabase project is configured with the appropriate data residency region.

#### Audit Logging

All significant actions (breach creation, notice issuance, user management, login events) are recorded in the audit log (`/audit-log`). The audit log is append-only and cannot be edited.

#### RLS Policy Validation

After any schema change or migration that adds new tables, verify RLS is enabled:

```sql
-- Check all tables have RLS enabled
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- Verify policy coverage
SELECT tablename, policyname, roles, cmd FROM pg_policies WHERE schemaname = 'public';
```

#### CORS

All Edge Functions must import CORS headers from `supabase/functions/_shared/cors.ts` and handle the `OPTIONS` preflight. Failure to do so will block all browser-initiated API calls.

#### Secrets Management

Never commit secrets to the repository. All secrets are managed via:
- Supabase project secrets (for Edge Functions)
- Railway environment variables (for proxy-server)
- Vercel environment variables (for frontend build-time vars)

Reference [`docs/SECRETS_REGISTRY.md`](./SECRETS_REGISTRY.md) for the full list of required environment variables.

#### Railway Deployment (Proxy Server)

The `proxy-server/` is deployed to Railway. The Railway project's **Root Directory** must be set to `proxy-server/`. See [`docs/RAILWAY_DEPLOYMENT_GUIDE.md`](./RAILWAY_DEPLOYMENT_GUIDE.md) for step-by-step instructions.

---

## Appendix A — Enforcement Document Quick Reference

| Document | Legal Basis | Default Fine | Portal |
|---|---|---|---|
| Warning Notice | FCA 2011 s.20 (pre-infringement) | None | Field Officer |
| Infringement Notice | FCA 2011 s.20 | NZD $200 | Admin → Infringement Notices |
| Notice to Vacate | FCA 2011 s.32 / council bylaws | None | Admin / Field Officer |
| Abatement Notice | RMA 1991 s.326 | None | Noise Control |
| Direction Notice | RMA 1991 s.326 | None | Noise Control |
| Enforcement Notice | RMA 1991 s.327 | None | Noise Control |

---

## Appendix B — Role Access Matrix

| Feature | grand_master | master | admin | admin_officer | officer | nzscv_monitor | client_* |
|---|---|---|---|---|---|---|---|
| Platform overview | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| All organisations | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Organisation management | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Admin hub & dashboard | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| User management | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Field officer portals | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Client portal | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Vehicle registry | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| System diagnostics | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Invoicing / CRM | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Audit log | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## Appendix C — Common Troubleshooting

| Symptom | Likely Cause | Resolution |
|---|---|---|
| Login succeeds but blank screen | Stale auth token in browser storage | Clear site data / sessionStorage and reload |
| Officer stuck on loading spinner | Auth session check timeout (>3 s) | Auto-resolved after 3 s; if persistent, check Supabase connectivity |
| Scan returns Unknown | ALPR could not read plate, or plate not in NZSCV | Enter plate manually; use VOI Lookup for history |
| No zones in zone selector | Officer not linked to correct organisation | Update `organization_id` or `authorized_work_locations` in User Management |
| PTT not connecting | PTT server offline or channel not configured | Check `/diagnostics` → PTT health; verify `ptt_channel_access` on user profile |
| Compliance score stale after data import | Recalculation not yet run | Run `/compliance-recalculation` for the relevant date range and organisation |
| Edge Function CORS error | Missing OPTIONS handler or corsHeaders | Check function follows `_shared/cors.ts` pattern |
| `get_user_organization_ids()` returns empty | User profile has no `organization_id` set | Update user profile in User Management |
| Bob `health` check fails in serverless mode | `health` is pod-only; not available in serverless | Use `ping` action via `/runsync` to verify Bob connectivity |

---

*Document maintained by Iron Eagle Security / OnSpace AI.  
Source of truth: [`docs/DECISIONS.md`](./DECISIONS.md) · [`docs/LESSONS_LEARNED.md`](./LESSONS_LEARNED.md)*
