# External Enterprise UI/UX Research (2026)

Status: completed in current session
Date: 2026-04-26
Method: live external source checks from this runtime plus Bob capability validation

## 1) Scope

Research targets:
- Enterprise IA and navigation patterns
- Accessibility requirements relevant to 2026 delivery
- Mobile-first and field-operations ergonomics
- Design-system governance patterns
- AI assistant integration signal in UX research ecosystem

## 2) Source Checks Performed

Verified reachable from this environment:

1. W3C WAI (WCAG 2.2 updates)
- URL: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- Evidence captured: page title and WCAG 2.2 success criteria names.

2. GOV.UK Service Manual (Design)
- URL: https://www.gov.uk/service-manual/design
- Evidence captured: page reachable and design guidance surface present.

3. NN/g Articles Hub
- URL: https://www.nngroup.com/articles/
- Evidence captured: page title and directional keyword frequency (AI, mobile, navigation, accessibility).

4. Material Design 3
- URL: https://m3.material.io/
- Evidence captured: metadata description confirming adaptable system and high-quality experiences focus.

5. Design Systems Repo
- URL: https://designsystemsrepo.com/
- Evidence captured: source title confirms design-system resource indexing.

## 3) Concrete Findings Used for Redesign

1. WCAG 2.2 adds interaction constraints that must be first-class in enterprise UX:
- 2.4.11 Focus Not Obscured (Minimum) (AA)
- 2.5.7 Dragging Movements (AA)
- 2.5.8 Target Size (Minimum) (AA)
- 3.2.6 Consistent Help (A)
- 3.3.7 Redundant Entry (A)
- 3.3.8 Accessible Authentication (Minimum) (AA)

Design implication:
- Focus visibility, non-drag alternatives, minimum targets, stable help placement, reduced repeated entry, and authentication ergonomics must be explicit acceptance criteria.

2. Public-sector service design guidance remains a practical benchmark for operational systems:
- GOV.UK design manual signal supports simplicity, consistency, and service-task focus over decorative complexity.

Design implication:
- Mission-first IA and task-completion flows remain the primary pattern for admin and field workflows.

3. Design-system maturity is still a core enterprise differentiator in 2026:
- Material 3 and design-system indexes reinforce component governance, pattern reuse, and scalable UX consistency.

Design implication:
- A single navigation registry and shared page anatomy are necessary to prevent drift.

4. UX research ecosystem signal still emphasizes AI and mobile topics:
- NN/g article hub keyword signal is heavily mobile/AI weighted in sampled page markup.

Design implication:
- Keep AI assistant surfaces contextual and non-blocking; keep mobile-first field ergonomics and offline-aware interactions central.

## 4) Bob Collaboration Outcome

Direct Bob external browsing capability check result:
- Prompt asked Bob to provide only externally sourced 2025-2026 references with URLs and dates.
- Bob response: `CANNOT_BROWSE`.

Conclusion:
- In this runtime, Bob can synthesize but cannot independently browse the web.
- External retrieval must be done by Copilot/tooling, then provided to Bob for synthesis.

## 5) Confidence and Limits

High confidence:
- WCAG 2.2 criteria relevance and direct applicability.
- Need for navigation/system consistency and design-system governance.

Medium confidence:
- Trend weighting from NN/g hub-level keyword sampling (directional, not full corpus analysis).

Limitations:
- This pass used targeted source extraction, not a full literature review.
- Some modern design-system sites are JS-heavy; extracted evidence is metadata-level unless deep scraping is added.

## 6) Recommended Next External Pass (Optional)

1. Build a curated source list with explicit publication/update dates per finding.
2. Add 10-15 enterprise SaaS benchmark screenshots and interaction notes.
3. Run a structured pattern matrix: pattern, source, confidence, FieldOps module impact.
