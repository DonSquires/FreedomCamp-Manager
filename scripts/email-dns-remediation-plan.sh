#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-fcmanager.co.nz}"
DMARC_HOST="${DMARC_HOST:-_dmarc.${DOMAIN}}"
DMARC_TARGET="${DMARC_TARGET:-v=DMARC1; p=quarantine; rua=mailto:admin@fcmanager.co.nz; pct=100}"
DNS_SERVER="${DNS_SERVER:-}"

if [[ -z "$DNS_SERVER" ]]; then
	DNS_SERVER="$(dig +short NS "$DOMAIN" | head -n1)"
fi

if [[ -z "$DNS_SERVER" ]]; then
	echo "Could not determine authoritative nameserver for $DOMAIN" >&2
	exit 2
fi

digq() {
	local type="$1"
	local name="$2"
	dig +short "$type" "$name" "@${DNS_SERVER}"
}

current_mx="$(digq MX "$DOMAIN" | sort -n)"
current_dmarc="$(digq TXT "$DMARC_HOST" | tr -d '"' | head -n1)"

needs_zoho_removal="false"
if echo "$current_mx" | grep -q 'mx3.zoho.com\.'; then
	needs_zoho_removal="true"
fi

needs_dmarc_update="true"
if [[ "$current_dmarc" == *"p=quarantine"* ]]; then
	needs_dmarc_update="false"
fi

cat <<EOF
Email DNS Remediation Plan (${DOMAIN})

Authoritative DNS server:
${DNS_SERVER}

Current MX:
${current_mx:-<none>}

Current DMARC:
${current_dmarc:-<none>}

Required Registrar Changes (iwantmyname):
EOF

if [[ "$needs_zoho_removal" == "true" ]]; then
	echo "1. DELETE MX: ${DOMAIN} priority 50 -> mx3.zoho.com."
else
	echo "1. No Zoho MX cleanup needed (already removed)."
fi

echo "2. ENSURE MX:  ${DOMAIN} priority 5  -> mx1.hostinger.com."
echo "3. ENSURE MX:  ${DOMAIN} priority 10 -> mx2.hostinger.com."

if [[ "$needs_dmarc_update" == "true" ]]; then
	echo "4. UPDATE TXT: ${DMARC_HOST} -> ${DMARC_TARGET}"
else
	echo "4. No DMARC policy update required (already quarantine/reject)."
fi

cat <<EOF

Verification Commands:
- bash scripts/email-dns-audit.sh
- dig +short MX ${DOMAIN}
- dig +short TXT ${DMARC_HOST}
EOF
