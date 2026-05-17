# CRO To-Do List — FieldOps Manager

**Source:** CRO Audit conducted 2026-05-17  
**Purpose:** Convert the CRO (Conversion Rate Optimisation) audit findings into actionable to-do items for implementation.  
**Reference documents:**  
- [`docs/INSTRUCTION_MANUAL.md`](./INSTRUCTION_MANUAL.md) — canonical product and UX standards  
- [`docs/STAGING.md`](./STAGING.md) — execution and staging checklist  
- [`docs/UX_UI_ARCHITECTURE_BLUEPRINT_MERGED.md`](./UX_UI_ARCHITECTURE_BLUEPRINT_MERGED.md) — approved UX/UI reference architecture  

Each item is prefixed with the **specialist role** responsible for completing it.

---

## Summary of CRO findings

The platform has a **conversion dilution problem**: too many equally weighted actions are presented before users can reach the intended next step. The core fix is to make the **next best action obvious, singular, and confidence-building for each role**. No new features are needed — this is about action orchestration.

**Conversion goals (what "conversion" means in this product):**

| Role | Conversion target |
|---|---|
| Officer | Start patrol → complete scan → submit result |
| Admin | Reach triage queue → action breach → resolve |
| Master | Review governance exceptions → complete approval |

---

## PART 1 — Quick wins (low effort, high uplift)

> These items can be completed independently of the structural refactor. Ship them as soon as each is ready.

- [ ] **[UX Designer]** Design a dominant primary CTA for each role landing page — one button per screen, styled in the brand primary colour, positioned in the page header. See INSTRUCTION_MANUAL.md §1a (Page Anatomy / PRIMARY ACTIONS rule: max one main action per page).

- [ ] **[Frontend Developer]** Implement the single-primary-CTA rule across `AdminPortal.tsx`, `FieldOfficerPortal.tsx`, and `ReportsHub.tsx`. Demote all secondary actions to `variant="outline"` or `variant="ghost"`.

- [ ] **[UX Designer]** Redesign the Admin Command Centre sticky header (`AdminPortal.tsx` lines 689–733). Reduce from 4 header buttons (Breaches, Welfare, Dispatch, Reports) to 2 primary (Breaches, Welfare) + one overflow "More" menu. Dispatch and Reports move to overflow.

- [ ] **[Frontend Developer]** Implement the Admin header reduction. Wire Dispatch and Reports into an overflow `DropdownMenu` component using the existing shadcn/ui primitive.

- [ ] **[UX Designer]** Redesign the Officer "common tools" grid (`FieldOfficerPortal.tsx` lines 2431–2575). Currently shows 11 equal-weight cards. Reduce to 3 primary cards (Start/Resume Patrol, Checkpoint, Quick Report) + a collapsible "More tools" section for specialty modules (Noise, Biosecurity, Smoke, Parking, Zones, Infringements, History).

- [ ] **[Frontend Developer]** Implement the Officer tools grid reduction. Group specialty module cards under a collapsible section using Collapsible from shadcn/ui. Remember glove-safe touch targets (≥ 44×44 px).

- [ ] **[UX Designer]** Redesign `ReportsHub.tsx`. Replace the 4-section report card grid + separate Quick Actions card with a single "Start here" hero section surfacing the most-used report per role (Leadership Pack for admin, Patrol Activity for officer), followed by a categorised list view.

- [ ] **[Frontend Developer]** Implement the Reports Hub redesign. Remove the standalone Quick Actions card (its actions duplicate the report cards above it). Add a role-aware "recommended" report that appears at the top.

- [ ] **[Frontend Developer]** Add explicit status/progress/retry language to all async states in all three shells. Every loading state must use a skeleton that matches the loaded layout (not a spinner). Every error state must show a retry button and a plain-English description of what failed. See INSTRUCTION_MANUAL.md §1a (Page Anatomy rules).

- [ ] **[Frontend Developer]** Add a "Last synced" or "X items pending sync" indicator to the Officer shell header when the offline queue has pending items. Officers need confirmation that queued actions will reach the server.

---

## PART 2 — Navigation and route reduction (structural)

> These items require co-ordinated design + development work. Complete after Part 1.

- [ ] **[Platform Engineer]** Audit all 319 registered routes in `src/App.tsx`. Produce a trimmed route inventory that maps to the three-shell model (Officer, Admin, Master) as specified in `docs/UX_UI_ARCHITECTURE_BLUEPRINT_MERGED.md` §2. Target: remove or redirect all routes that do not correspond to a production shell, are internal/dev tools, or are redundant duplicates of existing routes.

- [ ] **[Frontend Developer]** Implement the route manifest + compatibility adapter as specified in `docs/UX_UI_ARCHITECTURE_BLUEPRINT_MERGED.md` §2 (Navigation and Route Manifest). The manifest must include `visibilityMode` (production / internal / hidden) and `mobilePriority` fields.

- [ ] **[Frontend Developer]** Hide all routes with `visibilityMode: internal` from production navigation. Internal routes (`/diagnostics`, `/grandmaster-code-studio`, `/admin/data-integrity`, `/admin/data-cleanup`, etc.) must not appear in sidebar or top-nav for any production role.

- [ ] **[Product Manager]** Resolve the overlapping admin dashboard routes (`/admin`, `/admin/dashboard`, `/dashboard`). Decide on one canonical admin landing path and redirect the others. Document the decision in `docs/DECISIONS.md`.

- [ ] **[Frontend Developer]** Implement the consolidated admin landing redirect once the Product Manager decision above is recorded.

- [ ] **[Product Manager]** Resolve the overlapping officer landing paths (`/field-officer`, `/portal-selection`, `/officer-home`). Define one canonical officer entry path and the auto-route rules per roster/service type. Document in `docs/DECISIONS.md`.

- [ ] **[Frontend Developer]** Implement the simplified officer entry routing once the decision above is recorded.

---

## PART 3 — Role-specific landing redesigns (structural)

> Each shell gets a focused primary-path landing. Design before implementing.

### Officer shell

- [ ] **[UX Designer]** Design a "patrol-first" Officer landing. The screen must answer "What do I do next?" in one glance. The primary CTA is **Start Patrol** (or **Resume Patrol** if a shift is active). A shift status banner (active/rostered/unrostered) should dominate the top of the screen.

- [ ] **[Frontend Developer]** Implement the patrol-first Officer landing in `FieldOfficerPortal.tsx`. The start/resume patrol action is the primary CTA. Service-type selection (for admin_officers with multiple options) is secondary. Specialty modules are behind "More tools".

- [ ] **[UX Designer]** Define Officer action hierarchy per role variant:
  - `officer` (pure field): Start Patrol → Scan → Breach → Welfare SOS
  - `admin_officer` (dual): Patrol or Admin chooser → then same Officer path
  - Specialty officers (Noise, Parking, Biosecurity, Smoke): service-specific primary CTA

- [ ] **[Frontend Developer]** Ensure SOS/welfare panic button is always the most visually prominent safety element on the Officer portal — never visually competing with navigation items. It must remain visible whenever no scan/modal is active.

### Admin shell

- [ ] **[UX Designer]** Design a "queue-first" Admin landing. The screen must surface the highest-priority queue item above the fold. KPI tiles and trend chart become secondary (scrolled below the fold or collapsed by default). Primary CTA is **Review Breach Queue** (or its equivalent when queue is empty: **View Patrol Map**).

- [ ] **[Frontend Developer]** Implement the queue-first Admin landing in `AdminPortal.tsx`. Move the KPI summary block below the breach queue. The sticky header priority actions bar should show alert counts that link directly into the queue, not to separate pages.

- [ ] **[UX Designer]** Audit and reduce the Admin module grid (`AdminPortal.tsx` ~lines 1200–1290). Currently shows ~20 module tiles. Group into primary (5–7 tiles visible, role-specific top tasks) + secondary overflow. Use the role-based filter already in the codebase to personalise which 5–7 appear.

- [ ] **[Frontend Developer]** Implement the Admin module grid reduction using an expandable/show-more pattern.

### Master/Governance shell

- [ ] **[UX Designer]** Design a "governance-first" Master landing. Primary CTA is **Review Pending Approvals** or **Governance Exceptions** (whichever has items). Configuration and diagnostics are tertiary actions behind a secondary nav group.

- [ ] **[Frontend Developer]** Implement the governance-first Master landing so that approval/exception queues are the first visible content above the fold.

- [ ] **[UX Designer]** Ensure all high-risk Master actions (org creation, access assignment, policy change, feature flag mutation) have a **progressive disclosure** pattern: confirm → preview impact → commit. This builds trust before acting.

- [ ] **[Frontend Developer]** Audit all Master-scope mutating actions for a confirm/preview gate and add where missing.

---

## PART 4 — Workflow consolidation (structural)

> Convert fragmented multi-page tasks into guided single-path flows.

- [ ] **[Product Manager]** Identify the top 3 multi-page tasks for each role that currently fragment across screens. Document the intended single-path flow for each. Candidate tasks:
  - Admin: Breach → assign officer → issue notice → record outcome
  - Admin: Report → select type → configure filters → generate → download
  - Officer: Start shift → select zone → open scan → record result → submit

- [ ] **[UX Designer]** Design a guided step/wizard component for the top 3 multi-page admin workflows identified above. Each step shows clear progress (step N of N), and users can navigate forward/back without losing form state.

- [ ] **[Frontend Developer]** Implement the guided workflow components using the existing react-hook-form + zod pattern and shadcn/ui Dialog or Sheet as the container.

- [ ] **[Frontend Developer]** Wire the guided Report workflow in `ReportsHub.tsx`. Replace "click card → navigate away" with an in-page guided flow: select report type → configure filters → preview → generate/download. This removes 3 navigation hops and keeps the user in a single context.

---

## PART 5 — Trust and consistency (structural)

> Standardise the states that create hesitation.

- [ ] **[Frontend Developer]** Audit all pages across all three shells for inconsistent loading states. Convert any raw spinner-only or blank-div loading states to skeleton layouts that match the page structure. See INSTRUCTION_MANUAL.md §1a (Page Anatomy rules).

- [ ] **[Frontend Developer]** Audit all pages across all three shells for inconsistent error states. Every error state must: (a) explain what went wrong in plain English, (b) offer a retry action, and (c) offer a fallback path (e.g. "Contact support" or "Return to dashboard"). See INSTRUCTION_MANUAL.md §1a (Page Anatomy rules).

- [ ] **[Frontend Developer]** Audit the Officer offline queue UX (`useOfflineQueue`). Ensure that when the officer is offline: (a) they are clearly told they are offline, (b) their submitted actions are visibly queued, (c) they see confirmation when the queue syncs after reconnection.

- [ ] **[Frontend Developer]** Standardise empty states across all pages. Every empty state must explain what the empty state means and provide a CTA for what to do next (e.g. "No breaches today — view patrol map" rather than just "No results"). See INSTRUCTION_MANUAL.md §1a (Page Anatomy rules).

- [ ] **[Frontend Developer]** Implement saved view / last-used filter persistence for Admin pages that have a filter ribbon (breach list, compliance, observations). Resuming a filtered view removes setup friction on repeat visits.

---

## PART 6 — Measurement (post-implementation)

> Validate that changes delivered conversion uplift.

- [ ] **[QA Engineer]** Create staging specs for Officer primary path: start patrol → scan vehicle → record result → end shift. Measure step completion rate. Target: >95% task completion with no navigation errors.

- [ ] **[QA Engineer]** Create staging specs for Admin breach triage: land on admin → see breach → triage → assign → issue notice. Measure end-to-end completion time. Target: median <3 minutes per the blueprint KPI scorecard.

- [ ] **[QA Engineer]** Create staging specs for offline queue: officer submits scan while offline → reconnects → confirms sync. Verify no data loss and user sees sync confirmation.

- [ ] **[Analytics Engineer]** Instrument task completion events for the three role conversion targets (officer patrol complete, admin breach resolved, master approval completed). Route events to the existing audit log so completion trends are visible in the audit dashboard.

- [ ] **[Analytics Engineer]** Add time-to-first-action metrics for each role landing page. Baseline current values before shipping Part 1–3 changes, then compare after. A successful CRO change should reduce time-to-first-action by at least 20%.

---

## Status tracking

| Part | Description | Status |
|---|---|---|
| Part 1 — Quick wins | Single CTA, action reduction, async states | ⬜ Not started |
| Part 2 — Route reduction | Route manifest, navigation consolidation | ⬜ Not started |
| Part 3 — Landing redesigns | Patrol-first, queue-first, governance-first | ⬜ Not started |
| Part 4 — Workflow consolidation | Guided flows, report workflow | ⬜ Not started |
| Part 5 — Trust and consistency | Loading, error, offline, empty states | ⬜ Not started |
| Part 6 — Measurement | Staging specs, analytics instrumentation | ⬜ Not started |

---

*Maintained alongside [`docs/INSTRUCTION_MANUAL.md`](./INSTRUCTION_MANUAL.md) and [`docs/STAGING.md`](./STAGING.md).*  
*When any item above is completed, update the Status column and record the change in `docs/DECISIONS.md` if it involves a structural product decision.*
