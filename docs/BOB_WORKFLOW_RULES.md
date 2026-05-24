# Bob Workflow Rules

## Roles And Boundaries

- Codespaces AI is the architect and designer for local repo planning, structure, and code proposals.
- Bob is the cloud builder and operator for compile, test, EAS mobile build/update, and deployment-state execution.
- Human approval in the dashboard is required before production-impacting patch execution.

## Toolchain Isolation

- Root workspace uses Node 24.0.0 and npm 11.0.0 from `.node-version`.
- Backend uses Node 20.15.0 and npm 10.8.2 from `backend/.node-version`.
- Backend compile and training flows must route through `backend/scripts/bob-env-run.sh` for engine-safe execution.

## Mobile Build Assembly Line

1. Architect designs mobile changes locally in `mobile-app/`.
2. Changes are pushed to private Gitea over SSH.
3. Gitea webhook triggers `gitea/webhook-receiver.mjs` on Railway.
4. Bob executes EAS commands in cloud runtime:
   - OTA JS hotfix path: `eas update --branch production`
   - Native binary path: `eas build --platform android --profile preview`
5. Bob returns build link/QR to the approval panel for human validation.

## EAS Profile Rules

- `development`: `distribution: internal` for local/dev-client testing.
- `preview`: `distribution: internal` and Android APK output for standalone install testing.
- `production` and `production_ci`: store pipeline profiles for release artifacts.

## Operating Guardrails

- No production deployment is considered complete without approval evidence.
- Keep architecture decisions grounded in repo state, migrations, and active runtime configs.
- Prefer least-privilege credentials and org-aware routing for operational tasks.

## Credential Bootstrap

- Backend startup now auto-loads secrets from common env files (`.env`, `.env.local`, `backend/.env`, `backend/.env.local`) and normalizes aliases into canonical keys.
- Repo API access supports both Gitea and GitHub credentials with automatic fallback.
- Accepted repository credential aliases:
   - `GITEA_BASE_URL` <- `GITEA_URL`, `GITEA_API_URL`
   - `GITEA_TOKEN` <- `GITEA_ADMIN_TOKEN`, `GITEA_API_TOKEN`, `GITEA_ACCESS_TOKEN`
   - `GITEA_OWNER` <- `GITEA_ORG`, `GITEA_ORGANIZATION`
   - `GITEA_REPO` <- `GITEA_REPOSITORY`
- If Gitea credentials are not present, backend will use GitHub credentials (`GITHUB_API_URL`/`GITHUB_SERVER_URL` + `GITHUB_TOKEN`/`GH_TOKEN`) for repository operations.
