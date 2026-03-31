# FreedomCamp Manager — Capability Overview

> **Who is this for?**
> This document is written for people who are considering using FreedomCamp Manager and want to understand exactly what the platform can do before they commit to it. It is split into two parts because the platform serves two distinct audiences who each interact with it in very different ways.
>
> - **Part 1 — Service Providers**: Councils, security contractors, and enforcement teams who run patrols, issue notices, and manage the day-to-day operation of freedom camping zones.
> - **Part 2 — Clients**: Property owners, parks managers, or local bodies who have contracted a service provider to manage their sites and want visibility into what is happening on the ground.

---

# Part 1 — The Service Provider

## What is FreedomCamp Manager?

FreedomCamp Manager is an end-to-end digital enforcement platform built specifically for freedom camping management in New Zealand. It replaces paper-based patrol processes, spreadsheet record-keeping, and phone-based communication with a single web application that connects your field officers, admin team, and clients in real time.

At its core the platform does five things:

1. **Scans vehicles** using the device camera or an ALPR (Automatic License Plate Recognition) feed and automatically checks them for compliance against the rules of the zone they are parked in.
2. **Manages breaches** by creating an alert queue, guiding officers through the correct enforcement workflow, and generating legally formatted notices.
3. **Tracks your officers** in real time — their GPS position, welfare status, and active shift — so your admin team always knows who is where and whether everyone is safe.
4. **Generates reports and evidence** for councils, courts, and internal review, including PDF notices, compliance charts, and exportable data.
5. **Runs multiple organisations** within a single platform with full data isolation, so a single contractor can manage contracts for multiple councils simultaneously without data crossing between them.

The platform is a Progressive Web App (PWA), which means field officers can install it on any smartphone like a native app, it works offline when connectivity drops, and it does not require downloading anything from an app store.

---

## The Admin Side — What Managers See

### Logging In and Navigating

When you open the application you are presented with a clean login screen. After entering your email and password, the system checks your role and, if you hold both an admin and officer role, offers you a portal selection screen — a large two-tile card asking whether you are entering the **Admin Portal** or the **Field Officer Portal**. This means supervisors who also do patrol shifts can switch seamlessly between the two views from any device.

### The Command Centre (Admin Dashboard)

The first screen after login for any admin is the **Command Centre**, a full-width dashboard designed to give you a situational picture of everything happening right now.

**What you see at the top:**
A row of five compact KPI (key performance indicator) tiles in a banner across the top of the screen, each with a colour-coded icon and a large number. These show:
- Total Observations (today or for the selected filter period)
- Compliance Rate (as a percentage, colour-coded green above 95% and red below)
- Active Breaches (count of unresolved breach alerts)
- Total Vehicles (unique plates seen)
- Active Patrols (officers currently on shift)

**Below the KPIs — the main grid:**
A three-column card grid carries the main operational content. Cards use a white background with a subtle border in light mode and a dark slate surface in dark mode. Each card has a colour-accented header icon, a bold title, a small description line, and its content below.

Key cards on this screen include:
- **Today's Roster** — lists every officer on shift today with their start time, current status badge (Active / Pending / Completed), and zone assignment. Click any name to jump to their live tracking view.
- **Module Grid** — every operational area of the platform is presented as a tile grid of navigation cards, each with a coloured icon and a one-line description. This is the primary navigation hub. Tiles are grouped by category (Scanning, Compliance, Enforcement, Patrol, Reporting, Admin).
- **Compliance Performance** — a small bar chart showing compliance rate over the last seven days with a quick-action link to the full compliance dashboard.
- **Recent Scans** — the last 20 observations across all zones shown in a compact list, with plate numbers, zone names, compliance status badges (green Compliant, red Breach, amber At Risk), and a Print Ticket button on any scan that can be converted to a notice.

A diagnostics drawer is available at the bottom of the dashboard for superusers; if any KPI queries fail silently it surfaces the specific database error so the issue can be traced without guessing.

**Dark Mode:** The entire interface supports full dark mode toggled from the top navigation bar. In dark mode the background becomes a deep slate-900, cards become slate-800, and accent colours remain their bright originals to retain readability. Officers doing night patrols frequently use dark mode to protect night vision.

---

## Vehicle Scanning — The Core Workflow

### How Scanning Works

Scanning is the operational heartbeat of the platform. There are three ways to capture a vehicle:

**1. Detail Scan (Recommended for single vehicles)**
The officer opens the Field Officer Portal and taps the blue **Detail Scan** card. The device camera opens in a full-screen dark overlay. The officer aims at the number plate and the system processes the image through a three-stage ALPR pipeline:
- Stage 1 runs a fast local pattern match on the captured image.
- Stage 2 sends the image to the AI inference service which applies an ONNX-based OCR model to extract the plate text.
- Stage 3 looks up the result in the database and runs the compliance engine.

The entire pipeline typically completes in under three seconds. While processing, a small spinner and progress bar animate over the camera preview.

**2. Bulk Scan (For sweeping a large area)**
The officer taps the yellow **Bulk Scan** card. The camera stays open and the officer can scan multiple vehicles in quick succession. Each scan is queued and processed in parallel. The recent scans panel updates in real time as results arrive so the officer can see which vehicles are clear and which require attention without stopping.

**3. Zoom Scan (For plates that are far away)**
A macro-zoom camera mode opens a telephoto-style view optimised for plates at 20–50 metres. Used for campervans parked on the far side of a field or behind barriers.

**Offline Mode:** If the device loses mobile data, scans are queued locally and automatically sync when connectivity resumes. The recent scans panel shows an amber "Queued (offline)" badge so the officer knows the result is pending rather than lost.

### What Happens After a Scan

Once a plate is read and matched:
- The vehicle's history is pulled from the database instantly.
- The compliance engine evaluates the vehicle against the zone rules (consecutive nights, monthly night limit, self-contained certification requirement, and any seasonal rules).
- The recent scans panel at the bottom of the Field Officer Portal displays the result as a row with:
  - A thumbnail of the vehicle photo (or a grey camera icon if no photo is stored yet)
  - The plate number in monospace bold font
  - A coloured compliance badge: **green = Compliant**, **red = Breach**, **amber = At Risk** (approaching the limit)
  - A **purple Homeless badge** if the vehicle is flagged with a confirmed homeless status (which affects how enforcement proceeds)
  - The zone name and timestamp in small grey text

**Actions available from each scan row:**
- **Warning** — issue an on-the-spot verbal warning and record it against the vehicle
- **Notice to Vacate** — begin the formal notice workflow with a pre-filled form
- **Infringement** — issue a fine; launches the infringement notice form
- **Print Ticket** — generate a PDF notice immediately

---

## Compliance Engine — How Rules Are Applied

### What Compliance Means

Each zone in the system has its own compliance matrix — a set of rules that define exactly when a vehicle is in breach. Common rules include:
- Maximum consecutive nights (e.g. no more than 3 nights in a row)
- Maximum nights per calendar month (e.g. no more than 7 nights per month)
- Self-contained certification required (NZSCV warrant must be current)
- Day visit only (no overnight stays permitted at all)
- Seasonal closures (zone shuts between certain dates)

The compliance engine evaluates every observation against the vehicle's full history in that zone and returns one of three results: **Compliant**, **At Risk**, or **Breach**.

### Compliance Dashboard

Navigating to the Compliance Dashboard from the module grid opens a metrics page with two sections:

**KPI Row (top):**
Four stat cards across the top — Total Observations, Compliance Rate %, Active Breaches, and Total Vehicles. Each is white-backgrounded with a coloured title (grey, green, red, blue respectively) and a very large bold number.

**Charts (below):**
A tabbed card lets you switch between **Jurisdiction View** (a bar chart grouping compliance by council/organisation) and **Specific Zone View** (same chart drilled down to individual zone level). A recharts bar chart renders with coloured bars — green for compliant, red for non-compliant — with tooltips showing exact counts on hover.

A **Recent Activity** timeline below the charts lists the last 20 compliance events in chronological order with icons indicating whether each was a breach, a resolution, or a new observation.

### Zone Management — Setting the Rules

The Zone Management page lists every geofenced area in a sortable, filterable table. At the top is a summary row of five small stat cards: Total Zones, Active, Inactive, Day Visit Only, and Requires SC (self-contained certification).

Each zone entry expands into a detail card showing:
- Zone name, status badge (Active / Inactive / Day Visit Only), and a small map preview
- Compliance rules panel with toggles for each rule type and numeric inputs for limits
- Legal & Governance section where you set the council bylaw reference, notice payment address, and objection process
- Seasonal rules where you can set open/closed date ranges

Editing a zone opens a slide-over panel with clearly labelled form sections. Changes save instantly and the compliance engine re-evaluates any vehicles currently in that zone against the new rules.

---

## Breach Management — From Alert to Resolution

### Breach Alerts Queue

When the compliance engine determines a vehicle is in breach it creates a breach alert. All active alerts appear in the **Breach Alerts** page, which is the most action-heavy screen in the platform.

**Layout:**
The page opens with a compact KPI banner showing:
- Open Alerts (red)
- Pending Acknowledgement (orange)
- Enforcement Started (blue)
- Resolved Today (green)
- Dismissed Today (grey)

Below the banner is the main alert list. Each alert is a large card with:
- Vehicle plate in large monospace font at top-left
- Breach type label (e.g. "Consecutive Night Limit", "No SCV Cert", "Monthly Limit")
- Zone name and first-seen timestamp
- Status badge in the header
- Officer avatar + name if assigned
- Three action buttons: **Acknowledge**, **Start Enforcement**, **Dismiss**

Clicking an alert card expands it to show the full vehicle history, a photo of the vehicle if available, all previous observations in that zone, and a **Decision Dock** — a panel with larger action buttons for issuing the appropriate notice type or escalating to a supervisor.

The **Evidence tab** within the expanded alert shows all linked photos with their GPS co-ordinates and timestamps. The **Rap Sheet tab** shows the vehicle's full compliance history across all zones.

**Status flow:**
`Pending → Acknowledged → Enforcement Started → Resolved` (or `Dismissed`)

---

## Notice Generation — The Legal Paper Trail

### Types of Notices

The platform generates four types of legally formatted notices as PDF documents:

| Notice Type | When Used |
|---|---|
| **Warning Notice** | First contact — records the warning without a fine |
| **Notice to Vacate** | Requires the occupant to leave the zone within a set time |
| **Infringement Notice** | A formal fine under the relevant bylaw |
| **Seizure Receipt** | Documents the seizure of property |

### Issuing a Notice

From any breach alert, scan result, or the Infringement Notices page, the officer clicks the relevant button. A form dialog slides in with:
- Pre-filled fields (plate, zone, officer name, organisation) pulled automatically from the observation
- Editable fields for fine amount, payment address, objection process details, and notes
- A **Preview** button that renders a live HTML preview of the notice in an iframe
- A **Generate PDF** button that calls the edge function and downloads a court-ready PDF within seconds

The generated PDFs are stored in Supabase Storage, linked to the observation, and accessible from the evidence tab of the breach alert indefinitely.

---

## Enforcement Command Centre

The **Enforcement Command Centre** is for supervisors managing multiple active enforcement actions simultaneously. It provides a consolidated view of everything happening across all zones.

**Layout:**
Six stat cards across the top — Active Breaches (red), Awaiting Response (orange), Officers Deployed (blue), Notices Issued (purple), Infringements (indigo), Resolved Today (green).

Below the stats, two vertical columns:
- **Left column**: active breach cards sorted by urgency, each with the plate, breach type, time since first detection, and the assigned officer
- **Right column**: a live activity feed showing every enforcement action taken in the last hour as a timestamped log entry

A dispatch button on each breach card opens an assignment dialog where the supervisor can assign or reassign the breach to any available officer, add notes, and set a response priority.

---

## Live Officer Tracking & Patrol Monitoring

### Live Patrol Monitor

The **Live Patrol Monitor** gives operations managers a real-time view of every officer in the field.

**Top row — six stat cards:**
- Officers Active (blue)
- Officers Rostered (purple)
- Officers Compliant / Welfare OK (green)
- Welfare Overdue (orange)
- Check-in Pending (indigo)
- Shifts Completed Today (grey)

**Main content:**
A two-column layout. The left side shows individual officer status cards — each card has the officer's name and avatar, current zone, shift start time, last known GPS position as a suburb name, last check-in time, and a welfare status badge (OK / Overdue / Critical). The right side shows a map view with officer pins.

Clicking an officer card expands a side panel showing their GPS trace for the current shift as a polyline on the map, a timeline of their check-ins, and any welfare alerts they have triggered.

### Welfare & Man-Down System

Every officer has a welfare check-in timer. The default configuration requires a check-in every 10 minutes with:
- A **Warning** alert to the admin at 10 minutes overdue
- An **Auto-logoff** prompt to the officer at 20 minutes overdue
- An **Admin escalation** (push notification) at 5 minutes past the warning

If an officer triggers the **Man-Down** button (or if their phone detects no movement for an extended period), the platform fires an emergency alert. On the officer's own screen a full-screen red banner pulses with the message "🚨 Man-Down Alert Active — Emergency alert sent to admin." On the admin side, the officer's card turns red and a push notification is fired to all available supervisors.

The **Field Officer Portal** always shows the welfare check-in status at the top of the screen — a green card showing "Welfare OK" with the countdown timer, or an orange card with "Check-in Overdue" when the timer has exceeded the threshold.

---

## Patrol Scheduling & Roster Management

### Roster Planner

The **Roster Planner** is a full-featured shift scheduling tool built as a calendar grid. The current week or month is displayed with each day as a column and each officer as a row. Shifts appear as coloured blocks within cells:
- Green = confirmed shift
- Blue = tentative
- Orange = open shift (available for pickup)
- Red = absent / uncovered

Supervisors drag and drop shifts between days and officers. Clicking a shift block opens a popover with shift details — zone assignment, start/end times, service type (Freedom Camping / Parking / Noise / Guard), and any special instructions.

### Open Shifts

The **Open Shifts** page lists all shifts without an assigned officer. Officers can view this page from their portal and claim an open shift. When claimed, the shift moves to their roster and the supervisor receives a notification.

### Patrol Checkpoints (QR / Lone Worker Protocol)

Patrol checkpoint management lets supervisors create geofenced checkpoint locations and print QR codes for them. Officers scan the QR at each checkpoint as they complete their patrol route. The **PatrolCheckpoint** scanner opens a full-screen camera with a QR detection overlay; scanning a valid code records the timestamp and GPS position and updates the checkpoint's status on the supervisor's patrol monitor.

---

## Vehicle Management & Registry

### Vehicle Management Page

The **Vehicle Management** page is the master registry of every vehicle the platform has ever scanned. At the top is a stat row with summary counts coloured by status (total, compliant, in breach, flagged, homeless-flagged).

The main content is a data table with:
- Columns: Plate, Make/Model (if enriched), Colour, Last Seen Zone, Last Seen Date, Compliance Status, Flags
- Filter bar above the table: search by plate, filter by status, filter by zone, date range picker
- Clicking any row opens the **Vehicle Detail** panel — a slide-over (or full page on desktop) showing the vehicle's photo history, full compliance record per zone, and all enforcement actions taken against it

**Vehicle Detail tabs:**
- **Vehicle Info** — make, model, colour, registration data, NZSCV certificate status with expiry date
- **Observations** — every scan of this vehicle, sorted newest first, with zone, compliance result, and photo thumbnail for each
- **KPIs** — total nights per zone this month/year, breach frequency chart, compliance history timeline

### Self-Contained Vehicle (NZSCV) Monitoring

The **NZSCV Monitor** page is a read-only dashboard for verifying which vehicles hold a current self-containment certification.

**Four stat cards across the top:** Total Records, Certified SCV, Not Certified, Expired Certificates.

Below the stats: a searchable table of all vehicles with SCV data — plate number, certification status badge, expiry date, and days until expiry (coloured amber when within 30 days, red when expired).

---

## Incident Management & Investigations

### Incident Reports

**Layout:** Six KPI stat cards across the top — Total, Critical (red), High (orange), In Progress (blue), Resolved (purple), Closed (grey).

Below the stats: an incident list where each item is a card showing incident number, type icon, severity badge, description excerpt, location, assigned officer, and status. Clicking an incident opens a full detail view with a timeline of updates, linked evidence photos, and a notes thread.

**Quick Report from the Field:** Officers in the Field Officer Portal can tap the **Report an Incident** card which opens a quick-report dialog without leaving the portal. The dialog has:
- A three-tile type selector with icons: H&S, Incident, Maintenance
- Dropdown for incident subtype
- Dropdown for severity
- Free-text description and action-taken fields
- Optional plate number linkage
- GPS auto-filled location with a manual override

### Investigation Case Management

The **Investigation Jobs** page is for managing formal investigations. Cases are displayed as a card list with a job number, case type, priority badge, status, and assigned investigator. Clicking a case opens a case file view with attached documents, interview notes, a linked evidence gallery, and a decision log.

---

## Reporting & Analytics

### Reports Page

The **Reports** page is the main export centre. It opens with a filter bar (date range, zone selector, organisation selector) and five tabs:

| Tab | Content |
|---|---|
| **Summary** | Charts: breach type breakdown (pie), breach status (pie), top offending vehicles (bar), enforcement actions count |
| **Observations** | Full table of up to 1,000 observation records with plate, zone, compliance status, date, officer |
| **Breaches** | All breach alerts in the period with status, type, resolution |
| **Zones** | Zone summary table with observation count and breach count per zone |
| **Enforcement** | All notices and actions taken in the period |

Each tab has an **Export CSV** or **Export Excel** button at the top right. A **Generate PDF Report** button at the top of the page triggers an edge function that compiles all the data into a formatted compliance report PDF, previewed in an iframe at the bottom of the page before downloading.

### AI Analysis

The **AI Analysis** page provides an intelligent conversational interface over your data. A chat-style panel lets you type questions in plain English — for example "Which zone had the most repeat offenders last month?" or "Show me the vehicles approaching their night limit" — and the system queries the database and returns a structured answer with supporting data tables and charts.

The chat input also supports **push-to-talk dictation** in compatible browsers (Chrome/Edge). Officers and admins can press and hold the microphone button, speak their question, then release to stop; speech is inserted into the chat input before sending.

### Hotspots Heatmap

The **Hotspots Map** renders an interactive map with a heat layer showing where observations cluster geographically. Areas with dense scan activity appear in red/orange, lower activity in green. Clicking a hotspot cluster shows the top vehicles in that area.

---

## Data Management & Integrity

### Import Tools

The **Import Data** page allows bulk upload of historical observation records from CSV or Excel files. A drag-and-drop upload area accepts the file, runs a column-mapping wizard to match your spreadsheet columns to the database schema, previews the first 20 rows for review, and then processes the import as a background job. The **Import History** panel below shows every previous import with status, record count, and error count.

### Data Integrity Dashboard

A live monitoring panel showing:
- Total records vs records with missing GPS
- Records with missing photos
- Records with conflicting zone assignments
- Duplicate plate records detected

Each issue category has a count and a **Fix** button that either auto-corrects or opens a guided review workflow.

### Audit Log

Every action taken in the platform — logins, notice generations, breach status changes, zone edits, user changes — is recorded in the audit log. The **Audit Log** page is a searchable table with columns for timestamp, actor (user name + role), action type, affected record, and old/new values. Exportable to CSV for council or court submission.

---

## Multi-Organisation Support

### Platform Overview (grand_master role only)

The **Platform** page is the highest-level view in the system, visible only to the platform owner role (grand_master). It shows every organisation running on the platform as a card grid with:
- Organisation name and logo
- Active officer count
- Observations this month
- Breach rate
- Contract status

Clicking an organisation card switches the platform into that organisation's context, allowing the platform owner to perform any admin action on behalf of that organisation for support purposes.

### Organisation Management

Each organisation has its own settings page (**Organisation Profile**) with:
- Name, logo, contact details
- Enforcement workflow setting (determines whether breaches go to admin first, officer first, or direct enforcement)
- Feature flags (which portal areas are enabled)
- NZSCV checking enabled/disabled toggle
- Notification preferences

### User Management

The **User Management** page shows all users in the organisation. The top row has stat cards: Total Users, Active (green), Admins (blue), Officers (red), Pending (yellow).

The main table lists every user with name, email, role badge, zone assignment, warrant expiry date, and status. Clicking a user opens an edit panel where admins can:
- Change role
- Reset password
- Set warrant/certification expiry dates
- Assign to zones
- Enable/disable the account

**Access Control** page lets administrators turn entire portal sections on or off per role, so a council client can be given access to the client portal only, while parking officers see only the parking enforcement portal.

---

## Specialised Portals for Other Enforcement Types

FreedomCamp Manager is not limited to freedom camping. The same platform infrastructure powers four additional enforcement portals:

### Parking Enforcement Portal
Full parking violation workflow — plate scanning, infringement notices with fine amounts, payment tracking, and dispute management.

### Noise Control Portal
Records noise complaints with address, decibel reading (manual entry), time of complaint, and links to the responding officer. Generates noise violation notices.

### Site Guard Portal
Simpler dashboard for static site security guards — shift log, incident reporting, visitor check-in, and direct communication with the operations centre.

### Dispatch Console
A CAD (Computer-Aided Dispatch) style interface for coordinating job dispatch across all service types. Incoming jobs appear on the left; officers are listed on the right with their current status. Drag a job to an officer to dispatch, or click the dispatch button to send automatically based on proximity.

---

## Notifications

### Notifications Centre

The **Notifications Centre** has three tabs:

- **Inbox** — all notifications received, sorted by priority (urgent = red bell icon with pulse animation, normal = yellow bell). Each notification shows title, body, and time. Mark as read or delete individually.
- **Broadcast** — available to admins, lets you send a message to all officers in an organisation simultaneously (e.g. "Zone 3 gate is locked tonight, use side entrance").
- **Preferences** — toggle which event types generate notifications for your account.

Push notifications are also supported on mobile devices via Expo/PWA push tokens, so officers receive alerts even when the app is in the background.

---

## Settings & Personalisation

Officers and admins can each manage their own profile at the **Profile** page:
- Name, contact details, profile photo
- Warrant and certification expiry dates
- Notification preferences
- Theme (light / dark / system)
- Language preferences

The **Settings** page covers application-level preferences: default zone view, date format, GPS accuracy threshold, and scan mode defaults.

---
---

# Part 2 — The Client

## Who is the Client?

The client in FreedomCamp Manager is the organisation that has contracted a service provider to manage freedom camping enforcement on their land or within their jurisdiction. This is typically:
- A district or city **council** that has engaged a security company to patrol their freedom camping zones
- A **Department of Conservation** site manager monitoring a specific reserve
- A **private property owner** or events company that has contracted enforcement for their site
- A **parks authority** monitoring carparks and recreational areas

As a client, you do **not** run the day-to-day operations — that is the service provider's job. Your role is to have **visibility and accountability** over what is happening on your land without needing to understand the operational detail.

---

## The Client Organisation Portal

When you log in as a client (role: `client_viewer`), you are taken directly to the **Client Organisation Portal** — a purpose-built dashboard that gives you exactly the information you need and nothing more. The full operational toolkit that patrol officers and admin managers use is hidden; you see a clean, focused view of your contracted zones.

### How It Looks

**Header:**
A white (or dark-mode slate) top bar shows your organisation name in bold, your logo if uploaded, and a sign-out button. There is no navigation sidebar — the entire experience is contained within this single portal page.

**Summary Stats Row:**
Immediately below the header, four large stat cards in a horizontal row:
- **Active Zones** — how many of your zones are currently being monitored (blue accent)
- **Patrols This Month** — how many patrol sessions have been conducted across your sites (green accent)
- **Breaches Detected** — total breach alerts raised in your zones (red accent)
- **Enforcement Actions** — total notices, warnings, and infringements issued on your behalf (orange accent)

These four numbers give you an instant health-check of your contract's activity at a glance every time you log in.

### The Five Information Tabs

Below the stat cards, the portal is organised into five tabs. You click between them to explore different aspects of your coverage.

---

### Tab 1 — Patrols

**What you see:**
A table of recent patrol sessions conducted by the service provider's officers in your zones. Each row shows:
- Date and time of the patrol
- Officer name (first name + last initial for privacy)
- Zone patrolled
- Duration (e.g. "1h 45m")
- Vehicles scanned count
- Outcome summary (e.g. "2 breaches detected, 1 warning issued")

**What it tells you:**
This tab answers the question *"Is my contract actually being serviced?"* You can see at a glance whether patrols are happening on the agreed schedule, in the agreed zones, and for the agreed duration. If a zone was not patrolled when it should have been, that will be visible here as a gap in the dates.

**How the UI works:**
The table is sorted newest-first. There is a date range picker at the top right so you can look back at any period. Clicking a patrol row expands it to show a more detailed summary including the GPS trace of that patrol session as a small map preview, the list of vehicles scanned, and any notes the officer recorded.

---

### Tab 2 — Breaches

**What you see:**
A list of every compliance breach detected in your zones. Each entry shows:
- The plate number of the offending vehicle (partially masked for privacy if configured — e.g. "ABC ***")
- The zone where the breach was detected
- The breach type in plain English (e.g. "Exceeded 3-consecutive-night limit", "No valid self-containment certificate", "Monthly night limit reached")
- Date and time first detected
- Current status badge: **Pending** (orange), **Enforcement Started** (blue), **Resolved** (green), **Dismissed** (grey)

**What it tells you:**
This tab answers *"Who is actually breaking the rules, and what is being done about it?"* You can see whether your most problematic recurring vehicles are being actioned consistently, whether breaches are being resolved or left open, and whether certain zones have a higher breach rate than others.

**How the UI works:**
Filters at the top of the list let you narrow by zone, breach type, and status. Clicking a breach entry expands it to show the full chronological history of that breach — when it was detected, when it was acknowledged, what notice was issued, and when it was resolved. If a PDF notice was generated you will see a **Download Notice** button.

---

### Tab 3 — Enforcement Actions

**What you see:**
A log of every formal enforcement action taken by the service provider's officers in your zones. Each row shows:
- Date and time
- Action type: Warning, Notice to Vacate, Infringement, or Seizure
- Zone
- Vehicle plate (partially masked if configured)
- Officer (first name + last initial)
- Status (Issued / Paid / Disputed / Cancelled)

**What it tells you:**
This tab answers *"What formal actions have been taken, and what were the outcomes?"* It is particularly useful for councils that need to report enforcement statistics to elected members, or for property owners tracking whether the agreed enforcement escalation process is being followed.

**How the UI works:**
A date range filter and action type filter are at the top. Clicking any row expands the full enforcement record. For infringements and formal notices, a **View Notice** button opens a preview of the generated PDF directly in the browser so you can see exactly what was issued in your name or on your property.

---

### Tab 4 — Zones

**What you see:**
A table listing every zone the service provider is monitoring for your organisation. Each row shows:
- Zone name
- Zone type (Freedom Camping, Day Visit Only, Parking, etc.)
- Status badge (Active / Inactive / Seasonal Closure)
- Key rules in plain text (e.g. "Max 3 nights consecutive, SCV required")
- Last patrol date
- Current vehicle count (vehicles observed in the zone in the last 24 hours)

**What it tells you:**
This tab answers *"What are the rules in each of my areas, and when were they last visited?"* It confirms that the rules configured in the system match what you have agreed with the service provider, and flags any zones that are active but have not been patrolled recently.

**How the UI works:**
Zones are listed in a sortable table. Clicking a zone row opens a detail card showing a small embedded map of the zone boundary (GeoJSON rendered on a base map), the full compliance rule matrix in plain-language format, and a patrol history calendar showing which days in the last month the zone was visited.

---

### Tab 5 — Sites

**What you see:**
All physical sites (properties, carparks, reserves, or managed areas) that your organisation has registered with the service provider. Each site entry shows:
- Site name and address
- Site type
- Assigned patrol zone(s)
- Contract status (Active / Paused / Pending)
- Primary contact for the site

**What it tells you:**
This tab answers *"What physical locations are covered under my contract?"* It is particularly useful for organisations managing multiple properties across a district, as it gives a single consolidated view of every site under the agreement.

**How the UI works:**
A search bar at the top lets you filter by site name or address. Clicking a site card opens a detail view with the site's full contract information, special instructions for officers, any known access issues, and a link to that site's patrol history.

---

## The Public Dispute Portal

If a member of the public wants to dispute a notice that was issued on your behalf, they can submit their dispute through the **Public Dispute Portal** — a simple public-facing web page (no login required) where they enter their notice reference number and submit their grounds for dispute.

Submitted disputes appear in the **Disputes** queue visible to the service provider's admin team, who manage the dispute resolution process. As a client you will typically be notified by your service provider when a dispute is lodged against a notice that was issued in your jurisdiction.

---

## What Clients Cannot Access

For data privacy and operational security, client viewers do not have access to:

- Individual officer names, contact details, or welfare information
- The operational administrative tools (user management, zone editing, data import)
- Financial information about other clients
- Any data from zones or organisations other than their own

The data isolation is enforced at the database level (Row-Level Security), not just at the UI level, so there is no risk of accidentally viewing another organisation's data.

---

## Getting Support as a Client

If you notice a discrepancy between what you see in the portal and what you expect — for example, a zone that has not been patrolled, a breach that appears to be unresolved, or a notice you were not expecting — the correct first step is to contact your service provider (the security or enforcement company you have contracted). They have access to the full operational detail and audit trail needed to investigate and explain any anomaly.

---

# Summary — Platform at a Glance

| Capability | Service Provider | Client |
|---|---|---|
| Vehicle scanning (ALPR + camera) | ✅ Full | ❌ |
| Compliance rule management | ✅ Full | 👁 Read-only |
| Breach alert queue & decision-making | ✅ Full | 👁 View resolved history |
| Notice & infringement generation | ✅ Full | 👁 Download issued notices |
| Live officer GPS tracking | ✅ Full | ❌ |
| Welfare & man-down monitoring | ✅ Full | ❌ |
| Roster & shift scheduling | ✅ Full | ❌ |
| Patrol history & logs | ✅ Full | 👁 Summary view |
| Zone configuration | ✅ Full | 👁 View rules |
| Reporting & data export | ✅ Full | ❌ |
| AI analysis & hotspot maps | ✅ Full | ❌ |
| User & access management | ✅ Full | ❌ |
| Multi-organisation oversight | ✅ Grand Master only | ❌ |
| Dispute management | ✅ Full | 👁 Receive outcome |
| Dark mode + mobile PWA | ✅ | ✅ |
| Push notifications | ✅ | ❌ |

**Legend:** ✅ Full access · 👁 Read-only view · ❌ Not accessible

---

*FreedomCamp Manager is developed and operated by Iron Eagle Security / OnSpace AI. For enquiries about the platform contact your account manager or visit the support portal.*
