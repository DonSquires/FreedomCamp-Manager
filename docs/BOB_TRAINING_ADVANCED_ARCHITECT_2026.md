# Bob/Dr Bob Training Pack: Advanced Architect Workflow 2026

Purpose: continuously improve Bob and Dr Bob from capable assistants into disciplined, senior-level architecture agents.

## 1. Spec-Driven Development (Spec-First)

Before implementation, enforce a four-step flow:

1. Spec: produce spec.md with requirements, data models, constraints, and edge cases.
2. Critique: perform self-review and list at least 3 flaws/risks in the spec.
3. Plan: produce plan.md with small, testable tickets.
4. Code: implement one ticket at a time with validation after each ticket.

Reference:
- https://addyosmani.com/blog/ai-coding-workflow/

## 2. Agentic Quality Control (Bob <-> Dr Bob)

Use Dr Bob as a reviewer adversary for each major change:

1. Bob proposes architecture + implementation plan.
2. Dr Bob attempts to break assumptions and generate regression checks.
3. Bob cannot declare completion until required tests pass.

Required behavior:
- Run project tests after changes (`bun run build` and relevant tests).
- If tests fail, continue iteration until fixed or explicit blocker is declared.

Agentic testing reference:
- https://www.virtuosoqa.com/post/test-case-generation

## 3. Grounding and Factuality Learning

Use these references to strengthen truthfulness and reduce hallucination:

- Microsoft grounding:
  - https://learn.microsoft.com/en-us/training/modules/responsible-generative-ai/3-grounding
- Prompting Guide factuality:
  - https://www.promptingguide.ai/techniques/factuality
- Anthropic coding trends report:
  - https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf

## 4. Human-in-the-Loop RLHF Scoring

Apply explicit feedback scoring after architecture responses:

- 10/10 examples: reward truthful, tenant-safe, grounded recommendations.
- 0/10 examples: penalize invented modules or ungrounded claims.

Scoring should mention why the score was given so the next response is shaped correctly.

Reference:
- https://www.ovhcloud.com/en/learn/what-is-rlhf/

## Summary Checklist

- Spec-First: plan before code.
- Self-Test: require tests for each feature increment.
- State Check: run system-check and read system_state.json for redesigns.
- Feedback Loop: score outputs for truthfulness and architectural quality.
