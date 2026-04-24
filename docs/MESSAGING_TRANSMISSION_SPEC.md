# Messaging Transmission Spec (Option 2 Gate)

## Scope
Define a standalone text messaging transmission model that is not integrated into PTT voice transport.

## Objectives
- Keep messaging independent from PTT signaling and call state.
- Guarantee org-scoped delivery by `organizationId`.
- Provide explicit transmission states in UI and storage.
- Support resilient send behavior when realtime transport is unavailable.

## Non-Goals
- No coupling to push-to-talk button state.
- No cross-tenant federation.
- No hard dependency on a single AI/chat endpoint.

## Domain Model
- `message_threads`
  - `id`, `organization_id`, `created_by`, `participants`, `created_at`, `updated_at`
- `messages`
  - `id`, `thread_id`, `organization_id`, `sender_id`, `body`, `created_at`
  - `transmission_state` enum: `draft|queued|transmitting|transmitted|failed|retrying`
  - `attempt_count` integer
  - `attempted_at` timestamp nullable
  - `transmitted_at` timestamp nullable
  - `last_error` text nullable
  - `client_temp_id` text nullable (idempotent optimistic send)

## Transmission Lifecycle
1. Compose creates local `draft`.
2. Send action appends optimistic message with `queued`.
3. Dispatcher moves to `transmitting` and attempts backend send.
4. Success transitions to `transmitted` and sets `transmitted_at`.
5. Failure transitions to `failed` with `last_error`; retry action sets `retrying` then repeats step 3.

## Delivery Paths
- Primary: realtime publish + durable insert.
- Fallback: durable insert only, then async fanout when realtime recovers.
- Offline: keep in local queue and auto-retry on reconnect.

## Tenant Isolation
- Every query/mutation filtered by active org context.
- Service layer rejects payload if active org does not match `organization_id`.
- UI thread list and message list sourced only from active org.

## UX Requirements
- Composer shows transport chip: `Online`, `Degraded`, `Offline`, `Syncing`.
- Each message shows status badge for transmission state.
- Failed messages expose explicit retry CTA.
- No hidden silent failures.

## Observability
- Emit client telemetry for state transitions and retry outcomes.
- Capture aggregate metrics: send success rate, p95 transmission time, retry success rate.

## Test Gate
- Unit: state machine transitions and idempotency.
- Integration: org-scoped access checks and fallback path.
- E2E: offline send, reconnect auto-retry, failed send manual retry.
- Human test: visibility of transmission state and retry usability.

## Rollout
1. Ship behind feature flag `messaging_transmission_v1`.
2. Enable for internal org first.
3. Validate transmission metrics and retry stability.
4. Expand to all orgs.
