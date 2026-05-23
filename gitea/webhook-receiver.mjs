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
const playwrightCommand =
  process.env.GITEA_PLAYWRIGHT_COMMAND || 'MOCK_MODE=true npx playwright test --config playwright.config.ts';
const aiPatchBranchPrefix = process.env.GITEA_AI_PATCH_BRANCH_PREFIX || 'patch/ai-self-heal-';
const backendManagerUrl = process.env.BACKEND_MANAGER_URL || 'http://127.0.0.1:3000';
const backendPlaywrightResultPath =
  process.env.BACKEND_PLAYWRIGHT_RESULT_PATH || '/api/automation/playwright-result';
const backendAutomationToken = String(process.env.AUTOMATION_WEBHOOK_TOKEN || process.env.GITEA_WEBHOOK_SECRET || '').trim();
const maxCommandOutputChars = Number(process.env.GITEA_MAX_COMMAND_OUTPUT_CHARS || 120000);
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
  GITEA_PLAYWRIGHT_COMMAND Command run for patch/ai-self-heal-* branches (default: MOCK_MODE=true npx playwright test --config playwright.config.ts)
  GITEA_AI_PATCH_BRANCH_PREFIX  Prefix for automated self-heal branches (default: patch/ai-self-heal-)
  BACKEND_MANAGER_URL      Backend manager base URL for result forwarding (default: http://127.0.0.1:3000)
  BACKEND_PLAYWRIGHT_RESULT_PATH Backend path for result forwarding (default: /api/automation/playwright-result)
  AUTOMATION_WEBHOOK_TOKEN Optional shared token sent as x-automation-token to backend manager
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

function normalizeBranch(ref) {
  if (!ref || typeof ref !== 'string') {
    return '';
  }

  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}

function isAiSelfHealBranch(ref) {
  const branch = normalizeBranch(ref);
  return branch.startsWith(aiPatchBranchPrefix);
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

function truncateOutput(value) {
  const normalized = String(value || '');
  if (normalized.length <= maxCommandOutputChars) {
    return normalized;
  }

  return normalized.slice(-maxCommandOutputChars);
}

function runCommand(command, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: repoRoot,
      shell: true,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve({ code, signal, output: '' });
        return;
      }

      reject(new Error(`Command failed with code ${code ?? 'unknown'}${signal ? ` signal ${signal}` : ''}`));
    });
  });
}

function runCommandWithCapturedOutput(command, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: repoRoot,
      shell: true,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      const output = truncateOutput([stdout, stderr].filter(Boolean).join('\n').trim());
      if (code === 0) {
        resolve({ code, signal, output });
        return;
      }

      reject(
        new Error(
          `Command failed with code ${code ?? 'unknown'}${signal ? ` signal ${signal}` : ''}\n${output}`.trim(),
        ),
      );
    });
  });
}

function resolveBackendResultUrl() {
  const normalizedBase = backendManagerUrl.endsWith('/') ? backendManagerUrl.slice(0, -1) : backendManagerUrl;
  const normalizedPath = backendPlaywrightResultPath.startsWith('/')
    ? backendPlaywrightResultPath
    : `/${backendPlaywrightResultPath}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function sendPlaywrightResult(payload) {
  const headers = {
    'content-type': 'application/json',
  };

  if (backendAutomationToken) {
    headers['x-automation-token'] = backendAutomationToken;
  }

  const response = await fetch(resolveBackendResultUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend manager rejected Playwright payload (${response.status}): ${text}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : { ok: true };
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
  const branch = normalizeBranch(ref);
  const repositoryName = String(payload.repository?.full_name || payload.repository?.name || 'unknown');
  const afterCommit = String(payload.after || '');

  if (eventName.toLowerCase() !== 'push') {
    sendJson(res, 202, { ok: true, skipped: true, reason: 'unsupported_event', eventName });
    return;
  }

  if (isAiSelfHealBranch(ref)) {
    try {
      const result = await runCommandWithCapturedOutput(playwrightCommand, { MOCK_MODE: 'true' });
      const managerResponse = await sendPlaywrightResult({
        status: 'PASSED',
        verificationTag: 'Playwright Browser Verification: PASSED',
        eventName,
        ref,
        branch,
        repository: repositoryName,
        commitSha: afterCommit,
        command: playwrightCommand,
        output: result.output,
        capturedAt: new Date().toISOString(),
      });

      sendJson(res, 200, {
        ok: true,
        triggered: true,
        gate: 'playwright',
        eventName,
        ref,
        branch,
        command: playwrightCommand,
        managerResponse,
      });
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      try {
        await sendPlaywrightResult({
          status: 'FAILED',
          verificationTag: 'Playwright Browser Verification: FAILED',
          managerStatus: 'ORCHESTRATOR_CRASHED',
          eventName,
          ref,
          branch,
          repository: repositoryName,
          commitSha: afterCommit,
          command: playwrightCommand,
          output: truncateOutput(errorMessage),
          capturedAt: new Date().toISOString(),
        });
      } catch (reportError) {
        console.error('[webhook-receiver] Failed to report Playwright failure to backend manager', reportError);
      }

      sendJson(res, 500, {
        ok: false,
        triggered: true,
        gate: 'playwright',
        eventName,
        ref,
        branch,
        command: playwrightCommand,
        error: errorMessage,
      });
      return;
    }
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
  console.log(`AI patch branch prefix: ${aiPatchBranchPrefix}`);
  console.log(`Shared secret required: ${requireSharedSecret}`);
  console.log(`Test command: ${testCommand}`);
  console.log(`Playwright command: ${playwrightCommand}`);
});