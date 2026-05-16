# Bob Gatekeeper Manual Parity Audit

Date: 2026-05-16
Scope: Manual vs runtime behavior for Bob governance and gatekeeper controls
Manual reference: docs/INSTRUCTION_MANUAL.md (Phase 3 governance + AI services sections)

## Summary

The governance baseline is mostly implemented (policy matrix, reason codes, emergency gate context, org/actor context propagation), but there are high-priority parity gaps around approval-contract enforcement and emergency policy semantics.

## Findings (ordered by severity)

### 1) P0 - Direct administrative actuation path bypasses explicit mutation/approval contract checks

Manual requirement:
- "execution-capable paths must use explicit approval contracts"
- "Execution-capable workflows must use explicit mutation/approval contracts"

Runtime evidence:
- Bob Studio directly invokes `executeAdministrativeActuation(...)` before gateway contract checks.
- The actuation implementation writes to `clients`, `client_sites`, and shifts without calling `assertBobMutationAccess(...)`.

Code references:
- src/pages/BobAssistantStudio.tsx
- src/lib/bob-brain.ts
- src/lib/bobMutationCatalog.ts

Impact:
- Governance model can be bypassed for provisioning-style writes from the Studio path.
- Behavior drifts from the manual's explicit contract/approval boundary.

Recommended fix:
1. Add an explicit contract id for this provisioning flow to the mutation catalog.
2. Require `assertBobMutationAccess(contractId, mode)` before actuation.
3. Route through one governed execution adapter so Studio and gateway share the same contract enforcement.

### 2) P1 - Emergency policy semantics are broader than manual wording

Manual requirement:
- In emergency-priority mode, non-safety administrative writes are blocked.

Runtime evidence:
- `evaluateEmergencyPriorityGate(...)` blocks any explicit requested mutation contract during emergency mode.

Code references:
- src/lib/edgeFunctions.ts

Impact:
- If a future safety mutation contract is introduced, it will also be blocked by default.
- Current behavior is stricter than the manual text and may require either logic refinement or documentation clarification.

Recommended fix:
1. Add a safety-allowlist classification to mutation contracts.
2. Gate as: block non-safety contracts only.
3. If strict-all-mutations blocking is intended, update manual wording to match.

### 3) P1 - Test coverage gap for shared emergency gate and execution review payload

Manual requirement:
- Gate behavior and operator-facing governance outcomes should be deterministic and auditable.

Runtime evidence:
- Catalog access tests exist.
- No targeted unit tests found for emergency gate evaluation in `edgeFunctions` or for `responsePolicy.decisionReasonCodes/confidence` payload shape.

Code references:
- src/lib/__tests__/bobMutationCatalog.test.ts
- src/lib/edgeFunctions.ts

Impact:
- Regression risk in core gate semantics and explainability payload.

Recommended fix:
1. Add unit tests for emergency gate blocked/non-blocked transitions.
2. Add tests for `responsePolicy.decisionReasonCodes` and confidence fields in aiChat output.
3. Add one integration test asserting emergency-priority request returns deterministic reason code.

## Confirmed parity (implemented)

1. Policy matrix and governance classes are implemented via mutation catalog and access assertions.
2. Deterministic reason codes are returned for access decisions.
3. Emergency-priority flags are propagated from Bob Studio request context into gateway policy checks.
4. Execution review and response policy include reason-code/confidence metadata for operator visibility.
5. Tenant/actor context is propagated through gateway context and request headers (`x-org-id`, actor context fields).

## Decision recommendation

Status: Conditional-go

Go once P0 is closed and P1 items are either fixed in code or explicitly reconciled in the manual.
