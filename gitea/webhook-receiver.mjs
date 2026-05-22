#!/usr/bin/env node

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.GITEA_WEBHOOK_PORT || 4545);
const host = process.env.GITEA_WEBHOOK_HOST || '127.0.0.1';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.GITEA_REPO_ROOT || path.resolve(scriptDir, '..');
const sharedSecret = process.env.GITEA_WEBHOOK_SECRET || '';
const requireSharedSecret = process.env.GITEA_REQUIRE_SECRET !== 'false' && process.env.NODE_ENV !== 'development';
const allowedBranch = process.env.GITEA_ALLOWED_BRANCH || 'main';
const testCommand = process.env.GITEA_TEST_COMMAND || 'npm run build && npx ts-node --esm scripts/sync-training.ts';
const maxBodyBytes = Number(process.env.GITEA_MAX_BODY_BYTES || 1048576);

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage: node gitea/webhook-receiver.mjs

Environment:
  GITEA_WEBHOOK_PORT       Port to listen on (default: 4545)
  GITEA_WEBHOOK_HOST       Host to bind to (default: 0.0.0.0)
  GITEA_REPO_ROOT          Repository root to run tests from (default: parent of this script)
  GITEA_WEBHOOK_SECRET     Optional shared secret expected in a Gitea header
  GITEA_ALLOWED_BRANCH     Branch or refs/heads/* value allowed to trigger tests (default: main)
  GITEA_TEST_COMMAND       Command to run on push events (default: npm run build && npx ts-node --esm scripts/sync-training.ts)
  GITEA_MAX_BODY_BYTES     Request body limit in bytes (default: 1048576)

Webhook endpoints:
  GET  /health
  POST /webhook
`);
  process.exit(0);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function isAllowedBranch(ref) {
  if (!ref || typeof ref !== 'string') {
    return false;
  }

  if (ref === allowedBranch) {
    return true;
  }

  return ref === `refs/heads/${allowedBranch}`;
}

function getProvidedSecret(headers) {
  return String(
    headers['x-gitea-token'] ||
      headers['x-gitea-signature'] ||
      headers['x-webhook-secret'] ||
      headers['x-hub-signature-256'] ||
      '',
  );
}

function hasValidSecret(req) {
  if (!sharedSecret) {
    return !requireSharedSecret;
  }

  if (!requireSharedSecret) {
    return true;
  }

  const providedSecret = getProvidedSecret(req.headers);
  return providedSecret.length > 0 && providedSecret === sharedSecret;
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: repoRoot,
      shell: true,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve({ code, signal });
        return;
      }

      reject(new Error(`Command failed with code ${code ?? 'unknown'}${signal ? ` signal ${signal}` : ''}`));
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      if (!rawBody) {
        resolve({ rawBody, json: null });
        return;
      }

      try {
        resolve({ rawBody, json: JSON.parse(rawBody) });
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, service: 'gitea-webhook-receiver' });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/webhook') {
    sendJson(res, 404, { ok: false, error: 'not_found' });
    return;
  }

  if (!hasValidSecret(req)) {
    sendJson(res, 401, { ok: false, error: 'invalid_secret' });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: 'invalid_body', message: error instanceof Error ? error.message : 'Invalid JSON body' });
    return;
  }

  const eventName = String(req.headers['x-gitea-event'] || req.headers['x-git-event'] || 'unknown');
  const payload = body.json || {};
  const ref = String(payload.ref || '');

  if (eventName.toLowerCase() !== 'push') {
    sendJson(res, 202, { ok: true, skipped: true, reason: 'unsupported_event', eventName });
    return;
  }

  if (!isAllowedBranch(ref)) {
    sendJson(res, 202, { ok: true, skipped: true, reason: 'branch_not_allowed', ref, allowedBranch });
    return;
  }

  try {
    await runCommand(testCommand);
    sendJson(res, 200, {
      ok: true,
      triggered: true,
      eventName,
      ref,
      allowedBranch,
      command: testCommand,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      triggered: true,
      eventName,
      ref,
      allowedBranch,
      command: testCommand,
      error: error instanceof Error ? error.message : 'Webhook command failed',
    });
  }
});

server.listen(port, host, () => {
  console.log(`Gitea webhook receiver listening on http://${host}:${port}`);
  console.log(`Repo root: ${repoRoot}`);
  console.log(`Allowed branch: ${allowedBranch}`);
  console.log(`Shared secret required: ${requireSharedSecret}`);
  console.log(`Test command: ${testCommand}`);
});