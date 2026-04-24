#!/usr/bin/env node
/**
 * dr-bob-escalation-read.mjs
 *
 * Reads the Dr Bob escalation queue (data/dr-bob-escalation-queue.jsonl)
 * and outputs a human-readable triage summary.
 *
 * Usage:
 *   node scripts/dr-bob-escalation-read.mjs
 *   node scripts/dr-bob-escalation-read.mjs --open-only
 *   node scripts/dr-bob-escalation-read.mjs --limit 10
 *   node scripts/dr-bob-escalation-read.mjs --json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_PATH = path.resolve(__dirname, '..', 'data', 'dr-bob-escalation-queue.jsonl');

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    openOnly: args.includes('--open-only'),
    json: args.includes('--json'),
    limit: (() => {
      const i = args.indexOf('--limit');
      return i !== -1 && args[i + 1] ? parseInt(args[i + 1], 10) : null;
    })(),
  };
}

function pad(str, len) {
  return String(str ?? '').slice(0, len).padEnd(len);
}

function renderEntry(entry, index) {
  const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }) : 'unknown';
  const status = entry.selfHealSuccess ? '✅ self-healed' :
                 entry.selfHealAttempted ? '⚠️  heal-failed' :
                 entry.handoffRequired ? '🔴 needs-human' : '🟡 unresolved';
  const lines = [
    `─── Entry #${index + 1} ─────────────────────────────────────────────────────`,
    `  Time      : ${ts}`,
    `  Status    : ${status}`,
    `  Decision  : ${entry.decision ?? 'n/a'}`,
    `  Hint      : ${entry.copilotActionHint ?? 'none'}`,
    `  Source    : ${entry.sourceFile ?? 'n/a'}`,
    `  Findings  : ${entry.findingsCount ?? 'n/a'}`,
    `  Top Issue : ${entry.topFinding ?? 'n/a'}`,
  ];
  if (entry.summary) {
    lines.push(`  Summary   : ${entry.summary.slice(0, 200)}`);
  }
  if (entry.reason && entry.reason !== 'unknown') {
    lines.push(`  Reason    : ${entry.reason}`);
  }
  if (entry.escalationArtifact) {
    lines.push(`  Artifact  : ${entry.escalationArtifact}`);
  }
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs();

  let raw;
  try {
    raw = await fs.readFile(QUEUE_PATH, 'utf8');
  } catch {
    console.error(`No escalation queue found at ${QUEUE_PATH}`);
    console.error('Run a Dr Bob review first: node scripts/dr-bob-review.mjs --file <path>');
    process.exit(1);
  }

  const lines = raw.trim().split('\n').filter(Boolean);
  let entries = lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      console.warn(`  [warn] Line ${i + 1} is not valid JSON, skipping.`);
      return null;
    }
  }).filter(Boolean);

  if (opts.openOnly) {
    entries = entries.filter(e => e.handoffRequired === true && e.selfHealSuccess !== true);
  }

  if (opts.limit && opts.limit > 0) {
    entries = entries.slice(-opts.limit);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
    return;
  }

  const total = entries.length;
  const needHuman = entries.filter(e => e.handoffRequired && !e.selfHealSuccess).length;
  const healed = entries.filter(e => e.selfHealSuccess).length;

  console.log(`\n╔══════════════════════════════════════════════════════════════════════╗`);
  console.log(`║  Dr Bob Escalation Queue                                            ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════╝`);
  console.log(`  Queue: ${QUEUE_PATH}`);
  console.log(`  Total entries : ${total}`);
  console.log(`  Needs human   : ${needHuman}  (🔴 open handoffs)`);
  console.log(`  Self-healed   : ${healed}  (✅ resolved autonomously)`);

  if (total === 0) {
    console.log('\n  No entries match the current filter.\n');
    return;
  }

  console.log('');
  entries.forEach((entry, i) => console.log(renderEntry(entry, i)));
  console.log(`──────────────────────────────────────────────────────────────────────`);

  if (needHuman > 0) {
    console.log(`\n⚠️  ACTION REQUIRED: ${needHuman} escalation(s) need Copilot/human review.`);
    console.log('   Review the "Hint" and "Top Issue" fields above and apply fixes.\n');
  } else {
    console.log('\n✅ All entries resolved or no open escalations.\n');
  }
}

main().catch(err => {
  console.error('Escalation reader error:', err?.message || err);
  process.exit(1);
});
