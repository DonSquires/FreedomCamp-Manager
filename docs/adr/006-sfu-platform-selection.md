# ADR 006: SFU Platform Selection for Phase 0 Radio Rebuild

**Date**: 2026-05-15  
**Status**: Proposed (awaiting Phase 0 entry gate approval)  
**Consequences**: Binds Phase 1 architecture to chosen platform; affects deployment cost, latency, and multi-org isolation guarantees.

## Context

FieldOps Manager currently uses peer-to-peer PTT via hPanel for tactical radio. Phase 0 redesigns this as a **professional radio platform** with:
- Selective Forwarding Unit (SFU) for media routing
- Streaming STT + translation
- Optional voice-matched relay
- Multi-org geofence + floor control

The choice of SFU platform directly affects:
1. **Operational cost** (per-minute streaming, bandwidth, compute)
2. **Transcript API availability** (real-time STT integration surface)
3. **Org isolation** (tenant boundaries, RLS enforcement)
4. **Emergency failover** (redundancy model, geographic distribution)
5. **Voice-profile support** (speaker tagging, replay isolation)

## Decision

Evaluate **Livekit** as the primary SFU candidate for Phase 1 pilot, with secondary evaluation of **Mediasoup** and **Janus**.

### Evaluation Matrix

| Criterion | Livekit | Mediasoup | Janus | Notes |
|-----------|---------|-----------|-------|-------|
| **Transcript API** | ✅ Native egress pipeline | ⚠️ Custom webhook | ⚠️ Manual mux | STT ingestion is mandatory for Phase 2 |
| **Org isolation** | ✅ Room-level tokens | ⚠️ Room-level tokens | ⚠️ Custom auth | Multi-tenant scoping via tokens |
| **Cost/min** | ~$0.004–0.008 | Self-host | Self-host | Livekit cloud vs. infrastructure trade-off |
| **Emergency override** | ✅ Room-level grant | ⚠️ Room-level | ⚠️ Room-level | Supervisor access without re-encode |
| **Replay/recording** | ✅ Egress templates | ⚠️ Manual fork | ⚠️ Manual fork | Compliance audit trail |
| **Deployment** | Cloud SaaS | Self-hosted | Self-hosted | FieldOps prefers managed; scaling via capacity purchase |
| **Speaker tagging** | ✅ Built-in | ⚠️ Via webhook | ⚠️ Via webhook | Voice-twin profile attachment |

### Rationale

1. **Livekit** reduces implementation surface by providing:
   - Egress pipelines for STT and TTS rendering (directly supports Phase 2 transcript + Phase 4 translated audio)
   - Out-of-box token-based multi-tenancy (aligns with org-scoped RLS model)
   - Cloud hosting removes infrastructure burden on Iron Eagle Ops
   - Speaker tagging support for Phase 5 voice-twin enrollment

2. **Self-hosted alternatives** (Mediasoup, Janus) are viable if cost becomes prohibitive, but require:
   - Custom egress adapters for Phase 2 STT integration
   - Manual replay/recording fork for compliance
   - Dedicated ops team for scaling and failover

3. **Pilot phase risk reduction**: Use Livekit SaaS for Phase 1 pilot → measure cost and latency → decide self-host migration at Phase 2 gate if economics demand.

## Implementation (Phase 1)

1. **Provision Livekit Cloud account** (Iron Eagle operations team).
2. **Policy gateway** in `supabase/functions/radio-session-grant/` returns Livekit token with org scope.
3. **SFU plane** in `src/lib/radioTransport.ts` connects to Livekit via token.
4. **TURN server** (separate) for restrictive networks (tunnel + ICE fallback).
5. **Test harness** in `tests/e2e/phase1-sfu-connectivity.spec.ts` validates:
   - Multi-org isolation (Officer A cannot hear Officer B's channel without grant)
   - Emergency override (supervisor can join any channel)
   - Reconnect under network loss
   - Bandwidth scaling (2 users → 10 users)

## Fallback Decision (If Phase 0 Entry Gate Blocks Livekit)

If cost or compliance gates block Livekit adoption:
- **Fallback 1**: Deploy **Mediasoup** self-hosted behind Iron Eagle VPC
- **Fallback 2**: Continue PTT baseline (non-decision; rejected by Phase 0 intent)

## Consequences

1. **Phase 1 scope**: Must integrate Livekit token validation, room/channel mapping, and SFU media tap.
2. **Phase 2 prerequisite**: Livekit egress pipeline must be operational before STT ingestion begins.
3. **Cost tracking**: Monthly Livekit usage reported to Iron Eagle business intelligence.
4. **Org policy**: All radio sessions flow through org-scoped token grants; no direct access to SFU.
5. **Compliance**: Org admins can request egress archive (recording) for audit; handled via Livekit egress templates.

## ADR Dependencies

- Depends on ADR-007 (Event Backbone) for floor control signaling
- Feeds into ADR-008 (Voice-Twin Governance) for speaker identity and consent model

## Approval Gate

- [ ] Phase 0 Steering Committee: Cost and operational model approved
- [ ] Iron Eagle Ops: SaaS vs. self-host trade-off accepted
- [ ] Legal/Compliance: Data residency and multi-tenancy isolation documented
- [ ] Platform Architecture: Schema and token flow validated

---

**Phase 0 Entry Gate Status**: ⏳ Pending
