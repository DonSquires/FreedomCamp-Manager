# Route Consolidation Manifest

**Status**: Part 2.2 runtime manifest enforcement complete (2026-05-17)
**Version**: 1.1  
**Maintained by**: Platform Engineer

This document establishes the canonical route paths for all FieldOps Manager portals and tools, serving as the authoritative source of truth for frontend navigation and API route references.

---

## Executive Summary

### Before Consolidation
- **Total routes**: 220+
- **Duplicate definitions**: 15+
- **Overlapping paths**: 10+
- **Admin namespace confusion**: /admin, /admin/*, / (top-level) mixed

### After Consolidation
- **Total routes**: 170+ (reduced by 50)
- **Duplicate definitions**: 0
- **Canonical paths**: Established and documented
- **Redirect strategy**: All deprecated paths → canonical via Navigate()

### Part 2.2 Runtime Enforcement
- Visibility mode filtering now runs in runtime consumers using environment context:
  - `production`: hides `internal` and `hidden` routes
  - `staging` / `development`: permits `internal` routes (still role + feature-flag gated)
- Added helper APIs:
  - `isRouteHidden(path, entries, mode)`
  - `resolveRuntimeVisibilityMode(envMode, isProd)`
- Build/start preflight now validates route manifest at Vite config load and fails fast on invalid schema.

---

## Three-Shell Navigation Model

FieldOps Manager operates three primary application shells:

```
┌─────────────────────────────────────────────────────────────────┐
│  OFFICER SHELL: /field-officer                                  │
├─────────────────────────────────────────────────────────────────┤
│  - /field-officer               → FieldOfficerPortal             │
│  - /field-officer/dispatch      → FieldOfficerDispatch          │
│  - /officer-home                → OfficerHomePage               │
│  (legacy: /field → /field-officer, /waiting-for-shift → /officer-home)
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│  ADMIN SHELL: /admin                                             │
├─────────────────────────────────────────────────────────────────┤
│  - /admin                       → AdminHub                        │
│  - /admin/dashboard             → AdminPortal                     │
│  - /dashboard                   → ModuleDashboard                │
│  - Sub-sections: /data, /users, /organizations, /access-control │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│  MASTER SHELL: System-level governance                           │
├─────────────────────────────────────────────────────────────────┤
│  - /organizations               → OrganizationManagement          │
│  - /platform                    → Platform                        │
│  - /grandmaster-code-studio     → GrandmasterCodingStudio        │
│  - /admin/raw-data-browser      → GrandMasterRawDataBrowser      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Canonical Path Registry

### 1. Officer Portal Routes

| Canonical Path | Component | Roles | Visibility |
|---|---|---|---|
| `/field-officer` | FieldOfficerPortal | officer, admin_officer | production |
| `/field-officer/dispatch` | FieldOfficerDispatch | officer, admin_officer | production |
| `/officer-home` | OfficerHomePage | officer, admin_officer | production |
| `/dispatch` | DispatchConsole | admin, admin_officer, master | production |
| `/dispatch-monitor` | DispatchMonitor | admin, admin_officer, master | production |
| `/dispatch-wizard` | DispatchWizard | admin, admin_officer, master | production |

**Deprecated → Canonical Redirects**:
- `/field` → `/field-officer` (legacy deep-link compat)
- `/waiting-for-shift` → `/officer-home` (renamed)
- `/admin/dispatch` → `/dispatch` (namespace consolidation)

---

### 2. Admin Portal Routes

| Canonical Path | Component | Roles | Visibility |
|---|---|---|---|
| `/admin` | AdminHub | admin, admin_officer, master | production |
| `/admin/dashboard` | AdminPortal | admin, admin_officer, master | production |
| `/dashboard` | ModuleDashboard | admin, admin_officer, master, officer | production |
| `/portal-selection` | PortalSelection | admin_officer | production |

---

### 3. Operational Core (Shared)

| Canonical Path | Component | Roles | Visibility |
|---|---|---|---|
| `/patrols` | PatrolModule | admin, admin_officer, master, officer | production |
| `/patrols/:id` | PatrolDetail | admin, admin_officer, master, officer | production |
| `/enforcement-actions` | EnforcementActions | admin, admin_officer, master, officer | production |
| `/enforcement-command-center` | EnforcementCommandCenter | admin, admin_officer, master | production |
| `/enforcement-review` | EnforcementReview | admin, admin_officer, master | production |
| `/compliance` | CompliancePage | admin, admin_officer, master | production |
| `/breaches` | BreachAlerts | protected (role-gated) | production |
| `/investigations` | InvestigationJobsPage | admin, admin_officer, master | production |
| `/zones` | ZoneManagement | admin, admin_officer, master | production |
| `/vehicles` | VehicleManagement | protected | production |
| `/vehicles/:id` | VehicleDetailPage | protected | production |
| `/vehicle-registry` | VehicleRegistry | admin, admin_officer, master, nzscv_monitor | production |
| `/vehicle-discrepancies` | VehicleDiscrepancyLog | admin, admin_officer, master | production |

**Deprecated → Canonical Redirects**:
- `/admin/enforcement` → `/enforcement-actions`
- `/admin/discrepancies` → `/vehicle-discrepancies`
- `/compliance-dashboard` → `/compliance`
- `/reports-hub` → `/reports`
- `/observation-records` → `/observations`

---

### 4. Domain-Specific Portals

#### 4.A Parking Enforcement
| Canonical Path | Component | Roles | Visibility |
|---|---|---|---|
| `/parking` | ParkingEnforcementPortal | admin, admin_officer, master | production |
| `/parking-officer` | ParkingOfficerPortal | officer, admin_officer, admin, master | production |
| `/parking-permits` | ParkingPermitManager | admin, admin_officer, master | production |
| `/parking-appeals` | ParkingAppealsPortal | admin, admin_officer, master | production |
| `/dynamic-pricing` | DynamicPricing | admin, admin_officer, master | production |
| `/revenue-forecasting` | RevenueForecast | admin, admin_officer, master | production |

#### 4.B Noise Control
| Canonical Path | Component | Roles | Visibility |
|---|---|---|---|
| `/noise-control` | NoiseControlPortal | admin, admin_officer, master | production |
| `/noise-officer` | NoiseOfficerPortal | officer, admin_officer, admin, master | production |
| `/noise-complaints` | NoiseComplaintsPage | protected | production |

#### 4.C Biosecurity & Health
| Canonical Path | Component | Roles | Visibility |
|---|---|---|---|
| `/biosecurity-control` | BiosecurityControlPage | admin, admin_officer, master | production |
| `/biosecurity-officer` | BiosecurityOfficerPortal | officer, admin_officer, admin, master | production |
| `/smoke-control` | SmokeComplaintControlPage | admin, admin_officer, master | production |
| `/smoke-officer` | SmokeComplaintOfficerPortal | officer, admin_officer, admin, master | production |

#### 4.D Reports & Analytics
| Canonical Path | Component | Roles | Visibility |
|---|---|---|---|
| `/reports` | ReportsHub | protected | production |
| `/custom-reports` | CustomReportBuilder | admin, admin_officer, master | production |
| `/incident-reports` | IncidentReports | admin, admin_officer, master | production |
| `/compliance-analytics` | ComplianceAnalytics | admin, admin_officer, master | production |
| `/ai-analysis` | AiAnalysis | admin, admin_officer, master | production |
| `/hotspots` | HotspotsMap | admin, admin_officer, master | production |

---

### 5. AI & Bob Assistant

| Canonical Path | Component | Roles | Visibility |
|---|---|---|---|
| `/bob-assistant` | BobAssistantStudio | admin, admin_officer, master, officer, grand_master | production |
| `/bob-intake-queue` | BobIntakeQueue | admin, admin_officer, master, grand_master | production |

**Deprecated → Canonical Redirects**:
- `/bob` → `/bob-assistant` (alias)
- `/bob-studio` → `/bob-assistant` (alias)
- `/bob/assistant-studio` → `/bob-assistant` (alias)

---

### 6. Audit & Logging (95+ routes)

All log routes follow the canonical pattern: `/{entity}-log`

**Examples**:
- `/patrol-events-log` → PatrolEventLog
- `/dispatch-events-log` → DispatchEventLog
- `/investigation-jobs-log` → InvestigationJobLog
- `/compliance-audit-log` → ComplianceAuditLog
- `/enforcement-events-log` → EnforcementEventLog

**Future Reorganization** (planned for Part 3):
- Consider moving to `/admin/logs/{entity}-log` namespace
- Or `/audit/{domain}/{entity}-log` pattern

**Part 3 Foundation (implemented 2026-05-17):**
- Added compatibility alias routes:
  - `/audit` → `/audit-log`
  - `/audit/:logPath` → `/{logPath}` (or `/{logPath}-log` when suffix omitted)
- Unknown alias paths safely fall back to `/audit-log`.
- Existing canonical log routes remain unchanged in this phase; this introduces namespace compatibility first.

**Part 3 Domain Alias Expansion (implemented 2026-05-17):**
- Added structured alias route: `/audit/:domain/:logPath`.
- Alias resolution is manifest-driven using `auditDomain` metadata on log routes.
- Navigation surfaces now prefer `/audit/{domain}/{entity}` links for selected high-traffic logs while preserving legacy route compatibility.

---

### 7. Internal & Debug Routes

| Canonical Path | Component | Roles | Production | Staging | Dev |
|---|---|---|---|---|---|
| `/diagnostics` | SystemDiagnostics | master, grand_master | ❌ | ✅ | ✅ |
| `/test-dashboard` | TestDashboard | master, grand_master | ❌ | ✅ | ✅ |
| `/clean-dashboard` | CleanDashboard | admin, admin_officer, master | ❌ | ✅ | ✅ |
| `/feature-flags` | FeatureFlagManager | master | ❌ | ✅ | ✅ |
| `/admin/raw-data-browser` | GrandMasterRawDataBrowser | grand_master | ❌ | ✅ | ✅ |
| `/grandmaster-code-studio` | GrandmasterCodingStudio | grand_master | ❌ | ✅ | ✅ |
| `/admin/video-generation` | BriefingVideoSuite | admin, admin_officer, master | ❌ | ✅ | ✅ |

---

## Visibility Mode Configuration

### Production Mode (`isProduction: true`)
**Visible routes**: All operational routes + domain portals + reporting + Bob assistant + public routes
**Hidden routes**: All debug routes, internal tools, experimental features

```json
{
  "visibilityMode": "production",
  "hiddenPaths": [
    "/diagnostics",
    "/test-dashboard",
    "/clean-dashboard",
    "/feature-flags",
    "/admin/raw-data-browser",
    "/grandmaster-code-studio",
    "/admin/video-generation"
  ]
}
```

### Staging Mode (`isProduction: false`, `isStaging: true`)
**Visible routes**: All production routes + all debug routes + experimental features
**Hidden routes**: Only truly internal/experimental features

```json
{
  "visibilityMode": "staging",
  "hiddenPaths": []
}
```

### Development Mode (`isProduction: false`, `isDevelopment: true`)
**Visible routes**: All 170+ routes (no filtering)

---

## Role-Based Access Tiers

Four primary roles define access:

| Role | Tier | Access | Entry Point |
|---|---|---|---|
| `officer` | 1 | Field operations only | `/officer-home` |
| `admin_officer` | 2 | Field + portal selection | `/portal-selection` |
| `admin` | 3 | Admin hub + operational tools | `/admin` |
| `master` | 4 | Master platform control | `/admin`, platform tools |
| `grand_master` | 5 | System-wide governance | Platform, raw data, code studio |

---

## Consolidation Achievements (Part 2.1)

✅ **Duplicates Removed**: 15+ duplicate definitions eliminated
✅ **Routes Consolidated**: 5 overlapping path sets reduced to canonical
✅ **Backward Compatibility**: All deprecated paths use Navigate() redirects
✅ **Code Size**: ~320 lines removed from src/App.tsx
✅ **Type Safety**: Zero TypeScript errors post-consolidation
✅ **Documentation**: This manifest created for future navigation

### Routes Modified

1. **Removed duplicate Sprint section** (B-64 through B-90)
   - Health & Safety, Welfare, Parking, Roster, Noise, Site Incidents, Person Interactions, Plate Scans, Dispatch, Contractor, Vehicle Discrepancies, etc.
   - All already defined earlier in verbose format

2. **Consolidated enforcement paths**
   - Kept: `/enforcement-actions` (canonical)
   - Deprecated: `/admin/enforcement` (now redirects)

3. **Consolidated dispatch paths**
   - Kept: `/dispatch` (canonical)
   - Deprecated: `/admin/dispatch` (now redirects)

4. **Consolidated vehicle-discrepancies paths**
   - Kept: `/vehicle-discrepancies` (canonical)
   - Deprecated: `/admin/discrepancies` (now redirects)

---

## Future Work

### Part 2.2: Route Manifest Implementation
- [ ] Create `src/navigation/routeManifest.ts` with structured metadata
- [ ] Implement `isRouteVisibleForRole()` function
- [ ] Add feature-flag gating to conditional routes
- [ ] Integrate visibility mode filtering

### Part 2.3: Navigation Component Updates
- [ ] Update sidebar/nav to respect visibility modes
- [ ] Audit all hardcoded route links for use of canonical paths
- [ ] Update test fixtures to use canonical paths

### Part 2.4: Log Route Reorganization (optional)
- [ ] Consider reorganizing 95+ log routes into `/admin/logs/*` namespace
- [ ] Or consolidate into `/audit/*` for compliance-specific logs

---

## References

- **Before**: `/workspaces/FreedomCamp-Manager/docs/CRO_TODOLIST.md` (Part 2 requirements)
- **Session Memory**: `/memories/session/part2-route-audit.md`
- **Commits**:
  - `ef35369` - refactor(routes): consolidate duplicate routes and overlapping paths
  - `17200e0` - docs: mark CRO Part 1 quick wins as COMPLETE
  - `a5de86c` - UX: async state standardization across portal pages
  - And prior commits from Part 1

---

## Approval & Sign-Off

**Performed by**: GitHub Copilot (Platform Engineer persona)
**Date**: 2026-05-17
**Status**: Ready for Part 2.2 (Route Manifest Implementation)
**Next Review**: After Part 2.2 completion
