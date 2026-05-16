# Bob Enrichment Document Assignment Playbook

Purpose: teach Bob how to run a fast document assignment review, combine trusted references into a practical enrichment plan, and then create an executable enrichment project.

This playbook is the pre-flight for enrichment work and should be run before long apply jobs.

Companion training for file-style recognition and extractable-value mapping:
- `docs/BOB_DOCUMENT_TYPE_INTELLIGENCE_PLAYBOOK.md`

Companion training for sampling, understanding, live-data fit, and user discussion:
- `docs/BOB_DOCUMENT_COMPREHENSION_AND_DISCUSSION_PROTOCOL.md`

Companion training for mandatory entity research dossiers:
- `docs/BOB_CLIENT_SITE_ZONE_RESEARCH_PLAYBOOK.md`

## 1) Quick Document Assignment Review (10-20 minutes)

### Goal

Identify:
- which documents are authoritative,
- which are implementation guides,
- which are evidence/output artifacts,
- and which are new candidate documents that can improve enrichment.

### 1.1 Canonical source order

Use this order when sources conflict:

1. `system_state.json` (repo topology and runtime truth)
2. `docs/DECISIONS.md` and `docs/adr/` (durable architecture decisions)
3. `docs/STAGING.md` (current staging execution protocol)
4. `docs/BIB_STORAGE_DATA_ENTRY_PLAYBOOK.md` (intake/enrichment operator flow)
5. Script truth in `scripts/` (actual runtime behavior)
6. Generated logs/artifacts (evidence of what happened)

### 1.2 Assignment labels

For each reviewed document, assign one label:

- `AUTHORITATIVE`: defines policy/truth constraints.
- `OPERATIONAL`: provides run steps and command sequences.
- `IMPLEMENTATION`: script/code file defining behavior.
- `EVIDENCE`: artifacts/logs proving outcomes.
- `CANDIDATE`: new or unvetted input, needs validation.
- `STALE`: conflicts with higher-priority truth or old behavior.

### 1.3 Fast review checklist

For each candidate document, answer:

1. Is org scope explicit (`organization_id`, provider/client context)?
2. Is geometry policy explicit (polygon-first, centroid only for travel distance)?
3. Are commands current and executable in this repo?
4. Does it define success and blocker conditions?
5. Does it match script behavior and current run artifacts?

If any answer is no, classify as `CANDIDATE` or `STALE` and do not use it as authority.

## 2) Reference Set for Enrichment Work

Minimum document/script set Bob should always load for enrichment planning:

- `docs/STAGING.md`
- `docs/BIB_STORAGE_DATA_ENTRY_PLAYBOOK.md`
- `scripts/run-enrichment-bob-app-training.mjs`
- `scripts/backfill-bob-intakes-from-storage.mjs`
- `scripts/bootstrap-marlborough-parking.mjs`
- `scripts/geo-boundary-transition-test.mjs`
- `scripts/bob-capability-gate.mjs`
- `logs/enrichment-training-artifact.json` (latest run evidence)

## 3) Mix-and-Match Planning Method (How Bob combines docs)

### 3.1 Build four planning lanes

Lane A: Intake and discovery
- Source: BIB playbook + intake script
- Output: bucket/prefix plan and batching strategy

Lane B: Data and ownership modeling
- Source: staging + bootstrap scripts + decisions
- Output: org/branch/client ownership mapping and contracts/access prerequisites

Lane C: Geospatial enforcement constraints
- Source: staging polygon rules + boundary validation script
- Output: strict polygon validation gates and transition checkpoints

Jurisdiction mapping training requirements (mandatory):
- Treat jurisdiction mapping as polygon-first only.
- Build and validate parent jurisdiction coverage before child/specific zones.
- Use council/LINZ/NZTA authoritative polygons first, then fallback sources only when documented.
- Validate handover points with known in-zone and cross-boundary coordinates.
- If jurisdiction ownership/provider mapping is uncertain, stop and ask for confirmation before apply.

Lane D: Runtime validation and readiness
- Source: orchestrator + capability gate + artifact schema
- Output: pass/fail criteria with blocker handling

### 3.2 Merge rule

When lanes conflict:
- keep the highest-priority source from section 1.1,
- keep script behavior over old prose,
- record unresolved mismatch as blocker before apply execution.

## 4) Create an Enrichment Project (Execution Blueprint)

### 4.1 Project definition template

Bob should define the project in this shape:

- Project name: `<org>-enrichment-<date>`
- Scope:
  - Buckets/prefixes to ingest
  - Target organizations/clients
  - Zone/site/jurisdiction updates required
- Inputs:
  - authoritative docs list
  - script set
  - env prerequisites
- Outputs:
  - staged intakes
  - bootstrap updates
  - validation results
  - artifact json
- Acceptance:
  - boundary transition success
  - capability gate passes (or explicit unresolved blocker)
  - artifact blockers list and degraded flag reviewed

### 4.2 Execution order

1. Document assignment review (this playbook).
2. Intake dry-run across selected data sources.
3. Intake apply in batches.
4. Bootstrap/apply org and geospatial prerequisites.
5. Run enrichment orchestration with feeds/app checks.
6. Review artifact and blockers.
7. Produce completion summary with next actions.

Roster source rule (Deputy-first):
1. Check for Deputy exports/files first when building roster history and staffing evidence.
2. If Deputy files are found, treat them as primary roster evidence input.
3. If Deputy files are missing or ambiguous, Bob must ask the operator for source confirmation before inferring roster facts from secondary sources.

### 4.3 Strict sign-off rule

Project is ready for strict sign-off only when:
- boundary transition validation passes,
- unresolved blockers are zero,
- and artifact degraded flag is false.

## 5) Quick Command Set for Bob

Document and script grounding:

```bash
node scripts/run-enrichment-bob-app-training.mjs --help
node scripts/backfill-bob-intakes-from-storage.mjs --help
```

Dry-run and apply orchestration:

```bash
npm run bob:enrichment:training
npm run bob:enrichment:training:apply
```

Boundary/capability spot checks:

```bash
node scripts/geo-boundary-transition-test.mjs --providerOrgId b3dcef79-9cc1-4f3b-bae0-a190297c52b7
node scripts/bob-capability-gate.mjs --required chat --retries 3 --timeoutMs 90000

# Site enrichment with mandatory research dossier gate
node scripts/enrich-site-roster-costing.mjs --global-training --since-date 2026-01-01

# Override only after operator review of blockers
node scripts/enrich-site-roster-costing.mjs --global-training --since-date 2026-01-01 --apply --allow-uncertain-writes

# Emit dedicated admin/officer briefing artifact for app consumption
node scripts/enrich-site-roster-costing.mjs --global-training --since-date 2026-01-01 --briefings-out logs/site-roster-briefings-artifact.json
```

## 6) Review Output Bob Must Produce

Before execution, Bob should produce a short review summary with:

- Assigned documents by label (`AUTHORITATIVE`, `OPERATIONAL`, etc.)
- Any `STALE`/conflicting document findings
- Selected enrichment scope (buckets/prefixes + org targets)
- Declared blockers and whether execution can proceed

Uncertainty gate (required):
- If source ownership, jurisdiction boundaries, or roster provenance is uncertain, Bob must ask a direct clarification question before writing data.

After execution, Bob should produce:

- artifact path,
- blockers summary,
- strict sign-off status,
- follow-up list for unresolved blockers.

Mandatory contextual enrichment output:
- For each in-scope organization/client/site/zone/location, provide a research dossier with access guidance, H&S context, previous issues, client-purpose context, admin watchouts, and officer visit notes.