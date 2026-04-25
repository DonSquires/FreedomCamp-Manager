# PTT Interoperability Profile (Professional Systems)

This profile defines how FieldOps PTT integrates with enterprise/professional communication stacks while keeping the current WebRTC signaling model.

## Version
- Protocol profile: fieldops-ptt-interop-v1
- Server version metadata: 2.0.0

## Transport
- WebSocket endpoint: /ws
- Preferred auth: Sec-WebSocket-Protocol includes:
  - ptt.v2 (or ptt.v1 for legacy)
  - auth.<jwt>
- Legacy fallback: query token `?token=<jwt>`

## Handshake
1. Server sends `server_hello` immediately after auth.
2. Client sends `hello` with client identity and media capabilities.
3. Server responds `hello_ack` with selected protocol and profile.

This handshake supports compatibility adapters and versioned evolution without breaking existing clients.

## Capability Discovery
- Endpoint: GET /api/capabilities
- Returns:
  - supported websocket protocols
  - supported signal types
  - supported channel types
  - codec list
  - transport posture (TURN configured / relay enforced)

## Media
- Codec baseline: audio/opus
- Half-duplex speaking lock per channel
- Signaling types: offer, answer, candidate

## Security
- JWT channel token expiry: 5 minutes (default, configurable via `PTT_TOKEN_EXPIRY_SECONDS`)
- Mint endpoint protected by PTT_PROXY_SECRET
- Production HTTPS enforcement via x-forwarded-proto checks
- Token mint cooldown to reduce abuse / flood

## TURN Professional Baseline
For production-grade cross-network reliability:
1. Set TURN_URL, TURN_USERNAME, TURN_CREDENTIAL
2. Validate /api/diagnostics shows TURN configured
3. Enable FORCE_TURN_RELAY=true after TURN health checks pass
4. Optionally set PTT_DISABLE_PUBLIC_STUN=true for strict self-hosted posture

## Scaling Note
Current server state is in-memory and single-instance by design.
For multi-replica professional deployments, add shared presence/channel state + pub/sub (Redis).

## Integration Mapping (External Systems)
- SIP/MCPTT/dispatch integrations should bridge at the signaling boundary via adapter service.
- Adapter service should consume /api/capabilities and perform hello/ack negotiation.
- Keep authorization source-of-truth in Supabase edge functions.
