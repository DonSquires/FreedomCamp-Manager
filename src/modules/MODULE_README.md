# Module Structure & Architecture

This directory implements the **enterprise consolidation blueprint** outlined in `/docs/ENTERPRISE_CONSOLIDATION_BLUEPRINT.md`.

## Module Organization

Each module represents a business domain with 3–8 related views:

```
src/modules/
├── dashboard/          # Dashboard Hub (5 views)
├── patrol/             # Patrol Management (7 views)
├── enforcement/        # Enforcement (8 views)
├── operations/         # Operations (6 views)
└── administration/     # Administration (7 views)
```

## Module Structure Pattern

Each module follows this pattern:

```
src/modules/[module]/
├── index.ts            # Export all pages
├── layout.tsx          # Optional shared layout
├── [page1].tsx
├── [page2].tsx
├── components/         # Module-specific components
├── hooks/              # Module-specific hooks
└── types.ts            # Module types
```

## Pages per Module

### Dashboard Hub (5 views → 1 main dashboard)
- `Dashboard.tsx` – Role-based overview + KPIs + quick actions
- (Links to subsections via tabs)

### Patrol Management (7 views)
- `PatrolDashboard.tsx` – Patrol status & analytics
- `PatrolList.tsx` – Active & completed patrols (filtered)
- `PatrolDetail.tsx` – Detail page + dispatch rules
- `RosterPlanner.tsx` – Weekly schedule management
- `RouteOptimizer.tsx` – Route planning
- `OfficerWelfare.tsx` – Welfare tracking & alerts
- `PatrolAnalytics.tsx` – Historical analysis

### Enforcement (8 views)
- `BreachList.tsx` – Unified breach + incident list (filterable)
- `BreachDetail.tsx` – Detail page w/ audit log + related records
- `ComplianceTracker.tsx` – Compliance status dashboard
- `NoticeManagement.tsx` – Multi-type notice UI (infringement, noise, etc.)
- `ActionQueue.tsx` – Enforcement actions queue
- `InvestigationJobs.tsx` – Investigation management
- `EvidencePackages.tsx` – Photo/evidence management
- `EnforcementAuditLog.tsx` – Unified audit view

### Operations (6 views)
- `ZoneMap.tsx` – Map + list UI
- `ZoneDetail.tsx` – Config + geofence + POIs
- `ClientSites.tsx` – Site directory
- `SiteDetail.tsx` – Risk + contacts + incidents
- `VehicleRegistry.tsx` – ALPR + searchable vehicle list
- `VehicleDetail.tsx` – History + related breaches
- `AssetManagement.tsx` – Keep as-is (already tabbed)

### Administration (7 views)
- `UserManagement.tsx` – Keep existing (now supports broader org context)
- `Permissions.tsx` – Role & permission matrix
- `Organization.tsx` – Org settings + clients
- `SystemAuditLog.tsx` – Unified audit for all entities
- `DataManagement.tsx` – Import/export/cleanup workflows
- `FeatureFlags.tsx` – Feature flag management
- `Settings.tsx` – Global system settings

## Shared Components

Located in `src/components/shared/`:

- **UnifiedListView** – Config-driven list component (replaces list pages)
- **UnifiedAuditLog** – Config-driven audit history (replaces *Log pages)
- **DetailPanelLayout** – Reusable detail page + tabs (replaces detail pages)
- **ModuleNavigation** – Sidebar config for all modules

## Navigation Structure

### Sidebar Config (`ModuleNavigationConfig.ts`)
Centralized navigation configuration for all modules. Updates sidebar + breadcrumbs automatically.

```typescript
const SIDEBAR_NAVIGATION = [
  {
    id: 'patrol',
    label: 'Patrol Management',
    items: [
      { id: 'dashboard', label: 'Dashboard', url: '/patrol' },
      { id: 'active', label: 'Active Patrols', url: '/patrols' },
      // ...
    ]
  }
  // ...
]
```

### Route Structure
```
/patrol
  /patrol/              → Dashboard
  /patrols              → List
  /patrols/:id          → Detail
  /patrol/routes        → Routes

/enforcement
  /breaches             → List
  /breaches/:id         → Detail
  /compliance           → Tracker
  /notices              → Notice Mgmt
  /actions              → Action Queue
  /evidence             → Evidence Packages
  /audit-log            → Audit Log

/operations
  /zones                → Map
  /zones/:id            → Detail
  /sites                → Directory
  /sites/:id            → Detail
  /vehicles             → Registry
  /vehicles/:id         → Detail

/admin
  /users                → User Mgmt
  /permissions          → Role Matrix
  /org                  → Settings
  /system-audit         → Unified Audit
  /data-mgmt            → Data Mgmt
  /feature-flags        → Features
  /settings             → Global Settings
```

## Implementation Phases

### Phase 1 (Current): Foundation ✅
- [ ] Create module folder structure
- [ ] Create shared components (UnifiedListView, AuditLog, DetailPanel)
- [ ] Create ModuleNavigationConfig
- [ ] Create README.md and architecture docs

### Phase 2: Dashboard & Patrol
- [ ] Migrate dashboard pages to unified layout
- [ ] Migrate patrol pages (7 views)
- [ ] Update routing (App.tsx)
- [ ] Create Breadcrumb component

### Phase 3: Enforcement & Operations
- [ ] Migrate enforcement pages (8 views)
- [ ] Migrate operations pages (6 views)
- [ ] Implement unified audit log
- [ ] Update searches

### Phase 4: Admin & Cleanup
- [ ] Consolidate admin pages (7 views)
- [ ] Create unified audit view
- [ ] Remove old portal redirect logic
- [ ] Deprecate old pages with redirects

### Phase 5: Testing & Docs
- [ ] E2E tests for new routing
- [ ] Mobile QA
- [ ] Update instruction manual
- [ ] Create user training videos

## Development Workflow

1. **Create new page** in module folder
2. **Use shared components** (UnifiedListView, DetailPanel, AuditLog)
3. **Export in index.ts**
4. **Add route in App.tsx**
5. **Add navigation config in ModuleNavigationConfig.ts**

Example:

```typescript
// src/modules/patrol/PatrolList.tsx
import { UnifiedListView } from '@/components/shared/UnifiedListView'

const PATROL_LIST_CONFIG = { /* ... */ }

export function PatrolList() {
  return <UnifiedListView<Patrol> config={PATROL_LIST_CONFIG} />
}
```

## Best Practices

1. **One responsibility per page** – Page = one view/tab combo
2. **Use shared components** – Never rewrite list/detail/audit patterns
3. **Module-specific types in types.ts** – Keep type definitions local
4. **Module-specific hooks in hooks/** – Encapsulate data fetching
5. **No cross-module imports** – Use shared components instead
6. **Config-driven components** – Minimize page duplication

## Rollout Strategy

1. **Soft launch**: New modules run parallel to old portals (feature flags)
2. **Gradual migration**: Move user cohorts to new navigation
3. **Retire old pages**: Once all users on new modules, deprecate old routes
4. **Full sunset**: Remove old portal code after 2–4 week stability period

## Documentation

- `docs/ENTERPRISE_CONSOLIDATION_BLUEPRINT.md` – Strategic roadmap
- `docs/ENTERPRISE_UI_CONSOLIDATION_PATTERNS.md` – Industry patterns & code examples
- This file – Architecture & implementation guide

---

**Status**: Phase 1 scaffolding complete (May 13, 2026)  
**Next milestone**: Phase 2 implementation (Week 2)
