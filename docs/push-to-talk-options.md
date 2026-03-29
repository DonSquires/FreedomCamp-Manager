# Push-to-Talk (PTT) options — research and integration sketch

This note summarizes off‑the‑shelf PTT apps and SDKs, and how we could add PTT to FreedomCamp Manager with minimal risk.

## Quick landscape (what exists)

**Dedicated PTT apps**
- **Zello** – “gold standard” latency; public/private channels, replay; pricing ~$6.8–8/user/mo (Zello Work).
- **Voxer** – PTT + recorded history, E2EE, media sharing; free tier, Pro ~$3.99/mo.
- **NuovoTeam** – PTT plus workforce features (attendance, device mgmt), 128‑bit encryption.
- **Two Way** – ultra‑simple channel number model, no accounts.
- Carrier PTT (e.g., Verizon PTT Plus) – hardware/plan tied, ~$30/line.

**Platforms with PTT**
- Microsoft Teams Walkie Talkie (needs admin enablement; mobile focused).
- Discord/Telegram/Google Meet: have push‑to‑talk toggles for voice channels (not tailored to field ops).

## What “good” looks like for us
- **Low latency (<300 ms) half‑duplex** with a “hold to talk” control.
- **Org + channel scoping** (org-wide, zone/team channels, 1:1).
- **Works on web + mobile app** (we have Expo/React Native and web).
- **Auth + permissions** tied to existing Supabase roles/orgs.
- **Background friendly on mobile**; graceful fallback on poor connections.
- **Recording optional** (likely off by default for privacy; toggle per channel).

## Integration paths (ranked)

### 1) Use a hosted WebRTC voice service (fastest to pilot)
- Candidates: **Daily**, **LiveKit Cloud**, **Agora**, **Twilio Programmable Voice**, **Vonage RTC**.
- Fit: Gives sub‑second latency and SDKs for web + React Native; we layer a PTT UI (mute/unmute gate) and map “rooms” to org/channels.
- Effort: 3–5 days for a pilot room (web) + token issuance via a small Supabase Edge Function; mobile adds a few more days.
- Notes: Avoid recordings initially; enforce org/role in token claims; throttle concurrent speakers if we want strict half‑duplex.

### 2) Self-host LiveKit (more control, more ops)
- Fit: Same client API, can enforce half‑duplex server-side with track state; deploy via Docker (k8s/VM).
- Effort: +1–2 days infra + monitoring; ongoing ops cost.

### 3) Piggyback on existing voice PTT apps (Zello/Voxer)
- Fit: fastest if users adopt a separate app, but breaks our unified UX and RLS; no tight linkage to incidents/rosters.
- Effort: minimal engineering, but poor integration and dual identity management.

## Recommended approach (practical)
- **Pilot with a hosted WebRTC provider (Daily or LiveKit Cloud).**
  - Add a **“Push to Talk” control** to our Team Chat UI as a gated audio track:
    - Hold (or tap-to-lock) toggles local audio track mute.
    - Show “who’s talking” via active speaker events.
  - **Edge Function** to mint short‑lived access tokens:
    - Input: `channel_id`, `org_id`, `user_id`, `role`.
    - Validate org/role (reuse existing RLS helpers) and emit provider token with those claims.
  - **Channel model**:
    - Org-wide channel.
    - Zone/shift channels (reuse `zone_id` / roster shift).
    - 1:1 channel by user pair (optional).
  - **Privacy defaults**: recording OFF; no transcription; keep audio in RAM only.
  - **Network fallback**: auto-drop to text if RTT > threshold; surface reconnect toast.

## Rough implementation steps
1) Choose provider (recommend **Daily** for speed / **LiveKit** if we want future self-host).
2) Create a Supabase **Edge Function** `create-ptt-token`:
   - Auth: user JWT; check org/role; accept `channel_scope`.
   - Returns provider token + room name (org + channel).
3) Web client (React):
   - Add “Hold to talk” button to Team Chat; on press, unmute track; on release, mute.
   - Show active speaker indicator; small “connected” badge; error toasts.
4) Mobile (Expo):
   - Mirror control with press-and-hold; ensure background audio permission handling.
5) Ops/limits:
   - Hard-cap participants per channel (e.g., 50) to avoid runaway cost.
   - Token TTL short (e.g., 10 minutes) and auto-refresh.

## Risks / open questions
- Recording/compliance requirements (most councils will prefer no recording).
- Background mode on iOS requires entitlements; confirm acceptable UX.
- Data costs for officers on cellular; consider “audio low bitrate” option.
- Accessibility: provide tap-to-toggle in addition to hold-to-talk.

## If we must avoid third-party RTC
- We could hack a **Supabase Realtime + Opus-in-UDP-like** approach, but browser WebRTC is the only practical low-latency path. Rolling our own media server is high risk. Hosted RTC is the pragmatic route.
