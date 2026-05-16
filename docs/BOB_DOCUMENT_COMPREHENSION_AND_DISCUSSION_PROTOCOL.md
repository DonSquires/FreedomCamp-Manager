# Bob Document Comprehension and Discussion Protocol

Purpose: train Bob to sample, read, understand, and synthesize documents with live app data, then hold an informed discussion with the user.

## 1) Mandatory Training Activation Gate

Before task execution, Bob must activate and use the existing training bundle:

- docs/BOB_TRAINING_ALL_IN_ONE.md
- docs/BOB_TRAINING_STACK_SCHEMA_FIDELITY.md
- docs/BOB_TRAINING_TENANT_ISOLATION_PROOF.md
- docs/BOB_TRAINING_SELF_EVAL_LOOP.md
- docs/BOB_TRAINING_CINEMATIC_UI_INTERACTION.md
- docs/BOB_TRAINING_TRUTH_PROTOCOL.md
- docs/BOB_TRAINING_ADVANCED_ARCHITECT_2026.md
- docs/BOB_TRAINING_AUTONOMOUS_DEBUGGER.md
- docs/BOB_ENRICHMENT_DOCUMENT_ASSIGNMENT_PLAYBOOK.md
- docs/BOB_DOCUMENT_TYPE_INTELLIGENCE_PLAYBOOK.md
- docs/BOB_CLIENT_SITE_ZONE_RESEARCH_PLAYBOOK.md
- docs/BOB_APP_DATA_ENRICHMENT_CONSUMPTION_PLAYBOOK.md
- docs/BOB_ENRICHMENT_APP_ENABLEMENT_PLAYBOOK.md

Activation output required:
- active training packs list
- constraints that apply to this task
- blocker conditions if any pack cannot be applied

## 2) Document Comprehension Workflow

### Step A: Sample

Use a progressive sample pass:
1. metadata sample: filename, path, extension, source bucket/system
2. structure sample: headers, columns, table-like sections, key labels
3. content sample: representative rows/sections (start, middle, end)

Goal: classify document type and likely extractable fields quickly before deep parsing.

### Step B: Read

Read with type-aware strategy:
- CSV/XLSX: prioritize schema/headers first, then validate row semantics
- DOCX/PDF: prioritize section headings, obligations, rates, service scope, dates
- Mixed/unknown: extract stable anchors only, defer assumptions

### Step C: Understand

Convert extracted facts into normalized entities:
- organization/client/provider names
- site/location identifiers
- shift/staffing facts (who, when, where)
- cost/rate facts (charge, pay, overtime, currency)
- jurisdiction and legal references

### Step D: Verify Against Live Data

Cross-check extracted facts with app truth:
- organizations -> organizations table
- sites -> client_sites table
- geofence/jurisdiction -> zones geometry and ownership
- roster history -> roster_shifts and officer_shifts
- rate context -> client_sites defaults + roster shift rates

If mismatches exist:
- label as conflict
- keep source evidence
- stop apply writes until conflict is resolved or user confirms override

## 3) Fit With Other Documents

Bob must always build a source graph:
- authoritative docs (policy and truth)
- operational runbooks (execution steps)
- implementation scripts (actual behavior)
- evidence artifacts (what happened)

Merge rules:
1. authoritative truth beats operational prose
2. script behavior beats stale prose
3. unresolved conflicts become blockers

## 4) Educated Discussion Protocol

When responding to user requests, Bob must provide:
1. what is known (validated facts)
2. what is inferred (with confidence)
3. what is unknown (requires clarification)
4. recommended options with risk/impact
5. precise next action proposal

Ask-if-unsure rule:
- If source ownership, jurisdiction boundary, or rate meaning is uncertain, ask before writing data.

## 5) Document Type to Insight Mapping

Minimum mapping behavior:
- deputy export -> staffing/shift/site/payroll candidate facts
- roster spreadsheet -> planned schedules, shift coverage, possible rate columns
- service contract variation -> legal scope changes, pricing terms, effective dates
- policy/runbook docs -> workflow constraints and acceptance gates
- placeholder/empty artifacts -> no factual enrichment value

## 6) Tool and Access Awareness (Inside and Outside App)

Inside app:
- intake queue review and staged import status
- org/site/zone visibility by active org scope
- admin and field workflows consuming enriched data

Outside app:
- storage bucket scanning and intake scripts
- bootstrap and enrichment scripts
- schema and migration inspection
- inference/runtime health checks
- artifact generation and validation logs

Bob must explicitly state which tools were used and which data surfaces were read before claiming completion.

## 7) Completion Gate

A task is complete only when Bob provides:
- source evidence summary
- live-data verification summary
- conflicts/blockers list (or explicit none)
- confidence level by topic
- follow-up actions if any uncertainty remains

Research dossier requirement:
- For every in-scope organization/client/site/zone/location, provide pertinent context: access profile, H&S summary, previous issues, client purpose, admin watchouts, and officer visit brief.
