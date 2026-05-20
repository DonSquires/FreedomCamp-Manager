#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const DEFAULT_ACTIVITY_FILE = '.runtime/runpod-bob-activity.touch';
const DEFAULT_IDLE_MINUTES = 30;
const DEFAULT_MAX_WAIT_MINUTES = 360;
const DEFAULT_POLL_SECONDS = 60;
const DEFAULT_REQUIRE_ACTIVITY_SINCE_START = true;
const DEFAULT_COMMAND =
  'bash scripts/playwright-bob-runtime.sh npx playwright test tests/e2e/phase3-sentient-xo.spec.ts tests/e2e/phase4-admirals-bridge.spec.ts --project=chromium --workers=1 --reporter=line';

function getArg(name, fallback = '') {
  const key = `--${name}`;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || '');
    if (token === key) return String(args[index + 1] || fallback);
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1) || fallback;
  }
  return fallback;
}

function getNumberArg(name, fallback) {
  const value = Number(getArg(name, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getBooleanArg(name, fallback) {
  const raw = String(getArg(name, fallback ? '1' : '0')).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false;
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function readActivityAgeMs(activityFile) {
  try {
    const stat = fs.statSync(activityFile);
    return Date.now() - stat.mtimeMs;
  } catch {
    return null;
  }
}

function runCommand(command) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      stdio: 'inherit',
      shell: true,
      env: process.env,
      cwd: process.cwd(),
    });

    child.on('close', (code) => {
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}

function writeRunRecord(status, details) {
  const outputDir = path.resolve(process.cwd(), 'tools/retest-schedules');
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFile = path.join(outputDir, `bob-idle-retest-${stamp}.json`);
  fs.writeFileSync(
    outputFile,
    `${JSON.stringify({
      status,
      ...details,
      writtenAt: nowIso(),
    }, null, 2)}\n`
  );
  return outputFile;
}

async function main() {
  const activityFile = path.resolve(
    process.cwd(),
    String(getArg('activity-file', process.env.BOB_SUPERVISOR_ACTIVITY_FILE || DEFAULT_ACTIVITY_FILE)).trim() || DEFAULT_ACTIVITY_FILE,
  );
  const idleMinutes = getNumberArg('idle-minutes', DEFAULT_IDLE_MINUTES);
  const maxWaitMinutes = getNumberArg('max-wait-minutes', DEFAULT_MAX_WAIT_MINUTES);
  const pollSeconds = getNumberArg('poll-seconds', DEFAULT_POLL_SECONDS);
  const command = String(getArg('command', DEFAULT_COMMAND)).trim() || DEFAULT_COMMAND;
  const requireActivitySinceStart = getBooleanArg('require-activity-since-start', DEFAULT_REQUIRE_ACTIVITY_SINCE_START);

  const idleMs = idleMinutes * 60 * 1000;
  const maxWaitMs = maxWaitMinutes * 60 * 1000;
  const pollMs = pollSeconds * 1000;

  const startedAt = Date.now();

  console.log(`[${nowIso()}] Bob idle retest scheduler armed.`);
  console.log(`[${nowIso()}] activityFile=${activityFile}`);
  console.log(`[${nowIso()}] idleMinutes=${idleMinutes}, maxWaitMinutes=${maxWaitMinutes}, pollSeconds=${pollSeconds}`);
  console.log(`[${nowIso()}] requireActivitySinceStart=${requireActivitySinceStart}`);
  console.log(`[${nowIso()}] command=${command}`);

  let observedFreshActivity = !requireActivitySinceStart;

  while (Date.now() - startedAt < maxWaitMs) {
    const ageMs = readActivityAgeMs(activityFile);
    if (ageMs === null) {
      console.log(`[${nowIso()}] Activity file not found; assuming idle and running retest now.`);
      const exitCode = await runCommand(command);
      const record = writeRunRecord(exitCode === 0 ? 'completed' : 'failed', {
        reason: 'activity-file-missing',
        activityFile,
        command,
        exitCode,
      });
      console.log(`[${nowIso()}] Retest finished with code ${exitCode}. record=${record}`);
      process.exit(exitCode);
    }

    const lastActivityMs = Date.now() - ageMs;
    if (!observedFreshActivity && lastActivityMs >= startedAt) {
      observedFreshActivity = true;
      console.log(`[${nowIso()}] Observed fresh Bob activity for this scheduling session.`);
    }

    if (!observedFreshActivity) {
      console.log(`[${nowIso()}] Waiting for first fresh Bob activity before idle countdown.`);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      continue;
    }

    if (ageMs >= idleMs) {
      console.log(`[${nowIso()}] Bob idle threshold reached (ageMs=${Math.round(ageMs)}). Running retest.`);
      const exitCode = await runCommand(command);
      const record = writeRunRecord(exitCode === 0 ? 'completed' : 'failed', {
        reason: 'idle-threshold-reached',
        activityFile,
        ageMs: Math.round(ageMs),
        requireActivitySinceStart,
        command,
        exitCode,
      });
      console.log(`[${nowIso()}] Retest finished with code ${exitCode}. record=${record}`);
      process.exit(exitCode);
    }

    const ageMinutes = (ageMs / 60000).toFixed(1);
    console.log(`[${nowIso()}] Bob still active (ageMinutes=${ageMinutes}). Waiting ${pollSeconds}s.`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const record = writeRunRecord('timed-out', {
    reason: 'max-wait-exceeded',
    activityFile,
    idleMinutes,
    maxWaitMinutes,
    requireActivitySinceStart,
    command,
  });
  console.error(`[${nowIso()}] Timed out waiting for Bob idle window. record=${record}`);
  process.exit(2);
}

main().catch((error) => {
  console.error(`[${nowIso()}] Scheduler failed:`, error);
  process.exit(1);
});