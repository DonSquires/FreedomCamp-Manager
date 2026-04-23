# ADR 000: Template

## Status

Proposed

## Context

Describe the problem, constraints, tenant boundaries, and runtime conditions.

## Decision

State the chosen approach and why it was selected.

## Consequences

- Positive effect
- Tradeoff
- Follow-on constraint Bob must remember

## Verification

- Tests or checks required
- Dr Bob review artifact path

## Mermaid

```mermaid
sequenceDiagram
    participant User
    participant Bob
    participant DrBob
    User->>Bob: Propose architecture change
    Bob->>DrBob: Submit plan for adversarial review
    DrBob-->>Bob: Return blockers and risks
    Bob-->>User: Present revised plan
```
