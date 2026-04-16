#!/usr/bin/env bash
set -euo pipefail

: "${TURN_REALM:=fcmanager.local}"
: "${TURN_USERNAME:=ptt_user}"
: "${TURN_PASSWORD:=change-me-now}"
: "${TURN_PORT:=3478}"
: "${TURN_MIN_PORT:=49160}"
: "${TURN_MAX_PORT:=49200}"
: "${TURN_ENABLE_TLS:=false}"
: "${TURN_TLS_PORT:=5349}"
: "${TURN_EXTERNAL_IP:=}"
: "${TURN_LISTEN_IP:=0.0.0.0}"
: "${TURN_NO_UDP:=false}"

TLS_BLOCK=""
if [[ "${TURN_ENABLE_TLS}" == "true" ]]; then
  : "${TURN_CERT_FILE:=/etc/coturn/certs/fullchain.pem}"
  : "${TURN_KEY_FILE:=/etc/coturn/certs/privkey.pem}"
  TLS_BLOCK=$(cat <<EOF
tls-listening-port=${TURN_TLS_PORT}
cert=${TURN_CERT_FILE}
pkey=${TURN_KEY_FILE}
EOF
)
fi

EXTERNAL_IP_LINE=""
if [[ -n "${TURN_EXTERNAL_IP}" ]]; then
  EXTERNAL_IP_LINE="external-ip=${TURN_EXTERNAL_IP}"
fi

NO_UDP_LINE=""
if [[ "${TURN_NO_UDP}" == "true" ]]; then
  NO_UDP_LINE="no-udp"
fi

cat >/etc/coturn/turnserver.conf <<EOF
listening-ip=${TURN_LISTEN_IP}
listening-port=${TURN_PORT}
${EXTERNAL_IP_LINE}
realm=${TURN_REALM}

fingerprint
lt-cred-mech
user=${TURN_USERNAME}:${TURN_PASSWORD}

min-port=${TURN_MIN_PORT}
max-port=${TURN_MAX_PORT}

${NO_UDP_LINE}
no-multicast-peers
no-cli

# Keep logs in container output
simple-log
log-file=stdout

${TLS_BLOCK}
EOF

echo "Starting coturn with realm ${TURN_REALM}"
exec turnserver -c /etc/coturn/turnserver.conf
