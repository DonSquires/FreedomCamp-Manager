# Push-to-Talk (PTT) Architecture Decision Record

Decision: Communications are self-hosted.

This document captures the strategic decision for PTT architecture and explains what we keep, what we reject, and why.

## Final Decision

1. Keep the existing self-hosted PTT signaling stack.
2. Keep role and organization authorization in Supabase Edge Functions.
3. Keep application-owned channel and presence behavior.
4. Do not use hosted voice providers for core PTT communications.

## Why This Decision Was Made

1. Operational control: deployment, incident handling, and rollback remain in our platform.
2. Security posture: one authorization model across officer, admin, and master roles.
3. Data governance: communications flow is controlled by our own runtime and policies.
4. Product fit: channel model and half-duplex behavior map directly to field operations.

## Inspiration from Mature PTT Systems

The system design intentionally follows proven patterns from professional PTT products:

1. Low-latency half-duplex talk flow with explicit speaker ownership.
2. Clear channel taxonomy: organization, incident, team/deployment, direct.
3. Presence and availability indicators for operational awareness.
4. Push-to-talk ergonomics with hold, toggle, and VOX modes.
5. Reliability mode using TURN for difficult network conditions.

## Explicitly Rejected Paths

1. Hosted PTT platforms as the primary communication plane.
2. Outsourced voice SDKs for core production traffic.
3. Split authorization between external communication providers and internal policy checks.

## Current Architecture Baseline

1. Signaling service: ptt-server on Railway.
2. Token broker and authorization: ptt-signaling-token Edge Function.
3. Client runtime: ptt store, websocket lifecycle, WebRTC negotiation, and reconnection logic.
4. Persistence: metadata and audit support through Supabase schema.

## Self-Hosted Reliability Standard

1. Mandatory production secrets: PTT_SERVER_URL, PTT_PROXY_SECRET, PTT_JWT_SECRET.
2. Mandatory production runtime: NODE_ENV=production.
3. Mandatory CI controls: health check plus token mint auth probe.
4. Recommended for mission-critical operations: TURN_URL, TURN_USERNAME, TURN_CREDENTIAL.

## Hardening Roadmap

1. Keep single-replica signaling as an explicit operational constraint until shared state is added.
2. Add Redis-backed presence/channel state for safe horizontal scaling.
3. Add synthetic PTT smoke in release gates.
4. Publish incident runbooks for degraded mode and fallback to text chat.

## Boundaries

1. This decision applies to communications infrastructure.
2. It does not apply to external data sources such as NZSCV and other third-party intake services.
