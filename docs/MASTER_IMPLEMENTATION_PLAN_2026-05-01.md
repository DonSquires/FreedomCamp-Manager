# FieldOps Manager — Master Implementation Plan
**Date:** 2026-05-01  
**Author:** GitHub Copilot + Bob Architecture Review  
**Priority:** Monday client demo + enterprise readiness

> Authority status (2026-05-03): Historical baseline for the Monday demo cycle.
> Active execution authority is maintained in docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md and docs/ENTERPRISE_COLLAB_EXECUTION_PLAN_2026-05-02.md.

---

## System Reality Check (as at 2026-05-01)

| System | Current State | Gap |
|--------|--------------|-----|
| **Build** | ✅ Clean compile, 0 errors | — |
| **DB/Schema** | ✅ 13/13 smoke tests pass | — |
| **Auth/Roles** | ⚠️ Roles exist, no `job_title` separation | Role = system permission, Title = human label — not split |
| **Org hierarchy** | ⚠️ `organization_level` + `parent_organization_id` exist in DB, not enforced in UI | 3-level hierarchy UI not built |
| **Module access** | ⚠️ `portal_access` + `enabled_portals` exist per user, no org-level module subscription | Nelson City Council pattern not possible yet |
| **PTT** | ⚠️ `ptt-server/server.js` (1644 lines) + client lib exists. Not connected to live TURN. Redis required. | Needs env vars wired + TURN configured |
| **Bob** | ⚠️ `inference-service/` exists (ONNX, Express). Edge function `bob-multimodal-gateway` exists. | Needs `BOB_SERVICE_URL` + `BOB_INFERENCE_API_KEY` in prod env |
| **Human Emulator** | ❌ Does not exist | Needs building |
| **Standalone Modules** | ❌ Module subscription at org level not implemented | Needs org_modules table + routing guard |

---

## Six Workstreams

### WS-1: Role + Title Separation
**Why it's broken:** `role` in `user_profiles` is a single string serving both permission level AND job title. "Admin Roster Only" is impossible without splitting these.

**Design:**
```
role (system)   = 'master' | 'admin' | 'admin_officer' | 'officer' | 'client_admin' | 'client_officer' | 'client_viewer'
job_title (human) = free text e.g. "Roster Administrator", "Noise Control Officer", "Senior Constable"
module_permissions = JSONB  e.g. { "roster": ["read","write"], "noise_control": ["read"], "dispatch": [] }
```

**What already exists:**
- `job_title` column already in `user_profiles` (nullable string) ✅
- `permissions` JSONB already in `user_profiles` ✅
- `PERMISSION_MATRIX` in `usePermissions.ts` — needs module-scoped extension

**Tickets:**
- [ ] `WS1-A`: Extend `PERMISSION_MATRIX` to support module-scoped permissions alongside global role permissions
- [ ] `WS1-B`: Update `UserManagement.tsx` to show/edit `job_title` separately from `role`
- [ ] `WS1-C`: Add `module_permissions` sub-key to `permissions` JSONB and update `usePermissions` hook to check it
- [ ] `WS1-D`: Update `AreaRoute` in `App.tsx` to check module permission if set, otherwise fall back to role

---

### WS-2: Multi-Org Hierarchy (3 Levels)
**Design:**
```
Level 1: Iron Eagle Security (master org / platform operator)
Level 2: Nelson City Council, Queenstown Lakes DC (client orgs, children of L1)
Level 3: Noise Control Unit, Parking Division (sub-units of client org, children of L2)
```

**What already exists:**
- `organization_level: number | null` in organizations table ✅
- `parent_organization_id: uuid → organizations` FK ✅
- `get_descendant_organizations(org_id)` RPC ✅
- `extra_organization_ids: string[]` on user profile ✅

**Gap:** No UI to manage this hierarchy. No routing enforcement based on org level. No visual org tree.

**Tickets:**
- [ ] `WS2-A`: Build `OrganizationHierarchyTree` component in `OrganizationManagement.tsx` — shows L1/L2/L3 as expandable tree
- [ ] `WS2-B`: Add `Create Child Organisation` action scoped to parent
- [ ] `WS2-C`: Enforce that `admin` role at L2 can only see/manage users and data in their org and children
- [ ] `WS2-D`: Add org context switcher in AppLayout for users with `extra_organization_ids` (multi-org officers)

---

### WS-3: Standalone Module Subscriptions (Nelson City Council Pattern)
**Core requirement:** Nelson City Council wants **Noise Control only** — no roster, no dispatch, no patrol. They log in, see only noise control portal. No roster officer required.

**Design:**
```sql
-- New table: org_module_subscriptions
id uuid PK
organization_id uuid FK → organizations
module_key text  -- 'noise_control' | 'parking' | 'dispatch' | 'roster' | 'patrol' | 'compliance' | 'crm' | 'ptt' | 'bob'
is_active boolean
config JSONB  -- per-module settings
created_at timestamptz
```

**Module keys mapping to existing pages:**
| module_key | Pages included |
|---|---|
| `noise_control` | NoiseControlPortal, NoiseOfficerPortal |
| `parking` | ParkingEnforcementPortal, ParkingOfficerPortal |
| `dispatch` | DispatchConsole, DispatchMonitor, DispatchWizard |
| `roster` | RosterPlanner, OpenShifts, OfficerAvailability |
| `patrol` | Patrols, LivePatrolMonitor, PatrolCheckpointManagement |
| `compliance` | ComplianceDashboard, CompliancePage, ComplianceAnalytics |
| `crm` | CRMModule, ClientAccountPage, ClientSites |
| `ptt` | PTTRadio, PTTTransmissionLog |
| `bob` | BobAssistantStudio, BobIntakeQueue |
| `enforcement` | EnforcementCommandCenter, BreachAlerts, InfringementNotices |

**Flow:**
1. L1 admin subscribes org to modules
2. On login, fetch org's subscribed modules
3. `AreaRoute` checks module subscription before allowing access
4. Portal selection page only shows subscribed modules
5. Sidebar only renders nav items for subscribed modules

**Tickets:**
- [ ] `WS3-A`: Create `org_module_subscriptions` table migration
- [ ] `WS3-B`: Create Supabase edge function `get-org-modules` (returns active modules for user's org)
- [ ] `WS3-C`: Add `useOrgModules()` hook — queries subscribed modules, cached per org
- [ ] `WS3-D`: Update `AreaRoute` to reject if module not in org subscription
- [ ] `WS3-E`: Update `PortalSelection.tsx` to filter by subscribed modules
- [ ] `WS3-F`: Update `AppLayout` sidebar to filter nav by subscribed modules
- [ ] `WS3-G`: Build Module Subscription admin UI in `OrganizationManagement.tsx`

---

### WS-4: PTT — Get It Working
**What exists:** Full PTT server (`ptt-server/server.js`, 1644 lines), WebSocket signaling, Redis-backed presence, org-scoped channels, JWT auth, TURN server Dockerfile.

**Gap:** Not connected to production. Redis not confirmed. TURN not confirmed. Client may have stale WebRTC config.

**Tickets:**
- [ ] `WS4-A`: Audit `src/lib/ptt.ts` — confirm signaling URL env var (`VITE_PTT_SERVER_URL`) is wired
- [ ] `WS4-B`: Verify TURN server is deployed (turn-server/Dockerfile → Railway/VPS). Add `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` env vars
- [ ] `WS4-C`: Add Redis connection health check to `check-ptt-health` edge function
- [ ] `WS4-D`: Add PTT status indicator to `AppLayout` header — green/amber/red dot
- [ ] `WS4-E`: Test PTT channel join → floor request → transmit → release flow with 2 browser tabs
- [ ] `WS4-F`: Add push-to-talk keyboard shortcut (Space bar hold) and touch button on mobile layout

---

### WS-5: Bob — Get It Working
**What exists:** `inference-service/server.js` (Express, ONNX), edge function `bob-multimodal-gateway`, `BobAssistantStudio.tsx`, `BobIntakeQueue.tsx`.

**Gap:** `BOB_SERVICE_URL` and `BOB_INFERENCE_API_KEY` need to be in the live Supabase project secrets. ONNX models need to be present in `inference-service/models/`.

**Tickets:**
- [ ] `WS5-A`: Verify `supabase/functions/bob-multimodal-gateway/index.ts` exists and reads `BOB_SERVICE_URL` correctly
- [ ] `WS5-B`: Add `OLLAMA_BASE_URL` support as fallback in bob-multimodal-gateway for local dev
- [ ] `WS5-C`: Verify `BobAssistantStudio.tsx` calls gateway correctly — check network tab for 4xx
- [ ] `WS5-D`: Add Bob connection status to `SystemDiagnostics.tsx`
- [ ] `WS5-E`: Wire `BobIntakeQueue.tsx` to receive triage from `bob-multimodal-gateway` and display results
- [ ] `WS5-F`: Ensure Bob respects org context (`x-org-id` header from user's `organization_id`)

---

### WS-6: Human Emulator for Demo/Testing
**Purpose:** Simulate realistic multi-user, multi-org field workflows without needing real mobile devices. Allows client to see live patrol updates, noise complaints being logged, PTT comms, Bob triage — all happening naturally.

**Design:** A "Ghost User" runner that authenticates as pre-seeded demo users and performs scripted but randomised actions via the Supabase API.

**Tickets:**
- [ ] `WS6-A`: Create `scripts/demo-emulator.mjs` — accepts `--org`, `--scenario`, `--users`
- [ ] `WS6-B`: Build scenario: `noise_control` — 2 officers log noise complaints every 30–60s, Bob triages them
- [ ] `WS6-C`: Build scenario: `patrol_cycle` — officer starts patrol, logs observations, ends shift
- [ ] `WS6-D`: Build scenario: `ptt_radio` — simulates floor requests and short transmissions
- [ ] `WS6-E`: Create `scripts/seed-demo-data.mjs` — seeds 3 orgs (L1/L2/L3), 8 users across roles, sample zones and sites
- [ ] `WS6-F`: Add `bun run demo` script to package.json

---

## Execution Priority for Monday Demo

### P0 — Must work (Monday afternoon)
1. `WS1-B`: Job title shows separately from role in user management
2. `WS2-A`: Org hierarchy tree visible (read-only is fine)
3. `WS3-D/E/F`: Module subscription gates routing + portal selection + sidebar
4. `WS5-C/D`: Bob shows connected/disconnected status clearly
5. `WS4-D`: PTT shows online/offline status indicator
6. `WS6-E`: Demo seed data seeded and ready

### P1 — Strong to have (Monday demo depth)
1. `WS3-A/B/C/G`: Full module subscription admin UI
2. `WS4-E`: 2-tab PTT test passes
3. `WS5-E`: Bob intake queue displaying triage results
4. `WS6-B`: Noise control emulator scenario running live

### P2 — Post-demo sprint
1. `WS2-C/D`: Full multi-org data isolation enforcement
2. `WS6-C/D`: Patrol and PTT emulator scenarios
3. Full role+title+module permissions matrix audit

---

## Key Architectural Decisions

### AD-1: `role` vs `job_title` vs `module_permissions`
- `role` = system permission level (DO NOT change these values — RLS policies depend on them)
- `job_title` = human-readable label, already in DB, just needs UI
- `module_permissions` = stored in existing `permissions` JSONB as `{ "modules": { "noise_control": ["read","write"] } }`
- **No new DB migration needed for WS1** — only code changes

### AD-2: Module subscriptions live at ORG level, not user level
- Org subscribes to modules (L1 admin controls this)
- User inherits module access from org subscription filtered by their role
- User can be further restricted below org subscription (never elevated above it)

### AD-3: PTT stays WebRTC peer-assisted for now
- Full SFU migration is in spec.md but is post-Monday
- For demo: 2-party direct WebRTC via TURN is sufficient
- PTT server Redis requirement — use Redis Cloud free tier if no VPS Redis available

### AD-4: Bob uses gateway pattern, not direct inference URL in frontend
- Frontend → `bob-multimodal-gateway` edge function → inference service
- This keeps API key server-side always
- For demo, use Ollama fallback if RunPod not configured

---

## Environment Variables Needed (Confirm in .env and GitHub Secrets)

```bash
# PTT
VITE_PTT_SERVER_URL=wss://your-ptt-server.example.com
VITE_TURN_URL=turn:your-turn.example.com:3478
VITE_TURN_USERNAME=fieldops
VITE_TURN_CREDENTIAL=<secret>

# Bob
BOB_SERVICE_URL=http://localhost:3001          # or RunPod URL
BOB_INFERENCE_API_KEY=<secret>
OLLAMA_BASE_URL=http://ollama:11434             # local fallback

# Supabase (already set)
VITE_SUPABASE_URL=<set>
VITE_SUPABASE_ANON_KEY=<set>
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| PTT TURN not deployed | High | High | Demo on localhost with 2 tabs — no TURN needed on same machine |
| Bob inference not responding | Medium | Medium | Show UI with "connecting" state + SystemDiagnostics page |
| Module subscription migration not deployed to Supabase prod | Medium | High | Use `portal_access` array as stand-in for demo |
| Client asks for mobile demo | Medium | Medium | Use PWA mode in Chrome DevTools mobile emulator |
| Multi-org seed data missing | Low | High | Run `seed-demo-data.mjs` before demo |

---

## Monday Demo Script (10 minutes)

1. **Login as L1 master admin** → show org hierarchy tree (Nelson City Council as child)
2. **Switch to Nelson City Council admin** → show only Noise Control module in sidebar (no roster, no patrol)
3. **Log a noise complaint** → Bob auto-triages it → shows in intake queue
4. **Show user management** → job title "Noise Control Officer" vs role "officer"
5. **Open 2nd browser tab as field officer** → PTT channel visible → push to talk
6. **Switch back to admin** → show live map with officer location + complaint pins
7. **Generate compliance report** → export PDF

---

*This plan supersedes all previous loop-iterations. Start at WS6-E (seed data) and WS1-B (job title UI) immediately — both are low-risk, high-demo-value, and have no schema migration required.*
