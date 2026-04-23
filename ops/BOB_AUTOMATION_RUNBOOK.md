# Bob Automation Runbook

This runbook installs the two unattended automation paths for Bob's autonomous learning loop:

1. GitHub Actions: `.github/workflows/ops-bob-autonomous-learning.yml`
2. VPS scheduler: `systemd` timer or `cron`

Both paths run the same command:

```bash
bash scripts/run-autonomous-learning-cycle.sh
```

That script performs these steps in order:

1. Refresh `system_state.json` with `scripts/system-check.sh`
2. Append runtime health warnings with `scripts/monitor-bob.sh`
3. Summarize response failures with `scripts/summarize-failures.mjs`
4. Rebuild `docs/BOB_BRAIN_DUMP.md` with `scripts/auto-ingest.mjs`
5. Optionally run `scripts/review-architecture-artifacts.mjs` when `BOB_REVIEW_ARTIFACTS=true`

## GitHub Actions Automation

Workflow file: `.github/workflows/ops-bob-autonomous-learning.yml`

Behavior:

- Runs hourly on a schedule.
- Runs on pushes to `main` that affect Bob training, ingest, or architecture context sources.
- Can be run manually via `workflow_dispatch`.
- Commits generated artifacts back to the repository when they change:
  - `system_state.json`
  - `data/bob-failure-summary.json`
  - `docs/BOB_FAILURE_SUMMARY.md`
  - `docs/BOB_BRAIN_DUMP.md`

## VPS Automation with systemd

Files:

- `ops/bob-autonomous-learning.service`
- `ops/bob-autonomous-learning.timer`

Install as the deployment user:

```bash
mkdir -p ~/.config/systemd/user
cp ops/bob-autonomous-learning.service ~/.config/systemd/user/
cp ops/bob-autonomous-learning.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bob-autonomous-learning.timer
systemctl --user list-timers bob-autonomous-learning.timer
```

If the repo is not cloned at `~/FreedomCamp-Manager`, edit `WorkingDirectory=` in `ops/bob-autonomous-learning.service` before copying it.

To include artifact review on the VPS, change this line in the service file:

```ini
Environment=BOB_REVIEW_ARTIFACTS=true
```

## VPS Automation with cron

Template file: `ops/bob-autonomous-learning.cron`

Install with:

```bash
crontab -l > /tmp/current-cron 2>/dev/null || true
cat /tmp/current-cron ops/bob-autonomous-learning.cron | crontab -
```

Before installing, replace `/path/to/FreedomCamp-Manager` with the real repo path.

## Verification

Run the cycle manually first:

```bash
bash scripts/run-autonomous-learning-cycle.sh
```

Confirm these files were refreshed:

- `system_state.json`
- `data/bob-failure-summary.json`
- `docs/BOB_FAILURE_SUMMARY.md`
- `docs/BOB_BRAIN_DUMP.md`

If `scripts/monitor-bob.sh` detects repeated 500 errors, `system_state.json` will also include a `critical_warning` field that Bob should treat as a runtime-health blocker.
