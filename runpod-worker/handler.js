'use strict';

/**
 * RunPod Serverless Worker — FieldOps AI Engine
 *
 * RunPod injects two env vars for serverless workers:
 *   RUNPOD_WEBHOOK_GET_JOB       — GET this URL to dequeue a job
 *   RUNPOD_WEBHOOK_POST_OUTPUT   — POST {id, output} here to complete a job
 */

console.log('[worker] RunPod AI Worker starting');
console.log(`[worker] Node.js ${process.version}`);

const GET_JOB_URL   = process.env.RUNPOD_WEBHOOK_GET_JOB;
const POST_OUT_URL  = process.env.RUNPOD_WEBHOOK_POST_OUTPUT;
const POLL_MS       = 250;
const ERR_RETRY_MS  = 2000;

if (!GET_JOB_URL || !POST_OUT_URL) {
  console.error('[worker] Missing RUNPOD_WEBHOOK_GET_JOB or RUNPOD_WEBHOOK_POST_OUTPUT — are we running inside RunPod serverless?');
  process.exit(1);
}

console.log('[worker] GET_JOB_URL:', GET_JOB_URL);

// ─── Job handler ──────────────────────────────────────────────────────────────

async function handler(input) {
  if (input && input.action === 'ping') {
    return { success: true, message: 'AI Engine is online and ready!' };
  }
  return { success: false, error: `Unknown action: ${input && input.action}` };
}

// ─── RunPod polling loop ──────────────────────────────────────────────────────

async function takeJob() {
  const res = await fetch(GET_JOB_URL);
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`get_job HTTP ${res.status}`);
  return res.json();
}

async function completeJob(jobId, output) {
  const url = POST_OUT_URL.replace('${ID}', jobId);
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id: jobId, output }),
  });
  if (!res.ok) throw new Error(`job_done HTTP ${res.status}`);
}

async function workerLoop() {
  console.log('[worker] Polling for jobs...');
  while (true) {
    let job = null;
    try {
      job = await takeJob();
    } catch (err) {
      console.error('[worker] Failed to take job:', err.message);
      await sleep(ERR_RETRY_MS);
      continue;
    }

    if (!job) { await sleep(POLL_MS); continue; }

    console.log(`[worker] Processing job ${job.id}`);
    let output;
    try {
      output = await handler(job.input);
    } catch (err) {
      console.error(`[worker] Handler error for ${job.id}:`, err.message);
      output = { error: err.message };
    }

    try {
      await completeJob(job.id, output);
      console.log(`[worker] Completed job ${job.id}`);
    } catch (err) {
      console.error(`[worker] Failed to complete job ${job.id}:`, err.message);
      await sleep(ERR_RETRY_MS);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

process.on('uncaughtException',  err => { console.error('[worker] Uncaught:', err); process.exit(1); });
process.on('unhandledRejection', err => { console.error('[worker] Rejection:', err); process.exit(1); });

workerLoop().catch(err => { console.error('[worker] Fatal:', err); process.exit(1); });

