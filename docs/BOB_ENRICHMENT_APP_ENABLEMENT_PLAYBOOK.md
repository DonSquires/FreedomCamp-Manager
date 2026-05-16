# Bob Enrichment App Enablement Playbook

Purpose: teach Bob and the app integration layer how to operationalize enriched data so it drives decisions, not just storage.

## 1) Enrichment-to-App Contract

For every enriched entity (org/client/site/zone/location), publish an app-ready contract:
- identity: stable ids and display labels
- operational context: access and contacts
- safety context: hazards, controls, escalation
- issue context: prior incidents and unresolved actions
- enforcement context: jurisdiction ownership and boundary notes
- confidence context: confidence + evidence count + last verification

Contract rule:
- no UI should show high-certainty language if confidence is medium/low.

## 2) App Behavior by Confidence

### High confidence
- render as primary guidance
- allow auto-suggested actions
- include "verified" marker with timestamp

### Medium confidence
- render as advisory guidance
- require user confirmation before critical action
- display source summary

### Low confidence
- do not auto-apply operationally sensitive fields
- route to admin review queue
- generate clarification task

## 3) Admin Workflow Integration

Admin workflows should consume enriched data for:
- site readiness checks
- unresolved risk triage
- zone ownership conflict detection
- compliance and contract execution planning

Admin action model:
1. review enrichment delta
2. inspect confidence and evidence
3. approve, reject, or request clarification
4. assign follow-up owner and due date

## 4) Officer Workflow Integration

Officer workflows should consume enriched data for:
- pre-arrival briefing
- safe access sequence
- boundary/handover awareness
- issue-specific evidence prompts

Officer action model:
1. read pre-visit brief
2. confirm safe access conditions
3. capture required evidence if issue occurs
4. escalate using provided contact chain when uncertain

## 5) Data Quality and Drift Controls

The app should mark data as stale when:
- verification timestamp exceeds policy threshold
- source conflicts are detected
- zone geometry has changed since last enrichment pass

When stale:
- reduce confidence tier by one level
- show "review needed" badge
- prevent silent overwrite of existing trusted values

## 6) Mutation Safety Rules

Before any app-triggered write from enriched data:
- verify tenant/org scope
- verify polygon-first boundary constraints
- verify ownership and rate provenance
- attach source evidence metadata

If any check fails:
- block write
- emit clear reason
- create clarification/review item

## 7) Observability Expectations

For each enrichment application event, track:
- entity ids and org context
- fields changed
- previous value vs new value
- confidence level and source references
- operator or automation actor
- downstream workflow impact

Briefing artifact expectation:
- Generate a dedicated admin/officer briefing JSON artifact per enrichment run (default: `logs/site-roster-briefings-artifact.json`).
- Include confidence tier, admin watchouts, officer visit notes, and boundary guidance for each site.
- Previous-issues context should use schema-adaptive sourcing (`site_incidents` preferred, `incidents` by `zone_id` fallback) to stay portable across deployments.

## 8) Completion Gate

App enablement is complete only when:
- admin and officer flows can both consume the enriched contract
- confidence-aware behavior is implemented and visible
- low-confidence values are routed to review, not auto-applied
- stale/drift controls are active
- mutation safety checks are enforced
