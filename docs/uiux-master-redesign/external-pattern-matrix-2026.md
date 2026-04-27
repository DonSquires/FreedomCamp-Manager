# External Pattern Matrix (Enterprise UI/UX 2026)

Status: completed
Date: 2026-04-26
Method: live external retrieval + source metadata capture + FieldOps module mapping

## Source Register

1. W3C WAI - What's New in WCAG 2.2
- URL: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- HTTP: 200
- Response date seen: 2026-04-26
- Last-Modified seen: 2026-04-21
- Authority: standards body

2. GOV.UK Service Manual - Design
- URL: https://www.gov.uk/service-manual/design
- HTTP: 200
- Response date seen: 2026-04-26
- Authority: public-sector service design standard

3. Atlassian Design System
- URL: https://atlassian.design/
- HTTP: 200
- Response date seen: 2026-04-26
- Last-Modified seen: 2026-04-23
- Authority: enterprise product design system

4. Material Design 3
- URL: https://m3.material.io/
- HTTP: 200
- Response date seen: 2026-04-26
- Authority: large-scale design system guidance

5. NN/g UX Articles Hub
- URL: https://www.nngroup.com/articles/
- HTTP: 200
- Response date seen: 2026-04-26
- Authority: UX research publication

6. Design Systems Repo
- URL: https://designsystemsrepo.com/
- HTTP: 200
- Response date seen: 2026-04-26
- Authority: design-system reference index

## Capability Note: Bob

Bob was asked to provide only externally sourced 2025-2026 references and responded `CANNOT_BROWSE` in this runtime. External retrieval was therefore performed directly by tooling and then synthesized.

## Pattern Matrix (10)

| # | Pattern | External Evidence | Confidence | FieldOps Module Mapping |
|---|---|---|---|---|
| 1 | Ensure focus is never obscured in dense admin UIs | WCAG 2.2 `2.4.11` from W3C page | High | core, dispatch, ticketing, incidents |
| 2 | Provide non-drag alternatives for workflow actions | WCAG 2.2 `2.5.7 Dragging Movements` | High | patrol, dispatch, parking, noise |
| 3 | Maintain minimum target sizes for operational controls | WCAG 2.2 `2.5.8 Target Size (Minimum)` | High | freedom_camping, guarding, ems, ptt_chat |
| 4 | Keep help and escalation affordances consistent across views | WCAG 2.2 `3.2.6 Consistent Help` | High | core, incidents, ticketing, ems |
| 5 | Remove repeated data entry across connected workflows | WCAG 2.2 `3.3.7 Redundant Entry` | High | core, rostering, dispatch, incidents |
| 6 | Use accessible auth patterns under pressure conditions | WCAG 2.2 `3.3.8 Accessible Authentication` | High | core, patrol, ptt_chat, ems |
| 7 | Design navigation around service tasks, not org charts | GOV.UK Service Manual design guidance emphasis on service/user tasks | Medium-High | core, dispatch, ticketing, incidents |
| 8 | Govern UI via one shared design system and component language | Atlassian Design + Material 3 + Design Systems Repo system-level evidence | Medium-High | core (platform-wide), all modules |
| 9 | Prioritize mobile-first for field-heavy workflows | NN/g hub signal (mobile-heavy), plus operational context | Medium | freedom_camping, guarding, patrol, noise, parking, ems |
| 10 | Keep AI assistance contextual and embedded in flow | NN/g hub AI signal + enterprise AI UX direction | Medium | core, incidents, dispatch, ticketing |

## Anti-Pattern Matrix (5)

| # | Anti-Pattern to Avoid | Why It Fails in 2026 Enterprise Ops | FieldOps Risk Surface |
|---|---|---|---|
| 1 | Hidden or clipped keyboard focus states | Violates WCAG 2.2 focus visibility expectations | admin controls, dense dashboards |
| 2 | Drag-only task completion | Excludes keyboard/touch-assistive alternatives | dispatch boards, assignment flows |
| 3 | Small tap targets in field workflows | Increases error rate in mobile/night use | patrol, officer, PTT surfaces |
| 4 | Re-entering known user/job data across steps | Adds friction and error in high-throughput ops | incidents, dispatch, ticketing |
| 5 | Fragmented navigation models by page owner | Causes discoverability failures and training burden | cross-module admin and mixed-role users |

## Implementation Priority Mapping

Priority 1 (must-have, standards-backed):
- Patterns 1-6 from WCAG 2.2 criteria.

Priority 2 (high leverage, governance-backed):
- Patterns 7-8 (task-based IA and design-system governance).

Priority 3 (trend-backed, workflow-validated):
- Patterns 9-10 (mobile-first and contextual AI).

## Validation Rules to Carry Into Build

1. Every new or refactored workflow must pass WCAG 2.2 checks for focus, target size, and drag alternatives.
2. Every route in `src/App.tsx` must map to one IA section and one navigation registry entry.
3. Officer/mobile pages must be tested for thumb reach and low-light interaction clarity.
4. AI-assisted actions must remain optional and never block critical human workflow completion.
