# Bob App Data Enrichment Consumption Playbook

Purpose: teach Bob how enriched data should be shaped, validated, and consumed by app workflows so data is useful for both admin and officer operations.

## 1) Data-to-Workflow Principle

Every enrichment task must answer:
- where this data will be shown in the app
- who acts on it (admin, officer, master)
- what decision it enables
- what should happen after success and failure

If no in-app workflow can consume the enriched field, treat it as optional metadata and do not block critical flows.

## 2) Required Output Model for Enriched Facts

Bob must transform extracted facts into app-ready structures:
- entity identity: org/client/site/zone ids and stable names
- operations context: access instructions, contacts, allowed windows
- safety context: hazards, controls, escalation path
- issue context: previous incidents, unresolved actions, repeat patterns
- enforcement context: jurisdiction polygon ownership and handover notes

Each enriched fact requires:
- source evidence reference
- confidence rating (high/medium/low)
- last-verified timestamp

## 3) App Surface Mapping (Must Be Declared)

### 3.1 Admin-facing usage
- intake review and approval decisions
- site and zone configuration quality checks
- risk/watchout dashboards and unresolved blocker tracking
- compliance and contract-aware operational planning

### 3.2 Officer-facing usage
- pre-visit briefing (access + H&S + likely issue types)
- on-site boundary awareness and handover guidance
- evidence capture prompts based on known issue patterns
- escalation path clarity for uncertain or unsafe conditions

## 4) Validation Against Live Schema and Runtime

Before apply writes, Bob must verify:
- target tables and columns exist in live schema/types
- org scoping and tenant isolation are preserved
- zone/jurisdiction updates remain polygon-first
- required app routes/components can consume the data

If mapping from enriched fact to app workflow is ambiguous, Bob must ask before writing.

## 5) Admin and Officer Briefing Contracts

### Admin briefing contract
Must include:
- what changed
- why it matters operationally
- what requires admin action now
- unresolved risks and ownership

### Officer briefing contract
Must include:
- what to know before arriving
- access and safety sequence
- boundary/handover cautions
- what evidence to capture if issue occurs

## 6) Failure and Fallback Behavior

If confidence is low or records conflict:
- do not silently apply risky values
- write a clarification item for operator review
- preserve evidence trail and proposed options

Fallback mode:
- keep prior stable value
- attach candidate value as pending
- mark field as review-required

## 7) Completion Gate

A data enrichment task is complete only when Bob provides:
- entity-level enrichment summary
- app surface mapping (admin + officer)
- validation evidence against live schema/runtime
- unresolved clarifications (or explicit none)
- confidence summary by entity/topic
