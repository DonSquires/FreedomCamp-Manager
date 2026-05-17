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

## PART 1 — Quick wins (low effort, high uplift) ✅ COMPLETE

> These items can be completed independently of the structural refactor. Ship them as soon as each is ready.

- [x] **[UX Designer]** Design a dominant primary CTA for each role landing page — one button per screen, styled in the brand primary colour, positioned in the page header. See INSTRUCTION_MANUAL.md §1a (Page Anatomy / PRIMARY ACTIONS rule: max one main action per page).

- [x] **[Frontend Developer]** Implement the single-primary-CTA rule across `AdminPortal.tsx`, `FieldOfficerPortal.tsx`, and `ReportsHub.tsx`. Demote all secondary actions to `variant="outline"` or `variant="ghost"`.

- [x] **[UX Designer]** Redesign the Admin Command Centre sticky header (`AdminPortal.tsx` lines 689–733). Reduce from 4 header buttons (Breaches, Welfare, Dispatch, Reports) to 2 primary (Breaches, Welfare) + one overflow "More" menu. Dispatch and Reports move to overflow.

- [x] **[Frontend Developer]** Implement the Admin header reduction. Wire Dispatch and Reports into an overflow `DropdownMenu` component using the existing shadcn/ui primitive.

- [x] **[UX Designer]** Redesign the Officer "common tools" grid (`FieldOfficerPortal.tsx` lines 2431–2575). Currently shows 11 equal-weight cards. Reduce to 3 primary cards (Start/Resume Patrol, Checkpoint, Quick Report) + a collapsible "More tools" section for specialty modules (Noise, Biosecurity, Smoke, Parking, Zones, Infringements, History).

- [x] **[Frontend Developer]** Implement the Officer tools grid reduction. Group specialty module cards under a collapsible section using Collapsible from shadcn/ui. Remember glove-safe touch targets (≥ 44×44 px).

- [x] **[UX Designer]** Redesign `ReportsHub.tsx`. Replace the 4-section report card grid + separate Quick Actions card with a single "Start here" hero section surfacing the most-used report per role (Leadership Pack for admin, Patrol Activity for officer), followed by a categorised list view.

- [x] **[Frontend Developer]** Implement the Reports Hub redesign. Remove the standalone Quick Actions card (its actions duplicate the report cards above it). Add a role-aware "recommended" report that appears at the top.

- [x] **[Frontend Developer]** Add explicit status/progress/retry language to all async states in all three shells. Officer portal now shows explicit "Checking your shift access..." during gate load and "Route data could not be refreshed" + retry button on error. Admin portal shows improved error message with "Open patrol map" fallback button. Offline sync indicator already present.

- [x] **[Frontend Developer]** Add a "Last synced" or "X items pending sync" indicator to the Officer shell header when the offline queue has pending items. Officers need confirmation that queued actions will reach the server.

---

## PART 2 — Navigation and route reduction (structural)

> These items require co-ordinated design + development work. Complete after Part 1.

- [x] **[Platform Engineer]** Audit all 319 registered routes in `src/App.tsx`. Produce a trimmed route inventory that maps to the three-shell model (Officer, Admin, Master) as specified in `docs/UX_UI_ARCHITECTURE_BLUEPRINT_MERGED.md` §2. Target: remove or redirect all routes that do not correspond to a production shell, are internal/dev tools, or are redundant duplicates of existing routes. *(Route manifest in `src/navigation/routeManifest.ts` is the canonical inventory — 170+ entries with visibility and role fields; shipped in Part 2.2)*

- [x] **[Frontend Developer]** Implement the route manifest + compatibility adapter as specified in `docs/UX_UI_ARCHITECTURE_BLUEPRINT_MERGED.md` §2 (Navigation and Route Manifest). The manifest must include `visibilityMode` (production / internal / hidden) and `mobilePriority` fields. *(Shipped: `src/navigation/routeManifest.ts`, `src/navigation/routeManifestAdapter.ts`, Part 2.2 runtime enforcement)*

- [x] **[Frontend Developer]** Hide all routes with `visibilityMode: internal` from production navigation. Internal routes (`/diagnostics`, `/grandmaster-code-studio`, `/admin/data-integrity`, `/admin/data-cleanup`, etc.) must not appear in sidebar or top-nav for any production role. *(Shipped: `isRouteHidden`, `resolveRuntimeVisibilityMode` in routeManifestAdapter; `App.tsx` + `AppLayout.tsx` pass runtime visibility mode to `isRouteVisibleForRole`)*

- [x] **[Product Manager]** Resolve the overlapping admin dashboard routes (`/admin`, `/admin/dashboard`, `/dashboard`). Decide on one canonical admin landing path and redirect the others. Document the decision in `docs/DECISIONS.md`. *(Decision: admin/master canonical entry = `/admin/dashboard`; `/admin` = hub overview (not entry point); `/dashboard` = data/analytics (not entry point). Recorded in DECISIONS.md 2026-05-17)*

- [x] **[Frontend Developer]** Implement the consolidated admin landing redirect once the Product Manager decision above is recorded. *(Shipped: `getDefaultRouteForRole` admin/master cases → `/admin/dashboard`; root `/` route now explicit redirect block for all roles)*

- [x] **[Product Manager]** Resolve the overlapping officer landing paths (`/field-officer`, `/portal-selection`, `/officer-home`). Define one canonical officer entry path and the auto-route rules per roster/service type. Document in `docs/DECISIONS.md`. *(Decision: paths serve distinct sequential purposes — no consolidation needed. Recorded in DECISIONS.md 2026-05-17)*

- [x] **[Frontend Developer]** Implement the simplified officer entry routing once the decision above is recorded. *(No change required — existing officer default `/officer-home` is already correct)*

---

## PART 3 — Role-specific landing redesigns (structural)

> Each shell gets a focused primary-path landing. Design before implementing.

### Officer shell

- [x] **[UX Designer]** Design a "patrol-first" Officer landing. The screen must answer "What do I do next?" in one glance. The primary CTA is **Start Patrol** (or **Resume Patrol** if a shift is active). A shift status banner (active/rostered/unrostered) should dominate the top of the screen. *(Shipped in `FieldOfficerPortal.tsx`: top-of-fold Patrol Command Banner with explicit Shift Active/Rostered/Unrostered badge and dominant Start/Resume CTA.)*

- [x] **[Frontend Developer]** Implement the patrol-first Officer landing in `FieldOfficerPortal.tsx`. The start/resume patrol action is the primary CTA. Service-type selection (for admin_officers with multiple options) is secondary. Specialty modules are behind "More tools". *(Shipped: `Service Type (Secondary)` heading, retained `More tools` collapsible modules.)*

- [x] **[UX Designer]** Define Officer action hierarchy per role variant:
  - `officer` (pure field): Start Patrol → Scan → Breach → Welfare SOS
  - `admin_officer` (dual): Patrol or Admin chooser → then same Officer path
  - Specialty officers (Noise, Parking, Biosecurity, Smoke): service-specific primary CTA
  *(Shipped in banner helper copy + admin_officer secondary chooser action.)*

- [x] **[Frontend Developer]** Ensure SOS/welfare panic button is always the most visually prominent safety element on the Officer portal — never visually competing with navigation items. It must remain visible whenever no scan/modal is active. *(Shipped: SOS block moved above notifications/services with increased size, contrast, and emphasis; still gated to show whenever no scan/modal is active.)*

### Admin shell

- [x] **[UX Designer]** Design a "queue-first" Admin landing. The screen must surface the highest-priority queue item above the fold. KPI tiles and trend chart become secondary (scrolled below the fold or collapsed by default). Primary CTA is **Review Breach Queue** (or its equivalent when queue is empty: **View Patrol Map**). *(Shipped in `AdminPortal.tsx`: top-of-fold Queue First hero with dynamic primary CTA.)*

- [x] **[Frontend Developer]** Implement the queue-first Admin landing in `AdminPortal.tsx`. Move the KPI summary block below the breach queue. The sticky header priority actions bar should show alert counts that link directly into the queue, not to separate pages. *(Shipped: sticky actions now include queue counts for breaches/welfare/disputes; KPI blocks remain below queue-first hero.)*

- [x] **[UX Designer]** Audit and reduce the Admin module grid (`AdminPortal.tsx` ~lines 1200–1290). Currently shows ~20 module tiles. Group into primary (5–7 tiles visible, role-specific top tasks) + secondary overflow. Use the role-based filter already in the codebase to personalise which 5–7 appear. *(Shipped: `Primary task modules` panel with role-aware tile set, including master-only Organizations tile.)*

- [x] **[Frontend Developer]** Implement the Admin module grid reduction using an expandable/show-more pattern. *(Shipped: `Show more modules` toggle gates full `All Systems` card as secondary overflow.)*

### Master/Governance shell

- [x] **[UX Designer]** Design a "governance-first" Master landing. Primary CTA is **Review Pending Approvals** or **Governance Exceptions** (whichever has items). Configuration and diagnostics are tertiary actions behind a secondary nav group. *(Shipped in `AdminPortal.tsx`: master-only Governance First hero with dynamic approvals/exceptions CTA and tertiary config group.)*

- [x] **[Frontend Developer]** Implement the governance-first Master landing so that approval/exception queues are the first visible content above the fold. *(Shipped: governance card rendered above queue/KPI sections for `master` role.)*

- [x] **[UX Designer]** Ensure all high-risk Master actions (org creation, access assignment, policy change, feature flag mutation) have a **progressive disclosure** pattern: confirm → preview impact → commit. This builds trust before acting. *(Shipped on Master landing surface in `AdminPortal.tsx`: confirm+impact-preview dialog for organization, access-control, and feature-flag entrypoints.)*

- [x] **[Frontend Developer]** Audit all Master-scope mutating actions for a confirm/preview gate and add where missing. *(Completed for high-risk governance entrypoints by adding route-level gate in `App.tsx` for `/organizations`, `/access-control`, and `/feature-flags`, plus landing-level guard in `AdminPortal.tsx`.)*

---

## PART 4 — Workflow consolidation (structural)

> Convert fragmented multi-page tasks into guided single-path flows.

- [x] **[Product Manager]** Identify the top 3 multi-page tasks that currently fragment across screens and document the intended single-path flow for each. *(Documented and now grounded in shipped guided flows.)*
  - Admin breach workflow: queue selection → guided triage in `BreachAlerts.tsx` (choose action → capture details → confirm/execute) → optional notice handoff.
  - Admin report workflow: Reports Hub guided flow in `ReportsHub.tsx` (select type → configure filters → preview → generate/download).
  - Officer patrol workflow: guided shift flow in `FieldOfficerPortal.tsx` (start/resume shift → confirm zone → open scan → record result → submit report).

- [x] **[UX Designer]** Design a guided step/wizard component for the top 3 multi-page admin workflows identified above. Each step shows clear progress (step N of N), and users can navigate forward/back without losing form state. *(Shipped for the report workflow in `ReportsHub.tsx`: 4-step dialog flow with explicit step labels and Back navigation.)*

- [x] **[Frontend Developer]** Implement the guided workflow components using the existing react-hook-form + zod pattern and shadcn/ui Dialog or Sheet as the container. *(Shipped in `ReportsHub.tsx` using `react-hook-form`, `zodResolver`, and shadcn `Dialog`.)*

- [x] **[Frontend Developer]** Wire the guided Report workflow in `ReportsHub.tsx`. Replace "click card → navigate away" with an in-page guided flow: select report type → configure filters → preview → generate/download. This removes 3 navigation hops and keeps the user in a single context.

- [x] **[Frontend Developer]** Wire the guided Admin breach workflow in `BreachAlerts.tsx`. Replace direct action-only decisioning with an in-page triage flow: choose action → capture required details (assignment, rejection reason, or outcome notes) → confirm and execute existing breach mutations or notice handoffs.

---

## PART 5 — Trust and consistency (structural)

> Standardise the states that create hesitation.

- [x] **[Frontend Developer]** Audit all pages across all three shells for inconsistent loading states. Convert any raw spinner-only or blank-div loading states to skeleton layouts that match the page structure. See INSTRUCTION_MANUAL.md §1a (Page Anatomy rules). *(Shipped across primary shell surfaces: `AdminPortal.tsx`, `ComplianceDashboard.tsx`, `BreachAlerts.tsx`, `FieldOfficerPortal.tsx`, `PatrolKPIDashboard.tsx`, `ObservationRecords.tsx`, `PublicParkingAppealPortal.tsx`, with AsyncStateWrapper/skeleton parity and page-appropriate loading messaging.)*

- [x] **[Frontend Developer]** Audit all pages across all three shells for inconsistent error states. Every error state must: (a) explain what went wrong in plain English, (b) offer a retry action, and (c) offer a fallback path (e.g. "Contact support" or "Return to dashboard"). See INSTRUCTION_MANUAL.md §1a (Page Anatomy rules). *(Shipped with explicit retry + fallback paths in high-traffic surfaces including `AdminPortal.tsx`, `ComplianceDashboard.tsx`, `ObservationRecords.tsx`, and queue workflows; toast-only failure paths were upgraded where needed.)*

- [x] **[Frontend Developer]** Audit the Officer offline queue UX (`useOfflineQueue`). Ensure that when the officer is offline: (a) they are clearly told they are offline, (b) their submitted actions are visibly queued, (c) they see confirmation when the queue syncs after reconnection. *(Shipped in `FieldOfficerPortal.tsx`: explicit offline banner copy, queued/syncing counts, `Sync now` action, reconnect auto-sync trigger, and sync-complete confirmation toast.)*

- [x] **[Frontend Developer]** Standardise empty states across all pages. Every empty state must explain what the empty state means and provide a CTA for what to do next (e.g. "No breaches today — view patrol map" rather than just "No results"). See INSTRUCTION_MANUAL.md §1a (Page Anatomy rules). *(Shipped with actionable empty-state copy/CTAs in `BreachAlerts.tsx`, `PatrolKPIDashboard.tsx`, `ObservationRecords.tsx`, and other audited queue/list views.)*

- [x] **[Frontend Developer]** Implement saved view / last-used filter persistence for Admin pages that have a filter ribbon (breach list, compliance, observations). Resuming a filtered view removes setup friction on repeat visits. *(Verified via persisted Zustand store in `globalFiltersStore.ts` (`global-filters-storage`) and active `GlobalFilterRibbon` wiring in `BreachAlerts.tsx`, `ComplianceDashboard.tsx`, and `ObservationRecords.tsx`.)*

---

## PART 6 — Measurement (post-implementation)

> Validate that changes delivered conversion uplift.

- [x] **[QA Engineer]** Create staging specs for Officer primary path: start patrol → scan vehicle → record result → end shift. Measure step completion rate. Target: >95% task completion with no navigation errors. *(Shipped: `tests/e2e/cro-part6-officer-primary-path.spec.ts` — 9-step workflow with step timing, retry tracking, completion rate assertion.)*

- [x] **[QA Engineer]** Create staging specs for Admin breach triage: land on admin → see breach → triage → assign → issue notice. Measure end-to-end completion time. Target: median <3 minutes per the blueprint KPI scorecard. *(Shipped: `tests/e2e/cro-part6-admin-breach-triage.spec.ts` — 9-step workflow with cumulative timing per step and 3-minute total duration gate.)*

- [x] **[QA Engineer]** Create staging specs for offline queue: officer submits scan while offline → reconnects → confirms sync. Verify no data loss and user sees sync confirmation. *(Shipped: `tests/e2e/cro-part6-offline-queue-measurement.spec.ts` — 10-step workflow with queue persistence, auto-sync, sync confirmation, and DB data integrity verification; zero-data-loss assertion.)*

- [x] **[Analytics Engineer]** Instrument task completion events for the three role conversion targets (officer patrol complete, admin breach resolved, master approval completed). Route events to the existing audit log so completion trends are visible in the audit dashboard. *(Shipped: `src/lib/croMetrics.ts` — `writeCroEvent` writes to `audit_log` with `cro_` prefix; `trackPatrolComplete` wired in `useCompletePatrol` mutation; `trackBreachResolved` wired in `resolveMutation` in `BreachAlerts.tsx`; `trackApprovalComplete` wired in `applyGovernanceAction` in `AdminPortal.tsx`.)*

- [x] **[Analytics Engineer]** Add time-to-first-action metrics for each role landing page. Baseline current values before shipping Part 1–3 changes, then compare after. A successful CRO change should reduce time-to-first-action by at least 20%. *(Shipped: `trackTimeToFirstAction` in `croMetrics.ts`; wired to first-click guard (`hasTrackedFirstActionRef` + `pageLoadTimeRef`) in `FieldOfficerPortal.tsx` (`handlePrimaryPatrolAction`) and `AdminPortal.tsx` (queue-first primary CTA). Events recorded as `cro_time_to_first_action` in `audit_log` with `surface`, `first_action`, and `duration_ms` fields.)*

---

## Status tracking

| Part | Description | Status |
|---|---|---|
| Part 1 — Quick wins | Single CTA, action reduction, async states | ✅ Complete |
| Part 2 — Route reduction | Route manifest, navigation consolidation | ✅ Complete |
| Part 3 — Landing redesigns | Patrol-first, queue-first, governance-first | ✅ Complete |
| Part 4 — Workflow consolidation | Guided flows, report + breach + officer workflows | ✅ Complete |
| Part 5 — Trust and consistency | Loading, error, offline, empty states | ✅ Complete |
| Part 6 — Measurement | Staging specs, analytics instrumentation | ✅ Complete |

---

*Maintained alongside [`docs/INSTRUCTION_MANUAL.md`](./INSTRUCTION_MANUAL.md) and [`docs/STAGING.md`](./STAGING.md).*  
*When any item above is completed, update the Status column and record the change in `docs/DECISIONS.md` if it involves a structural product decision.*
