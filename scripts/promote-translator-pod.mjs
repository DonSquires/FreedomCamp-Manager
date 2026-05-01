#!/usr/bin/env node

import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const execFileAsync = promisify(execFile);

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

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

async function main() {
  const runId = firstNonEmpty(getArg('runId', ''), process.env.TRANSLATOR_BUILD_RUN_ID);
  const templateId = firstNonEmpty(getArg('templateId', ''), process.env.RUNPOD_TRANSLATOR_TEMPLATE_ID, process.env.TRANSLATOR_TEMPLATE_ID);
  const runpodApiKey = firstNonEmpty(process.env.RUNPOD_API_KEY, process.env.RUNPOD_ENDPOINT_API_KEY);

  if (!runId) {
    throw new Error('runId is required. Pass --runId=<github-actions-run-id>.');
  }
  if (!templateId) {
    throw new Error('RUNPOD_TRANSLATOR_TEMPLATE_ID or --templateId is required.');
  }
  if (!runpodApiKey) {
    throw new Error('RUNPOD_API_KEY or RUNPOD_ENDPOINT_API_KEY is required.');
  }

  const { stdout } = await execFileAsync('gh', [
    'run', 'view', runId, '--log',
  ], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024 * 8,
  });

  const digestMatch = stdout.match(/ghcr\.io\/donsquires\/freedomcamp-manager-translator@sha256:[a-f0-9]{64}/i);
  if (!digestMatch) {
    throw new Error('Could not find translator image digest in GitHub Actions logs.');
  }

  const imageRef = digestMatch[0];
  console.log(`Promoting translator image: ${imageRef}`);

  const response = await fetch(`https://rest.runpod.io/v1/templates/${templateId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${runpodApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imageName: imageRef }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`RunPod translator template update failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`);
  }

  console.log(`Translator template updated: ${payload.imageName || imageRef}`);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
