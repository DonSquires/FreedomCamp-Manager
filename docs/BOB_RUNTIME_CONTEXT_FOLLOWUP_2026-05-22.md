# Bob Runtime Context Follow-up (2026-05-22)

## Purpose
Document the follow-up batch committed after the Bob access-control and privileges rollout.

This batch covers:
- Toolchain pinning and runtime consistency.
- Webhook receiver hardening defaults.
- Document-intelligence ingestion safety improvements.
- Chat Studio reliability updates.
- Supabase schema + generated type alignment for Bob runtime context tables.

## Changes Included

### 1) Toolchain and package-manager alignment
- `.node-version` set to `20.15.0`.
- Root `package.json` `packageManager` set to `npm@10.8.2`.
- `docs/STAGING.md` build contract line updated to reflect Node/NPM versions used in validation.

### 2) Gitea webhook receiver hardening
File: `gitea/webhook-receiver.mjs`
- Default bind host changed from `0.0.0.0` to `127.0.0.1`.
- Added `requireSharedSecret` behavior flag:
  - Requires shared secret by default.
  - Can be relaxed for dev via env configuration.
- Secret validation now respects explicit requirement logic.
- Startup logs now include whether shared-secret enforcement is active.

### 3) Document intelligence safety and filtering
File: `scripts/compile-document-intelligence.mjs`
- Removed `.env` from text-ingestion extensions.
- Added sensitive-file exclusion guard for:
  - `.env` and `.env.*`
  - key/certificate artifacts (`.pem`, `.key`, `.p12`, `.pfx`)
  - SSH private key filenames (`id_rsa`, `id_ecdsa`, `id_ed25519`)
- Added glob include-pattern support helper and matching logic.
- Ensured include-pattern filtering is applied to candidate files.
- Set `emitAppCopy` default to `false`.

### 4) Chat Studio robustness updates
File: `src/pages/ChatStudio.tsx`
- Reworked blob->base64 conversion to `FileReader.readAsDataURL` strategy.
- Ensured `AbortController` timeout cleanup is always executed via `finally` after fetch call.
- Preserved existing command payload semantics for Bob manager requests.

### 5) Supabase schema and generated type alignment
- Added migration:
  - `supabase/migrations/20260522000002_bob_runtime_context_tables.sql`
- Migration provisions and secures:
  - `public.system_templates`
  - `public.system_rules`
  - `public.system_knowledge_base`
  - `public.heal_patches`
- Enables RLS and adds admin-scoped policies for read/write where required.
- Updated generated TS DB contracts:
  - `src/types/database.ts`
  - `backend/src/types.ts`
- Includes `heal_patches` typing and `system_knowledge_base` ID alignment.

## Security Notes
- `.env` changes were intentionally excluded from commit/push to avoid secret leakage.
- Document-intelligence script now explicitly blocks common secret-bearing files from ingestion.
- Webhook defaults move toward local binding and explicit secret enforcement.

## Validation Notes
- TypeScript project build check passes in this environment using:
  - Node `20.15.0`
  - npm `10.8.2`

## Files Included In This Follow-up Commit
- `.node-version`
- `backend/src/types.ts`
- `docs/STAGING.md`
- `docs/BOB_RUNTIME_CONTEXT_FOLLOWUP_2026-05-22.md`
- `gitea/webhook-receiver.mjs`
- `package.json`
- `scripts/compile-document-intelligence.mjs`
- `src/pages/ChatStudio.tsx`
- `src/types/database.ts`
- `supabase/migrations/20260522000002_bob_runtime_context_tables.sql`
