'use strict';

/**
 * RunPod Serverless Worker — FieldOps AI Engine
 *
 * Uses the official @runpod/serverless SDK which handles polling RunPod's
 * cloud job queue via injected webhook URLs (RUNPOD_WEBHOOK_GET_JOB,
 * RUNPOD_WEBHOOK_POST_OUTPUT). There is no local HTTP server at :8080.
 */

const runpod = require('@runpod/serverless');

console.log('[worker] RunPod AI Worker starting');
console.log(`[worker] Node.js ${process.version}`);

// ─── Job handler ──────────────────────────────────────────────────────────────

async function handler({ input }) {
  if (input && input.action === 'ping') {
    return { success: true, message: 'AI Engine is online and ready!' };
  }

  return { success: false, error: `Unknown action: ${input && input.action}` };
}

runpod.serverless.start({ handler });

