#!/usr/bin/env bash
set -euo pipefail

# Enforce production-safe PTT URL policy.
#
# Inputs (first non-empty wins):
#  - HTTPS URL: PTT_PUBLIC_HTTPS_URL | PTT_SERVER_URL
#  - WSS URL:   PTT_PUBLIC_WSS_URL   | PTT_WS_URL
#
# Optional:
#  - PTT_ALLOWED_HOST_REGEX: regex applied to both hosts.
#    Default allows current stable host plus planned canonical host.

https_url="${PTT_PUBLIC_HTTPS_URL:-${PTT_SERVER_URL:-}}"
wss_url="${PTT_PUBLIC_WSS_URL:-${PTT_WS_URL:-}}"
allowed_host_regex="${PTT_ALLOWED_HOST_REGEX:-^(srv1601189\.hstgr\.cloud|ptt\.fcmanager\.co\.nz)$}"

fail() {
  echo "PTT URL policy violation: $1" >&2
  exit 1
}

extract_host() {
  local url="$1"
  echo "$url" | sed -E 's#^[a-zA-Z]+://([^/:]+).*#\1#'
}

[ -n "$https_url" ] || fail "missing HTTPS URL (PTT_PUBLIC_HTTPS_URL or PTT_SERVER_URL)"
[ -n "$wss_url" ] || fail "missing WSS URL (PTT_PUBLIC_WSS_URL or PTT_WS_URL)"

[[ "$https_url" =~ ^https:// ]] || fail "PTT HTTPS URL must start with https:// (got: $https_url)"
[[ "$wss_url" =~ ^wss:// ]] || fail "PTT websocket URL must start with wss:// (got: $wss_url)"

https_host="$(extract_host "$https_url")"
wss_host="$(extract_host "$wss_url")"

[[ -n "$https_host" ]] || fail "unable to parse host from HTTPS URL"
[[ -n "$wss_host" ]] || fail "unable to parse host from WSS URL"

[[ "$https_host" == "$wss_host" ]] || fail "HTTPS/WSS hosts must match (https=$https_host, wss=$wss_host)"

if [[ "$https_host" =~ trycloudflare\.com$ ]]; then
  fail "quick tunnel hosts are not allowed in production (got: $https_host)"
fi

if [[ "$https_host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "bare IP host is not allowed for production endpoint (got: $https_host)"
fi

if ! [[ "$https_host" =~ $allowed_host_regex ]]; then
  fail "host '$https_host' does not match allowed host policy regex '$allowed_host_regex'"
fi

echo "PTT URL policy check passed:"
echo "  HTTPS: $https_url"
echo "  WSS  : $wss_url"
