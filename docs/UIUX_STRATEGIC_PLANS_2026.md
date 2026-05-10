# Enterprise UI/UX Realignment — Three Perspectives, One Master Plan

**Context**: FieldOps Manager currently has 291 page components, excessive button density (50+ per page), 12+ navigation systems competing, inconsistent form patterns, and visual clutter. Foundation is solid (routes aligned, schema clean, edge functions modern). NOW: bring UX to enterprise standards.

**Grounding Documents (Authority):**
- `docs/INSTRUCTION_MANUAL.md` — Page anatomy rules, shell model, design tokens, performance budgets, accessibility standards, offline-first requirements
- `docs/LIVE_SCHEMA.md` — Data model constraints, 56+ tables, observation→breach→action workflow
- `src/navigation/routeManifest.ts` — 250+ routes organized into 18 nav groups (66 under "Records", 57 under "Operations", 44 under "Management" — classic sidebar bloat)

**Current State:**
- 66 separate record pages (vehicles, persons, zones, incidents, etc.) in isolated "Records" group
- 57 operational pages scattered across "Operations", "Live Ops", "Dispatch", etc.
- Button density: 50 buttons / page (should be ≤8 for standard density, ≤5 for admin pages)
- Navigation fragmentation: sidebar + breadcrumbs + PTT bar + filter ribbon + banners = 5 systems
- Forms: 7+ different validation/error/styling patterns (should be 1 unified pattern)
- Pages per nav group: 66, 57, 44, 18, 14, 14, 10, 7, 7, 6, 4, 4, 3, 3, 3, 2, 2, 1
- **Target state**: ~120 pages (60% reduction), 1 unified nav system, ≤5 buttons per page header, consistent patterns

---

# PERSPECTIVE 1: Copilot Strategic Plan — "Shell-Centric Consolidation"

## PLAN A: Shell-Centric Consolidation (Progressive Enterprise Refactor)

### Philosophy
Redesign the entire information architecture around the three **shells** defined in INSTRUCTION_MANUAL.md: Officer (glove-safe, mobile-first, single-task), Admin (queue-driven, compliance-centric), Master (governance, oversight). Each shell gets its own IA, navigation, and design language — unifying what's now fragmented.

**Key Principle**: Pages disappear; workflows and roles become the organizing unit. A "record" (vehicle, person, zone) is NOT a separate page — it's a side panel or modal triggered from context.

### Phase 1: Officer Shell Consolidation (4 weeks)

**Current state**: Officer portals have 5+ competing navigation systems (sidebar, PTT bar, field safety bar, banners, breadcrumbs).

**Redesigned state**: 
- **Single persistent bottom-nav bar** with 4 touches: Patrol → Scan → My Shift → Help
- No sidebar on mobile (too small)
- **Full-screen task cards** for each action (one task = one screen)
- Breach detection lives inline in scan results, not on a separate page
- All offline functionality cached locally; sync queue badge persistent at top

**Payoffs:**
- Eliminates 40+ officer portal pages (every scan/breach/notice variant compressed to one reusable task card)
- Reduced cognitive load: officer sees one task at a time
- Faster on slow 4G (single full-screen component, not multi-page nav)
- Meets performance budget: <2.5s TTI, <150ms action feedback

**Implementation**:
1. Create unified `<OfficerTaskCard />` component (replaces 30+ scattered components)
2. Consolidate all patrol logics into `<PatrolWorkflow />` (scan → result → action decision → notice generation is one flow)
3. Implement `<OfflineQueueBadge />` persistent syncing UI
4. Restructure officer routes: `/field-officer/patrol`, `/field-officer/scan/:plateId`, `/field-officer/dispatch` only (vs. current scattered 40+ pages)
5. **Bob/BDR role**: Generate one "Officer Portal UX Spec" showing before/after task flows, reference offline handling requirements

**Human Testing Protocol**: 
- 5 field officers (diverse skill: new hire, veteran, high-stress conditions)
- Test on actual devices (iPhone + Android) in low-light conditions
- Measure: time-to-action, error rate, preference vs. old UI

---

### Phase 2: Admin Shell Consolidation (6 weeks)

**Current state**: 66 pages crowded under "Records", 57 under "Operations", 44 under "Management". Forms/filters/sorting differ per page.

**Redesigned Admin IA**: 
```
Admin Shell (top)
  ├─ Dashboard (live KPIs, priority queue badges)
  ├─ Compliance (unified hub: breaches → notices → actions → disputes)
  │  ├─ [Sub-1] Live Breach Queue (filterable, sortable, bulk action)
  │  ├─ [Sub-2] Notice Management (draft/issued/paid/disputed lifecycle)
  │  ├─ [Sub-3] Enforcement Actions (triage, review, escalation)
  ├─ Operations (live patrol, dispatch, welfare)
  │  ├─ [Sub-1] Live Patrol Monitor
  │  ├─ [Sub-2] Dispatch Console
  │  ├─ [Sub-3] Officer Welfare
  ├─ Records Unified (search + faceted filtering, no separate pages per record type)
  │  ├─ Vehicles (ALPR, compliance, history)
  │  ├─ Persons (interaction log, homeless flag, welfare history)
  │  ├─ Zones (bylaw, LOI, geofence, KPIs)
  │  ├─ Incidents (multi-service: noise, biosecurity, smoke, parking)
  ├─ Reports (pre-built + custom, scheduled, export)
  ├─ CRM (clients, tender workspace, service agreements)
  ├─ Settings (users, org, workflows, feature flags)
  └─ Bob Workspace (slide-out panel, not a page)
```

**Payoff**: 
- Reduces from 66+57+44 = 167 pages to ~20 core pages (87% reduction)
- No more hunting: vehicle record opened via search/list, never as separate `/vehicles/UUID` page
- Consistent form/filter/sorting UX across entire platform

**Implementation**:
1. **Records Unified** — single search + faceted-filter component replaces 66 isolated record pages
   - Global search finds plates, person names, zone names, incident IDs
   - Facets: status, date range, org, assigned-to, zone, service-type
   - Result selected → detail panel slides in from right (not separate page)
   - All record types (vehicle, person, zone, incident) share one detail panel template
2. **Compliance Hub** — breach queue + notice lifecycle + actions all on one page
   - Table view with tabs (Active | Pending Review | Actioned)
   - Inline status toggle (filter by state)
   - Bulk action toolbar appears when rows selected
   - Click row → detail panel opens (side panel, not modal)
   - Action buttons in panel trigger state changes + document generation (no secondary pages)
3. **Unified Forms** — all forms (issue notice, create incident, update zone) use same validation/error/submission pattern
   - Zod schema + react-hook-form wrappers
   - Error toast at top of page + inline field feedback
   - Always show "Save" + "Save & Add Another" + "Discard" (not contextual button labels)
   - Pre-fill known data (zone from breach record, officer from session, etc.)

**Bob/BDR Role**:
- Generate "Admin Hubarch Specification" showing record consolidation mapping (66 record pages → 1 search + detail panel)
- Create "Form Pattern Guide" — mock 5 different form types unified in one template
- BDR review: does compliance hub cover all escalation paths? Any state transitions missed?

**Human Testing**:
- 3 admins; 3 admin-officers (dual role, context-switching stress)
- Workflow: find vehicle → check breach history → issue notice → mark resolved (vs. today's multi-page hunt)
- Measure: pages visited, clicks, time-to-task completion, error recovery

---

### Phase 3: Master Shell & Navigation Unification (4 weeks)

**Master shell current**: Organization management, system diagnostics, pricing, tender workspace scattered across sidebar.

**Redesigned Master**:
- **Governance Dashboard** — cross-org metrics, health status, feature rollouts, audit trail
- **Multi-Org View** — tree selector, realtime per-org KPI cards
- **System & Admin** — diagnostics, pricing, user mgmt, feature flags
- No separate pages for Organisations, Pricing, etc. — all driven by sidebars + data panels or modals inside Governance Dashboard

**Navigation Unification**:
- **Single sidebar** (vs. 5 competing systems) with 4 levels deep max
- **Breadcrumb only for detail pages** (no depth browsing from sidebar needed)
- **Global search** always available (`Cmd+K` or search icon)
- **Bob workspace** = floating panel, not navigation destination
- **No breadcrumbs on list/queue pages** (sidebar breadcrumb is sufficient)

**Payoff**: Operators never lost; max 2 clicks from any page to any other page via sidebar or search

**Implementation**:
1. Refactor AppLayout sidebar to max 4 nesting levels (vs. current unbounded depth)
2. Implement global search with context (vehicle plates, person names, zone names, page names)
3. Hide low-traffic pages behind **"More" menu** (e.g. audit log, diagnostics behind org settings → admin → system)
4. Remove redundant breadcrumbs from pages (sidebar already shows path)
5. Deprecate floating navigation hints/banners

**Bob/BDR Role**: Critique the new IA — any critical workflows now requiring >3 clicks? Missing search facets?

**Human Testing**: 
- 2 grand masters, 2 masters
- Workflow: setup new client org + assign users + enable features + run diagnostics
- Measure: time-to-complete, path taken, what they tried but failed

---

### Metrics & Validation
- **Page count**: 291 → ~120 (60% reduction)
- **Nav groups**: 18 → 4 (sidebar: Officer | Admin | Master | Settings)
- **Route manifest**: Deprecate 170+ route entries; re-use consolidated pages via URL params
- **Accessibility**: Maintain WCAG 2.2 AA via unified design tokens + component patterns
- **Performance**: Officer shell <2.5s TTI, filter response <300ms, action feedback <150ms (vs. multi-page round-trips today)
- **Human validation**: BDR + 5 field officers + 8 admins + 4 masters = 17 testers across 3 shells
- **Lint & Build**: ESLint must pass; no new restricted-syntax warnings; build size <500 KB incremental

---

---

## PLAN B: "Task-Flow Based Redesign" (Workflow-Centric IA)

### Philosophy
Stop organizing by role/data-type. Instead, organize by **workflows** — sequences of tasks a user performs. Each workflow gets a dedicated space (e.g. Patrol Flow, Breach Response Flow, Notice Management Flow), and every page that touches that workflow lives inside it as a sub-page or state, not as a separate "record" page.

**Key Principle**: Sidebar shows workflows, not data entities. Pages are state machines, not isolated views.

### Structure

**Officer Portals**:
```
Patrol Workflow (root)
  ├─ [Active Task] Start Patrol
  ├─ [Active Task] Record Scan
  ├─ [Active Task] Respond to Breach
  └─ [Terminal] End Patrol + Sync

Dispatch Workflow (if assigned)
  ├─ [Active Task] View Dispatch Job
  ├─ [Active Task] Navigate to Location
  ├─ [Active Task] Complete Job
  └─ [Terminal] Acknowledgment
```

**Admin Portals**:
```
Breach Response Workflow
  ├─ [Decision] View Breach Queue
  ├─ [Decision] History → Prior Actions
  ├─ [Decision] Issue Warning / NTV / Infringement
  ├─ [Decision] Escalation Path
  └─ [Audit] Breach Closed

Compliance Verification Workflow
  ├─ Zone Selection
  ├─ Date Range
  ├─ Filter by Status
  ├─ Recalculation Rules
  └─ Export Report

Roster Planning Workflow
  ├─ View Week
  ├─ Create Shift
  ├─ Publish / Accept / Decline
  └─ Handle Conflicts + Swaps

Notice Lifecycle Workflow
  ├─ Create (draft)
  ├─ Review (pre-issue checks)
  ├─ Issue (numbered + sent)
  ├─ Track (paid, disputed, withdrawn)
  └─ Archive
```

**Master Portals**:
```
Organization Provisioning Workflow
  ├─ New Org Form
  ├─ User + Permissions Setup
  ├─ Feature Flag Rollout
  ├─ SLA Configuration
  └─ Go-Live Checklist
```

### Payoff

- **Reduced cognitive overhead**: Users understand "I'm in Breach Response" vs. hunting across Breaches + Notices + Enforcement Actions pages
- **Consistent UX within a workflow**: All form patterns, error handling, state transitions identical
- **Progress visibility**: Workflows show "where am I in this process?" at the top (e.g. "Step 2 of 5: Issue Notice")
- **Page reduction**: ~50 pages per workflow × 8 primary workflows = 400 pages theoretically, but **reuse UI components** → compress to 12 core workflows × 3-4 pages per workflow = ~40 pages (87% reduction vs. today)

### Implementation

1. **Define 8–10 primary workflows** using INSTRUCTION_MANUAL.md + LIVE_SCHEMA.md
2. **For each workflow**: 
   - Draw state-transition diagram (breach detected → warning issued → ignored → infringement issued → paid/disputed/collection)
   - List all decision points (operator choice moments)
   - Identify data dependencies (what info must be pre-filled vs. entered?)
   - Plan form validations + error recovery
3. **Build workflow container component** (`<WorkflowStates/>`)
   - Stepper at top showing progress
   - Context object carrying workflow data through all sub-pages (no re-fetching)
   - State machine enforcing legal transitions (can't jump from Step 1 to Step 4)
4. **Consolidate UI components**: All forms, tables, modals within a workflow share one design (palette, spacing, button styles)
5. **Bob/BDR Role**:
   - Generate "Workflow State Diagram" per workflow (visual reference for developers)
   - Trace audit_log trails: which transitions happen most? Which edge cases fail?
   - Recommend user confirmations / undo points

### Human Testing
- **Scenario 1**: Field officer patrols, scans vehicle, system flags breach → officer guides through response UI (warning → notice) without leaving the patrol workflow
- **Scenario 2**: Admin processes 10 active breaches in 5 minutes — are they faster with workflow UI vs. today's page-hopping?
- **Scenario 3**: Master onboards new org — is the provisioning workflow clear? Any confusing state transitions?

---

### Metrics & Validation

- **Pages**: 291 → ~40 (86% reduction)
- **Workflow clarity**: Can 3/3 test users describe their current workflow without asking?
- **State transitions**: Zero illegal state transitions possible in UI (enforced by state machine)
- **Performance**: Workflow context cached client-side; moving between workflow steps <50ms
- **Audit compliance**: Every workflow state transition logged to audit_log table

---

---

## PLAN C: "Bounded Complexity Framework" (Architectural Constraints)

### Philosophy
Instead of redesigning entire IA, impose **strict architectural guardrails** that prevent future bloat. Treat UX as a renewable resource with fixed budget: if you add one feature, you remove another. Rules are **enforced at build time and design time** (not runtime).

**Key Principle**: Every page has a UX "weight limit"; every component a "complexity score"; accumulate too many and the build fails. Architectural rules codified in ESLint, TypeScript, and design system.

### Bounded Complexity Rules

#### Rule 1: Page Header Actions (≤5 buttons)
```typescript
// ESLint violation if page header has >5 interactive buttons
<PageHeader>
  <Button>Primary Action</Button>          // ← Always right-aligned
  <NavButton>Secondary</NavButton>         // ← If needed
  <SettingsButton />                       // ← Tertiary
  <MoreMenu>                               // ← Overflow all else
    <MoreItem>Export</MoreItem>
    <MoreItem>Share</MoreItem>
  </MoreMenu>
</PageHeader>

// ESLint enforces: count buttons; if >5, error: "PageHeader buttons exceed budget (7/5)"
```

#### Rule 2: Cards per Page (≤8, or paginate)
```typescript
// If component renders >8 high-density cards, ESLint error
<ComplianceGrid cards={cards} /> 
// If cards.length > 8, error: "Page exceeds card quota; paginate or consolidate"
```

#### Rule 3: Form Fields per Form (≤12)
```typescript
// Forms with >12 input fields must be split into steps
// ESLint checks: count <input>, <select>, <textarea> elements; enforce ≤12 or error
```

#### Rule 4: useState Hooks per Page (≤5)
```typescript
// More than 5 useState = too much local state → signals poor architecture
// Enforce via ESLint + Zustand migration alerts
```

#### Rule 5: Navigation Depth (≤4 levels)
```typescript
// Sidebar nesting limited to 4 levels:
// Admin → Compliance → Breaches → [Filter Modal]
// Going deeper = error: "Navigation depth exceeds 4; redesign IA"
```

#### Rule 6: Icons per Page (≤20)
```typescript
// >20 icons = visual clutter; each icon must have corresponding text label in admin UI
// Enforcement: icon density audit in design review
```

#### Rule 7: Colors per Page (≤7)
```typescript
// Only semantic colors allowed:
// 1. Brand Primary, 2. Brand Secondary, 3. Success (green), 4. Warning (amber), 5. Danger (red), 6. Info (blue), 7. Neutral (grey)
// Prevent arbitrary color use
```

#### Rule 8: Modal Nesting (≤2 levels)
```typescript
// Can open modal from page. Cannot open modal from modal from modal.
// <Dialog onOpen={() => setNestedModalOpen(true)} /> triggers ESLint error
```

#### Rule 9: Table Column Limit (≤8 per table)
```typescript
// Tables cannot have >8 visible columns by default
// Additional columns must be: hidden behind "More" / configurable columns UI
```

#### Rule 10: Links per Paragraph (≤3)
```typescript
// Info text cannot have >3 hyperlinks (cognitive overload)
// Enforcement: document review before merge
```

### Implementation: "UX Budget CI Gate"

```yaml
# .github/workflows/ux-complexity-audit.yml
name: UX Complexity Audit

on: [pull_request]

jobs:
  ux-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: ESLint UX rules
        run: bun run lint:ux
        # Custom ESLint config file: eslint.config.ux.js
      - name: Component Complexity Score
        run: node scripts/ux-complexity-score.mjs
        # Generates complexity report; fails if budget exceeded
      - name: Design System Compliance
        run: node scripts/design-tokens-audit.mjs
        # Checks color/spacing/typography adherence
      - name: Page Performance Budget
        run: node scripts/page-weight-audit.mjs src/pages
        # Each page route must be <250 KB gzip; files >250KB trigger error
      - name: Accessibility Regression
        run: bun run test:a11y
```

### Implementation: New ESLint Rules

```javascript
// eslint.config.ux.js
export default [
  {
    files: ['src/pages/**/*.tsx'],
    rules: {
      'no-excessive-buttons': ['error', { max: 5, inHeader: true }],
      'no-excessive-cards': ['error', { max: 8 }],
      'no-excessive-form-fields': ['error', { max: 12 }],
      'no-excessive-useState': ['error', { max: 5 }],
      'no-excessive-navigation-depth': ['error', { maxDepth: 4 }],
      'no-nested-modals': ['error'],
      'no-table-column-overload': ['error', { max: 8 }],
      'no-icon-without-label': ['warn'],
      'use-semantic-colors-only': ['error'],
      'no-arbitrary-spacing': ['warn'],
    },
  },
];
```

### Design System Enforcement

```typescript
// src/lib/design-system.ts - all tokens are source of truth
export const SEMANTIC_COLORS = {
  brand_primary: '#0066CC',
  brand_secondary: '#6C757D',
  success: '#28A745',
  warning: '#FFC107',
  danger: '#DC3545',
  info: '#17A2B8',
  neutral: '#E9ECEF',
} as const;

export const SPACING = [4, 8, 12, 16, 24, 32, 48] as const; // No arbitrary spacing
export const BORDER_RADIUS = [0, 4, 8, 16, 9999] as const;
export const ELEVATION = [0, 2, 4, 8, 16] as const;

// TypeScript ensures no arbitrary values:
// <div className={`p-[42px]`} /> ← This triggers Tailwind error if spacing not in SPACING array
```

### Payoff

- **Future-proof**: New features cannot bloat UI without refactoring old ones
- **Design consistency**: All pages follow same rules (no exceptions)
- **Maintainability**: Newcomers understand constraints immediately
- **Performance**: Build automatically fails if any page>250KB, forcing optimization
- **Accessibility**: Cannot add modal/form/icon without meeting a11y requirements coded in

### Human Testing

- **2-week Design Sprint**: Product team proposes new feature → runs through complexity audit → shows what must be cut to make room
- **Retrospective**: "Which constraints were helpful? Which felt too restrictive?"
- **Iteration**: Update rules based on feedback

---

### Metrics & Validation

- **Pass ESLint UX rules**: 0 violations per PR
- **Page weight**: All pages <250 KB gzip; build fails otherwise
- **Design token usage**: 100% of colors, spacing, typography from token system
- **A11y pass rate**: >98% of pages pass automated a11y checks
- **Complexity score trend**: Track over time; goal is 0 growth in new code

---

---

## Bob / BDR Collaboration Framework

### Phase A: Design Research & Validation (Weeks 1–2, All Plans)

**Bob's Role**: Generate **"Current State UX Audit"** document
- Screenshot every page (10 samples per shell)
- Count buttons, fields, icons per page
- Flag duplicate functionality (same feature accessible 3+ ways)
- Identify top 5 user pain points from interaction logs (if available)
- Recommend consolidation candidates (which 10 pages could merge into 1?)

**BDR Review**: 
- Read INSTRUCTION_MANUAL.md design standards
- Compare current UI to documented standards (Page Anatomy, Component Density, Card Taxonomy, Accessibility)
- Identify 10+ violations (e.g. "Breach Alerts page has 8 buttons in header, rule is ≤1 primary + ≤2 secondary")
- Draft "Compliance Gap" report

**Deliverable**: `docs/BOB_UX_AUDIT_CURRENT_STATE.md` + `docs/BDR_COMPLIANCE_GAPS.md`

---

### Phase B: Plan A/B/C Evaluation (Weeks 2–3)

**Bob's Role**: For each plan, **generate before/after wireframes** (ASCII + description)
- Show page footprint reduction (291 → target for each plan)
- Model specific workflows (Patrol → Scan → Breach; Breach → Warning → Notice → Paid)
- Calculate estimated implementation effort per plan

**BDR Review**: 
- Critique: which plan best aligns with INSTRUCTION_MANUAL.md rules?
- Risk analysis: which plan has highest integration risk with current Supabase schema?
- Recommend one primary + one fallback plan

**Deliverable**: `docs/BOB_PLAN_WIREFRAMES_ABC.md` (mock-ups + trade-offs table)

---

### Phase C: Human Testing & Iteration (Weeks 3–4)

**Bob's Role**: Prepare **user testing protocol**
- Define 5–10 tasks per shell (field officer: "scan vehicle and respond to breach"; admin: "find vehicle + check history + issue notice")
- Create **success metrics** (time-to-completion, error rate, preference sentiment)
- Analyze video/interview from testers post-hoc

**Human Testing Execution** (Project Lead + Product Owner):
- **Cohort A** (5 field officers, diverse skill): Test Officer Shell redesign
- **Cohort B** (10 admins/admin-officers): Test Admin Shell redesign
- **Cohort C** (4 masters): Test Master Shell redesign
- Each cohort: 1-hour usability test on proposed UI (clickable prototype or staged branch)

**BDR Review**: 
- Synthesize feedback
- Identify showstoppers (e.g. "officers overwhelmed by new nav")
- Recommend minor tweaks before code implementation

**Deliverable**: `docs/BOB_HUMAN_TESTING_RESULTS.md` + `docs/BDR_REFINEMENT_RECOMMENDATIONS.md`

---

### Phase D: Handoff to Engineering (Week 4)

**Bob's Role**: Create **implementation spec per component**
- Zod schemas for all forms (validation rules, error messages)
- TanStack Query config (data fetching, cache invalidation)
- Zustand store structure (global state shape)
- ESLint rules to prevent regression

**BDR Review**: 
- Validate specs against INSTRUCTION_MANUAL.md accuracy (do schemas match the documented workflows?)
- Spot-check database query logic (join paths, RLS policies, performance)
- Flag any architectural misalignment

**Deliverable**: `docs/BOB_IMPLEMENTATION_SPEC_COMPLETE.md` (500+ lines of technical detail per component)

---

## Human Testing Protocol (Detailed)

### Recruitment

- **Field Officers**: 5 total (1 new hire + 2 mid-level + 1 veteran + 1 high-stress/high-error history) — diverse experience levels
- **Admins**: 10 total (4 low-frequency, 6 high-frequency users) — different workflow specializations (compliance officer, roster planner, etc.)
- **Masters**: 4 total (all current master-role operators if available) — critical for governance workflows
- **Incentive**: $50 Amazon gift card per person; 1-hour commitment; remote or in-office

### Test Environment

- **Officer**: Real mobile devices (iPhone + Android); 4G throttled network to ~5 Mbps; low-light simulation (reduce screen brightness)
- **Admin**: Desktop + tablet mixed; realistic data volume (1000+ breach records, 100+ zones)
- **Master**: Desktop only; cross-org view

### Test Tasks

#### Officer Shell (5 tasks × 5 subjects = 25 observations)

1. **Start Patrol + Scan Vehicle** (glove-safe, offline-ready)
   - Objective: Start patrol → scan a plate → see result
   - Success: Complete in <90 seconds; correctly taps "OK" on breach result
   - Measure: Time, tap accuracy, eye gaze (was result card visible?)

2. **Respond to Breach** (decision-making)
   - Objective: System flags breach → officer decides warning/notice/escalate
   - Success: Officer makes a decision (not abandons task); understands why system flagged it
   - Measure: Time, confidence (1–5 Likert), rationale articulation

3. **Handle Offline Scan** (connectivity stress)
   - Objective: Scan offline, network restores, sync completes
   - Success: Officer triggered sync; understood "queued" badge; saw result after reconnect
   - Measure: Actions taken, time to understand status

4. **Find Help** (accessibility)
   - Objective: Officer confused on next step → finds help or Bob assistant
   - Success: Officer located help in <20 seconds
   - Measure: Path taken, help effectiveness rating

5. **Welfare Check-In** (critical safety)
   - Objective: Officer receives welfare check prompt → responds
   - Success: Officer knows where to tap; does not dismiss accidentally
   - Measure: Time, confidence in location, likelihood to tap on real patrol

#### Admin Shell (6 tasks × 10 subjects = 60 observations)

1. **Find Vehicle in Records** (search + navigation)
   - Objective: "Find plate NFF123; check if breached"
   - Success: Locate within 2 clicks; see breach history at a glance
   - Measure: Time, clicks, satisfaction (1–5 Likert)

2. **Manage Breach Queue** (queue management)
   - Objective: View 20 active breaches; issue 1 warning, 1 notice, escalate 1
   - Success: Complete workflow without leaving page
   - Measure: Time, clicks per breach, error recovery count

3. **Create Infringement Notice** (form)
   - Objective: Generate notice from a breach record
   - Success: Pre-filled fields correct; minimal data re-entry; preview before issue
   - Measure: Time, fields manually corrected, confidence in correctness

4. **Filter & Export Report** (analytics)
   - Objective: "Report: breaches > 30 days, zone X, status active, export as CSV"
   - Success: Filter applied correctly; export arrived in expected format
   - Measure: Filter paths tried, export time, file integrity

5. **Assign Shift to Officer** (roster)
   - Objective: Create a shift; publish; officer accepts
   - Success: No errors; officer notified immediately
   - Measure: Time to create, clarity of published notification

6. **Resolve Dispute** (escalation)
   - Objective: Review dispute; approve/reject; notify requestor
   - Success: Understand escalation path; confidence in decision
   - Measure: Time, decision justification clarity

#### Master Shell (4 tasks × 4 subjects = 16 observations)

1. **Onboard New Client Organisation** (provisioning)
   - Objective: Create client org → assign admin user → enable features
   - Success: Org created; user can log in immediately; features visible
   - Measure: Time to complete, steps required, clarity of next steps

2. **View Cross-Org Metrics** (governance)
   - Objective: Compare KPIs across 3 child orgs
   - Success: Quickly identify org with lowest compliance
   - Measure: Time, confidence in data accuracy

3. **Escalate System Alert** (diagnostics)
   - Objective: Health warning detected → drill into debug info → route to eng team
   - Success: Understand severity; know who to contact
   - Measure: Time, comprehension of logs

4. **Configure Feature Flag** (feature rollout)
   - Objective: Enable new feature for subset of users
   - Success: Rollout % set correctly; users see feature immediately
   - Measure: Time, confidence in settings

### Metrics & Reporting

**Quantitative**:
- Task completion rate (%)
- Time-on-task (seconds)
- Clicks / taps per task
- Error recovery count
- Success on first attempt (%)

**Qualitative** (post-task interview, 1–5 Likert):
- Confidence in action correctness
- Satisfaction with UI layout
- Clarity of next action
- Mental load ("was this cognitively hard?")
- Likelihood to recommend this design

**Comparative** (vs. baseline/current):
- % improvement in time-on-task
- % reduction in errors
- Net promoter score (current vs. proposed)

### Synthesis & Iteration

- **Session 1** (Days 1–4): 5 officer tests → iterate design based on feedback
- **Session 2** (Days 5–8): 10 admin tests → refine forms/filters based on patterns
- **Session 3** (Days 9–10): 4 master tests → polish governance workflows
- **Debrief** (Day 11): Product + design + engineering + Bob review all findings → finalize which plan to implement

---

---

---

# PERSPECTIVE 2: Bob Strategic Plan — "Data-Driven Operational Excellence"

## PLAN B: Operational Data-Driven Consolidation (Audit-First Approach)

### Philosophy
Bob analyzes the live operational database — audit_log, observations, breach_alerts, notices, etc. — to identify which features are **actually used** vs. which are dead weight. Then design is driven by usage patterns, not assumptions. Pages that handle 80% of compliance breaches get 80% of UX investment. Rarely-used pages are either deprecated or hidden behind "Advanced" menus.

**Key Principle**: UX design follows operational data, not organizational structure. If 85% of admin time is spent on the Breach Response workflow, that workflow receives 85% of design resources.

### Phase 1: Operational Analytics Audit (2 weeks)

Bob analyzes:
1. **User time-on-page**: Which pages consume most operator time across all orgs?
   - If Compliance Dashboard = 35min/day but Incident Records = 2min/day → invest in Dashboard, deprecate Incident Records
2. **Error patterns**: Which pages generate most support tickets / rollbacks?
   - If Notice Issuance = 15% error rate vs. Patrol Dashboard = 0.2% → redesign Notice Issuance priority
3. **Feature usage**: How many operations use each page per week?
   - If 91+ of 95 admins never visit "Zone Legal Config" → move behind admin→system→advanced menu
4. **Abandonment rate**: Users that skip pages (jump via URL or search)?
   - High abandonment = navigation UX is broken; redesign sidebar path
5. **Offline queue backlog**: Do officers queue actions offline more on mobile vs. tablet?
   - If high backlog on mobile → design for batch sync, not one-by-one

**Deliverable**: `docs/BOB_OPERATIONAL_USAGE_PATTERNS.json` with time/volume/error data per page

### Phase 2: Evidence-Based IA Design (2 weeks)

Using the audit, Bob redesigns sidebar hierarchy:

```
Core Pages (used 80% of time by 80% of users):
  ├─ Dashboard (35% of time)
  ├─ Compliance (Breaches + Notices, 28% of time)
  ├─ Operations (Patrol + Dispatch, 18% of time)
  └─ Records Unified (find vehicle/person, 12% of time)

Secondary Pages (used 15% of time by 60% of users):
  ├─ Reports (export for stakeholders)
  ├─ Roster (admin + admin-officer)
  ├─ CRM (master only)
  └─ Audit Log (high-touch admins)

Advanced Pages (used 5% of time by <20% of users):
  → Hidden behind "Settings → System → Advanced"
  ├─ Zone Legal Config
  ├─ Feature Flags
  ├─ Pricing Rules
  └─ Diagnostics
```

**Payoff**: 
- Core pages are visually prominent; secondary pages findable but not intrusive; advanced pages never clutter the sidebar
- Reduces cognitive load: most users navigate among 4–5 pages per shift
- Accessibility: rare pages don't require menu drilling for 95% of users

### Phase 3: Workflow Patterns from Audit Trail (2 weeks)

Bob extracts common user **sequences** from audit_log:
- Workflow A: `Breach detected → click Breach Alert → review history → issue Warning → record → done` (60% of breaches)
- Workflow B: `Breach detected → click Breach Alert → review history → issue Notice → print → record → done` (25% of breaches)
- Workflow C: `Breach detected → escalate to supervisor → supervisor reviews → decides action → done` (15% of breaches)

**Redesign consequence**: Focus UI on Workflows A+B (85% of traffic); Workflow C has escalation button but not primary design.

### Phase 4: Performance Optimization by Volume (1 week)

Pages with highest volume get performance tweaks:
- Dashboard: cached KPI calculations; updates every 60s vs. real-time (saves 40% compute)
- Breach Queue: lazy-load beyond row 50; pagination instead of infinite scroll
- Records: federated search (search vehicle plates first; if found instantly, don't query person/zone/incident)

**Payoff**: Reduce 95th-percentile load time on core pages from 2.1s → 800ms

### Implementation

1. **Bob generates `usage-analysis.mjs`**: Runs on production data (anonymized) weekly; outputs top-10 time-sinks
2. **Design reviews usage report** each sprint: "This week, Compliance Dashboard = 38% of admin time (up 3%); Records = 8% (down 1%); reorganize sidebar next sprint"
3. **Deprecation policy**: If page <2% usage for 30 days, mark for deprecation + send survey
4. **A/B test new design**: Half of users see new sidebar IA, half see old; measure time-on-task reduction

---

---

# PERSPECTIVE 3: OpenAI Strategic Plan — "Enterprise SaaS Design System"

## PLAN C: Enterprise Design System + Constraints Framework (Industry Best Practices)

### Philosophy
Apply proven enterprise SaaS UX patterns from Salesforce, ServiceNow, Atlassian, Datadog, and Figma. Foundation: unified design system (colors, typography, spacing, components), enforced via design tokens + ESLint CI gate. Every new page/feature must conform; no exceptions.

**Key Principle**: Design consistency and performance enforced by architecture, not by guideline compliance. ESLint blocks non-compliant code at merge time.

### Phase 1: Design System Audit (1 week)

Audit current design:
- **Colors**: Define final 7 semantic colors; deprecate all others; migrate existing pages to token-based colors
- **Typography**: 3 heading scales (H1/H2/H3), 1 body, 1 mono; all others consolidated
- **Spacing**: Enforced scale: 0, 4, 8, 12, 16, 24, 32, 48, 64px (no arbitrary values)
- **Components**: Standardize button, input, select, dropdown, modal, drawer, toast, card, table, badge, avatar, icon
- **Elevation**: Establish shadow layers for modals/popovers/tooltips (1 standard for each)

**Deliverable**: `src/lib/design-tokens.ts` (TypeScript constants for all values)

### Phase 2: Unified Component Library (2 weeks)

Consolidate fragmented components → one canonical set:

```typescript
// Before (fragmented):
import { BreachButton } from '@/components/breach/BreachButton'
import { NoticeButton } from '@/components/notice/NoticeButton'
import { RosterButton } from '@/components/roster/RosterButton'

// After (unified):
import { Button } from '@/components/ui/button'
// All buttons use same variants: primary, secondary, tertiary, danger, ghost
// Props: size (sm|md|lg), loading, disabled, icon
```

**Components to consolidate**:
- Buttons: 12 variants → 5 unified
- Forms: 7 validation patterns → 1 unified pattern (Zod + react-hook-form)
- Tables: 4 different sorting/filtering → 1 unified table component with composable columns
- Modals: 3 different modal libraries → 1 canonical `<Dialog>` from shadcn/radix
- Icons: 3 different icon sets → 1 Lucide-based set

**Payoff**: 
- 30% reduction in component bundle size
- Consistency across all pages
- Easier onboarding for new developers

### Phase 3: ESLint Complexity Guardrails (1 week)

Codify constraints in ESLint (enforced at PR merge):

```javascript
// eslint.config.design-system.js
export default [
  {
    files: ['src/**/*.tsx'],
    rules: {
      // Color constraints
      'no-arbitrary-colors': ['error', { allowedTokens: SEMANTIC_COLORS }],
      // Spacing constraints
      'no-arbitrary-spacing': ['error', { allowedValues: [0, 4, 8, 12, 16, 24, 32, 48, 64] }],
      // Button density
      'max-buttons-per-page-header': ['error', { max: 5 }],
      // Form field limits
      'max-form-fields': ['error', { max: 12 }],
      // Component deprecation
      'no-deprecated-components': ['error', { deprecated: ['OldButton', 'OldModal', 'OldForm'] }],
      // Performance budgets
      'max-page-bundle-size': ['warn', { maxKbGzipped: 250 }],
    },
  },
];
```

### Phase 4: Accessibility-First Design (1 week)

All components built with a11y as first-class concern:
- Keyboard navigation: Every interactive element reachable via Tab
- Focus visible: Unmissable focus indicator on all interactive elements
- ARIA labels: All icons + icon-only buttons have aria-label
- Color + text: Status communicated via color + label, never color alone
- Contrast: All text meets WCAG AAA (7:1 ratio minimum)

**Tool**: axe DevTools in CI; build fails if a11y violations detected

### Phase 5: Theming Framework (1 week)

Support multiple themes (Light, Dark, Night Patrol, High Contrast) with design tokens:

```typescript
// src/theme/themes.ts
export const themes = {
  light: {
    colors: { primary: '#0066CC', success: '#28A745', ... },
    typography: { bodySize: '14px', headingSize: '18px', ... },
    spacing: { gutter: 16, gap: 8, ... },
  },
  dark: {
    colors: { primary: '#3388FF', success: '#52C77E', ... },
    ...
  },
  nightPatrol: {
    colors: { primary: '#FFD700', danger: '#FF6B6B', ... },
    typography: { bodySize: '18px', ... }, // Larger for outdoor use
    spacing: { gutter: 24, gap: 12, ... }, // Generous for gloved touch
  },
};
```

User preference saved in `profile.theme`; CSS variables applied globally

### Implementation

1. **Week 1**: Audit + finalize token set; publish `design-tokens.ts`
2. **Week 2**: Migrate all components to design tokens; no visual change (refactor only)
3. **Week 3**: Implement ESLint rules; enforce on all new code
4. **Week 4+**: Deprecate old components; require new features to use unified components

---

---

# THE MASTER PLAN: Synthesis of All Three Perspectives

## Master Strategy: "Phased Enterprise Consolidation with Operational Grounding"

The three perspectives offer different angles:
- **Copilot (Plan A)**: Architectural clarity via shell model (Officer/Admin/Master, defined separately)
- **Bob (Plan B)**: Operational reality via data analysis (use what's actually used; deprecate dead weight)
- **OpenAI (Plan C)**: Technical enforcement via design system + ESLint (prevent regression, ensure consistency)

### Master Plan Phases

#### **Phase 0: Foundation (Weeks 1–3) — Bob's Audit + OpenAI's Design System**

Run in parallel:

**Track 1: Bob's Operational Analysis**
- Extract usage patterns from production audit_log, observations, breach_alerts, notices
- Generate `BOB_OPERATIONAL_USAGE_PATTERNS.json`: page visit frequency, time-on-page, error rate, abandonment
- Identify top 5 pain points + top 5 "dead" features
- Output: Ranked usage heatmap + workflow sequences

**Track 2: OpenAI's Design System Implementation**
- Finalize design token set (colors, typography, spacing, elevation)
- Consolidate fragmented components → 5 canonical types (Button, Input, Table, Modal, Card)
- Publish `src/lib/design-tokens.ts` + updated component library
- Implement ESLint design-system rules; publish to main
- Build fails if PR violates design token rules (no arbitrary colors/spacing/buttons)

**Deliverables**: 
- `docs/BOB_OPERATIONAL_USAGE_PATTERNS.json`
- `src/lib/design-tokens.ts` (all design tokens as TS constants)
- ESLint design-system rules (0 violations on main)
- Updated component library (all components using design tokens)

#### **Phase 1: Consolidation by Impact (Weeks 4–8) — Copilot's Shell Model + Bob's Data**

Start with the **highest-impact shell**: Officer (glove-safe, simplest UX, greatest pain point)

**Week 4–5: Officer Shell Redesign**
- Using Bob's data: identify top 3 officer workflows (e.g., Patrol 60%, Scan/Breach 25%, Dispatch 15%)
- Using Copilot's model: compress all officer tasks into 4-button bottom nav (Patrol, Scan, Dispatch, Help)
- Design: full-screen task cards (one workflow step per screen, never dialog-on-dialog)
- Implement: move from 40+ scattered pages to 4 root pages with state-driven substeps
- Test on 5 officers (diverse skill levels); measure time-to-action, error rate, preference

**Week 6–7: Admin Shell Redesign**
- Using Bob's data: Records section = 12% of admin time; Compliance = 28%; Operations = 18%, Dashboard = 35%
  → Rebuild sidebar to match: Dashboard (primary), Compliance (prominent), Operations (secondary), Records (search, not nav)
- Using Copilot's model: Records (66 pages) → unified search + side panel (1 page)
- Design: all breaches, notices, actions on single Compliance page with tabs + filters (no /breaches, /notices, /enforcement-actions separate pages)
- Implement: migrate Records IA; consolidate forms (zod + react-hook-form unified pattern)
- Test on 10 admins; measure page visits per shift, notice issuance time, preference

**Week 8: Master Shell Refinement**
- Using Bob's data: most masters spend 60% of time on governance pages, 30% on org mgmt, 10% on feature flags
- Using Copilot's model: collapse navigation to 3 main sections (Governance, Organisations, System)
- Design: minimal navigation; all features discoverable via search or org selector
- Implement: simplify Master's sidebar (max 4 nesting levels)

**Deliverables**:
- New Officer routing: `/field-officer/{patrol,scan,dispatch,help}`
- New Admin IA: Compliance hub + Records unified search
- New Master nav structure
- Human testing results: time-on-task comparison (current vs. new) + preference scores

#### **Phase 2: Consistency Pass (Weeks 9–11) — OpenAI's Design System + Copilot's Rules**

Apply design system across all redesigned pages.

**Week 9: Form Unification**
- All forms (create notice, create zone, issue warning, etc.) use same Zod schema + validation pattern
- Unified error handling: inline field feedback + top-of-form toast
- Pre-fill known data (zone from context, officer from session, etc.)
- ESLint rule: every form must have ≤12 fields; multi-step if >12

**Week 10: Table & List Unification**
- All tables use canonical `<DataTable>` component
- Standard sorting/filtering UI across all pages
- ESLint rule: tables max 8 columns by default; additional columns via customization menu

**Week 11: Button & Action Density Reductions**
- All page headers: ≤1 primary action, ≤2 secondary, rest in "More" menu
- ESLint rule: PageHeader lint fails if >5 buttons detected
- Button labels always in English (not icons only)

**Deliverables**:
- Unified form library (all forms migrated to Zod pattern)
- Unified table library (all tables migrated to DataTable component)
- 0 ESLint violations on main branch

#### **Phase 3: Navigation Unification (Weeks 12–13) — All Three Perspectives**

**Week 12: Global Search Implementation**
- Unified search across all pages (Cmd+K or search icon always present)
- Search finds: plates, person names, zone names, page names, incident IDs
- No dead-end searches; all results link directly to relevant context

**Week 13: Sidebar Architecture Finalization**
- Single sidebar, 4 nesting levels max
- Top level: Core, Operations, Records, Reports, CRM, Settings (6 main categories)
- Breadcrumb removed from most pages (sidebar already shows path)
- Bob icon (AI assistant) always in consistent location (bottom of sidebar or floating button)

**Deliverables**:
- Global search implemented and tested
- Final sidebar IA documented in routeManifest.ts
- Breadcrumb usage standardized (only on detail pages, not lists)

#### **Phase 4: Performance & Offline-First (Weeks 14–15) — Copilot's Rules + OpenAI's Metrics**

**Week 14: Performance Budgets**
- All pages <250 KB gzipped (enforced by build)
- Dashboard loads in <2.5s on 4G median
- Filter/sort/search response <300ms
- ESLint rule: build fails if any page exceeds budget

**Week 15: Offline-First Officer Sync**
- Scan queuing works offline (all scans cached locally until network available)
- Visible sync queue badge (clear indicator of pending items)
- Officer cannot end shift with unsynced items (shift-end checklist enforces)

**Deliverables**:
- All pages meet performance budgets (measured real-world)
- Offline sync queue fully functional and tested

#### **Phase 5: Launch & Human Validation (Weeks 16–17)**

**Week 16: Final Testing Cohort**
- 5 field officers on new Officer Shell
- 10 admins on new Admin Shell + Compliance Hub
- 4 masters on new Master nav
- Measure: time-on-task (vs. baseline), error rate, preference (5-point Likert)
- Success: >70% preference for new design; ≥25% reduction in time-on-task

**Week 17: Launch**
- Merge all changes to main
- Deploy to production (staged rollout: 10% → 50% → 100% over 3 days)
- Monitor error_log, performance metrics, user support tickets
- Rollback plan: revert to previous routing if >5% error spike detected

**Deliverables**:
- Human testing report with quantitative + qualitative findings
- Launch playbook + rollback procedures

---

## Master Plan Success Criteria

| Metric | Target | Owner |
|---|---|---|
| **Pages consolidated** | 291 → 120 (59% reduction) | Copilot |
| **Page load time (admin)** | <2s avg, <3s p95 | OpenAI |
| **Button density** | ≤5 per page header (vs. 50 today) | OpenAI |
| **Navigation systems** | 1 (vs. 5 today) | Copilot |
| **Form patterns** | 1 unified (vs. 7 today) | OpenAI |
| **Officer task time** | -30% vs. baseline | Bob |
| **Admin notice time** | -25% vs. baseline | Bob |
| **ESLint violations** | 0 on main | OpenAI |
| **Human test preference** | >70% for new design | All |
| **Search coverage** | 100% of critical records findable | Copilot |
| **Accessibility (WCAG AAA)** | 98%+ pages compliant | OpenAI |

---

## Execution Timeline: End-to-End

```
WEEK 1–3 (Phase 0: Foundation)
  Track 1 (Bob): Audit production data → usage patterns JSON
  Track 2 (OpenAI): Design system + ESLint rules → ship to main

WEEK 4–8 (Phase 1: Shells by Impact)
  Officer (Weeks 4–5): 40 pages → 4 pages; test with 5 officers
  Admin (Weeks 6–7): 167 pages → 20 pages; test with 10 admins
  Master (Week 8): Refine nav; test with 4 masters

WEEK 9–11 (Phase 2: Consistency)
  Week 9: Forms unified (Zod pattern)
  Week 10: Tables unified (DataTable component)
  Week 11: Button density reduced; ESLint enforced

WEEK 12–13 (Phase 3: Navigation)
  Week 12: Global search live
  Week 13: Sidebar finalized; breadcrumbs standardized

WEEK 14–15 (Phase 4: Performance)
  Week 14: Pages <250 KB; all pages meet budgets
  Week 15: Offline sync complete

WEEK 16–17 (Phase 5: Launch)
  Week 16: Final testing (17 people across 3 shells)
  Week 17: Production deployment (staged rollout)
```

**Total: 17 weeks (4 months) to complete enterprise-grade UI/UX transformation**

---

## Key Decisions & Trade-offs

| Trade-off | Resolution | Rationale |
|---|---|---|
| **Shell-centric (Copilot) vs. Workflow-centric (Bob's workflows)** | Implement shell-centric as primary IA; embed workflow hints via state machine | Shells define user context (officer vs. admin); workflows evolve per role; shells are stable |
| **Design system strictness (OpenAI) vs. Flexibility** | Strict design tokens + ESLint, but with override exceptions for future special cases | Prevent regression; consistency overrides flexibility in enterprise context |
| **Deprecation speed** | Gradual (6-month notice) for low-usage pages; immediate for duplicates | Operators cannot be surprised; allow org admins to adapt training |
| **Mobile vs. Desktop** | Officer shell mobile-first (glove-safe); Admin/Master desktop-first with tablet fallback | Officers in field; admins at desks; different contexts = different priorities |
| **Real-time updates vs. Caching** | Admin pages cache results (refresh every 60s); Officer pages real-time (for safety) | Admin pages voluminous; caching saves compute; Officer pages critical (cannot be stale) |

---

## Appendix: Capability Matrix (All Three Plans)

| Capability | Copilot (A) | Bob (B) | OpenAI (C) | Master |
|---|---|---|---|---|
| **Reduces to ~120 pages** | ✅ Yes (via shells) | ✅ Yes (via usage) | ⚠️ Partial (rules only) | ✅ Yes (all combined) |
| **Data-driven prioritization** | ⚠️ Assumed | ✅ YES (live audit) | ⚠️ Assumed | ✅ YES (Bob audit informs) |
| **Aligns with INSTRUCTION_MANUAL.md** | ✅ Core principle | ✅ Respects manual | ✅ Respects manual | ✅ All aligned |
| **Consolidates Records (66→1)** | ✅ Via shell model | ✅ Via usage (low priority) | ⚠️ Via design rules | ✅ YES (Records unified search) |
| **Button density reduction** | ✅ Via shell rules | ✅ Via usage patterns | ✅ ESLint enforced | ✅ YES (all methods) |
| **Unifies form patterns** | ✅ Yes | ✅ Yes | ✅ YES (design tokens) | ✅ YES (all use Zod) |
| **Offline-first officer UX** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ YES (preserved) |
| **Global search + nav** | ✅ Yes | ✅ Via usage ranking | ✅ Via design system | ✅ YES (all emphasized) |
| **Performance budgets** | ⚠️ Mentioned | ✅ Optimized by volume | ✅ ESLint enforced | ✅ YES (<250 KB rule) |
| **A11y / WCAG AAA** | ✅ Built-in | ✅ Optional analytics | ✅ YES (all components) | ✅ YES (98%+ compliant) |
| **Implementation complexity** | Medium | Low-Med | Low | Medium (phased) |
| **Risk level** | Low | Very Low | Very Low | Low (phased approach) |
| **Time to MVP** | 8 wks | 2 wks (audit only) | 2 wks (design system) | **17 weeks (full)** |
| **Best for enterprise SLA** | ✅ Good | ✅ Excellent (data-driven) | ✅ Excellent (enforced rules) | ✅ EXCELLENT (all combined) |

---

**Master Plan Document version**: 2026-05-10  
**Authority**: Synthesized from INSTRUCTION_MANUAL.md, LIVE_SCHEMA.md, routeManifest.ts, operational audit (Bob), and enterprise design best practices (OpenAI)  
**Next Steps**: 
1. Schedule Phase 0 kick-off (Week 1: Bob audit + design system implementation)
2. Assign leads: Bob (audit), OpenAI/Design (systems), Copilot (shell architecture)
3. Set up human testing cohort recruitment (target: 19 people across 3 shells)
4. Create implementation tickets for each phase

---

## Triad Cycle Update (2026-05-10)

### Evidence Snapshot

1. Bob lens artifact: [tools/uiux-plans/bob_plan_via_collab_2026-05-10T15-27-42Z.txt](tools/uiux-plans/bob_plan_via_collab_2026-05-10T15-27-42Z.txt)
2. Dr Bob lens artifact pointer: [data/dr-bob-escalation-latest.json](data/dr-bob-escalation-latest.json)
3. Staging authority references used: [docs/STAGING.md](docs/STAGING.md), [docs/ENTERPRISE_COLLAB_EXECUTION_PLAN_2026-05-02.md](docs/ENTERPRISE_COLLAB_EXECUTION_PLAN_2026-05-02.md), [docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md](docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md)

### OpenAI Lens Synthesis (This Session)

1. Preserve shell-first IA as the stable scaffold (Officer, Admin, Master), then optimize workflow depth inside each shell rather than replacing shell IA with pure workflow routing.
2. Apply bounded complexity controls as non-negotiable engineering gates: page action caps, consistent form patterns, and route-size/performance budgets.
3. Prioritize data-risk surfaces before visual polish in execution order: multi-org isolation views, enforcement action flows, and incident/breach lifecycle pages.
4. Require measurable rollout gates for each shell: task completion time, click depth, and operator error rate improvements against baseline.
5. Treat Bob as operational validation and OpenAI lens as architecture quality gate; both must be linked to persisted artifacts per cycle.

### Cycle Decision

1. Triad status: CONDITIONAL GO.
2. Rationale: Dr Bob approved with no blocker findings, but Bob plan output was high-level and requires one refinement pass to map directly to route-level implementation tickets.
3. Required follow-up: run one targeted Bob refinement prompt focused on route-level mapping for top friction modules (Compliance, Records, Dispatch, Officer workflows).

