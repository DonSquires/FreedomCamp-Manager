# AI Patch Runbooks

## Purpose

This runbook provides high-precision triage and coding exemplars for operational incidents.
Use these case studies when generating safe AI patch recommendations under time pressure.

## Strict Triage Matrix Protocol

1. Classify the incident domain before touching code:
- runtime crash
- upstream dependency outage
- infra/network saturation
- auth/session mismatch
- schema or migration drift

2. Determine blast radius and severity:
- Sev-1: production outage or legal/safety impact
- Sev-2: major workflow degradation
- Sev-3: localized non-critical defect

3. Capture hard evidence first:
- exact error string
- first failing endpoint
- recent deployment SHA
- environment variables changed in last deploy window
- service health probe results

4. Prefer reversible patches:
- configuration changes first
- bounded timeout and retry policies
- no schema assumptions without live verification

5. Require deterministic validation:
- health endpoint
- non-stream contract
- stream contract
- explicit pass/fail matrix with timestamps

## ESM Coding Directives

1. Use ESM-safe imports/exports only.
2. Keep runtime-targeted Node code aligned with tsconfig module resolution.
3. Avoid ambiguous mixed CJS/ESM patterns in hot paths.
4. Add explicit typing for third-party runtime adapters.
5. Fail fast with parseable error payloads and actionable logs.

## Few-Shot Exemplar 1: Vercel Connection Pool Exhaustion

### Symptom Pattern

- Intermittent HTTP 500/503 from API routes under burst traffic.
- Error examples:
  - "remaining connection slots are reserved"
  - "too many clients already"
  - Prisma or PG pool timeout under concurrent cold starts.

### Triage Decision

- Domain: infra/network saturation.
- Primary risk: connection storm from serverless fan-out.
- Patch class: config and pooling strategy, not schema.

### Recommended Patch Moves

1. Reduce max pool size for serverless workers.
2. Enforce short acquire timeout with bounded retry.
3. Reuse singleton client where framework allows.
4. Add backpressure on expensive fan-out endpoints.

### Validation Checklist

1. Baseline p95 latency before patch.
2. Re-run burst load test for 5 minutes.
3. Confirm zero pool exhaustion errors.
4. Confirm no regression in auth/session routes.

### Anti-Patterns

- Increasing pool without upstream DB capacity proof.
- Blindly raising retries until timeouts stack.
- Touching schema for a connection-layer incident.

## Few-Shot Exemplar 2: Expo Push Token Management

### Symptom Pattern

- Notifications silently fail or report invalid token.
- Error examples:
  - "DeviceNotRegistered"
  - "InvalidCredentials"
  - stale token after reinstall or account switch.

### Triage Decision

- Domain: auth/session mismatch + token lifecycle drift.
- Primary risk: stale token records and missing revoke/refresh flow.
- Patch class: token lifecycle and delivery hygiene.

### Recommended Patch Moves

1. Upsert push token on login and app foreground resume.
2. Invalidate token on logout and account switch.
3. Handle DeviceNotRegistered by soft-deleting token.
4. Store platform + app build metadata with token row.
5. Add idempotent token refresh endpoint.

### Validation Checklist

1. Fresh install push delivery test.
2. Logout/login token replacement test.
3. Multi-device same-user delivery test.
4. Token invalidation replay test.

### Anti-Patterns

- Treating push token as static user identity.
- Retrying permanently invalid tokens.
- Sending notifications without token freshness checks.

## Operational Note

When Bob proposes patches from these patterns, enforce sandbox validation and human approval for production deployment.
