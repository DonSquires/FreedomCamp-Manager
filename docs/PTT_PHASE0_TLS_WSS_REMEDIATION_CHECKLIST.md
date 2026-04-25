# PTT Phase 0 TLS and WSS Remediation Checklist

Updated: 2026-04-24
Owner: Platform + Voice Team

This checklist is tied directly to audit warnings produced by [scripts/ptt-phase0-runtime-audit.sh](scripts/ptt-phase0-runtime-audit.sh).

## Root Cause Summary

1. PTT endpoint is currently configured as HTTP (`http://72.61.123.97:8080`) in runtime config, which leads to mixed-content risk for HTTPS clients.
2. HTTPS probe to the PTT host times out, which indicates no public TLS listener/reverse proxy is active on port 443.
3. Transport diagnostics report `forceTurnRelay=false` and `iceTransportPolicy=all`, so strict relay posture is not enabled.
4. `check-ptt-health` is not deployed, and previous checks that only used this endpoint returned 404.
5. Existing deployed health function appears to be [supabase/functions/check-railway-health/index.ts](supabase/functions/check-railway-health/index.ts), which includes `ptt_ws_url` validation.

## Required Fixes

1. Enable TLS termination for PTT signaling.
2. Set `PTT_WS_URL` to `wss://.../ws` in Supabase secrets.
3. Enable strict relay posture (`FORCE_TURN_RELAY=true`, `PTT_DISABLE_PUBLIC_STUN=true`) only after TURN credentials are confirmed valid.
4. Ensure CI audits use fallback health endpoint logic (`check-ptt-health` then `check-railway-health`).

## Step-by-Step Remediation

1. Configure TLS reverse proxy for PTT:
   - Use [scripts/ptt-configure-wss.mjs](scripts/ptt-configure-wss.mjs) to generate nginx guidance.
   - Confirm HTTPS responds at `/health` with HTTP 200.
2. Update Supabase secrets:
   - `PTT_SERVER_URL=https://<ptt-host>`
   - `PTT_WS_URL=wss://<ptt-host>/ws`
3. Redeploy edge functions that mint/validate signaling URLs:
   - [supabase/functions/ptt-signaling-token/index.ts](supabase/functions/ptt-signaling-token/index.ts)
   - [supabase/functions/check-railway-health/index.ts](supabase/functions/check-railway-health/index.ts)
4. Verify TURN and strict relay:
   - Confirm `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` are set on PTT runtime.
   - Set `FORCE_TURN_RELAY=true` and `PTT_DISABLE_PUBLIC_STUN=true`.
   - Confirm diagnostics return `forceTurnRelay=true` and `iceTransportPolicy=relay`.
5. Run strict audit:
   - `PTT_AUDIT_FAIL_ON_WARN=true PTT_AUDIT_REQUIRE_STRICT_RELAY=true PTT_AUDIT_REQUIRE_HTTPS=true PTT_AUDIT_REQUIRE_SUPABASE_CHECK=true bash scripts/ptt-phase0-runtime-audit.sh`

## Acceptance Criteria

1. PTT base URL is HTTPS in runtime and secret config.
2. Supabase health function reports `ptt_ws_url` with `wss://`.
3. HTTPS `/health` returns HTTP 200 from public PTT host.
4. Diagnostics show strict relay posture.
5. [ .github/workflows/ops-ptt-professional-audit.yml](.github/workflows/ops-ptt-professional-audit.yml) passes with strict mode enabled.

## Troubleshooting Hints

1. If strict relay fails while TURN appears configured, verify credentials are named exactly `TURN_USERNAME` and `TURN_CREDENTIAL` in the PTT runtime.
2. If Supabase check returns 404, deploy `check-ptt-health` or ensure `check-railway-health` remains deployed and reachable.
3. If HTTPS probe returns 000/timeouts, confirm firewall allows TCP 443 and reverse proxy virtual host is bound to the public hostname/IP.
