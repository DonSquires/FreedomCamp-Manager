# Supabase ↔ GitHub Integration Setup

This guide walks through linking your Supabase project to this GitHub repository so
that:

- GitHub can see and validate the full schema (via committed migrations)
- CI/CD workflows can apply migrations and deploy edge functions automatically
- Automatic Supabase Preview branches spin up for every pull request (optional)

---

## 1 — One-Time Local Setup

Run the following commands from the root of this repository.

### Install the Supabase CLI and log in

```bash
npm install -g supabase
supabase login          # opens browser → generates a personal access token (sbp_…)
```

> **Keep the token** — you will need it for the GitHub secrets in Step 3.

### Link the repo to the live project

```bash
supabase link --project-ref kxwjcupuxnnbnzcgmkoi
```

You will be prompted for the database password.

### Pull the current live schema into Git (first time only)

Copy the **Session pooler** connection string from
**Supabase Dashboard → Connect → Session pooler** and run:

```bash
supabase db pull \
  --db-url "postgres://postgres.kxwjcupuxnnbnzcgmkoi:<DB_PASSWORD>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres"
```

This writes a new migration file in `supabase/migrations/` containing the complete
current schema. Commit and push it:

```bash
git add supabase/migrations/
git commit -m "chore: pull live schema as initial migration"
git push
```

> **Tip:** If you see `permission denied` for the `graphql` schema while pulling,
> run this once in the SQL Editor and retry:
>
> ```sql
> GRANT ALL ON ALL TABLES    IN SCHEMA graphql TO postgres, anon, authenticated, service_role;
> GRANT ALL ON ALL FUNCTIONS IN SCHEMA graphql TO postgres, anon, authenticated, service_role;
> GRANT ALL ON ALL SEQUENCES IN SCHEMA graphql TO postgres, anon, authenticated, service_role;
> ```

---

## 2 — Enable the GitHub Integration in the Supabase Dashboard

1. Go to:
   `https://supabase.com/dashboard/project/kxwjcupuxnnbnzcgmkoi/settings/integrations`
2. Under **GitHub Integration**, click **Authorize GitHub** and approve.
3. Select this repository.
4. Set the **Supabase directory** to `supabase/`.
5. Optionally enable:
   - **Automatic branching** — creates an isolated Supabase Preview branch for every
     GitHub branch / PR and runs your migrations against it.
   - **Deploy to production** — applies new migrations on the `main` branch automatically
     (use with caution; the manual `supabase-db-push.yml` workflow is the safer default).

---

## 3 — Set GitHub Repository Secrets

Navigate to **GitHub → Repository → Settings → Secrets and variables → Actions**
and add the following secrets.

### Required (all workflows)

| Secret name            | Value                                                                  |
|------------------------|------------------------------------------------------------------------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token (`sbp_…`) from<br>https://supabase.com/dashboard/account/tokens |

### Production target

| Secret name               | How to find it                                                    |
|---------------------------|-------------------------------------------------------------------|
| `PRODUCTION_PROJECT_ID`   | Dashboard → Project Settings → General → **Reference ID**        |
| `PRODUCTION_DB_PASSWORD`  | Dashboard → Project Settings → Database → **Database password**  |

For the current production project:
- `PRODUCTION_PROJECT_ID` = `kxwjcupuxnnbnzcgmkoi`
- `PRODUCTION_DB_PASSWORD` = *(the password you set when creating the project)*

### Staging target (optional)

If you have a separate Supabase project used for staging / preview testing:

| Secret name            | Value                                           |
|------------------------|-------------------------------------------------|
| `STAGING_PROJECT_ID`   | Reference ID of the staging Supabase project    |
| `STAGING_DB_PASSWORD`  | Database password of the staging project        |

> **Backward compatibility:** The workflows also accept the older secret names
> `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD` as fallbacks, so existing
> deployments continue to work if the preferred names are absent.

---

## 4 — Configure GitHub Environments

The `supabase-db-push.yml` workflow uses GitHub Environments for approval gates.

### `production-schema` (required for production pushes)

1. Go to **GitHub → Repository → Settings → Environments**.
2. Click **New environment** → name it `production-schema`.
3. Under **Protection rules**, enable **Required reviewers** and add `@DonSquires`.
4. Optionally add a **Deployment branch rule** restricting to `main`.

### `staging-schema` (optional, for staging pushes)

Repeat the steps above with the name `staging-schema`. Leave protection rules empty
(or add lighter-weight rules) so staging pushes can proceed without a manual approval.

---

## 5 — Obtaining a User JWT for Testing

To test an Edge Function with a real user token, sign in via `supabase-js` and read
the session access token:

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://kxwjcupuxnnbnzcgmkoi.supabase.co',
  '<anon-key>'   // Dashboard → Project Settings → API → anon public
)

async function getJwt(email: string, password: string): Promise<string> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session!.access_token   // <-- JWT
}
```

Then call any Edge Function with the token:

```bash
curl -sS 'https://kxwjcupuxnnbnzcgmkoi.supabase.co/functions/v1/<function-name>' \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"hello":"world"}'
```

> **Note:** Never run JavaScript/TypeScript authentication code in the Supabase SQL
> Editor — the SQL Editor only executes SQL. `const`, `await`, and `fetch` are not
> valid SQL syntax. Authentication is handled by the Supabase Auth API, not PostgreSQL.

---

## 6 — Invoking Postgres Functions (SQL)

To call a **Postgres** function (PL/pgSQL), use either the SQL Editor or `supabase-js`:

```sql
-- SQL Editor
SELECT public.my_function(arg1 := 'foo', arg2 := 42);
```

```typescript
// supabase-js client
const { data, error } = await supabase.rpc('my_function', { arg1: 'foo', arg2: 42 })
```

The observations table (68 columns) can be queried directly:

```sql
SELECT observation_id, plate_number, recorded_at
FROM   public.observations
LIMIT  10;
```

---

## 7 — Daily Development Workflow

```bash
# 1. Make schema changes locally or in Supabase Studio
# 2. Generate a migration from the diff
supabase db diff -f <short_description>
# e.g.:  supabase db diff -f add_patrol_status_column

# 3. Test locally
supabase db reset

# 4. Commit and open a PR
git add supabase/migrations/
git commit -m "feat: add patrol status column"
git push && gh pr create

# → If Automatic branching is enabled, a Supabase Preview branch spins up
#   and runs your migrations against an isolated database automatically.
# → After approval and merge to main, run the "Apply Supabase migrations (db push)"
#   workflow manually (Actions tab) with environment = production.
```

---

## 8 — Workflow Reference

| Workflow file              | Trigger                           | Purpose                                          |
|----------------------------|-----------------------------------|--------------------------------------------------|
| `migration-check.yml`      | Push / PR to `supabase/migrations/` | Validate migration file consistency; check remote state |
| `supabase-db-push.yml`     | Manual (`workflow_dispatch`)      | Push migrations to staging or production         |
| `schema-extract.yml`       | Manual (`workflow_dispatch`)      | Extract live schema via Management API + pg_dump |
| `merge_all.yml`            | Push to `main` + manual           | Deploy admin portal, edge functions, config      |

---

## See Also

- [docs/MIGRATION_TROUBLESHOOTING.md](MIGRATION_TROUBLESHOOTING.md) — resolving drift and conflict errors
- [docs/DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) — full production rollout checklist
- [docs/NEW_PROJECT_SETUP.md](NEW_PROJECT_SETUP.md) — provisioning a brand-new environment from zero
- [ops/EDGE_FUNCTIONS_RUNBOOK.md](../ops/EDGE_FUNCTIONS_RUNBOOK.md) — deploying and verifying edge functions
