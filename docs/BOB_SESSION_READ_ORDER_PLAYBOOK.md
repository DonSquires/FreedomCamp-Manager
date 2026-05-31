# Bob Session Read-Order Playbook

Date: 2026-05-26
Owner: GitHub Copilot
Purpose: Provide a deterministic file read order so Bob work starts from current truth and avoids stale guidance.

## Use Case

Use this playbook at the start of any Bob-related coding, governance, triage, or architecture session.

## Read Order (Strict)

### Tier 1: Mandatory First Read

1. docs/BOB_MASTER_RUNTIME_TRUTH.md
2. docs/BOB_SAFE_RUNTIME_CONTRACT.md
3. BOB_INSTRUCTIONS.md

Outcome required before continuing:

1. Confirm current runtime topology and hosting assumptions.
2. Confirm safety, approval, and mutation boundaries.
3. Confirm grounding and intent-validation expectations.

### Tier 2: Operational Control and Mapping

1. docs/BOB_SYSTEM_ROUTE_MAP.md
2. docs/BOB_RESTRICTION_SHEET.md
3. docs/BOB_WORKFLOW_RULES.md
4. BOB_WORKFLOW_RULES.md

Outcome required before continuing:

1. Confirm route and surface ownership for requested actions.
2. Confirm restriction boundaries.
3. Resolve any docs-vs-root workflow-rule mismatch using Tier 1 tie-break.

### Tier 3: Training, Quality, and Readiness

1. docs/BOB_MASTER_TRAINING_FRAMEWORK.md
2. docs/BOB_TRAINING_TRUTH_PROTOCOL.md
3. docs/BOB_TRAINING_SELF_EVAL_LOOP.md
4. docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md
5. docs/BOB_PM_READINESS_GATE_2026-05-18.md
6. tools/bob-pm-evidence/latest/bob-pm-evidence.md

Outcome required before continuing:

1. Confirm what can be claimed externally.
2. Confirm quality gates and evidence requirements.
3. Confirm current training and evaluation posture.

### Tier 4: Deployment and Environment Context

1. docs/BOB_ENV_REFERENCE.md
2. docs/BOB_RUNTIME_CONTEXT_FOLLOWUP_2026-05-22.md
3. docs/BOB_RUNPOD_FULL_SETUP.md
4. docs/BOB_PRODUCTION_RAILWAY_SETUP.md
5. BOB_INFERENCE_SECRET_CONFIGURATION.md

Outcome required before continuing:

1. Confirm actual target environment for the task.
2. Use Tier 1 runtime truth to resolve any deployment contradictions.

### Tier 5: Historical/Context Layer (Optional)

1. docs/BOB_BRAIN_DUMP.md
2. BOB_SESSION_SUMMARY_20260430.md
3. BOB_ANALYSIS_SESSION.md
4. BOB_JOINT_DIAGNOSIS.md

Outcome required before continuing:

1. Use only for context and retrospective clues.
2. Do not use as tie-break authority.

## Session Start Checklist

1. Identify task class: runtime, routing, training, remediation, PM claim, deployment.
2. Read Tier 1 fully.
3. Read the corresponding Tier 2/3/4 subset for the task class.
4. Record conflicts and resolve using Tier 1 tie-break order.
5. Proceed only after confirming no ungrounded assumptions remain.

## Fast Paths by Task Type

### Runtime incident triage

1. Tier 1
2. Tier 2
3. Tier 4

### Bob training or scorecard work

1. Tier 1
2. Tier 3

### PM/customer-facing Bob capability questions

1. Tier 1
2. Tier 3
3. PM evidence file

### Route/access/governance change

1. Tier 1
2. Tier 2
3. Tier 3 (if claims or quality posture affected)

## Anti-Drift Rules

1. Never make final runtime claims from generated or historical docs alone.
2. If a doc claims something is live, verify with current scripts/workflows/config before repeating it.
3. If workflow rules conflict between duplicate files, record the mismatch and defer to Tier 1.
