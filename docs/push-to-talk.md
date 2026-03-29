# Push-to-Talk (PTT) Blueprint

Status: **Not yet implemented** — this document outlines the smallest viable approach to add Zello/Voxer–style push-to-talk inside FreedomCamp Manager while reusing existing Supabase + Railway infrastructure.

## Goals (lifted from proven PTT apps)
- **Low-latency voice hold-to-talk** (tap/hold, auto-stop on release)
- **Public channels + direct 1:1** (channels scoped by organization)
- **Replay last messages** (short-lived buffer, optional retention)
- **Presence/availability** (online, busy, on-shift)
- **Cross-platform** (web + mobile app shell)

## Proposed v1 architecture
- **Transport:** WebRTC per-session, with **Supabase Realtime** for signaling (presence + SDP/ICE exchange).
- **Fallback / replay:** On talk end, upload a short Opus/WEBM clip to Supabase Storage and emit its URL to the channel for late listeners.
- **Permissions:** Re-use `get_user_role(auth.uid())` and organization scoping. Only on-shift officers can publish; admins/master can monitor all.
- **Channels:** `org:<org_id>` (default) plus ad-hoc incident channels `incident:<id>`. Directs target a user_id.
- **UI:** Add a **PTT bar** to TeamChat: big “Hold to talk” button, channel selector, presence pill, last-clip replay.

## Edge functions / backend
- **signaling-token**: Mint short-lived access token for Realtime channel join (role + org scoped).
- **store-clip (optional)**: Validate clip size/duration, write to Storage bucket `ptt-clips`, emit metadata row in `ptt_messages`.
- **cleanup cron**: Delete clips >30 days unless flagged for evidence.

## Database sketch (public schema)
```sql
-- Audio clip metadata (replay / audit)
create table if not exists ptt_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  channel text not null,                 -- org:123, incident:abc, direct:<user_id>
  sender_id uuid references auth.users,
  sender_role text,
  clip_url text,                         -- Supabase Storage signed URL
  duration_seconds integer,
  created_at timestamptz default now()
);

-- Presence cache (optional; Realtime presence is primary)
create table if not exists ptt_presence (
  user_id uuid primary key,
  organization_id uuid,
  status text check (status in ('online','busy','offshift')),
  updated_at timestamptz default now()
);
```

## Frontend integration plan
1) **Add PTT store** (`src/stores/pttStore.ts`): chosen channel/target, mute state, last clip metadata.
2) **PTT bar component** in `TeamChat`: hold-to-talk (mousedown/touchstart → start stream; mouseup/touchend → stop + upload).
3) **WebRTC helpers** (`src/lib/ptt.ts`): request mic, create peer connection, negotiate via Realtime channel, handle fallback upload.
4) **Presence**: reuse Realtime presence channel per org; show who is listening/talking.
5) **Audit / replay**: list last N clips with play button; auto-expire via signed URLs.

## Security / privacy
- Enforce **org scoping** on signaling + storage.
- Limit clip duration (e.g., 30s) and file size (e.g., 1.5 MB).
- Set Storage bucket to **private**; serve via signed URLs.
- Respect notification preferences; do not auto-play when muted.

## Railway self-hosted services to support PTT
- **Realtime / Supabase**: existing project (no change).
- **Optional media relay**: For poor P2P environments, deploy a lightweight **mediasoup/ion-sfu** instance on Railway; configure TURN (e.g., Twilio/Nimble/Wiretrustee) for NAT traversal.
- **Clip scanning** (future): add a small Deno/Node function to virus-scan / content-check clips before making them playable.

## Incremental rollout
1) Ship UI + signaling with small “PTT Beta” toggle (behind feature flag).
2) Add clip replay + audit trail.
3) Add media relay/TURN for reliability.
4) Mobile app shell: map hold-to-talk to hardware PTT button if available.

## Open items / decisions needed
- TURN provider choice & budget.
- Retention period for audio clips (default 30 days?).
- Whether to block recording when off-shift / welfare alert active.
