# FreedomCamp-Manager – Documentation Review Report

**Reviewed:** 2026-02-25  
**Reviewer:** Copilot Coding Agent  
**Scope:** All Markdown files in the repository root (90 files) + `docs/` directory (2 files)

---

## 1. Overview

The repository contains **92 Markdown files** spread across:

| Location | Count | Nature |
|----------|-------|--------|
| Repository root | 90 | Mix of AI-session runbooks, gap analyses, implementation guides, checklists, and architectural diagrams |
| `docs/architecture/` | 1 | Nearly empty placeholder (`# Architecture Documentation\nDetails about the system architecture.`) |
| `docs/` | 1 | `FEATURE_FLAGS.md` — well-structured rollout plan |

The vast majority of root-level files are **AI-generated session artifacts** created during development conversations rather than structured, maintained reference documentation. This has resulted in:

- No `README.md` at the repository root
- Near-empty `docs/` directory despite 90+ files at the root
- Multiple contradictory documents reflecting different development stages
- Outdated guides describing code that has since been deleted or renamed

---

## 2. Document Inventory by Category

### 2.1 Architecture & System Design

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `docs/architecture/README.md` | 3 | 🔴 Stub | 3-line placeholder only |
| `DATABASE_ARCHITECTURE.md` | — | 🟡 Partially stale | Good initial schema but predates the `observations` rebuild |
| `MULTI_ORGANIZATION_ACCESS_ARCHITECTURE.md` | 624 | 🟢 Current | 3-tier hierarchy (Iron Eagle → First Security → clients) well explained |
| `CANONICAL_VEHICLES_FLOW_MAP.md` | 873 | 🟡 Mixed | References both old UUID PK and new plate_number PK; proposal section still present |
| `CALCULATE_VEHICLE_COMPLIANCE_FLOW_MAP.md` | 637 | 🟡 Mixed | References `calculate_vehicle_compliance()` which has been superseded by `evaluate_compliance_v4` |
| `FIELD_OFFICER_PORTAL_COMPLETE_SYSTEM_MAP.md` | 1170 | 🟡 Mostly current | Comprehensive; some ALPR references remain after ALPR deletion |
| `FIELD_OFFICER_PORTAL_SYSTEM_MAP.md` | 567 | 🟡 Duplicate | Earlier/shorter version of the above; redundant |
| `FIELD_OFFICER_PORTAL_ALPR_FLOW_SCHEMATIC.md` | 426 | 🔴 Stale | Documents old ALPR flow that was intentionally deleted Feb 20 2026 |
| `FIELD_OFFICER_PORTAL_FRONTEND_ANALYSIS.md` | — | 🟡 Session note | Point-in-time analysis |
| `ORC_AI_ARCHITECTURE_BLUEPRINT.md` | 497 | 🟢 Current | Best architectural doc; vehicle fingerprinting design |
| `ORC_AI_SYSTEM_STATUS.md` | 229 | 🟡 Partially current | Status as of 2026-02-20; 60% complete |
| `MOBILE_APK_OFFLINE_ARCHITECTURE.md` | 1094 | 🟢 Useful | Detailed offline-first APK design; aligns with current direction |
| `MOBILE_APP_NEW_DATA_FLOW.md` | 370 | 🟡 Mixed | References `vehicle_observations_v2` as the "new" system; now superseded by `observations` |
| `MOBILE_APP_FIELD_MAPPINGS.md` | 581 | 🟢 Useful | DB CHECK constraint reference for mobile app; keep and maintain |
| `ONSPACE_AI_FALLBACK_MODE.md` | 484 | 🟡 Transitional | Documents the temporary fallback period; partially superseded |

### 2.2 Feature Flags & Rollout

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `docs/FEATURE_FLAGS.md` | 245 | 🟢 Best doc in repo | Well-structured; covers 6 phases, backout strategy, monitoring, API freeze commitment |

**Note:** `FEATURE_FLAGS.md` references `plate-scanner-photo-first` (a missing edge function per `CODE_REVIEW_REPORT.md`). Also references `plate-scanner-complete` as the legacy fallback, but that function was deleted per `ALPR_DELETION_COMPLETE.md`.

### 2.3 API & Integration Guides

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `API_SPEC_PHASE1.md` | — | 🟡 Partially current | Phase 1 API spec; frozen RPCs section is still valid |
| `MOTORWEB_INTEGRATION_GUIDE.md` | 288 | 🟢 Current | Architecture diagram, setup steps, env vars; well written |
| `NZSCV_INTEGRATION_GUIDE.md` | 335 | 🟢 Current | Step-by-step proxy setup; mentions DigitalOcean and Railway options |
| `STREAM_INTEGRATION_GUIDE.md` | 290 | 🟡 Mixed | Plate Recognizer Stream setup; references ALPR which was deleted |
| `EDGE_FUNCTION_CLIENT_PATTERNS.md` | — | 🟢 Useful | Best-practice patterns for calling edge functions from frontend |
| `EDGE_FUNCTION_MIGRATION_STATUS.md` | — | 🟡 Session note | Point-in-time migration status |
| `SUPABASE_CLIENT_BEST_PRACTICES.md` | — | 🟢 Useful | Coding standards; keep |
| `SUPABASE_SDK_MIGRATION_CHECKLIST.md` | — | 🟡 Completed | Migration is done; checklist is historical |
| `FILE_UPLOAD_INTEGRATION.md` | 373 | 🟢 Current | Storage buckets, server-side upload patterns; Feb 22 2026 |
| `ENFORCEMENT_COMMAND_CENTER_INTEGRATION.md` | 328 | 🟢 Current | Real-time dashboard; Feb 24 2026; ready for deployment |

### 2.4 Deployment & Operations

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `PRODUCTION_DEPLOYMENT.md` | — | 🟡 Session note | Point-in-time deployment steps |
| `PRODUCTION_READINESS_ASSESSMENT.md` | — | 🟡 Historical | Assessment from earlier phase |
| `DEPLOYMENT_READINESS_SUMMARY.md` | 343 | 🟡 Historical | Feb 13 2025 (note: date appears incorrect — likely 2026); earlier phase |
| `DEPLOYMENT_VALIDATION_CHECKLIST.md` | 339 | 🟡 Mixed | Validation steps for `vehicle-ingest`; references secrets that may have changed |
| `ORGANIZATION_MANAGEMENT_DEPLOYMENT_GUIDE.md` | 364 | 🟢 Actionable | Feb 18 2026; SQL migration order with timing estimates |
| `EDGE_FUNCTION_DEPLOYMENT_CHECKLIST.md` | 297 | 🟡 Mixed | References `recalculate-all-compliance` (not a current function name) |
| `LOCAL_TESTING_GUIDE.md` | 246 | 🟡 Partially stale | References `PLATE_RECOGNIZER_TOKEN` but ALPR was deleted |
| `DEPLOY_NOW.md` | 52 | 🔴 One-off command | Single `supabase db push` command; can be deleted |
| `LEGACY_IMPORT_RUNBOOK.md` | 601 | 🟢 Useful | Two-pass ETL for legacy data; well written and still relevant |
| `PHASE_1_DEPLOYMENT_GUIDE.md` | — | 🟡 Historical | Earlier deployment guide |
| `PHASE_2_INFERENCE_SERVICE_SETUP.md` | — | 🟡 Pending | Railway inference service not yet deployed |

### 2.5 Schema & Database

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `RLS_POLICY_DOCUMENTATION.md` | — | 🟢 Useful | RLS policies reference; keep and update |
| `STORAGE_RLS_SETUP.md` | — | 🟢 Useful | Storage bucket RLS policies |
| `SCHEMA_ALIGNMENT_FIXES_REQUIRED.md` | — | 🟡 Session note | Point-in-time fix list |
| `SCHEMA_MIGRATION_FIXES.md` | — | 🟡 Session note | Point-in-time migration fixes |
| `OBSERVATIONS_REBUILD_SUMMARY.md` | 287 | 🟢 Current | Explains why `vehicle_observations_v2` → `observations`; important context |
| `OBSERVATIONS_REPORT_DATA_FLOW.md` | 346 | 🔴 Contradictory | Claims data comes "100% from `vehicle_observations_v2`" but rebuild dropped that table |
| `PHOTO_INTEGRITY_MONITORING.md` | 388 | 🟢 Useful | SLO queries and monitoring SQL; well structured |
| `PHOTO_BACKFILL_GUIDE.md` | 336 | 🟢 Useful | Backfill runbook for photos missing hashes |
| `BREACH_ALERTS_SYSTEM_REBUILD.md` | 217 | 🟡 Historical | Describes the Feb 2026 rebuild; context doc |
| `BREACH_DETECTION_ANALYSIS.md` | 319 | 🟡 Historical | Gap analysis from earlier; issues since addressed |
| `PHASE_1_DATABASE_SETUP_COMPLETE.md` | 236 | 🟡 Historical | ORC/AI vector setup completion notes |
| `PHASE_1_COMPLETE.md` | 128 | 🟡 Historical | Duplicate of above with verification results |

### 2.6 Compliance & Legal

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `COMPLIANCE_REQUIREMENTS_VERIFICATION.md` | 321 | 🟢 Useful | Single source of truth for compliance checks; references `calculate_vehicle_compliance()` (now `evaluate_compliance_v4`) |
| `LEGAL_COMPLIANCE_IMPLEMENTATION.md` | 238 | 🟢 Current | GPS watermarking, Evidence Act compliance, legal tracking; Feb 2026 |
| `INCIDENT_EVIDENCE_IMPLEMENTATION_GUIDE.md` | 472 | 🟢 Current | HEIC/HEIF support, 30-day retention, legal holds; Feb 24 2026 |
| `AUDIT_RECOMMENDATIONS.md` | 358 | 🟡 Historical | Feb 11 2026 audit; most items show as completed |

### 2.7 ALPR / Plate Recognition

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `ALPR_DELETION_COMPLETE.md` | 194 | 🔴 Contradicted | Records that ALPR was deleted Feb 20 2026; but multiple other docs still reference ALPR |
| `PLATE_CAPTURE_ENHANCEMENTS_SUMMARY.md` | 287 | 🔴 Stale | Describes ALPR + OCR + manual fallback; ALPR deleted |
| `PLATE_CAPTURE_METHODS_REVIEW.md` | 516 | 🔴 Stale | Describes ALPR as "primary method"; ALPR deleted |
| `PLATE_SCANNER_INTEGRATION.md` | 125 | 🔴 Stale | References `PlateScanner.tsx` component and `observations_v2` |
| `PLATE_SCANNER_NEW_FUNCTIONS.md` | 395 | 🟡 Mixed | Created Feb 18 2026; predates ALPR deletion; `plate-scanner-photo-first` referenced (missing function) |
| `VEHICLE_SCANNING_WORKFLOW_STREAMLINED.md` | 475 | 🔴 Stale | Feb 11 2026; describes "ALPR-first architecture" — now deleted |
| `VEHICLE_PHOTO_AI_RECOGNITION.md` | 230 | 🟢 Current | OnSpace AI photo analysis; still active |
| `ZOOM_SCAN_COMPREHENSIVE_SCHEMATIC.md` | 1003 | 🟡 Historical | Feb 18 2026 schematic during debugging; ALPR still present |
| `ZOOM_SCAN_FIX_MANUAL_ENTRY.md` | 247 | 🟡 Historical | One-time fix note |
| `ZOOM_SCAN_PROCESS_FLOW.md` | 341 | 🟡 Historical | Process flow during ALPR era |
| `ZOOM_SCAN_RESTORED.md` | 158 | 🟡 Historical | Emergency restore note |

### 2.8 Organization & User Management

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `ORGANIZATION_USER_MANAGEMENT_VERIFICATION.md` | 700 | 🟡 Mixed | Feb 18 2026; "⚠️ PARTIAL IMPLEMENTATION" — some sections still pending |
| `ORGANIZATION_USER_MANAGEMENT_WORKFLOW.md` | 453 | 🟢 Useful | Clean reference for org hierarchy and user roles |
| `EMPLOYER_AND_AUTHORIZED_WORK_LOCATIONS.md` | 308 | 🟢 Current | `employer_organization_id` vs `authorized_work_locations` distinction |

### 2.9 Admin Portal & UX

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `ADMIN_PORTAL_GO_LIVE_CHECKLIST.md` | 393 | 🟢 Current | Feb 22 2026; stakeholder-ready status |
| `ADMIN_PORTAL_REBUILD_SUMMARY.md` | 486 | 🟢 Current | 5-tab hub architecture |
| `ADMIN_PORTAL_STREAMLINING_REVIEW.md` | 963 | 🟡 Historical | Feb 12 2026 consolidation analysis; now mostly completed |
| `ADMIN_PORTAL_TESTING_CHECKLIST.md` | 299 | 🟡 Historical | Testing checklist; shows ✅ All 5 Phases COMPLETE |
| `FIELD_OPERATIONS_ENHANCEMENTS.md` | 975 | 🟡 Historical | Feb 12 2026; "implementation ready" |
| `ENFORCEMENT_COMMAND_CENTER_INTEGRATION.md` | 328 | 🟢 Current | Feb 24 2026 dashboard |
| `UX_AESTHETIC_COMPREHENSIVE_REVIEW.md` | 813 | 🟡 Jan 2026 | Useful scores and recommendations; 8.5/10 UX; some gaps since addressed |
| `FRONTEND_UI_AUDIT_REPORT.md` | 647 | 🟡 Feb 15 2026 | 8/10 alignment; 2 critical gaps (offline queue UI, GPS watermark visibility) |
| `BEGINNER_USER_MANUAL.md` | 985 | 🟡 Mixed | Jan 2026; content is accurate but covers web app as if it is a mobile app; `OnSpace` is the mobile platform |

### 2.10 Reporting & Compliance Analytics

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `REPORTING_WORKFLOW_STREAMLINED.md` | 602 | 🟡 Feb 11 2026 | Mostly still relevant; person records system and alert queue design |
| `REPORTS_CENTRALIZED_COMPLIANCE_UPDATE.md` | 353 | 🟡 Historical | Fix note; already applied |
| `COMPLIANCE_REPORTING_FIX.md` | 222 | 🟡 Historical | Bug fix record; applied |
| `AUTOMATIC_RECALCULATION_IMPLEMENTATION.md` | 622 | 🟢 Useful | Design doc for automatic recalculation; still relevant |
| `HOW_TO_TRIGGER_RECALCULATION.md` | 236 | 🟢 Useful | End-user guide for triggering compliance recalculation |

### 2.11 Gap / Sales Analysis

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `SALES_VS_REALITY_GAP_ANALYSIS.md` | 451 | 🟡 Feb 15 2026 | 6/10 features fully delivered; 2 critical gaps (GPS watermarking, offline mode) |
| `MARKETING_CLAIMS_AUDIT_REPORT.md` | 276 | 🟡 Feb 15 2026 | Same findings; parallel doc to above; consider merging |
| `HOMELESS_DATA_CONSOLIDATION_PLAN.md` | 375 | 🟢 Useful | Data fragmentation analysis; still relevant |

### 2.12 Phase Completion / Status Reports

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `PHASE_1_COMPLETE.md` | 128 | 🔴 Archive | Completion notes for ORC/AI vector setup |
| `PHASE_1_DATABASE_SETUP_COMPLETE.md` | 236 | 🔴 Archive | Duplicate above |
| `PHASE_4_ADMIN_PORTAL_TESTING_REPORT.md` | 949 | 🔴 Archive | Feb 13 2025 (date typo — likely 2026) |
| `PHASE_4_TESTING_REPORT.md` | 383 | 🔴 Archive | Parallel to above |
| `REBUILD_MASTER_PLAN.md` | — | 🔴 Archive | Master plan from earlier rebuild |
| `REBUILD_PLAN.md` | — | 🔴 Archive | Earlier rebuild plan; superseded |
| `UPDATE_PLAN.md` | — | 🔴 Archive | |
| `COMPREHENSIVE_FIXES_SUMMARY.md` | 298 | 🔴 Archive | One-time fixes |
| `FIXES_APPLIED_CLEANLY.md` | 165 | 🔴 Archive | One-time fixes |

### 2.13 Debugging / Incident Notes

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `DEBUG_RECALCULATION.md` | 203 | 🔴 Archive | Debugging guide for an already-resolved issue |
| `INVESTIGATION_MISSING_COMPLIANCE_RESULTS.md` | 446 | 🔴 Archive | Root cause analysis for resolved bug |
| `DIAGNOSTIC_REPORT.md` | 62 | 🔴 Archive | One-session diagnostic |
| `DEEP_DIVE_DIAGNOSTIC_REPORT.md` | 409 | 🔴 Archive | Feb 18 2026 pre-trial diagnostic |
| `FIXING_401_AUTH_ERROR.md` | 340 | 🔴 Archive | 401 fix; applied Feb 24 2026 |
| `CORS_PREVIEW_FIX.md` | 203 | 🔴 Archive | CORS fix; applied Feb 22 2026 |
| `BLOCKER_FIXES_PATROLS_CORS.md` | 289 | 🔴 Archive | Blocker fix record |
| `CRITICAL_FIXES_MAIDEN_FLIGHT.md` | 242 | 🔴 Archive | Emergency deployment notes Feb 24 2026 |
| `DUAL_ROLE_AND_COMPLIANCE_FIX_SUMMARY.md` | 268 | 🟡 Useful context | `is_exempt`/`exemption_reason` additions; still relevant |
| `LIVE_TRACKING_TROUBLESHOOTING.md` | 172 | 🔴 Archive | Specific user debug (`squires.don@live.com`) |

### 2.14 Readiness Checklists

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `CLIENT_TRIAL_READINESS_CHECKLIST.md` | 382 | 🟢 Current | Feb 18 2026; ✅ READY status; well maintained |
| `DEPLOYMENT_VALIDATION_CHECKLIST.md` | 339 | 🟡 Mixed | `vehicle-ingest` deployment; references may be stale |
| `ADMIN_PORTAL_TESTING_CHECKLIST.md` | 299 | 🟡 Historical | All phases complete |

---

## 3. Cross-Cutting Issues

### 3.1 🔴 Contradictory documents — ALPR

`ALPR_DELETION_COMPLETE.md` (Feb 20 2026) records the complete deletion of ALPR. Yet the following documents still describe ALPR as active:

- `PLATE_CAPTURE_METHODS_REVIEW.md` — calls ALPR the "Primary Method"
- `VEHICLE_SCANNING_WORKFLOW_STREAMLINED.md` — titled "ALPR-FIRST ARCHITECTURE"
- `PLATE_SCANNER_NEW_FUNCTIONS.md` — "brand new edge functions" for ALPR workflow
- `STREAM_INTEGRATION_GUIDE.md` — Plate Recognizer Stream setup
- `ZOOM_SCAN_COMPREHENSIVE_SCHEMATIC.md` — entire doc documents ALPR-based zoom scan
- `LOCAL_TESTING_GUIDE.md` — asks developer to set `PLATE_RECOGNIZER_TOKEN`
- `FIELD_OFFICER_PORTAL_ALPR_FLOW_SCHEMATIC.md` — entirely about deleted ALPR flow

**Recommendation:** Prefix these files with `_ARCHIVED_` or move them to `docs/archive/` to prevent confusion.

### 3.2 🔴 Contradictory documents — `vehicle_observations_v2` vs `observations`

`OBSERVATIONS_REBUILD_SUMMARY.md` explains the migration from `vehicle_observations_v2` to the new `observations` table. But:

- `OBSERVATIONS_REPORT_DATA_FLOW.md` still says data comes "100% from `vehicle_observations_v2`"
- `MOBILE_APP_NEW_DATA_FLOW.md` introduces `vehicle_observations_v2` as the "New System"
- `PHASE_1_DATABASE_SETUP_COMPLETE.md` adds embedding columns to `vehicle_observations_v2`

### 3.3 🔴 Missing `README.md` at repository root

There is no `README.md`. Any developer cloning the repo has no entry point. Given the 90+ docs at the root, a navigation README is essential.

### 3.4 🟡 `docs/architecture/README.md` is a 3-line stub

The `docs/` directory was presumably created to host structured documentation, but it contains only a stub and one good file (`FEATURE_FLAGS.md`).

### 3.5 🟡 Date inconsistencies

- `DEPLOYMENT_READINESS_SUMMARY.md` and `PHASE_4_TESTING_REPORT.md` are dated "February 13, **2025**" — likely a typo for 2026. All other docs in this period use 2026.
- Several docs have no date at all.

### 3.6 🟡 Version numbers used inconsistently

Docs reference versions like `v2.13.0016`, `2.8.0004`, `5.1.1` with no shared versioning scheme.

### 3.7 🟡 `BEGINNER_USER_MANUAL.md` conflates web and mobile

The manual describes field staff using "the app on your mobile device" but the codebase is a React web app. OnSpace is the mobile platform. The manual should clarify: "This web application runs on any browser, including mobile browsers. For the native mobile app, see OnSpace."

### 3.8 🟡 `SALES_VS_REALITY_GAP_ANALYSIS.md` and `MARKETING_CLAIMS_AUDIT_REPORT.md` are near-duplicates

Both are dated Feb 15 2026, both say 6/10 features delivered, both identify the same 2 critical gaps. They should be merged into one authoritative document.

### 3.9 🟡 `FEATURE_FLAGS.md` references missing edge functions

`docs/FEATURE_FLAGS.md` references:
- `plate-scanner-photo-first` — **missing** from `supabase/functions/`
- `plate-scanner-complete` — **deleted** per `ALPR_DELETION_COMPLETE.md`

---

## 4. Documents Worth Keeping (Current & Accurate)

These documents are well-written, current, and should be retained and promoted into `docs/`:

| File | Suggested destination |
|------|-----------------------|
| `docs/FEATURE_FLAGS.md` | ✅ Already in `docs/`; update missing function references |
| `MOTORWEB_INTEGRATION_GUIDE.md` | `docs/integrations/motorweb.md` |
| `NZSCV_INTEGRATION_GUIDE.md` | `docs/integrations/nzscv.md` |
| `FILE_UPLOAD_INTEGRATION.md` | `docs/integrations/file-upload.md` |
| `MOBILE_APP_FIELD_MAPPINGS.md` | `docs/mobile/field-mappings.md` |
| `MOBILE_APK_OFFLINE_ARCHITECTURE.md` | `docs/mobile/offline-architecture.md` |
| `ORC_AI_ARCHITECTURE_BLUEPRINT.md` | `docs/architecture/orc-ai.md` |
| `MULTI_ORGANIZATION_ACCESS_ARCHITECTURE.md` | `docs/architecture/multi-org.md` |
| `LEGAL_COMPLIANCE_IMPLEMENTATION.md` | `docs/compliance/legal-compliance.md` |
| `COMPLIANCE_REQUIREMENTS_VERIFICATION.md` | `docs/compliance/requirements.md` |
| `INCIDENT_EVIDENCE_IMPLEMENTATION_GUIDE.md` | `docs/compliance/incident-evidence.md` |
| `LEGACY_IMPORT_RUNBOOK.md` | `docs/operations/legacy-import.md` |
| `HOW_TO_TRIGGER_RECALCULATION.md` | `docs/operations/recalculation.md` |
| `PHOTO_INTEGRITY_MONITORING.md` | `docs/operations/photo-integrity.md` |
| `PHOTO_BACKFILL_GUIDE.md` | `docs/operations/photo-backfill.md` |
| `RLS_POLICY_DOCUMENTATION.md` | `docs/database/rls-policies.md` |
| `STORAGE_RLS_SETUP.md` | `docs/database/storage-rls.md` |
| `SUPABASE_CLIENT_BEST_PRACTICES.md` | `docs/development/supabase-patterns.md` |
| `EDGE_FUNCTION_CLIENT_PATTERNS.md` | `docs/development/edge-function-patterns.md` |
| `EMPLOYER_AND_AUTHORIZED_WORK_LOCATIONS.md` | `docs/architecture/org-access.md` |
| `HOMELESS_DATA_CONSOLIDATION_PLAN.md` | `docs/database/homeless-data.md` |
| `BEGINNER_USER_MANUAL.md` | `docs/user-guides/field-officer.md` (after update) |
| `ORGANIZATION_USER_MANAGEMENT_WORKFLOW.md` | `docs/user-guides/org-management.md` |
| `AUTOMATIC_RECALCULATION_IMPLEMENTATION.md` | `docs/architecture/compliance-pipeline.md` |

---

## 5. Documents to Archive or Delete

These are one-time session artifacts, resolved bug reports, or superseded plans that add noise:

**Recommend moving to `docs/archive/` or deleting:**

- All `PHASE_*_COMPLETE.md`, `PHASE_*_TESTING_REPORT.md` (4 files)
- All `*_FIXES_*.md`, `DEBUG_*.md`, `DIAGNOSTIC_*.md`, `FIXING_*.md`, `BLOCKER_*.md`, `CORS_*.md` (13 files)
- `REBUILD_MASTER_PLAN.md`, `REBUILD_PLAN.md`, `UPDATE_PLAN.md`
- `DEPLOY_NOW.md` (single command; now irrelevant)
- `ALPR_DELETION_COMPLETE.md` (already deleted; record in git history)
- Duplicate `PLATE_*`, `ZOOM_SCAN_*` ALPR docs (7 files)
- `SALES_VS_REALITY_GAP_ANALYSIS.md` — merge with `MARKETING_CLAIMS_AUDIT_REPORT.md` into one
- `FIELD_OFFICER_PORTAL_ALPR_FLOW_SCHEMATIC.md` (documents deleted system)
- `OBSERVATIONS_REPORT_DATA_FLOW.md` (contradicts current schema)
- `VEHICLE_SCANNING_WORKFLOW_STREAMLINED.md` (ALPR-first, now deleted)

---

## 6. Priority Recommendations

### High priority

1. **Add `README.md` to repo root** with a brief description of the project, how to run it locally, and a map to the key docs in `docs/`.

2. **Expand `docs/architecture/README.md`** from its 3-line stub into a real system overview covering: tech stack, 4-layer compliance pipeline, storage buckets, multi-org hierarchy, and edge function categories.

3. **Update `docs/FEATURE_FLAGS.md`** to replace the two missing/deleted edge function references (`plate-scanner-photo-first`, `plate-scanner-complete`) with the correct current functions.

4. **Add an `_ARCHIVED` prefix or `docs/archive/` folder** for the ~30 session-log documents. Keeping them in root next to real reference docs makes it hard to find authoritative information.

5. **Resolve the `observations` vs `vehicle_observations_v2` narrative conflict** by updating `OBSERVATIONS_REPORT_DATA_FLOW.md` and `MOBILE_APP_NEW_DATA_FLOW.md` to reflect that `vehicle_observations_v2` was replaced by `observations`.

### Medium priority

6. **Correct the date typo** in `DEPLOYMENT_READINESS_SUMMARY.md` and `PHASE_4_TESTING_REPORT.md` from 2025 → 2026.

7. **Merge** `SALES_VS_REALITY_GAP_ANALYSIS.md` and `MARKETING_CLAIMS_AUDIT_REPORT.md` into a single `docs/PRODUCT_GAPS.md`.

8. **Update `BEGINNER_USER_MANUAL.md`** to clarify that FreedomCamp Manager is a web application accessed via browser (on desktop or mobile), and that OnSpace is the separate native mobile app that calls the same Supabase backend.

9. **Move the 20+ "keep" docs** listed in Section 4 into a structured `docs/` tree.

### Low priority

10. Standardize version numbering (currently ad hoc across docs).
11. Add a "Last Verified" date to all reference docs so staleness is immediately obvious.
