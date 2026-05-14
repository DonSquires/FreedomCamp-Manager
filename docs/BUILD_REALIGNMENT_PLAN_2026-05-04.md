# Build Realignment Plan

Date: 2026-05-04
Status: 🚀 PHASE A UNDER EXECUTION — Week 2 Complete (Foundations + Bootstrap Routes + Tests + Validators)
**Last Updated**: May 13, 2026, 22:50 UTC
**Phase A Progress**: 80% — Schemas deployed, bootstrap routes validated, org-isolation green, route/role truth green, Bob governance green, canary/ownership evidence still open
**Phase A Gate Target**: June 9, 2026 (Org Isolation Tests 5/5 ✅ + Bootstrap Routes 3/3 ✅ + Route/Role Truth ✅ + Bob Governance ✅ + Canary/ownership evidence pending)
**Next Execution**: refresh the final Phase A gate summary, then move into canary status verification and Phase B backlog preparation
### 11.2b Phase B Execution Backlog

1. Wire the normalized historical patrol draft into the actual import execution path. **Completed May 14**: Bob Assistant Studio now stages normalized historical patrol exports into `ai_import_intakes` under the approved `import_historical_patrol_data` contract.
2. Add a backend contract for normalized patrol and alarm payload staging. **Completed May 14**: shared normalized import staging contract now lives in `src/lib/importStagingContract.ts` and is threaded through patrol/alarm review flows and Bob staging prompts.
3. Convert geofence hints into site-resolution suggestions and zone fallback behavior.
4. Add org-safe audit rows for historical import acceptance, rejection, and replay.
5. Add reviewer actions for approve, stage, and reject on normalized imports.
6. Preserve idempotent external IDs end-to-end for patrol and alarm import lanes.
Scope: Whole-of-product realignment across core modules, assistive modules, Bob/AI systems, transition systems, communications, and data movement.

## 1. Objective

Realign FieldOps Manager from a page-heavy, module-fragmented application into an enterprise operations platform with:

1. A mandatory shared base system used by every module
2. Standalone-capable domain modules with clear boundaries
3. Fully integrated cross-module event flows
4. Minimal data movement and fewer page-level reads
5. Explicit AI, translation, transition, and communications architecture
6. Production-ready operational, audit, and governance gates

This plan is broader than patrol, dispatch, or PTT alone. It covers the full product surface.

## 2. Realignment Principles

1. Every module must be able to run standalone for its specialist workflow.
2. Every module must also publish and consume shared platform events.
3. Pages should compose domain hooks and stores, not own large volumes of raw data access logic.
4. Original operational records remain the source of truth; AI outputs are assistive.
5. Org and client boundaries must be enforced in storage, retrieval, realtime, exports, and communications.
6. Mobile execution, low-signal resilience, and operator speed matter as much as feature breadth.
7. Helper systems, assistive modules, Bob systems, and transition systems are first-class architecture domains.

## 3. Mandatory Base Platform

No module is production-grade without these shared capabilities.

### 3.1 Identity, Tenancy, and Access

1. Multi-org identity and role model
2. Active operational organization context
3. Authorized work location and cross-org work delegation
4. Org-safe route, query, export, and notification controls
5. Full audit of role changes and scoped access decisions

### 3.2 Operational Case Model

Every meaningful operational event must be attachable to a case or timeline.

1. Patrol run
2. Dispatch job
3. Incident
4. Enforcement chain
5. Site/access event
6. Welfare event
7. Radio event
8. Client communication

### 3.2a Case Model Mapping

The unified case model does not replace specialist source tables. It provides a normalized cross-module timeline and linking model.

1. Specialist tables remain the source of truth for their own domain records.
2. The case model links those records into one operational envelope for query, reporting, audit, and handoff.
3. Each case has one primary root record and many supporting domain events.

Minimum mapping rules:

1. `dispatch_jobs` may be a case root for dispatched work.
2. `patrols` may be a case root for patrol execution.
3. `incidents` may be a case root for incident workflows.
4. `breach_alerts`, notices, infringements, and disputes attach as enforcement-chain records.
5. `patrol_checkpoint_scans`, GPS updates, radio events, and Bob proposals attach as timeline events.

Minimum case fields:

1. `organization_id`
2. `case_type`
3. `root_table`
4. `root_record_id`
5. `status`
6. `opened_at`
7. `closed_at`
8. `client_org_id`
9. `site_id` or `loi_id`
10. `dispatch_resource_id`
11. `patrol_route_id`

### 3.3 Event and Integration Backbone

Required event families:

1. PatrolAssigned
2. PatrolStarted
3. CheckpointScanned
4. DispatchCreated
5. DispatchAssigned
6. DispatchAcknowledged
7. DispatchArrivedOnScene
8. WelfareAlertRaised
9. NoticeIssued
10. CaseClosed
11. PttTransmissionStarted
12. PttTranscriptSegmentCreated
13. OrgTransitionResolved
14. BobActionProposed
15. BobActionApproved

### 3.3a Event Sequencing Roadmap

Events are phased. Not all event families are required in the first delivery slice.

Phase A lock:

1. PatrolAssigned
2. PatrolStarted
3. CheckpointScanned
4. DispatchCreated
5. DispatchAssigned
6. DispatchAcknowledged
7. WelfareAlertRaised

Phase B lock:

1. DispatchArrivedOnScene
2. NoticeIssued
3. CaseClosed
4. OrgTransitionResolved

Phase C lock:

1. PttTransmissionStarted
2. PttTranscriptSegmentCreated
3. BobActionProposed
4. BobActionApproved

Phase D lock:

1. Client communication events
2. Costing and export events
3. Additional specialist enrichment events

### 3.4 Communications Backbone

1. PTT and radio
2. Push notifications
3. In-app notifications
4. Email
5. Later-phase SMS

### 3.5 Geo and Routing Core

1. Geofence engine
2. Zone and location resolution
3. LOI/POI/VOI linkage
4. Route planning and rerouting contract
5. Site arrival/departure event detection
6. On-site/off-site persistence

### 3.6 Data Access Standard

1. Page components should not be primary homes for most raw `supabase.from(...)` logic.
2. Domain data access should be centralized into hooks and lib services.
3. Shared query keys, cache lifetimes, and mutation patterns should be standardized.
4. Realtime and offline updates should pass through shared orchestration hooks/stores, not one-off page logic.

### 3.7 Delivery Gates

1. Org isolation test gate
2. Route/role truth gate
3. Data access duplication reduction gate
4. Realtime/offline resilience gate
5. Communications degradation gate
6. Audit/event completeness gate

### 3.7a Org Isolation Test Gate

The org isolation gate is only green when all of the following are validated:

1. Cross-org reads fail for protected operational tables.
2. Cross-org realtime leakage is zero in integration tests.
3. Cross-org exports return only in-scope records.
4. Transition events near org boundaries do not reveal foreign-org data.
5. Radio, transcript, translation, and Bob proposal records remain org-scoped in reads and exports.

Minimum scenarios:

1. Officer from Org A attempts to read Org B dispatch jobs.
2. Admin from Org A attempts to export Org B patrol or incident data.
3. Org A realtime subscriber receives Org B updates.
4. Geofence transition resolves to the wrong org.
5. Org B radio transcript rows appear in Org A diagnostics or UI.
**Automated Test Harness** (Phase A, Week 2)

- Test file: `tests/integration/org-isolation.test.ts`
- Framework: Vitest + Supabase client library
- Setup: Create 2 test orgs (Org A, Org B) with distinct data; test both authenticated users and edge functions
- 5 test scenarios (one per minimum scenario above):
  1. Cross-org query test: `SELECT * FROM dispatch_jobs WHERE organization_id != current_org_id` must return 403 or 0 rows
  2. Cross-org realtime test: Subscribe to Org B updates as Org A user; verify no messages received
  3. Export test: Generate CSV export of patrols for Org A user; verify no Org B rows
  4. Geofence transition test: Trigger transition at org boundary; verify resolved org matches officer's primary org
  5. Transcript scope test: Query radio_transcript_segments; verify only current org rows returned
- CI gate: GitHub Actions workflow `org-isolation-gate.yml` runs tests before Phase B branch protection
- Pass criteria: All 5 scenarios passing, no cross-org data leakage detected
## 4. Architecture Domains

The product is split into six realigned domains.

### 4.1 Core Operational Modules

1. Patrol and Respond
2. Dispatch and Command
3. Freedom Camping Enforcement
4. Parking Enforcement
5. Noise Control
6. Biosecurity
7. Smoke Complaints
8. EMS
9. Site Guard / Static Guard
10. Compliance, Notices, and Disputes
11. Client and CRM
12. Assets and Keys
13. Reporting and Costing
14. Roster and On-call

### 4.2 Assistive and Helper Modules

1. Access Control
2. Face Recognition
3. Identity Verification
4. Points of Interest
5. Vehicles of Interest
6. Locations of Interest
7. Site Risk Assessment
8. Evidence Capture
9. Notice and paperwork generators
10. Alert queues
11. Wearable/panic/fall/man-down integrations
12. Map and route visualization helpers

### 4.3 Intelligence and Bob Systems

1. Bob conversation and memory
2. Bob approvals and collaboration
3. Bob translation and speech assistance
4. Bob reasoning and recommendations
5. Bob multimodal and document extraction
6. Voiceprint and synthetic voice governance

### 4.4 Transition and Mobility Systems

1. Active organization resolution
2. Geofence-driven organization transition
3. Hybrid workspace handshake
4. Offline queue and reconnect
5. Realtime subscriptions and session continuity
6. GPS/session logging and operational geo context

### 4.5 Communications Systems

1. PTT runtime and channel access
2. Push notifications
3. Email system
4. Notification center and broadcast
5. Dispatch acknowledgement/escalation messaging

### 4.6 Data and Platform Services

1. Shared hooks
2. Stores
3. Domain lib services
4. Edge function adapters
5. Exports and reports
6. Diagnostics and governance tooling

## 5. Module Realignment Matrix

For each module, define standalone capability, integration contracts, and source-of-truth ownership.

### 5.0 Standalone Operationalization Rule

For this plan, a module is considered standalone when:

1. It can execute its primary workflow with only the mandatory base platform and its declared dependencies.
2. It can be tested using bounded fixtures without requiring unrelated modules.
3. It can persist valid source-of-truth records without depending on unrelated domain UIs.

Each module must declare:

1. Required shared services
2. Optional integrations
3. Fixture/bootstrap requirements
4. Go-live dependency gates

### 5.1 Patrol and Respond

Standalone responsibilities:

1. Patrol templates and route instances
2. Checkpoints and scan verification
3. Random checks and casual checks
4. Route adherence and patrol completion
5. Officer active status and patrol welfare context

Integration responsibilities:

1. Accept inserted dispatch jobs into active route plan
2. Publish route progress, checkpoint, and ETA events
3. Feed compliance, client reporting, and costing
4. Set operational callsign when patrol run is active

Source-of-truth entities:

1. patrol_routes
2. patrol_route_checkpoints
3. patrols
4. patrol_checkpoint_scans
5. roster_assignments
6. dispatch_resources

### 5.2 Dispatch and Command

Standalone responsibilities:

1. Job intake and triage
2. Assignment, acknowledgement, en route, on scene, complete
3. SLA monitoring and escalation
4. Priority queue and dispatch monitor views

Integration responsibilities:

1. Insert jobs into patrol and officer execution surfaces
2. Trigger PTT priority/channel behavior
3. Trigger welfare escalation if acknowledgements fail
4. Feed client communication and costing systems

Source-of-truth entities:

1. dispatch_jobs
2. dispatch_resources
3. job_types
4. service_agreements
5. geo_zone_dispatch_map / zone dispatch rules

### 5.3 Freedom Camping Enforcement

Standalone responsibilities:

1. Vehicle observation and validation
2. Zone and rule application
3. Breach lifecycle and notice generation
4. Evidence capture and case history

Integration responsibilities:

1. Use patrol, dispatch, and map context
2. Publish notices, disputes, and compliance results
3. Feed client reporting and legal/audit records

### 5.4 Parking Enforcement

Standalone responsibilities:

1. Permit/timed checks
2. VOI lookup
3. Infringement generation and evidence collection

Integration responsibilities:

1. Share vehicles, notices, compliance, and patrol events
2. Feed finance/costing and client visibility

### 5.5 Noise, Biosecurity, Smoke, EMS

Each specialist module must retain its own officer workflow, legal pathway, and evidence requirements while sharing:

1. Dispatch lifecycle
2. Geofence and site context
3. Bob assistive assessment
4. Client and compliance reporting
5. Cost and labor attribution

### 5.6 Site Guard / Static Guard / Security Operations

Standalone responsibilities:

1. Static guarding and checkpoint routines
2. Access control logging
3. Site POI and risk visibility
4. Emergency assist and incident logging

Integration responsibilities:

1. Use keys/assets/access-control systems
2. Publish incidents and patrol movement into unified case timelines
3. Share site context with dispatch and client modules

### 5.7 Access Control, Face Recognition, Identity Verification, POI, VOI, LOI

These are not side features. Together they form the assistive security layer.

Responsibilities:

1. Maintain person, vehicle, and place context
2. Reduce operator search effort
3. Improve site and access decisions
4. Feed intelligence, patrol, incident, and client workflows
5. Avoid duplicate person/site/vehicle lookups across pages

### 5.8 Assets and Keys

Standalone responsibilities:

1. Asset and stock management
2. Key custody and issuance/return
3. Patrol and dispatch equipment readiness

Integration responsibilities:

1. Dispatch assignment can require valid key custody
2. Patrol and site guard flows can require issued assets
3. Costing and audit trails reflect issued equipment usage

### 5.9 Roster, On-call, and Costing

Standalone responsibilities:

1. Shift planning
2. On-call periods
3. Callout shifts and travel allowances
4. Skill and availability visibility

Integration responsibilities:

1. Feed patrol run generation and dispatch candidate ranking
2. Drive payroll/costing/export logic
3. Feed notification and acknowledgement workflows

### 5.10 Client, Contact, Service Agreement, Reporting

Standalone responsibilities:

1. Client org and site records
2. Contact management
3. Service agreements and charge rules
4. Reporting and exports

Integration responsibilities:

1. Every job/patrol/notice maps to client and service agreement context
2. Reporting reads unified case and event data rather than reconstructing page-level logic

## 6. Bob and AI Realignment

Bob becomes a governed platform service, not just a page feature.

### 6.1 Bob Product Roles

1. Conversational assistant
2. Domain assessor
3. Translation assistant
4. Recommendation engine
5. Approval-required action proposer
6. Planning and route optimization assistant
7. Document and evidence summarizer

### 6.2 Bob Guardrails

1. Bob never becomes the source of truth for legal or operational records.
2. Bob proposals require explicit action pathways for approval where material.
3. Bob outputs are org-scoped, auditable, and traceable to source context.
4. Voiceprint and synthetic voice remain consent-governed and revocable.

Approval and authority rules:

1. Proposals with material operational or legal impact require approval by `admin`, `master`, or designated `approval_delegate`.
2. Approval SLA target is 30 seconds in active supervisory workflows and 5 minutes maximum in degraded/mobile conditions.
3. If approval is not received within the threshold, the proposal is marked pending escalation and cannot silently auto-apply.

Minimum executable approval path:

1. Bob writes a structured proposal row with `status = proposed` and a linked case or domain record reference.
2. The supervisor queue surfaces the proposal to an authorized approver with visible timer state.
3. An approver must explicitly approve or reject with actor ID and timestamp recorded.
4. If the SLA threshold expires, the proposal moves to `pending_escalation`, not `approved`, and a supervisor alert is emitted.
5. Only after approval may the execution service apply the downstream action and set `status = executed`.
6. Rejection, timeout, and execution failure each write distinct audit outcomes so they can be tested independently.

### 6.3 Bob Integration Contracts

1. Read from approved domain data services, not arbitrary page state.
2. Publish structured proposals, not only unstructured text.
3. Feed results into case timelines and task queues.
4. Support degraded operation when AI endpoints are unavailable.

### 6.4 Bob Audit Trail

Minimum Bob audit fields:

1. `organization_id`
2. `user_id`
3. `proposal_type`
4. `proposal_payload`
5. `source_context_refs`
6. `impact_level`
7. `status`
8. `approver_id`
9. `proposed_at`
10. `approved_at`
11. `rejected_at`
12. `executed_at`

Retention baseline:

1. 90 days minimum by default
2. Longer retention for compliance-sensitive modules where required

## 7. Translation and Speech Realignment

Translation and speech are part of the operational comms architecture.

1. Original operator audio remains primary.
2. Transcript, translation, and synthetic audio are assistive outputs.
3. Transcript and translation persistence must remain org-safe and auditable.
4. UI must show confidence, delay state, and synthetic indicators clearly.
5. Speech systems must degrade without breaking primary radio operations.

## 8. Transition System Realignment

Transition systems control movement between organizational, geographic, and operational states.

### 8.1 Responsibilities

1. Determine active operational organization
2. Resolve geofence-driven org transitions safely
3. Support hybrid workspace handshakes
4. Handle offline queue replay after reconnect
5. Preserve session continuity and GPS logging
6. Prevent cross-org leakage during transitions

### 8.2 Design Requirement

Transition logic must be centralized into tested hooks/services and event contracts. It should not be reimplemented ad hoc inside multiple pages.

### 8.3 Offline Conflict Resolution

Offline-originated operational actions must include:

1. `action_id`
2. `parent_action_id` when causally dependent
3. `organization_id`
4. `created_at_client`
5. `session_id`
6. `conflict_strategy`

Replay rules on reconnect:

1. If parent state is still valid, apply mutation idempotently.
2. If the target record has materially changed, mark the replay item as conflict-pending review.
3. If the action would cross org scope because context changed during transition, reject and log as blocked.
4. If the action already exists, mark replay as satisfied and do not create a duplicate record.

## 9. Data Storage, Retrieval, and Minimal Movement Strategy

Current repo truth indicates too much direct page-level data access. Realignment requires moving data orchestration down a layer.

### 9.1 Target Data Flow

1. Database and edge functions store canonical truth
2. Domain lib services define retrieval/mutation contracts
3. Hooks compose domain contracts for UI
4. Stores retain only hot operational state
5. Pages compose hooks and stores, avoiding large raw queries

### 9.2 Realignment Rules

1. New page features should not add large new direct Supabase query clusters when a domain hook/service can own the logic.
2. High-query pages should be refactored behind domain hooks/services first.
3. Shared data shapes should use normalized query keys and typed result mappers.
4. Realtime and offline behavior should update shared stores/hook caches, not duplicated local state islands.
5. Exports and reports should read consolidated domain views or RPCs, not rebuild logic in UI.

### 9.3 Enforcement Mechanism

These rules must be enforced, not just documented.

1. New feature PRs should not introduce large new page-level `supabase.from(...)` clusters when a domain hook/service can own the logic.
2. Add a PR checklist item requiring justification for new page-level direct data access.
3. Add a CI audit for direct page-level query-count drift on targeted files.
4. Track and publish a metric: page-level direct queries vs. hook/lib queries by domain.

### 9.4 Priority Consolidation Targets

High-fragmentation surfaces to reduce first:

1. PTTRadio
2. DispatchConsole
3. FieldOfficerPortal
4. AssetManagement
5. VehicleManagement
6. BreachAlerts
7. AdminPortal
8. NoiseControlPortal
9. ClientAccountPage
10. RosterPlanner

## 10. Communications Realignment

### 10.1 PTT

1. Runtime, access, callsign, and emergency semantics stay in a shared radio domain.
2. Callsign binding to active patrol/dispatch resource becomes explicit runtime behavior.

### 10.2 Push Notifications

1. Assignment, welfare, dispatch, and escalation notifications use one governance model.
2. Push does not replace in-app notifications or case-state updates.

### 10.3 Email

1. Standardize on one primary outbound email strategy first.
2. Use shared communication history and template infrastructure.
3. Treat invites, notices, reports, and client communications as part of the same outbound comms system.

### 10.4 Communications Degradation Paths

1. If PTT is unavailable, dispatch falls back to push plus in-app alert and records degraded comms state.
2. If push fails, the next app session must surface the alert from the notifications store.
3. If email send fails, queue retry with exponential backoff and persist delivery-failure state.
4. If translation or speech fails, original audio and core dispatch flows must continue.
5. Every degraded path must emit an audit event and visible operator state where relevant.

## 11. Delivery Program

### Phase A: Foundation Realignment

1. Define mandatory base platform contracts
2. Define event families and case model
3. Define domain ownership map
4. Define comms and transition boundaries
5. Lock data access rules for new work
6. Add feature flags and rollback controls for all new execution slices

### Phase B: Consolidate Core Operational Flows

1. Patrol and Respond
2. Dispatch and Command
3. Freedom Camping and Parking
4. Callsign and PTT runtime binding
5. Geofence and route event persistence

### Phase C: Consolidate Specialist and Assistive Layers

1. Site Guard and Security Operations
2. Access Control / Face Recognition / Identity Verification
3. POI / VOI / LOI surfaces
4. Assets / Keys / Risk / Client surfaces

### Phase D: Consolidate Bob, Translation, and Transition Systems

1. Bob contracts and approval pathways
2. Translation/speech runtime boundaries
3. Transition and handshake services
4. Offline/realtime/session behavior hardening

### Phase E: Data Movement Reduction and Enterprise Hardening

1. Migrate heavy page-level data access into hooks/services
2. Add duplication and cache reuse metrics
3. Add governance dashboards and event completeness checks
4. Add communications completeness and delivery auditing

## 11.1 Phase-to-Module Roadmap

Execution planning uses four-week delivery slices with named ownership roles.

### Phase A delivery slices

1. Slice A1, Platform Architecture Lead plus Data Platform Lead: case model, event family contract, org isolation harness, route/role truth validation
2. Slice A2, Frontend Platform Lead plus Realtime Lead: shared data-access rules, hook/service boundaries, transition contracts, feature flags and rollback controls

### Phase B delivery slices

1. Slice B1, Operations Product Lead plus Patrol Lead: Patrol and Respond route instances, checkpoints, welfare context, route event persistence
2. Slice B2, Dispatch Lead plus Realtime Lead: Dispatch and Command intake, assignment, acknowledgement, SLA events, patrol insertion contract
3. Slice B3, Communications Lead plus Patrol Lead: callsign binding, PTT runtime linkage, dispatch-to-radio escalation events
4. Slice B4, Enforcement Lead: Freedom Camping Enforcement and Parking Enforcement on the shared case/event backbone

### Phase C delivery slices

1. Slice C1, Security Operations Lead: Site Guard / Static Guard workflows and emergency assist integration
2. Slice C2, Identity and Risk Lead: Access Control, Face Recognition, Identity Verification, Site Risk Assessment
3. Slice C3, Intelligence Data Lead: POI, VOI, LOI, evidence capture, alert queues
4. Slice C4, Client Services Lead: Assets, Keys, Client, Contact, Service Agreement, Reporting integration surfaces

### Phase D delivery slices

1. Slice D1, Bob Platform Lead: Bob approval, proposal, and audit contracts
2. Slice D2, Speech and AI Lead: transcript, translation, synthetic-audio boundaries and degraded-mode controls
3. Slice D3, Mobility Lead: active-org transition services, hybrid handshake, offline replay and reconnect hardening

### Phase E delivery slices

1. Slice E1, Frontend Platform Lead: top-fragmentation page query reduction and hook/service migration
2. Slice E2, Data Platform Lead: audit dashboards, event completeness checks, domain query metrics
3. Slice E3, Communications Lead: email, push, in-app delivery auditing and retry governance

## 11.1a Module-Phase Detail Mapping

**Phase B (May 12–Aug 4)**
- B1: Patrol and Respond (Weeks 1–2)
- B2: Dispatch and Command (Weeks 3–4)
- B3: Communications (Weeks 5–6)
- B4: Freedom Camping + Parking (Weeks 7–8)

**Phase C (Aug 5–Sept 29)**
- C1: Site Guard (Weeks 1–2)
- C2: Identity & Risk (Weeks 3–4)
- C3: Intelligence (Weeks 5–6)
- C4: Client Services (Weeks 7–8)

**Phase D (Sept 30–Nov 24)**
- D1: Bob Approval (Weeks 1–2)
- D2: Translation & Speech (Weeks 3–4)
- D3: Transition & Offline (Weeks 5–8)

**Phase E (Nov 25–Jan 31)**
- E1: Page consolidation (6 weeks)
- E2: Audit dashboards (4 weeks)
- E3: Communications audit (4 weeks)

## 11.2 Execution Prerequisites

The program does not start Phase B delivery until the following Phase A prerequisites are green:

1. Org isolation test gate passes all minimum scenarios in section 3.7a.
2. One shared case model and event contract are published for patrol, dispatch, and incident timelines.
3. Feature flags and rollback controls exist for every Phase B slice.
4. At least three core routes are bootstrapped to the new case/event model in staging: Patrol and Respond, Dispatch and Command, and one enforcement surface.
5. Ownership roles are assigned for each Phase B slice and the data-access audit rule owner is named.

Parallel rule:

1. Specialist discovery work may continue during Phase A.
2. Production-facing Phase B build work does not start until all five prerequisites above are green.

## 11.2a Test Definition — Acceptance Criteria

Phase A gate is green when all 5 prerequisites have documented test evidence:

1. **Org isolation**: 5 automated test scenarios in GitHub Actions CI
   - Officer from Org A cannot read Org B dispatch_jobs
   - Realtime subscribers filtered by org
   - Exports scoped to org only
   - Geofence transitions resolve to correct org
   - Radio transcripts remain org-scoped
2. **Case model**: Schema deployed to staging, TypeScript types generated (`src/types/database.ts` includes `operational_cases` and event tables), API docs and sample payloads published
3. **Feature flags**: Supabase table created with name/org/enabled columns, naming pattern (FF_PHASE_B_*) defined, `scripts/rollback-feature-flag.sh` tested, canary procedure documented (5%→25%→50%→100% with error/latency thresholds)
4. **Bootstrap routes**: 3 routes (field-officer, dispatch-console, breaches) running on case model in staging, E2E smoke test `tests/e2e/bootstrap-routes.test.ts` passing (validates patrol dispatch insertion, job creation/assignment, enforcement timeline creation)
   - Authoritative execution path for this gate is Ubuntu CI or RunPod serverless `run_playwright`, not local Alpine Playwright shells.
5. **Ownership**: 8 roles assigned, GitHub team (@DonSquires/team-realignment) updated, Slack confirmation thread created, each lead confirms capacity in #realignment-kickoff

**Note**: Sections 11.2a (prerequisite definition) and 12.1 Phase Gate Criteria (gate definition) together form the Phase A acceptance framework. All criteria in both sections must be satisfied before Phase B production rollout is authorized.

## 11.2b Sprint Calendar

**Phase A: May 12–June 9 (4 weeks)**
- Week 1 (May 12–18): Case model schema, org isolation test framework, event contract
- Week 2 (May 19–25): Org isolation automated tests (5 scenarios), feature flags table
- Week 3 (May 26–Jun 1): Route/role truth validation, Phase B bootstrap (3 routes)
- Week 4 (Jun 2–9): Org isolation gate pass, prerequisite verification
- **Critical: Org isolation gate GREEN by June 9 (go/no-go point)**

**Phase B: June 10–August 4 (8 weeks)**
- Critical path: Dispatch acceptance (B2 Weeks 3–4) required before later phases

**Phase C: August 5–September 29 (8 weeks)**
- Depends on Phase B gate passed + assistive patterns proven

**Phase D: September 30–November 24 (8 weeks)**
- Depends on Phase C gate passed + offline fully validated

**Phase E: November 25–January 31 (10 weeks)**
- Data consolidation, operational metrics, production hardening

**No-go decision gates:**
- June 9: Org isolation red → Phase A extends 2 weeks
- July 28: Dispatch red → escalate, consider design pivot
- Sept 29: Bob red → defer to Phase E

## 12.1 Feature Flags and Rollback

Every realignment phase must ship behind explicit rollout controls.

1. Phase A flags gate foundational contracts without changing operator behavior by default.
2. Phase B and later phases require canary rollout before broad enablement.
3. Rollback must be defined per slice: disable flag, preserve source records, and log reversal reason.
4. PTT, Bob, translation, transition, and communications changes require degraded-mode validation before broad enablement.

## 12.1a Feature Flag Implementation

**Flag Storage**: Supabase `feature_flags` table with columns: `id UUID`, `organization_id`, `flag_name VARCHAR (unique)`, `enabled BOOLEAN`, `owner_role`, `created_at`, `rollback_reason VARCHAR (nullable)`

**Rollout Pattern** (example FF_PHASE_B_PATROL):
- Canary (Weeks 1–2): 5% (1 test org), error rate < 1%, latency p95 < 500ms
- Early adopter (Weeks 3–4): 25% (5 orgs)
- Broad (Weeks 5–6): 50% (13 orgs)
- GA (Weeks 7–8): 100%

**Rollback Procedure**: `scripts/rollback-feature-flag.sh FF_PHASE_B_PATROL "reason"` disables flag, preserves source records, logs to `rollback_audit` table, alerts ops on Slack

**Degraded-mode validation**: E2E test `tests/e2e/flag-teardown-safety.test.ts` verifies source records remain valid if flag disables mid-workflow

## 12.1b Data Migration Plan

**Case Model Migration Script**: `supabase/migrations/202605_case_model.sql`

**Backfill Strategy**:
1. Phase 1 (offline): Create null-filled `operational_cases` rows for existing patrols, dispatch jobs, incidents (no downtime)
2. Phase 2 (online, Phase B start): Edge Function `backfill-cases` trickles `case_events` from existing records
3. Phase 3 (cutover, Phase B + 1 week): Route/page traffic flipped to reads from cases; old tables remain as fallback

**Cutover SLA**: 2 hours per org (rolling maintenance window)
**Rollback**: Re-enable fallback reads to `patrols`, `dispatch_jobs` tables if case reads error
**Validation Test**: `tests/migrations/validate-case-model.test.ts` checks row counts, referential integrity, org scoping

## 12. Review Gates

The plan is not green until all of the following are true:

1. Core operational modules are covered
2. Assistive/helper modules are covered
3. Bob/AI/translation systems are covered
4. Transition systems are covered
5. Communications systems are covered
6. Data storage/retrieval/movement realignment is covered
7. Standalone and integration responsibilities are explicit for each domain
8. No blocker remains for org isolation, auditability, or degraded-operation behavior
9. Org isolation test gate is independently green before any Phase B production rollout

## 12.1 Phase Gate Criteria

### Phase A gate

Phase A gate is green when all criteria below are satisfied. These criteria correspond directly to the 5 prerequisites and test definitions in section 11.2a:

1. **Case model and event family contract**: Schema deployed to staging with generated TypeScript types (`src/types/database.ts`), API docs published, sample payloads documented (per 11.2a prerequisite #2).
2. **Org isolation**: All 5 automated test scenarios pass in GitHub Actions CI—officer read isolation, realtime filtering, export scoping, geofence transitions, transcript scoping (per 11.2a prerequisite #1).
3. **Bootstrap routes smoke test**: 3 routes (field-officer, dispatch-console, breaches) pass E2E test suite `tests/e2e/bootstrap-routes.test.ts`
   - Field officer patrol dispatch insertion → creates dispatch_job record with correct case_id
   - Dispatch console job list → reflects latest dispatch_jobs with status transitions
   - Breaches surface → enforcement timeline creation on dispatch completion
   - All routes return case-model data with org scope, no cross-org leakage (per 11.2a prerequisite #4).
   - Accepted evidence source: GitHub Actions Ubuntu runner or RunPod serverless `run_playwright` result attached to STAGING/session evidence.
4. **Feature flags and rollback**: Supabase table created with FF_PHASE_B_* naming pattern, canary rollout procedure tested (5%→25%→50%→100%), `scripts/rollback-feature-flag.sh` verified (per 11.2a prerequisite #3).
5. **Ownership and role assignment**: All 8 team leads confirmed in GitHub @DonSquires/team-realignment, Slack confirmation thread #realignment-kickoff has capacity sign-off (per 11.2a prerequisite #5).

### Phase B gate

1. Phase A gate is green.
2. Patrol, Dispatch, and one enforcement surface run on the shared timeline contract in staging.
3. Callsign binding and dispatch acknowledgement flows are executable end to end.
4. Ownership and support rota are assigned for all active slices.

### Phase C gate

1. Phase B gate is green.
2. Security assistive surfaces resolve people, vehicle, and place context from shared contracts.
3. Site guard and assistive workflows attach to the same case/timeline model.

### Phase D gate

1. Phase C gate is green.
2. Bob approval, translation, and transition services are auditable and degraded-mode safe.
3. Offline replay conflict handling passes defined test scenarios.

### Phase E gate

1. Phase D gate is green.
2. Target fragmentation pages show downward direct-query drift.
3. Communications delivery audit and retry metrics are visible in operations dashboards.

## 13. Success Criteria

The build is considered realigned when:

1. Users experience fewer context switches between specialist and helper surfaces.
2. New features land through domain services/hooks rather than page-local query clusters.
3. Dispatch, patrol, welfare, PTT, and geofence events form one coherent operational timeline.
4. Bob outputs are governed, traceable, and integrated into operational flows safely.
5. Transition systems are centralized, tested, and visible as product infrastructure.
6. Communications are treated as platform infrastructure, not page-specific utilities.
7. Data movement is minimized through shared contracts, caching, and event-driven updates.

## 13.1 Baselines and Measurable Targets

Program success is measured against explicit repo-grounded baselines.

1. Route surface baseline: 122 routes in the current router; target is route/role truth validation on 100 percent of production routes before Phase B go.
2. Product surface baseline: 129 pages, 145 feature components, 74 hooks, 13 stores, and 68 lib modules; target is explicit domain ownership assignment across all six architecture domains before Phase B go.
3. Data-access baseline: direct data access remains heavily page-distributed with 688 page-level accesses, 176 hook-level accesses, and 85 lib-level accesses; target is downward drift in each Phase E release, starting with the ten priority surfaces in section 9.4.
4. Org-isolation baseline: minimum scenarios are defined in section 3.7a; target is all five minimum scenarios automated and green before any Phase B production rollout.
5. Bob audit baseline: structured audit requirements are defined in section 6.4; target is 100 percent of Bob proposals carrying proposal status, approver outcome, and execution outcome fields before Phase D rollout.
6. Offline replay baseline: conflict rules are defined in section 8.3; target is test coverage for duplicate replay, stale parent state, org-scope drift, and satisfied-idempotent replay before Phase D rollout.
7. Operator workflow baseline: current dispatch, patrol, welfare, PTT, and geofence flows remain fragmented across multiple pages; target is one shared timeline contract visible across these flows in staging before Phase B exit.

## 13.2 Ownership and Enforcement

Named people can be assigned later, but ownership roles are mandatory now.

1. Platform Architecture Lead owns the case model, event backbone, and phase gate reporting.
2. Data Platform Lead owns the data-access audit rule, CI drift checks, and domain query metrics.
3. Frontend Platform Lead owns page-to-hook/service migration standards and feature-flag rollout wiring.
4. Realtime Lead owns dispatch event delivery, subscription safety, and session continuity enforcement.
5. Communications Lead owns PTT binding, push, email, in-app delivery degradation paths, and audit visibility.
6. Bob Platform Lead owns approval queue behavior, proposal audit completeness, and Bob execution guardrails.
7. Mobility Lead owns transition services, geofence-org resolution, offline replay, and reconnect validation.
8. Operations Product Lead owns module sequencing across patrol, dispatch, enforcement, and specialist workflows.

## 13.2a Capacity & Resource Plan

**Phase A (May 12–July 7)**
- Platform Architecture Lead: 80% (case model, event backbone, gate reporting)
- Data Platform Lead: 70% (org isolation, CI audit setup)
- Frontend Platform Lead: 60% (feature flags, hook/service standards)
- Realtime Lead: 50% (dispatch events, realtime safety)
- Ops Product Lead: 40% (resource coordination)

**Phase B (June 10–Aug 4, overlaps Phase A)**
- Ops Product Lead: 80%, Patrol Lead: 100%, Dispatch Lead: 100%, Comms Lead: 80%, Enforcement Lead: 80%
- Platform Arch Lead: 30% (gate verification)

**Phase C–E: Scaling**
- Phase C: 8 leads at 70–100%
- Phase D: 3 leads at 100%, others 20–30% advisory
- Phase E: 3 leads at 80–100%

**Go-live Readiness**: Slack thread #realignment-kickoff (created June 1) collects capacity confirmation from each lead by June 9. Unresolved blockers trigger Phase B deferral of 1 week.
