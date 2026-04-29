#!/usr/bin/env bash
set -euo pipefail

# TLS/TTL audit for FieldOps Manager public endpoints.
# Usage: APP_HTTPS_URL=... APP_HTTP_URL=... PROXY_HTTPS_URL=... PTT_HTTPS_URL=... DNS_DOMAINS="a.com b.com" bash scripts/tls-ttl-audit.sh

APP_HTTPS_URL="${APP_HTTPS_URL:-https://fcmanager.co.nz}"
APP_HTTP_URL="${APP_HTTP_URL:-http://fcmanager.co.nz}"
PROXY_HTTPS_URL="${PROXY_HTTPS_URL:-}"
PTT_HTTPS_URL="${PTT_HTTPS_URL:-}"
DNS_DOMAINS="${DNS_DOMAINS:-fcmanager.co.nz ptt.fcmanager.co.nz}"
DNS_TTL_MIN="${DNS_TTL_MIN:-300}"
DNS_TTL_MAX="${DNS_TTL_MAX:-14400}"

FAILURES=0
WARNINGS=0

pass() { echo "PASS: $*"; }
warn() { echo "WARN: $*"; WARNINGS=$((WARNINGS + 1)); }
fail() { echo "FAIL: $*"; FAILURES=$((FAILURES + 1)); }

header_value() {
  local url="$1"
  local key="$2"
  curl -fsSI --max-time 15 "$url" | awk -F': ' -v k="$key" 'tolower($1)==tolower(k){print $2}' | tr -d '\r' | tail -n1
}

status_code() {
  local url="$1"
  curl -sSIL -o /dev/null -w '%{http_code}' --max-time 20 "$url"
}

check_https_redirect() {
  echo "\n== HTTPS Redirect Check =="
  local code
  code="$(status_code "$APP_HTTP_URL" || true)"
  case "$code" in
    301|302|307|308)
      pass "HTTP redirects for $APP_HTTP_URL (status $code)"
      ;;
    000)
      warn "Could not reach $APP_HTTP_URL to verify redirect"
      ;;
    *)
      fail "Expected HTTP redirect for $APP_HTTP_URL, got status $code"
      ;;
  esac
}

check_hsts() {
  echo "\n== HSTS Check =="
  local hsts
  hsts="$(header_value "$APP_HTTPS_URL" "Strict-Transport-Security" || true)"
  if [[ -z "$hsts" ]]; then
    fail "HSTS header missing on $APP_HTTPS_URL"
    return
  fi

  if [[ "$hsts" == *"max-age="* ]]; then
    pass "HSTS present on $APP_HTTPS_URL: $hsts"
  else
    fail "HSTS header present but malformed: $hsts"
  fi
}

check_tls_versions_for_host() {
  local host="$1"
  echo "\n== TLS Version Check ($host) =="

  if ! command -v openssl >/dev/null 2>&1; then
    warn "openssl not found; cannot validate TLS protocol negotiation"
    return
  fi

  if echo | openssl s_client -connect "$host:443" -tls1_2 >/dev/null 2>&1; then
    pass "$host accepts TLS 1.2"
  else
    fail "$host does not accept TLS 1.2"
  fi

  if echo | openssl s_client -connect "$host:443" -tls1_3 >/dev/null 2>&1; then
    pass "$host accepts TLS 1.3"
  else
    warn "$host does not negotiate TLS 1.3 (may still be policy-compliant if TLS 1.2 only)"
  fi
}

check_dns_ttl() {
  echo "\n== DNS TTL Check =="
  if ! command -v dig >/dev/null 2>&1; then
    warn "dig not found; skipping DNS TTL checks"
    return
  fi

  for domain in $DNS_DOMAINS; do
    local ttls
    ttls="$(dig +noall +answer "$domain" A | awk '{print $2}')"

    if [[ -z "$ttls" ]]; then
      warn "No A-record answer for $domain"
      continue
    fi

    local min_ttl=999999999
    local max_ttl=0
    local ttl
    for ttl in $ttls; do
      if (( ttl < min_ttl )); then min_ttl=$ttl; fi
      if (( ttl > max_ttl )); then max_ttl=$ttl; fi
    done

    if (( min_ttl < DNS_TTL_MIN )); then
      warn "$domain TTL too low for steady state (min $min_ttl < policy $DNS_TTL_MIN)"
    elif (( max_ttl > DNS_TTL_MAX )); then
      warn "$domain TTL above policy upper bound (max $max_ttl > policy $DNS_TTL_MAX)"
    else
      pass "$domain TTL within policy range ($min_ttl-$max_ttl seconds)"
    fi
  done
}

check_no_store_api_headers() {
  echo "\n== API Cache Header Check =="
  local url
  for url in "$PROXY_HTTPS_URL" "$PTT_HTTPS_URL"; do
    [[ -z "$url" ]] && continue

    local cache
    cache="$(header_value "$url/health" "Cache-Control" || true)"
    if [[ -z "$cache" ]]; then
      warn "No Cache-Control header found on $url/health"
      continue
    fi

    if [[ "$cache" == *"no-store"* ]] || [[ "$cache" == *"no-cache"* ]]; then
      pass "Cache policy present for $url/health: $cache"
    else
      warn "Cache policy for $url/health is not strict no-store/no-cache: $cache"
    fi
  done
}

extract_host() {
  local url="$1"
  echo "$url" | sed -E 's#^https?://##' | sed -E 's#/.*$##'
}

echo "Running TLS/TTL audit..."
echo "APP_HTTPS_URL=$APP_HTTPS_URL"

a_app_host="$(extract_host "$APP_HTTPS_URL")"
check_https_redirect
check_hsts
check_tls_versions_for_host "$a_app_host"

if [[ -n "$PROXY_HTTPS_URL" ]]; then
  check_tls_versions_for_host "$(extract_host "$PROXY_HTTPS_URL")"
fi

if [[ -n "$PTT_HTTPS_URL" ]]; then
  check_tls_versions_for_host "$(extract_host "$PTT_HTTPS_URL")"
fi

check_dns_ttl
check_no_store_api_headers

echo "\nSummary: failures=$FAILURES warnings=$WARNINGS"
if (( FAILURES > 0 )); then
  exit 1
fi

exit 0
