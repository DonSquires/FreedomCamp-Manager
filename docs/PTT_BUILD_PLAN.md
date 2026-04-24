# PTT System Build Plan
**FieldOps Manager — Push-to-Talk Radio**  
**Version**: 1.0 · Date: 2026-04-23  
**Authors**: GitHub Copilot (Architect), Bob (Operational Intelligence), Dr Bob (Adversarial Review), Human Test (Field Reality)

---

## Collaboration Preface

This plan is the result of a joint session between four reviewers. Each section is annotated with whose voice is speaking:

- **[Architect]** — codebase analysis, engineering decisions, ticket scoping
- **[Bob]** — UX flow, operational correctness, what a field officer actually needs
- **[Dr Bob]** — adversarial critique, blockers, security & reliability risks
- **[Human Test]** — what breaks in a real field scenario with gloves, sun, adrenaline, patchy 4G

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

**P0-1: Enable TLS on ptt-server + switch to wss://**  
**Owner**: Ops  
**Files**: VPS nginx config, `ptt-server/.env`, Supabase secret `PTT_SERVER_URL`

Steps:
1. Install nginx on VPS (or caddy — simpler TLS)
2. Get Let's Encrypt cert for `ptt.onspace.build` (or subdomain on `srv1601189.hstgr.cloud`)
3. Configure nginx reverse proxy: `wss://ptt.onspace.build → ws://127.0.0.1:8080`
4. Update Supabase secret: `PTT_SERVER_URL=https://ptt.onspace.build`
5. Update `VITE_PTT_SERVER_URL` in frontend env
6. Test: `wscat -c "wss://ptt.onspace.build/ws"`

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

- Reduce JWT `expiresIn` from `600` → `300` seconds
- In `ptt.ts` refresh logic: start refresh at 60% TTL (180s remaining), not at expiry minus 10s
- Prevents cold-start race condition flagged by Dr Bob

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

### Phase 4 — SFU Path (Future / >10 users/channel)

Not required for MVP. Required when any single channel exceeds ~10 simultaneous users.

- Evaluate: LiveKit (self-hosted), mediasoup, or ion-sfu
- `PTT_MEDIA_MODE=sfu` env var already reserved in ptt-server
- SFU server would live on the same VPS or a dedicated RunPod pod
- Server routes audio through SFU instead of peer mesh
- Client switches from `RTCPeerConnection` to SFU SDK (e.g., LiveKit JS SDK)

---

## 4. Execution Order

```
Week 1:  P0-1 (TLS), P0-2 (remove hardcoded IP), P0-3 (TURN password)
Week 1:  P0-4 (token TTL), P0-5 (force-disconnect)
Week 2:  P1-1 through P1-7 (all UX fixes — can be done in parallel)
Week 3:  P2-4 (DB migrations), P2-1 (emergency broadcast server), P2-2 (transcription)
Week 4:  P2-3 (transmission log page), P2-5 (channel ACL)
Sprint 2: P3-1 through P3-3 (mobile PTT core)
Sprint 3: P3-4 through P3-6 (mobile Bluetooth + background)
Sprint 4: P4 (SFU — only if needed)
```

---

## 5. Definition of Done

A PTT session is considered production-ready when:

- [ ] TLS/wss enforced; no http:// fallback in any config
- [ ] TURN password rotated; TURN relay verified with `turnutils_uclient`
- [ ] Hardcoded VPS IP removed from all Edge Functions
- [ ] Token refresh race condition resolved (300s TTL, 180s refresh start)
- [ ] Force-disconnect endpoint live and wired to admin user offboarding
- [ ] PTT button minimum 80px height on mobile viewports
- [ ] Pulsing TX ring indicator on all transmit states
- [ ] channelName persists through reconnect
- [ ] All timestamps display in Pacific/Auckland
- [ ] Emergency broadcast persisted server-side and shown to all org clients
- [ ] Audio transcription stored in ptt_transmission_log
- [ ] Mobile app (Expo) PTT functional: transmit, receive, background listen
- [ ] Playwright smoke test: officer can join channel, transmit, and receive via second session

---

## 6. Monitoring & Observability

| Signal | Method | Alert threshold |
|---|---|---|
| ptt-server uptime | `curl http://72.61.123.97:8080/health` via cron | >30s unreachable → PagerDuty/Slack |
| TURN relay health | `turnutils_uclient` in CI job | Failure = alert |
| Token mint errors | Supabase Edge Function logs | 5xx spike → alert |
| Active channels | `/api/channels` API endpoint | 0 channels when officers on shift → alert |
| Transmission log gap | DB query: no entries >30min during active shift | Alert admin |
| WebRTC ICE failure rate | `getPTTDiagnostics()` in client telemetry | >20% ICE failures → investigate TURN |

---

## 7. Bob's Closing Note

> This plan gives us a radio system that actually works for the people who need it at 2am in a campsite with rain hitting their jacket and a difficult camper refusing to leave. The security hardening is non-negotiable — get that done before anything else. The mobile implementation is the user-facing priority after that. The transcription feature is where Bob becomes genuinely useful: officers talk, the system writes, patrol records fill themselves. That's the vision.

## Dr Bob's Closing Note

> I've identified 5 blockers. None of them are hypothetical — all 5 will cause real issues in a production security operation. The TLS issue is the most urgent; WebRTC signaling over plaintext on a VPS is not acceptable for a professional security company. The TURN password issue is the most embarrassing to explain to a client. Fix Phase 0 this week.

## Human Test Closing Note

> The hold-to-talk button needs to be so big you can't miss it. Everything else is secondary. If an officer can't reliably key up in 0.5 seconds in the dark, the system has failed. Make the button huge, make the feedback obvious, make the reconnect automatic and silent.
