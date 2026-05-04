# PTT Phase 0 Service Topology — Detailed Diagrams

## Scope

This document covers the **Phase 0 architecture** (ADRs 003–008): policy plane (Supabase), control plane (`radio-control`), media plane (mediasoup SFU), and AI speech plane (`inference-service`).

---

## 1. System Overview (Three Planes + AI)

```
┌────────────────────────────────────────────────────────────────────┐
│ CLIENT LAYER (Web + React)                                         │
│ ├─ PTTRadio component (channel + floor control UI)                │
│ ├─ WebRTC transports (one per SFU Router)                         │
│ └─ Redis pub/sub subscriptions (floor + presence topics)          │
└────────┬─────────────────────────────────────────────────────────┘
         │
╔════════╩════════════════════════════════════════════════════════╗
║ POLICY PLANE (Supabase PostgreSQL + RLS)                        ║
║ ├─ Org isolation via RLS on all radio_* tables                 ║
║ ├─ Token grant endpoints (Edge Functions)                      ║
║ ├─ radio_transmissions (audit log for all TX)                  ║
║ ├─ radio_transcript_segments (STT output)                      ║
║ ├─ radio_translation_segments (translation output)             ║
║ ├─ radio_tts_renders (synthetic audio artifacts)               ║
║ ├─ radio_voice_profiles (enrolled voice clones)                ║
║ └─ radio_voice_consents (consent + revocation audit)           ║
╚════════╦════════════════════════════════════════════════════════╝
         │ JWT tokens + org_id
╔════════╩════════════════════════════════════════════════════════╗
║ CONTROL PLANE (radio-control Node/Express service)              ║
║ ├─ POST /control/floor-request (ask for speaking)              ║
║ ├─ POST /control/floor-grant (admin: grant speaker)            ║
║ ├─ POST /control/floor-deny (admin: deny speaker)              ║
║ ├─ POST /control/emergency-override                             ║
║ ├─ WebSocket /control/floor-events (room: floor + presence)    ║
║ ├─ Redis pub/sub publish/subscribe per channel                 ║
║ └─ SFU session management (mediasoup Router + Transports)       ║
╚════════╦════════════════════════════════════════════════════════╝
         │ mediasoup control API
╔════════╩════════════════════════════════════════════════════════╗
║ MEDIA PLANE (mediasoup SFU in ppt-server process)               ║
║ ├─ Routers per org (org_id → Router instance)                  ║
║ ├─ WebRtcTransports (one per client per channel)               ║
║ ├─ Producers (one active speaker per channel)                  ║
║ ├─ Consumers (all other channel members)                       ║
║ ├─ PlainTransport RTP tap for AI media (inference-service)     ║
║ └─ Recording PlainTransport fork (authorized channels)         ║
╚════════╦════════════════════════════════════════════════════════╝
         │ RTP audio segments
╔════════╩════════════════════════════════════════════════════════╗
║ AI SPEECH PLANE (inference-service Node/Python)                 ║
║ ├─ STT (Whisper) → text + confidence → Supabase                ║
║ ├─ Translation (Ollama) → target language                       ║
║ ├─ TTS (Piper neutral + Coqui XTTS) → audio artifacts          ║
║ └─ Voice profile lookup (consent check on tx_voice_twin)        ║
╚════════════════════════════════════════════════════════════════╝
```

---

## 2. Authentication Flow — JWT → Control Plane

**Phase 0 Protocol:** Clients obtain a **short-lived scoped token** from Supabase (via Edge Function) before connecting to the control plane.

```mermaid
sequenceDiagram
    participant Client
    participant Supabase
    participant SupabaseEdgeFunc as Edge Function<br/>(ptt-signaling-token)
    participant ControlPlane as radio-control

    Client->>Supabase: GET /auth/user (existing auth)
    Supabase-->>Client: user_id, org_id, roles

    Client->>SupabaseEdgeFunc: POST /ptt-signaling-token<br/>{org_id, channel_id, device_id}
    Note over SupabaseEdgeFunc: Validate role → can_join_channel(role, channel_id)
    SupabaseEdgeFunc-->>Client: JWT {sub: user_id, org_id, channel_id, exp: +1h}

    Client->>ControlPlane: WS /control/floor-events<br/>Authorization: Bearer {JWT}
    Note over ControlPlane: Verify JWT signature + org_id isolation
    ControlPlane-->>Client: {status: connected, org_id, channel_id, floor_state}
```

---

## 3. Floor Control Flow — Request → Grant → Produce

**Phase 0 Protocol:** Floor arbitration is grant-based. Only one producer per channel at a time.

```mermaid
sequenceDiagram
    participant Officer1 as Officer 1<br/>(Wants to speak)
    participant Officer2 as Officer 2<br/>(Current speaker)
    participant ControlPlane
    participant Redis
    participant SFU as mediasoup SFU

    Officer2->>ControlPlane: produces() on WebRtcTransport
    ControlPlane->>SFU: create Producer() for Officer 2
    SFU-->>ControlPlane: {id: producer_2}
    ControlPlane->>Redis: PUBLISH radio:org:ORG:CH:floor {event: speaker_active, speaker_id: 2}
    Redis-->>Officer1: floor event (Officer 2 speaking)
    Redis-->>Officer2: floor event (you are speaking)

    Note over Officer1: Wants to speak; holds PTT
    Officer1->>ControlPlane: POST /control/floor-request {channel_id}
    ControlPlane->>Redis: PUBLISH radio:org:ORG:CH:floor {event: floor_request, requester: 1}
    Redis-->>Officer1: floor request submitted
    Redis-->>Officer2: floor request from Officer 1

    Note over Officer1: Waits for grant or timeout
    Note over Officer2: Sees request; has priority as incumbent

    Officer2->>ControlPlane: Release PTT (closes Producer)
    ControlPlane->>SFU: close Producer for Officer 2
    ControlPlane->>Redis: PUBLISH radio:org:ORG:CH:floor {event: floor_released}

    ControlPlane->>ControlPlane: floor arbitration: grant Officer 1 (first in queue)
    ControlPlane->>Redis: PUBLISH radio:org:ORG:CH:floor {event: floor_grant, speaker_id: 1}
    Redis-->>Officer1: "Floor granted"

    Officer1->>SFU: create Producer() for Officer 1
    SFU-->>Officer1: {id: producer_1}
    Officer1->>ControlPlane: [TX starts, Officer 1 producing]
```

---

## 4. Media + SFU Transport Flow

**Per-client WebRTC → Per-channel Router (org-scoped).**

```mermaid
sequenceDiagram
    participant Client1 as Officer 1<br/>(joined)
    participant Client2 as Officer 2<br/>(joined)
    participant ControlPlane
    participant SFU as mediasoup Router<br/>(org_id: ORG)

    Note over SFU: Router instance {id, org_id}

    Client1->>ControlPlane: createWebRtcTransport() for channel CH
    ControlPlane->>SFU: router.createWebRtcTransport()
    SFU-->>ControlPlane: {transport_1}
    ControlPlane-->>Client1: {transport_1, iceServers, dtlsParameters}

    Client1->>SFU: WebRTC ICE/DTLS connect to transport_1
    SFU-->>Client1: connected (media ready)

    Client2->>ControlPlane: createWebRtcTransport() for channel CH
    ControlPlane->>SFU: router.createWebRtcTransport()
    SFU-->>ControlPlane: {transport_2}
    ControlPlane-->>Client2: {transport_2, iceServers, dtlsParameters}

    Client2->>SFU: WebRTC ICE/DTLS connect to transport_2
    SFU-->>Client2: connected (media ready)

    Note over SFU: Now: both clients connected to same Router (org_id scoped)

    Client1->>SFU: produce() on transport_1 → {kind: audio, rtpParameters}
    SFU-->>Client1: {producer_id: P1}

    ControlPlane->>SFU: router.createConsumer(producer_id: P1, transport_2)
    SFU-->>ControlPlane: {consumer_id: C1}
    ControlPlane-->>Client2: {consumer_id: C1, rtpParameters} → subscribe to audio

    Client2->>SFU: receive(consumer_id: C1)
    SFU-->>Client2: [audio from Client1 playing]
```

---

## 5. AI Speech Tap Flow — Media → STT → Transcript

**Mediasoup PlainTransport → RTP tap → Whisper → Supabase.**

```mermaid
sequenceDiagram
    participant ControlPlane
    participant SFU as mediasoup Router
    participant PlainTransport as PlainTransport<br/>(RTP tap)
    participant InferenceService as inference-service<br/>(Whisper STT)
    participant Supabase

    ControlPlane->>SFU: router.createPlainRtpTransport()<br/>{ip: 127.0.0.1, port: 5555}
    SFU-->>ControlPlane: {transport_id: TAP1, rtcpPort: 5556}

    Note over ControlPlane: Attach TAP transport to active Producer
    ControlPlane->>SFU: router.createConsumer(producer_active, transport: TAP1)
    SFU-->>ControlPlane: {consumer_id: TAP_CONSUMER}

    ControlPlane->>SFU: (now SFU outputs RTP audio to 127.0.0.1:5555)

    InferenceService->>PlainTransport: bind UDP listener to 127.0.0.1:5555
    PlainTransport-->>InferenceService: [RTP packets arriving]

    InferenceService->>InferenceService: buffer 2s audio segments
    InferenceService->>InferenceService: Whisper.transcribe() → text + confidence

    InferenceService->>Supabase: INSERT radio_transcript_segments<br/>{transmission_id, text, confidence, is_final}
    Supabase-->>InferenceService: {id: segment_id}

    Note over Supabase: RLS enforces org_id == token.org_id
    Note over Supabase: Frontend subscribes to realtime updates → live captions
```

---

## 6. Org Isolation Boundaries (RLS + JWT)

**All tables enforce org_id isolation at the row level.**

```mermaid
sequenceDiagram
    participant OrgA_Officer as Officer<br/>(org_id: A)
    participant OrgB_Officer as Officer<br/>(org_id: B)
    participant ControlPlane
    participant JWT_A as JWT Token<br/>(org_id: A)
    participant JWT_B as JWT Token<br/>(org_id: B)
    participant Supabase as Supabase RLS<br/>(policy: org_id = token.org_id)

    OrgA_Officer->>ControlPlane: GET /ptt-signaling-token<br/>{org_id: A}
    ControlPlane->>Supabase: Edge Function verifies org membership
    Supabase-->>ControlPlane: {token: JWT_A}
    ControlPlane-->>OrgA_Officer: JWT_A (org_id: A scoped)

    OrgB_Officer->>ControlPlane: GET /ppt-signaling-token<br/>{org_id: B}
    ControlPlane->>Supabase: Edge Function verifies org membership
    Supabase-->>ControlPlane: {token: JWT_B}
    ControlPlane-->>OrgB_Officer: JWT_B (org_id: B scoped)

    OrgA_Officer->>Supabase: SELECT * FROM radio_transmissions<br/>Authorization: JWT_A
    Note over Supabase: RLS WHERE org_id = A
    Supabase-->>OrgA_Officer: [Org A transmissions only]

    OrgB_Officer->>Supabase: SELECT * FROM radio_transmissions<br/>Authorization: JWT_B
    Note over Supabase: RLS WHERE org_id = B
    Supabase-->>OrgB_Officer: [Org B transmissions only]

    Note over OrgA_Officer,OrgB_Officer: Even if Officer A guesses Officer B's JWT,<br/>Supabase RLS rejects cross-org queries
```

---

## 7. Emergency Override Flow (Admin Only)

**Master/Grand Master can force floor control.**

```mermaid
sequenceDiagram
    participant Officer1 as Officer 1<br/>(speaking)
    participant Admin as Admin<br/>(master role)
    participant ControlPlane
    participant Redis

    Officer1->>ControlPlane: producing on floor CH

    Admin->>ControlPlane: POST /control/emergency-override<br/>{channel_id: CH, requester_id: ADMIN}
    Note over ControlPlane: Verify role == 'master' or 'grand_master'

    ControlPlane->>ControlPlane: revoke floor from Officer1
    ControlPlane->>Redis: PUBLISH radio:org:ORG:CH:floor<br/>{event: floor_emergency_override, admin_id, reason}
    Redis-->>Officer1: "Floor revoked by admin (emergency)"

    ControlPlane->>Redis: PUBLISH radio:org:ORG:CH:floor<br/>{event: floor_available}

    Admin->>ControlPlane: [Admin now has floor]
```

---

## 8. Reconnect Workflow — Failover Resilience

**Client disconnect → Redis presence update → Rejoin → Replay state.**

```mermaid
sequenceDiagram
    participant Client
    participant ControlPlane
    participant Redis
    participant Supabase

    Client->>ControlPlane: [WS connected, floor_events subscribed]
    
    Note over Client: Network fault (offline 5 sec)
    Client->>Client: [WS closed]
    
    ControlPlane->>Redis: client presence timeout detected
    ControlPlane->>Redis: PUBLISH radio:org:ORG:CH:presence<br/>{event: left, officer_id}

    Note over Client: Network recovery
    Client->>ControlPlane: WS /control/floor-events<br/>Authorization: Bearer JWT (same)

    ControlPlane->>Supabase: SELECT FROM ppt_presence<br/>WHERE org_id=ORG, channel_id=CH
    Supabase-->>ControlPlane: [all on-channel officers]

    ControlPlane->>Redis: PUBLISH radio:org:ORG:CH:presence<br/>{event: full_sync, presence: [...]}
    Redis-->>Client: [presence state restored]

    ControlPlane-->>Client: {status: reconnected, floor_state, presence}
    
    Client->>ControlPlane: [re-establish WebRTC transport + Producers/Consumers]
```

---

## Phase 0 Validation Checklist

- [ ] Supabase org_id RLS policies enforced on all radio_* tables
- [ ] JWT token expiry + refresh mechanism documented
- [ ] Redis pub/sub channel isolation tested across orgs
- [ ] mediasoup Router per org_id + isolation test
- [ ] PlainTransport RTP tap→ inference-service latency <2s
- [ ] Emergency override revokes floor immediately
- [ ] Reconnect test: client rejoins, receives presence + floor state
- [ ] Load test: 100 concurrent channels, 5 floor events/sec per channel

---

## Next Steps (Phase 1)

1. **Ticket Group C: Client Refactor** — migrate React PTT component from peer-to-peer to SFU transport.
2. **Ticket Group D: Service Buildout** — wire up control plane (floor arbitration), mediasoup startup, AI media tap.
3. **Ticket Group B: Data Model** — RLS policies, Edge Function token grants.
