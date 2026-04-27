# FieldOps Master UI/UX Redesign Spec

Status: proposed
Date: 2026-04-26
Owner: product and platform

## 1. Scope and Intent

This spec defines one enterprise-grade UI/UX direction for FieldOps Manager across admin, officer, and specialist workflows. It is grounded in the current route map, navigation shells, module registry, role model, and existing architecture and decision docs.

Primary goal:
- Create a single coherent information architecture and interaction model that scales across 80+ pages without navigation drift or role confusion.

Out of scope:
- Backend schema changes not required by UX delivery.
- Replacing Supabase auth or tenancy model in this phase.

## 2. Grounded Inputs

- App route and role guards in `src/App.tsx`.
- Sidebar IA in `src/components/features/AppLayout.tsx`.
- Alternate admin nav surface in `src/components/features/AdminNavigationMenu.tsx`.
- Admin entry points in `src/pages/AdminHub.tsx` and `src/pages/AdminPortal.tsx`.
- Officer entry point and service mode complexity in `src/pages/FieldOfficerPortal.tsx`.
- Portal chooser in `src/pages/PortalSelection.tsx`.
- Module intent contract in `src/modules/registry.ts`.
- Design tokens and themes in `src/index.css` and `tailwind.config.ts`.
- Current decision constraints in `docs/DECISIONS.md`.
- Current schema inventory in `docs/LIVE_SCHEMA.md`.
- External benchmark notes in `docs/uiux-master-redesign/external-research-2026.md`.
- Strict pattern matrix in `docs/uiux-master-redesign/external-pattern-matrix-2026.md`.

## 2.1 Full Schema Review Baseline

The redesign is reconciled against the current documented live public schema sections in `docs/LIVE_SCHEMA.md`.

Reviewed schema domains:
- Core enforcement and observations: `observations`, `breach_alerts`, `compliance_results`, `notices_to_vacate`, `infringement_notices`.
- Canonical intelligence: `canonical_vehicles`, `canonical_scv`, `canonical_homeless`.
- Identity and tenancy: `organizations`, `user_profiles`, `zones`, `zone_legal_config`.
- Patrol and workforce: `patrols`, `patrol_checkpoints`, `checkpoint_visits`, `patrol_schedule_zones`, `officer_shifts`, `officer_welfare_settings`, `officer_welfare_alerts`, `officer_activity_log`.
- Records and people: `incidents`, `incident_attachments`, `person_records`, `person_observations`, `person_vehicle_links`, `person_interactions`.
- Governance and privacy: `privacy_access_log`, `privacy_curtain_settings`, `retention_policies`, `audit_log`.
- Import and operations support: `import_batches`, `import_staging`, `zone_signage_evidence`, `zone_compliance_matrix`, `vehicle_monthly_stays`.
- Enforcement workflows: `enforcement_cases`, `enforcement_case_events`, `enforcement_actions`, `infringement_notice_counters`, `dispute_intake`.

## 3. Current-State UX Findings

1. Navigation source-of-truth drift:
- Route visibility logic is split between route wrappers, sidebar arrays, and separate admin menu groups.
- Discoverability regressions are likely because pages can exist in routing but not in all nav surfaces.

2. IA scale pressure:
- Large flat route surface with mixed paradigms (hub cards, dashboard tiles, grouped side nav, top nav dropdown).
- Users must learn different navigation grammars per area.

3. Role and portal cognitive load:
- `admin_officer` and multi-role users carry branching behavior at route level and portal-level decisions.
- Mental model is "where do I go now" instead of "what is my mission now".

4. Mode inconsistency:
- Admin uses card hubs and dashboard tiles; officers use action-heavy workflow pages.
- Good local designs exist, but cross-system consistency and wayfinding are weak.

5. Theme and interaction strengths to keep:
- Existing tokenized themes, high-contrast mode, and night patrol mode are strong operational foundations.
- Floating action controls (PTT/chat/Bob) align with operations use cases and should be retained with clearer hierarchy.

## 4. Redesign Principles

1. Mission-first navigation:
- Organize by user mission (Monitor, Respond, Manage, Govern, Analyze), not by historical page ownership.

2. One IA contract:
- Every route must map to one canonical navigation registry with role + portal + org scope metadata.

3. Progressive disclosure:
- Show high-frequency actions first, specialist and low-frequency tools one layer deeper.

4. Operational clarity:
- Critical state is always visible (alerts, welfare risk, dispatch backlog, active incidents).

5. Tenant-aware by design:
- Org context is explicit in header and reflected in all data-bearing views.

6. Consistent page anatomy:
- Each page follows a stable structure: title, status strip, primary actions, filters, content, audit trace.

## 5. Target Information Architecture

Primary global sections (single left nav model for desktop, sheet for mobile):

1. Mission Control
- Live overview, critical alerts, operational status, cross-module watchlist.

2. Field Operations
- Patrol, dispatch, officer tracking, welfare, checkpoints, live maps.

3. Compliance and Enforcement
- Breaches, notices, infringements, disputes, enforcement workflow.

4. Intelligence and Records
- Vehicles, people, incidents, investigations, observations, registry tools.

5. Workforce and Scheduling
- Rosters, skills, availability, open shifts, timesheets.

6. Clients and Commercial
- CRM, client sites, contracts, pricing, invoicing, assets.

7. Reports and Analytics
- Reports hub, KPI boards, custom reports, exports, audit-centric analytics.

8. Platform and Settings
- User and org admin, integrations, data tools, diagnostics, service-provider controls.

## 5.1 Route and Module Coverage Reconciliation

To prevent missed modules, the IA explicitly covers all current route families found in `src/App.tsx` and the current module IDs in `src/modules/registry.ts`.

Module IDs covered:
- `core`, `freedom_camping`, `parking`, `noise`, `guarding`, `patrol`, `rostering`, `ptt_chat`, `ems`, `dispatch`, `ticketing`, `incidents`.

Route families that must remain first-class in IA (no orphan modules):

1. Admin and command surfaces:
- `/admin`, `/admin/dashboard`, `/admin/data-hub`, `/admin/data-integrity`, `/admin/discrepancies`, `/admin/nzscv`, `/admin/canonical-records`, `/admin/service-provider-access`.

2. Field and specialist operations:
- `/field-officer`, `/officer-home`, `/site-guard`, `/parking-officer`, `/noise-officer`, `/biosecurity-officer`, `/smoke-officer`, `/ems`.

3. Compliance and enforcement:
- `/compliance`, `/compliance-analytics`, `/breaches`, `/breach-notices`, `/notice-to-vacate`, `/infringements`, `/disputes`, `/enforcement-actions`, `/enforcement-review`, `/enforcement-command-center`.

4. Intelligence and records:
- `/vehicles`, `/vehicle-registry`, `/observations`, `/observation-records`, `/person-records`, `/incidents`, `/incident-reports`, `/investigations`, `/face-recognition`, `/points-of-interest`, `/site-risk-assessment`.

5. Live operations and dispatch:
- `/live-patrol`, `/live-tracking`, `/operations-map`, `/hotspots`, `/dispatch`, `/dispatch-monitor`, `/dispatch-wizard`, `/dispatched-jobs`, `/job-map`.

6. Workforce and shifts:
- `/roster`, `/open-shifts`, `/availability`, `/officer-skills`, `/timesheets`, `/patrol-schedule`, `/patrol-kpis`, `/patrol-checkpoints`.

7. Commercial and client workflows:
- `/crm`, `/crm/client/:orgId`, `/crm/contractor/:orgId`, `/client-portal`, `/client-sites`, `/client-master-list`, `/pricing`, `/invoicing`, `/asset-management`, `/organizations`, `/organization-profile`.

8. Communications and AI collaboration:
- `/messages`, `/team-chat`, `/radio`, `/radio/log`, `/bob-assistant`, `/bob-intake-queue`, `/bob-ui-review`, `/ai-analysis`, `/live-plan-reviews`, `/intel-approvals`.

9. Platform governance and diagnostics:
- `/platform`, `/compliance-escalations`, `/grandmaster-code-studio`, `/diagnostics`, `/settings`, `/profile`, `/notifications`, `/privacy-curtain`, `/audit-log`, `/search`.

10. Procurement and workspace modules:
- `/tender-workspace`, `/tender-workspace/:id`, `/tender-reference-library`.

11. Public and utility entry points:
- `/login`, `/portal-selection`, `/public/dispute`, `/import-data`, `/import-historical`, `/photo-reingest`, `/evidence-photo-linker`.

12. Internal QA routes to preserve under controlled visibility:
- `/clean-dashboard`, `/test-dashboard`.

## 6. Persona-Specific Experience Contracts

Admin and master:
- Default to Mission Control.
- Access all IA sections by policy.

Admin officer:
- Start with mission chooser (Admin Operations vs Field Operations), then persistent quick-switch.
- Keep one nav grammar regardless of chosen mode.

Officer:
- Default to Field Operations with an action board (Start shift, Assignments, Safety, Capture, Escalate).
- Keep specialist portals as contextual toolsets under Field Operations.

Grand master:
- Platform overview remains available but visually aligned to same IA structure with additional governance panels.

## 7. Navigation and Wayfinding Blueprint

1. Canonical access registry:
- Introduce a typed route registry for path, label, section, surface, allowedRoles, area code, org-scope flags, aliases.

2. Single render pipeline:
- `App.tsx`, `AppLayout.tsx`, and `AdminNavigationMenu.tsx` derive from the same registry.

3. State surfaces:
- Global top strip for alerts and environment state.
- Page-level breadcrumbs and section context.

4. Search as first-class nav:
- Promote unified command search with route actions and recent context.

## 8. Interaction and UI System Direction

1. Keep existing tokens and operational themes, but standardize component density tiers:
- Dense (control room), standard (admin), glove-safe (field/night).

2. Standardize card taxonomy:
- Metric card, workflow card, alert card, queue card, task card.

3. Critical action hierarchy:
- One primary action per page, max two secondary action groups.

4. Live status language:
- Use consistent state scale: normal, watch, action, critical.

5. Mobile-first officer ergonomics:
- Preserve large touch targets, night readability, and low-motion fallbacks.

## 9. Accessibility and Reliability Requirements

WCAG 2.2 criteria explicitly required for implementation acceptance:
1. Focus visibility and non-obscured focus behavior (`2.4.11`).
2. Alternatives for drag-based interactions (`2.5.7`).
3. Minimum interactive target sizing in operational views (`2.5.8`).
4. Consistent help placement and support access (`3.2.6`).
5. Reduced repeated data entry in high-frequency workflows (`3.3.7`).
6. Accessible authentication flows for field and admin users (`3.3.8`).

1. WCAG 2.2 AA color and contrast compliance for all role-critical pages.
2. Keyboard-only navigation coverage for admin workflows.
3. Reduced-motion behavior for animated surfaces.
4. Stable loading and error boundaries with actionable recovery text.
5. Empty, error, and offline states as explicit design states.

## 9.1 External Benchmark Deltas Applied

From external 2026 research pass:
1. Maintain mission/task-first IA as primary operating model.
2. Treat design-system governance and shared page anatomy as release blockers, not optional polish.
3. Prioritize mobile and field ergonomics as first-order concerns in officer workflows.
4. Keep AI assistant interactions contextual and assistive, not mandatory navigation gates.

## 10. Success Metrics

UX outcomes:
- Reduce time-to-feature discovery by 40% for admin tasks.
- Reduce route dead-ends and nav backtracking events by 50%.
- Reduce officer taps to first operational action by 30%.

Operational outcomes:
- Faster escalation initiation from alert state.
- Higher completion rate for scheduled patrol and dispatch transitions.
- Lower support tickets for "cannot find module" navigation issues.

## 11. Validation Gates

1. IA coherence test:
- Every live route maps to exactly one registry entry and one IA section.

1.1 Coverage parity test:
- Every route family listed in section 5.1 is represented in the navigation registry and assigned an IA owner section.

2. Role journey test:
- Admin, admin_officer, officer, and master complete top 10 workflows with no unresolved detours.

3. Theming and accessibility test:
- Light, dark, high-contrast, and night-patrol pass visual and keyboard checks.

4. Performance test:
- No regression in initial route load and navigation interaction latency for core portals.

## 12. Risks and Constraints

1. Route and nav drift may reappear if registry governance is not enforced in CI.
2. Scope creep risk due to breadth of specialist portals.
3. Team adoption risk if page anatomy standards are not templated.

Mitigation:
- Introduce lint/test rules for route registry coverage and nav parity.
- Roll out by IA section in phases, not by individual page ownership.
