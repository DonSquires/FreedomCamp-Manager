'use strict';

/**
 * RunPod Serverless Worker — FieldOps AI Engine
 *
 * Implements the RunPod worker polling protocol natively (no external SDK
 * required). The RunPod runtime injects a local HTTP API that this process
 * polls for jobs.
 *
 * Local RunPod API (provided by the RunPod runtime inside the worker container):
 *   GET  http://$RUNPOD_AI_API_HOST:$RUNPOD_AI_API_PORT/v2/get_job
 *   POST http://$RUNPOD_AI_API_HOST:$RUNPOD_AI_API_PORT/v2/job_done
 */

const dns = require('node:dns');

try {
  dns.setDefaultResultOrder('ipv4first');
} catch (_) {
  // Ignore when runtime does not support this API.
}

const HOST = process.env.RUNPOD_AI_API_HOST || '127.0.0.1';
const PORT = process.env.RUNPOD_AI_API_PORT || '8080';
const BASE_URL = `http://${HOST}:${PORT}`;
const POLL_INTERVAL_MS = 250;
const ERROR_RETRY_MS = 1000;

console.log('[worker] RunPod AI Worker starting');
console.log(`[worker] Node.js ${process.version}`);
console.log(`[worker] RunPod local API: ${BASE_URL}`);

// ─── Job handler ──────────────────────────────────────────────────────────────
// Add new actions here as the YOLO / Ollama workloads are migrated.

async function handler(job) {
  const { input } = job;

  if (input && input.action === 'ping') {
    return { success: true, message: 'AI Engine is online and ready!' };
  }

  return { success: false, error: `Unknown action: ${input && input.action}` };
}

// ─── RunPod worker protocol ───────────────────────────────────────────────────

async function takeJob() {
  const res = await fetch(`${BASE_URL}/v2/get_job`);
  if (res.status === 204) return null; // no job available
  if (!res.ok) throw new Error(`get_job HTTP ${res.status}`);
  return res.json();
}

async function completeJob(jobId, output) {
  const res = await fetch(`${BASE_URL}/v2/job_done`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: jobId, output }),
  });
  if (!res.ok) throw new Error(`job_done HTTP ${res.status}`);
}

// ─── Main polling loop ────────────────────────────────────────────────────────

async function workerLoop() {
  console.log('[worker] Polling for jobs...');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let job = null;
    try {
      job = await takeJob();
    } catch (err) {
      console.error('[worker] Failed to take job:', err.message);
      await sleep(ERROR_RETRY_MS);
      continue;
    }

    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    console.log(`[worker] Processing job ${job.id}`);
    let output;
    try {
      output = await handler(job);
    } catch (err) {
      console.error(`[worker] Handler error for job ${job.id}:`, err.message);
      output = { error: err.message };
    }

    try {
      await completeJob(job.id, output);
      console.log(`[worker] Completed job ${job.id}`);
    } catch (err) {
      console.error(`[worker] Failed to complete job ${job.id}:`, err.message);
      await sleep(ERROR_RETRY_MS);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on('uncaughtException', (err) => {
  console.error('[worker] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[worker] Unhandled rejection:', reason);
  process.exit(1);
});

workerLoop().catch((err) => {
  console.error('[worker] Fatal worker loop error:', err);
  process.exit(1);
});

