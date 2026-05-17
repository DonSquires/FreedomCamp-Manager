# Source Requirements Matrix (2026-05-17)

## Scope and coverage

This matrix is grounded on the full local storage-review corpus currently indexed from Supabase buckets:
- Total unique extracted documents reviewed: 40
- Source indexes:
  - [tmp/docs/storage-review/index.json](tmp/docs/storage-review/index.json)
  - [tmp/docs/storage-review/new-doc-index.json](tmp/docs/storage-review/new-doc-index.json)

Primary evidence groups used in this matrix:
- First Security source pack:
  - [tmp/docs/storage-review/001_Service-Contracts__First-Security-Docs_Council_Capability_Statement.docx.txt](tmp/docs/storage-review/001_Service-Contracts__First-Security-Docs_Council_Capability_Statement.docx.txt)
  - [tmp/docs/storage-review/002_Service-Contracts__First-Security-Docs_D365_Cost_Centre_Mappings_Tool_with_Account_Structure_.xlsx.txt](tmp/docs/storage-review/002_Service-Contracts__First-Security-Docs_D365_Cost_Centre_Mappings_Tool_with_Account_Structure_.xlsx.txt)
  - [tmp/docs/storage-review/003_Service-Contracts__First-Security-Docs_LINZ_Weekly_Incidents_Report_04-01-26.docx.txt](tmp/docs/storage-review/003_Service-Contracts__First-Security-Docs_LINZ_Weekly_Incidents_Report_04-01-26.docx.txt)
  - [tmp/docs/storage-review/004_Service-Contracts__First-Security-Docs_West_Coast_Regional_Council_3.docx.txt](tmp/docs/storage-review/004_Service-Contracts__First-Security-Docs_West_Coast_Regional_Council_3.docx.txt)
- Tender and contract documents:
  - [tmp/docs/storage-review/007_Service-Contracts__MDC-Documentation_26-007_Security_other_Services_RFIP-_24_03_2026_1_.PDF.txt](tmp/docs/storage-review/007_Service-Contracts__MDC-Documentation_26-007_Security_other_Services_RFIP-_24_03_2026_1_.PDF.txt)
  - [tmp/docs/storage-review/011_Service-Contracts__Nelson-City-Council_FINAL_FOR_SIGNING_-_Contract_No_4038_Minor_Services_-_Security_Services_for_Council_Facilities_29July2020_A2430768_.pdf.txt](tmp/docs/storage-review/011_Service-Contracts__Nelson-City-Council_FINAL_FOR_SIGNING_-_Contract_No_4038_Minor_Services_-_Security_Services_for_Council_Facilities_29July2020_A2430768_.pdf.txt)
  - [tmp/docs/storage-review/022_Service-Contracts__Nelson-City-Council_Sevice_schedule_mock_up_April_26.docx.txt](tmp/docs/storage-review/022_Service-Contracts__Nelson-City-Council_Sevice_schedule_mock_up_April_26.docx.txt)
- Operational/training and historical datasets:
  - [tmp/docs/storage-review/003_Parking-Managment__NZTA_Warden_training_guidelines_version_1_codes.docx.txt](tmp/docs/storage-review/003_Parking-Managment__NZTA_Warden_training_guidelines_version_1_codes.docx.txt)
  - [tmp/docs/storage-review/001_Historical_records_Downer_LINZ__Vehicle_Log_10-3-26.xlsx.txt](tmp/docs/storage-review/001_Historical_records_Downer_LINZ__Vehicle_Log_10-3-26.xlsx.txt)
  - [tmp/docs/storage-review/002_Historical_records_Downer_LINZ__Vehicle_Log_19-3-26.csv.txt](tmp/docs/storage-review/002_Historical_records_Downer_LINZ__Vehicle_Log_19-3-26.csv.txt)
  - [tmp/docs/storage-review/026_Service-Contracts__Wilsar-Data_Nelsn_Alarm-Noise_control_historical_data.csv.txt](tmp/docs/storage-review/026_Service-Contracts__Wilsar-Data_Nelsn_Alarm-Noise_control_historical_data.csv.txt)
  - [tmp/docs/storage-review/027_Service-Contracts__Wilsar-Data_Nelson_Patrol_Historical_data.csv.txt](tmp/docs/storage-review/027_Service-Contracts__Wilsar-Data_Nelson_Patrol_Historical_data.csv.txt)

## Grounded requirements to implementation mapping

| Requirement theme | Source evidence | Current app surfaces | Schema/runtime surfaces | Gap status | Execution ticket |
|---|---|---|---|---|---|
| Multi-service tender capability (noise, smoke, patrols, biosecurity, event, cash) | RFIP and capability docs | [docs/INSTRUCTION_MANUAL.md](docs/INSTRUCTION_MANUAL.md), [src/navigation/routeManifest.ts](src/navigation/routeManifest.ts), [src/App.tsx](src/App.tsx) | Service configuration and contracts | Partial | SPM-001: enforce service matrix per contract profile |
| Contract profile import must drive behavior | NCC + First Security contract docs and seeds | [scripts/import-service-provider-profile.mjs](scripts/import-service-provider-profile.mjs), [src/pages/ServiceAgreements.tsx](src/pages/ServiceAgreements.tsx) | [supabase/migrations/20260517170000_service_agreement_obligations_and_client_access.sql](supabase/migrations/20260517170000_service_agreement_obligations_and_client_access.sql) | In progress | SPM-002: add importer validation report artifact |
| SLA obligations and proof requirements per service | NCC schedules, LINZ weekly report, RFIP text | [src/pages/Reports.tsx](src/pages/Reports.tsx), [src/pages/DispatchConsole.tsx](src/pages/DispatchConsole.tsx) | service_agreements + service_agreement_obligations | Partial | SPM-003: SLA breach reason and proof checklist enforcement |
| Monthly compliance report packs must be template-driven | NCC monthly template + service schedule mock-up | [src/pages/Reports.tsx](src/pages/Reports.tsx) | monthly_report_template_code and metadata exports | In progress | SPM-004: fixed-format monthly pack generator per client contract |
| Client portal visibility and finance controls by policy | RFIP and contract governance expectations | [src/pages/ClientOrganisationPortal.tsx](src/pages/ClientOrganisationPortal.tsx), [src/pages/InvoicingPage.tsx](src/pages/InvoicingPage.tsx), [src/hooks/useClientAccessPolicy.ts](src/hooks/useClientAccessPolicy.ts) | org_module_subscriptions config and service_agreements policy fields | In progress | SPM-005: add policy audit endpoint/report |
| D365/Business Central finance linkage | D365 mapping workbook and contract finance context | [src/pages/ClientSites.tsx](src/pages/ClientSites.tsx), [docs/LIVE_SCHEMA.md](docs/LIVE_SCHEMA.md) | m365_customer_id, m365_contract_ref, m365_cost_centre | Partial | SPM-006: D365 mapping import and cross-check validator |
| LINZ weekly incident model and patrol evidence capture | LINZ weekly report and historical vehicle logs | [src/pages/FieldOfficerPortal.tsx](src/pages/FieldOfficerPortal.tsx), [src/pages/OperationsMap.tsx](src/pages/OperationsMap.tsx), [src/pages/Disputes.tsx](src/pages/Disputes.tsx) | incidents, evidence storage, report exports | Partial | SPM-007: weekly LINZ report auto-assembler |
| Officer dispatch/job receipt and progression lifecycle | training docs + instruction manual dispatch sections | [src/pages/FieldOfficerDispatch.tsx](src/pages/FieldOfficerDispatch.tsx), [src/pages/DispatchedJobsList.tsx](src/pages/DispatchedJobsList.tsx), [src/pages/DispatchMonitor.tsx](src/pages/DispatchMonitor.tsx) | dispatch jobs/status and SLA clocks | Partial | SPM-008: enforce mandatory ack/en-route/on-scene transitions |
| Parking enforcement evidentiary rigor | NZTA warden training manual | [src/pages/ParkingEnforcementPortal.tsx](src/pages/ParkingEnforcementPortal.tsx), [src/pages/ParkingOfficerPortal.tsx](src/pages/ParkingOfficerPortal.tsx), [src/components/features/ScanDetailPanel.tsx](src/components/features/ScanDetailPanel.tsx) | notice evidence artifacts and offense metadata | Gap | SPM-009: offense-code evidence mode and appeal bundle export |
| Historical operational baseline import | Wilsar/Downer/Deputy datasets | [scripts/import-service-provider-profile.mjs](scripts/import-service-provider-profile.mjs), [docs/STAGING.md](docs/STAGING.md) | import scripts and baseline tables | Partial | SPM-010: historical KPI backfill pipeline with provenance log |
| Branch-to-region service-provider routing | First Security jurisdiction docs and map | [scripts/bootstrap-first-security-orgs.mjs](scripts/bootstrap-first-security-orgs.mjs), [docs/FIRST_SECURITY_BRANCH_JURISDICTIONS.md](docs/FIRST_SECURITY_BRANCH_JURISDICTIONS.md) | organizations hierarchy and branch context | In progress | SPM-011: contract-to-branch assignment guardrail |
| Tender response reproducibility (evidence to capability trace) | RFIP + capability docs + real history files | [docs/STAGING.md](docs/STAGING.md), [docs/First-Security-Docs/README.md](docs/First-Security-Docs/README.md) | docs-to-feature traceability | Gap | SPM-012: automated source-to-feature trace report |

## High priority rollout sequence

1. SPM-009: parking offense evidence mode and appeal bundle export.
2. SPM-006: D365 mapping import and validator against current client site records.
3. SPM-004: monthly report pack generator with contract template binding.
4. SPM-007: LINZ weekly incident report assembler from live incidents/evidence.
5. SPM-010: historical baseline import and KPI backfill with provenance.
6. SPM-012: source-to-feature trace report for tender submission confidence.

## Decision notes

- The source corpus includes duplicates for the same RFIP artifact in evidence/tenders and service contracts. Requirements are de-duplicated by business meaning.
- CSV/XLSX-heavy files represent real operational history and finance mappings; they are treated as implementation-driving data, not just reference documents.
- Some PDF derivatives have sparse extracted text in prior ingest artifacts, so contract obligations should be validated against the richer related files already in the same source family before any schema assumptions.

## Completion marker

This matrix is the current canonical bridge between bucket-source evidence and app implementation alignment for the 2026-05-17 ingest pass.
