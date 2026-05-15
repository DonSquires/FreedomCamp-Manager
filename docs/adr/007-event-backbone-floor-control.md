# ADR 007: Event Backbone for Floor Control and Presence Signaling

**Date**: 2026-05-15  
**Status**: Proposed (awaiting Phase 0 entry gate approval)  
**Consequences**: Defines real-time coordination layer for multi-org radio floor control, speaker presence, and emergency override signaling.

## Context

Phase 0 radio rebuild requires coordinating:
- **Floor control**: Which user is transmitting on which channel
- **Presence fanout**: Which users are listening to which channel
- **Emergency override**: Supervisor can interrupt an active transmission
- **Fallback mode**: Degraded operation when SFU or event backbone is unavailable

The event backbone must:
1. **Support multi-org isolation**: Channel A in Org 1 must never leak floor state to Org 2
2. **Scale to 1000+ concurrent sessions**: Multiple geofences, hundreds of users per org
3. **Minimize latency**: Floor transitions must be < 100ms (perceived real-time)
4. **Persist state** for replay/audit
5. **Support replay** during offline/reconnect scenarios

## Decision

Implement a **dual-layer event architecture**:
- **Layer 1 (Fast Signaling)**: Redis Pub/Sub for floor control and presence (< 50ms latency)
- **Layer 2 (Audit Trail)**: Supabase `radio_floor_events` table for compliance and replay (eventual consistency)

### Architecture

```
┌─────────────────────────────────────────┐
│ Field Officers (Multi-Org)              │
│ ├─ Org A: Officer 1, Officer 2          │
│ ├─ Org B: Officer 3                     │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│ SFU (Livekit)                           │
│ ├─ Room: channel-org-a-zone-1           │
│ ├─ Room: channel-org-b-zone-2           │
└──────────────────┬──────────────────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
    ▼              ▼              ▼
┌──────────┐ ┌──────────┐ ┌─────────────────┐
│ Redis    │ │ Supabase │ │ Edge Functions  │
│ Pub/Sub  │ │ DB       │ │ (floor logic)   │
│ (floor)  │ │ (audit)  │ └─────────────────┘
└──────────┘ └──────────┘
    │              │
    └──────────────┼──────────────┐
                   │              │
                   ▼              ▼
            ┌────────────────────────┐
            │ Client UI              │
            │ ├─ Floor indicator     │
            │ ├─ Presence list       │
            │ ├─ Floor-release btn   │
            └────────────────────────┘
```

### Layer 1: Redis Pub/Sub (Fast Signaling)

- **Channel namespace**: `radio:floor:org:{org_id}:channel:{channel_id}`
- **Messages**:
  - `{ type: "floor_acquired", user_id, session_id, timestamp }`
  - `{ type: "floor_released", user_id, session_id, timestamp }`
  - `{ type: "floor_override", operator_id, reason, timestamp }`
  - `{ type: "presence", user_id, status: "listening"|"transmitting"|"offline", timestamp }`
- **TTL**: 5 seconds (sessions refresh presence on heartbeat)
- **Failover**: If Redis unavailable, fall back to SFU-only floor (no global presence visibility)

### Layer 2: Supabase `radio_floor_events` (Audit Trail)

```sql
CREATE TABLE radio_floor_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  channel_id TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- 'floor_acquired', 'floor_released', 'override'
  user_id UUID NOT NULL,
  session_id UUID NOT NULL,
  operator_id UUID,  -- set if override or escalation
  reason TEXT,
  created_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  INDEX (org_id, channel_id, created_at)
);

CREATE POLICY "radio_floor_events_org_isolation"
  ON radio_floor_events
  FOR SELECT
  USING (org_id = current_setting('request.jwt.claims.org_id')::uuid);
```

- **Retention**: 90 days (compliance audit trail)
- **Queries supported**:
  - "Who was transmitting on channel X at time Y?"
  - "How many floor overrides occurred today?"
  - "Which user had the longest transmission?"

## Implementation (Phase 1)

1. **Redis provisioning** (Iron Eagle ops or managed Redis service like AWS ElastiCache).
   - Verification: `redis-cli PING` returns `PONG`; `redis-cli CONFIG GET maxmemory` reports expected instance size.
2. **Edge Function** `supabase/functions/radio-floor-acquire/index.ts`:
   - Validate user has active session
   - Check org-scoped floor state via Redis
   - If channel free, grant floor and publish `floor_acquired` event
   - Insert audit row in `radio_floor_events`
   - Verification: POST `/radio-floor-acquire` with valid session returns `200` and sets Redis key; duplicate POST returns `409 floor_already_held`.
3. **Edge Function** `supabase/functions/radio-floor-release/index.ts`:
   - Release floor and publish `floor_released` event
   - Verification: POST `/radio-floor-release` clears Redis key; `radio_floor_events` row shows `floor_released` event with matching `user_id`.
4. **Supabase migration** `radio_floor_events` table + RLS policy.
   - Verification: `SELECT * FROM radio_floor_events WHERE org_id = '<other_org>'` returns 0 rows from a different org JWT.
5. **Test harness** in `tests/e2e/phase0-phase1-floor-control.spec.ts`:
   - Multi-user floor contention (only one transmitter at a time per channel)
   - Org isolation (Org A user cannot grab floor in Org B)
   - Override path (supervisor overrides active transmitter)
   - Replay conflict (offline user reconnects while floor state stale)
   - Verification: All 4 test scenarios pass in Chromium with `--workers=1`; zero org-boundary assertion failures.

## Fallback Decision (If Redis Unavailable)

- Use **Supabase Realtime** instead (polling-based, higher latency ~200ms)
- Or disable real-time floor indicator; fall back to passive listening mode

## Consequences

1. **Phase 1 scope**: Must integrate Redis provisioning, floor acquire/release functions, and audit logging.
2. **Phase 3 prerequisite**: Floor state must be stable before adding translated relay (otherwise floor/audio sync breaks).
3. **Operational**: Redis monitoring required; failover procedure documented.
4. **Cost**: Redis instance sizing based on concurrent user forecast (100-1000 users).
5. **Compliance**: Floor event audit trail retained per org data governance policy.

## ADR Dependencies

- Depends on ADR-006 (SFU Platform) for media routing
- Feeds into Phase 3 (Translated Audio must respect floor state)
- Feeds into Phase 5 (Voice-Twin governance uses floor audit for consent enforcement)

## Approval Gate

- [ ] Phase 0 Steering Committee: Event backbone topology approved
- [ ] Platform Architecture: Redis scaling plan accepted
- [ ] Ops: Failover and monitoring procedures documented
- [ ] Legal/Compliance: Audit trail retention policy accepted

---

**Phase 0 Entry Gate Status**: ⏳ Pending
