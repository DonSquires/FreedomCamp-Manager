# RFIP + Nelson City Council Implementation To-Do

## Scope
- Primary target: Marlborough District Council RFIP service bundle.
- Secondary target: Nelson City Council service agreement readiness.
- Platform position: in-house enforcement workflow is the system of record.
- External platforms: optional interoperability adapters only when contractually required.

## Definition of Done
- Each required service has a measurable SLA dashboard and audit trail.
- Every field workflow has evidence capture, notice generation, and reporting outputs.
- Multi-council onboarding is config-driven (no council-specific code forks).
- Contract-required outputs (emails, reports, KPI packs) are automated.

## P0 - Compliance-Critical (Do First)

### 1) SLA clocking and proof for each service
- Add per-service SLA templates (noise, smoke, biosecurity, patrol, alarm, events, cash collections).
- Track and expose timestamps for dispatch, acknowledge, en-route, on-scene, completed.
- Add SLA breach reason codes (traffic, safety hold, no access, duplicate call, false alarm).
- Create council-facing SLA report views: 20-min attendance, 2-hour attendance, 1-hour notification, 2-hour report turnaround.
- Acceptance: monthly export demonstrates RFIP percentages and exception reasons per service.

### 2) Noise control RFIP evidence pack
- Confirm 24/7 intake + dispatch route for noise jobs.
- Add explicit "attended within 20 minutes" KPI widget and monthly compliance export.
- Add standardized incident report template for council handoff.
- Acceptance: one-click monthly noise compliance report and incident bundle.

### 3) Smoke control RFIP evidence pack
- Keep current smoke policy routing as default.
- Add service-level SLA reporting equivalent to noise (20-minute attendance target where required).
- Add council guideline checklist attachment to smoke incidents.
- Acceptance: smoke complaints can be audited from complaint to notice/report with timestamps.

### 4) Biosecurity strict constraints
- Enforce "no subcontracting" on biosecurity service path (contract rule gate).
- Add two timers and alerts:
  - machinery inspection attendance within 2 hours,
  - biosecurity inbox email within 1 hour for non-compliance,
  - inspection result email within 2 hours.
- Add mandatory email dispatch log with delivery status and retry queue.
- Acceptance: for any biosecurity job, the audit trail proves all timing obligations.

## P1 - Service Coverage Completion

### 5) Security patrols for council assets
- Build route templates for RFIP patrol windows and frequencies.
- Add checkpoint proof (GPS + timestamp + optional media) per site.
- Add out-of-hours alarm call-out workflow for listed facilities.
- Acceptance: patrol completion and missed-checkpoint reports per asset/site.

### 6) Ad hoc events and escort workflows
- Add event security job type presets with staffing plans and escalation tree.
- Add "escort staff to vehicle" quick job type and completion proof.
- Acceptance: ad hoc event/escort tasks can be created, dispatched, completed, and reported.

### 7) Banking consignments and cash collections
- Add dedicated cash collection run sheets and chain-of-custody fields.
- Add schedule templates for weekly collection windows by location.
- Add exception flow (late pickup, mismatch, aborted transfer) with supervisor approval.
- Acceptance: each consignment has signed handover and immutable transaction log.

### 8) Freedom camping and parking alignment for council operations
- Keep in-house parking enforcement as primary.
- Add council-specific notice wording packs and payment instructions profiles.
- Add optional import/export adapter interface for councils requiring external feed exchange.
- Acceptance: in-house flow works standalone; adapter can be turned on per council contract.

## P1 - Nelson City Council Readiness

### 9) Nelson council profile package
- Create NCC configuration profile:
  - org defaults,
  - service catalog,
  - legal notice templates,
  - SLA targets,
  - reporting recipients.
- Add LOI/zone/callsign seed pack for Nelson operational footprint.
- Acceptance: NCC can be activated from configuration without code edits.

### 10) NCC contract reporting pack
- Build NCC-specific monthly board pack template:
  - SLA attainment,
  - incident volume,
  - infringements/outcomes,
  - patrol completion,
  - exceptions and remediation.
- Acceptance: automated monthly report generated from live data.

## P2 - Training and Operational Change

### 11) Role-based SOP training bundles
- Produce admin SOPs: dispatch, review, compliance exports, exception handling.
- Produce officer SOPs: noise, smoke, biosecurity, patrol, parking, event jobs.
- Produce supervisor SOPs: escalations, safety events, performance review.
- Acceptance: training completion tracked per user and role.

### 12) Council onboarding runbook
- Create a 4-week implementation runbook:
  - week 1 data + org setup,
  - week 2 workflow config + test scenarios,
  - week 3 pilot and KPI validation,
  - week 4 production cutover and report sign-off.
- Acceptance: reusable runbook applied to MDC and NCC onboarding.

## P2 - Quality and Assurance

### 13) Contract regression suite
- Add automated tests for SLA timestamp integrity and notice generation.
- Add contract scenario tests per service area (happy path + failure path).
- Add monthly dry-run report generation checks.
- Acceptance: release gate fails if contract-critical workflows regress.

### 14) Governance and change control
- Add council-change approval flow for legal templates and SLA settings.
- Version all council configs and maintain effective-from dates.
- Acceptance: historical reports can be regenerated against prior configuration versions.

## Suggested Delivery Sequence
1. P0 SLA instrumentation and reporting.
2. P0 noise/smoke/biosecurity compliance proof.
3. P1 patrol/events/cash collection workflow closure.
4. P1 NCC profile + reporting pack.
5. P2 training, onboarding runbook, and regression hardening.

## Notes
- Keep external integrations disabled by default.
- Treat in-house workflows and data model as the legal source of truth.
- Use per-council configuration layers rather than branching logic.
