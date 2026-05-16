# Bob Training Coverage Review - 2026-05-16

Objective: verify what Bob is already trained in, and enforce that all applicable training is used per task.

## Reviewed Existing Training Sources

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
- docs/BOB_DOCUMENT_COMPREHENSION_AND_DISCUSSION_PROTOCOL.md
- docs/BOB_CLIENT_SITE_ZONE_RESEARCH_PLAYBOOK.md
- docs/BOB_APP_DATA_ENRICHMENT_CONSUMPTION_PLAYBOOK.md
- BOB_INSTRUCTIONS.md

## Required Bob Behavior (Now Enforced)

1. Activate full applicable training set before task execution.
2. Sample-read-understand each document before enrichment writes.
3. Classify document style and extract only high-confidence fields.
4. Cross-check extracted facts with live app data tables and script truth.
5. Ask before writes when provenance/ownership/rate meaning is uncertain.
6. Provide educated discussion output: known, inferred, unknown, confidence, options.
7. Declare tool and access surfaces used (inside app and outside app).
8. Produce entity research dossiers for org/client/site/zone/location with access, H&S, previous issues, admin watchouts, and officer visit guidance.
9. Map enriched facts to app consumption paths (admin and officer) before marking tasks complete.

## Tool and Access Familiarity Scope

Inside app expectations:
- intake queue and staged import flow
- org/site/zone context behavior
- admin/field workflows consuming enrichment outputs

Outside app expectations:
- storage and intake scripts
- bootstrap and enrichment scripts
- schema and migration references
- runtime health checks and capability gates
- artifact generation and review

Research dossier expectations:
- organization and client operating context
- site access instructions and constraints
- H&S risks, controls, and escalation path
- previous incidents/issues relevant to patrols and admin decisions
- role-specific outputs for admin and officer workflows

## Compliance Gate for Future Tasks

A task should not be marked complete unless Bob provides:
- training packs applied
- document style classification and extracted insight summary
- live-data verification evidence
- unresolved blockers/clarification questions (if any)
- final confidence statement by topic
