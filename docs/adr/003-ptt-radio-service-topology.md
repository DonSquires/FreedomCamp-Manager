# ADR 003: PTT Service Topology — Radio Platform Architecture

## Status

Accepted

## Context

The current PTT system uses a custom WebSocket signaling server (`ptt-server/`) backed by Redis for presence and channel management. Clients establish peer-to-peer WebRTC connections negotiated through this signaling plane. This architecture has the following constraints:

- **Peer-to-peer mesh does not scale** beyond small groups; N participants require N×(N-1) media connections.
- **No server-side media tap** — live transcript and translation (Phase 2/3) require server-side audio access, which is impossible with pure peer-to-peer WebRTC.
- **No floor control server** — arbitration of simultaneous transmissions is client-enforced, not authoritative.
- **No recording/replay fork** — emergency channel replay requires server-side media retention.

The plan requires migrating to an SFU (Selective Forwarding Unit) architecture to support Phases 1–4.

## Decision

Adopt a **three-plane service topology** for the new radio platform:

```
┌──────────────────────────────────────────────────────────┐
│  Policy Plane (Supabase)                                 │
│  - Channel scope + org isolation (RLS)                   │
│  - Token grant endpoint (Edge Function)                  │
│  - Audit log (radio_transmissions, radio_transcript_*) │
└──────────────────┬───────────────────────────────────────┘
                   │ JWT-scoped session tokens
┌──────────────────▼───────────────────────────────────────┐
│  Control Plane (radio-control — new Node/Express service) │
│  - Floor arbitration (request/grant/deny/emergency)      │
│  - Presence fanout via Redis pub/sub                     │
│  - Channel lifecycle (create/join/leave/close)           │
│  - Extends existing ptt-server signaling contracts       │
└──────────────────┬───────────────────────────────────────┘
                   │ SFU session management
┌──────────────────▼───────────────────────────────────────┐
│  Media Plane (SFU — see ADR 004)                         │
│  - WebRTC fan-out: one upload per sender                 │
│  - Media tap for AI speech services                      │
│  - TURN relay mandatory (see TURN server in turn-server/)│
│  - Recording fork for authorized channels                │
└──────────────────┬───────────────────────────────────────┘
                   │ Audio segments
┌──────────────────▼───────────────────────────────────────┐
│  AI Speech Plane (inference-service/)                    │
│  - STT → transcript segments                             │
│  - Translation → translated segments                     │
│  - TTS render → synthetic-audio artifacts                │
│  - All paths gated behind confidence thresholds          │
└──────────────────────────────────────────────────────────┘
```

**Migration approach:**

1. The existing `ptt-server/` signaling contracts (WebSocket message types, token shape, channel scopes) are preserved as the control plane protocol baseline to avoid breaking existing clients during the transition.
2. The control plane is extended, not replaced, in Phase 1.
3. The frontend PTT client is migrated from peer-to-peer WebRTC to SFU transport in Phase 1 Ticket Group C, behind a feature flag.
4. Peer-to-peer fallback is removed only after Phase 1 exit criteria are met.

## Consequences

- Each phase-gate requires all planes below it to be stable before proceeding upward.
- The AI speech plane must never become a dependency of the media plane; it receives a copy of audio, not a relay.
- All media-plane events (join, leave, floor, emergency) must be auditable via the policy plane.
- TURN relay support is mandatory from day one; see `turn-server/` in the repo.
- Original audio is always primary; translated audio is additive and fail-silent.

## Verification

- `ptt-server/` tests pass after control plane extension work.
- SFU session grant/revoke roundtrip test passes using scoped Supabase token.
- Floor arbitration events appear in audit log within SLO.
