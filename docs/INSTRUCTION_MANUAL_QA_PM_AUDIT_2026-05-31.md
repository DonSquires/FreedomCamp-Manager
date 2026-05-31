# Instruction Manual QA/PM Audit (Section-by-Section)

Date: 2026-05-31  
Scope: Manual-driven QA/PM assessment against docs/INSTRUCTION_MANUAL.md using live data signals, route/role wiring, and pipeline behavior.

## Scoring Key

- PASS: Implemented and evidenced in current runtime/code.
- PARTIAL: Present but with drift, gating, or incomplete verification.
- GAP: Missing, broken, or contradictory to manual intent.

## Evidence Sources Used

- docs/INSTRUCTION_MANUAL.md
- src/navigation/routeManifest.ts
- src/App.tsx
- src/pages (portal/page inventory)
- supabase/functions (ALPR, process-officer-scan, analyze-vehicle-photo)
- supabase/migrations (processing_status and async pipeline history)
- live Supabase status snapshot (processing queue counts)

## Section-by-Section Assessment

### 1. Introduction & Overview
Status: PASS

- Core scope (multi-service enforcement, AI, compliance, dispatch, RBAC) is represented across route manifest and page inventory.
- Role families and specialist modules exist in app surfaces.

### 1a. UI/UX Design Standards
Status: PARTIAL

- App has broad module/page coverage and shell structures.
- No single automated conformance gate found for section-level UX standards in this audit pass.
- Requires visual regression + checklist-based QA evidence pack per standard block.

### 1b. Star Trek Rollout Checkpoint Governance
Status: PARTIAL

- Project has extensive rollout/governance documents and checklists in docs.
- Need explicit traceability map from checkpoint items to current release evidence artifacts.

### 2. Getting Started - Login & Navigation
Status: PASS

- Login and role-route infrastructure is present.
- Route manifest includes role-constrained paths and visibility modes.
- Portal selection and role redirects are implemented.

### 3. PART A - Owner
Status: PARTIAL

- grand_master and master roles are present in route manifest and owner/admin surfaces.
- Need scenario validation run (owner login to core flows) with expected-vs-actual screenshots and route outcomes.

### 4. PART B - Service Provider
Status: PARTIAL

- admin/admin_officer/nzscv_monitor are wired in role model and dedicated pages exist.
- Need end-to-end acceptance evidence for each role workflow path in manual subsections.

### 5. PART C - Field Roles (Officer Portals)
Status: PARTIAL

- Field officer and specialist portals (parking/noise/biosecurity/smoke/EMS/PTT) are present.
- Some portals are gate-dependent (roster/site/channel), so section compliance requires gated test fixtures.

### 6. PART D - Client Organisation
Status: PARTIAL

- client_admin/client_officer/client_viewer roles are represented.
- Client portal pages and client-site related pages exist.
- Need verified role isolation/UAT flows across client role matrix.

### 7. PART E - Public Portals
Status: PARTIAL

- Public portals are present (dispute, pay-by-plate, noise complaint, parking appeal, camper registration).
- Need production-route availability and submission lifecycle QA pack per public path.

### 8. PART F - Technical Reference (Systems Administrator)
Status: PARTIAL

- Architecture/edge functions/migrations/inference modules are present.
- Async queue helper contract drift has been remediated and verified live (get_pending_observations callable).
- Live queue state now shows pending drained but large failed backlog classed as no-photo backlog-cleared records.

### 9. Appendix A - Enforcement Document Quick Reference
Status: PARTIAL

- Enforcement pages and logs exist.
- Need explicit quick-reference artifact parity check against current enforcement UX.

### 10. Appendix B - Role Access Matrix
Status: PARTIAL

- Role matrix is strongly represented in route manifest.
- Need generated matrix export from route manifest + permission gates compared line-by-line to manual matrix.

### 11. Appendix C - Common Troubleshooting
Status: PARTIAL

- Many runbooks/troubleshooting docs exist.
- Need manual appendix synchronization check to ensure top recurring faults match current operational reality.

### 12. Appendix D - CRO To-Do List
Status: PARTIAL

- CRO and product execution docs exist.
- Need explicit linkage from CRO todo items to current release board statuses.

### 13. Appendix E - QA Bug Fix To-Do List
Status: PARTIAL

- Numerous QA/ops logs and checklists exist.
- Need a canonical open/closed defect ledger aligned to appendix items.

## High-Priority Drift Findings

1. Async queue helper RPC drift
- get_pending_observations has been restored and verified callable in live environment.
- Applied remediation: `supabase/migrations/20260531121500_restore_get_pending_observations_helper.sql`.
- Migration marker recorded: version 20260531121500 in supabase_migrations.schema_migrations.

2. Backlog resolution semantics
- Pending backlog was removed safely, but 64,148 records now sit in failed with reason backlog_cleared_no_actual_photo_url.
- This is operationally intentional cleanup, but policy/reporting must distinguish these from true inference failures.

3. Manual-to-evidence traceability gap
- Manual is comprehensive, but section-by-section executable evidence packs are not centrally stitched.

## Current Live Snapshot (Post-Cleanup)

- processing_status = pending: 0
- processing_status = processing: 0
- processing_status = failed: 64,148
- processing_status = completed: 246

## PM Remediation Plan (Priority Order)

1. Build Manual Compliance Matrix (MCM)
- One row per manual section/subsection
- Columns: expected behavior, owner, test case id, evidence link, status, last validated

2. Normalize queue semantics for reporting
- Introduce reason category grouping (operational-cleanup vs real-inference-failure)
- Keep dashboards from interpreting cleanup-failed rows as model/runtime errors

3. Restore/retire async queue helper contract intentionally
- Either restore callable get_pending_observations path or document/implement replacement contract and remove stale references

4. Role-by-role UAT sweep
- Owner, Service Provider, Field, Client, Public sections
- Capture section verdict with reproducible route + expected outcomes

5. Appendix parity pass
- Align appendices A-E with current logs/checklists and active quality gates

## Recommended Governance Cadence

- Weekly: Section delta review for manual sections changed in code this week
- Per release: Full section-by-section gate with explicit PASS/PARTIAL/GAP sign-off
- Per architecture-impacting change: mandatory same-change-set manual update and MCM row updates
