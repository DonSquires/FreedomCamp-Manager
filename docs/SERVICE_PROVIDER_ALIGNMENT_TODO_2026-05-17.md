# Service Provider Alignment Todo (2026-05-17)

## Objective
Bring the current app into alignment with the instruction manual and the live service-provider contract corpus, while allowing each client organisation to be configured for either:
- full contracted module access
- limited stats, reports, disputes, and finance access

## P0
- Build the contract obligation schema described in the grounded plan: contracts, services, facility matrices, obligation rules, and report templates.
- Add SLA clock abstraction across dispatch, patrol, alarm, noise, smoke, and biosecurity jobs.
- Add proof-artifact requirements per service type so every contract-critical task has an enforceable evidence checklist.
- Add monthly council report pack generation using contract-aware templates and recipients.
- Add client-access policy configuration so each organisation can be set to `full_modules` or `transparency_only`.

## P1
- Extend the client portal with a Reports area that can generate PDF and CSV outputs scoped to the client's contracted sites.
- Extend the client portal with a Finance area for invoice download and payment-status visibility when billing integration is enabled.
- Extend the client portal with Disputes visibility and provider-contact workflows for client-admin roles.
- Add client-officer incident logging from the client portal, scoped to permitted sites.
- Align route guards so client roles can reach the client-approved reporting and finance surfaces without granting admin access.

## P1 Nelson / Council Config
- Add Nelson Responsible Camping Bylaw profile imports for prohibited, restricted, and NZTA-declared areas.
- Implement 500m repeat-stay detection and consent exception workflows.
- Implement temporary closure overlays and revocation-aware consent handling.
- Add offence support aligned to bylaw restrictions and the Freedom Camping Act 2011.

## P1 Service Execution
- Implement facility-service-frequency execution for patrols, lock and unlock, alarm first response, and static guard assignments.
- Add response-proof packets for alarm and urgent dispatch jobs.
- Add biosecurity timer automations for 1-hour and 2-hour contractual obligations.
- Add parking evidence checklist mode and appeal-bundle export based on the NZTA training material.

## P2
- Import Wilsar historical patrol, alarm, and noise data for KPI baselining.
- Import Deputy site and workforce mappings for schedule alignment.
- Add client-facing scheduled report subscriptions where the contract permits them.
- Add client finance summaries to show invoice totals, paid totals, overdue counts, and recent billing periods.
- Add cross-council profile packs so Nelson, Marlborough, and future councils can be onboarded by configuration instead of bespoke branching.

## Acceptance Standard
- The service provider can operate the app as the primary contract-delivery system.
- A client can be configured for either full operational visibility or a limited stats/reports/finance shell.
- Client route access matches the instruction manual for client roles.
- Council monthly reporting can be produced from the system without manual spreadsheet reconstruction.
- Contract SLA breaches and proof gaps are visible in-app before they become customer escalations.