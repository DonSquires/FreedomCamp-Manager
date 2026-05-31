# Devcontainer Host Rebuild

This repo's devcontainer can be validated from inside a nested container, but it cannot be fully rebuilt there because Docker BuildKit bind mounts fail with `operation not permitted`.

Use one of the host-side flows below.

## Option 1: VS Code Dev Containers

Prerequisites:
- Docker Desktop or a local Docker Engine running on the host
- VS Code with the `Dev Containers` extension installed on the host

Steps:
1. Open the repository root on the host:
   - `/workspaces/FreedomCamp-Manager` in local VM scenarios, or
   - the local clone path on your workstation
2. Run `Dev Containers: Rebuild and Reopen in Container` from the Command Palette.
3. Wait for the build to complete.
4. Open a terminal in the rebuilt container and verify:
   - `node -v`
   - `npm -v`
   - `gh --version`
   - `supabase --version`
   - `deno --version`
   - `bun --version`
   - `rg --version`
5. Run the Bob container verification:
   - `bash scripts/bob-container-doctor.sh --load-runtime`

Expected result:
- Node should resolve to `22.x`
- The Bob doctor should pass
- The container should include the features defined in `.devcontainer/devcontainer.json`

## Option 2: Dev Containers CLI On The Host

Install the CLI on the host:

```bash
npm install -g @devcontainers/cli
```

From the host shell at the repo root:

```bash
cd /path/to/FreedomCamp-Manager
devcontainer up --workspace-folder .
```

Then attach with VS Code or run validation commands inside the created container.

## Repo-specific notes

- `.devcontainer/devcontainer.json` is aligned to Node 22.
- `.nvmrc` pins the runtime to `22.22.3` for local/nested shells.
- `.devcontainer/postStart.sh` now loads nvm and runs `nvm use` automatically when `.nvmrc` exists.
- `package.json` now requires `node >=22 <23`.
- `package.json` also constrains npm to `>=10 <11` and declares `packageManager: npm@10.8.2`.
- If `RUNPOD_API_URL` is populated with a token-like value, the Bob scripts now ignore it and fall back to a valid configured service URL.
- If the host rebuild still fails, inspect host Docker permissions first; the nested-container bind-mount error seen in this session is not a repo config error.