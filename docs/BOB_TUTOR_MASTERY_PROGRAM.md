# Bob Tutor Mastery Program

Purpose: teach Bob and the app to enrich the whole platform with accurate, policy-safe, operations-ready data in a fresh or existing environment.

## Mission

Bob must be able to:

- read live schema and app structure before decisions
- classify and reason over source documents and storage objects
- enrich organizations, clients, sites, zones, and operational context safely
- apply confidence-aware logic to admin and officer workflows
- stop and ask when ownership, boundary, or provenance is unclear

## Core Teaching Loop

This program uses the existing orchestrator and enrichment trainer as the foundation.

1. Ground truth and context:
   - `scripts/run-autonomous-learning-cycle.sh`
2. Enrichment reasoning and app enablement:
   - `scripts/run-enrichment-bob-app-training.mjs --with-feeds --with-app-checks`
3. Source classification and provenance inventory:
   - `scripts/roster-source-inventory.mjs`
4. Capability gate:
   - `scripts/bob-capability-gate.mjs --required chat`

The full loop is wrapped by:

```bash
bun run bob:tutor:mastery
```

## Fresh DB and App Focus

For a fresh deployment or reset state:

1. run tutor loop in dry-run mode first
2. inspect generated tutor report and enrichment artifacts
3. verify unresolved blockers are zero
4. move to apply mode only when confidence gates are green

Apply mode example:

```bash
bun run bob:tutor:mastery:apply -- --bucket evidence --prefix historical-imports --limit 100 --organization-id <org-uuid>
```

## Accuracy and Data Management Rules

- Never write uncertain org/site ownership without explicit confirmation.
- Keep polygon/boundary constraints ahead of operational writes.
- Prefer staged intake and review over direct mutation.
- Use evidence-backed confidence tiers for UI behavior.
- Treat low-confidence outputs as review tasks, not final truths.

## Same vs Different Organization Logic

Bob should treat records as the same organization only when identity signals align strongly.

High-confidence same-org signals:

- exact UUID match
- exact parent organization match plus same org level/type
- same normalized name and same normalized address/contact email/contact phone

Likely different-org signals:

- same name but different parent hierarchy
- same name but materially different address and contacts
- same name appears in multiple regions/branches with distinct operational ownership

Client identity guidance:

- If a client reference field exists (for example `m365_customer_id`, site code, or purchase order number), treat exact match as strong evidence.
- If name matches but client reference differs, treat as possible different entity and route for review.

Stop-and-ask gate (mandatory):

- Multiple candidates tie at high similarity score.
- Name match exists but hierarchy and address/contact signals conflict.
- No stable unique identifier exists and confidence is not high.

When stop-and-ask triggers, Bob must halt auto-link/create and request user confirmation before any write.

## Outputs

Every tutor run emits:

- JSON execution artifact: `logs/bob-tutor-mastery-report.json`
- Human report: `docs/BOB_TUTOR_MASTERY_REPORT.md`
- Source inventory artifact: `logs/roster-source-inventory.tutor.json`

## Operator Role

You remain the final authority for:

- org mapping where path/source signals conflict
- uncertain legal/jurisdiction interpretation
- approving apply mode for production-impacting runs
