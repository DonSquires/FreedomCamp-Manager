# ADR 008: Event Backbone — Floor Control and Presence Fanout

## Status

Accepted

## Context

The PTT radio redesign (ADR 003) introduces a **Control Plane** responsible for:

1. **Floor arbitration** — only one speaker (producer) per channel at a time. Requests to speak, grants, denials, emergency overrides.
2. **Presence fanout** — real-time updates of who is on-channel, their online/offline state, and listening status.
3. **Latency budget** — floor grant notification must reach all channel subscribers within 200 ms to maintain operator experience parity with legacy peer-to-peer radio.

The **event backbone** is the messaging system that carries these control-plane events. Candidates are:

| Option | Latency | Org isolation | Scaling | Ops complexity | Cost |
|--------|---------|---------------|---------|----------------|------|
| **Redis pub/sub** | <50ms | Channel-based scoping | Single node limit (~10K channels) | Low | Low |
| **RabbitMQ** | 50–100ms | Virtual host isolation | Cluster with HA | Medium | Medium |
| **Supabase Realtime** | 100–200ms | RLS-based (via JWT) | Managed; pay-per-message | Low | Variable (per-msg) |
| **NATS** | <50ms | Subjects (hierarchical) | Jetstream clustering | Medium | Low (open-source) |
| **Apache Kafka** | 100–500ms | Topic ACL | Cluster with retention | High | Medium (infra) |

## Decision

Use **Redis pub/sub** for the event backbone in Phase 1.

**Rationale:**

1. **Existing Redis deployment** — the repo already runs `ptt-server/` backed by Redis for session/presence caching (observed in migration `20260703_ptt_schema.sql` and existing `ppt_presence` table). Phase 1 reuses this Redis instance to avoid a new service dependency.
2. **Latency budget** — Redis pub/sub guarantees <50ms delivery within a single node, meeting the 200ms floor-grant notification requirement.
3. **Org Isolation via channel naming** — org-scoped channels follow the pattern `radio:org:${orgId}:${channelId}:floor` and `radio:org:${orgId}:${channelId}:presence`. Channel subscriptions are validated by the control plane, not by Redis, ensuring RLS-equivalent isolation.
4. **Simple operational model** — Redis pub/sub has no persistent queue; subscribers must be active. At Phase 1 scale (single VPS deployment), this is acceptable. The control plane can pre-load presence state from the DB on client reconnect (via the `ppt_presence` table).
5. **Future migration path** — if Phase 2 scales to multi-node infrastructure, the subscriber pattern transitions to a broker-based model (e.g., NATS Jetstream or RabbitMQ). The control plane API contract remains unchanged.

**Deferred options:**

- **RabbitMQ** — valid for multi-node deployments later (Phase 4+). Adds operational complexity (Erlang runtime, clustering) for Phase 1.
- **Supabase Realtime** — acceptable alternative if operator latency tolerance increases to 200ms+. Avoids a separate service but incurs per-message cost at scale.
- **NATS** — strong future choice for org isolation (NATS subjects) and clustering. Phase 1 chooses Redis for reuse of existing infra.

## Consequences

1. **Control Plane Event Model** — Floor-control events (floor request, grant, deny, emergency override) are published to `radio:org:${orgId}:${channelId}:floor` by `radio-control` service. Web clients subscribe to the active channel's floor topic and receive events with <50ms latency.
2. **Presence State** — Channel presence (list of online officers + their listening/speaking status) is stored in both:
   - Redis key `radio:org:${orgId}:${channelId}:presence` (in-memory, fast reads).
   - Database table `ppt_presence` (persistent, survives Redis restarts).
3. **Reconnect Workflow** — On client reconnect:
   1. Client fetches current presence from DB (`ppt_presence` query).
   2. Client subscribes to floor and presence topics in Redis.
   3. Control plane publishes a "presence delta" event to reflect the rejoined officer.
4. **Redis persistence** — The deployment must ensure Redis data persistence (RDB or AOF) is enabled. Loss of the Redis instance results in loss of in-flight floor requests until the control plane replays from the database.
5. **Single-node scaling limit** — Phase 1 assumes a single Redis node can handle ~1000 concurrent floor events per second. If this limit is exceeded, a broker upgrade is required (blocking before production scale-out).

## Verification

- Unit test: `floor request published to correct Redis channel` — asserts org/channel isolation.
- Unit test: `presence delta event triggers UI update <200ms` — latency SLO.
- Integration test: `client reconnect restores presence state from DB, then receives new floor events` — failover workflow.
- Load test: `1000 floor events/sec does not exceed Redis latency budget` — Phase 1 scale validation.

## Related ADRs

- ADR 003: PTT service topology (defines control plane purpose).
- ADR 004: SFU platform (mediasoup generates media plane events orthogonal to floor control).

## Future Work

- Phase 4: Evaluate NATS Jetstream for multi-region deployment and persistent event replay.
- Phase 4: Implement event sourcing (all floor/presence events append to an immutable log) for replay debugging and audit.
