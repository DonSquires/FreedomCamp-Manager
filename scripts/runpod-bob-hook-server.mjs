#!/usr/bin/env node

import http from 'node:http';
import process from 'node:process';
import { spawn } from 'node:child_process';

function getArg(name, fallback = '') {
  const key = `--${name}`;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '');
    if (token === key) return String(args[i + 1] || fallback);
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1) || fallback;
  }
  return fallback;
}

function getBooleanArg(name, fallback = false) {
  const key = `--${name}`;
  const args = process.argv.slice(2);
  if (args.includes(key)) return true;
  const raw = String(getArg(name, String(fallback))).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload, null, 2));
}

async function runCommand(command, label) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, { shell: true, env: process.env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('exit', (code) => {
      resolve({
        label,
        command,
        code: code ?? 1,
        durationMs: Date.now() - startedAt,
        stdout: stdout.slice(0, 4000),
        stderr: stderr.slice(0, 4000),
      });
    });
  });
}

async function actionCommand(action) {
  const map = {
    'run-once': 'node scripts/runpod-bob-supervisor.mjs --once',
    'activity': 'node scripts/runpod-bob-activity-touch.mjs',
    'recover': String(process.env.BOB_RUNPOD_RECOVER_CMD || '').trim(),
    'scale-up': String(process.env.BOB_RUNPOD_SCALE_UP_CMD || '').trim(),
    'scale-down': String(process.env.BOB_RUNPOD_SCALE_DOWN_CMD || '').trim(),
  };

  const command = map[action] || '';
  if (!command) {
    return null;
  }

  return runCommand(command, action);
}

const token = String(process.env.BOB_AUTOMATION_WEBHOOK_TOKEN || '').trim();
const host = getBooleanArg('allow-remote', false)
  ? String(process.env.BOB_AUTOMATION_WEBHOOK_HOST || '0.0.0.0').trim()
  : String(process.env.BOB_AUTOMATION_WEBHOOK_HOST || '127.0.0.1').trim();
const port = Number(getArg('port', process.env.BOB_AUTOMATION_WEBHOOK_PORT || '8787'));

if (!token) {
  console.error('BOB_AUTOMATION_WEBHOOK_TOKEN is required');
  process.exit(1);
}

if (!Number.isFinite(port) || port < 1 || port > 65535) {
  console.error('Invalid port for hook server');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const auth = String(req.headers.authorization || '');
  if (auth !== `Bearer ${token}`) {
    return json(res, 401, { ok: false, error: 'unauthorized' });
  }

  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true, service: 'runpod-bob-hook-server' });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'method-not-allowed' });
  }

  const match = String(req.url || '').match(/^\/actions\/(run-once|activity|recover|scale-up|scale-down)$/);
  if (!match) {
    return json(res, 404, { ok: false, error: 'not-found' });
  }

  const action = match[1];
  const result = await actionCommand(action);
  if (!result) {
    return json(res, 400, {
      ok: false,
      error: 'action-not-configured',
      action,
      hint: 'Set the corresponding BOB_RUNPOD_* command env var for this action.',
    });
  }

  return json(res, result.code === 0 ? 200 : 500, {
    ok: result.code === 0,
    action,
    result,
  });
});

server.listen(port, host, () => {
  console.log(JSON.stringify({
    started: true,
    host,
    port,
    allowRemote: host !== '127.0.0.1',
    endpoints: ['/health', '/actions/run-once', '/actions/activity', '/actions/recover', '/actions/scale-up', '/actions/scale-down'],
  }, null, 2));
});