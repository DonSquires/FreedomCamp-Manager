#!/usr/bin/env node
/**
 * Bob Direct Chat — Communicate with Bob on RunPod
 * Usage: node scripts/bob-direct-chat.mjs "Your question here"
 *        INFERENCE_SERVICE_URL=... INFERENCE_API_KEY=... node scripts/bob-direct-chat.mjs "Question"
 */

import fetch from 'node:fetch';
import readline from 'node:readline';

const INFERENCE_SERVICE_URL = process.env.INFERENCE_SERVICE_URL || 
  'https://api.runpod.ai/v2/n0bp1ifmq01cx2';
const INFERENCE_API_KEY = process.env.INFERENCE_API_KEY || '';
const RUNPOD_TIMEOUT_MS = parseInt(process.env.BOB_RUNPOD_TIMEOUT_MS || '90000', 10);

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

  log('info', `Sending message to Bob at ${INFERENCE_SERVICE_URL}/runsync...`);
  log('info', `Message: "${message}"`);

  const payload = {
    input: {
      action: 'chat',
      message: message,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUNPOD_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${INFERENCE_SERVICE_URL}/runsync`,
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

    clearTimeout(timeout);

    if (!response.ok) {
      log('error', `HTTP ${response.status}: ${response.statusText}`);
      const text = await response.text();
      log('error', `Response: ${text.substring(0, 200)}`);
      process.exit(1);
    }

    const result = await response.json();

    log('info', `Status: ${result.status}`);

    if (result.status === 'COMPLETED' && result.output) {
      log('success', 'Bob responded:');
      console.log(`\n${colors.cyan}${result.output}${colors.reset}\n`);
    } else if (result.output) {
      log('info', 'Response output:');
      console.log(`\n${JSON.stringify(result.output, null, 2)}\n`);
    } else {
      log('info', 'Full response:');
      console.log(`\n${JSON.stringify(result, null, 2)}\n`);
    }

    return result;
  } catch (err) {
    clearTimeout(timeout);
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
