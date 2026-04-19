#!/usr/bin/env node
// Quick script to consult Bob from CLI

import process from 'node:process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const INFERENCE_URL = String(process.env.INFERENCE_SERVICE_URL || process.env.BOB_SERVICE_URL || '').trim().replace(/\/+$/, '');
const API_KEY = String(process.env.INFERENCE_API_KEY || process.env.BOB_INFERENCE_API_KEY || '').trim();

if (!INFERENCE_URL || !API_KEY) {
  console.error('[Error] Missing required env vars: INFERENCE_SERVICE_URL (or BOB_SERVICE_URL) and INFERENCE_API_KEY (or BOB_INFERENCE_API_KEY).');
  process.exit(2);
}

async function askBob(question) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${INFERENCE_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-inference-api-key': API_KEY,
        Authorization: `Bearer ${API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({ message: question }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    try {
      const json = JSON.parse(text);
      return json.message || json.response || JSON.stringify(json);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timeout);
  }
}

const question = process.argv[2] || 'What is your operational status?';
console.log(`[Agent] Asking Bob: "${question}"\n`);

askBob(question)
  .then(answer => {
    console.log(`[Bob] ${answer}\n`);
    process.exit(0);
  })
  .catch(err => {
    console.error(`[Error] ${err.message}\n`);
    process.exit(1);
  });
