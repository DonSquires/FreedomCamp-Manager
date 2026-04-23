#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

export const BOB_RESPONSE_LOG_PATH = path.join(
  workspaceRoot,
  'data',
  'bob-response-scores.jsonl'
);

const SYSTEM_STATE_PATH = path.join(workspaceRoot, 'system_state.json');
const MODULE_ROOT = path.join(workspaceRoot, 'src', 'modules');
const MODULE_REF_PATTERN = /src\/modules\/([A-Za-z0-9_-]+)/g;

function normalizeText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value);
}

async function readJsonIfPresent(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadKnownModules() {
  const modules = new Set();

  const systemState = await readJsonIfPresent(SYSTEM_STATE_PATH);
  for (const moduleName of systemState?.modules || []) {
    if (moduleName) modules.add(String(moduleName));
  }

  try {
    const entries = await fs.readdir(MODULE_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) modules.add(entry.name);
    }
  } catch {
    // Missing src/modules is meaningful; it just means there are no local modules to trust.
  }

  return modules;
}

function extractModuleRefs(text) {
  const refs = new Set();
  for (const match of normalizeText(text).matchAll(MODULE_REF_PATTERN)) {
    refs.add(match[1]);
  }
  return [...refs].sort();
}

export async function scoreBobResponse({
  target,
  channel,
  prompt,
  response,
  delivery,
  metadata = {},
}) {
  const promptText = normalizeText(prompt).trim();
  const responseText = normalizeText(response).trim();
  const knownModules = await loadKnownModules();
  const mentionedModules = extractModuleRefs(responseText);
  const hallucinatedModules = mentionedModules.filter(
    (moduleName) => !knownModules.has(moduleName)
  );

  let score = 10;
  const positiveSignals = [];
  const failureReasons = [];

  if (delivery?.sent === false) {
    score = 0;
    failureReasons.push(delivery.reason || 'delivery_failed');
  }

  if (!responseText) {
    score = 0;
    failureReasons.push('empty_response');
  }

  if (hallucinatedModules.length > 0) {
    score = 0;
    failureReasons.push(
      `hallucinated_modules:${hallucinatedModules.join(',')}`
    );
  }

  if (metadata.qualityGateFailed || metadata.fallbackApplied) {
    score = Math.min(score, metadata.qualityGateFailed ? 0 : 3);
    failureReasons.push(
      metadata.qualityGateFailed ? 'quality_gate_failed' : 'fallback_applied'
    );
  }

  if (/system_state\.json/i.test(responseText)) {
    positiveSignals.push('checked_system_state');
  }

  if (/\b(spec\.md|plan\.md)\b/i.test(responseText)) {
    positiveSignals.push('spec_driven_language');
  }

  if (/(not enough information|cannot verify|can't verify|i don't know|unclear from the repo)/i.test(responseText)) {
    positiveSignals.push('truthful_uncertainty');
  }

  return {
    timestamp: new Date().toISOString(),
    target: target || 'Bob',
    channel: channel || delivery?.channel || 'unknown',
    score,
    disposition: score >= 9 ? 'reward' : score <= 3 ? 'penalize' : 'review',
    failureReasons,
    positiveSignals,
    mentionedModules,
    hallucinatedModules,
    promptPreview: promptText.slice(0, 220),
    responsePreview: responseText.slice(0, 220),
    metadata: {
      reason: delivery?.reason || metadata.reason || null,
      status: delivery?.status ?? metadata.status ?? null,
      provider: metadata.provider || null,
      fallback: metadata.fallback || false,
      reviewDecision: metadata.reviewDecision || null,
      sourceFile: metadata.sourceFile || null,
    },
  };
}

export async function recordScoredResponse(input) {
  const entry = await scoreBobResponse(input);
  await fs.mkdir(path.dirname(BOB_RESPONSE_LOG_PATH), { recursive: true });
  await fs.appendFile(BOB_RESPONSE_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}