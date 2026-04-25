#!/usr/bin/env bash
set -euo pipefail

# Phase 0 runtime audit for PTT transport/security posture.
# Usage:
#   bash scripts/ptt-phase0-runtime-audit.sh
# Optional env overrides:
#   PTT_SERVER_URL, PTT_SERVICE_URL, PTT_API, PTT_API_CODESPACE, PTT_SERVER_IP, PTT_SERVER_HOSTNAME, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
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

curl_http_code() {
  local output_file="$1"
  local err_file="$2"
  shift 2
  curl -sS "${PTT_CURL_RESOLVE_ARGS[@]}" -o "${output_file}" -w '%{http_code}' --max-time 15 "$@" 2>"${err_file}" || true
}

curl_error_hint() {
  local err_file="$1"
  if [[ ! -s "${err_file}" ]]; then
    return
  fi

  if grep -qi 'no alternative certificate subject name matches' "${err_file}"; then
    echo "TLS certificate SAN mismatch for probe host. Set PTT_SERVER_HOSTNAME to the certificate hostname and ensure the reverse proxy certificate covers it."
    return
  fi

  if grep -qi 'certificate' "${err_file}"; then
    echo "TLS certificate validation failed. Verify certificate chain and hostname coverage for the PTT endpoint."
    return
  fi

  if grep -qi 'Could not resolve host' "${err_file}"; then
    echo "DNS resolution failed for the probe host. Verify PTT_SERVER_URL/PTT_SERVER_HOSTNAME DNS records."
    return
  fi
}

PTT_URL="${PTT_SERVER_URL:-${PTT_SERVICE_URL:-${PTT_API:-${PTT_API_CODESPACE:-}}}}"
if [[ -z "${PTT_URL}" && -n "${PTT_SERVER_IP:-}" ]]; then
  # Keep this secure-by-default: if only the host/IP is provided, probe HTTPS.
  PTT_URL="https://${PTT_SERVER_IP}"
fi

# Normalize host-only values to https:// and reject clearly malformed values.
if [[ -n "${PTT_URL}" && "${PTT_URL}" != http://* && "${PTT_URL}" != https://* ]]; then
  if [[ "${PTT_URL}" == *.* || "${PTT_URL}" == *:* ]]; then
    PTT_URL="https://${PTT_URL}"
  elif [[ -n "${PTT_SERVER_IP:-}" ]]; then
    echo "INFO  Ignoring malformed PTT URL value from environment; falling back to PTT_SERVER_IP over HTTPS."
    PTT_URL="https://${PTT_SERVER_IP}"
  else
    PTT_URL=""
  fi
fi

PTT_URL="${PTT_URL%/}"

PTT_PROBE_URL="${PTT_URL}"
PTT_CURL_RESOLVE_ARGS=()

# Optional: when probing an IP-based URL behind TLS, provide the certificate hostname
# and pin DNS resolution to the configured IP so certificate validation can still pass.
if [[ -n "${PTT_URL}" && -n "${PTT_SERVER_IP:-}" && -n "${PTT_SERVER_HOSTNAME:-}" ]]; then
  ptt_host="$(echo "${PTT_URL}" | sed -E 's#^[a-z]+://([^/:]+).*$#\1#')"
  ptt_port="$(echo "${PTT_URL}" | sed -nE 's#^[a-z]+://[^/:]+:([0-9]+).*$#\1#p')"
  ptt_scheme="$(echo "${PTT_URL}" | sed -E 's#^([a-z]+)://.*$#\1#')"

  if [[ -z "${ptt_port}" ]]; then
    if [[ "${ptt_scheme}" == "https" ]]; then
      ptt_port="443"
    else
      ptt_port="80"
    fi
  fi

  if [[ "${ptt_host}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    PTT_PROBE_URL="${PTT_URL/${ptt_host}/${PTT_SERVER_HOSTNAME}}"
    PTT_CURL_RESOLVE_ARGS=(--resolve "${PTT_SERVER_HOSTNAME}:${ptt_port}:${PTT_SERVER_IP}")
    echo "INFO  Using TLS hostname override for probe URL: ${PTT_PROBE_URL}"
  fi
fi

if [[ -z "${PTT_URL}" ]]; then
  check_fail "PTT endpoint unavailable (set PTT_SERVER_URL/PTT_SERVICE_URL/PTT_API/PTT_API_CODESPACE or PTT_SERVER_IP)."
  echo ""
  echo "Summary: pass=${PASS} fail=${FAIL} warn=${WARN}"
  exit 1
fi

echo "PTT URL: ${PTT_URL}"
if [[ "${PTT_PROBE_URL}" != "${PTT_URL}" ]]; then
  echo "PTT Probe URL: ${PTT_PROBE_URL}"
fi

health_code="$(curl_http_code /tmp/ptt_audit_health.json /tmp/ptt_audit_health.err "${PTT_PROBE_URL}/health")"
if [[ "${health_code}" == "200" ]]; then
  check_pass "PTT /health reachable (200)."
else
  health_hint=""
  if [[ "${health_code}" == "000" ]]; then
    health_hint="$(curl_error_hint /tmp/ptt_audit_health.err || true)"
  fi
  if [[ -n "${health_hint}" ]]; then
    check_fail "PTT /health returned HTTP ${health_code}. ${health_hint}"
  else
    check_fail "PTT /health returned HTTP ${health_code}."
  fi
fi

cap_code="$(curl_http_code /tmp/ptt_audit_cap.json /tmp/ptt_audit_cap.err "${PTT_PROBE_URL}/api/capabilities")"
if [[ "${cap_code}" == "200" ]]; then
  proto_ok="$(jq -r '((.websocket.supportedProtocols // []) | index("ptt.v2")) != null' /tmp/ptt_audit_cap.json 2>/dev/null || echo false)"
  missing_msgs="$(jq -r '(["server_hello","hello","hello_ack","signal"] - (.websocket.messageTypes // [])) | join(",")' /tmp/ptt_audit_cap.json 2>/dev/null || echo parse_error)"
  if [[ "${proto_ok}" == "true" && ( -z "${missing_msgs}" || "${missing_msgs}" == "none" ) ]]; then
    check_pass "Capabilities include ptt.v2 and required message types."
  else
    check_fail "Capabilities missing required interop fields (ptt.v2=${proto_ok}, missing=${missing_msgs:-none})."
  fi
else
  cap_hint=""
  if [[ "${cap_code}" == "000" ]]; then
    cap_hint="$(curl_error_hint /tmp/ptt_audit_cap.err || true)"
  fi
  if [[ -n "${cap_hint}" ]]; then
    check_fail "PTT /api/capabilities returned HTTP ${cap_code}. ${cap_hint}"
  else
    check_fail "PTT /api/capabilities returned HTTP ${cap_code}."
  fi
fi

diag_code="$(curl_http_code /tmp/ptt_audit_diag.json /tmp/ptt_audit_diag.err "${PTT_PROBE_URL}/api/diagnostics")"
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
  diag_hint=""
  if [[ "${diag_code}" == "000" ]]; then
    diag_hint="$(curl_error_hint /tmp/ptt_audit_diag.err || true)"
  fi
  if [[ -n "${diag_hint}" ]]; then
    check_fail "PTT /api/diagnostics returned HTTP ${diag_code}. ${diag_hint}"
  else
    check_fail "PTT /api/diagnostics returned HTTP ${diag_code}."
  fi
fi

mint_probe_code="$(curl -sS "${PTT_CURL_RESOLVE_ARGS[@]}" -o /tmp/ptt_audit_mint_probe.json -w '%{http_code}' --max-time 15 \
  -X POST "${PTT_PROBE_URL}/api/token/mint" \
  -H 'Content-Type: application/json' \
  -H 'x-proxy-secret: ptt-audit-invalid' \
  -d '{"userId":"probe","organizationId":"probe","channelScope":"org:00000000-0000-0000-0000-000000000000"}' 2>/tmp/ptt_audit_mint.err || true)"
if [[ "${mint_probe_code}" == "401" ]]; then
  check_pass "Mint endpoint auth guard enforced (401 on invalid secret)."
else
  mint_hint=""
  if [[ "${mint_probe_code}" == "000" ]]; then
    mint_hint="$(curl_error_hint /tmp/ptt_audit_mint.err || true)"
  fi
  if [[ -n "${mint_hint}" ]]; then
    check_fail "Mint endpoint auth guard expected 401, got HTTP ${mint_probe_code}. ${mint_hint}"
  else
    check_fail "Mint endpoint auth guard expected 401, got HTTP ${mint_probe_code}."
  fi
fi

if [[ "${PTT_URL}" == http://* ]]; then
  if [[ "${REQUIRE_HTTPS}" == "true" ]]; then
    check_fail "PTT URL uses HTTP. HTTPS/WSS is required in this audit mode."
  else
    check_warn_or_fail "PTT URL is HTTP. Production should use HTTPS/WSS via reverse proxy."
  fi
fi

if [[ -n "${PTT_SERVER_IP:-}" ]]; then
  if [[ -n "${PTT_SERVER_HOSTNAME:-}" ]]; then
    https_probe_code="$(curl -sS --resolve "${PTT_SERVER_HOSTNAME}:443:${PTT_SERVER_IP}" -o /tmp/ptt_audit_https_health.json -w '%{http_code}' --max-time 10 "https://${PTT_SERVER_HOSTNAME}/health" 2>/tmp/ptt_audit_https_health.err || true)"
  else
    https_probe_code="$(curl -k -sS -o /tmp/ptt_audit_https_health.json -w '%{http_code}' --max-time 10 "https://${PTT_SERVER_IP}/health" 2>/tmp/ptt_audit_https_health.err || true)"
  fi
  if [[ "${https_probe_code}" == "200" ]]; then
    if [[ -n "${PTT_SERVER_HOSTNAME:-}" ]]; then
      check_pass "HTTPS /health reachable on configured PTT host with valid TLS hostname."
    else
      check_pass "HTTPS /health reachable on configured PTT host (certificate hostname not validated; set PTT_SERVER_HOSTNAME for strict TLS validation)."
    fi
  else
    https_hint=""
    if [[ "${https_probe_code}" == "000" ]]; then
      https_hint="$(curl_error_hint /tmp/ptt_audit_https_health.err || true)"
    fi
    if [[ "${REQUIRE_HTTPS}" == "true" ]]; then
      if [[ -n "${https_hint}" ]]; then
        check_fail "HTTPS /health not reachable on configured PTT host (HTTP ${https_probe_code}). ${https_hint}"
      else
        check_fail "HTTPS /health not reachable on configured PTT host (HTTP ${https_probe_code})."
      fi
    else
      if [[ -n "${https_hint}" ]]; then
        check_warn_or_fail "HTTPS /health not reachable on configured PTT host (HTTP ${https_probe_code}). ${https_hint}"
      else
        check_warn_or_fail "HTTPS /health not reachable on configured PTT host (HTTP ${https_probe_code})."
      fi
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
