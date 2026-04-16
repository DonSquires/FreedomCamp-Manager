# Push-to-Talk (PTT) Self-Hosted Blueprint

Status: Production baseline active.

This document is the source of truth for the PTT communications stack. The platform is designed to be self-hosted for signaling and application control. The only intentional non-self-hosted dependencies are external data intake systems such as NZSCV and other third-party feeds.

Operational runbook: see docs/PTT_SELF_HOSTED_OPERATIONS_STANDARD.md.

## Scope and Operating Model

1. PTT signaling is self-hosted on Railway via the ptt-server service.
2. Authorization and policy enforcement are self-hosted in Supabase Edge Functions.
3. Client control plane and media negotiation are implemented in the application codebase.
4. NAT traversal is supported with STUN by default and TURN when configured.
5. Third-party communication platforms are not used for core PTT operations.

## Channel Model

1. Direct: direct:user_id
2. Organization: org:organization_id
3. Team: team:team_id
4. Deployment: deployment:deployment_id
5. Incident: incident:incident_id

## Input and Interaction Modes

1. Hold-to-talk (default)
2. Toggle talk
3. VOX mode
4. Bluetooth headset support
5. Mobile hardware button integration path

## Implemented Components

1. PTT signaling server: ptt-server
2. Token broker and policy checks: supabase/functions/ptt-signaling-token
3. Frontend runtime: src/lib/ptt.ts and src/stores/pttStore.ts
4. Background auto-connect: src/lib/pttBackground.ts and src/hooks/usePTTAutoConnect.ts
5. UI controls and channel operations: src/components/features/PTTBar.tsx and radio route UI
6. Replay and audit support: ptt_messages, ptt_presence, ptt_channels schema

## Authoritative Secret Model

Use these canonical names only for PTT.

1. PTT_SERVER_URL: public URL of the ptt-server service
2. PTT_PROXY_SECRET: shared secret between ptt-signaling-token and ptt-server
3. PTT_JWT_SECRET: token signing key used by ptt-server mint endpoint

Notes:

1. PTT does not rely on NZSCV proxy secret aliases.
2. The ptt-server reads PTT_PROXY_SECRET.
3. The ptt-signaling-token function reads PTT_PROXY_SECRET.

## Runtime Security Controls

1. Organization-scoped channel authorization in ptt-signaling-token
2. Short-lived channel token minting
3. Private storage pattern for clip replay metadata
4. Production HTTPS enforcement in ptt-server when NODE_ENV=production
5. CI deploy health checks include token mint probe to detect secret drift

## Network and TURN Model

1. Baseline: STUN is always available for simple network paths.
2. Reliability mode: configure TURN_URL, TURN_USERNAME, TURN_CREDENTIAL for restrictive NAT and enterprise networks.
3. TURN is not optional for mission-critical field operation quality across mixed carrier networks.

## Current Limitations and Planned Hardening

1. Current signaling state is in-memory and tuned for single replica operation.
2. Multi-replica scale requires shared state and pub/sub, typically Redis.
3. Mobile hard background behavior remains a controlled roadmap item.

## Professional Self-Hosted Target State

1. Dedicated PTT Railway service with one canonical secret model.
2. Mandatory TURN configuration in production.
3. Single authoritative runbook for deploy, incident response, and rollback.
4. Optional Redis-backed signaling state for horizontal scaling.
5. Synthetic smoke tests for officer, admin, and master role access on every release.

## Acceptance Criteria

1. Role smoke tests pass for officer, admin, and master on the radio route.
2. PTT mint probe returns expected auth behavior in CI.
3. No PTT docs instruct deprecated proxy secret aliases.
4. PTT deploy docs reference only canonical PTT secret names.
5. TURN variables are present in production when reliability mode is required.

## Non-Goals

1. Replacing third-party data intake sources such as NZSCV.
2. Outsourcing PTT control plane to hosted communication vendors.
