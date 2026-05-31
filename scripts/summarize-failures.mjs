#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadLocalEnv } from './load-local-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const logPath = path.join(workspaceRoot, 'data', 'bob-response-scores.jsonl');
const summaryJsonPath = path.join(workspaceRoot, 'data', 'bob-failure-summary.json');
const summaryMarkdownPath = path.join(workspaceRoot, 'docs', 'BOB_FAILURE_SUMMARY.md');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { hours: 24 };
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || '');
    if (token === '--hours') parsed.hours = Number(args[index + 1] || '24');
    if (token.startsWith('--hours=')) parsed.hours = Number(token.split('=')[1] || '24');
  }
  return parsed;
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function sortCounts(map) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => ({ name, count }));
}

function formatList(items, fallback = 'none') {
  if (!items.length) return fallback;
  return items.map((item) => `${item.name} (${item.count})`).join(', ');
}

function firstNonEmptyEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

async function loadEntriesFromJsonl(hours) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((entry) => {
        const stamp = Date.parse(entry.timestamp || '');
        return Number.isFinite(stamp) && stamp >= cutoff;
      });
  } catch {
    return [];
  }
}

async function loadEntriesFromDb(hours) {
  const supabaseUrl = firstNonEmptyEnv('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const serviceRoleKey = firstNonEmptyEnv('SUPABASE_SERVICE_ROLE_KEY');
  const orgId = firstNonEmptyEnv('BOB_ORG_ID', 'ORG_ID', 'DEFAULT_ORG_ID');
  if (!supabaseUrl || !serviceRoleKey || !orgId) {
    return [];
  }

  const cutoffIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  try {
    const { data, error } = await (supabase.from('bob_learning_log'))
      .select('created_at,score,feedback,lesson_key,lesson_detail')
      .eq('organization_id', orgId)
      .gte('created_at', cutoffIso)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error || !Array.isArray(data)) {
      return [];
    }

    return data.map((row) => {
      const score01 = Number(row?.score);
      const score10 = Number.isFinite(score01)
        ? Math.max(0, Math.min(10, Math.round(score01 * 10)))
        : 10;

      const feedback = String(row?.feedback || '').trim();
      const failureReasons = feedback
        ? feedback.split(';').map((reason) => reason.trim()).filter(Boolean)
        : [];

      const sourceFile = String(row?.lesson_detail?.source_file || '').trim();
      return {
        timestamp: row?.created_at,
        target: 'Bob',
        channel: String(row?.lesson_detail?.channel || '').trim() || 'db-learning-log',
        score: score10,
        failureReasons,
        hallucinatedModules: [],
        responsePreview: String(row?.lesson_key || '').trim() || 'lesson',
        metadata: {
          sourceFile: sourceFile || null,
        },
      };
    });
  } catch {
    return [];
  }
}

async function loadEntries(hours) {
  const dbEntries = await loadEntriesFromDb(hours);
  if (dbEntries.length > 0) {
    return dbEntries;
  }
  return loadEntriesFromJsonl(hours);
}

async function main() {
  loadLocalEnv();
  const { hours } = parseArgs();
  const entries = await loadEntries(Number.isFinite(hours) && hours > 0 ? hours : 24);

  const failureReasonCounts = new Map();
  const hallucinationCounts = new Map();
  const sourceFileCounts = new Map();
  const lowScoreEntries = [];

  for (const entry of entries) {
    for (const reason of entry.failureReasons || []) increment(failureReasonCounts, reason);
    for (const moduleName of entry.hallucinatedModules || []) increment(hallucinationCounts, moduleName);
    if ((entry.score ?? 10) <= 3) {
      lowScoreEntries.push({
        timestamp: entry.timestamp,
        target: entry.target,
        channel: entry.channel,
        score: entry.score,
        reasons: entry.failureReasons || [],
        responsePreview: entry.responsePreview || '',
      });
    }
    if (entry.metadata?.sourceFile) increment(sourceFileCounts, entry.metadata.sourceFile);
  }

  const topFailureReasons = sortCounts(failureReasonCounts).slice(0, 5);
  const topHallucinationPatterns = sortCounts(hallucinationCounts).slice(0, 5);
  const repeatedHallucinations = topHallucinationPatterns.filter((item) => item.count >= 3);
  const topFlaggedArtifacts = sortCounts(sourceFileCounts).slice(0, 5);

  const recommendations = [];
  if (repeatedHallucinations.length > 0) {
    recommendations.push(
      `Add these to the session Never Use Until Verified list: ${repeatedHallucinations.map((item) => item.name).join(', ')}`
    );
  }
  if (topFailureReasons.some((item) => item.name.includes('quality_gate_failed'))) {
    recommendations.push('Re-read docs/BOB_TRAINING_TRUTH_PROTOCOL.md before the next redesign response.');
  }
  if (topFailureReasons.some((item) => item.name.includes('delivery_failed') || item.name.includes('network failure'))) {
    recommendations.push('Prefer the proven RunPod delivery path when Bob local /chat is unavailable.');
  }
  if (recommendations.length === 0) {
    recommendations.push('No repeated failure mode crossed the automatic threshold in this window.');
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    totalEntries: entries.length,
    lowScoreCount: lowScoreEntries.length,
    topFailureReasons,
    topHallucinationPatterns,
    repeatedHallucinations,
    topFlaggedArtifacts,
    recommendations,
  };

  await fs.mkdir(path.dirname(summaryJsonPath), { recursive: true });
  await fs.writeFile(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const markdown = [
    '# Bob Failure Summary',
    '',
    `Generated: ${summary.generatedAt}`,
    `Window: last ${hours} hours`,
    `Entries analyzed: ${entries.length}`,
    `Low-score entries: ${lowScoreEntries.length}`,
    '',
    '## Top Failure Reasons',
    '',
    `- ${formatList(topFailureReasons)}`,
    '',
    '## Top Hallucination Patterns',
    '',
    `- ${formatList(topHallucinationPatterns)}`,
    '',
    '## Repeated Hallucinations (>=3)',
    '',
    `- ${formatList(repeatedHallucinations)}`,
    '',
    '## Most-Flagged Artifacts',
    '',
    `- ${formatList(topFlaggedArtifacts)}`,
    '',
    '## Recommendations',
    '',
    ...recommendations.map((item) => `- ${item}`),
    '',
  ].join('\n');

  await fs.writeFile(summaryMarkdownPath, markdown, 'utf8');

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});