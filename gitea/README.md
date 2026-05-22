# Private Gitea Service

This folder is the first deployment scaffold for a private Gitea instance on Railway backed by Supabase PostgreSQL.

## What it includes

- Official `gitea/gitea:latest` container image
- Railway manifest for a single replica with a health check
- Example environment variables for Supabase-backed PostgreSQL
- Bootstrap SQL for the dedicated `gitea_core` schema

## Required setup

1. Create the `gitea_core` schema in Supabase using `bootstrap-schema.sql`.
2. Set the database connection values in Railway secrets.
3. Mount a persistent Railway Volume at `/data`.
4. Point `GITEA__server__ROOT_URL` and `GITEA__server__DOMAIN` at the Railway public domain or custom domain.

## Notes

- Gitea stores repositories, avatars, and its config under `/data`.
- The database connection should remain private and should not be committed into source control.
- Use `webhook-receiver.mjs` to run a local test lane on push events.
- Use `webhook.env.example` as the baseline Railway env wiring for the webhook receiver service.
- Use `setup-ssh.sh` to create the local SSH host entry and keypair for a Gitea host.
- Use `setup-dual-push.sh` to configure mirrored push targets for Gitea + GitHub, starting in dry-run mode.
- If you want to route Bob into Gitea write access next, the next step is a constrained service that uses the Gitea REST API to create branches, commits, and pull requests.

## Dry-run examples

Start webhook receiver with env file values:

```bash
set -a
source gitea/webhook.env.example
set +a
node gitea/webhook-receiver.mjs
```

Configure dual push (dry run first):

```bash
GITEA_PUSH_URL=git@gitea:your-username/FreedomCamp-Manager.git \
GITHUB_PUSH_URL=git@github.com:your-username/FreedomCamp-Manager.git \
DRY_RUN=true \
bash gitea/setup-dual-push.sh
```