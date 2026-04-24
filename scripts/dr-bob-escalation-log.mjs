#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

export const DR_BOB_ESCALATION_QUEUE_PATH = path.join(
  workspaceRoot,
  'data',
  'dr-bob-escalation-queue.jsonl'
);

const DR_BOB_ESCALATION_LATEST_PATH = path.join(
  workspaceRoot,
  'data',
  'dr-bob-escalation-latest.json'
);

function preview(value, limit = 300) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  return text.slice(0, limit);
}

export async function recordDrBobEscalation(input = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    sourceFile: input.sourceFile || null,
    reviewArtifact: input.reviewArtifact || null,
    escalationArtifact: input.escalationArtifact || null,
    structured: input.structured === true,
    decision: input.decision || null,
    reason: input.reason || 'unknown',
    summary: input.summary || null,
    findingsCount: Number.isFinite(input.findingsCount) ? input.findingsCount : null,
    topFinding: input.topFinding || null,
    selfHealAttempted: input.selfHealAttempted === true,
    selfHealSuccess: input.selfHealSuccess === true,
    handoffRequired: input.handoffRequired !== false,
    copilotActionHint: input.copilotActionHint || 'manual-investigation-required',
    responsePreview: preview(input.responsePreview || ''),
  };

  await fs.mkdir(path.dirname(DR_BOB_ESCALATION_QUEUE_PATH), { recursive: true });
  await fs.appendFile(DR_BOB_ESCALATION_QUEUE_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  await fs.writeFile(DR_BOB_ESCALATION_LATEST_PATH, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  return entry;
}

async function main() {
  try {
    const raw = process.argv.slice(2).join(' ').trim();
    const payload = raw ? JSON.parse(raw) : {};
    const entry = await recordDrBobEscalation(payload);
    console.log(`Dr Bob escalation queued at ${entry.timestamp}`);
  } catch (error) {
    console.error(error?.message || String(error));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
