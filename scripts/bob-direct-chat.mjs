#!/usr/bin/env node
/**
 * Bob Direct Chat — Communicate with Bob on RunPod
 * Usage: node scripts/bob-direct-chat.mjs "Your question here"
 *        INFERENCE_SERVICE_URL=... INFERENCE_API_KEY=... node scripts/bob-direct-chat.mjs "Question"
 */

import readline from 'node:readline';

const fetchFn = globalThis.fetch;

if (typeof fetchFn !== 'function') {
  console.error('Global fetch is unavailable in this runtime. Use Node 18+ or Bun with fetch enabled.');
  process.exit(1);
}

const RAW_INFERENCE_URL =
  process.env.INFERENCE_SERVICE_URL ||
  process.env.BOB_SERVICE_URL ||
  'https://api.runpod.ai/v2/n0bp1ifmq01cx2';
const INFERENCE_API_KEY = process.env.INFERENCE_API_KEY || '';
const RUNPOD_TIMEOUT_MS = parseInt(process.env.BOB_RUNPOD_TIMEOUT_MS || '90000', 10);
const RUNPOD_STATUS_TIMEOUT_MS = parseInt(process.env.BOB_RUNPOD_STATUS_TIMEOUT_MS || '300000', 10);
const RUNPOD_STATUS_POLL_MS = parseInt(process.env.BOB_RUNPOD_STATUS_POLL_MS || '1500', 10);

function normalizeRunpodInvokeUrl(rawUrl) {
  const value = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (/\/runsync$/i.test(value)) return value;
  if (/\/run-sync$/i.test(value)) return value.replace(/\/run-sync$/i, '/runsync');
  if (/\/run$/i.test(value)) return value.replace(/\/run$/i, '/runsync');
  if (/\/v2\/[^/]+$/i.test(value)) return `${value}/runsync`;
  return value;
}

const RUNSYNC_URL = normalizeRunpodInvokeUrl(RAW_INFERENCE_URL);
const RUNPOD_BASE_URL = RUNSYNC_URL.replace(/\/(runsync|run-sync|run)$/i, '');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(level, msg) {
  const timestamp = new Date().toISOString();
  const prefix = {
    'info': `${colors.blue}[INFO]${colors.reset}`,
    'success': `${colors.green}[✓]${colors.reset}`,
    'warn': `${colors.yellow}[!]${colors.reset}`,
    'error': `${colors.red}[✗]${colors.reset}`,
  }[level] || '';
  console.log(`${prefix} ${timestamp} ${msg}`);
}

async function chatWithBob(message) {
  if (!INFERENCE_API_KEY) {
    log('error', 'INFERENCE_API_KEY environment variable not set');
    log('info', 'Set it via: export INFERENCE_API_KEY=rpa_...');
    process.exit(1);
  }

  log('info', `Sending message to Bob at ${RUNSYNC_URL}...`);
  log('info', `Message: "${message}"`);

  const payload = {
    input: {
      action: 'chat',
      message: message,
    },
  };

  const extractResponse = (result) => {
    const output = result?.output ?? result;
    if (typeof output === 'string' && output.trim()) return output;
    if (typeof output?.response === 'string' && output.response.trim()) return output.response;
    if (typeof output?.message === 'string' && output.message.trim()) return output.message;
    if (typeof output?.content === 'string' && output.content.trim()) return output.content;
    return '';
  };

  const printResponse = (result) => {
    log('info', `Status: ${result.status || 'COMPLETED'}`);
    const text = extractResponse(result);
    if (text) {
      log('success', 'Bob responded:');
      console.log(`\n${colors.cyan}${text}${colors.reset}\n`);
      return;
    }
    const output = result?.output ?? result;
    if (output) {
      log('info', 'Response output:');
      console.log(`\n${JSON.stringify(output, null, 2)}\n`);
    } else {
      log('info', 'Full response:');
      console.log(`\n${JSON.stringify(result, null, 2)}\n`);
    }
  };

  const runSyncCall = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUNPOD_TIMEOUT_MS);
    try {
      const response = await fetchFn(
        RUNSYNC_URL,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${INFERENCE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.substring(0, 300)}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  };

  const pollStatus = async (jobId) => {
    const deadline = Date.now() + RUNPOD_STATUS_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const res = await fetchFn(`${RUNPOD_BASE_URL}/status/${jobId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${INFERENCE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`RunPod status HTTP ${res.status}: ${text.substring(0, 300)}`);
      }

      const status = await res.json();
      const state = String(status?.status || '').toUpperCase();
      if (state === 'COMPLETED') return status;
      if (state === 'FAILED' || state === 'CANCELLED' || state === 'TIMED_OUT') {
        throw new Error(`RunPod job ${state}: ${JSON.stringify(status?.error || status?.output || '').substring(0, 300)}`);
      }

      await new Promise((resolve) => setTimeout(resolve, RUNPOD_STATUS_POLL_MS));
    }

    throw new Error(`RunPod status polling timed out after ${RUNPOD_STATUS_TIMEOUT_MS}ms`);
  };

  const runAsyncFallback = async () => {
    log('warn', 'runsync stalled; falling back to /run + /status polling');
    const res = await fetchFn(`${RUNPOD_BASE_URL}/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${INFERENCE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`RunPod run HTTP ${res.status}: ${text.substring(0, 300)}`);
    }

    const submitted = await res.json();
    const jobId = String(submitted?.id || '');
    if (!jobId) {
      throw new Error(`RunPod run did not return job id: ${JSON.stringify(submitted).substring(0, 300)}`);
    }

    log('info', `Queued job ${jobId}; polling status...`);
    return await pollStatus(jobId);
  };

  try {
    try {
      const result = await runSyncCall();
      printResponse(result);
      return result;
    } catch (runSyncErr) {
      const messageText = String(runSyncErr?.message || runSyncErr);
      const shouldFallback =
        runSyncErr?.name === 'AbortError' ||
        messageText.includes('AbortError') ||
        messageText.includes('timed out') ||
        messageText.includes('The operation was aborted') ||
        messageText.includes('fetch failed');

      if (!shouldFallback) throw runSyncErr;

      const fallbackResult = await runAsyncFallback();
      printResponse(fallbackResult);
      return fallbackResult;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      log('error', `Request timed out after ${RUNPOD_TIMEOUT_MS}ms`);
    } else {
      log('error', `Request failed: ${err.message}`);
    }
    process.exit(1);
  }
}

async function interactiveMode() {
  log('info', 'Entering interactive mode. Type your questions below (Ctrl+C to exit)');
  log('info', '');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => {
    rl.question(`${colors.green}You:${colors.reset} `, async (input) => {
      if (!input.trim()) {
        askQuestion();
        return;
      }

      await chatWithBob(input);
      askQuestion();
    });
  };

  askQuestion();
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Interactive mode
    await interactiveMode();
  } else {
    // Single message mode
    const message = args.join(' ');
    await chatWithBob(message);
  }
}

main().catch((err) => {
  log('error', `Unexpected error: ${err.message}`);
  process.exit(1);
});
