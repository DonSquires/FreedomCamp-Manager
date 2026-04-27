# Self-Critique: FieldOps Master UI/UX Redesign Spec

Status: required adversarial self-review
Date: 2026-04-26

## Core Flaws Identified

1. IA ambition may be too broad for one release train
- The spec touches nearly every primary surface and could produce delivery paralysis.
- Risk: teams attempt full rewrite instead of phased migration.

2. Registry centralization is technically clear but adoption-heavy
- Existing code has multiple nav and route patterns.
- Risk: partial migration creates temporary dual systems and inconsistency.

3. Officer workflow improvements are under-specified in execution detail
- The spec defines outcomes but not enough concrete component-level sequencing for high-pressure field moments.
- Risk: field UX regressions if admin-led patterns dominate implementation.

4. KPI targets need baseline instrumentation before being enforceable
- Targets (discoverability, taps-to-action, detours) require event definitions not yet standardized.
- Risk: success claims become subjective.

5. Organizational context behavior needs stronger definition
- The spec states org awareness but does not yet codify exact cross-org switching and data reset mechanics.
- Risk: tenant context leakage through cached UI state.

## Corrections Applied To Planning

1. Enforce section-by-section rollout with strict phase gates.
2. Make registry adoption phase one and block feature UI rewrites until parity checks pass.
3. Add dedicated officer interaction packet in implementation plan.
4. Add metrics instrumentation sprint before UX KPI measurement.
5. Require explicit org context and cache invalidation contract in plan tasks.
