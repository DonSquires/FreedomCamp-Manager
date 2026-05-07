#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const REST_BASE = 'https://rest.runpod.io/v1';
const RUNPOD_BASE = 'https://api.runpod.ai/v2';

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
  const args = process.argv.slice(2);
  if (args.includes(`--${name}`)) return true;
  const raw = String(getArg(name, String(fallback))).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function getNumberArg(name, fallback) {
  const raw = String(getArg(name, String(fallback))).trim();
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function log(message) {
  console.log(`[recovery-agent ${new Date().toISOString()}] ${message}`);
}

async function withTimeout(task, timeoutMs, label) {
  let timer = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseEndpointSpecs() {
  const fromArg = String(getArg('endpoints', '')).trim();
  const fromEnv = String(process.env.RUNPOD_RECOVERY_ENDPOINTS || '').trim();
  // STT endpoint removed — STT is now served by Railway (railway-stt/).
  // Only the AI inference endpoint is managed here.
  const raw = fromArg || fromEnv || 'n0bp1ifmq01cx2:ai';

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [idRaw, kindRaw] = entry.split(':');
      const id = String(idRaw || '').trim();
      const kind = String(kindRaw || 'ai').trim().toLowerCase();
      return {
        id,
        kind: kind === 'stt' ? 'stt' : 'ai',
      };
    })
    .filter((item) => item.id);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {
      endpoints: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

function saveState(filePath, state) {
  state.updatedAt = Date.now();
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function rest(method, pathName, apiKey, body, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${REST_BASE}/${pathName}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (!response.ok) {
      throw new Error(`REST ${method} ${pathName} failed (${response.status}): ${JSON.stringify(json).slice(0, 500)}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function runpodPost(url, apiKey, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: response.ok, status: response.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function patchWorkers(endpointId, apiKey, workersMin, workersMax) {
  return rest('PATCH', `endpoints/${endpointId}`, apiKey, { workersMin, workersMax });
}

function probePayload(kind) {
  if (kind === 'stt') {
    return {
      input: {
        audio_b64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
      },
    };
  }

  return {
    input: {
      action: 'ping',
      message: 'health probe',
    },
  };
}

async function submitProbe(endpointId, kind, apiKey, submitTimeoutMs) {
  const body = probePayload(kind);
  const response = await runpodPost(`${RUNPOD_BASE}/${endpointId}/run`, apiKey, body, submitTimeoutMs);
  if (!response.ok) {
    return {
      ok: false,
      reason: `submit-failed-${response.status}`,
      payload: response.json || response.text,
      jobId: '',
    };
  }

  const jobId = String(response?.json?.id || '').trim();
  if (!jobId) {
    return {
      ok: false,
      reason: 'missing-job-id',
      payload: response.json || response.text,
      jobId: '',
    };
  }

  return {
    ok: true,
    reason: 'submitted',
    payload: response.json,
    jobId,
  };
}

async function pollProbe(endpointId, jobId, apiKey, pollIntervalMs, maxPollMs) {
  const started = Date.now();
  const statusUrl = `${RUNPOD_BASE}/${endpointId}/status/${encodeURIComponent(jobId)}`;

  while (Date.now() - started < maxPollMs) {
    const response = await fetch(statusUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    const status = String(json?.status || '').toUpperCase();
    if (status === 'COMPLETED') {
      return { ok: true, status, json };
    }
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
      return { ok: false, status, json };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { ok: false, status: 'POLL_TIMEOUT', json: null };
}

async function cancelJob(endpointId, jobId, apiKey) {
  if (!jobId) return;
  try {
    await runpodPost(`${RUNPOD_BASE}/${endpointId}/cancel/${encodeURIComponent(jobId)}`, apiKey, {}, 15000);
  } catch {
    // best effort
  }
}

async function probeEndpoint(spec, apiKey, config, state) {
  const entry = state.endpoints[spec.id] || {
    kind: spec.kind,
    approved: false,
    consecutiveProbeFailures: 0,
    consecutiveRuntimeFailures: 0,
    lastProbeAt: 0,
    lastHealthyAt: 0,
    lastApprovedAt: 0,
    lastJobId: '',
  };

  const now = Date.now();
  if (now - Number(entry.lastProbeAt || 0) < config.probeEveryMs) {
    state.endpoints[spec.id] = entry;
    return;
  }

  log(`endpoint=${spec.id} mode=probe starting`);

  await patchWorkers(spec.id, apiKey, 0, config.activeWorkersMax);
  entry.lastProbeAt = now;

  const submitted = await submitProbe(spec.id, spec.kind, apiKey, config.submitTimeoutMs);
  if (!submitted.ok) {
    entry.consecutiveProbeFailures += 1;
    entry.approved = false;
    await patchWorkers(spec.id, apiKey, 0, 0);
    log(`endpoint=${spec.id} mode=probe submit-failed reason=${submitted.reason}`);
    state.endpoints[spec.id] = entry;
    return;
  }

  entry.lastJobId = submitted.jobId;
  const polled = await pollProbe(spec.id, submitted.jobId, apiKey, config.pollIntervalMs, config.pollTimeoutMs);

  if (polled.ok) {
    entry.lastHealthyAt = Date.now();
    entry.consecutiveProbeFailures = 0;
    if (config.autoApprove) {
      entry.approved = true;
      entry.lastApprovedAt = Date.now();
      await patchWorkers(spec.id, apiKey, 0, config.approvedWorkersMax);
      log(`endpoint=${spec.id} mode=probe success=COMPLETED action=approved workersMax=${config.approvedWorkersMax}`);
    } else {
      entry.approved = false;
      await patchWorkers(spec.id, apiKey, 0, 0);
      log(`endpoint=${spec.id} mode=probe success=COMPLETED action=return-idle`);
    }
    state.endpoints[spec.id] = entry;
    return;
  }

  entry.consecutiveProbeFailures += 1;
  entry.approved = false;
  await cancelJob(spec.id, submitted.jobId, apiKey);
  await patchWorkers(spec.id, apiKey, 0, 0);
  log(`endpoint=${spec.id} mode=probe failed status=${polled.status} action=rollback-idle`);
  state.endpoints[spec.id] = entry;
}

async function monitorApprovedEndpoint(spec, apiKey, config, state) {
  const entry = state.endpoints[spec.id];
  if (!entry || !entry.approved) return;

  const submitted = await submitProbe(spec.id, spec.kind, apiKey, config.submitTimeoutMs);
  if (!submitted.ok) {
    entry.consecutiveRuntimeFailures += 1;
    log(`endpoint=${spec.id} mode=approved submit-failed count=${entry.consecutiveRuntimeFailures}`);
  } else {
    entry.lastJobId = submitted.jobId;
    const polled = await pollProbe(spec.id, submitted.jobId, apiKey, config.pollIntervalMs, config.pollTimeoutMs);
    if (polled.ok) {
      entry.consecutiveRuntimeFailures = 0;
      entry.lastHealthyAt = Date.now();
      log(`endpoint=${spec.id} mode=approved health=ok`);
    } else {
      entry.consecutiveRuntimeFailures += 1;
      await cancelJob(spec.id, submitted.jobId, apiKey);
      log(`endpoint=${spec.id} mode=approved health-failed status=${polled.status} count=${entry.consecutiveRuntimeFailures}`);
    }
  }

  if (entry.consecutiveRuntimeFailures >= config.rollbackFailures) {
    entry.approved = false;
    entry.consecutiveRuntimeFailures = 0;
    await patchWorkers(spec.id, apiKey, 0, 0);
    log(`endpoint=${spec.id} mode=approved action=rollback-idle reason=runtime-failures`);
  }

  state.endpoints[spec.id] = entry;
}

async function main() {
  const apiKey = String(
    process.env.RUNPOD_API_KEY || process.env.INFERENCE_API_KEY || process.env.RUNPOD_ENDPOINT_API_KEY || ''
  ).trim();
  if (!apiKey) {
    throw new Error('Missing RUNPOD_API_KEY / INFERENCE_API_KEY / RUNPOD_ENDPOINT_API_KEY');
  }

  const endpointSpecs = parseEndpointSpecs();
  if (endpointSpecs.length === 0) {
    throw new Error('No endpoint IDs provided. Use --endpoints or RUNPOD_RECOVERY_ENDPOINTS');
  }

  const once = getBooleanArg('once', false);
  const intervalMs = getNumberArg('intervalMs', Number(process.env.RUNPOD_RECOVERY_INTERVAL_MS || 120000));
  const stateFile = path.resolve(
    process.cwd(),
    String(getArg('stateFile', process.env.RUNPOD_RECOVERY_STATE_FILE || '.runtime/runpod-recovery-agent-state.json'))
  );

  const config = {
    autoApprove: getBooleanArg('autoApprove', String(process.env.RUNPOD_RECOVERY_AUTO_APPROVE || 'true') === 'true'),
    probeEveryMs: getNumberArg('probeEveryMs', Number(process.env.RUNPOD_RECOVERY_PROBE_EVERY_MS || 300000)),
    pollIntervalMs: getNumberArg('pollIntervalMs', Number(process.env.RUNPOD_RECOVERY_POLL_INTERVAL_MS || 5000)),
    pollTimeoutMs: getNumberArg('pollTimeoutMs', Number(process.env.RUNPOD_RECOVERY_POLL_TIMEOUT_MS || 90000)),
    submitTimeoutMs: getNumberArg('submitTimeoutMs', Number(process.env.RUNPOD_RECOVERY_SUBMIT_TIMEOUT_MS || 30000)),
    rollbackFailures: getNumberArg('rollbackFailures', Number(process.env.RUNPOD_RECOVERY_ROLLBACK_FAILURES || 2)),
    activeWorkersMax: getNumberArg('activeWorkersMax', Number(process.env.RUNPOD_RECOVERY_ACTIVE_WORKERS_MAX || 1)),
    approvedWorkersMax: getNumberArg('approvedWorkersMax', Number(process.env.RUNPOD_RECOVERY_APPROVED_WORKERS_MAX || 1)),
  };

  log(
    `start endpoints=${endpointSpecs.map((e) => `${e.id}:${e.kind}`).join(',')} once=${once} ` +
    `autoApprove=${config.autoApprove} intervalMs=${intervalMs}`
  );

  const runCycle = async () => {
    const state = loadState(stateFile);

    for (const spec of endpointSpecs) {
      if (!state.endpoints[spec.id]) {
        state.endpoints[spec.id] = {
          kind: spec.kind,
          approved: false,
          consecutiveProbeFailures: 0,
          consecutiveRuntimeFailures: 0,
          lastProbeAt: 0,
          lastHealthyAt: 0,
          lastApprovedAt: 0,
          lastJobId: '',
        };
      }

      try {
        await withTimeout(
          monitorApprovedEndpoint(spec, apiKey, config, state),
          90000,
          `monitorApprovedEndpoint(${spec.id})`
        );
      } catch (error) {
        log(`endpoint=${spec.id} monitor-error=${error?.message || String(error)}`);
      }

      try {
        await withTimeout(
          probeEndpoint(spec, apiKey, config, state),
          120000,
          `probeEndpoint(${spec.id})`
        );
      } catch (error) {
        log(`endpoint=${spec.id} probe-error=${error?.message || String(error)} action=force-idle`);
        try {
          await patchWorkers(spec.id, apiKey, 0, 0);
        } catch (patchError) {
          log(`endpoint=${spec.id} force-idle-error=${patchError?.message || String(patchError)}`);
        }
      }
    }

    saveState(stateFile, state);
  };

  await runCycle();
  if (once) return;

  setInterval(() => {
    runCycle().catch((error) => {
      log(`cycle-error=${error?.message || String(error)}`);
    });
  }, intervalMs);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
