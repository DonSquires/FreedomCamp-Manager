#!/usr/bin/env bash
set -euo pipefail

# Phase 0 runtime audit for PTT transport/security posture.
# Usage:
#   bash scripts/ptt-phase0-runtime-audit.sh
# Optional env overrides:
#   PTT_SERVER_URL, PTT_SERVICE_URL, PTT_SERVER_IP, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
# Optional policy flags:
#   PTT_AUDIT_FAIL_ON_WARN=true|false
#   PTT_AUDIT_REQUIRE_STRICT_RELAY=true|false
#   PTT_AUDIT_REQUIRE_HTTPS=true|false
#   PTT_AUDIT_REQUIRE_SUPABASE_CHECK=true|false

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ROOT_DIR}/.env" || true
  set +a
fi

FAIL_ON_WARN="${PTT_AUDIT_FAIL_ON_WARN:-false}"
REQUIRE_STRICT_RELAY="${PTT_AUDIT_REQUIRE_STRICT_RELAY:-false}"
REQUIRE_HTTPS="${PTT_AUDIT_REQUIRE_HTTPS:-false}"
REQUIRE_SUPABASE_CHECK="${PTT_AUDIT_REQUIRE_SUPABASE_CHECK:-false}"

PASS=0
FAIL=0
WARN=0

check_pass() {
  PASS=$((PASS + 1))
  echo "PASS  $1"
}

check_fail() {
  FAIL=$((FAIL + 1))
  echo "FAIL  $1"
}

check_warn() {
  WARN=$((WARN + 1))
  echo "WARN  $1"
}

check_warn_or_fail() {
  local message="$1"
  if [[ "${FAIL_ON_WARN}" == "true" ]]; then
    check_fail "$message"
  else
    check_warn "$message"
  fi
}

PTT_URL="${PTT_SERVER_URL:-${PTT_SERVICE_URL:-}}"
if [[ -z "${PTT_URL}" && -n "${PTT_SERVER_IP:-}" ]]; then
  PTT_URL="http://${PTT_SERVER_IP}:8080"
fi
PTT_URL="${PTT_URL%/}"

if [[ -z "${PTT_URL}" ]]; then
  check_fail "PTT endpoint unavailable (set PTT_SERVER_URL/PTT_SERVICE_URL or PTT_SERVER_IP)."
  echo ""
  echo "Summary: pass=${PASS} fail=${FAIL} warn=${WARN}"
  exit 1
fi

echo "PTT URL: ${PTT_URL}"

health_code="$(curl -sS -o /tmp/ptt_audit_health.json -w '%{http_code}' --max-time 15 "${PTT_URL}/health" || true)"
if [[ "${health_code}" == "200" ]]; then
  check_pass "PTT /health reachable (200)."
else
  check_fail "PTT /health returned HTTP ${health_code}."
fi

cap_code="$(curl -sS -o /tmp/ptt_audit_cap.json -w '%{http_code}' --max-time 15 "${PTT_URL}/api/capabilities" || true)"
if [[ "${cap_code}" == "200" ]]; then
  proto_ok="$(jq -r '((.websocket.supportedProtocols // []) | index("ptt.v2")) != null' /tmp/ptt_audit_cap.json 2>/dev/null || echo false)"
  missing_msgs="$(jq -r '(["server_hello","hello","hello_ack","signal"] - (.websocket.messageTypes // [])) | join(",")' /tmp/ptt_audit_cap.json 2>/dev/null || echo parse_error)"
  if [[ "${proto_ok}" == "true" && ( -z "${missing_msgs}" || "${missing_msgs}" == "none" ) ]]; then
    check_pass "Capabilities include ptt.v2 and required message types."
  else
    check_fail "Capabilities missing required interop fields (ptt.v2=${proto_ok}, missing=${missing_msgs:-none})."
  fi
else
  check_fail "PTT /api/capabilities returned HTTP ${cap_code}."
fi

diag_code="$(curl -sS -o /tmp/ptt_audit_diag.json -w '%{http_code}' --max-time 15 "${PTT_URL}/api/diagnostics" || true)"
if [[ "${diag_code}" == "200" ]]; then
  turn_cfg="$(jq -r '.transport.turnConfigured // false' /tmp/ptt_audit_diag.json 2>/dev/null || echo false)"
  force_relay="$(jq -r '.transport.forceTurnRelay // false' /tmp/ptt_audit_diag.json 2>/dev/null || echo false)"
  ice_policy="$(jq -r '.transport.iceTransportPolicy // "unknown"' /tmp/ptt_audit_diag.json 2>/dev/null || echo unknown)"

  if [[ "${force_relay}" == "true" && "${turn_cfg}" != "true" ]]; then
    check_fail "FORCE_TURN_RELAY=true while TURN is not configured."
  else
    check_pass "Transport posture valid (turnConfigured=${turn_cfg}, forceTurnRelay=${force_relay}, ice=${ice_policy})."
  fi

  if [[ "${REQUIRE_STRICT_RELAY}" == "true" ]]; then
    if [[ "${force_relay}" == "true" && "${ice_policy}" == "relay" ]]; then
      check_pass "Strict relay posture enforced (forceTurnRelay=true, iceTransportPolicy=relay)."
    else
      check_fail "Strict relay required but not enabled (forceTurnRelay=${force_relay}, iceTransportPolicy=${ice_policy})."
    fi
  else
    if [[ "${force_relay}" != "true" || "${ice_policy}" != "relay" ]]; then
      check_warn_or_fail "Strict relay posture not enabled yet (expected forceTurnRelay=true and iceTransportPolicy=relay for hardened Phase 0)."
    fi
  fi
else
  check_fail "PTT /api/diagnostics returned HTTP ${diag_code}."
fi

mint_probe_code="$(curl -sS -o /tmp/ptt_audit_mint_probe.json -w '%{http_code}' --max-time 15 \
  -X POST "${PTT_URL}/api/token/mint" \
  -H 'Content-Type: application/json' \
  -H 'x-proxy-secret: ptt-audit-invalid' \
  -d '{"userId":"probe","organizationId":"probe","channelScope":"org:00000000-0000-0000-0000-000000000000"}' || true)"
if [[ "${mint_probe_code}" == "401" ]]; then
  check_pass "Mint endpoint auth guard enforced (401 on invalid secret)."
else
  check_fail "Mint endpoint auth guard expected 401, got HTTP ${mint_probe_code}."
fi

if [[ "${PTT_URL}" == http://* ]]; then
  if [[ "${REQUIRE_HTTPS}" == "true" ]]; then
    check_fail "PTT URL uses HTTP. HTTPS/WSS is required in this audit mode."
  else
    check_warn_or_fail "PTT URL is HTTP. Production should use HTTPS/WSS via reverse proxy."
  fi
fi

if [[ -n "${PTT_SERVER_IP:-}" ]]; then
  https_probe_code="$(curl -k -sS -o /tmp/ptt_audit_https_health.json -w '%{http_code}' --max-time 10 "https://${PTT_SERVER_IP}/health" || true)"
  if [[ "${https_probe_code}" == "200" ]]; then
    check_pass "HTTPS /health reachable on configured PTT host."
  else
    if [[ "${REQUIRE_HTTPS}" == "true" ]]; then
      check_fail "HTTPS /health not reachable on configured PTT host (HTTP ${https_probe_code})."
    else
      check_warn_or_fail "HTTPS /health not reachable on configured PTT host (HTTP ${https_probe_code})."
    fi
  fi
fi

supabase_checked=false
if [[ -n "${VITE_SUPABASE_URL:-}" && -n "${VITE_SUPABASE_ANON_KEY:-}" ]]; then
  for endpoint in check-ptt-health check-railway-health; do
    sb_code="$(curl -sS -o /tmp/ptt_audit_supabase_health.json -w '%{http_code}' --max-time 15 \
      "${VITE_SUPABASE_URL%/}/functions/v1/${endpoint}" \
      -H "Authorization: Bearer ${VITE_SUPABASE_ANON_KEY}" || true)"

    if [[ "${sb_code}" == "200" ]]; then
      ws_url="$(jq -r '.ptt_ws_url // "missing"' /tmp/ptt_audit_supabase_health.json 2>/dev/null || echo missing)"
      if [[ "${ws_url}" == wss://* ]]; then
        check_pass "Supabase ${endpoint} reports secure websocket URL (wss)."
      elif [[ "${ws_url}" == "missing" || -z "${ws_url}" ]]; then
        check_warn_or_fail "Supabase ${endpoint} did not return ptt_ws_url. Set PTT_WS_URL and redeploy edge functions."
      else
        check_fail "Supabase ${endpoint} returned non-wss websocket URL (${ws_url})."
      fi
      supabase_checked=true
      break
    fi
  done

  if [[ "${supabase_checked}" != "true" ]]; then
    if [[ "${REQUIRE_SUPABASE_CHECK}" == "true" ]]; then
      check_fail "Supabase PTT health check unavailable (both check-ptt-health and check-railway-health were non-200)."
    else
      check_warn_or_fail "Supabase PTT health check unavailable (both check-ptt-health and check-railway-health were non-200)."
    fi
  fi
else
  if [[ "${REQUIRE_SUPABASE_CHECK}" == "true" ]]; then
    check_fail "Supabase URL/anon key missing; cannot validate ptt_ws_url posture."
  else
    check_warn_or_fail "Supabase URL/anon key missing; skipping ptt_ws_url validation."
  fi
fi

echo ""
echo "Summary: pass=${PASS} fail=${FAIL} warn=${WARN}"
if [[ ${FAIL} -gt 0 ]]; then
  exit 1
fi
if [[ "${FAIL_ON_WARN}" == "true" && ${WARN} -gt 0 ]]; then
  exit 1
fi
