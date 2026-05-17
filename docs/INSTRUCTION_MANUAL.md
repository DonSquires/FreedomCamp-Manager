# FieldOps Manager — Instruction Manual

**Platform**: Iron Eagle Security / OnSpace AI — Field Operations Management  
**Version**: 2026 (multi-organisation edition)  
**Timezone**: All dates and times operate in **NZ Standard / Daylight Time (Pacific/Auckland)**

> **Canonical product authority** — this manual defines what the application is intended to do and how users are meant to use it. It is not a passive dump of current implementation details.  
> If code, routes, role behavior, workflows, edge functions, schema-backed user flows, or operational UX change, the corresponding sections in this manual must be updated in the same change set.  
> If the app currently behaves differently from this manual, that drift is a defect to resolve or an explicit product decision to document here first.  
> Last reviewed: 2026-05-16

---

## Table of Contents

1. [Introduction & Overview](#1-introduction--overview)
1a. [UI/UX Design Standards](#1a-uiux-design-standards)
1b. [Star Trek Rollout Checkpoint Governance](#1b-star-trek-rollout-checkpoint-governance)
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
7. [PART E — Public Portals](#part-e--public-portals)
   - [7.1 Public Dispute Submission Portal](#71-public-dispute-submission-portal)
   - [7.2 Public Parking Prepayment Portal](#72-public-parking-prepayment-portal)
8. [PART F — Technical Reference (Systems Administrator)](#part-f--technical-reference-systems-administrator)
   - [8.1 Architecture Overview](#81-architecture-overview)
   - [8.2 Environment Setup](#82-environment-setup)
   - [8.3 Database & Migrations](#83-database--migrations)
   - [8.4 Edge Functions](#84-edge-functions)
   - [8.5 AI Services (Bob / Inference)](#85-ai-services-bob--inference)
   - [8.6 PTT / Push-to-Talk](#86-ptt--push-to-talk)
   - [8.7 System Diagnostics & Health](#87-system-diagnostics--health)
   - [8.8 User & Organisation Provisioning](#88-user--organisation-provisioning)
   - [8.9 Data Integrity & Cleanup](#89-data-integrity--cleanup)
   - [8.10 Security & Compliance Notes](#810-security--compliance-notes)
9. [Appendix A — Enforcement Document Quick Reference](#appendix-a--enforcement-document-quick-reference)
10. [Appendix B — Role Access Matrix](#appendix-b--role-access-matrix)
11. [Appendix C — Common Troubleshooting](#appendix-c--common-troubleshooting)
12. [Appendix D — CRO To-Do List](#appendix-d--cro-to-do-list)

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

### Ownership Terminology (Canonical)

To avoid ambiguity, this manual uses these terms consistently:

- **Platform Owner**: Iron Eagle Security / OnSpace AI (the software provider and platform operator).
- **App Owner**: A paying customer organisation that purchases use of the app from the Platform Owner.
- **Service Provider**: An organisation delivering field services.
- **Client**: The contracted end-customer receiving the service outcomes at sites/zones/locations.

An App Owner can operate in two valid business patterns:

1. **Direct Operator Pattern**
   - Platform Owner -> App Owner (operates as service provider) -> Client sites/zones/locations
2. **Contracted Provider Pattern**
   - Platform Owner -> App Owner (principal customer) -> Service Provider -> Client sites/zones/locations

In both patterns, the hierarchy is represented in `organizations` via `parent_organization_id`.

### Multi-Client Contractor Rule (Critical)

If a service provider (for example, First Security) serves multiple clients, including a client that directly contracts them, the provider must continue operating all clients concurrently in the same platform.

To support this safely:

- Do not re-parent the service provider per contract.
- Keep the provider's operational org context stable.
- Scope data flow by contract and site/zone assignment (service agreements and linked client sites), not by moving org hierarchy for each engagement.

This prevents cross-client leakage while allowing one provider to serve many clients at once.

---

## 1a. UI/UX Design Standards

> **This section describes how every part of the platform should look and behave.** Designers, developers, and QA testers use this as the acceptance standard. Operators and supervisors use it to understand what to expect from the interface.

### Shell Model

FieldOps Manager uses three distinct experience "shells". Each shell is optimised for a different working context. The visual chrome, density, and interaction model differ between shells, but the underlying design system and component language are the same.

| Shell | Who uses it | Density | Primary metaphor |
|---|---|---|---|
| **Officer Shell** | Field officers on mobile | Glove-safe, night-readable | Mission board → single active task |
| **Admin Shell** | Admins, admin officers on desktop/tablet | Standard → dense | Queue management and triage |
| **Master/Governance Shell** | Master, Grand Master | Standard | Policy, oversight, configuration |

The **Bob Workspace** (AI assistant panel) sits inside the Admin and Master shells as a slide-out panel. It is never a primary navigation destination — it is always assistive and supplementary.

---

### Page Anatomy

Every page in the platform follows this structure, top to bottom:

```
┌─────────────────────────────────────────────────────┐
│  TOP BAR  Org selector │ Search │ Alerts │ Profile  │
├──────────────────────────────────────────────────────┤
│  GLOBAL FILTER RIBBON  Date range │ Org filter      │
│  (admin/master shells only)                         │
├────────────────────────────────────────────────────-─┤
│  PAGE HEADER  Title + breadcrumb + primary action   │
├──────────────────────────────────────────────────────┤
│  STATUS STRIP  Live status indicators / alert badge │
├──────────────────────────────────────────────────────┤
│  PRIMARY ACTIONS  Max one main action, ≤2 secondary │
├──────────────────────────────────────────────────────┤
│  FILTERS / SEARCH                                   │
├──────────────────────────────────────────────────────┤
│  CONTENT AREA  (table / cards / map / form)         │
├──────────────────────────────────────────────────────┤
│  AUDIT TRACE  Last modified by / timestamp (detail) │
└──────────────────────────────────────────────────────┘
```

**Rules:**
- One primary action per page. It is always the rightmost button in the Page Header, coloured with the brand primary colour.
- Status indicators always use the four-state scale: **normal** (grey/green) · **watch** (amber) · **action** (orange) · **critical** (red). They are never colour-only — always paired with a text label or icon.
- Empty states always provide a call-to-action explaining what to do next (not just "No data").
- Error states always provide an actionable recovery option (retry, contact support, or a specific corrective action).
- Loading states show a skeleton that matches the layout of the content being loaded, not a spinner alone.

---

### Design Tokens & Themes

The platform uses a layered token system:

| Layer | Examples |
|---|---|
| **Core tokens** | `--color-brand-primary`, `--spacing-4`, `--radius-md`, `--elevation-2` |
| **Semantic tokens** | `--color-success`, `--color-warning`, `--color-breach`, `--color-queued`, `--color-offline` |
| **Context tokens** | `--theme-night-patrol`, `--theme-high-contrast`, `--theme-dispatch-mode` |

**Available themes:**
- **Light** (default) — standard office use
- **Dark** — low-light environments
- **Night Patrol** — maximum contrast, reduced blue light, enlarged touch targets; designed for outdoor use at 2 AM
- **High Contrast** — WCAG AAA contrast ratios; required for vision-impaired users

Theme is set per user in their Profile settings and persists across sessions. Supervisors can remotely set a default theme for all devices in their organisation from Organisation Settings.

---

### Component Density Tiers

| Tier | Context | Characteristics |
|---|---|---|
| **Glove-safe** | Officer portals, night patrol | Touch targets ≥ 44×44 px; large text (≥ 16px body); generous spacing; single-column layout |
| **Standard** | Admin portal, client portal | Touch targets ≥ 32×32 px; normal text density; multi-column layouts permitted |
| **Dense** | Dispatch console, command centre, KPI boards | Compact table rows; information-dense cards; maximum data per viewport |

Officers always experience the **glove-safe** tier. Admins default to **standard** but can switch specific pages (e.g. Dispatch Console, Command Centre) to **dense** via a toggle in the page header.

---

### Card Taxonomy

All cards in the platform belong to one of five types:

| Type | Purpose | Key elements |
|---|---|---|
| **Metric card** | Show a single KPI number | Number, label, trend arrow, colour indicator |
| **Workflow card** | Represent one item in a queue | Title, status badge, assigned-to, action buttons |
| **Alert card** | Surface an active alert needing attention | Severity colour, icon, description, acknowledge/dismiss |
| **Queue card** | Compact row-card for high-volume lists | Plate/ID, zone, status, timestamp, primary action |
| **Task card** | Rostered task or pending assignment | Task name, due time, officer, status |

---

### Accessibility Standards

The platform must meet **WCAG 2.2 AA** as a minimum. Key requirements:

| Criterion | Requirement |
|---|---|
| **Focus visibility** (2.4.11) | Keyboard focus indicator is never obscured by other elements in any admin view |
| **Dragging alternatives** (2.5.7) | Every drag action (e.g. Enforcement Command Centre kanban) has a non-drag alternative (e.g. status dropdown in the card) |
| **Target size** (2.5.8) | All interactive elements in officer/glove-safe tier are ≥ 44×44 px; minimum 24×24 px in all other contexts |
| **Consistent help** (3.2.6) | The Bob AI button, feedback button, and support link appear in the same position on every page |
| **Redundant entry** (3.3.7) | Data already known to the system (zone, officer name, plate from a scan) is pre-filled in all forms; the user is never asked to re-enter it |
| **Accessible authentication** (3.3.8) | Login and password reset never rely solely on CAPTCHA; field officers can log in using biometric device unlock |
| **Reduced motion** | All animated transitions respect `prefers-reduced-motion` — animations fall back to instant transitions |
| **Colour + text** | Colour meaning is always paired with a text label or icon; nothing is communicated through colour alone |
| **Screen reader** | All critical officer workflow paths have ARIA labels; all icons have accessible names |

---

### Performance Budgets

| Shell | Metric | Target |
|---|---|---|
| Officer Shell | Time-to-interactive (first patrol action available) | < 2.5 s on 4G median |
| Officer Shell | Action feedback latency (scan result returned) | < 150 ms perceived (optimistic UI) |
| Admin Shell | Initial queue data load | < 2.0 s |
| Admin Shell | Filter response (date range / org change) | < 300 ms |
| Master Shell | Governance pages load | < 2.5 s |
| All shells | Route chunk size | < 250 KB gzip per route (lazy loaded) |

---

### Offline-First Officer UX

Officers regularly work in areas with no mobile data. The platform must behave correctly offline:

| Action | Expected UI behaviour |
|---|---|
| **Scan a vehicle** | Scan is processed locally; result card shows **amber "Queued (offline)"** badge; scan is synced on reconnect |
| **Issue a notice** | Notice is queued; temporary reference number is shown; notice is finalised and numbered on sync |
| **Print a notice** | Works if the HTML was already cached; "Connect to network first" message if not yet generated |
| **Update job status** | Queued and synced on reconnect |
| **Welfare check-in** | Cached locally and synced; if offline for > 2× the check-in interval, a local device alert fires |

**Sync queue indicator**: A persistent amber badge in the top navigation counts the number of queued actions. The badge disappears when all items are synced. Officers must clear the queue before ending their shift — the shift end confirmation screen shows an error if unsynced items remain.

---

### Field Portal Chrome Elements

Every officer portal has two persistent UI elements:

#### Field Safety Bar (top of screen)

```
┌───────────────────────────────────────────────────────────────┐
│ 🟢 Welfare check: OK  │  Next check in 23 min  │  🚨 SOS    │
└───────────────────────────────────────────────────────────────┘
```

- Shows current welfare check status (green/amber/red)
- Countdown to next welfare check-in
- **SOS button** (red) — sends immediate emergency alert to all supervisors with GPS coordinates, triggers priority PTT broadcast, and locks the screen to emergency mode until acknowledged by a supervisor
- Tapping the welfare status opens the welfare check-in dialog

**Welfare check-in dialog:**
- A large **I'm OK** button (full-width, green)
- Optional note field
- If not acknowledged within the configured interval (default 30 minutes), the status turns amber (overdue) and supervisors are notified
- If not acknowledged within 2× the interval, status turns red (man down) and escalation contacts are alerted

#### PTT Bar (bottom of screen)

```
┌───────────────────────────────────────────────────────────────┐
│  Channel: Alpha 1  │  ████████ PTT HOLD TO TALK  ████████   │
└───────────────────────────────────────────────────────────────┘
```

- Channel name on the left
- **PTT button** — hold to transmit, release to end; a pulsing animation indicates active transmission
- Incoming transmissions show the speaker's name in a banner above the bar
- Emergency transmissions show a red pulsing banner that cannot be dismissed until the transmission ends

#### Phase 2: Universal Translator Audio Behavior

The radio console now operates with two coordinated audio paths:

1. **Stream A — Co-worker PTT**
   - Continue using hold-to-talk for team voice traffic.
   - Incoming team voice remains the primary tactical channel.
2. **Stream B — Bob Intercom**
   - Bob can be triggered by wake phrase: **Hey Bob**.
   - Bob interpreter speech can be relayed from the interpreter panel using **Bob Intercom Speak**.

Wake and interaction rules:

- Saying **Hey Bob** opens the interpreter pathway and starts speech capture for translation input.
- Hold-to-talk remains authoritative for co-worker transmission and is not replaced by wake-word mode.
- Wake-word detection uses a short cooldown window to avoid repeated accidental triggers.

Audio ducking safety rule:

- When Bob intercom speech is active, co-worker playback volume is reduced to **20 percent**.
- When Bob speech ends, co-worker playback is restored to normal volume.
- Officers can toggle ducking on or off from the interpreter controls.

Operational outcome:

- Officers can stay eyes-up and continue co-worker PTT while receiving translated Bob relay output without channel masking or full-volume overlap.

---

### Iron Eagle Tactical Design Language

> **Copilot instruction — locked aesthetic:** Every page, component, and micro-interaction must conform to the rules below. This is not optional; it is the visual identity of the platform.

The Iron Eagle Visual Identity is a **dark tactical** design language derived directly from the Iron Eagle Security brand: **Black · Red · White/Silver**. It is applied through the token system described in the section above — never through per-component hardcoded colours.

#### Palette Reference

| Token | Hex | Usage |
|---|---|---|
| `--color-bg-base` | `#121212` | Global page background (all shells) |
| `--color-bg-surface` | `#1E1E1E` | Card, panel, modal surfaces |
| `--color-bg-elevated` | `#2A2A2A` | Hover states, dropdowns, tooltips |
| `--color-brand-primary` | `#D32F2F` | Primary action buttons, active nav states |
| `--color-brand-hover` | `#B71C1C` | Hover/pressed state on primary actions |
| `--color-accent-silver` | `#9E9E9E` | Borders, inactive icons, standby states |
| `--color-accent-silver-light` | `#BDBDBD` | Secondary labels, helper text |
| `--color-text-primary` | `#FFFFFF` | All primary body text and headings |
| `--color-text-secondary` | `#E0E0E0` | Secondary text, table data, metadata |
| `--color-critical-alert` | `#C62828` | Armed Danger and Welfare critical alerts **only** |
| `--color-critical-border` | `#EF5350` | Pulsing screen-border during Armed Danger events |

> **Rule:** `--color-critical-alert` and `--color-critical-border` are **strictly reserved** for Armed Danger and Welfare man-down events. They must never be used for general error states or informational warnings.

#### Typography

- **Font family**: `Inter, Roboto, sans-serif` — in that order of preference.
- **Body / data text**: 14–16 px, `--color-text-primary` (`#FFFFFF`) on dark surfaces.
- **Labels and helper text**: 12–13 px, `--color-text-secondary` (`#E0E0E0`).
- **Headings**: Semi-bold (600) weight; same white palette.
- No decorative or serif fonts are used anywhere in the operational platform.

#### Application per Context

**1. Login & Standby Screen**

- Background: `--color-bg-base` (`#121212`) — full-bleed dark.
- Iron Eagle Security logo centred, with a subtle white drop-shadow (`box-shadow: 0 0 24px rgba(255,255,255,0.08)`) to create a "secure terminal" glow effect.
- Sign In button: solid `--color-brand-primary` (`#D32F2F`), white label text, full-width on mobile.
- Input fields: dark surface (`--color-bg-surface`) with a silver border (`--color-accent-silver`) that brightens to `--color-text-primary` on focus.
- No light or white backgrounds on the login page.

**2. Active Mission Interface (Officer Shell)**

- All panel and card surfaces use `--color-bg-surface` on a `--color-bg-base` page background.
- **PTT and Start Shift buttons**: `--color-brand-primary` fill — the officer's eye goes straight to the action button.
- **Active transmission indicator**: `--color-brand-primary` pulsing ring around the PTT button.
- **Map style**: Mapbox "Dark Tactical" custom style. Officer location markers use `--color-brand-primary`. Patrol route lines use a blue accent (`#1565C0`). Zone boundaries use `--color-accent-silver`.
- **Radio "Active" indicator**: `--color-brand-primary` dot + label, never amber or green.
- **Welfare OK / safe state**: Maintains the standard four-state scale (normal = grey-green, watch = amber, action = orange, critical = red). The brand red (`--color-brand-primary`) is **not** used for normal welfare states — only `--color-critical-alert` for man-down.

**3. Admin & Master Shells**

- Navigation sidebar background: `--color-bg-surface`.
- Active navigation item: left border in `--color-brand-primary`; text colour `--color-text-primary`; background `--color-bg-elevated`.
- Inactive icons: `--color-accent-silver`.
- Primary action buttons (e.g. "Authorize", "Export", "Create"): `--color-brand-primary` fill.
- Table rows, card borders, and dividers: `--color-accent-silver` at 30–40% opacity.

**4. Bob AI Interaction**

- The Ask Bob button idle state: outlined, `--color-accent-silver` border, white icon.
- When Bob is **thinking** (awaiting response): a slow red pulsing ring — `box-shadow: 0 0 0 4px rgba(211,47,47,0.4)` — animates around the button, cycling at 1.5 s. Animation respects `prefers-reduced-motion` (falls back to a static red outline).
- When Bob is **speaking**: the ring changes to a solid `--color-brand-primary` border (not pulsing).
- Bob's response cards use `--color-bg-surface` with a `--color-brand-primary` top border accent (3 px) to visually anchor the AI response.

**5. Armed Danger Micro-Interaction**

- When an Armed Danger alert is triggered, the **entire viewport border** pulses in `--color-critical-border` (`#EF5350`).
- Implementation: a fixed-position overlay element (`pointer-events: none; z-index: 9999`) with a `box-shadow: inset 0 0 0 4px #EF5350` that animates at 0.8 s intervals using `@keyframes danger-pulse`.
- The pulse continues until a supervisor acknowledges the alert.
- The animation respects `prefers-reduced-motion` — if set, replace the pulse with a static `#EF5350` border (no animation) plus an audible chime.

---

## 1b. Star Trek Rollout Checkpoint Governance

This manual is checkpoint-coupled to the active phased rollout defined in [docs/STAR_TREK_PHASED_ROLLOUT_PLAN.md](docs/STAR_TREK_PHASED_ROLLOUT_PLAN.md).

Normative authority rules:

1. This manual describes intended product behavior, user workflow, and operational expectations.
2. Implementation changes must conform to this manual, or this manual must be explicitly updated first in the same change set.
3. No route, role-access, workflow, edge-function-backed user flow, or major UI behavior change is complete until the corresponding manual section is updated.
4. Review workflows may compare the app against the manual, but they must not silently rewrite the manual to match accidental implementation drift.

Required governance at every Star Trek phase checkpoint:

1. Update this manual with user-facing behavior changes introduced by the phase.
2. Update [docs/STAGING.md](docs/STAGING.md) in the same change set with execution evidence and PASS/FAIL outcome.
3. Do not declare phase completion unless both manual and staging updates are present.

Phase-to-manual update scope:

1. Phase 1 (Director): roster gate, welfare-only standby path, pre-shift tool restrictions.
2. Phase 2 (Universal Translator): dual-path audio, wake-word/hold-to-talk logic, audio ducking behavior.
3. Phase 3 (Sentient XO): Bob memory behavior, command gap prompts, administrative actuation rules.
4. Phase 4 (Admiral's Bridge): tactical map alerts, pre-arrival safety dossier behavior, human signature requirement for enforcement print.

### Phase 4 Checkpoint Validation (2026-05-15)

**Status: COMPLETE — Unit tests and browser E2E all passing**

Phase 4 (Admiral's Bridge: Welfare and Enforcement) introduces three critical hardening features:

1. **Tactical Map Emergency Escalation**: When an `armed_danger` or `sos_alert` is active, the operations map displays a live emergency broadcast banner with officer name and GPS coordinates. The tactical map border pulses in warning red to escalate attention.

2. **Pre-Arrival Safety Dossier**: Before issuing a Notice to Vacate, officers receive a 24-hour zone-level summary calculating risk from observations, incidents, welfare alerts, and aggression signals. This dossier informs enforcement judgement and provides evidence trail for legal robustness.

3. **Human Signature Fire-Control Key**: The notice print button is disabled until the officer enters their name as a digital signature and explicitly clicks "Authorize Print". This gate ensures human accountability and prevents accidental mass-printing.

**Validation Evidence (2026-05-15):**

| Component | Unit Test | Browser E2E | Status |
|---|---|---|---|
| Emergency banner + GPS broadcast | ✅ `phase4Emergency.test.ts` (3 tests) | ✅ `phase4-admirals-bridge.spec.ts` | PASS |
| Safety dossier risk scoring | ✅ `enforcementPhase4.test.ts` (2 tests) | ✅ `phase4-admirals-bridge.spec.ts` | PASS |
| Signature gate validation | ✅ Unit helper logic | ✅ `phase4-admirals-bridge.spec.ts` | PASS |
| Tactical map + welfare alerts | ✅ Unit helper logic | ✅ `phase4-admirals-bridge.spec.ts` (5/5 — 32.1s) | PASS |

**Browser E2E Confirmation (2026-05-15):**  
Native Chromium was installed in the Alpine development container (`apk add --no-cache chromium`) and the full Star Trek E2E suite was executed. All four phases pass on the native Chromium runtime:

| Phase | Spec | Result |
|---|---|---|
| 1 — Director | `phase1-director-roster-gate.spec.ts` | ✅ PASS 5/5 |
| 2 — Universal Translator | `phase2-universal-translator.spec.ts` | ✅ PASS 5/5 |
| 3 — Sentient XO | `phase3-sentient-xo.spec.ts` | ✅ PASS 5/5 (39.7s) |
| 4 — Admiral's Bridge | `phase4-admirals-bridge.spec.ts` | ✅ PASS 5/5 (32.1s) |

All Star Trek rollout exit criteria are met. Root-cause analysis confirmed the earlier Phase 1/2 failures were environment-expected redirects (officer without active roster shift → `/officer-home`) resolved by switching the Phase 2 radio test identity to Bob.

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
### 2.3a Phase 1: Officer Roster Gate & Welfare Standby (Director Phase)

**Who sees this:** Field officers (officers and officer-admins)
**What it does:** Ensures officers cannot access tactical tools without an active shift assignment

#### When you log in without a shift assignment

If you log in and **do not have an active roster shift** for today:

1. You are automatically redirected to the **Welfare Standby Screen** (`/officer-home` — the legacy `/waiting-for-shift` path redirects here automatically)
2. The screen displays:
   - Your name, organisation, and photo
   - A **waiting status** message: "You are not currently assigned to a shift"
   - A **refresh button** to check for updates (roster updates are pulled every 30 seconds automatically)
   - Access to the **Emergency button** and basic wellness check-in tools only
3. Tactical modules (patrol zones, incident tracking, notices, etc.) are **hidden** and inaccessible
4. **Channel/PTT access** is restricted to SOS-only (Emergency mode)

#### Pre-shift window (coming in Phase 1 v2)

When your shift is scheduled to start within the next 15 minutes:

- The system will automatically transition you to the field officer portal
- During the 15-minute window, only **Radio (PTT)** and **Emergency tools** are available
- Other tactical modules unlock after the shift start time passes

#### When you log in with a scheduled shift

If you log in and **do have an active roster shift** for today:

1. You are directed automatically to the **field-officer portal** and your assigned site/zone
2. All modules relevant to your shift type are immediately available
3. The site-tool permissions (ALPR, Noise, Site Guard) depend on whether your roster record grants access for this specific site

#### Roster updates during your session

- Roster assignments are cached for 60 seconds
- If a new roster entry is created for you, the cache updates on the next poll cycle (max 60 second lag)
- If you think you should have access but don't, try the **refresh** button on the welfare screen, or log out and log back in

### 2.3c Phase 3: Sentient XO (Bob Memory and Administrative Actuation)

**Who sees this:** Bob users with admin-authorized workflows
**What it does:** Bob keeps operational memory context and can execute validated setup actions by command.

#### Persistent memory behavior

When you use Bob for operational setup and dispatch workflows, Bob now stores and reuses:

1. Recent preferred site context
2. Common phrases used in setup requests
3. Recent shift intent patterns (day/night/standard)
4. Friction events from failed or incomplete commands (for follow-up guidance)

This memory is used to improve future prompts and reduce repeated data entry.

#### Administrative actuation behavior

For valid setup commands (example: creating a new client/site/shift bundle), Bob can execute a guarded actuation path that:

1. Validates organization and actor context
2. Validates required fields before any write
3. Creates records in sequence (client, site, shift)
4. Applies baseline rate rules and conflict checks
5. Returns a success summary or a clarification request

#### Gap detection and missing-field prompts

If required data is missing, Bob will not write partial records. Instead Bob asks a targeted follow-up question, such as:

- Missing client name
- Missing site address
- Missing shift start time
- Overlap confirmation needed for conflicting shift times

If emergency priority mode is active, Bob blocks administrative provisioning and returns an explicit safety-first message.

#### Operator expectation

- Successful commands produce an immediate completion summary.
- Incomplete commands produce a clarification question and wait for your answer.
- Blocked commands include a reason and preserve context for retry once constraints clear.

### 2.3d Phase 4: Admiral's Bridge (Welfare and Enforcement)

**Who sees this:** Administrators, supervisors, and officers issuing enforcement notices
**What it does:** Adds emergency tactical escalation visibility and a mandatory human fire-control key for legal print actions.

#### Tactical map emergency escalation

When a welfare alert includes SOS / armed-danger indicators:

1. The operations map enters emergency mode with a red pulsing map border.
2. A persistent emergency broadcast banner appears with the officer name and live GPS coordinates.
3. Supervisors can use the displayed coordinates as immediate dispatch guidance while the alert remains active.

This behavior is intended to satisfy the Phase 4 check-and-balance requirement for armed-danger keyword escalation.

#### Pre-arrival safety dossier (last 24 hours)

Before issuing a Notice to Vacate for a selected zone, the issue workflow now displays a **24h Pre-arrival Safety Dossier** with:

1. Observation count in the last 24 hours.
2. Incident count in the last 24 hours.
3. Welfare alert count in the last 24 hours.
4. Aggression/friction signal count extracted from note text.
5. Computed risk badge: low, medium, high, or critical.

Operators must review this dossier before site arrival and adapt approach/de-escalation posture to the risk level shown.

#### Enforcement print authorization (fire-control key)

Notice preview now enforces a human-in-the-loop print gate:

1. Officer opens notice preview.
2. Officer types a digital signature (full account name).
3. Officer clicks **Authorize Print**.
4. Print button remains disabled until authorization succeeds.

This guarantees Bob/system drafting does not bypass human legal authorization for printed enforcement output.

#### Phase 4 operational checkpoint note (2026-05-14)

During live staging operations, dashboard card copy can vary by organization data shape and load timing. Operator success criteria for Admiral's Bridge workflows are therefore:

1. Tactical and welfare routes are reachable (`/live-tracking`, `/admin/dashboard`, `/officer-welfare-alerts-log`, `/officer-welfare`).
2. Armed-danger mode can be armed in Bob Assistant and administrative write intent remains safety-gated while emergency mode is active.
3. Welfare escalation surfaces remain navigable even when card wording differs between tenants.

This preserves Phase 4 intent while avoiding false negatives caused by non-critical wording variance.

#### Deferred checkpoint retest window (Bob enrichment busy)

When Bob is actively running enrichment/supervisor background work, Star Trek checkpoint timing can temporarily fluctuate. During these windows, operators should defer repeated immediate reruns and use the idle-aware scheduler:

1. Start deferred retest: `npm run e2e:bob:retest:after-idle -- --idle-minutes=30 --max-wait-minutes=720 --poll-seconds=60 --require-activity-since-start=1`
2. Scheduler waits for fresh Bob activity after startup, then triggers retest only after the configured idle period.
3. Retest records are written to `tools/retest-schedules/` for staging evidence.

This procedure reduces false negatives while preserving checkpoint evidence quality.

---

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

After login, the Admin Hub is your home screen. It is a card-based landing page with live metrics, direct-entry cards for each major module, and quick links for common sub-pages.

**Reading the hub:**
- Each card represents a major functional area such as Operations, Compliance, Dispatch, Reports, CRM, or a specialist workflow.
- Every card carries a live metric badge so you can see queue pressure before opening the module.
- Quick links inside a card open high-frequency sub-pages directly.
- Click the card title or **Open →** to enter the full module workspace.

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
- **Sticky priority-action bar**: keeps live breach, welfare, and patrol counts plus shortcuts to Breaches, Welfare, Dispatch, and Reports visible while you scroll

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

**Enforcement escalation decision guide:**

Follow this decision path when actioning a breach. The system will suggest the correct action based on the vehicle's history, but officers must confirm.

```
Vehicle Scan → Compliant?
  YES → No action needed. Record is logged.
  NO  → First offence in this zone? No prior history?
          YES → Issue Warning Notice (record in system)
                → Vehicle returns in breach again?
                     NO  → Continue monitoring
                     YES → Issue Infringement Notice (FCA s.20, $200 fine)
          NO  → Prior warning already issued?
                     YES → Issue Infringement Notice
                     NO  → Prior infringement on record?
                               YES → Review with supervisor → possible court referral
                → Stay limit exceeded? Vehicle still present?
                     YES → Issue Notice to Vacate (24–48 hr deadline)
                           → Did vehicle comply by deadline?
                                YES → Close — vehicle departed
                                NO  → Escalate to supervisor
                                      → Homeless flag on vehicle?
                                           YES → Welfare check required first
                                                 Do NOT tow without supervisor authorisation
                                           NO  → Tow request or further infringement
```

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

Manages infringement notices that have been formally disputed by the recipient.

**How a dispute reaches this page:**  
When an officer issues an infringement notice, the notice includes a printed QR code and the public URL `fcmanager.co.nz/dispute`. The recipient can scan the QR code on their physical ticket, which opens a pre-filled dispute form in their browser — no account required. They enter their ticket number and vehicle registration to verify identity, describe their grounds for dispute, and attach evidence (permit photos, signage photos, etc.). The dispute submission is received and stored automatically, and an AI analysis is run in the background. This dispute then appears in the admin Disputes page.

1. Navigate to Sidebar → Compliance → **Disputes**.
2. The dispute list shows: notice number, plate, dispute received date, grounds summary (from AI analysis), AI confidence score, and current status.
3. **To process a dispute:**
   - Click the dispute row to open it.
   - Review the dispute grounds, AI analysis summary, attached evidence, officer notes from the scene, and the original notice.
   - Choose: **Uphold Notice** (dispute rejected, notice stands), **Withdraw Notice** (dispute accepted, notice cancelled), or **Refer for Review** (send to senior officer or council).
   - Add a decision note — this is the official decision record.
   - Click **Save Decision** — the notice and dispute statuses update; a confirmation email is automatically sent to the disputant.
4. Upheld disputes: the infringement notice remains active. Withdrawn disputes: the notice is marked withdrawn and the fine is zeroed.

> **Decision audit trail**: All dispute decisions are logged with the deciding officer's identity and timestamp. This record cannot be edited after saving.

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
| Patrol Schedule Management | `/patrol-schedule` | Set up recurring patrol routes |
| Patrol KPI Dashboard | `/patrol-kpis` | Performance metrics per officer and zone |
| Roster Planner | `/roster` | Build and publish shift rosters |
| Open Shifts | `/open-shifts` | View and fill unfilled shifts |
| Timesheet Review | `/timesheets` | Review and approve officer timesheets |
| Officer Availability | `/availability` | View officer availability for scheduling |
| Officer Skills | `/officer-skills` | Skill and qualification records per officer |

---

###### Patrol Schedule Management (`/patrol-schedule`)

Patrol schedules define *when* and *where* officers are expected to patrol. A patrol schedule record is an admin-authored template that generates individual patrol session records when an officer starts their shift.

**Creating a patrol schedule:**

1. Navigate to `/patrol-schedule` → **New Schedule**.
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

###### Roster Planner (`/roster`)

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

###### On-Call Rostering & Callout Shifts

Security and enforcement operations require 24/7 coverage. Rather than staffing full shifts around the clock, the system supports **on-call rostering** where officers are paid a fixed availability rate and only receive full shift pay when actually called out.

**How to navigate:**  
Sidebar → Roster → **On-Call Periods** (`/on-call-periods`) or Sidebar → Roster → **Callout Shifts** (`/callout-shifts`)

**Key business rules:**
- Officers on call receive a flat **on-call availability rate** for the on-call period (e.g. $60 for a 12-hour overnight on-call block)
- When called out, a minimum of **3 hours pay** is guaranteed regardless of actual time worked
- Hours worked beyond the 3-hour minimum are paid at the **after-minimum rate**
- Travel to and from the callout location is separately compensated as a **travel allowance** (by distance, by time, or both)
- On-call periods can be positioned **before** or **after** a regular rostered shift at different rates

**Creating an on-call period:**

1. Navigate to Sidebar → Roster → **On-Call Periods**.
2. Click **+ New On-Call Period**.
3. Fill in:
   - **Officer** — select from the available officer list
   - **Period type** — `standard` (standalone), `before_shift`, `after_shift`, or `overnight`
   - **Start / end time** — the window the officer must remain available
   - **Rate** — select from the configured rate list or enter a custom flat rate
   - **Linked shift** (optional) — attach to a rostered shift for before/after on-call
4. Click **Save** — the officer is notified and must **Accept** the on-call assignment from their home screen.

**Processing a callout:**

When a job comes in during an on-call period:
1. In the Dispatch Console, the officer's on-call status is shown on their resource card (moon icon).
2. Dispatch the job to the officer as normal.
3. The system automatically creates a **Callout Shift** record linked to the on-call period.
4. The callout shift tracks: `callout_received_at`, `departed_at`, `arrived_at`, `work_started_at`, `work_ended_at`, `returned_at`.
5. The officer updates these timestamps from the field portal as they progress through the callout.

**Pay calculation example:**

| Component | Calculation | Amount |
|---|---|---|
| On-call pay (12hr overnight) | Flat rate | $60.00 |
| Callout work (45 min actual, 3hr minimum) | 3 hrs × $45/hr | $135.00 |
| Additional work (over 3hr minimum) | 0 hrs × $35/hr | $0.00 |
| Travel (40 km round trip) | 40 × $0.85/km | $34.00 |
| Travel time (1 hr) | 1 hr × $25/hr | $25.00 |
| **Total** | | **$254.00** |

**Travel allowances:**

A travel allowance record is created per callout. It records:
- Journey type (`outbound`, `return`, or `round_trip`)
- Origin office (for jurisdiction boundary calculation)
- Distance in km
- Travel duration in minutes
- Whether the travel was outside the officer's normal jurisdiction

Travel is only payable outside the officer's normal jurisdiction unless the service agreement specifies otherwise. The system calculates distance using the officer's registered office location as the reference point.

**Payroll export:**  
On-call pay, callout pay, and travel allowances are combined per officer on the Timesheet Review page and included in the payroll CSV export. The export breaks the three components out as separate line items.

---

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

> **Architecture note**: The dispatch system is built around three anchoring concepts: the **Location of Interest (LOI)**, the **Dispatch Resource** (patrol run / callsign), and the **Service Agreement** (who pays and what SLA applies). A job is always dispatched to a *Dispatch Resource* (a named patrol run such as "Zone 587 Nelson Night Patrol"), not directly to an individual officer. The roster layer separately resolves which officer is currently assigned to that run.

| Page | Path | Purpose |
|---|---|---|
| Dispatch Console | `/dispatch-console` | Create, assign, and manage live dispatch jobs |
| Dispatch Monitor | `/dispatch-monitor` | Supervisor read-only view of the live job queue |
| Dispatch Wizard | `/dispatch-wizard` | Guided multi-resource job creation |
| Dispatched Jobs List | `/dispatched-jobs` | Historical job list with full timeline |

---

###### Dispatch Console (`/dispatch-console`)

The Dispatch Console is the **real-time operational board** for creating, assigning, and tracking dispatch jobs — modelled on CAD (Computer-Aided Dispatch) systems used in emergency services.

**UI Layout:**

```
┌──────────────────────────────────────────────────────────────┐
│  TOP BAR: + New Job │ Filter │ Auto-assign toggle │ Settings │
├─────────────────────────────────┬────────────────────────────┤
│  JOB QUEUE (left 60%)           │  RESOURCE BOARD (right 40%)│
│  Priority-sorted, colour-coded  │  Active patrol runs /      │
│  SLA countdown on each card     │  callsigns with status     │
│  Drag-to-assign OR click+select │  GPS freshness indicator   │
└─────────────────────────────────┴────────────────────────────┘
```

**Creating a new job — step by step:**

1. Click **+ New Job** in the top bar.
2. Fill in the job form:
   - **Job type** — select from the type registry (e.g. `patrol_check`, `alarm_response`, `noise_complaint`, `freedom_camping`, `parking`, `welfare_check`, `trespass`). The type controls the default SLA, priority, and whether a client site is required.
   - **Location of Interest (LOI)** — enter the full street address. The system geocodes it automatically and displays a map pin preview. The LOI is the spatial anchor of the job — it is always required. For alarm/guarding jobs, selecting a **Client Site** populates the LOI automatically from the site address.
   - **Client Site** (optional) — required only for alarm response and guarding jobs; not required for noise, parking, or freedom camping jobs.
   - **Service Agreement** — select the contract that governs this job. This determines the payer, SLA timer, and whether auto-dispatch is permitted.
   - **Priority** — `low` / `normal` / `high` / `urgent`
   - **Briefing notes** — visible to the assigned resource
   - **Response SLA** — auto-populated from the service agreement; override if needed
3. Click **Create Job** — the job appears in the queue with status `pending` and the SLA countdown starts.

**Assigning a job to a Dispatch Resource:**

1. Click the pending job card — it highlights with a blue selection ring.
2. In the Resource Board, the system automatically highlights the recommended Dispatch Resource based on polygon geofence matching (the resource whose patrol area contains the LOI).
3. Click the recommended resource, or select any other resource manually.
4. Click **Dispatch** — the job moves to `dispatched` status and the officer assigned to that run receives an in-app push notification.

> **Manual override**: A dispatcher can override the auto-recommended resource at any time before the job reaches `en_route` status. Use the **Reassign** option on the job card.

**Job lifecycle state machine:**

```
PENDING → DISPATCHED → ACKNOWLEDGED → EN_ROUTE → ON_SCENE → COMPLETED
                                                         ↓
                                               (at any stage) → CANCELLED
```

| Status | Meaning | Triggered by |
|---|---|---|
| `pending` | Created, awaiting resource assignment | Admin (console, wizard, or client portal) |
| `dispatched` | Assigned to a Dispatch Resource | Admin dispatch action |
| `acknowledged` | Assigned officer confirmed receipt | Officer (field portal) |
| `en_route` | Officer is travelling to the scene | Officer (field portal) |
| `on_scene` | Officer has arrived | Officer (field portal) or geofence trigger |
| `completed` | Job closed with outcome | Officer or admin |
| `cancelled` | Cancelled before completion | Admin |

**SLA management:**
- The SLA clock starts at `created_at` and targets `on_scene_at ≤ created_at + sla_minutes`
- Jobs approaching SLA breach turn **amber** at 75% of the SLA window elapsed
- Jobs that exceed the SLA turn **red** and are flagged `sla_breached = true`
- SLA breaches increment the `escalation_level` counter and surface on the Dispatch Monitor

**UI behaviour for drag-and-drop assignment:**
- Drag a job card from the queue onto a resource card in the Resource Board to assign it
- For accessibility: every drag action has a non-drag alternative — click the job card, then click a resource, then click the **Assign** button that appears
- Assigned resources are highlighted green; resources at capacity are amber; offline resources are grey

---

###### Dispatch Monitor (`/dispatch-monitor`)

Supervisor-level read-only overview of the entire job queue. Intended for control room displays or secondary supervisors who need to observe without interacting.

**UI Layout:**

- Left panel: all active jobs grouped by status with SLA timers
- Right panel: live officer/resource map showing GPS positions and job assignments
- Top strip: live KPI tiles — Active Jobs · SLA Breached · Available Resources · On Scene

No assignment or editing controls — use the Dispatch Console for those actions.

---

###### Alarm Events (`/alarm-events`)

Supervisor and admin monitoring queue for inbound alarm traffic from connected security systems.

**UI Layout:**

- Header: alarm event count, severity context, and manual refresh control
- Summary strip: active critical/high/medium/low alarm counts
- Main table: inbound alarm rows with source system, site reference, severity, status, and trigger time
- Action lane: acknowledge, resolve, mark false alarm, or create a linked incident

Operational note:

- The monitoring smoke path is anchored on `/dispatch-monitor` and `/alarm-events`.
- Legacy references to an `enterprise-console` route are not canonical product surfaces and should not be used for current QA or operator runbooks.

---

###### Dispatch Wizard (`/dispatch-wizard`)

Guided step-by-step job creation for complex or multi-resource situations (e.g. large events, multi-zone incidents requiring backup).

**Steps:**
1. **Situation type** — select a scenario from the pre-defined list (noise event, suspicious vehicle, medical assist, community welfare, etc.)
2. **Location** — enter address or drop pin on the map; the system shows matching patrol run areas overlaid
3. **Resource selection** — the wizard recommends resources by GPS proximity and service type; dispatcher confirms or overrides
4. **Briefing notes** — free-text briefing for all assigned resources
5. **Review & dispatch** — confirm the job(s); supports **multi-resource dispatch** in one workflow (e.g. primary officer + backup + supervisor notification)

---

###### Dispatched Jobs List (`/dispatched-jobs`)

Full historical record of all dispatch jobs.

- Filterable by: status, job type, dispatch resource, zone, client site, date, SLA breach flag
- Each row links to the full job detail view (timeline, officer updates, GPS trace, evidence, outcome)
- **Export CSV** for reporting and billing
- SLA breach rate summarised at the top
- Service Agreement usage breakdown available via the **By Contract** view toggle

---

###### Client Portal Job Submission

Clients with an approved **Service Agreement** that has `allows_client_submission = true` can submit jobs from the Client Portal.

**Submission modes (controlled per Service Agreement):**

| Mode | Setting | Behaviour |
|---|---|---|
| **Disabled** | `allows_client_submission = false` | Submit button is hidden in the client portal |
| **Approval required** | `allows_client_submission = true`, `allows_auto_dispatch = false` | Job is created as `pending_approval`; dispatch team reviews and approves before it enters the live queue |
| **Auto-dispatch** | `allows_client_submission = true`, `allows_auto_dispatch = true` | Job is created and immediately dispatched to the nearest available resource; used for alarm monitoring centres |

---

##### Users & Organisations

| Page | Path | Purpose |
|---|---|---|
| User Management | `/users` | Create, edit, and deactivate user accounts |
| Access Control | `/access-control` | Configure portal area access per user |
| Client Master List | `/client-master-list` | All client organisations and contacts |
| Client Sites | `/client-sites` | Manage client site records |
| Site Permissions Admin | `/site-permissions` | Configure who can access which sites |
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

| Page | Path | How to navigate |
|---|---|---|
| Invoicing | `/invoicing` | Sidebar → Finance → Invoicing |
| Pricing Page | `/pricing` | Sidebar → Finance → Pricing (master only) |
| CRM Module | `/crm` | Sidebar → Business → CRM |
| Client Account Detail | `/crm/client/:orgId` | Click any client row in CRM |
| Contractor Account Detail | `/crm/contractor/:orgId` | Click any contractor row in CRM |
| Tender Workspace | `/tenders` | Sidebar → Business → Tenders |
| Tender Reference Library | `/tender-library` | Sidebar → Business → Tender Library |

---

###### CRM Module (`/crm`)

The CRM module is the relationship management hub for all client and contractor accounts.

**Navigating to CRM:**  
Sidebar → Business → **CRM** (or go directly to `/crm`)

**Layout:** Two tabs — **Accounts** and **Contacts**.

**Accounts tab:**
- Shows all organisations in the system typed as `client` or `contractor` with: name, type, parent organisation, active status, insurance status, and H&S policy status.
- Use the **type filter** at the top to switch between Clients and Contractors.
- Use the **search bar** to find by name.
- Click any row to open the account detail page:
  - **Client account** → opens `OrganizationProfile` page with enforcement metrics, site list, and contact details
  - **Contractor account** → opens `ContractorAccountPage` with service agreement status, insurance expiry, H&S policy expiry, guard hourly rate, and compliance certifications

**Contacts tab:**
- All user profiles linked to client and contractor organisations
- Shown with: name, role, organisation, phone, email
- Click a contact row to open their profile

**Creating a new client account:**
1. Navigate to `/organizations` (Master or Grand Master role required) → click **New Organisation**.
2. Set organisation type to `client`.
3. Fill in: organisation name, parent organisation (if applicable), enforcement workflow, overnight verification mode, contact email, and contact phone.
4. Click **Create Organisation**.
5. Return to `/crm` to manage the client account profile, contacts, and linked records.

**Model decision (canonical):**
- There is one tenancy entity: `organizations`.
- A "client" is an organization where `organization_type = client`.
- CRM is the operational account workspace; organisation creation happens in `/organizations`.

###### Human Workflow: Client Setup to Patrol Operations

Use this sequence to onboard a client and begin live operations without AI dependency:

1. **Create client organisation**
   - `/organizations` → **New Organisation** → set type `client` → save.
2. **Create client site**
   - `/client-sites` → **Add Site** → enter site name and address (plus contacts and service settings) → save.
3. **Set jurisdiction/geofence**
   - In `/client-sites`, enter address or GPS so coordinates are resolved and linked to a zone.
   - For boundary refinement, edit zone geometry in `/zones/:id`.
4. **Roster staff for static or patrol work**
   - `/roster` → add shift with officer, time window, site, and zone.
5. **Create patrol/dispatch run using client site context**
   - `/dispatch-console` (or `/dispatch-wizard`) → create job → select LOI and client site where relevant → dispatch resource.

This sequence is the required human-first path. Bob/self-heal may assist in the background, but is not required for execution.

---

###### Invoicing (`/invoicing`)

**Navigating to Invoicing:**  
Sidebar → Finance → **Invoicing**

The invoicing module manages billing for all contracted services.

**Invoice workflow:**

1. Navigate to `/invoicing` — the invoice list shows all invoices with status: `draft`, `sent`, `paid`, `overdue`, `void`.
2. **To create a new invoice:**
   - Click **+ New Invoice**
   - Select the **client organisation** being billed
   - Set the **billing period** (date range)
   - The system pulls timesheet data, dispatch job counts, infringement notice counts, and on-call pay records for the period and pre-populates the line items
   - Add/edit/remove line items as needed
   - Set payment terms (default: 14 days)
   - Click **Save as Draft** or **Send** to email the invoice to the client
3. **Tracking payment**: Update the invoice status to `paid` when payment is received, or `overdue` if the payment deadline passes.
4. **Export**: Use **Export PDF** to download a print-ready invoice, or **Export CSV** to export the line items for accounting.

---

###### Tender Workspace (`/tenders`)

**Navigating to Tenders:**  
Sidebar → Business → **Tenders** (master role required)

The Tender Workspace manages RFP (Request for Proposal) and tender submissions.

**Workflow:**
1. Create a new tender from the **+ New Tender** button.
2. Fill in: tender title, issuing council/client, due date, service type, estimated contract value.
3. Use the **Clause Library** (`/tender-library`) to pull pre-approved clauses directly into the document — eliminates copy/paste errors and ensures approved language is used.
4. Assign a **lead author** and any **co-authors** from the user list.
5. Track status through: `draft` → `in_review` → `submitted` → `awarded` / `declined`.
6. Attach supporting documents (certifications, evidence, pricing schedules) to the tender record.

---

##### Reports & Analytics

**How to navigate:**  
Sidebar → **Reports** group.

| Page | Path | How to navigate |
|---|---|---|
| Reports Hub | `/reports-hub` | Sidebar → Reports → Hub |
| Pre-Built Reports | `/reports` | Sidebar → Reports → Reports |
| Custom Report Builder | `/custom-reports` | Sidebar → Reports → Custom |
| Observations | `/observations` | Sidebar → Records → Observations |
| Observations Report | `/observations-report` | Sidebar → Reports → Observations |
| Observation Records | `/observation-records` | Sidebar → Records → Observation Records |
| Incident Reports | `/incident-reports` | Sidebar → Reports → Incidents |
| Incident Management | `/incidents` | Sidebar → Records → Incidents |
| AI Analysis | `/ai-analysis` | Sidebar → AI & Intelligence → Analysis |
| Compliance Analytics | `/admin/compliance-analytics` | Sidebar → Compliance → Analytics |
| Audit Log | `/audit-log` | Sidebar → Platform → Audit Log |

---

###### Reports Hub (`/reports-hub`)

The Reports Hub is the starting point for all reporting. It shows:
- **Recent reports** — last 5 reports generated by your organisation
- **Scheduled reports** — reports configured to generate automatically on a schedule
- **Quick access tiles** — one-click access to the most common reports (Compliance Summary, Breach Report, Officer Activity, Patrol KPIs, Infringement Register)

**Generating a report:**
1. Click any report tile or navigate to `/reports`.
2. Set the **date range** and **organisation** using the filter controls.
3. Click **Generate** — the report renders in the browser within seconds.
4. Click **Export PDF** or **Export CSV** to download.
5. Click **Schedule** to configure the report to generate automatically (daily, weekly, monthly) and email it to specified recipients.

---

###### Custom Report Builder (`/custom-reports`)

Build reports from any combination of available data domains.

**Workflow:**
1. Navigate to `/custom-reports` → **+ New Report**.
2. **Select data source** — choose from: observations, breaches, notices, patrols, incidents, dispatch jobs, timesheets, NZSCV checks.
3. **Choose columns** — drag fields from the available field list into the column builder. Reorder by dragging.
4. **Add filters** — filter by zone, officer, status, date range, or any field value.
5. **Preview** — see a live preview of the first 20 rows.
6. **Save** the report template with a name — it appears in the Reports Hub for one-click regeneration.
7. **Export** current results as CSV or PDF.

---

###### AI Analysis (`/ai-analysis`)

Bob AI-generated insights for compliance patterns, breach hotspots, and enforcement effectiveness.

**How to use:**
1. Navigate to Sidebar → AI & Intelligence → **Analysis**.
2. Select an **analysis type**: Compliance Trend · Breach Hotspot · Officer Productivity · Zone Risk Score · Seasonal Patterns.
3. Set the date range and zone filter.
4. Click **Analyse** — Bob processes the data and returns a structured analysis with:
   - Executive summary (2–3 sentences)
   - Key findings (bullet list)
   - Data visualisation (chart or map)
   - Recommended actions
5. All analyses are logged in the audit trail. Significant findings can be **published** to the Compliance Dashboard as a permanent insight record.

> **Human approval required**: Bob's recommendations are advisory. No data is changed until a human administrator explicitly approves and applies a recommended action.

---

##### Data Management

**How to navigate:**  
Sidebar → **Data** group.

| Page | Path | Purpose |
|---|---|---|
| Data Management Hub | `/data-management-hub` | Central landing page |
| Import Data | `/import-data` | Import scan, breach, or vehicle records |
| Import Historical Data | `/import-historical` | Batch import of historical records |
| Cleanup and Recalculate | `/cleanup-recalculate` | Remove duplicates, recalculate compliance |
| Photo Reingest | `/photo-reingest` | Reprocess failed plate photos |
| Evidence Photo Linker | `/evidence-photo-linker` | Manually link orphaned photos to scans |
| Data Cleanup Utility | `/data-cleanup` | Targeted data-quality tools |
| Data Integrity Dashboard | `/data-integrity` | Live data health metrics |
| Person Records | `/person-records` | Canonical person registry |
| Face Recognition | `/face-recognition` | AI face recognition management |

---

###### Importing Data (`/import-data`)

**When to use:** When migrating from another system, or when bulk-loading historical enforcement records.

**Workflow:**
1. Navigate to Sidebar → Data → **Import Data**.
2. Click **+ New Import**.
3. Select the **record type**: observations, breach alerts, infringement notices, vehicle records, person records.
4. Download the **CSV template** for the selected type — this shows the required columns and format.
5. Prepare your data file using the template.
6. Upload the CSV — the system validates each row and shows a preview of what will be imported.
7. Fix any validation errors highlighted in red (invalid plate formats, missing required fields, duplicate records).
8. Click **Confirm Import** — records are staged in `import_staging` and reviewed before being committed.
9. Review the staged import — approve or reject individual rows if needed.
10. Click **Commit** to write approved records to the live tables.

**After importing:** Navigate to `/cleanup-recalculate` and run a compliance recalculation for the imported date range to ensure breach records are correctly generated from the imported observations.

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
**Landing page**: `/admin/nzscv`

This read-only role is for staff who only need to check and monitor the New Zealand Self-Contained Vehicle (NZSCV) certification database — for example, a council officer who validates SCV status but does not manage enforcement.

#### How to navigate as NZSCV Monitor

After login, you land directly on the NZSCV Monitor page. The sidebar shows only the pages available to your role:

| Sidebar item | Path | Purpose |
|---|---|---|
| NZSCV Monitor | `/admin/nzscv` | SCV status dashboard |
| Vehicle Registry | `/vehicle-registry` | Browse known vehicle records |
| Search | `/search` | Universal search across accessible records |
| Profile | `/profile` | Your account settings |
| Settings | `/settings` | Account preferences |

#### NZSCV Monitor Page (`/admin/nzscv`)

The NZSCV Monitor is a live dashboard showing the SCV certification status of all vehicles active in the system.

**Page layout:**

```
┌──────────────────────────────────────────────────────────────┐
│  ENFORCEMENT COUNTDOWN TILE                                  │
│  "SCV check mandatory in 12 days (Zone: Nelson Riverside)"  │
├──────────────────────────────────────────────────────────────┤
│  STATUS SUMMARY TILES                                        │
│  Certified: 142  │  Expired: 8  │  Unknown: 23  │  Exempt: 5│
├──────────────────────────────────────────────────────────────┤
│  VEHICLE LIST  (filtered by active zone and date range)      │
│  Plate │ Make/Model │ SCV Status │ Expiry │ Zone │ Last seen │
└──────────────────────────────────────────────────────────────┘
```

**Checking a specific vehicle's SCV status:**
1. Type the plate number in the **Search** bar at the top of the vehicle list.
2. The system queries the NZSCV API in real time and returns the current certification status within seconds.
3. The result shows: certificate number, expiry date, vehicle class, and whether the certification is valid for the zone's SCV requirement.

**Checking a vehicle that is not in the system:**
1. Click **+ Ad-Hoc Check** in the top-right.
2. Enter the plate number.
3. Click **Check NZSCV** — the result is returned from the NZSCV API and displayed. The result is not stored permanently (no enforcement record is created).

**Understanding SCV statuses:**

| Status | Meaning |
|---|---|
| 🟢 `certified` | Valid SCV certificate exists and is not expired |
| 🔴 `expired` | Certificate exists but expiry date has passed |
| ⚫ `not_found` | Plate is not registered in the NZSCV database |
| ⚪ `unknown` | Query returned no definitive result (retry recommended) |
| 🟡 `exempt` | Vehicle or zone is exempt from SCV requirement |
| 🔵 `pending` | Certificate application in progress |

**Enforcement countdown:**  
The countdown tile shows the date when the next **mandatory SCV check cycle** is due for each active zone. This date is configured per zone by the admin. When the countdown reaches zero, the system flags all vehicles in that zone without a valid certificate as non-compliant, even if no breach scan has been processed.

**Bulk refresh:**  
Click **Bulk Refresh** to re-query NZSCV for all vehicles active in the selected zone and date range. This re-confirms the current certification status for all known vehicles. The operation may take several minutes for large zones.

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

#### Mobile background alerts (on-shift safety requirement)

When the officer app is in the background (another app open) or the device screen is off, welfare and operational push notifications are still expected to arrive.

- Welfare reminders and welfare escalation alerts are delivered through the unified push service.
- Officers must keep notification permission enabled on their device.
- Logging out of operational workflows does **not** disable notification standby mode; the app can still receive welfare pushes.
- The login screen shows a standby notice when notifications remain active but patrol tools are signed out.

Expected user experience:
1. Officer starts a shift and keeps device in pocket / switches apps.
2. Welfare due/overdue/escalation push appears with audible/vibration alert (subject to device settings).
3. Officer opens the app from the notification and checks in immediately.
4. If no response occurs, supervisor escalation flow continues as configured.

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

For after-hours noise control operations under the Resource Management Act 1991 (RMA).

#### Receiving a Job

Noise control officers receive jobs via the Dispatch Console. Supervisors and admin roles coordinate the wider queue from the Noise Control Portal (`/noise-control`). When dispatched, the officer's portal displays an incoming job notification with: address, priority, complaint description, and any prior notice history at that address.

**Respond to the dispatch:**
1. From the portal home screen, the incoming job card appears at the top with a pulsing amber border.
2. Tap **Acknowledge** — the job status updates to `acknowledged` and the SLA timer advances.
3. Tap **En Route** when you start travelling — the GPS trace begins.
4. Tap **On Scene** when you arrive — the job status updates and the scene assessment form unlocks.

#### Scene Assessment

1. **Review the context panel** — the system shows prior notice history at this address:
   - If a **Permanent END** is in place → a red **SEIZURE AUTHORITY ACTIVE** banner is shown prominently at the top. Any noise in breach may be seized immediately.
   - If a prior END exists → a red banner recommends escalating to a new END.
   - If a prior AN exists → an amber banner recommends a Direction Notice (DN).
   - If this is a first contact → the green pathway suggests verbal warning or AN.
   - If an H&S flag is set on the address → a yellow safety panel is shown. Read the safety brief before approaching.
2. Complete the **Assessment tab**:
   - Enter the decibel reading (if you have a sound meter)
   - Select the noise source (music, power tools, vehicle, animal, industrial, etc.)
   - Take scene photos and upload them — photos are essential evidence for any notice above a verbal warning
   - Enter a scene description

#### Noise Enforcement Decision Path

```
First contact at address?
  YES → Verbal warning first
         → Noise stops? → Close job
         → Noise continues or occupant refuses?
              → Issue Abatement Notice (AN) — RMA s.326, 24-hour comply
  NO  → Prior notice history exists
         → Prior verbal only → Issue Abatement Notice (AN)
         → Prior AN → Issue Direction Notice (DN) — immediate compliance
         → Prior AN or DN, serious/persistent → Issue Enforcement Notice (END) — RMA s.327, 72-hour comply
         → END issued, noise continues after 72 hrs → Seize equipment (document all items + photos, contact supervisor)
         → Permanent END in place → Immediate seizure authority — assess scene → seize if noise present
```

#### Issuing Notices

1. In the **Action** section, select the appropriate notice type.
2. Confirm the pre-filled fields:
   - Recipient name and address
   - Offence description (be specific — describe the noise, its character, and its unreasonable nature)
   - Legal basis (auto-populated: AN = `RMA s.326(1)(a)`, END = `RMA s.327`)
   - Comply-by period: AN = 24 hours (default), DN = immediate, END = 72 hours
3. Click **Issue Notice** — the notice is saved. Click **Print** to produce the printed document.
4. Hand the notice to the occupant or affix it to the property entrance.

**Equipment Seizure (END only):**  
When issuing an END or responding to a Permanent END:
1. A **Seizure** section appears after the END is issued.
2. Record each item seized: make, model, serial number.
3. Photograph each item.
4. Contact your supervisor to arrange secure storage.
5. Update the job status to `completed` with outcome `equipment_seized`.

#### Completing the Job

1. Tap **Update Status** → select the outcome: `noise_abated`, `notice_issued`, `refused_to_comply`, `equipment_seized`, `no_evidence_of_noise`, `escalated`.
2. The job status moves to `completed`.
3. The full job record — assessment, photos, notices, timestamps — is automatically available in the admin portal.

> **Evidence reminder**: Photos and decibel readings are legally significant. Always capture them at the scene before issuing any notice above a verbal warning.

#### Supervisor Noise Control Portal (`/noise-control`)

Supervisors and admin roles use the Noise Control Portal to coordinate jobs, notices, and seizures across the organisation.

1. The top of the page shows an urgent-job strip whenever priority incidents need immediate dispatch attention.
2. Tabs separate **Jobs**, **Notices**, and **Seizures** for fast switching between live response and document follow-up.
3. Use **Dispatch Job** to create a new job, **Issue Notice** to open the notice workflow, and **Refresh** to pull the latest queue state.
4. Summary cards at the top show active jobs, urgent jobs, issued notices, and held seizures.

---

### 5.5 Biosecurity Inspection Officer

**Service type**: `biosecurity_inspection`  
**Portal path**: `/biosecurity-officer`

For biosecurity compliance inspections, primarily focusing on Chilean Needlegrass (*Nassella neesiana*) identification and management under the Biosecurity Act 1993.

#### Receiving a Job

Biosecurity jobs are dispatched from the admin portal. The officer receives a notification with: site address, inspection type, priority, and any prior notice history.

1. Tap **Acknowledge** → **En Route** → **On Scene** as you travel and arrive.
2. The context panel shows: prior notice count, management plan status, and any safety notes.

#### Inspection Workflow

1. **Photograph the specimen** — take clear photos of the plant (whole plant, leaf detail, seed heads if present).
2. Tap **Identify with Bob** — Bob AI analyses the photo against the *Nassella neesiana* identification checklist:
   - Species confirmation (tightly rolled leaves, distinctive seed head)
   - Density estimate (scattered / moderate / dense)
   - Seed head presence (indicates high spread risk — triggers immediate escalation recommendation)
   - Land-use context
3. **Confirm the AI checklist** — review each item Bob identified and confirm or correct it. You are the authorised officer; Bob is advisory.
4. Select an **Action**:

| Action | When to use |
|---|---|
| **No Action** | Not confirmed *Nassella neesiana*, or within an existing management plan area |
| **Advisory Notice** | First detection; landowner cooperative; management plan required |
| **Notice of Direction (NOD)** | Prior advisory ignored; landowner uncooperative; or high-density infestation |
| **Infringement Notice** | Persistent non-compliance |
| **Referral to MPI** | Large-scale or cross-boundary infestation requiring central government response |

5. For notices: confirm the pre-filled form (legal basis, recipient, comply-by period).
6. Click **Issue Notice** → **Print**.
7. Update job status with outcome.

---

### 5.6 Smoke Complaint Officer (OOH)

**Service type**: `smoke_complaint_ooh`  
**Portal path**: `/smoke-officer`

For out-of-hours smoke complaint response under the Resource Management Act 1991 s.17A.

#### Receiving a Job

Smoke complaint jobs are dispatched from the admin portal or received via the council's after-hours call centre. The job card shows: address, suburb, complaint source (neighbour, council hotline, self-report), priority, whether out-of-hours flag is set, and any repeat-offender flag.

1. Tap **Acknowledge** → **En Route** → **On Scene** as you progress.

#### Six-Step On-Scene Assessment

The portal guides you through six structured steps:

**Step 1 — GPS Confirmation**  
Confirm your GPS position is at the correct address. The system shows your current coordinates against the job address. Tap **Confirm Location**.

**Step 2 — Media Capture**  
Photograph and/or video the smoke source. This is essential evidence. Tap **Capture Photo** or **Capture Video**. Upload at minimum one photo before proceeding.

**Step 3 — Bob AI Assessment**  
Tap **Assess with Bob**. Bob analyses the complaint context, photos, time of day, and address history to recommend a response pathway:
- Domestic solid fuel burning (acceptable/unacceptable conditions)
- Industrial or commercial source
- Vehicle exhaust
- Agricultural burning (permit required or exempted)
- Nuisance burning (no permit, unreasonable effect)

Review Bob's recommendation. Bob is advisory — you confirm the assessment.

**Step 4 — Checklist**  
Complete the structured checklist:
- Is the smoke visible and excessive?
- Is the source identified?
- Is the burning type controlled/permitted?
- Is the wind direction carrying smoke to neighbouring properties?
- Is the time of day within unreasonable hours (after 8pm default)?

**Step 5 — Action Selection**  
Select the appropriate action:

| Action | When to use |
|---|---|
| **No Action** | Burning is lawful, permitted, or smoke has ceased |
| **Verbal Warning** | First contact; occupant cooperative; smoke reducing |
| **Abatement Notice** | Persistent or unreasonable burning; RMA s.17A |
| **Infringement Notice** | Repeat offence or non-compliance after Abatement Notice |
| **Prosecution Referral** | Serious or persistent commercial/industrial violation |

**Step 6 — Notice Generation & Close**  
If a notice was selected:
1. Confirm the pre-filled notice form (recipient, offence description, legal basis, comply-by period).
2. Click **Issue Notice** → **Print**.
3. Deliver the notice or affix to property entrance.
4. Update job status with outcome.

---

### 5.7 EMS Officer

**Service type**: `ems`  
**Portal path**: `/ems`

For Electronic Monitoring (EM) bail and sentence supervision device management. EMS officers are contracted by the Department of Corrections or Oranga Tamariki to fit, maintain, and respond to alerts from GPS/radio-frequency ankle monitoring devices.

#### Starting an EMS Shift

1. Navigate to `/ems` or wait for auto-routing from your rostered EMS shift.
2. The portal home screen shows your assigned **monitoring roster** — the list of participants you are responsible for during this shift.
3. Review the **Alert Queue** first — any tamper alerts, out-of-zone alerts, or missed check-ins from your participants are shown at the top with urgency level.

#### EMS Portal Layout

```
┌──────────────────────────────────────────────────────────────┐
│  TOP TABS:  Alert Queue │ My Roster │ Device Fits │ History   │
├──────────────────────────────────────────────────────────────┤
│  ALERT QUEUE (default):                                      │
│  • Severity badge (Critical / High / Standard)               │
│  • Participant name (de-identified code if policy requires)  │
│  • Alert type: tamper, zone breach, missed check-in, low battery│
│  • Alert time                                                │
│  • [Respond] [Acknowledge] [Escalate]                        │
└──────────────────────────────────────────────────────────────┘
```

#### Key EMS Tasks

**Device Fit:**
1. Navigate to **Device Fits** tab → **+ New Fit**.
2. Enter or scan the device serial number.
3. Fill in:
   - Participant ID (or link to person record)
   - Anchor address (GPS anchor for home-detention zone boundary)
   - Fit conditions (approved leave windows, curfew hours)
   - Supervising agency reference number
4. Attach a photo of the fitted device.
5. Click **Save Fit** — the device is activated and monitoring begins.

**Device Check (welfare / compliance check):**
1. Tap the participant's name in the roster.
2. Tap **Log Device Check**.
3. Scan the device QR code if on-site, or use the manual entry form.
4. Record:
   - Signal quality (strong / weak / no signal)
   - Physical condition of the device
   - Any damage or tampering observed
   - Whether the participant is present
5. Submit the check — the record is saved with your GPS location and timestamp.

**Device Removal:**
1. Navigate to the participant record → **Remove Device**.
2. Record: removal reason (sentence completed, court order, device fault), device condition, and return details.
3. Submit — the device is deactivated and the monitoring record is closed.

**Responding to a Tamper Alert:**
1. The alert appears in the **Alert Queue** with a **Critical** badge.
2. Tap **Respond** — the job status changes to `acknowledged`.
3. Travel to the participant's anchor address.
4. On scene: assess the device.
5. Select outcome: `false_alarm`, `physical_damage`, `deliberate_tamper`, `device_fault`.
6. For deliberate tamper: photograph the device, contact the supervising agency, and complete a written report.
7. Update the alert with outcome and close.

---

## PART D — Client Organisation

Client users access a portal scoped to their own organisation's contracted sites and services. No enforcement records can be created, edited, or deleted by client users — the portal is primarily a live operational transparency tool.

**Landing page:** `/client-portal`

**How to navigate to the Client Portal:**  
After login, client users are automatically routed to `/client-portal`. There is no portal selection step.

**Portal navigation structure (sidebar):**

| Sidebar section | Pages available |
|---|---|
| Overview | Dashboard (KPI tiles + activity feed) |
| Operations | Sites Overview, Guard Activity Feed |
| Enforcement | Infringements, Notices to Vacate |
| Records | Observations, Risk Assessments |
| Reports | Compliance summary report, Export |
| Support | Contact service provider, Dispute a notice |

### 6.1 Client Viewer

**Role code**: `client_viewer`  
**Access**: Read-only. All data scoped to their organisation. Route: `/client-portal`.

#### Client Portal Dashboard

The dashboard is the first screen after login. It shows:

| Tile | Description |
|---|---|
| **Sites Online** | Number of contracted sites with active guard coverage right now |
| **Scans Today** | Total vehicle scans completed at your sites today |
| **Active Breaches** | Vehicles currently in breach status at your sites |
| **Compliance Rate** | % of scanned vehicles that are compliant today |
| **Open Incidents** | Incidents logged at your sites in the last 7 days |

Below the KPI tiles, the **Live Activity Feed** shows real-time events at your sites — each card shows: officer name, site, event type (scan, checkpoint, incident), time, and outcome. The feed updates automatically.

#### Sites Overview

**How to navigate:**  
Client Portal sidebar → Operations → **Sites**

Each contracted site is shown as a card with:
- Site name and address
- Current guard status (On Duty / Unattended / Shift Ending Soon)
- Today's scan count
- Active breach count
- Last officer activity timestamp

Click a site card to see that site's full activity history, current officer on duty, and any open incidents.

#### Infringement Notices

**How to navigate:**  
Client Portal sidebar → Enforcement → **Infringements**

All infringement notices issued at your contracted sites. Read-only.

- Filterable by site, date range, and status
- Click a notice row to see the full notice details, evidence photos, and current status
- **Dispute a notice**: If a notice should not have been issued (e.g. wrong vehicle, valid permit not checked), click **Request Dispute Review** on the notice detail page — this opens a message to the service provider, not the public dispute portal

#### Reporting

**How to navigate:**  
Client Portal sidebar → Reports

Click **Generate Compliance Report** to download a PDF or CSV compliance summary for your sites for any date range. Reports include: scan counts, breach rates, notice counts, incident counts, and officer patrol hours.

---

### 6.2 Client Officer

**Role code**: `client_officer`  
**Access**: Same as Client Viewer plus the ability to log incidents from the client portal.

**Additional capability:**  
From any site detail page or from the guard activity feed, a Client Officer can tap **+ Log Incident** to record an incident they have personally observed (e.g. property damage, suspicious behaviour). This incident is immediately visible to the service provider in the admin portal.

---

### 6.3 Client Admin

**Role code**: `client_admin`  
**Access**: Client portal plus site contact management and limited administrative functions.

**Additional capabilities:**

| Capability | How to access |
|---|---|
| Add / update site contact information | Client Portal → Sites → [Site name] → Contacts tab → Edit |
| Request additional portal user accounts | Client Portal → sidebar → Settings → Users → Request User |
| View and comment on disputes | Client Portal → Enforcement → Disputes |
| Download invoices (if billing integration enabled) | Client Portal → Settings → Invoices |

Requested user accounts require approval from the service provider before becoming active.

---

## PART E — Public Portals

### 7.1 Public Dispute Submission Portal

**URL**: `https://fcmanager.co.nz/dispute`  
**Who uses it**: Members of the public who have received an infringement notice and wish to formally dispute it. No account is needed.

The public dispute portal is printed on every infringement notice as a URL and a QR code. It is a standalone public-facing web page separate from the main application.

#### How the Public User Accesses It

**Option A — QR Code (recommended):**
1. Scan the QR code printed in the bottom-right corner of the physical infringement notice.
2. The browser opens at `https://fcmanager.co.nz/d/<secure_token>`.
3. The dispute form pre-fills with the ticket details (notice number and vehicle registration are not required — the QR token pre-authenticates the lookup).
4. Skip directly to Step 3 of the workflow below.

**Option B — Manual URL:**
1. Open `https://fcmanager.co.nz/dispute` in any browser.
2. Enter the **ticket number** (printed on the notice, format: `INF-YYYYMMDD-XXXX`) and the **vehicle registration** (licence plate).
3. Click **Find My Ticket** — if both match a record, the dispute form opens.

#### Public Dispute Form (Step by Step)

**Step 1 — Ticket Confirmation**  
The portal displays the ticket details:
- Offence date and location
- Offence description
- Fine amount ($200 default)
- Organisation name and branding (pulled from the issuing organisation)

The user confirms this is their ticket.

**Step 2 — Your Details**  
The user enters:
- Full name
- Email address (for confirmation email)
- Phone number (optional)

**Step 3 — Grounds for Dispute**  
A text area where the user describes why they believe the notice should be withdrawn (max 2000 characters). Guidance text explains what constitutes valid grounds (e.g. valid SCV certificate not checked, signage not visible, vehicle does not match, medical emergency).

**Step 4 — Upload Evidence**  
Optional: the user can attach up to 3 photos (PNG/JPEG/WEBP, max 10 MB each). Examples:
- A valid SCV certificate
- A photo of the campsite showing no prohibition signage
- A permit issued by the council

**Step 5 — Review & Submit**  
Summary of the dispute. The user ticks a declaration box confirming the information is true. Clicks **Submit Dispute**.

**Step 6 — Confirmation**  
A confirmation screen shows a dispute reference number (format: `DS-XXXXXXXXX`). A confirmation email is sent to the address provided, including:
- Dispute reference number
- Summary of grounds submitted
- Expected processing time (typically 10 working days)
- Contact details for the issuing organisation

#### What Happens After Submission

1. The dispute record is created and linked to the infringement notice in the admin portal.
2. Bob AI runs an analysis of the dispute text and evidence — the analysis result (summary and confidence score) is attached to the dispute record before an admin sees it.
3. The notice status changes from `issued` to `under_dispute`.
4. An alert is sent to the admin team via the Notifications Centre.
5. An admin processes the dispute via the **Disputes** page in the admin portal (see [Disputes](#disputes-disputes)).
6. When a decision is made, the disputant receives an email informing them of the outcome.

### 7.2 Public Parking Prepayment Portal

**URL**: `https://fcmanager.co.nz/public/pay-by-plate`
**Who uses it**: Members of the public purchasing parking time without signing into the app.

This is a public-only flow and is isolated from authenticated operator/admin/client portals.

#### Core Flow

1. Enter plate number and zone/location.
2. Select duration and verify pricing.
3. Complete payment details and confirm.
4. Receive receipt and payment reference.

#### Security Rules

- Public users cannot query internal enforcement or customer data.
- Public flows only create/retrieve their own payment session context.
- Payment records are stored org-scoped and remain visible only through authenticated RLS-controlled views.

---

## PART F — Technical Reference (Systems Administrator)

This section is for the systems administrator, DevOps engineer, or platform operator responsible for deploying, configuring, and maintaining FieldOps Manager.

---

### 8.1 Architecture Overview

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
  functions/      — Edge Functions (Deno/TypeScript)
  migrations/     — SQL migrations (prefix YYYYMMDD_*)
proxy-server/     — NZSCV/MotorWeb proxy (own package.json)
inference-service/ — ONNX AI inference (own package.json)
```

---

### 8.2 Environment Setup

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

### 8.3 Database & Migrations

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
| `bug_reports` | User-submitted and automatically detected bug / diagnostics reports |
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
| `bob_conversations` | Bob AI conversation sessions per user per org |
| `bob_messages` | Individual Bob AI messages within a conversation |
| `on_call_periods` | On-call availability assignments per officer |
| `callout_shifts` | Ad-hoc callout shifts triggered from on-call periods (3hr minimum pay rule) |
| `travel_allowances` | Travel reimbursement records per callout |
| `office_locations` | Reference points for travel distance calculations and jurisdiction boundaries |
| `on_call_rates` | Configurable on-call rate structures per organisation |
| `service_agreements` | Contracts governing dispatch jobs (payer, SLA, client submission mode) |
| `dispatch_resources` | Named patrol runs / callsigns — the entity jobs are dispatched to |

#### Row-Level Security (RLS)

All tables enforce RLS. The base scope function is `get_user_organization_ids()`, and the canonical restriction gate is `org_access_allowed(target_org_id, service_type)`.

| Role | Scope |
|---|---|
| `officer`, `admin`, `admin_officer` | Own org + `authorized_work_locations` + `extra_organization_ids` + descendants |
| `master` | Own org + all child orgs |
| `grand_master` | All orgs |
| `client_viewer/officer/admin` | Own client org only |

The canonical gate also supports configurable cross-organisation visibility through explicit commercial rules:

- Provider-client grants (`provider_client_access_grants`)
- Temporary JWT authorised organisations (when issued)
- Active contractor/workspace handshake grants (`contractor_access` + `workspaces`)

This is the required backend path for Bob restriction checks and reusable RLS policy logic.

> **Never bypass RLS** using the service role key in frontend code. Service role is for server-to-server Edge Function calls only.

#### Multi-Org Access Pattern

The `get_user_organization_ids()` SQL function returns direct org scope. For access decisions that include contractual cross-org visibility, use `org_access_allowed(organization_id, service_type)`.

Edge Function guidance:

- Use `organization_id = ANY(get_user_organization_ids())` for strict direct membership checks.
- Use `org_access_allowed(...)` when provider-client agreements may extend visibility.
- Do not duplicate org access logic across functions when an RPC restriction gate is available.

---

### 8.4 Edge Functions

Located in `supabase/functions/<name>/index.ts`. All functions are Deno TypeScript.

The platform relies on a substantial Edge Function estate. The list below names key functions that define core intended behavior; it is not meant to be a brittle count of every function directory present in the repository.

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

### 8.5 AI Services (Bob / Inference)

**Bob** is the in-platform AI assistant for compliance, noise, biosecurity, smoke, and operational triage.

#### Inference Service

The `inference-service/` directory contains an ONNX/Ollama inference server.

```bash
cd inference-service && npm install && npm run dev
```

Environment variable: `OLLAMA_BASE_URL=http://ollama:11434` (use service name in Docker, not container IP).

#### Bob AI Configuration

- Bob's capabilities are configured via the **Bob Assistant Studio** (`/bob-studio`) — grand_master only.
- Bob conversations are persisted per user per org in the `bob_conversations` and `bob_messages` tables.
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

#### Bob Safe Runtime and Tool Invocation Contract

The Bob runtime must execute tools through a strict, schema-validated contract shared across:

- Browser/runtime orchestration (`src/lib/bobEngine.ts`)
- Edge function shared schemas (`supabase/functions/_shared/bobToolSchemas.ts`)
- RunPod worker handler (`runpod-worker/handler.js`)

Operational requirements:

1. Tool calls are validated against canonical JSON schema before execution.
2. Unknown tool names or invalid payloads must return structured errors, not silent fall-through.
3. Tenant-scoped operations must preserve organisation context and never execute cross-org by default.
4. Background or privileged Bob operations must remain server-side with service-role authorization only.

When any of the above runtime surfaces change, this section and the canonical architecture references must be updated in the same change set.

---

### 8.6 PTT / Push-to-Talk

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

### 8.7 System Diagnostics & Health

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

The `bug_reports.auto_reported` column distinguishes machine-generated incidents from user-submitted reports. It is set to `true` for browser auto-error submissions and GitHub Actions synthetic-monitor reports, allowing grand-master triage views to badge and prioritise these separately.

---

### 8.8 User & Organisation Provisioning

**Canonical data model:** `organizations` is the source-of-truth tenancy table. Clients are not a separate top-level entity; they are organisation records with `organization_type = client`.

**Commercial mapping (authoritative):**
- Platform Owner (software vendor/operator): `organization_type = owner`
- App Owner (paying tenant/customer): usually `organization_type = service_provider` when they run operations directly, or `organization_type = client` when they are the principal customer that contracts another provider
- Service Provider: `organization_type = service_provider` (if distinct from app owner)
- Client delivery entities: `organization_type = client`

If a tenant purchases the app and uses a dedicated provider model, you may model the tenant as parent and provider as child in the hierarchy. If the provider is shared across multiple clients, keep provider hierarchy stable and use service-agreement/site/zone scoping for engagement-level isolation.

**Data-flow decision for shared providers (authoritative):**
- A service provider that has many clients remains a single provider org context.
- Each client engagement is isolated by service agreement, assigned client sites, and assigned zones.
- Provider users can operate across all client engagements they are entitled to.
- Client users only see their own organisation data, contracted sites, and related jobs/notices.
- No client should ever inherit visibility of another client's records through shared provider relationships.

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

Operational role-gate contract (governance critical):

1. `/investigation-job-config` is restricted to `admin` and `master`.
2. `/zone-legal-config` is restricted to `admin` and `master`.
3. Duplicate route declarations (if present for layout/area composition) must keep equivalent role gates.

---

### 8.9 Data Integrity & Cleanup

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

### 8.10 Security & Compliance Notes

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

#### Report Export and Data Retention

- Reporting outputs must support CSV and PDF exports.
- Retention settings must be configurable per organisation and aligned with NZ Privacy Act obligations.
- Contractual requirements may demand stricter retention windows than defaults; org-level policy settings must take precedence where configured.

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
| Officer missed welfare push while app was backgrounded | Device notification permission disabled, OS battery restriction, or invalid push token | Confirm notifications are enabled, disable aggressive battery optimization for FieldOps app, and verify `user_profiles.push_token` is present for the officer |
| Compliance score stale after data import | Recalculation not yet run | Run `/compliance-recalculation` for the relevant date range and organisation |
| Edge Function CORS error | Missing OPTIONS handler or corsHeaders | Check function follows `_shared/cors.ts` pattern |
| `get_user_organization_ids()` returns empty | User profile has no `organization_id` set | Update user profile in User Management |
| Bob `health` check fails in serverless mode | `health` is pod-only; not available in serverless | Use `ping` action via `/runsync` to verify Bob connectivity |

---

## Appendix D — CRO To-Do List

A full Conversion Rate Optimisation (CRO) audit was conducted against this product in May 2026. The audit identified a **conversion dilution problem**: too many equally weighted actions are presented to users before they can reach the intended next step.

The complete specialist-labelled to-do list derived from that audit lives at:

**[`docs/CRO_TODOLIST.md`](./CRO_TODOLIST.md)**

### Summary of CRO gaps (relative to the design standards in §1a)

The current UI deviates from the Page Anatomy rule that specifies **"max one primary action per page"** in the following pages:

| Page / component | Deviation | Responsible specialist |
|---|---|---|
| `AdminPortal` — sticky header | 4 equal-weight header buttons instead of 1 primary + overflow | UX Designer + Frontend Developer |
| `FieldOfficerPortal` — common tools grid | 11 equal-weight action cards with no dominant primary | UX Designer + Frontend Developer |
| `ReportsHub` — Quick Actions card | Duplicate actions that compete with the card grid above | Frontend Developer |
| `PortalSelection` — portal grid | 7 portals displayed without role-based prioritisation | UX Designer + Frontend Developer |
| `App.tsx` — route registry | 319 registered routes, many not visible in any shell nav | Platform Engineer |

### CRO to-do scope at a glance

| Part | Description | Primary specialist |
|---|---|---|
| Quick wins | Single CTA dominance, action reduction, async state language | UX Designer + Frontend Developer |
| Route reduction | Route manifest, consolidate 319 routes to shell model | Platform Engineer + Frontend Developer |
| Landing redesigns | Patrol-first, queue-first, governance-first landings | UX Designer + Frontend Developer |
| Workflow consolidation | Guided flows replacing multi-page task sequences | Product Manager + UX Designer + Frontend Developer |
| Trust and consistency | Loading, error, offline, empty state standardisation | Frontend Developer |
| Measurement | Staging specs and analytics for conversion KPIs | QA Engineer + Analytics Engineer |

See [`docs/CRO_TODOLIST.md`](./CRO_TODOLIST.md) for the full checklist with individual to-do items.

---

*Document maintained by Iron Eagle Security / OnSpace AI.  
Source of truth: [`docs/DECISIONS.md`](./DECISIONS.md) · [`docs/LESSONS_LEARNED.md`](./LESSONS_LEARNED.md)*
