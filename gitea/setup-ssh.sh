#!/usr/bin/env bash
set -euo pipefail

GITEA_HOST="${GITEA_HOST:-}"
GITEA_SSH_USER="${GITEA_SSH_USER:-git}"
GITEA_SSH_PORT="${GITEA_SSH_PORT:-22}"
GITEA_IDENTITY_FILE="${GITEA_IDENTITY_FILE:-$HOME/.ssh/id_ed25519_gitea}"
SSH_CONFIG_FILE="${SSH_CONFIG_FILE:-$HOME/.ssh/config}"

if [[ -z "$GITEA_HOST" ]]; then
  echo "Set GITEA_HOST to your Railway or custom Gitea hostname."
  exit 1
fi

mkdir -p "$HOME/.ssh"
touch "$SSH_CONFIG_FILE"

if [[ ! -f "$GITEA_IDENTITY_FILE" ]]; then
  ssh-keygen -t ed25519 -f "$GITEA_IDENTITY_FILE" -C "gitea@$GITEA_HOST" -N ""
fi

cat > "$HOME/.ssh/config.d-gitea.tmp" <<EOF
Host gitea
  HostName $GITEA_HOST
  User $GITEA_SSH_USER
  Port $GITEA_SSH_PORT
  IdentityFile $GITEA_IDENTITY_FILE
  IdentitiesOnly yes
EOF

if grep -q "# BEGIN GITEA" "$SSH_CONFIG_FILE" 2>/dev/null; then
  awk '
    BEGIN { skip = 0 }
    /# BEGIN GITEA/ { skip = 1; next }
    /# END GITEA/ { skip = 0; next }
    skip == 0 { print }
  ' "$SSH_CONFIG_FILE" > "$HOME/.ssh/config.d-gitea.cleaned"
  mv "$HOME/.ssh/config.d-gitea.cleaned" "$SSH_CONFIG_FILE"
fi

{
  echo "# BEGIN GITEA"
  cat "$HOME/.ssh/config.d-gitea.tmp"
  echo "# END GITEA"
} >> "$SSH_CONFIG_FILE"

rm -f "$HOME/.ssh/config.d-gitea.tmp"
chmod 600 "$SSH_CONFIG_FILE" "$GITEA_IDENTITY_FILE" "${GITEA_IDENTITY_FILE}.pub"

if command -v ssh-keyscan >/dev/null 2>&1; then
  ssh-keyscan -p "$GITEA_SSH_PORT" "$GITEA_HOST" >> "$HOME/.ssh/known_hosts" 2>/dev/null || true
fi

echo "Configured SSH host alias 'gitea'."
echo "Add the public key below to your Gitea account or deployment key settings:"
cat "${GITEA_IDENTITY_FILE}.pub"