#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-fcmanager.co.nz}"
EXPECTED_MX_PRIMARY="${EXPECTED_MX_PRIMARY:-mx1.hostinger.com.}"
EXPECTED_MX_SECONDARY="${EXPECTED_MX_SECONDARY:-mx2.hostinger.com.}"
LEGACY_MX_BLOCKLIST="${LEGACY_MX_BLOCKLIST:-mx3.zoho.com.}"
EXPECTED_SPF_FRAGMENT="${EXPECTED_SPF_FRAGMENT:-include:_spf.mail.hostinger.com}"
DMARC_HOST="${DMARC_HOST:-_dmarc.${DOMAIN}}"
DKIM_HOSTINGER_SELECTOR="${DKIM_HOSTINGER_SELECTOR:-hostingermail-a._domainkey.${DOMAIN}}"
DMARC_REQUIRED_POLICY="${DMARC_REQUIRED_POLICY:-quarantine}"

failures=0
warnings=0

pass() { echo "PASS: $*"; }
warn() { echo "WARN: $*"; warnings=$((warnings + 1)); }
fail() { echo "FAIL: $*"; failures=$((failures + 1)); }

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 2
  fi
}

require_cmd dig

echo "== Email DNS Audit =="
echo "Domain: $DOMAIN"

mx_records="$(dig +short MX "$DOMAIN" | awk '{print $2}' | sort -u)"
if [[ -z "$mx_records" ]]; then
  fail "No MX records found for $DOMAIN"
else
  echo "MX records:"
  echo "$mx_records" | sed 's/^/  - /'

  if echo "$mx_records" | grep -qx "$EXPECTED_MX_PRIMARY"; then
    pass "Expected primary MX present: $EXPECTED_MX_PRIMARY"
  else
    fail "Expected primary MX missing: $EXPECTED_MX_PRIMARY"
  fi

  if echo "$mx_records" | grep -qx "$EXPECTED_MX_SECONDARY"; then
    pass "Expected secondary MX present: $EXPECTED_MX_SECONDARY"
  else
    fail "Expected secondary MX missing: $EXPECTED_MX_SECONDARY"
  fi

  if echo "$mx_records" | grep -qx "$LEGACY_MX_BLOCKLIST"; then
    fail "Legacy MX still present: $LEGACY_MX_BLOCKLIST"
  else
    pass "Legacy MX removed: $LEGACY_MX_BLOCKLIST"
  fi
fi

spf_txt="$(dig +short TXT "$DOMAIN" | tr -d '"' | grep -i '^v=spf1' || true)"
if [[ -z "$spf_txt" ]]; then
  fail "No SPF TXT found for $DOMAIN"
else
  echo "SPF: $spf_txt"
  if [[ "$spf_txt" == *"$EXPECTED_SPF_FRAGMENT"* ]]; then
    pass "SPF includes expected provider fragment"
  else
    fail "SPF does not include expected fragment: $EXPECTED_SPF_FRAGMENT"
  fi
fi

dmarc_txt="$(dig +short TXT "$DMARC_HOST" | tr -d '"' | head -n 1)"
if [[ -z "$dmarc_txt" ]]; then
  fail "No DMARC TXT found at $DMARC_HOST"
else
  echo "DMARC: $dmarc_txt"
  if [[ "$dmarc_txt" == *"p=${DMARC_REQUIRED_POLICY}"* ]]; then
    pass "DMARC policy meets required level: p=${DMARC_REQUIRED_POLICY}"
  elif [[ "$dmarc_txt" == *"p=none"* ]]; then
    warn "DMARC policy is p=none (monitor-only)"
  else
    warn "DMARC policy differs from required level"
  fi
fi

dkim_cname="$(dig +short CNAME "$DKIM_HOSTINGER_SELECTOR")"
if [[ -z "$dkim_cname" ]]; then
  fail "No Hostinger DKIM selector CNAME found at $DKIM_HOSTINGER_SELECTOR"
else
  echo "DKIM selector CNAME: $dkim_cname"
  pass "Hostinger DKIM selector is published"
fi

echo "\nSummary: failures=$failures warnings=$warnings"
if (( failures > 0 )); then
  exit 1
fi

exit 0
