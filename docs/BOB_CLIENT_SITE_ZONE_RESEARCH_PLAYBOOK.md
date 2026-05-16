# Bob Client, Site, Zone, and Organization Research Playbook

Purpose: require Bob to research each organization, client, site, zone, and location context before enrichment writes so operationally relevant facts are captured safely.

## 1) Mandatory Scope Per Enrichment Task

For every target record set, Bob must build a research dossier for:
- organization
- client
- site
- zone/jurisdiction polygon
- physical location context (address, access profile, surrounding risk context)

No apply writes are allowed until dossiers are complete or explicit user override is provided.

## 2) Required Research Topics (Pertinent Context)

### 2.1 Access and Site Operations
- access method (gate, lockbox, keypad, office contact, after-hours process)
- permitted entry windows and restricted periods
- parking or vehicle access constraints
- known communication channel for site arrival/escalation

### 2.2 Health and Safety (H&S)
- known hazards and controls
- PPE expectations
- incident escalation path and emergency contact points
- special handling requirements (biosecurity/noise/smoke/traffic interfaces)

### 2.3 Previous Issues and Risk History
- prior incidents/breaches relevant to the site or zone
- repeat offender patterns or repeat complaint classes
- known boundary confusion hotspots and handover points
- unresolved actions from prior patrol or admin review

### 2.4 Client and Organization Context
- what the client does (service domain/operating purpose)
- contractual or policy constraints affecting enforcement
- provider-client ownership and responsibility boundaries
- key operational sensitivities admins should monitor

### 2.5 Role-Specific Briefing Outputs
Admin briefing must include:
- operational risks and unresolved blockers
- data quality/provenance concerns
- policy/compliance implications
- recommended app actions and follow-up owners

Officer briefing must include:
- what to know before visiting the site
- safe access sequence and contact/escalation path
- likely issue types and expected evidence capture
- zone boundary awareness and handover guidance

## 3) Source and Verification Rules

Use source priority:
1. system_state and policy/training truth docs
2. live database/app records
3. validated scripts and run artifacts
4. new candidate documents and external references

Verification expectations:
- map each critical fact to at least one evidence source
- mark each fact with confidence: high, medium, low
- if low confidence on access, H&S, ownership, or zone boundary, ask before write

## 4) Dossier Template (Required)

Each dossier must include:
- entity id and label (org/client/site/zone/location)
- purpose summary (what this entity does in ops context)
- access profile
- H&S profile
- previous issue summary
- admin watchouts
- officer visit brief
- source evidence list
- confidence and open questions

## 5) Write-Blocker Rules

Stop and ask before apply if any of the following are unclear:
- who owns responsibility (client vs provider)
- exact site or zone boundary authority
- access instructions that could create officer safety risk
- H&S requirements with missing controls
- issue history conflicts between docs and live records

## 6) Completion Gate

Enrichment is complete only when:
- all in-scope entities have dossiers
- admin and officer briefing outputs are present
- unresolved safety/ownership/boundary conflicts are zero or explicitly approved
- final summary includes confidence and pending clarifications
