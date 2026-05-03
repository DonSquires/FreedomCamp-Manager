# ADR 004: SFU Platform Selection

## Status

Accepted

## Context

The radio platform rebuild (ADR 003) requires a Selective Forwarding Unit to provide server-side media fan-out, media tap for AI speech, floor control events, and replay forks. The SFU must:

1. Be self-hostable on the existing hPanel VPS or a VPS upgrade — no vendor lock-in for media routing.
2. Support WebRTC with ICE/TURN, matching the existing client stack.
3. Expose a media tap API (raw audio segments) for the AI speech plane.
4. Support recording/forwarding forks for authorized channels.
5. Provide a Node.js or REST control API compatible with the existing `ptt-server/` Node/Express service ecosystem.
6. Operate behind TURN (see `turn-server/` in the repo) for restrictive-network support.

**Options evaluated:**

| Option | Self-host | Node API | Media tap | Complexity | Operational cost |
|--------|-----------|----------|-----------|------------|-----------------|
| **mediasoup** | ✅ | ✅ Native Node | ✅ `PlainTransport` | Medium | Low (process-level) |
| LiveKit | ✅ (Go binary) | SDK available | ✅ | Low (managed API) | Medium (Go daemon) |
| Janus | ✅ | REST/WebSocket | Via plugin | High | High |
| Jitsi Videobridge | ✅ | JVB API | Complex | High | High |
| Daily.co / Twilio | ❌ SaaS | SDK | Vendor | Low | High (per-minute) |

## Decision

Use **mediasoup v3** as the SFU for the radio platform.

**Rationale:**

1. **Node.js native** — mediasoup runs as a Worker child process within the Node/Express `ptt-server/` process model. No separate language runtime or daemon is required on the VPS.
2. **`PlainTransport` for media tap** — mediasoup's `PlainTransport` provides a raw UDP/RTP tap that the `inference-service/` (ONNX AI pipeline) can consume directly without an additional media relay bridge.
3. **Low operational overhead** — mediasoup workers are spawned per CPU core and managed by the existing Node process supervisor; no separate service binary to deploy.
4. **Proven field use** — mediasoup is used in production push-to-talk and conferencing applications at scale; its `Consumer`/`Producer` model maps naturally to PTT floor-control semantics (one active producer per channel floor grant).
5. **TURN compatibility** — mediasoup WebRtcTransports use ICE + DTLS with configurable TURN relay, compatible with the existing `turn-server/` deployment.

**Deferred options:**

- LiveKit remains a valid future migration path if operational simplicity outweighs Node-native advantage in later phases.
- SaaS options (Daily, Twilio) are rejected for this deployment due to per-minute cost and org-data routing constraints under NZ privacy law.

## Consequences

- `ptt-server/` gains a `mediasoup` dependency (npm). The worker-per-core model must be tuned for VPS CPU count.
- The `inference-service/` receives RTP audio via mediasoup `PlainTransport` — no HTTP polling required.
- Floor control semantics map to mediasoup `Producer` pause/resume per channel floor grant.
- Recording fork uses mediasoup `PlainTransport` → file recorder for authorized channels.
- SFU worker crash recovery must be handled in the control plane (restart worker, re-establish consumers).
- Phase 1 exit criteria require reconnect tests across SFU worker restarts.

## Verification

- mediasoup worker starts within `ptt-server/` and creates a Router for an org-scoped channel.
- A WebRtcTransport connect/produce/consume roundtrip completes with a test WebRTC client.
- `PlainTransport` tap receives RTP audio from an active producer.
- Reconnect test passes after SFU worker hard-restart.
