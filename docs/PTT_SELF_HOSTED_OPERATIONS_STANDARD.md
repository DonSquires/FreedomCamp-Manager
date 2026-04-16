# PTT Self-Hosted Operations Standard

Updated: April 16, 2026
Owner: Platform Engineering

## 1. Purpose

This standard defines how Push-to-Talk communications are operated as a self-hosted system in production.

Scope:
1. PTT signaling service runtime
2. PTT authentication and authorization flow
3. Deployment, monitoring, and incident response
4. Capacity and reliability controls

Out of scope:
1. Third-party data intake systems (for example NZSCV)
2. Non-PTT integrations

## 2. System Topology

1. Client (web/mobile): captures microphone, handles PTT UI interactions
2. Supabase Edge Function (ptt-signaling-token): validates user and channel scope, brokers mint request
3. PTT signaling server (ptt-server): issues short-lived channel tokens and manages websocket signaling
4. Optional TURN relay: supports restrictive NAT/firewall environments
5. Supabase tables: ptt_messages, ptt_presence, ptt_channels metadata

## 3. Canonical Configuration

Required secrets:
1. PTT_SERVER_URL
2. PTT_PROXY_SECRET
3. PTT_JWT_SECRET

Recommended production variables:
1. NODE_ENV=production
2. MAX_PARTICIPANTS_PER_CHANNEL=50
3. MAX_CLIP_DURATION_SECONDS=30

Reliability mode (recommended for live operations):
1. TURN_URL
2. TURN_USERNAME
3. TURN_CREDENTIAL

## 4. Security Model

1. All clients obtain PTT access through ptt-signaling-token.
2. Channel scope is validated by role and organization membership.
3. ptt-server mint endpoint requires x-proxy-secret matching PTT_PROXY_SECRET.
4. ptt-server token signing uses PTT_JWT_SECRET.
5. Production mode enforces HTTPS expectations through reverse proxy headers.

## 5. Deployment Standard

1. Deploy ptt-server with deploy-ptt-railway workflow.
2. Run health probe on /health.
3. Run auth probe on /api/token/mint expecting 401 with invalid probe secret.
4. Sync PTT_SERVER_URL and PTT_PROXY_SECRET to Supabase vault.
5. Verify smoke test pass for officer/admin/master on the radio route.

Release gate checklist:
1. Railway deployment status is healthy
2. Mint probe result is valid
3. Smoke test file passes in Chromium
4. No deprecated PTT secret names in docs or workflow comments

## 6. Operational Limits

Current architecture assumptions:
1. Single replica signaling state (in-memory)
2. Half-duplex channel speaker ownership managed in-process

Implications:
1. Horizontal scaling is not yet safe without shared state
2. Deploys should preserve low churn and controlled restart windows

## 7. Scaling Roadmap

Phase A: harden single-node production
1. Keep one replica
2. Add synthetic checks every 5 minutes
3. Establish alert thresholds for connection failures

Phase B: enable multi-node
1. Introduce Redis for channel membership and presence coordination
2. Move speaking lock state to shared storage
3. Add pub/sub fanout for cross-instance signaling events
4. Test rolling deploy behavior under active channels

## 8. Incident Response Playbook

Severity 1: PTT unavailable for all users
1. Confirm /health endpoint status
2. Confirm /api/token/mint probe behavior
3. Check PTT_PROXY_SECRET parity between Railway and Supabase
4. Validate PTT_SERVER_URL in Supabase vault
5. If unresolved in 10 minutes, place system in text-chat fallback mode and notify operations

Severity 2: Partial degradation (selected carriers or locations)
1. Validate TURN_URL, TURN_USERNAME, TURN_CREDENTIAL
2. Confirm TURN provider availability
3. Compare failed sessions by network type
4. Keep service live and communicate degraded network guidance

Severity 3: Role- or org-specific failures
1. Check edge function auth logs
2. Validate channel scope formatting and org ownership checks
3. Validate user profile role/organization assignment

## 9. Testing Standard

Required smoke test:
1. officer can open /radio
2. admin can open /radio
3. master can open /radio

Recommended extension tests:
1. token refresh after 10-minute expiry
2. reconnect after websocket interruption
3. turn-enabled session under restrictive NAT
4. emergency broadcast channel interaction

## 10. Documentation Governance

1. This file and docs/push-to-talk.md are authoritative for PTT communications.
2. Any change to PTT secret names must update all PTT docs in one pull request.
3. Deprecated alias references for PTT are not allowed in new documentation.
