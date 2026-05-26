#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEFAULT_HISTORY = resolve(ROOT, 'tools', 'mlops', 'domain-canary', 'history.jsonl');

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return '';
  return String(process.argv[index + 1] || '').trim();
}

function firstNonEmpty(values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function writeReport(path, report) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2));
}

function readHistory(historyPath) {
  try {
    const raw = readFileSync(historyPath, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function evaluateConsecutiveSuccess(runs, required) {
  let consecutive = 0;
  const inspected = [];

  for (const run of runs) {
    const status = String(run.status || '').trim().toLowerCase();
    const conclusion = String(run.conclusion || '').trim().toLowerCase();
    const passed = conclusion === 'success' || status === 'passed' || status === 'success';

    inspected.push({
      id: run.id,
      created_at: run.created_at,
      status: run.status,
      conclusion: run.conclusion,
      html_url: run.html_url,
      head_sha: run.head_sha,
      event: run.event,
      result: passed ? 'success' : 'failure',
    });

    if (passed) {
      consecutive += 1;
      if (consecutive >= required) {
        break;
      }
      continue;
    }

    break;
  }

  return { consecutive, inspected };
}

async function main() {
  const required = toInt(argValue('--required') || process.env.MLOPS_REQUIRED_CONSECUTIVE_GREEN, 3);
  const strict = String(firstNonEmpty([argValue('--strict'), process.env.MLOPS_PROMOTION_GATE_STRICT, 'true']))
    .toLowerCase() === 'true';

  const runId = firstNonEmpty([process.env.GITHUB_RUN_ID, 'local']);
  const outputPath = resolve(
    ROOT,
    argValue('--out') || `tools/mlops/domain-canary/promotion-gate/${runId}/promotion-gate.json`,
  );

  const historyPath = resolve(ROOT, argValue('--history') || DEFAULT_HISTORY);
  const historyRuns = readHistory(historyPath);
  const { consecutive: localConsecutive, inspected: localInspected } = evaluateConsecutiveSuccess(historyRuns.slice().reverse(), required);

  if (historyRuns.length === 0) {
    const report = {
      generatedAt: new Date().toISOString(),
      strict,
      status: strict ? 'failed' : 'skipped',
      reason: 'missing_local_canary_history',
      requiredConsecutiveGreen: required,
      achievedConsecutiveGreen: 0,
      inspectedRuns: [],
      historyPath,
    };

    writeReport(outputPath, report);

    if (strict) {
      console.error('Missing local canary history. Run the domain canary workflow locally first.');
      process.exit(1);
    }

    console.log('Promotion gate skipped: missing local canary history.');
    process.exit(0);
  }
  const consecutive = localConsecutive;
  const inspected = localInspected;

  const passed = consecutive >= required;
  const report = {
    generatedAt: new Date().toISOString(),
    strict,
    status: passed ? 'passed' : 'failed',
    reason: passed ? 'ok' : 'insufficient_consecutive_green_runs',
    historyPath,
    requiredConsecutiveGreen: required,
    achievedConsecutiveGreen: consecutive,
    inspectedRuns: inspected,
  };

  writeReport(outputPath, report);

  console.log(`Required consecutive green runs: ${required}`);
  console.log(`Achieved consecutive green runs: ${consecutive}`);
  for (const run of inspected.slice(0, required + 2)) {
    console.log(`${run.conclusion || 'unknown'} | ${run.created_at} | ${run.id}`);
  }

  if (!passed) {
    if (strict) {
      console.error('Promotion gate failed: insufficient consecutive successful canary runs.');
      process.exit(1);
    }

    console.log('Promotion gate is non-strict: threshold unmet but continuing.');
  }
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
