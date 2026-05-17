# Governance Gates Architecture

## Overview

The FieldOps Manager enforces fail-closed role and authorization governance through a multi-domain gate system. Each domain (admin, admin_officer, officer, transportation) has dedicated route and endpoint checkers that validate authorization signatures, role requirements, component wiring, and detect drift from baseline snapshots.

**Design Principle**: Governance gates are snapshot-locked regression detectors. Once a baseline is captured, any role mutation, component wiring change, route addition/removal, or endpoint signature change triggers a CI failure until explicitly approved via baseline update.

---

## Gate Architecture Overview

### Domains

| Domain | Route Gate | Endpoint Gate | Coverage |
|--------|-----------|---------------|----------|
| **admin** | `scripts/check-admin-modules.mjs` | N/A | Admin-specific pages and module policies |
| **admin_officer** | `scripts/check-admin-officer-routes.mjs` | `scripts/check-admin-officer-endpoints.mjs` | Dual-role portal access & admin-facing edge functions |
| **officer** | `scripts/check-officer-routes.mjs` | `scripts/check-officer-endpoints.mjs` | Field officer portal and officer-facing endpoints |
| **transportation** | N/A | `scripts/check-transportation-endpoints.mjs` | Vehicle scanning, ALPR, transport-tier endpoints |

### CI Workflow Integration

Each domain has two GitHub Actions workflows:
- `.github/workflows/ci-{domain}-{gate-type}-gate.yml` (routes or endpoints)
- Triggers on relevant file changes (src/App.tsx, supabase/functions/**, data baselines)
- Uploads governance reports and trends as artifacts for evidence tracking

---

## Admin_Officer Governance Split

### Rationale

The `admin_officer` role is a dual-scoped access control that combines admin-panel visibility with field-officer participation. Prior to this split, admin_officer authorization was mixed with:
- Global admin role requirements (imprecise)
- Officer route blocks (incomplete coverage)

Result: Regression detection was ambiguous and role mutations were not caught reliably.

### Solution

Two fail-closed gates enforce admin_officer as a distinct authorization domain:

#### Route Governance
- **Script**: `scripts/check-admin-officer-routes.mjs`
- **Baseline**: `data/admin-officer-routes-baseline.json`
- **Snapshot**: `data/admin-officer-routes-snapshot.json` (locked to live signatures)
- **Validation**:
  - Minimum 229 routes (admin_officer role requirement enforced)
  - `/admin` routed to `AdminHub` component only
  - All routes must have explicit role guards
  - Component allowlist prevents unexpected wiring
  - Critical routes (portal-selection, admin, field-officer, dispatch) must be present

#### Endpoint Governance
- **Script**: `scripts/check-admin-officer-endpoints.mjs`
- **Baseline**: `data/admin-officer-endpoints-baseline.json`
- **Snapshot**: `data/admin-officer-endpoints-snapshot.json` (locked to live signatures)
- **Validation**:
  - Minimum 28 endpoints (admin_officer scoped functions)
  - All endpoints must have `Deno.serve()` handler
  - All endpoints must use CORS helpers
  - OPTIONS preflight required with justified overrides:
    - `smoke-notice` (internal assessment endpoint)
    - Several internal PTT/radio endpoints (see baseline for full list)
  - Signature drift locked (any changes trigger CI failure)

### Key Files

```
scripts/
  ├── check-admin-officer-routes.mjs       # Route validation checker
  └── check-admin-officer-endpoints.mjs    # Endpoint validation checker

data/
  ├── admin-officer-routes-baseline.json   # Policy + role/component rules
  ├── admin-officer-routes-snapshot.json   # Locked live signatures
  ├── admin-officer-endpoints-baseline.json # Policy + requirement overrides
  └── admin-officer-endpoints-snapshot.json # Locked live signatures

.github/workflows/
  ├── ci-admin-officer-routes-gate.yml     # Routes CI gate
  └── ci-admin-officer-endpoints-gate.yml  # Endpoints CI gate

package.json
  ├── "data:check:admin-officer-routes"    # Local pre-flight script
  └── "data:check:admin-officer-endpoints" # Local pre-flight script
```

---

## How Governance Gates Work

### 1. Route Governance Checker Flow

```
Read App.tsx
    ↓
Extract all routes with path, role, component, and role-guard status
    ↓
Filter by includeRouteRegexes and role (admin_officer)
    ↓
Check minimum count threshold
    ↓
For each route:
  - Validate required roles (per-route overrides or global)
  - Check role guard is present
  - Validate component allowlist (no unexpected components)
  - Check critical routes exist with correct roles/components
    ↓
Load regression snapshot
    ↓
Detect drift:
  - Added routes (blocked if allowRouteAdditions=false)
  - Removed routes (blocked if allowRouteRemovals=false)
  - Changed roles (blocked if enforceRoleDiff=true)
  - Changed components (blocked if enforceComponentDiff=true)
    ↓
Generate report → data/prepared/{domain}-routes-report.json
Generate trend → data/prepared/{domain}-routes-trend.json
    ↓
Exit with code 0 (pass) or 1 (fail)
```

### 2. Endpoint Governance Checker Flow

```
Read baseline endpointList from data/{domain}-endpoints-baseline.json
    ↓
For each endpoint:
  - Check directory exists
  - Check index.ts exists
  - Check Deno.serve() handler present
  - Check OPTIONS preflight (with per-endpoint overrides)
  - Check CORS helper usage
    ↓
Check minimum endpoint count threshold
    ↓
Load regression snapshot
    ↓
Detect drift:
  - Added endpoints (blocked if allowEndpointAdditions=false)
  - Removed endpoints (blocked if allowEndpointRemovals=false)
  - Changed signatures (blocked if enforceEndpointDiff=true)
    ↓
Generate report → data/prepared/{domain}-endpoints-report.json
Generate trend → data/prepared/{domain}-endpoints-trend.json
    ↓
Exit with code 0 (pass) or 1 (fail)
```

### 3. Snapshot Locking

Once a baseline is created and checkers pass, the snapshot is generated from the current live report:

```bash
# Extract current route signatures to snapshot
node -e "
  const fs = require('fs');
  const r = JSON.parse(fs.readFileSync('data/prepared/admin-officer-routes-report.json','utf8'));
  const snap = {
    checkedAt: new Date().toISOString(),
    adminOfficerRouteCount: r.checks.adminOfficerRouteCount,
    routeSignatures: r.adminOfficerRoutes.map(x => ({
      path: x.path,
      roles: x.roles,
      components: x.components,
      hasRoleGuard: x.hasRoleGuard
    }))
  };
  fs.writeFileSync('data/admin-officer-routes-snapshot.json', JSON.stringify(snap, null, 2) + '\n');
"
```

**Once locked**, any future run that deviates will report drift and fail the check. This forces intentional review of every role/component/endpoint change.

---

## Baseline & Snapshot Structure

### Route Baseline Example
```json
{
  "version": "1.0.0",
  "thresholds": {
    "includeRouteRegexes": [],
    "excludeRouteRegexes": ["^/public/"],
    "includeRoutesWithAdminOfficerRole": true,
    "minAdminOfficerRouteCount": 229,
    "requireRoleGuard": true,
    "requiredRolesAnyOf": ["admin_officer"]
  },
  "routeRoleRequirements": {
    "/portal-selection": ["admin_officer"],
    "/admin": ["admin_officer"],
    "/field-officer": ["admin_officer"]
  },
  "routeComponentAllowlist": {
    "/admin": ["AdminHub"],
    "/field-officer": ["FieldOfficerPortal"]
  },
  "criticalRoutes": [
    {
      "path": "/portal-selection",
      "requiredRoles": ["admin_officer"],
      "requiredComponents": ["PortalSelection"]
    }
  ],
  "regressionSnapshot": {
    "path": "data/admin-officer-routes-snapshot.json",
    "allowRouteAdditions": false,
    "allowRouteRemovals": false,
    "enforceRoleDiff": true,
    "enforceComponentDiff": true,
    "enforceRoleGuardDiff": true
  }
}
```

### Endpoint Baseline Example
```json
{
  "version": "1.0.0",
  "thresholds": {
    "minAdminOfficerEndpointCount": 28
  },
  "requiredEndpoints": [
    "create-user",
    "manage-dispatch-operations",
    "process-officer-scan",
    "..."
  ],
  "endpointRequirements": {
    "requireDenoServe": true,
    "requireOptionsHandler": true,
    "requireCorsHelper": true
  },
  "endpointRequirementOverrides": {
    "smoke-notice": {
      "requireOptionsHandler": false
    }
  },
  "regressionSnapshot": {
    "path": "data/admin-officer-endpoints-snapshot.json",
    "allowEndpointAdditions": false,
    "allowEndpointRemovals": false,
    "enforceEndpointDiff": true
  }
}
```

---

## Operational Workflow

### During Development

1. **Local Pre-flight Check** (before commit):
   ```bash
   bun run data:check:admin-officer-routes
   bun run data:check:admin-officer-endpoints
   ```

2. **If Changes Require Baseline Update**:
   - Update `data/admin-officer-routes-baseline.json` or endpoint baseline
   - Commit with explicit justification in commit message
   - Regenerate snapshot from report if baseline threshold changed

3. **Push to GitHub**:
   - GitHub Actions CI gates run automatically
   - Both gates must pass before merge

### During Code Review

Reviewers check:
- ✓ Governance reports in CI artifacts
- ✓ Any baseline/snapshot changes are justified
- ✓ No unexplained drift reported
- ✓ Route/endpoint signatures match intent

---

## Other Governance Domains

For reference, this architecture is replicated for:

### Admin Modules Gate
- **Scope**: Admin-exclusive pages and module visibility
- **Route validation**: Ensure only admin/master access key routes
- **Component allowlist**: Prevent accidental admin panel wiring to field routes
- **Critical**: `/admin/raw-data-browser` (grand_master only)

### Officer Routes Gate
- **Scope**: Officer field portal and role-specific routes
- **Route validation**: Ensure officer/admin_officer roles are enforced
- **Covers**: `/field-officer`, `/parking-officer`, `/noise-officer`, etc.
- **Count**: 32 routes locked at snapshot

### Officer Endpoints Gate
- **Scope**: Officer-facing edge functions (PTT, radio, welfare, dispatch)
- **Endpoint validation**: Ensure all have Deno.serve, CORS, OPTIONS
- **Overrides**: Several internal endpoints skip OPTIONS (internal only)
- **Count**: 21 endpoints locked at snapshot

### Transportation Endpoints Gate
- **Scope**: Vehicle scanning, ALPR, sync endpoints
- **Route validation**: Ensures transportation routes maintain role signature
- **Endpoint validation**: ALPR, scan, sync functions validated
- **Status**: Currently failing on pre-existing `/parking-officer` role drift (known issue)

---

## Governance Discipline & Maintenance

### Baseline Updates (Rare, Intentional)

Update baseline only when:
1. **Intentional Role Expansion**: New admin_officer routes added with explicit approval
2. **Threshold Calibration**: Component count threshold raises based on new feature scope
3. **Override Addition**: New OPTIONS skip justified and reviewed

**Process**:
```bash
# Edit baseline
vim data/admin-officer-routes-baseline.json

# Run checker to generate new report
node scripts/check-admin-officer-routes.mjs

# Update snapshot to lock new state
node -e "..."  # regenerate snapshot script

# Commit with detailed message
git add data/admin-officer-*
git commit -m "chore: update admin_officer routes baseline - reasoning: [detailed justification]"
```

### Snapshot Regeneration

Snapshots are regenerated whenever baseline thresholds or policy changes:
```bash
# After baseline update, regenerate snapshot from new report
node scripts/update-admin-officer-snapshots.mjs
```

If no script exists, use the inline Node.js approach shown above.

### Monitoring & Alerting

- **CI Failures**: Every PR with governance gate failure blocks merge
- **Trend Tracking**: `data/prepared/{domain}-{gate-type}-trend.json` tracks count deltas
- **Artifact Preservation**: GitHub Actions artifacts keep 30 days of governance evidence

---

## Troubleshooting

### Route Gate Fails: "Route roles changed since snapshot"

**Cause**: A route's role array changed (e.g., `["admin", "admin_officer"]` → `["admin_officer"]`)

**Fix**:
1. Review the route change in `src/App.tsx`
2. If intentional, update baseline to reflect new policy
3. Regenerate snapshot
4. If unintentional, revert the route change

### Endpoint Gate Fails: "Admin officer endpoint missing OPTIONS preflight handler"

**Cause**: A new endpoint was added without OPTIONS handler or an existing endpoint lost it

**Fix**:
1. Check the endpoint's `supabase/functions/{name}/index.ts`
2. Add OPTIONS handler if missing:
   ```typescript
   if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
   ```
3. If endpoint is internal/non-browser, add override to baseline
4. Re-run checker and update snapshot

### Snapshot Not Found

**Cause**: Snapshot file missing or corrupted

**Fix**:
1. Regenerate from latest passing report:
   ```bash
   node scripts/check-admin-officer-routes.mjs  # generates report
   # Copy report structure to snapshot
   ```
2. Or re-baseline from scratch (nuclear option, use sparingly)

---

## References

- **Decision Record**: `docs/DECISIONS.md` (2026-05-17 entry)
- **CI Workflows**: `.github/workflows/ci-admin-officer-*-gate.yml`
- **Scripts**: `scripts/check-admin-officer-*.mjs`
- **Test Coverage**: Role gate tests in `tests/e2e/phase3-*.spec.ts`
