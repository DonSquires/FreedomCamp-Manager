# First-Security-Docs

Curated service-provider alignment bundle reviewed during the current service-provider alignment work.

Important clarification from the user:
- the broader First Security source set is not limited to Nelson contract-fit notes
- the supplied material also includes:
  - Microsoft 365 / Business Central financial information
  - a LINZ freedom-camping report delivered by First Security Queenstown
  - field-officer training on working in the field and receiving jobs
  - a First Security capabilities statement

Those exact source files are not currently stored in this folder. Primary-source artifacts currently found in the workspace are:
- `tmp/docs/storage-review/001_Historical_records_Downer_LINZ__Vehicle_Log_10-3-26.xlsx.xlsx`
- `tmp/docs/storage-review/002_Historical_records_Downer_LINZ__Vehicle_Log_19-3-26.csv.csv`
- `tmp/docs/storage-review/003_Parking-Managment__NZTA_Warden_training_guidelines_version_1_codes.docx.docx`

First Security source artifacts ingested from `Service-Contracts/First-Security-Docs`:
- `tmp/docs/storage-review/001_Service-Contracts__First-Security-Docs_Council_Capability_Statement.docx.docx`
- `tmp/docs/storage-review/002_Service-Contracts__First-Security-Docs_D365_Cost_Centre_Mappings_Tool_with_Account_Structure_.xlsx.xlsx`
- `tmp/docs/storage-review/003_Service-Contracts__First-Security-Docs_LINZ_Weekly_Incidents_Report_04-01-26.docx.docx`
- `tmp/docs/storage-review/004_Service-Contracts__First-Security-Docs_West_Coast_Regional_Council_3.docx.docx`

Extracted text files for grounded review:
- `tmp/docs/storage-review/001_Service-Contracts__First-Security-Docs_Council_Capability_Statement.docx.txt`
- `tmp/docs/storage-review/002_Service-Contracts__First-Security-Docs_D365_Cost_Centre_Mappings_Tool_with_Account_Structure_.xlsx.txt`
- `tmp/docs/storage-review/003_Service-Contracts__First-Security-Docs_LINZ_Weekly_Incidents_Report_04-01-26.docx.txt`
- `tmp/docs/storage-review/004_Service-Contracts__First-Security-Docs_West_Coast_Regional_Council_3.docx.txt`

The nearest grounded implementation anchors for those themes are:
- Microsoft 365 / Business Central finance:
  - `src/pages/ClientSites.tsx`
  - `docs/LIVE_SCHEMA.md`
- LINZ / First Security provider-delivery model:
  - `docs/TARGET_STATE_BLUEPRINT.md`
  - `scripts/audit-ncc-live-alignment.sql`
  - `scripts/bootstrap-first-security-orgs.mjs`
  - `docs/FIRST_SECURITY_BRANCH_JURISDICTIONS.md`
- field-officer job receipt and dispatch workflow:
  - `docs/INSTRUCTION_MANUAL.md`
  - `src/pages/FieldOfficerPortal.tsx`
  - `src/pages/FieldOfficerDispatch.tsx`
- First Security capability/capabilities statement:
  - `docs/CAPABILITY_OVERVIEW.md`

Contents:
- `SERVICE_PROVIDER_REQUIREMENTS_MANUAL_FIT_2026-05-17.md`
  - grounded fit assessment against the instruction manual and live service-provider corpus
- `SERVICE_PROVIDER_ALIGNMENT_TODO_2026-05-17.md`
  - prioritized backlog for closing contract-delivery and client-portal gaps
- `nelson-city-council.contract-profile.seed.json`
  - import-ready Nelson City Council contract profile used by `scripts/import-service-provider-profile.mjs`
- `SOURCE_REQUIREMENTS_MATRIX_2026-05-17.md`
  - grounded mapping from bucket-source evidence to routes, schema surfaces, and execution tickets
- `MULTI_CLIENT_OPERATIONS_SAMPLE_INGEST_2026-05-17.md`
  - deep sample ingest from real staff/roster/alarm/noise/patrol datasets with operational metrics and product implications
- `NELSON_FREEDOM_CAMPING_EVIDENCE_METADATA_2026-05-17.md`
  - EXIF-grounded Nelson freedom-camping evidence ingest from the `evidence` bucket, including GPS/time metadata and confirmed Nelson subset
  - includes full-bucket branch attribution and queue outputs to drive branch-prioritized ingestion
- `ENTITY_ONBOARDING_REQUIREMENTS_GATE_2026-05-17.md`
  - enforceable onboarding readiness gate for new client/site/zone/location introductions
- `SMALL_CLIENT_ALARM_PATROL_DEPUTY_COVERAGE_AUDIT_2026-05-17.md`
  - runtime-vs-source coverage audit for smaller client alarm/patrol data plus Deputy static-guarding/staff sources
  - includes explicit ownership rule: Nelson noise-control historical data maps to Nelson City Council

Related ingestion mapping artifact:
- `data/source-mappings/small-client-ingestion-rules.json`
  - source-to-organization mapping defaults for smaller-client historical datasets

Duplicate audit command for small-client sources:
- `bun run ingest:audit:duplicates:small-clients`
  - outputs `tmp/docs/storage-review/deputy-and-small-clients/small-client-source-duplicate-audit.json`

Reviewed outcomes already implemented from this bundle:
- client reporting and finance policy gating
- service agreement obligation management
- Nelson contract-profile import
- client-admin dispute visibility and client-side incident submission
- template-aware monthly reporting scaffolds for Nelson and Marlborough packs

Related grounded profile seeds outside this folder:
- `data/service-provider-profiles/nelson-city-council.contract-profile.seed.json`
- `data/service-provider-profiles/marlborough-district-council.parking-profile.seed.json`

Operational notes:
- The linked project migrations required for the contract profile import have been applied.
- The Nelson profile has been imported into live runtime tables.
- The Marlborough District Council parking profile has been authored and dry-run validated.
- Re-run import verification with:
  - `node scripts/import-service-provider-profile.mjs`
- Apply a profile seed with:
  - `node scripts/import-service-provider-profile.mjs --file docs/First-Security-Docs/nelson-city-council.contract-profile.seed.json --apply`

Evidence indexing and queue commands:
- Build full EXIF index for evidence bucket:
  - `bun run evidence:index:exif`
- Build branch-prioritized ingest queue from EXIF index:
  - `bun run evidence:queue:branches`

Onboarding readiness gate commands:
- Validate newly introduced entities (last 30 days):
  - `bun run onboarding:validate:new`
- Validate all active entities:
  - `bun run onboarding:validate:all`
- Preview module remediation for client/operator orgs:
  - `bun run onboarding:remediate:modules`
- Apply module remediation:
  - `bun run onboarding:remediate:modules:apply`
- Preview signed-agreement remediation:
  - `bun run onboarding:remediate:agreements`
- Apply signed-agreement remediation:
  - `bun run onboarding:remediate:agreements:apply`

Activation enforcement migration:
- `supabase/migrations/20260517183000_client_activation_requires_signed_service_agreement.sql`
