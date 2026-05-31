# Instruction Manual Subsection QA/PM Audit

Date: 2026-05-31
Manual baseline: docs/INSTRUCTION_MANUAL.md
Audit type: Section-by-section QA and PM readiness scoring

## Method

This audit scores manual subsections against:
1. Declared product behavior in docs/INSTRUCTION_MANUAL.md
2. Route and role contracts in src/navigation/routeManifest.ts and src/App.tsx
3. Page/module availability in src/pages
4. Runtime pipeline checks performed on live data

Scoring:
- PASS: Implemented and evidenced
- PARTIAL: Implemented but not fully evidenced, gated, or drift-prone
- GAP: Missing or contradictory to manual

## Live Runtime Snapshot Used

- observations.processing_status pending: 0
- observations.processing_status processing: 0
- observations.processing_status completed: 246
- observations.processing_status failed: 64148

Operational note:
- Backlog was cleared by classifying no-photo pending records as failed with explicit reason backlog_cleared_no_actual_photo_url.
- This is queue hygiene, not evidence of model failure quality.

## Subsection Scorecard

| Manual Subsection | Expected Outcome | Evidence | Status | QA Test ID | PM Owner | Next Action |
|---|---|---|---|---|---|---|
| 1 Introduction and Overview | Multi-service command center with role segmentation | src/pages inventory and route manifest role model | PASS | MAN-1-001 | Product | Keep as baseline section |
| 1a UI/UX Design Standards | Shell model and page anatomy consistently applied | docs standards exist, no automated conformance gate found | PARTIAL | MAN-1A-001 | UX + FE | Add visual checklist and snapshot gate |
| 1b Rollout Governance | Manual, staging, and checkpoint coupling | docs contain governance gates and templates | PARTIAL | MAN-1B-001 | PMO | Add release evidence trace map |
| 2.1 Signing In | Deterministic login and role landing | src/App.tsx login and routing flow present | PASS | MAN-2-001 | Auth | Add smoke test log per release |
| 2.2 Session Lock and Inactivity | Feature-flagged lock behavior | manual documents env-dependent behavior, code hooks exist | PARTIAL | MAN-2-002 | Auth | Capture environment matrix evidence |
| 2.3 Portal Selection | Admin officer role split portal entry | route manifest has portal-selection role-gated path | PASS | MAN-2-003 | Platform | Keep acceptance test in CI |
| 2.3a Phase 1 Director Gate | Roster gate and welfare standby behavior | manual behavior documented, middleware hooks present | PARTIAL | MAN-2-004 | Field Ops | Add E2E with roster/no-roster fixtures |
| 2.3c Phase 3 Sentient XO | Bob memory and governance behavior | Bob routes/pages and governance docs exist | PARTIAL | MAN-2-005 | AI PM | Add explicit acceptance scripts |
| 2.3d Phase 4 Admiral Bridge | Welfare/enforcement escalation behavior | section exists with checkpoint evidence in manual | PARTIAL | MAN-2-006 | Compliance PM | Re-validate against current build |
| 2.4 Navigation Overview | Stable nav behavior by role | routeManifest drives role route visibility | PASS | MAN-2-007 | Platform | Export role route matrix periodically |
| 3.1 Grand Master | Full cross-org owner control and platform page | role exists, platform and owner tools routes/pages present | PARTIAL | MAN-3-001 | Owner Ops | Run owner UAT script and sign-off |
| 3.2 Master | Full org plus child org control | role exists with master-only modules listed in manual | PARTIAL | MAN-3-002 | Service Provider PM | Validate child-org context switching |
| 4.1 Administrator | End-to-end admin workflows for operations/compliance | extensive admin pages exist and route coverage is broad | PARTIAL | MAN-4-001 | Ops PM | Perform task-path validation pack |
| 4.2 Admin Officer Dual Role | Combined supervisor and field pathway | admin_officer role present; portal-selection path exists | PARTIAL | MAN-4-002 | Ops PM | Validate dual-context transitions |
| 4.3 NZSCV Monitor | NZSCV-only monitoring scope | nzscv_monitor role in manifest and NZSCV page exists | PARTIAL | MAN-4-003 | Compliance Lead | Add least-privilege access proof |
| 5 General Officer Features | Welfare, GPS, PTT, offline queue, post-shift flow | field and specialist portals exist, PTT routes exist | PARTIAL | MAN-5-000 | Field Product | Add mobile evidence suite |
| 5.1 Freedom Camping Officer | Patrol scan and enforcement workflow | FieldOfficerPortal and related pages/routes present | PARTIAL | MAN-5-101 | Field Product | Validate legal doc flow end-to-end |
| 5.2 Site Guard Officer | Guarding workflow and checkpoint features | SiteGuardPortal and related logs/pages present | PARTIAL | MAN-5-201 | Guarding PM | Add site guard scenario tests |
| 5.3 Parking Officer | Parking enforcement workflow | ParkingOfficerPortal and parking logs/pages present | PARTIAL | MAN-5-301 | Parking PM | Verify chalk and permit lifecycle |
| 5.4 Noise Officer | Noise notices and seizure flow | NoiseOfficerPortal and NoiseControlPortal exist | PARTIAL | MAN-5-401 | Noise PM | Add legal notice form validation |
| 5.5 Biosecurity Officer | Biosecurity assessment and escalation | BiosecurityOfficerPortal and control pages exist | PARTIAL | MAN-5-501 | Biosecurity PM | Validate AI assist outcomes |
| 5.6 Smoke Officer | OOH smoke complaint workflow | SmokeComplaintOfficerPortal and control pages exist | PARTIAL | MAN-5-601 | Smoke PM | Validate six-step scene flow |
| 5.7 EMS Officer | EMS monitoring and alert queue flow | EMSPortal and EMS logs/pages exist | PARTIAL | MAN-5-701 | EMS PM | Add roster and tamper E2E |
| 6.1 Client Viewer | Read-only client transparency portal | ClientOrganisationPortal and client pages exist | PARTIAL | MAN-6-101 | Client PM | Add read-only role proof |
| 6.2 Client Officer | Client incident logging extension | client_officer role present and incident surfaces exist | PARTIAL | MAN-6-201 | Client PM | Validate submit permissions |
| 6.3 Client Admin | Client admin + limited management rights | client_admin role and related pages exist | PARTIAL | MAN-6-301 | Client PM | Validate finance/report policy gates |
| 7.1 Public Dispute Portal | Public dispute intake and lifecycle handoff | PublicDisputePortal route/page exists | PARTIAL | MAN-7-101 | Public PM | Validate anonymous submission lifecycle |
| 7.2 Public Prepayment Portal | Public pay-by-plate isolated flow | PublicPayByPlate route/page exists | PARTIAL | MAN-7-201 | Public PM | Validate payment and isolation controls |
| 8.1 Architecture | Stack and service topology alignment | codebase matches stack categories | PARTIAL | MAN-8-101 | Architecture | Update package-manager wording drift |
| 8.2 Environment Setup | Accurate setup commands and env vars | setup docs present; mixed package manager usage in repo | PARTIAL | MAN-8-201 | DevEx | Publish canonical setup matrix |
| 8.3 Database and Migrations | Reliable schema and migration behavior | migrations present; helper RPC restored and verified callable in live environment (migration 20260531121500 applied) | PASS | MAN-8-301 | DBA | Closed 2026-05-31 after live RPC verification |
| 8.4 Edge Functions | Core function contracts wired | core functions present and reachable by probe | PASS | MAN-8-401 | Backend | Maintain contract tests |
| 8.5 AI Services Bob/Inference | Stable AI pipelines and governance | endpoint probes pass; local ONNX degraded in Alpine; edge path works | PARTIAL | MAN-8-501 | AI Platform | Keep edge-first fallback documented |
| 8.6 PTT | PTT components and access gating behavior | PTT pages/routes present and manual reflects gating | PARTIAL | MAN-8-601 | Realtime PM | Run channel-assignment UAT sweep |
| 8.7 Diagnostics and Health | Diagnostics visibility and checks | diagnostics routes/docs present | PARTIAL | MAN-8-701 | SRE | Add live endpoint health report evidence |
| 8.8 Provisioning | Correct tenancy/role provisioning behavior | role model and org pages exist | PARTIAL | MAN-8-801 | IAM PM | Add provisioning verification scripts |
| 8.9 Data Integrity and Cleanup | Recalc and photo reingest safety | reingest and cleanup paths used live; backlog cleanup executed | PASS | MAN-8-901 | Data Ops | Add routine cleanup reporting categories |
| 8.10 Security and Compliance | Auth, audit, RLS, retention controls | sections exist, partial runtime evidence | PARTIAL | MAN-8-1001 | Security | Add quarterly controls audit export |
| Appendix A | Enforcement document legal map | appendix exists with legal bases | PASS | MAN-A-001 | Compliance | Validate legal references annually |
| Appendix B | Role access matrix | matrix exists; needs generated parity check | PARTIAL | MAN-B-001 | Platform | Generate manifest-to-manual diff report |
| Appendix C | Troubleshooting | practical cases documented | PASS | MAN-C-001 | Support | Keep incidents feeding this appendix |
| Appendix D | CRO todo alignment | CRO appendix links to dedicated plan | PARTIAL | MAN-D-001 | Growth PM | Map items to release backlog |
| Appendix E | QA bug-fix ledger | checklist included and marked complete | PARTIAL | MAN-E-001 | QA Lead | Re-verify completed bugs on latest branch |

## Executive Summary

- PASS: 9 subsections
- PARTIAL: 31 subsections
- GAP: 0 subsections

Primary blocker:
- No P0 blocker currently open from this audit pass.

## Priority Action Queue (PM)

1. P1: Build a generated role-access parity report from route manifest to manual Appendix B.
2. P1: Create evidence packs for role families (Owner, Service Provider, Field, Client, Public) with reproducible UAT scripts.
3. P2: Add UI standards conformance suite for section 1a (page anatomy, status strips, primary action rules).
4. P2: Separate operational cleanup-failed queue rows from true inference failure reporting in dashboards.

## Release Gate Recommendation

Mark manual parity as amber due to remaining PARTIAL subsections, but MAN-8-301 is now closed and verified.
