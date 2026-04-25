# Access/Nav Bob Review And Human Test

Status: planning evidence artifact

## 1. Bob Review Evidence

### Review Path Used

The original `scripts/dr-bob-review.mjs` path did not complete because the configured RunPod endpoint remained stuck in queue.

Working Bob path established in this workspace:

1. Load repo-local env via `scripts/load-local-env.mjs`
2. Authenticate with a real Supabase user from local Playwright credentials
3. Start local Bob service from `inference-service/`
4. Call Bob endpoints directly with a valid user JWT

### Bob Signal 1: Live Chat Acceptance Gate

Direct Bob `/chat` response from the running local service returned the following acceptance gate:

- Lint errors must be 0
- Build must succeed
- Chunk strategy must exist for large routes
- Bob review score must be at least 9 across 3 consecutive runs
- Training loop must require no outbound dependency

Assessment:

- This is a valid Bob-generated gate signal.
- It is broad and runtime-degraded, so it is supportive evidence, not the sole review source.

### Bob Signal 2: Bob Code-Task Queue Artifact

Bob accepted the implementation task and queued it as:

- Task ID: `5c137740-86df-4bdf-9c6c-08bc674ffb20`
- Short ID: `5c137740`
- Proposed branch: `bob/task-5c137740`

Task submitted to Bob:

`Create a new access registry module for FieldOps Manager that centralizes route access, menu visibility, alias redirect metadata, master and grand_master parity rules, and test harness separation requirements.`

Assessment:

- This proves Bob accepted the work package and the planning context.
- The current runtime did not generate a full `bob_plan` because Ollama/inference was degraded, but the work item is registered in Bob's task system.

### Bob Signal 3: Adversarial Architecture Review (Serverless)

**Date:** 2026-04-25  
**Runtime:** RunPod Serverless Endpoint `n0bp1ifmq01cx2` (qwen2.5:7b + Ollama)  
**Prompt:** Adversarial review of ACCESS_NAV_HANDOFF_CHECKLIST on route order, registry contract, role parity, test isolation, and multi-org scope  

**Bob Response:**

#### Blockers Identified (Conditional Pass)

1. **Missing Grounding in `system_state.json`**
   - The `accessRegistry.ts` file is not referenced in `system_state.json`
   - Risk: untracked changes and misalignment with system state
   - Mitigation: Ground all fields in `accessRegistry.ts` with references from `system_state.json`

2. **Incomplete Test Isolation**
   - Separating Bob UI scoring into a gated suite (RUN_BOB_UI_ASSESS=1) creates maintenance burden if not robust
   - Risk: test flakiness and interference
   - Mitigation: Implement clear gating with environment variables and robust isolation checks

3. **Missing Multi-org Scope Consideration**
   - Checklist does not account for organization-scoped access; org admins could see routes from other orgs
   - Risk: incorrect navigation and unauthorized access to org-specific routes
   - Mitigation: Add `getAccessibleRoutes()` function in `App.tsx` that filters routes by current user's org context

**Bob Sign-off:** Conditional pass. If mitigations are implemented, proceed. Otherwise, revise before execution.

**Assessment:** All three blockers are valid and critical. The revised checklist must address each before implementation begins.

### Current Bob Runtime Limitations

- RunPod `/run` requests stayed in `IN_QUEUE`.
- `onspace-ai-chat` authenticated successfully but fell back to local failsafe because upstream inference aborted.
- Local `inference-service` was started successfully on port 3000 in degraded mode.
- ONNX runtime is unavailable in this container due missing `ld-linux-x86-64.so.2`, but chat/task endpoints remain usable.
- Ollama is unreachable in this container, so full-plan generation is unavailable.

Conclusion:

- Bob review is included in the process with live evidence.
- Full adversarial Dr Bob review remains infrastructure-limited, not planning-limited.

## 2. Human Test Protocol

Human testing is mandatory before go-live because the failure mode here is behavioral drift, not only compile failure.

Scope update (combined human + Bob insights):

- Validate route access and menu visibility as one coherent policy.
- Validate organization scoping, not just role scoping.
- Validate deterministic behavior when Bob-dependent tests are disabled.

### Test Roles

Use real or test accounts for:

- `grand_master`
- `master`
- `admin`
- `admin_officer`
- `officer`
- `client_viewer`
- `nzscv_monitor`

### Human Test Scenarios

#### A. Navigation Visibility

For each role:

1. Login and record visible navigation items in both app navigation surfaces.
2. Confirm each visible item is intentionally visible for that role.
3. Confirm no known blocked routes appear in navigation.
4. For org-scoped roles, switch org context and confirm navigation updates accordingly.

Pass condition:

- No user sees a menu item they cannot access.
- Org-switching updates visibility correctly for scoped roles.

#### B. Direct Route Access

For each role:

1. Manually open 5-10 representative routes from visible nav.
2. Confirm each route loads or explicitly redirects by documented alias behavior.
3. Manually paste one route that should be blocked for that role.
4. For org admins, paste one route that belongs to a different organization and verify deny/redirect behavior.

Pass condition:

- Blocked routes do not silently render.
- Allowed routes do not redirect unexpectedly.
- Cross-org routes are blocked for non-global roles.

#### C. Alias Redirect Integrity

Manually test alias routes such as legacy redirects and intentional canonical redirects.

Pass condition:

- Redirect destination is explicit, stable, and matches registry metadata.

#### D. master vs grand_master Parity

1. Compare both users side-by-side on the same build.
2. Record differences in visible menu items and route access.
3. Verify every difference is intentional and documented.

Pass condition:

- No unexplained parity mismatch remains.

#### E. Access-Test Isolation

1. Run route-access suite with Bob scoring disabled.
2. Run Bob UI scoring separately.
3. Confirm route-access results are unchanged whether Bob scoring runs or not.

Pass condition:

- Route-access pass/fail is independent from Bob service health.

#### F. Minimum Role x Org Matrix

Run the following matrix and record expected vs actual results:

1. `grand_master` in org1 context: all routes visible/accessible across orgs.
2. `master` in org1 context: global/admin routes visible; org-restricted routes follow current org context.
3. `admin` in org1: org1-scoped routes visible; org2-scoped routes hidden/blocked.
4. `admin` in org2: org2-scoped routes visible; org1-scoped routes hidden/blocked.
5. `officer` in org1: officer-only and org1-scoped routes visible; admin routes blocked.
6. `client_viewer`: portal-only visibility and access.

Pass condition:

- No role/org combination can access routes outside intended policy.
- No hidden policy exists only in component logic; behavior matches documented registry policy.

## 3. Human Test Sign-Off Template

Record for each role:

- Role tested
- Nav surfaces checked
- Accessible routes sampled
- Blocked routes sampled
- Cross-org route checks sampled
- Alias redirects validated
- Unexpected visibility/access mismatches
- Final sign-off: pass/fail

## 4. Release Gate

Do not treat the work as complete until all three are true:

1. Bob evidence artifact exists.
2. Automated access tests pass.
3. Human role-based navigation tests pass.
4. Human role x org matrix tests pass with no unexplained mismatches.
