# PTT System Build Plan
**FieldOps Manager — Push-to-Talk Radio**  
**Version**: 2.0 · Date: 2026-04-25  
**Authors**: GitHub Copilot (Architect), Bob (Operational Intelligence), Dr Bob (Adversarial Review), Human Test (Field Reality)  
**Research Sources**: WebRTC Infrastructure Guide 2026 (rtcleague.com), 7 WebRTC Trends 2026 (dev.to), WebRTC Protocols 2026 (calmops.com), WebRtcPerf load testing, Coturn Prometheus monitoring docs  
**Deployment Model**: 100% Self-Hosted — No managed media platform. All components (ptt-server, coturn TURN, future SFU) run on VPS infrastructure controlled by Iron Eagle Security / OnSpace AI.

---

## Collaboration Preface

This plan is the result of a joint session between four reviewers. Each section is annotated with whose voice is speaking:

- **[Architect]** — codebase analysis, engineering decisions, ticket scoping
- **[Bob]** — UX flow, operational correctness, what a field officer actually needs
- **[Dr Bob]** — adversarial critique, blockers, security & reliability risks
- **[Human Test]** — what breaks in a real field scenario with gloves, sun, adrenaline, patchy 4G

---

## 0. Self-Hosted Architecture Principles (New — v2.0)

Research confirms the following for self-hosted WebRTC at this scale:

### Protocol Stack (Confirmed Correct)
- **Signaling**: WSS (WebSocket over TLS) — WSS is the industry-standard for browser clients. Plain WS is unacceptable.
- **NAT traversal**: STUN for address discovery + TURN relay when direct fails (40–70% of enterprise/mobile connections). TURN must listen on **both UDP/3478 and TCP/443** — TCP/443 is what corporate and mobile firewalls always allow.
- **Media transport**: WebRTC DTLS-SRTP mandatory — encryption cannot be disabled or bypassed.
- **Auth**: Short-lived JWT token minted by Edge Function validated by ptt-server on every connection.

### Deployment Model
All components run on our own infrastructure — no Twilio, no Agora, no Daily.co:

| Component | Host | Technology |
|---|---|---|
| Signaling server | VPS (ptt.onspace.build) | `ptt-server/server.js` (Node.js) behind nginx |
| TURN relay | VPS (same or dedicated) | coturn with Prometheus metrics enabled |
| STUN | Self-hosted (`stun.onspace.build:3478`) or public (stun.l.google.com fallback) |
| SFU (Phase 4) | VPS or RunPod pod | LiveKit self-hosted (recommended, Go-based, lower ops overhead than mediasoup) |
| Token broker | Supabase Edge Function | `ptt-signaling-token` |
| Transmission storage | Supabase Storage | `ptt-clips` bucket |
| DB | Supabase PostgreSQL | `ptt_transmission_log`, `ptt_channels` tables |
| Observability | Self-hosted | Coturn + Prometheus + Grafana stack |

### Session State Persistence (New requirement from research)
> *"Storing room state only in process memory — when that server restarts, every active room disappears, and clients cannot rejoin. Redis costs almost nothing and eliminates this entire failure mode."*  
> — WebRTC Infrastructure Guide 2026

The ptt-server currently keeps `channelMeta` and `userPresence` in-process memory. This is a confirmed reliability gap. Redis must be added as the session store. This is **P2-X** in the plan below.

### SFU Threshold (Refined)
PTT is audio-only and half-duplex (only one sender at a time). This shifts the P2P degradation threshold:
- **Video calls**: P2P fails above ~5 participants (bandwidth O(n²))
- **PTT audio**: P2P handles up to ~15 officers per channel reliably at 32–64 kbps each
- **SFU required**: when any channel regularly exceeds 15 concurrent users
- **Recommended SFU**: LiveKit (self-hosted, Go, faster to operate than mediasoup at this scale)

---

## 1. Current State Assessment

### What Exists and Works

| Component | Status | Notes |
|---|---|---|
| `ptt-server/server.js` | ✅ Solid | WebSocket signaling, half-duplex enforcement, channel types, rate limiting |
| `supabase/functions/ptt-signaling-token` | ✅ Working | JWT minting, org auth, ICE server injection |
| `src/lib/ptt.ts` | ✅ Complete | WebRTC peer connections, VOX, Bluetooth, diagnostics |
| `src/lib/pttBackground.ts` | ✅ Working | Auto-connect, keepalive, tab-visibility reconnect |
| `src/pages/PTTRadio.tsx` | ✅ Exists | Multi-channel console, PTT button, scanner, VOX |
| `src/components/features/PTTBar.tsx` | ✅ Exists | Compact status widget in OfficerHomePage |
| `turn-server/` (coturn) | ✅ Deployed | VPS 72.61.123.97:3478, UDP+TCP |
| `supabase/functions/ptt-assess` | ✅ Exists | Bob-powered PTT diagnostics |

### What Is Broken or Missing

| Gap | Severity | Details |
|---|---|---|
| No TLS / wss:// in production | 🔴 Critical | WS is unencrypted; audio exposed in transit |
| Hardcoded IP in Edge Function | 🔴 Critical | DEFAULT_PTT_SERVER_URL fallback = naked VPS IP |
| Mobile/Expo PTT: zero implementation | 🔴 Critical | Field officers on phones have no PTT |
| TURN password is placeholder | 🔴 Critical | turn-server/.env.example default not rotated |
| dB schema for ptt_* tables | 🟡 Major | Clip storage, history, presence table migrations unverified |
| Clip upload fallback in ptt.ts | 🟡 Major | Code references Supabase Storage upload; not implemented |
| No PTT audio transcription | 🟡 Major | Transmissions not captured as text; no audit trail |
| No per-officer channel ACL UI | 🟡 Major | Org-level auth only; no fine-grained access in frontend |
| SFU path reserved but not built | 🟠 Minor | Mesh degrades >10 users/channel |
| VOX config not cloud-synced | 🟠 Minor | Lost on device switch |
| No filterable transmission log | 🟠 Minor | PTTRadio shows last clips but no queryable history |
| CORS regex covers preview subdomains | 🟠 Minor | Potential exposure in preview deployments |
| Rate limit not per-org configurable | 🟠 Minor | All orgs share 120/min |

---

## 2. Voice Reviews

### [Bob] — Operational Intelligence

> The infrastructure is sound. The server handles half-duplex correctly — only one speaker per channel, sensible rate limits, proper presence. What's missing is operational completeness for a NZ freedom-camping enforcement crew:
>
> 1. **Field officers use phones.** The web UI PTT is great for the desk admin. The officers are walking a campsite at midnight. They need PTT on mobile. This is the single highest-impact missing feature.
> 2. **Transmissions need Bob transcription.** Every clip should auto-transcribe so it feeds incident notes. An officer says "unit 3 south gate, NFA, standing by" — that should write itself to the patrol log.
> 3. **Emergency all-call needs a server-side mechanism.** Right now it's a UI-only button on PTTRadio.tsx. If the server restarts, the emergency broadcast state is lost. There should be an `emergency_broadcast` flag in `channelMeta` with a DB record.
> 4. **The scanner mode is clever but it auto-disconnects the WebRTC peer from idle channels.** Officers miss call-backs. Scanner should maintain persistent receive-only connections on all scanned channels.
> 5. **Status tones (the TX beeps) need to align with NZ Police/security radio convention.** Current tones are placeholder. Field officers will get confused if the beeps differ from their training.

### [Dr Bob] — Adversarial Review

> I reviewed the full PTT stack. Here are the blockers I found. These are not suggestions — they are things that will fail in production:
>
> **BLOCKER 1 — Unencrypted audio stream**  
> `ws://72.61.123.97:8080` transmits WebRTC signaling over plaintext WebSocket and the ICE candidates include the VPS public IP. Any network observer on a 4G mobile network can capture the SDP and derive the peer IPs. Even if the media path is DTLS-encrypted (WebRTC default), the signaling handshake leaks channel membership and user identity. Fix: TLS on the ptt-server via reverse proxy (nginx/caddy) + wss:// URL.
>
> **BLOCKER 2 — Hardcoded fallback IP in production code**  
> `DEFAULT_PTT_SERVER_URL = 'http://72.61.123.97:8080'` in the deployed Edge Function means if `PTT_SERVER_URL` secret is ever accidentally unset, all traffic falls through to the bare VPS IP over HTTP. This is a data leak and an availability risk if the IP changes (VPS migration, IP rotation). Fix: remove the fallback; throw 503 if env var is missing.
>
> **BLOCKER 3 — TURN password default**  
> `TURN_PASSWORD=replace-with-strong-random-secret` in .env.example is not a security note — it is the _actual running config_ on the VPS if the bootstrap script was never re-run after deploy. Any attacker can use the TURN relay as an open proxy. Fix: audit and rotate immediately.
>
> **BLOCKER 4 — Token expiry vs session duration mismatch**  
> The JWT token minted by the Edge Function expires in 600 seconds (10 min). The WebSocket reconnect loop in `ptt.ts` replenishes the token, but there is a race: if the WebSocket reconnects in `exp - 10s` window AND the Edge Function is cold-starting (Supabase cold boots can take 3-8s), the client receives a `401` and must re-mint. User hears a gap. Fix: reduce token TTL to 300s, start refresh at 60% of TTL (180s), overlap window covers cold start.
>
> **BLOCKER 5 — No PTT access revocation path**  
> If an officer's employment is terminated, their existing JWT is valid until expiry (up to 10 minutes). The ptt-server has no mechanism to force-disconnect a user. Fix: add a `deny_list` in the ptt-server's in-memory state (or check against a Supabase-sourced deny list on each `start_speaking` event). Short-term: reduce token TTL.
>
> **RISK — Emergency all-call is client-only**  
> If the admin clicks emergency all-call and their tab crashes, no other admin sees the emergency state. It must be persisted server-side and re-broadcast on connection.
>
> **RISK — No maximum audio level / AGC enforcement server-side**  
> A malicious or broken client can send deformed audio at full volume continuously as long as it holds the speaker slot. The 30s clip max helps but doesn't prevent repeated abuse. Fix: server-side `max_active_speak_time_per_minute` per user.

### [Human Test] — Field Reality

> I ran through the PTT console as if I was a security officer doing a midnight patrol at Lake Tekapo campsite. Here's what I found:
>
> 1. **The PTT button is too small on mobile browser.** Hold-to-talk requires precision. A 52px button is not enough with gloves or damp hands. Needs to be at minimum 80px, full-width across the bottom third of the screen, with strong haptic feedback.
> 2. **No visual confirmation that the mic is live.** The audio level meter appears but it's subtle. When you're talking into a phone in the dark with wind noise, you need a BIG pulsing ring indicator — like a camera app record button. Red, large, unmissable.
> 3. **Scanner mode cycles too fast.** Default 3s channel dwell. On a crackly 4G connection, the WebRTC peer handshake for each channel takes 1-2s. The channel is already cycling before audio arrives. Increase to 8s minimum dwell.
> 4. **VOX triggers on wind noise.** A field officer walking in 30km/h NZ Canterbury wind will constantly accidentally transmit. The VOX threshold needs a UI slider that's immediately visible and a "testing" mode that shows current dB level in real time so officers can calibrate before going on patrol.
> 5. **After a reconnect, the channel name disappears.** Even though pttStore retains `channelId`, the `channelName` is null after reconnect. Officers don't know which channel they're on. Bug in the reconnect path — must re-sync `channelName` from the server `sync` message.
> 6. **No offline/degraded-connection warning.** On a VPS-hosted server with no redundancy, if the ptt-server goes down, the field officer just sees "connecting…" indefinitely. They should see after 15s: "PTT server unreachable — use mobile phone direct."
> 7. **The transmission log timestamps are in UTC.** NZ officers will be confused. All timestamps must be in `Pacific/Auckland` time.

### [Architect] — Engineering Assessment

> The foundation is strong. `ptt.ts` and `server.js` are well-architected. The gaps fall into four buckets:
>
> 1. **Security hardening** — 3 critical issues (TLS, hardcoded IP, TURN password)
> 2. **Mobile PTT** — full Expo AV + WebRTC implementation needed
> 3. **Operational completeness** — transcription, transmission log, emergency broadcast persistence, token refresh
> 4. **UX polish** — PTT button sizing, mic indicator, channel name on reconnect, timezone, VOX calibration

---

## 3. Build Plan — Phased Tickets

### Phase 0 — Security Hardening (Do This Week)

> These are live security issues. No new features until these are resolved.

---

**P0-1: Enable TLS on ptt-server + switch to wss:// + TURN on TCP/443**  
**Owner**: Ops  
**Files**: VPS nginx config, `ptt-server/.env`, Supabase secret `PTT_SERVER_URL`

Research confirms: *"Always TURN on TCP port 443 with TLS. Corporate firewalls frequently block UDP. This single change resolves most 'WebRTC doesn't work on our corporate network' issues."* — WebRTC Infrastructure Guide 2026.

Steps:
1. Install nginx on VPS (or caddy — simpler TLS)
2. Get Let's Encrypt cert for `ptt.onspace.build` (or subdomain on `srv1601189.hstgr.cloud`)
3. Configure nginx reverse proxy: `wss://ptt.onspace.build → ws://127.0.0.1:8080`
4. Update Supabase secret: `PTT_SERVER_URL=https://ptt.onspace.build`
5. Update `VITE_PTT_SERVER_URL` in frontend env
6. **Add TURN TCP/443 listener to coturn config:**
   ```
   listening-port=3478
   tls-listening-port=5349
   alt-tls-listening-port=443
   cert=/etc/letsencrypt/live/turn.onspace.build/fullchain.pem
   pkey=/etc/letsencrypt/live/turn.onspace.build/privkey.pem
   min-tls-version=1.2
   ```
7. Update ICE server config in Edge Function to include TCP/443 TURN entry:
   ```json
   { "urls": "turns:turn.onspace.build:443?transport=tcp", "username": "...", "credential": "..." }
   ```
8. Test: `wscat -c "wss://ptt.onspace.build/ws"`
9. Test TURN TCP: `turnutils_uclient -t -p 443 -u ptt_turn_user -w <password> turn.onspace.build`

---

**P0-2: Remove hardcoded fallback IP from Edge Function**  
**Owner**: Dev  
**File**: `supabase/functions/ptt-signaling-token/index.ts` line 22

```typescript
// BEFORE
const DEFAULT_PTT_SERVER_URL = 'http://72.61.123.97:8080'
const PTT_SERVER_URL = Deno.env.get('PTT_SERVER_URL') || Deno.env.get('PTT_SERVICE_URL') || DEFAULT_PTT_SERVER_URL

// AFTER
const PTT_SERVER_URL = Deno.env.get('PTT_SERVER_URL') || Deno.env.get('PTT_SERVICE_URL')
if (!PTT_SERVER_URL) {
  return errorResponse(503, 'PTT_SERVER_URL not configured')
}
```

---

**P0-3: Audit + rotate TURN password**  
**Owner**: Ops  
**File**: VPS `/etc/turn-server/.env`

Steps:
1. SSH to VPS: `ssh root@72.61.123.97`
2. Check current password: `grep TURN_PASSWORD /etc/turn-server/.env`
3. Generate new: `openssl rand -base64 32`
4. Update `/etc/turn-server/.env` and restart coturn
5. Update Supabase secret `TURN_CREDENTIAL`
6. Update `ptt-server` env `TURN_CREDENTIAL`
7. Test TURN: `turnutils_uclient -u ptt_turn_user -w <new_password> 72.61.123.97 3478`

---

**P0-4: Reduce token TTL + add proactive refresh**  
**Owner**: Dev  
**Files**: `supabase/functions/ptt-signaling-token/index.ts`, `src/lib/ptt.ts`

Research refinement: PTT is an always-relay workload (unlike video calls, 100% of PTT traffic goes through TURN — there is no P2P fallback for audio). This means credential rotation impacts every active session simultaneously, making the overlap window more critical than for video calls.

- Reduce JWT `expiresIn` from `600` → `300` seconds
- In `ptt.ts` refresh logic: start refresh at **50% TTL (150s remaining)**, not 60% (180s) — larger overlap window covers Supabase cold-start latency (3–8s confirmed in practice)
- On cold-start 401: retry token mint up to 3× with 2s backoff before surfacing error to user

---

**P0-5: Add force-disconnect path to ptt-server**  
**Owner**: Dev  
**File**: `ptt-server/server.js`

Add HTTP endpoint:
```
DELETE /api/connections/:userId   (auth: x-proxy-secret)
```
This closes the WebSocket for that userId and removes them from `userPresence`. Called by the Edge Function on user deactivation. Wire into the user offboarding flow in Admin portal.

---

### Phase 1 — UX Fixes (This Sprint)

These fix the field-usability issues found in Human Test review.

---

**P1-1: PTT button — full-width, 80px minimum, haptic**  
**File**: `src/pages/PTTRadio.tsx`

- Replace current button with a full-width hold-to-talk bar at the bottom of the screen
- Min height: 80px on mobile (use `min-h-20 md:min-h-14`)
- On `startSpeaking`: call `navigator.vibrate(200)` (haptic)
- On `stopSpeaking`: call `navigator.vibrate([100, 50, 100])`
- Use `touch-none select-none` to prevent accidental text selection on long-press

---

**P1-2: Big mic-live indicator — pulsing ring**  
**File**: `src/pages/PTTRadio.tsx`

When `isSpeaking === true`:
- Show a full-screen-edge red pulsing ring (CSS `animate-ping` on a border div)
- Large "TRANSMITTING" label, bold, red, center screen  
- Audio level meter: thick radial bar, not a thin line
- When `speakerId !== null && speakerId !== currentUser.id`: show "RECEIVING — <speakerName>" with green pulse

---

**P1-3: Fix channelName null after reconnect**  
**File**: `src/lib/ptt.ts`

In the WebSocket `message` handler for `sync` event:
- Extract `channelName` from the sync payload if present
- If not in payload, derive from `channelScope` (e.g., `org:<uuid>` → look up org name from pttStore or authStore)
- Call `setPTTState({ channelName: derivedName })` after every successful reconnect

---

**P1-4: Scanner mode minimum dwell 8s**  
**File**: `src/pages/PTTRadio.tsx`

- Change scanner dwell constant from `3000` → `8000` ms
- Add UI control: dwell time slider (5s / 8s / 15s)
- Pause scanner automatically when any channel is active (someone speaking)

---

**P1-5: VOX calibration panel**  
**File**: `src/pages/PTTRadio.tsx`

- Add "Calibrate VOX" button that opens a popover
- Shows real-time dB meter (use existing `audioLevel` from pttStore)
- Slider to set `voxThreshold` with instant preview
- Label: "Current ambient: X dB — Threshold: Y dB"
- Save threshold to localStorage (already done) + future: user_preferences

---

**P1-6: PTT server unreachable — degraded state warning**  
**File**: `src/lib/pttBackground.ts`

- After 15s of `connecting` status with no success: set a new `degradedMode: true` flag in pttStore
- Render in `PTTBar.tsx`: amber banner — "⚠ PTT server unreachable — use radio or direct call"
- Include last-known reconnect attempt count

---

**P1-7: All PTT timestamps → Pacific/Auckland**  
**Files**: `src/pages/PTTRadio.tsx`, any transmission log renders

- Replace all `new Date().toLocaleTimeString()` with:
  ```typescript
  new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
  ```

---

**P1-8: Wire RTCPeerConnection.getStats() polling + telemetry (New — from research)**  
**Owner**: Dev  
**Files**: `src/lib/ptt.ts`, new `supabase/functions/ptt-diagnostics-ingest/index.ts`

This is the most impactful observability gap found in research. The "radio stuck in connecting" failure was invisible because we had no instrument watching the ICE path. The WebRTC spec provides `RTCPeerConnection.getStats()` — every browser exposes this and it is the only source of per-session quality data.

The research guidance: *"Poll this every 5 seconds and send it to your telemetry backend. This is per-session quality data that no server can give you."* — WebRTC Infrastructure Guide 2026.

Key metrics to capture:
| Metric | Alert threshold | Meaning |
|---|---|---|
| ICE establishment rate | < 97% → investigate TURN | STUN/TURN misconfiguration |
| TURN relay ratio | Sudden spike → STUN broken | All connections falling to relay |
| Packet loss p95 | > 3% → audio degraded | Network path issue |
| Round-trip time | > 200ms → degraded feel; > 400ms → unusable | Relay geography wrong |
| Call setup time | > 5s → users abandon | ICE gathering slow |
| Active ICE candidate type | `relay` vs `srflx` vs `host` | Shows if TURN is being used unnecessarily |

Implementation:
```typescript
// In ptt.ts — after RTCPeerConnection is created
const statsInterval = setInterval(async () => {
  if (!peerConnection || peerConnection.connectionState === 'closed') return
  const stats = await peerConnection.getStats()
  const report: PTTStatsSample = { timestamp: Date.now(), channelId, userId }
  stats.forEach(s => {
    if (s.type === 'candidate-pair' && s.state === 'succeeded') {
      report.rtt = s.currentRoundTripTime * 1000
      report.packetsSent = s.packetsSent
      report.packetsReceived = s.packetsReceived
    }
    if (s.type === 'remote-candidate') {
      report.iceType = s.candidateType // 'relay' | 'srflx' | 'host'
    }
    if (s.type === 'inbound-rtp') {
      report.packetsLost = s.packetsLost
      report.jitter = s.jitter
    }
  })
  // Ship to Supabase (fire-and-forget, don't block PTT on this)
  supabase.from('ptt_diagnostic_events').insert(report).then()
}, 5000)
```

DB migration: `ptt_diagnostic_events` table with columns `(id, user_id, channel_id, org_id, rtt_ms, packet_loss, jitter, ice_type, created_at)` + 7-day TTL via pg_cron delete.

---

### Phase 2 — Operational Completeness

---

**P2-1: Emergency broadcast — server-side persistence**  
**Files**: `ptt-server/server.js`, `src/pages/PTTRadio.tsx`

Server side:
- Add `emergencyBroadcast: Map<orgId, { active: boolean, initiatedBy: string, at: number }>` to server state
- New WS message type `emergency_broadcast` with `{orgId, active, initiatedBy}`
- On connect: broadcast current emergency state to joining clients
- Store to DB via Supabase REST call (optional for MVP — in-memory is fine)

Client side:
- Wire emergency button to send `emergency_broadcast` WS message (not just local state)
- Show full-screen red overlay for all clients when `emergency_broadcast.active === true`

---

**P2-2: PTT audio transcription via Bob**  
**Files**: `src/lib/ptt.ts`, new `supabase/functions/ptt-transcribe/index.ts`

Flow:
1. After `stopSpeaking`, if `mediaRecorder` has a blob: upload audio blob to Supabase Storage (`ptt-clips` bucket, path `<orgId>/<channelId>/<timestamp>.webm`)
2. Call new Edge Function `ptt-transcribe` with the Storage URL
3. `ptt-transcribe` calls Bob's `/transcribe` endpoint (or Whisper-compatible inference)
4. Result stored to `ptt_transmission_log` table: `{ user_id, channel_id, transcript, duration_ms, clip_url, created_at }`
5. Transcript shown in `lastClips` array in PTTRadio under the transmission entry

Bob integration point:
```json
POST /functions/v1/ptt-transcribe
{ "clip_url": "https://...", "duration_ms": 4200, "channel_scope": "org:xxx" }
```

---

**P2-3: Transmission log page**  
**File**: new `src/pages/PTTTransmissionLog.tsx` + route `/radio/log`

- Table: timestamp (NZ time), officer name, channel, duration, transcript excerpt
- Filter: date range, channel, officer
- Click row → play clip (from Supabase Storage URL)
- Export CSV button
- Link from PTTRadio header "View Log"

---

**P2-4: Finalize ptt_* database migrations**  
**Directory**: `supabase/migrations/`

Verify/create migrations for:
```sql
-- ptt_channels
create table if not exists ptt_channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),
  channel_type text not null, -- 'org' | 'team' | 'incident' | 'direct' | 'deployment'
  name text,
  created_at timestamptz default now()
);

-- ptt_transmission_log  
create table if not exists ptt_transmission_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  channel_id text not null,
  org_id uuid references organizations(id),
  duration_ms integer,
  transcript text,
  clip_url text,
  created_at timestamptz default now()
);

-- RLS: officers see own org only; admin/master see all
```

---

**P2-5: Per-officer channel ACL (UI)**  
**Files**: `src/pages/OfficerProfile.tsx` (or admin UI), `supabase/functions/ptt-signaling-token`

- Add `ptt_channel_access: string[]` column to `profiles` (list of explicitly allowed channel scopes beyond default org)
- Edge Function: check `ptt_channel_access` during authorization
- Admin UI: toggle checkboxes per officer for which channels they can access

---

**P2-6: Redis session store for ptt-server (New — from research)**  
**Owner**: Dev  
**File**: `ptt-server/server.js`, `ptt-server/package.json`

> *"Storing room state only in process memory — when that server restarts, every active room disappears, and clients cannot rejoin. Redis costs almost nothing and eliminates this entire failure mode."* — WebRTC Infrastructure Guide 2026

Currently `channelMeta` and `userPresence` are plain JS objects in the Node.js process. A server restart silently drops all active sessions and prevents rejoin until clients time out and reconnect (typically 30–60s of dead air for field officers).

Steps:
1. Add Redis to VPS: `apt install redis-server` (localhost-only, no external exposure)
2. Add `ioredis` to `ptt-server/package.json`
3. Replace in-memory maps:
   ```js
   // BEFORE
   const channelMeta = new Map()
   const userPresence = new Map()

   // AFTER
   import Redis from 'ioredis'
   const redis = new Redis({ host: '127.0.0.1', port: 6379 })
   // channelMeta key: `ptt:channel:<channelId>` (hash)
   // userPresence key: `ptt:presence:<orgId>` (set of userId strings)
   // TTL: 24h on all keys — auto-expiry prevents stale state build-up
   ```
4. Emergency broadcast state (`emergencyBroadcast`) also moves to Redis key `ptt:emergency:<orgId>`
5. On server start: load existing state from Redis and re-broadcast `sync` to any reconnecting clients

This also enables **horizontal scaling** of ptt-server behind a load balancer if needed in future (multiple Node processes share Redis state).

---

### Phase 3 — Mobile PTT (Expo)

This is the highest-impact user-facing gap. Scoped as a standalone module.

**Module location**: `mobile-app/src/modules/ptt/`

**Subcomponents:**
```
mobile-app/src/modules/ptt/
├── components/
│   ├── PTTButton.tsx          # Full-width hold-to-talk button
│   ├── PTTStatusBar.tsx       # Compact channel/speaker indicator
│   ├── PTTRadioScreen.tsx     # Full PTT console screen
│   └── VOXCalibrator.tsx      # Threshold calibration overlay
├── services/
│   ├── pttWebSocket.ts        # WS client (uses native WebSocket in RN)
│   ├── pttWebRTC.ts           # react-native-webrtc peer connection
│   ├── pttAudio.ts            # expo-av recording + playback
│   └── pttBluetooth.ts        # react-native-ble-plx PTT button mapping
├── hooks/
│   ├── usePTTConnection.ts    # WS connect/disconnect lifecycle
│   ├── usePTTTransmit.ts      # start/stop speaking, mic acquisition
│   └── usePTTPresence.ts      # presence list from WS sync events
└── types.ts
```

**Key dependencies to add to mobile-app/package.json:**
- `react-native-webrtc` — WebRTC peer connections on iOS/Android
- `expo-av` — Audio recording (backup if WebRTC mic doesn't work in background)
- `react-native-ble-plx` — Bluetooth PTT button
- `expo-task-manager` + `expo-background-fetch` — Background PTT service
- `expo-haptics` — Haptic feedback on TX start/stop

**Mobile PTT UX spec:**
- Full-bottom-third PTT bar (persistent on officer home screen)
- Press: mic acquires, red pulsing ring, haptic double-buzz
- Release: stops TX, short haptic
- Receive: green pulsing ring, speaker name banner
- Background: continues receiving even when app backgrounded (TaskManager)
- Wake lock: screen stays on during active transmission

**Ticket P3-1**: Mobile WebSocket client + channel join  
**Ticket P3-2**: Mobile WebRTC peer connections (transmit + receive)  
**Ticket P3-3**: Mobile PTT UI (button, status bar, radio screen)  
**Ticket P3-4**: Bluetooth PTT button mapping  
**Ticket P3-5**: Background PTT service (TaskManager)  
**Ticket P3-6**: Offline degradation + reconnect on mobile  

---

### Phase 4 — SFU Path (When channel > 15 concurrent users)

Not required for MVP. Required when any single channel exceeds ~15 simultaneous audio users (research-revised from original estimate of 10 — audio-only half-duplex degrades later than video).

**Self-hosted SFU options (ranked for this deployment):**

| SFU | Language | Ops overhead | Best for |
|---|---|---|---|
| **LiveKit** (recommended) | Go | Low — single binary, Docker-friendly | Fast to stand up, broad SDK support including React Native |
| **mediasoup** | Node.js + C++ | Medium — more config surface | Maximum flexibility for custom use cases |
| **Janus** | C | High — battle-tested but complex | Legacy/SIP gateway scenarios |

**Why LiveKit for PTT:**
- Single Go binary, runs on the same VPS or a single RunPod pod
- Native React Native SDK (`livekit-client`) — directly usable in mobile module (Phase 3)
- Built-in support for audio-only rooms (lower resource use than video SFU)
- Self-hosted docker deployment: `docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev`
- Connects to existing coturn TURN relay — no additional TURN infrastructure

**Architecture when SFU is active:**
```
Officer (browser/mobile) → WSS signaling → LiveKit SFU → audio forwarded to all subscribers
                                ↓
                         TURN (coturn) relay when direct fails
                                ↓
                         ptt-server handles presence/ACL/rate-limit events via LiveKit webhook
```

**Transition path:**
- `PTT_MEDIA_MODE=sfu` env var already reserved in ptt-server
- When set to `sfu`: ptt-server delegates WebRTC peer creation to LiveKit server
- Client switches from raw `RTCPeerConnection` to LiveKit JS SDK (`connectToRoom()`)
- Mobile client uses `@livekit/react-native` SDK (same API surface)
- Presence and ACL events flow back to ptt-server via LiveKit room webhooks

**Tickets:**
- P4-1: Deploy LiveKit self-hosted on VPS (Docker Compose with coturn integration)
- P4-2: Add LiveKit SDK to frontend (`ptt.ts` media-mode switch)
- P4-3: Wire LiveKit webhooks back to ptt-server for presence/ACL enforcement
- P4-4: Add LiveKit to mobile PTT module (replace raw WebRTC in `pttWebRTC.ts`)
- P4-5: Load test LiveKit with Artillery + WebRtcPerf (validate 50+ concurrent audio users)

---

## 4. Execution Order

```
Week 1:  P0-1 (TLS + TURN TCP/443), P0-2 (remove hardcoded IP), P0-3 (TURN password)
Week 1:  P0-4 (token TTL — refresh at 150s), P0-5 (force-disconnect)
Week 2:  P1-1 through P1-7 (all UX fixes — can be done in parallel)
Week 2:  P1-8 (getStats telemetry — do alongside UX fixes)
Week 3:  P2-4 (DB migrations), P2-1 (emergency broadcast server), P2-2 (transcription)
Week 3:  P2-6 (Redis session store — do before P2-1 so emergency state uses Redis)
Week 4:  P2-3 (transmission log page), P2-5 (channel ACL)
Sprint 2: P3-1 through P3-3 (mobile PTT core)
Sprint 3: P3-4 through P3-6 (mobile Bluetooth + background)
Sprint 4: P4 (LiveKit SFU — only if channel occupancy triggers threshold)
```

---

## 5. Definition of Done

A PTT session is considered production-ready when:

- [ ] TLS/wss enforced; no http:// fallback in any config
- [ ] TURN listening on both UDP/3478 and TCP/443 with TLS cert
- [ ] TURN password rotated; TURN relay verified with `turnutils_uclient` (UDP + TCP)
- [ ] Hardcoded VPS IP removed from all Edge Functions
- [ ] Token refresh starts at 150s remaining (50% of 300s TTL), not 10s before expiry
- [ ] Cold-start 401 retried up to 3× with backoff before surfacing error
- [ ] Force-disconnect endpoint live and wired to admin user offboarding
- [ ] Redis installed on VPS; ptt-server channelMeta and userPresence persisted to Redis
- [ ] Emergency broadcast state stored in Redis and survives server restart
- [ ] PTT button minimum 80px height on mobile viewports
- [ ] Pulsing TX ring indicator on all transmit states
- [ ] channelName persists through reconnect
- [ ] All timestamps display in Pacific/Auckland
- [ ] Emergency broadcast persisted server-side and shown to all org clients
- [ ] Audio transcription stored in ptt_transmission_log
- [ ] `RTCPeerConnection.getStats()` polled every 5s; data in `ptt_diagnostic_events` table
- [ ] Grafana dashboard showing ICE type, packet loss p95, RTT, TURN relay ratio
- [ ] Mobile app (Expo) PTT functional: transmit, receive, background listen
- [ ] Playwright smoke test: officer can join channel, transmit, and receive via second session

---

## 6. Monitoring & Observability

### Self-Hosted Observability Stack
All monitoring is self-hosted — no third-party APM:
- **Coturn**: Native Prometheus metrics endpoint (enabled by default in official Docker image). Scrape at `/metrics` port 9641.
- **ptt-server**: Expose `/metrics` endpoint with `prom-client` (add to `ptt-server/package.json`)
- **Prometheus**: Scrape coturn + ptt-server + Node.js runtime metrics
- **Grafana**: Dashboard visualising the signals below. Reference: `github.com/sj82516/coturn-with-prometheus-grafana-on-docker`
- **Browser telemetry**: `RTCPeerConnection.getStats()` every 5s → `ptt_diagnostic_events` Supabase table (P1-8)

### Signal Table

| Signal | Source | Method | Alert threshold |
|---|---|---|---|
| ICE establishment rate | Browser (getStats) | `ptt_diagnostic_events` agg | < 97% → STUN/TURN issue |
| TURN relay ratio | Browser (getStats) | ice_type = 'relay' % | Sudden spike → STUN broken |
| Packet loss p95 | Browser (getStats) | packetsLost / packetsTotal | > 3% → audio degraded |
| Round-trip time | Browser (getStats) | currentRoundTripTime | > 200ms → investigate relay geography |
| Call setup time | Browser | time from connect() to 'connected' | > 5s → ICE gathering slow |
| ptt-server uptime | Server | Prometheus + nginx healthcheck | > 30s down → Slack alert |
| TURN relay health | Ops | `turnutils_uclient` in CI cron | Failure = immediate alert |
| Active sessions | Redis | `ptt:presence:*` key count | 0 during active shift hours → alert |
| Token mint errors | Supabase logs | Edge Function 5xx rate | > 5 in 5 min → alert |
| Transmission log gap | DB | No entries > 30 min during shift | Alert admin |

### Load Testing Tools (Self-Hosted)
- **Artillery** (WebSocket engine): simulate 50+ officers joining channels simultaneously. YAML declarative, easiest CI integration. Use for signaling server load.
- **WebRtcPerf**: Full WebRTC peer simulation with real audio tracks. Use for end-to-end quality validation at load. `npm install -g webrtcperf`
- **k6 + xk6-browser**: Hybrid load testing when both WS and DOM behavior need testing together.

---

## 7. Future Considerations (Phase 5+)

Grounded in [7 WebRTC Trends 2026](https://dev.to/alakkadshaw/7-webrtc-trends-shaping-real-time-communication-in-2026-1o07) — watch but do not implement until Phase 4 is stable:

| Trend | Relevance to PTT | Action |
|---|---|---|
| **ML noise suppression (TensorFlow.js)** | High — replaces VOX threshold slider (P1-5) with always-on wind/ambient noise gate that runs in-browser without server round-trip | Evaluate after Phase 2 complete |
| **Media over QUIC (MoQ)** | Medium — could replace WebSocket signaling for large all-call broadcasts (200+ officers) combining WebRTC latency with broadcast scale | Monitor IETF status; not production-ready until 2027+ |
| **DTLS 1.3** | Low — coturn already configured for TLS 1.2 min; DTLS 1.3 improves handshake time slightly | Set `min-tls-version=1.3` in coturn when full browser support lands |
| **SFrame E2EE** | Medium — for security operations requiring end-to-end encryption of audio even from SFU operators | Enables server-side recording only with explicit key escrow — evaluate when client mandates it |
| **OpenAI Realtime API / WebRTC** | High — Bob voice agent could join PTT channels directly via WebRTC as a listener/transcriber | Design hook in ptt-server for service-role WebSocket clients (non-human participants) |

---

## 8. Bob's Closing Note

> This plan gives us a radio system that actually works for the people who need it at 2am in a campsite with rain hitting their jacket and a difficult camper refusing to leave. The security hardening is non-negotiable — get that done before anything else. The mobile implementation is the user-facing priority after that. The transcription feature is where Bob becomes genuinely useful: officers talk, the system writes, patrol records fill themselves. That's the vision.

## Dr Bob's Closing Note

> I've identified 5 blockers. None of them are hypothetical — all 5 will cause real issues in a production security operation. The TLS issue is the most urgent; WebRTC signaling over plaintext on a VPS is not acceptable for a professional security company. The TURN password issue is the most embarrassing to explain to a client. Fix Phase 0 this week.

## Human Test Closing Note

> The hold-to-talk button needs to be so big you can't miss it. Everything else is secondary. If an officer can't reliably key up in 0.5 seconds in the dark, the system has failed. Make the button huge, make the feedback obvious, make the reconnect automatic and silent.
