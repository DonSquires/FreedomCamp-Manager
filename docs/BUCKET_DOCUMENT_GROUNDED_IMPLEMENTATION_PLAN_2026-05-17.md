# Bucket Document Grounded Implementation Plan (2026-05-17)

## Review Coverage
- Buckets discovered: 14
- Objects discovered: 1174
- Document-like objects reviewed: 36
- Extracted review corpus: tmp/docs/storage-review/
- Machine-readable review index: tmp/docs/storage-review/index.tsv
- Structured requirement scan: tmp/docs/storage-review/requirements-summary.md

## Source Groups Reviewed

### 1) Marlborough RFIP source set
- Service-Contracts/MDC-Documentation/26-007 Security & other Services RFIP- 24 03 2026 (1).PDF
- Duplicate tender evidence copies (same RFIP) in evidence/tenders/* reviewed and de-duplicated by content meaning.

### 2) Nelson City Council contract source set
- Contract 4038 base agreement and renewal/variation files in Service-Contracts/Nelson-City-Council/
- Service schedule mock-up (April 26)
- Monthly report template document
- Patrol description files
- Pricing and living wage variation files
- Nelson City Council Responsible Camping Bylaw 2025

### 3) Parking operations/training source set
- Parking-Managment/NZTA Warden training guidelines version 1 codes.docx

### 4) Historical operations data source set
- Service-Contracts/Wilsar-Data/Nelson Patrol Historical data.csv
- Service-Contracts/Wilsar-Data/Nelsn Alarm-Noise control historical data.csv
- Service-Contracts/Deputy-Data/Deputy data.csv
- Service-Contracts/Deputy-Data/Deputy Location-sites-patrol zones.csv
- Additional vehicle list/history files in Scv list and Historical records Downer LINZ

## What the Documents Expect the System to Deliver

### A) RFIP-required service bundle (MDC)
- Noise Control (24/7 operations and response proof)
- Smoke Complaints (out-of-hours)
- Security Patrols (parks/reserves)
- Security Patrols (council assets)
- Ad hoc event security support
- Cash security collection/banking consignments
- Biosecurity machinery inspections (with strict timing obligations)
- Location-aware execution across mapped facilities/zones

### A1) Nelson Responsible Camping bylaw controls
- Prohibited-area enforcement based on bylaw schedules and maps
- Restricted-area enforcement with location-specific conditions
- Self-contained vs non-self-contained vehicle rules
- Maximum stay rule: two consecutive nights on no more than two separate occasions in any calendar month within a 500m location definition
- Prior-consent workflow requiring written application and 20 working days lead time
- Temporary closures/restrictions declared by Council resolution
- Infringement/offence support under the Freedom Camping Act 2011

### B) Nelson contract operating model (Contract 4038 + schedules/variations)
- Core service types:
  - after-hours patrols
  - lock/unlock gates
  - first response to alarm/security breach
  - static security guard assignments
- Per-facility service matrix with frequency standards (A-J style frequencies)
- Response timing expectation in service schedule (e.g., first response within 45 minutes where specified)
- Monthly reporting package by facility category
- Contract-control requirements: H&S plan, insurance coverage, variation handling, pricing schedules

### C) Parking enforcement evidence standard (NZTA training)
- Legislation-grounded offence codification
- Photo evidence standards and minimum evidence structure
- Time-restriction/chalk workflow discipline
- Diagram/measurement/prolongation requirements for contested infringements
- Consistent officer procedure and auditable note quality

### D) Historical data expectations
- Importable patrol/alarm/noise history for baselining and SLA benchmarking
- Workforce/schedule alignment data from Deputy exports
- Vehicle list/history artifacts for watchlist, permit, or repeat-offender analysis

### E) Freedom camping compliance expectations from the new Nelson bylaw
- The app must distinguish prohibited, restricted, and generally permitted local-authority areas
- The app must support NZTA land declared as local-authority area
- The app must track stay history within a 500m radius rather than only exact zone ID reuse
- The app must support Council-issued consent exceptions with revocation
- The app must support temporary closure overlays and active enforcement notices

## Seamless Product Integration Design

## 1) Contract-to-Operations Configuration Layer
Create contract-driven configuration instead of hardcoding council behavior.

Add entities:
- council_contracts
- contract_services
- facility_service_matrix
- frequency_templates
- service_obligation_rules
- report_templates

Each service obligation rule should support:
- target clock (e.g., attendance, report dispatch, email notification)
- threshold (minutes/hours)
- escalation chain
- proof artifact requirements

## 2) Service Execution Flows (mapped to existing app)

### Noise and Smoke
Use existing portals and dispatch, add contract clock templates and proof exports.

Existing modules:
- src/pages/NoiseOfficerPortal.tsx
- src/pages/SmokeComplaintOfficerPortal.tsx
- src/pages/SmokeComplaintControlPage.tsx
- src/pages/DispatchConsole.tsx

Add:
- obligation clock overlay for each job
- SLA-breach reason capture
- council-ready monthly compliance export

### Biosecurity
Use existing biosecurity workflow, add strict contract gate rules.

Existing modules:
- src/pages/BiosecurityOfficerPortal.tsx
- src/pages/BiosecurityControlPage.tsx
- supabase/functions/biosecurity-assess/index.ts
- supabase/functions/biosecurity-notice/index.ts

Add:
- non-subcontract enforcement flag on biosecurity service
- automated timer-driven email outputs (1h/2h obligations)
- delivery receipts + retries + immutable audit log

### Patrols, lock/unlock, alarms, static guards
Use dispatch resources + patrol logs + roster.

Existing modules:
- src/pages/DispatchConsole.tsx
- src/pages/RosterPlanner.tsx
- src/pages/PatrolSessionEventLog.tsx
- src/pages/OfficerPerformanceReport.tsx
- src/pages/OperationsMap.tsx

Add:
- facility-service-frequency matrix execution engine
- lock/unlock event type + proof step
- alarm first-response SLA timer and response proof packet
- static guard assignment object (planned, active, completed)

### Parking
Keep in-house workflow as system of record.

Existing modules:
- src/pages/ParkingEnforcementPortal.tsx
- src/pages/ParkingOfficerPortal.tsx
- src/components/features/ScanDetailPanel.tsx

Add:
- offence-code library and evidence checklist mode from training guidelines
- measurable review/appeal evidence bundle generator
- council profile toggles for enforcement policy differences

### Freedom Camping
Use existing freedom-camping capability, but harden it around bylaw-grade geofencing and exception handling.

Existing modules:
- src/pages/FieldOfficerPortal.tsx
- src/pages/ZoneManagement.tsx
- src/pages/ClientAccountPage.tsx
- src/pages/OperationsMap.tsx

Add:
- bylaw schedule import for prohibited/restricted/NZTA-declared areas
- 500m location-stay rule engine for repeat stay detection
- consent application, approval, and revocation workflow
- temporary closure overlay with effective dates and reason tracking
- offence support aligned to Freedom Camping Act 2011 and bylaw restrictions

## 3) Council Profile System (MDC + NCC + future councils)
Add organization-level profile packs containing:
- legal template set
- service availability matrix
- SLA targets per service
- facility roster and patrol frequencies
- report recipients and monthly pack format
- freedom-camping bylaw package (prohibited areas, restricted areas, consent rules, temporary closures, NZTA local-authority areas)

Result:
- onboard a new council by configuration and imports, not code branching

## 4) Reporting and Tender-Proof Outputs
Build auto-generated packs:
- monthly SLA compliance by service
- per-facility patrol completion vs planned frequencies
- alarm response performance
- incident and notice summaries
- exceptions and remediation actions

Use existing data plus new obligation tables to generate fixed-format council reports.

## 5) Data Ingestion Pipeline from Bucket Files
Implement ingestion jobs for:
- Wilsar historical patrol/noise/alarm CSVs
- Deputy workforce/location mappings
- facility list and frequency mappings from NCC schedule artifacts

Pipeline steps:
- schema map
- dedupe
- validation errors queue
- import provenance metadata

## 6) UX Flow That Feels Seamless
- Admin configures council contract profile once.
- Dispatch auto-inherits required frequencies and SLA clocks.
- Officer sees required evidence checklist per service in task flow.
- Supervisor sees live risk board (SLA at risk, missed patrols, overdue reports).
- Monthly report pack is generated automatically with one click.

## Delivery Plan (Execution Sequence)

### Phase 1 (2-3 weeks)
- Contract configuration schema and service obligation engine
- SLA timer normalization across dispatch/noise/smoke/biosecurity
- Base compliance dashboard

### Phase 2 (2-3 weeks)
- NCC facility-service-frequency matrix ingestion
- patrol/lock-unlock/alarm/static guard contract execution logic
- monthly report template automation
- Nelson Responsible Camping Bylaw map/rule ingestion

### Phase 3 (2-3 weeks)
- parking evidence standards mode and appeal bundle exports
- biosecurity strict timing email automations and audit logs
- cash collection chain-of-custody workflow
- freedom-camping consent and temporary-closure workflows

### Phase 4 (1-2 weeks)
- historical data imports (Wilsar + Deputy)
- baseline KPI backfill and trend reporting
- release hardening + regression suite for contract-critical paths

## Known Document Quality Constraints
- Several variation PDFs are image-like or sparse text in extraction and may need OCR to capture every clause.
- Structured obligations were still recoverable from the core contract, service schedule, RFIP, and monthly template artifacts.

## Immediate Next Build Tickets
1. Build contract obligation schema and migration set.
2. Add SLA clock abstraction to dispatch-linked service jobs.
3. Implement NCC frequency template model (A-J) and facility mapping import.
4. Add monthly report pack generator using NCC template structure.
5. Add biosecurity contractual timer automations (1h/2h obligations).
6. Add parking offence-code evidence mode for officer/admin workflows.
7. Add Nelson Responsible Camping Bylaw profile with prohibited/restricted/NZTA land overlays.
8. Implement 500m repeat-stay detection and consent exception workflow for freedom camping.
