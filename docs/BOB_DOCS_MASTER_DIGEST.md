# Bob Documentation Master Digest

Date: 2026-05-28
Scope: Full Bob documentation inventory and segment map.

## Coverage Summary

- Total Bob-related docs indexed: 124
- Inventory source: repository files matching Bob naming patterns, excluding vendor/build folders.

## How Bob and the Instruction Manual Work in Unison

Bob and the Instruction Manual operate as a single control system:

1. Product truth starts in the Instruction Manual.
2. Bob execution must stay inside that product truth, plus runtime/safety contracts.
3. If runtime behavior changes, documentation is updated in the same change set.
4. If documentation and runtime disagree, that drift is treated as a defect or a governed product decision.

### Source-of-Truth Roles

1. Instruction Manual defines intended product behavior, role flows, and user-facing outcomes.
2. Bob runtime/governance docs define safe execution boundaries, approval gates, and evidence requirements.
3. Staging and readiness docs record current validation state and open gaps.

### Operational Loop

1. Manual defines what should happen.
2. Bob executes, validates, and reports against that expectation.
3. Evidence artifacts and tests confirm pass/fail status.
4. Any mismatch triggers remediation or documented policy update.

### Read Order for Unified Operation

1. docs/INSTRUCTION_MANUAL.md
2. docs/BOB_MASTER_RUNTIME_TRUTH.md
3. docs/BOB_SAFE_RUNTIME_CONTRACT.md
4. BOB_INSTRUCTIONS.md
5. docs/BOB_SYSTEM_ROUTE_MAP.md
6. docs/STAGING.md

### Change-Control Rule

For architecture-impacting, workflow-impacting, role-impacting, or route-impacting changes:

1. Update code.
2. Update the Instruction Manual.
3. Update Bob governance/staging evidence docs.
4. Validate with build/tests and capture evidence artifacts.

## Start Here (Role-Based)

### Operators

1. [docs/BOB_MASTER_RUNTIME_TRUTH.md](docs/BOB_MASTER_RUNTIME_TRUTH.md)
2. [docs/BOB_SAFE_RUNTIME_CONTRACT.md](docs/BOB_SAFE_RUNTIME_CONTRACT.md)
3. [BOB_INSTRUCTIONS.md](BOB_INSTRUCTIONS.md)
4. [docs/BOB_OPERATIONS_ONE_PAGE_SUMMARY_2026-05-26.md](docs/BOB_OPERATIONS_ONE_PAGE_SUMMARY_2026-05-26.md)

### Engineers

1. [docs/BOB_SESSION_READ_ORDER_PLAYBOOK.md](docs/BOB_SESSION_READ_ORDER_PLAYBOOK.md)
2. [docs/BOB_SYSTEM_ROUTE_MAP.md](docs/BOB_SYSTEM_ROUTE_MAP.md)
3. [docs/BOB_ENV_REFERENCE.md](docs/BOB_ENV_REFERENCE.md)
4. [docs/BOB_RUNTIME_CONTEXT_FOLLOWUP_2026-05-22.md](docs/BOB_RUNTIME_CONTEXT_FOLLOWUP_2026-05-22.md)
5. [docs/BOB_E2E_VALIDATION_AND_REMEDIATION.md](docs/BOB_E2E_VALIDATION_AND_REMEDIATION.md)

### PM and Governance Reviewers

1. [docs/INSTRUCTION_MANUAL.md](docs/INSTRUCTION_MANUAL.md)
2. [docs/BOB_PM_READINESS_GATE_2026-05-18.md](docs/BOB_PM_READINESS_GATE_2026-05-18.md)
3. [docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md](docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md)
4. [docs/BOB_RESTRICTION_SHEET.md](docs/BOB_RESTRICTION_SHEET.md)
5. [tools/bob-pm-evidence/latest/bob-pm-evidence.md](tools/bob-pm-evidence/latest/bob-pm-evidence.md)

## Segment Definitions

- Runtime and deployment
- Governance and safety
- Training and capability
- Validation and remediation
- Architecture and workflow
- Data and intelligence
- Other

## Segment Counts

| Segment | Files | Total Lines |
|---|---:|---:|
| Runtime and deployment | 13 | 3011 |
| Governance and safety | 11 | 390781 |
| Training and capability | 33 | 8956 |
| Validation and remediation | 12 | 2763 |
| Architecture and workflow | 10 | 1930 |
| Data and intelligence | 7 | 820 |
| Other | 39 | 3517 |

## Full Inventory

| Path | Lines | First H1 |
|---|---:|---|
| [BOBS_COMPLETE_REMEDIATION_SYSTEM.md](BOBS_COMPLETE_REMEDIATION_SYSTEM.md) | 552 | Bob's Autonomous Remediation System: Complete Integration Guide |
| [BOBS_REMEDIATION_SYSTEM_LIVE.md](BOBS_REMEDIATION_SYSTEM_LIVE.md) | 393 | ✅ Bob's Autonomous Remediation System: LIVE |
| [BOB_ANALYSIS_SESSION.md](BOB_ANALYSIS_SESSION.md) | 325 | Bob Analysis Session: Ollama Fallback Issue |
| [BOB_COPILOT_TRAINING_INTEGRATION.md](BOB_COPILOT_TRAINING_INTEGRATION.md) | 483 | Bob + Copilot Integrated AI Training Guide |
| [BOB_INFERENCE_SECRET_CONFIGURATION.md](BOB_INFERENCE_SECRET_CONFIGURATION.md) | 174 | Bob Inference Service - Supabase Secret Configuration |
| [BOB_INSTRUCTIONS.md](BOB_INSTRUCTIONS.md) | 1031 | BOB_INSTRUCTIONS.md — FieldOps Manager Agentic SOP |
| [BOB_INTEGRATION_QUICKSTART.md](BOB_INTEGRATION_QUICKSTART.md) | 542 | Bob RunPod Integration — Unified Setup Guide |
| [BOB_JOINT_DIAGNOSIS.md](BOB_JOINT_DIAGNOSIS.md) | 313 | Bob + Human Joint Diagnosis & Fix Plan |
| [BOB_SANDBOX_SYSTEM_READY.md](BOB_SANDBOX_SYSTEM_READY.md) | 367 | 🎓 Bob's Sandbox Emulator — Training System Complete ✅ |
| [BOB_SANDBOX_TRAINING_INDEX.md](BOB_SANDBOX_TRAINING_INDEX.md) | 411 | Bob's Sandbox Emulator — Complete Training Index |
| [BOB_SANDBOX_TUTORING_QUICKSTART.md](BOB_SANDBOX_TUTORING_QUICKSTART.md) | 300 | 🎓 Bob's Sandbox Emulator — Tutoring Session Initialized |
| [BOB_SESSION_SUMMARY_20260430.md](BOB_SESSION_SUMMARY_20260430.md) | 269 | Bob Implementation Session Summary |
| [BOB_SETUP_COMPLETE.md](BOB_SETUP_COMPLETE.md) | 431 | 🚀 Bob + RunPod + Copilot Training — Complete Integration |
| [BOB_UNIFIED_IMPLEMENTATION_PLAN.md](BOB_UNIFIED_IMPLEMENTATION_PLAN.md) | 480 | Bob Unified Implementation Plan |
| [BOB_WORKFLOW_RULES.md](BOB_WORKFLOW_RULES.md) | 162 | BOB Workflow Rules |
| [docs/ACCESS_NAV_BOB_EXECUTION_PLAN.md](docs/ACCESS_NAV_BOB_EXECUTION_PLAN.md) | 248 | Access/Nav Redesign Execution Plan (Bob-Assisted) |
| [docs/ACCESS_NAV_BOB_REVIEW_AND_HUMAN_TEST.md](docs/ACCESS_NAV_BOB_REVIEW_AND_HUMAN_TEST.md) | 209 | Access/Nav Bob Review And Human Test |
| [docs/BOB_ACCESS_CONTROL_AND_PRIVILEGES_IMPLEMENTATION_2026-05-22.md](docs/BOB_ACCESS_CONTROL_AND_PRIVILEGES_IMPLEMENTATION_2026-05-22.md) | 83 | Bob Access Control and Privileges Implementation (2026-05-22) |
| [docs/BOB_ANDROID_DEPLOYMENT_GUIDE.md](docs/BOB_ANDROID_DEPLOYMENT_GUIDE.md) | 492 | Bob Service Test Suite & Android Deployment Guide |
| [docs/BOB_APPROVAL_PATHS_PHASE_B.md](docs/BOB_APPROVAL_PATHS_PHASE_B.md) | 112 | Bob Approval Paths — Phase B |
| [docs/BOB_APP_DATA_ENRICHMENT_CONSUMPTION_PLAYBOOK.md](docs/BOB_APP_DATA_ENRICHMENT_CONSUMPTION_PLAYBOOK.md) | 88 | Bob App Data Enrichment Consumption Playbook |
| [docs/BOB_AUTOMATED_PROMOTION_RUNBOOK.md](docs/BOB_AUTOMATED_PROMOTION_RUNBOOK.md) | 81 | Bob Automated Promotion Runbook |
| [docs/BOB_AUTONOMOUS_E2E_TESTING.md](docs/BOB_AUTONOMOUS_E2E_TESTING.md) | 309 | Bob Autonomous E2E Testing |
| [docs/BOB_AUTONOMOUS_LEARNING.md](docs/BOB_AUTONOMOUS_LEARNING.md) | 87 | Bob Autonomous Learning |
| [docs/BOB_BRAIN_DUMP.md](docs/BOB_BRAIN_DUMP.md) | 390036 | PROJECT TRUTH SOURCE |
| [docs/BOB_BUILD_ORCHESTRATOR_CHECKLIST.md](docs/BOB_BUILD_ORCHESTRATOR_CHECKLIST.md) | 49 | Bob Build Orchestrator Checklist |
| [docs/BOB_CANONICAL_VS_STALE_MATRIX_2026-05-26.md](docs/BOB_CANONICAL_VS_STALE_MATRIX_2026-05-26.md) | 52 | Bob Canonical vs Stale Matrix |
| [docs/BOB_CLIENT_SITE_ZONE_RESEARCH_PLAYBOOK.md](docs/BOB_CLIENT_SITE_ZONE_RESEARCH_PLAYBOOK.md) | 96 | Bob Client, Site, Zone, and Organization Research Playbook |
| [docs/BOB_CODESPACE_AI_MODE.md](docs/BOB_CODESPACE_AI_MODE.md) | 102 | Bob Codespace AI Mode |
| [docs/BOB_CODING_LOGIC_TRAINING.md](docs/BOB_CODING_LOGIC_TRAINING.md) | 763 | Bob Coding Logic Training — Deep AI Reasoning Framework |
| [docs/BOB_COLLABORATION_BRIDGE.md](docs/BOB_COLLABORATION_BRIDGE.md) | 79 | Bob Collaboration Bridge |
| [docs/BOB_COLLABORATION_SETUP.md](docs/BOB_COLLABORATION_SETUP.md) | 93 | Bob Collaboration Bridge |
| [docs/BOB_CONFIGURATION.md](docs/BOB_CONFIGURATION.md) | 46 | Bob Configuration (Egress Enabled) |
| [docs/BOB_COPILOT_SELF_HEAL_BRIDGE.md](docs/BOB_COPILOT_SELF_HEAL_BRIDGE.md) | 52 | Bob Copilot Self-Heal Bridge |
| [docs/BOB_COPILOT_TUTOR_ASSIGNMENTS.md](docs/BOB_COPILOT_TUTOR_ASSIGNMENTS.md) | 242 | Bob — Copilot Tutor Assignment Prompts |
| [docs/BOB_DATASET_MANIFEST_2026-05-18.md](docs/BOB_DATASET_MANIFEST_2026-05-18.md) | 63 | Bob Dataset Manifest |
| [docs/BOB_DATA_LABELING_RUNBOOK_2026-05-18.md](docs/BOB_DATA_LABELING_RUNBOOK_2026-05-18.md) | 166 | Bob Data Labeling Runbook |
| [docs/BOB_DEPUTY_STATIC_GUARD_IMPORT_PLAYBOOK.md](docs/BOB_DEPUTY_STATIC_GUARD_IMPORT_PLAYBOOK.md) | 64 | Bob Deputy Static Guard Import Playbook |
| [docs/BOB_DOCS_MASTER_DIGEST.md](docs/BOB_DOCS_MASTER_DIGEST.md) | 160 | Bob Documentation Master Digest |
| [docs/BOB_DOCUMENT_COMPREHENSION_AND_DISCUSSION_PROTOCOL.md](docs/BOB_DOCUMENT_COMPREHENSION_AND_DISCUSSION_PROTOCOL.md) | 129 | Bob Document Comprehension and Discussion Protocol |
| [docs/BOB_DOCUMENT_TYPE_INTELLIGENCE_PLAYBOOK.md](docs/BOB_DOCUMENT_TYPE_INTELLIGENCE_PLAYBOOK.md) | 67 | Bob Document Type Intelligence Playbook |
| [docs/BOB_E2E_VALIDATION_AND_REMEDIATION.md](docs/BOB_E2E_VALIDATION_AND_REMEDIATION.md) | 544 | Bob's Autonomous E2E Validation & Remediation System |
| [docs/BOB_ENRICHMENT_APP_ENABLEMENT_PLAYBOOK.md](docs/BOB_ENRICHMENT_APP_ENABLEMENT_PLAYBOOK.md) | 134 | Bob Enrichment App Enablement Playbook |
| [docs/BOB_ENRICHMENT_ASSIGNMENT_REVIEW_2026-05-16.md](docs/BOB_ENRICHMENT_ASSIGNMENT_REVIEW_2026-05-16.md) | 99 | Bob Enrichment Document Assignment Review - 2026-05-16 |
| [docs/BOB_ENRICHMENT_DOCUMENT_ASSIGNMENT_PLAYBOOK.md](docs/BOB_ENRICHMENT_DOCUMENT_ASSIGNMENT_PLAYBOOK.md) | 206 | Bob Enrichment Document Assignment Playbook |
| [docs/BOB_ENV_REFERENCE.md](docs/BOB_ENV_REFERENCE.md) | 137 | Bob Inference and Ollama Environment Reference |
| [docs/BOB_FAILURE_SUMMARY.md](docs/BOB_FAILURE_SUMMARY.md) | 26 | Bob Failure Summary |
| [docs/BOB_FIELD_INTELLIGENCE.md](docs/BOB_FIELD_INTELLIGENCE.md) | 223 | Bob Field Intelligence Training Pack |
| [docs/BOB_GATEKEEPER_MANUAL_PARITY_AUDIT_2026-05-16.md](docs/BOB_GATEKEEPER_MANUAL_PARITY_AUDIT_2026-05-16.md) | 90 | Bob Gatekeeper Manual Parity Audit |
| [docs/BOB_GATEKEEPER_PLAYBOOK_2026-05-18.md](docs/BOB_GATEKEEPER_PLAYBOOK_2026-05-18.md) | 66 | Bob Gatekeeper Playbook (Operations One-Page) |
| [docs/BOB_MASTER_RUNTIME_TRUTH.md](docs/BOB_MASTER_RUNTIME_TRUTH.md) | 54 | Bob Master Runtime Truth |
| [docs/BOB_MASTER_TRAINING_FRAMEWORK.md](docs/BOB_MASTER_TRAINING_FRAMEWORK.md) | 231 | Bob Master Training Framework |
| [docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md](docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md) | 116 | Bob Model Quality Baseline and Lifecycle Policy |
| [docs/BOB_NZ_BUSINESS_GROWTH_TRAINING.md](docs/BOB_NZ_BUSINESS_GROWTH_TRAINING.md) | 188 | Bob NZ Business Growth Training Pack |
| [docs/BOB_NZ_COUNCILS_PROCUREMENT_TRAINING.md](docs/BOB_NZ_COUNCILS_PROCUREMENT_TRAINING.md) | 141 | Bob NZ Councils & Procurement Growth Training Pack |
| [docs/BOB_OPERATIONAL_AUDIT_2026-05-07.md](docs/BOB_OPERATIONAL_AUDIT_2026-05-07.md) | 60 | Bob Operational Audit — 2026-05-07 |
| [docs/BOB_OPERATIONS_ONE_PAGE_SUMMARY_2026-05-26.md](docs/BOB_OPERATIONS_ONE_PAGE_SUMMARY_2026-05-26.md) | 66 | Bob Operations One-Page Summary |
| [docs/BOB_PM_READINESS_GATE_2026-05-18.md](docs/BOB_PM_READINESS_GATE_2026-05-18.md) | 95 | Bob PM Readiness Gate |
| [docs/BOB_PRODUCTION_RAILWAY_SETUP.md](docs/BOB_PRODUCTION_RAILWAY_SETUP.md) | 409 | Bob Production Railway Setup |
| [docs/BOB_RAG_TRULENS_SETUP.md](docs/BOB_RAG_TRULENS_SETUP.md) | 62 | Bob RAG and TruLens Setup |
| [docs/BOB_READINESS_SCORECARD.md](docs/BOB_READINESS_SCORECARD.md) | 77 | Bob Readiness Scorecard |
| [docs/BOB_RESEARCH_METHODOLOGY_TRAINING.md](docs/BOB_RESEARCH_METHODOLOGY_TRAINING.md) | 750 | Bob Research Methodology & Critical Thinking Training |
| [docs/BOB_RESEARCH_TRAINING_ACTIVE.md](docs/BOB_RESEARCH_TRAINING_ACTIVE.md) | 146 | Bob Research Training — Implementation Complete |
| [docs/BOB_RESTRICTION_SHEET.md](docs/BOB_RESTRICTION_SHEET.md) | 60 | Bob Restriction Sheet |
| [docs/BOB_RETENTION_POLICY_2026-05-18.md](docs/BOB_RETENTION_POLICY_2026-05-18.md) | 33 | Bob Decision Log and Approval Artifact Retention Policy |
| [docs/BOB_RUNPOD_FULL_SETUP.md](docs/BOB_RUNPOD_FULL_SETUP.md) | 346 | Bob RunPod Full Setup — Complete Installation & Training |
| [docs/BOB_RUNTIME_CONTEXT_FOLLOWUP_2026-05-22.md](docs/BOB_RUNTIME_CONTEXT_FOLLOWUP_2026-05-22.md) | 80 | Bob Runtime Context Follow-up (2026-05-22) |
| [docs/BOB_SAFE_RUNTIME_CONTRACT.md](docs/BOB_SAFE_RUNTIME_CONTRACT.md) | 162 | Bob Safe Runtime Contract |
| [docs/BOB_SANDBOX_EMULATOR_GUIDE.md](docs/BOB_SANDBOX_EMULATOR_GUIDE.md) | 690 | Bob's Sandbox Emulator — Real-World Training Lab |
| [docs/BOB_SANDBOX_EXERCISE_A.md](docs/BOB_SANDBOX_EXERCISE_A.md) | 356 | Bob's Sandbox Emulator — Quick Start Checklist |
| [docs/BOB_SANDBOX_EXERCISE_B.md](docs/BOB_SANDBOX_EXERCISE_B.md) | 359 | Bob's Sandbox Exercise B: Data Flow Tracing |
| [docs/BOB_SANDBOX_EXERCISE_C.md](docs/BOB_SANDBOX_EXERCISE_C.md) | 354 | Bob's Sandbox Exercise C: Multi-Organization Isolation |
| [docs/BOB_SANDBOX_EXERCISE_D.md](docs/BOB_SANDBOX_EXERCISE_D.md) | 399 | Bob's Sandbox Exercise D: Breach Triage Workflow |
| [docs/BOB_SANDBOX_EXERCISE_E.md](docs/BOB_SANDBOX_EXERCISE_E.md) | 457 | Bob's Sandbox Exercise E: Bob Assistance Integration |
| [docs/BOB_SECURITY_GOVERNANCE_AUDIT_2026-05-18.md](docs/BOB_SECURITY_GOVERNANCE_AUDIT_2026-05-18.md) | 36 | Bob Security and Governance Audit (Evidence Snapshot) |
| [docs/BOB_SELF_CONTAINED_BUILD_REVIEW_TRAINING_PACK.md](docs/BOB_SELF_CONTAINED_BUILD_REVIEW_TRAINING_PACK.md) | 143 | Bob Self-Contained Build Review Training Pack |
| [docs/BOB_SELF_GROUNDING_REPORT.md](docs/BOB_SELF_GROUNDING_REPORT.md) | 37 | Bob Self Grounding Report |
| [docs/BOB_SELF_GROUNDING_WORKFLOW.md](docs/BOB_SELF_GROUNDING_WORKFLOW.md) | 67 | Bob Self Grounding Workflow |
| [docs/BOB_SESSION_READ_ORDER_PLAYBOOK.md](docs/BOB_SESSION_READ_ORDER_PLAYBOOK.md) | 115 | Bob Session Read-Order Playbook |
| [docs/BOB_SYSTEM_REVIEW.md](docs/BOB_SYSTEM_REVIEW.md) | 126 | Bob System Review |
| [docs/BOB_SYSTEM_ROUTE_MAP.md](docs/BOB_SYSTEM_ROUTE_MAP.md) | 393 | Bob System Route Map |
| [docs/BOB_TRAINING_ADVANCED_ARCHITECT_2026.md](docs/BOB_TRAINING_ADVANCED_ARCHITECT_2026.md) | 60 | Bob/Dr Bob Training Pack: Advanced Architect Workflow 2026 |
| [docs/BOB_TRAINING_ALL_IN_ONE.md](docs/BOB_TRAINING_ALL_IN_ONE.md) | 59 | Bob/Dr Bob Training Pack: All-In-One Training Bundle |
| [docs/BOB_TRAINING_AUDIT_2026-05-04.md](docs/BOB_TRAINING_AUDIT_2026-05-04.md) | 323 | BOB_TRAINING Documentation Audit & Verification Report |
| [docs/BOB_TRAINING_AUTONOMOUS_DEBUGGER.md](docs/BOB_TRAINING_AUTONOMOUS_DEBUGGER.md) | 256 | Bob Training Pack: Autonomous Debugger Mind |
| [docs/BOB_TRAINING_CINEMATIC_UI_INTERACTION.md](docs/BOB_TRAINING_CINEMATIC_UI_INTERACTION.md) | 104 | Bob/Dr Bob Training Pack: Cinematic UI + Human Interaction |
| [docs/BOB_TRAINING_COVERAGE_REVIEW_2026-05-16.md](docs/BOB_TRAINING_COVERAGE_REVIEW_2026-05-16.md) | 64 | Bob Training Coverage Review - 2026-05-16 |
| [docs/BOB_TRAINING_INGESTION_GUIDE.md](docs/BOB_TRAINING_INGESTION_GUIDE.md) | 384 | Bob Self-Training & Knowledge Ingestion Guide |
| [docs/BOB_TRAINING_SELF_EVAL_LOOP.md](docs/BOB_TRAINING_SELF_EVAL_LOOP.md) | 47 | Bob/Dr Bob Training Pack: Self-Evaluation Loop |
| [docs/BOB_TRAINING_STACK_SCHEMA_FIDELITY.md](docs/BOB_TRAINING_STACK_SCHEMA_FIDELITY.md) | 70 | Bob/Dr Bob Training Pack: Stack Fidelity + Schema Truth |
| [docs/BOB_TRAINING_TENANT_ISOLATION_PROOF.md](docs/BOB_TRAINING_TENANT_ISOLATION_PROOF.md) | 32 | Bob/Dr Bob Training Pack: Tenant Isolation Proof |
| [docs/BOB_TRAINING_TRUTH_PROTOCOL.md](docs/BOB_TRAINING_TRUTH_PROTOCOL.md) | 45 | Bob/Dr Bob Training Pack: Truth Protocol |
| [docs/BOB_TRAINING_VIDEO_AUTOMATION.md](docs/BOB_TRAINING_VIDEO_AUTOMATION.md) | 373 | Bob Training: Video Generation Automation |
| [docs/BOB_TUTOR_MASTERY_PROGRAM.md](docs/BOB_TUTOR_MASTERY_PROGRAM.md) | 100 | Bob Tutor Mastery Program |
| [docs/BOB_TUTOR_MASTERY_REPORT.md](docs/BOB_TUTOR_MASTERY_REPORT.md) | 36 | Bob Tutor Mastery Report |
| [docs/BOB_UNIFIED_VISION.md](docs/BOB_UNIFIED_VISION.md) | 200 | Bob Unified Command: The Vision |
| [docs/BOB_USER_MANAGEMENT_GOLD_STANDARD.md](docs/BOB_USER_MANAGEMENT_GOLD_STANDARD.md) | 179 | Bob Gold Standard: User Management Module (Multi-Org) |
| [docs/BOB_WORKFLOW_RULES.md](docs/BOB_WORKFLOW_RULES.md) | 48 | Bob Workflow Rules |
| [docs/COMPARISON_HUMAN_vs_BOB_ANALYSIS.md](docs/COMPARISON_HUMAN_vs_BOB_ANALYSIS.md) | 96 | Comparison: Human Analysis vs Bob Review |
| [docs/DISTRIBUTED_BOB_ARCHITECTURE_STRATEGY.md](docs/DISTRIBUTED_BOB_ARCHITECTURE_STRATEGY.md) | 109 | Distributed Bob Architecture Strategy |
| [docs/DR_BOB_DIAGNOSTIC_ANALYSIS_PROTOCOL.md](docs/DR_BOB_DIAGNOSTIC_ANALYSIS_PROTOCOL.md) | 44 | Dr Bob Diagnostic Analysis and Report Writing Protocol |
| [docs/ENTERPRISE_REBUILD_PLAN_BOB_2026-04-25.md](docs/ENTERPRISE_REBUILD_PLAN_BOB_2026-04-25.md) | 97 | ⚠️ HISTORICAL DOCUMENT — Enterprise Rebuild Plan (Bob Independent) - 2026-04-25 |
| [docs/adr/013-bob-patrol-dispatch-intelligence.md](docs/adr/013-bob-patrol-dispatch-intelligence.md) | 126 | ADR 013: Bob Patrol & Dispatch Intelligence Architecture |
| [docs/adr/015-bob-safe-runtime-framework.md](docs/adr/015-bob-safe-runtime-framework.md) | 76 | ADR 015: Bob Safe Runtime Framework |
| [ops/BOB_AUTOMATION_RUNBOOK.md](ops/BOB_AUTOMATION_RUNBOOK.md) | 91 | Bob Automation Runbook |
| [tools/bob-pm-evidence/latest/bob-pm-evidence.md](tools/bob-pm-evidence/latest/bob-pm-evidence.md) | 65 | Bob PM Evidence Packet |
| [tools/ptt-team-training/20260424T072142Z/bob-plan.txt](tools/ptt-team-training/20260424T072142Z/bob-plan.txt) | 4 | (no h1) |
| [tools/ptt-team-training/20260424T072142Z/dr-bob-review.txt](tools/ptt-team-training/20260424T072142Z/dr-bob-review.txt) | 14 | (no h1) |
| [tools/ptt-team-training/20260424T072319Z/bob-plan.txt](tools/ptt-team-training/20260424T072319Z/bob-plan.txt) | 4 | (no h1) |
| [tools/ptt-team-training/20260424T072319Z/dr-bob-review.txt](tools/ptt-team-training/20260424T072319Z/dr-bob-review.txt) | 16 | (no h1) |
| [tools/ptt-team-training/20260424T072530Z/bob-plan.txt](tools/ptt-team-training/20260424T072530Z/bob-plan.txt) | 2 | (no h1) |
| [tools/ptt-team-training/20260424T072530Z/dr-bob-review.txt](tools/ptt-team-training/20260424T072530Z/dr-bob-review.txt) | 10 | (no h1) |
| [tools/ptt-team-training/20260424T073006Z/bob-plan.txt](tools/ptt-team-training/20260424T073006Z/bob-plan.txt) | 74 | (no h1) |
| [tools/ptt-team-training/20260424T073006Z/dr-bob-review.txt](tools/ptt-team-training/20260424T073006Z/dr-bob-review.txt) | 11 | (no h1) |
| [tools/ptt-team-training/20260424T225951Z/bob-plan.txt](tools/ptt-team-training/20260424T225951Z/bob-plan.txt) | 1 | (no h1) |
| [tools/ptt-team-training/20260424T225951Z/dr-bob-review.txt](tools/ptt-team-training/20260424T225951Z/dr-bob-review.txt) | 10 | (no h1) |
| [tools/ptt-team-training/20260424T232201Z/bob-plan.txt](tools/ptt-team-training/20260424T232201Z/bob-plan.txt) | 44 | (no h1) |
| [tools/ptt-team-training/20260424T232201Z/dr-bob-review.txt](tools/ptt-team-training/20260424T232201Z/dr-bob-review.txt) | 10 | (no h1) |
| [tools/uiux-plans/bob_plan_via_collab_2026-05-10T15-27-42Z.txt](tools/uiux-plans/bob_plan_via_collab_2026-05-10T15-27-42Z.txt) | 58 | (no h1) |
| [tools/uiux-plans/bob_plan_via_staging_2026-05-10.txt](tools/uiux-plans/bob_plan_via_staging_2026-05-10.txt) | 82 | (no h1) |
| [tools/uiux-plans/bob_plan_via_staging_2026-05-10T15-22-41Z.txt](tools/uiux-plans/bob_plan_via_staging_2026-05-10T15-22-41Z.txt) | 2 | (no h1) |
| [tools/uiux-plans/bob_plan_via_staging_2026-05-10T15-26-52Z.txt](tools/uiux-plans/bob_plan_via_staging_2026-05-10T15-26-52Z.txt) | 2 | (no h1) |
| [tools/uiux-plans/bob_uiux_plan_2026-05-10.txt](tools/uiux-plans/bob_uiux_plan_2026-05-10.txt) | 1 | (no h1) |
| [tools/uiux-plans/bob_uiux_prompt_2026-05-10.txt](tools/uiux-plans/bob_uiux_prompt_2026-05-10.txt) | 15 | (no h1) |
| [tools/uiux-plans/dr_bob_review_uiux_2026-05-10.txt](tools/uiux-plans/dr_bob_review_uiux_2026-05-10.txt) | 0 | (no h1) |
