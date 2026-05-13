# Self-Healing Enterprise Runbook

## Scope

This runbook defines the enterprise runtime model for Bob self-healing monitoring and live-session diagnostics.

Primary entrypoints:
- `scripts/monitor-bob.sh`
- `scripts/bob-live-monitor-loop.sh`
- `scripts/self-heal-live-session-diagnostics.mjs`
- `scripts/lib/self-heal-runtime.mjs`

## Enterprise Controls Implemented

1. Singleton execution locks
- `monitor-bob.sh` uses `BOB_MONITOR_LOCK_DIR` lock directory.
- `bob-live-monitor-loop.sh` uses `BOB_LIVE_MONITOR_LOCK_DIR` lock directory.
- `self-heal-live-session-diagnostics.mjs` uses `LIVE_DIAG_LOCK_FILE` lock file.

2. Retry and timeout protection
- Diagnostics API fetches use bounded retries with exponential backoff and jitter.
- Request timeout is controlled with `LIVE_DIAG_HTTP_TIMEOUT_MS`.

3. Atomic and auditable output
- Summary file is written atomically:
  - `data/live-session-diagnostics-summary.json`
- Historical records are appended as JSONL:
  - `data/live-session-diagnostics-history.jsonl`
- Monitor heartbeat is persisted:
  - `data/monitor-heartbeat.json`

4. Structured incident metadata
- Monitor writes `monitor_version`, `unique_500_error_signatures`, thresholds, and window metrics into `system_state.json` and incident payloads.

5. Safe loop behavior
- Optional one-shot mode for scheduler compatibility:
  - `BOB_MONITOR_ONE_SHOT=true`
- Failure backoff with cap:
  - `BOB_MONITOR_MAX_BACKOFF_MINUTES`

## Environment Variables

### monitor-bob.sh
- `BOB_MONITOR_WINDOW_MINUTES` (default: `15`)
- `BOB_MONITOR_ERROR_THRESHOLD` (default: `5`)
- `BOB_MONITOR_ERROR_REGEX`
- `BOB_MONITOR_LOG_LINES` (default: `500`)
- `BOB_MONITOR_LOCK_DIR` (default: `tmp/locks/monitor-bob.lock`)
- `BOB_MONITOR_HEARTBEAT_FILE` (default: `data/monitor-heartbeat.json`)
- `BOB_ESCALATE_TO_DR_BOB` (default: `true`)

### bob-live-monitor-loop.sh
- `BOB_MONITOR_INTERVAL_MINUTES` (default: `5`)
- `BOB_SUMMARY_WINDOW_HOURS` (default: `24`)
- `BOB_MONITOR_ONE_SHOT` (default: `false`)
- `BOB_LIVE_MONITOR_LOCK_DIR` (default: `tmp/locks/bob-live-monitor-loop.lock`)
- `BOB_MONITOR_MAX_BACKOFF_MINUTES` (default: `15`)

### self-heal-live-session-diagnostics.mjs
- `LIVE_DIAG_WINDOW_MINUTES` (default: `20`)
- `LIVE_DIAG_LIMIT` (default: `180`)
- `LIVE_DIAG_MAX_UNHANDLED` (default: `2`)
- `LIVE_DIAG_MAX_ERRORS` (default: `8`)
- `LIVE_DIAG_HTTP_RETRIES` (default: `2`)
- `LIVE_DIAG_HTTP_TIMEOUT_MS` (default: `12000`)
- `LIVE_DIAG_LOCK_FILE` (default: `tmp/locks/live-session-self-heal.lock`)
- `LIVE_DIAG_WRITE_HISTORY` (default: `true`)
- `LIVE_DIAG_STRICT_MODE` (default: `false`)

## Recommended Production Mode

1. Run loop as one system service instance only.
2. Keep lock paths on local persistent disk.
3. Forward `data/monitor-heartbeat.json` and `system_state.json` into external monitoring.
4. Alert on:
- `system_state.monitor.status != healthy`
- non-empty `system_state.critical_warning`
- repeated `unavailable` status in diagnostics history.

## Smoke Test

```bash
node scripts/self-heal-live-session-diagnostics.mjs --strict false
bash scripts/monitor-bob.sh
BOB_MONITOR_ONE_SHOT=true bash scripts/bob-live-monitor-loop.sh
```

## Rollback

If needed, revert these files together so runtime behavior remains consistent:
- `scripts/lib/self-heal-runtime.mjs`
- `scripts/self-heal-live-session-diagnostics.mjs`
- `scripts/monitor-bob.sh`
- `scripts/bob-live-monitor-loop.sh`
