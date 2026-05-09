#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-fcmanager.co.nz}"
DMARC_HOST="${DMARC_HOST:-_dmarc.${DOMAIN}}"

current_mx="$(dig +short MX "$DOMAIN" | sort -n)"
current_dmarc="$(dig +short TXT "$DMARC_HOST" | tr -d '"' | head -n1)"

cat <<EOF
Email DNS Remediation Plan (${DOMAIN})

Current MX:
${current_mx:-<none>}

Current DMARC:
${current_dmarc:-<none>}

Required Registrar Changes (iwantmyname):
1. DELETE MX: ${DOMAIN} priority 50 -> mx3.zoho.com.
2. ENSURE MX:  ${DOMAIN} priority 5  -> mx1.hostinger.com.
3. ENSURE MX:  ${DOMAIN} priority 10 -> mx2.hostinger.com.
4. UPDATE TXT: ${DMARC_HOST} -> v=DMARC1; p=quarantine; rua=mailto:admin@fcmanager.co.nz; pct=100

Verification Commands:
- bash scripts/email-dns-audit.sh
- dig +short MX ${DOMAIN}
- dig +short TXT ${DMARC_HOST}
EOF
