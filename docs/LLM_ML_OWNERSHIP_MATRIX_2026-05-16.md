# LLM vs ML Responsibility Matrix (Active)

Date: 2026-05-16
Scope: Bob and AI workflow delivery across app, gateway, policy, evaluation, and model lifecycle
Status: Active operating contract for parallel specialist execution

## Purpose

Prevent role overlap while both specialists work on Bob and LLM-adjacent features.

- LLM Engineer owns application-layer LLM systems.
- ML Engineer owns model-layer training and algorithmic optimization.

## Ownership Rules

### LLM Engineer owns

1. System prompts, guardrails, and policy sections in runtime prompt assembly.
2. Tool-calling orchestration and execution gating in app/gateway logic.
3. Memory and retrieval context design (what context is selected and why).
4. Reason-code propagation, confidence framing, and decision explainability payloads.
5. LLM eval harnesses for policy compliance, hallucination checks, and regression suites.
6. Runtime reliability: fallback routing, retry behavior, timeout policy, and safe degradation.
7. Product/manual parity for AI behavior claims.

### ML Engineer owns

1. Model training, fine-tuning, and parameter optimization.
2. Feature engineering and algorithm design for ranking/classification/scoring components.
3. Dataset curation, labeling strategy, and data quality controls for training corpora.
4. Offline model evaluation methodology (precision/recall/F1/AUC, calibration, drift stats).
5. Inference optimization at model-runtime level (quantization, batching, throughput tuning).
6. Model versioning strategy and promotion criteria between model variants.
7. Monitoring model quality drift and retraining triggers.

### Shared (must coordinate)

1. Inference model selection policy: ML proposes, LLM validates runtime impact.
2. Confidence semantics shown to operators: ML provides metric source, LLM defines UX-safe presentation.
3. Safety boundaries: LLM defines policy constraints, ML validates model behavior under adversarial inputs.
4. Incident response for bad outputs: LLM patches guardrails now, ML schedules training remediation.

## Decision Matrix (Single Owner)

| Work item | Primary owner | Secondary reviewer |
|---|---|---|
| Prompt template changes | LLM Engineer | ML Engineer |
| Tool contract schema for Bob actions | LLM Engineer | Backend Engineer |
| Emergency gate precedence logic | LLM Engineer | Security Specialist |
| Mutation risk-class model training | ML Engineer | LLM Engineer |
| Fine-tuning pipeline updates | ML Engineer | DevOps Specialist |
| LLM response policy regression tests | LLM Engineer | QA Engineer |
| Offline benchmark experiment design | ML Engineer | LLM Engineer |
| Manual wording for AI behavior | LLM Engineer | Technical Writer |

## Current Sprint Split (Immediate)

### LLM Engineer execution queue (now)

1. Complete manual-vs-runtime parity audit for Bob gatekeeper behavior and publish gaps.
2. Add policy regression tests for emergency-priority blocking and reason-code propagation.
3. Add deterministic response-policy snapshot test coverage for execution review payload shape.
4. Add docs drift checker rule for Bob governance claims in instruction manual.

### ML Engineer execution queue (now)

1. Define baseline model quality scorecard for Bob inference tasks by capability class.
2. Produce calibration report for confidence output mapping used by operator-facing summaries.
3. Define retraining trigger thresholds and dataset freshness criteria.
4. Publish model promotion checklist (offline pass gates before runtime rollout).

## Handoff Contract

1. ML changes that affect operator-visible confidence or decision semantics require LLM review before merge.
2. LLM changes that alter expected model behavior or output format require ML review before merge.
3. Any change affecting AI behavior in production requires instruction manual confirmation in same change set.
