# UI/UX First-Wave Rollout Log

**Sprint 0 Artifact** | Generated: 2026-05-03 | Grounded from: `tools/route-role-matrix/route-role-matrix.json`, `docs/UI_UX_ENTERPRISE_FORWARD_PLAN_2026-05-03.md`

## Purpose

Define the top-10 operator routes that will receive first-wave async-state UX improvements. These routes are the highest-traffic, highest-friction points for admin and officer roles. Improvements are applied in priority order to maximise early operator value.

---

## Async-State UX Pattern

All first-wave routes must conform to the **Async-State Standard**:

| State | Required Behaviour |
|---|---|
| **Loading** | Skeleton screens (not spinners) for table/card content; visible within 100ms |
| **Empty** | Contextual empty state with a clear call-to-action (not just "No data found") |
| **Error** | User-facing error with recovery action (retry / contact support); never raw error stack |
| **Stale** | Background refresh indicator; UI remains interactive during re-fetch |
| **Offline** | Graceful degradation message; cached data shown where available |

---

## Top-10 Operator Routes — First Wave

### Tier A: Daily Operator Workflows (Highest Priority)

| # | Route | Roles | Current UX Debt | Async-State Work | Sprint |
|---|---|---|---|---|---|
| 1 | `/dispatch` | admin, admin_officer, master | No skeleton on job list load; errors show raw message | Skeleton table rows; retry banner; empty-state CTA "Create first job" | S1 |
| 2 | `/live-tracking` | admin, admin_officer, master | Map tiles block UI during load; no offline fallback | Progressive map load; "Officer GPS unavailable" graceful state; stale-data badge | S1 |
| 3 | `/compliance` | admin, admin_officer, master | Compliance table loads full before render; no loading state | Skeleton rows ×10; error state with re-run trigger; empty state "All zones compliant ✓" | S1 |
| 4 | `/patrol-schedule` | admin, admin_officer, master | Schedule grid blank then jumps; no empty state for uncovered shifts | Skeleton grid; empty-state "No shifts scheduled — add one" + quick-add action | S1 |
| 5 | `/officer-welfare` | admin, admin_officer, master | Welfare status table absent on slow load; no offline signal | Skeleton cards; "Connection lost — last check-in: XX" banner; manual refresh | S1 |

### Tier B: Investigation & Reporting (High Priority)

| # | Route | Roles | Current UX Debt | Async-State Work | Sprint |
|---|---|---|---|---|---|
| 6 | `/incidents` (alias `/incident-reports`) | admin, admin_officer, master, officer | List renders empty briefly then loads; pagination state lost on navigate-back | Skeleton list; URL-persisted pagination; empty-state "No incidents in selected date range" | S1 |
| 7 | `/reports` | admin, admin_officer, master | Report generation shows no progress indicator; silent failure on large datasets | Progress bar for generation; error banner with download-retry; empty-state by date picker | S1 |
| 8 | `/enforcement-actions` | admin, admin_officer, master, officer | Grid loads without skeleton; no error recovery | Skeleton rows; error with retry; empty-state "No enforcement actions today" | S1 |

### Tier C: Configuration & Admin (Medium Priority)

| # | Route | Roles | Current UX Debt | Async-State Work | Sprint |
|---|---|---|---|---|---|
| 9 | `/zones` | admin, admin_officer, master | Zone polygons load after map base; brief overlap glitch | Layer load order fix; skeleton zone cards; empty-state "No zones configured — add a zone" | S1 |
| 10 | `/admin/dashboard` | admin, admin_officer, master | KPI widgets all blank until all data fetched; any one failure blanks entire dashboard | Independent widget loading; per-widget error state; dashboard renders with partial data | S1 |

---

## Officer Portal — Field Routes (Tracked Separately)

| Route | Roles | Notes |
|---|---|---|
| `/officer-home` | officer, admin_officer | Highest-frequency field route; async-state handled in field portal sprint |
| `/field-officer` | officer, admin_officer | PTT-first; async is secondary to voice-reliability |
| `/job-map` | admin, admin_officer, master, officer | Map-heavy; async work in job-map sprint |

---

## UX Rollout Checklist Per Route

For each route in the first wave, the following checklist must pass before marking ✅:

- [ ] Loading skeleton renders within 100ms of navigation
- [ ] Empty state has actionable CTA (not generic "No data")
- [ ] Error state shows user-friendly message + recovery action
- [ ] Stale data indicator visible during background re-fetch
- [ ] Offline: cached data shown or graceful "offline" banner (no crash)
- [ ] E2E test updated with at least one async-state assertion (loading or empty)
- [ ] Verified in Chromium + mobile viewport (375px)

---

## Rollout Progress Tracker

| Route | Skeleton | Empty State | Error State | Stale Indicator | Offline | E2E Updated | Status |
|---|---|---|---|---|---|---|---|
| `/dispatch` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not started |
| `/live-tracking` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not started |
| `/compliance` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not started |
| `/patrol-schedule` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not started |
| `/officer-welfare` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not started |
| `/incident-reports` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not started |
| `/reports` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not started |
| `/enforcement-actions` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not started |
| `/zones` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not started |
| `/admin/dashboard` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not started |

---

## Evidence Basis

- Route matrix: `tools/route-role-matrix/route-role-matrix.json` (121 routes, commit `8cc8c4f3`)
- UX priorities: `docs/UI_UX_ENTERPRISE_FORWARD_PLAN_2026-05-03.md` § Priority 3
- Async-state standard: derived from TanStack Query v5 patterns used in `src/hooks/`
- Sprint assignment: S1 for all Tier A + B routes; aligns with forward plan sprint gate
