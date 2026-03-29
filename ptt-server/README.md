# PTT Signaling Server

Push-to-Talk WebRTC signaling server for FreedomCamp Manager. This service handles real-time communication for voice chat between field officers and admin staff.

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
railway variables set PROXY_SECRET=your-secret
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
   - `PROXY_SECRET`: Shared secret with Edge Functions
   - `PTT_JWT_SECRET`: JWT signing secret (must match Edge Function)
   - `PORT`: Auto-set by Railway
5. Deploy and copy the URL

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Auto | Server port (Railway sets this) |
| `PROXY_SECRET` | Yes | Authenticates requests from Edge Functions |
| `PTT_JWT_SECRET` | Yes | Signs/verifies channel access tokens |
| `MAX_PARTICIPANTS_PER_CHANNEL` | No | Limit per channel (default: 50) |
| `MAX_CLIP_DURATION_SECONDS` | No | Max recording length (default: 30) |
| `TURN_URL` | No | TURN server URL for NAT traversal |
| `TURN_USERNAME` | No | TURN server username |
| `TURN_CREDENTIAL` | No | TURN server password |

## API Endpoints

### HTTP

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/info` | Service info |
| POST | `/api/token/mint` | Mint channel access token |
| GET | `/api/channels` | List active channels |
| GET | `/api/presence/:channelId` | Get channel presence |

### WebSocket

Connect to `/ws?token=<jwt>` for real-time signaling.

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
{ type: 'sync', channelId: string, presence: User[], speakerId?: string }

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

## Integration with FreedomCamp Manager

1. **Supabase Edge Function** `ptt-signaling-token` mints tokens by calling `/api/token/mint`
2. **Frontend** connects to WebSocket with token
3. **Audio** is captured via Web Audio API and streamed via WebRTC
4. **Fallback clips** are uploaded to Supabase Storage on talk end

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

# List active channels
curl -H "x-proxy-secret: your-secret" \
  https://your-service.railway.app/api/channels
```

## Related Documentation

- [Push-to-Talk Blueprint](../docs/push-to-talk.md)
- [Push-to-Talk Options](../docs/push-to-talk-options.md)
- [Railway Deployment Guide](../docs/RAILWAY_DEPLOYMENT_GUIDE.md)
