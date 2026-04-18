# PTT Signaling Server

Push-to-Talk WebRTC signaling server for FieldOps Manager. This service handles real-time communication for voice chat between field officers and admin staff.

## Features

- **WebSocket Signaling**: Facilitates WebRTC peer connections
- **Half-Duplex Voice**: One speaker at a time per channel
- **Channel Types**: Organization-wide, incident-specific, and direct 1:1 channels
- **Presence Tracking**: Real-time user status (online, busy, off-shift)
- **Token-Based Auth**: JWT tokens issued by Supabase Edge Function
- **TURN Support**: Optional TURN server for NAT traversal

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env and set required values

# Start server
npm run dev

# Test health endpoint
curl http://localhost:3002/health
```

### Deploy to Railway

#### Option 1: Railway CLI

```bash
# Login to Railway
railway login

# Link or create project
railway init

# Set environment variables
railway variables set PTT_PROXY_SECRET=your-secret
railway variables set PTT_JWT_SECRET=your-jwt-secret

# Deploy
railway up

# Get URL
railway status
```

#### Option 2: Railway Dashboard

1. Go to https://railway.app/dashboard
2. Click **"New Project"** → **"Deploy from GitHub"**
3. Select repository, set **Root Directory**: `ptt-server/`
4. Add environment variables:
  - `PTT_PROXY_SECRET`: Shared secret with Edge Functions
   - `PTT_JWT_SECRET`: JWT signing secret (must match Edge Function)
   - `PORT`: Auto-set by Railway
5. Deploy and copy the URL

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Auto | Server port (Railway sets this) |
| `PTT_PROXY_SECRET` | Yes | Authenticates requests from Edge Functions |
| `PTT_JWT_SECRET` | Yes | Signs/verifies channel access tokens |
| `MAX_PARTICIPANTS_PER_CHANNEL` | No | Limit per channel (default: 50) |
| `MAX_CLIP_DURATION_SECONDS` | No | Max recording length (default: 30) |
| `PTT_TOKEN_TRACKER_RETENTION_MS` | No | Retain per-user mint throttle entries for this long (default: 300000) |
| `PTT_ALLOWED_PREVIEW_ORIGIN_REGEX` | No | Regex used to allow preview subdomains under onspace.build |
| `TURN_URL` | No | TURN server URL for NAT traversal |
| `TURN_USERNAME` | No | TURN server username |
| `TURN_CREDENTIAL` | No | TURN server password |
| `FORCE_TURN_RELAY` | No | Set `true` to force relay-only ICE and fail token mint if TURN is missing |
| `PTT_DISABLE_PUBLIC_STUN` | No | Set `true` to avoid Google STUN and use only self-hosted TURN-derived STUN when relay is not forced |

Canonical secret model:
- This service reads only `PTT_PROXY_SECRET` for proxy authentication.
- The Supabase Edge Function `ptt-signaling-token` must use the same `PTT_PROXY_SECRET` value.

## API Endpoints

### HTTP

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/info` | Service info |
| GET | `/api/diagnostics` | Runtime transport diagnostics (TURN + relay policy) |
| POST | `/api/token/mint` | Mint channel access token |
| GET | `/api/channels` | List active channels |
| GET | `/api/presence/:channelId` | Get channel presence |

### WebSocket

Preferred auth mode:
- Connect using WebSocket subprotocols: `ptt.v1` and `auth.<jwt>`

Backward-compatible mode:
- `ws(s)://.../ws?token=<jwt>` is still accepted for older clients.

#### Client → Server Messages

```typescript
// Request to speak
{ type: 'start_speaking' }

// Stop speaking (with optional clip URL)
{ type: 'stop_speaking', clipUrl?: string, duration?: number }

// WebRTC signaling
{ type: 'signal', signal: RTCSignal, targetUserId?: string }

// Update status
{ type: 'status', status: 'online' | 'busy' | 'offshift' }

// Heartbeat
{ type: 'ping' }
```

#### Server → Client Messages

```typescript
// Initial sync on connect
{ type: 'sync', channelId: string, presence: User[], speakerId?: string, transport?: { turnConfigured: boolean, forceTurnRelay: boolean, iceTransportPolicy: 'all' | 'relay' } }

// Presence updates
{ type: 'presence', event: 'join' | 'leave' | 'status', userId, name, role }

// Speaking state
{ type: 'speaking', event: 'start' | 'stop', userId, name, clipUrl?, duration? }

// WebRTC signal relay
{ type: 'signal', fromUserId, fromName, signal: RTCSignal }

// Error
{ type: 'error', code: string, message: string }

// Heartbeat response
{ type: 'pong', timestamp: string }
```

## Integration with FieldOps Manager

1. **Supabase Edge Function** `ptt-signaling-token` mints tokens by calling `/api/token/mint`
2. **Frontend** connects to WebSocket with token
3. **Audio** is captured via Web Audio API and streamed via WebRTC
4. **Fallback clips** are uploaded to Supabase Storage on talk end

## Professional Self-Hosted Baseline

1. Keep PTT signaling in this service and avoid external hosted voice providers for core communications.
2. Keep all authorization decisions in the Supabase edge function before minting channel tokens.
3. Set `NODE_ENV=production` in production deployments.
4. Configure TURN for mission-critical operation across restrictive NAT and carrier networks:
  - `TURN_URL`
  - `TURN_USERNAME`
  - `TURN_CREDENTIAL`
5. For guaranteed cross-network behavior, set `FORCE_TURN_RELAY=true` only after TURN is confirmed healthy.
6. Verify runtime posture before go-live using `/api/diagnostics`.
7. For strict self-hosted transport, set `PTT_DISABLE_PUBLIC_STUN=true`.
8. Treat single-instance in-memory state as an explicit scaling constraint until shared state is added.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Web Frontend   │────▶│ PTT Signaling   │◀────│ Mobile App      │
│  (TeamChat)     │     │ Server (Railway)│     │ (Expo)          │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                       │
         │                      │                       │
         ▼                      ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Supabase Edge   │     │ WebRTC P2P      │     │ Supabase        │
│ Functions       │     │ Audio Stream    │     │ Storage (clips) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Scaling Considerations

- Current implementation uses in-memory state (single instance)
- For multi-instance deployment, use Redis for:
  - Channel membership
  - Presence tracking
  - Pub/sub for cross-instance messaging
- Consider Railway Pro for always-on services

## Monitoring

```bash
# View Railway logs
railway logs

# Health check
curl https://your-service.railway.app/health

# Transport diagnostics (TURN + relay policy)
curl https://your-service.railway.app/api/diagnostics

# List active channels
curl -H "x-proxy-secret: your-ptt-proxy-secret" \
  https://your-service.railway.app/api/channels
```

## Related Documentation

- [Push-to-Talk Blueprint](../docs/push-to-talk.md)
- [PTT Self-Hosted Operations Standard](../docs/PTT_SELF_HOSTED_OPERATIONS_STANDARD.md)
- [Push-to-Talk Options](../docs/push-to-talk-options.md)
- [Railway Deployment Guide](../docs/RAILWAY_DEPLOYMENT_GUIDE.md)
