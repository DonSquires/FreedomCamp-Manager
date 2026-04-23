'use strict';

const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..', '..');
const logPath = path.join(workspaceRoot, 'data', 'bob-response-scores.jsonl');
const systemStatePath = path.join(workspaceRoot, 'system_state.json');
const modulesRoot = path.join(workspaceRoot, 'src', 'modules');
const moduleRefPattern = /src\/modules\/([A-Za-z0-9_-]+)/g;

function normalizeText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadKnownModules() {
  const modules = new Set();

  const systemState = readJsonIfPresent(systemStatePath);
  for (const moduleName of systemState?.modules || []) {
    if (moduleName) modules.add(String(moduleName));
  }

  try {
    const entries = fs.readdirSync(modulesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) modules.add(entry.name);
    }
  } catch {
    // Missing src/modules means there is no local module inventory yet.
  }

  return modules;
}

function extractModuleRefs(text) {
  const refs = new Set();
  for (const match of normalizeText(text).matchAll(moduleRefPattern)) {
    refs.add(match[1]);
  }
  return Array.from(refs).sort();
}

function scoreResponse(options = {}) {
  const promptText = normalizeText(options.prompt).trim();
  const responseText = normalizeText(options.response).trim();
  const delivery = options.delivery || {};
  const metadata = options.metadata || {};

  const knownModules = loadKnownModules();
  const mentionedModules = extractModuleRefs(responseText);
  const hallucinatedModules = mentionedModules.filter((moduleName) => !knownModules.has(moduleName));

  let score = 10;
  const failureReasons = [];
  const positiveSignals = [];

  if (delivery.sent === false) {
    score = 0;
    failureReasons.push(delivery.reason || 'delivery_failed');
  }

  if (!responseText) {
    score = 0;
    failureReasons.push('empty_response');
  }

  if (hallucinatedModules.length > 0) {
    score = 0;
    failureReasons.push(`hallucinated_modules:${hallucinatedModules.join(',')}`);
  }

  if (metadata.qualityGateFailed || metadata.fallbackApplied) {
    score = Math.min(score, metadata.qualityGateFailed ? 0 : 3);
    failureReasons.push(metadata.qualityGateFailed ? 'quality_gate_failed' : 'fallback_applied');
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
    target: options.target || 'Bob',
    channel: options.channel || delivery.channel || 'unknown',
    score,
    disposition: score >= 9 ? 'reward' : score <= 3 ? 'penalize' : 'review',
    failureReasons,
    positiveSignals,
    mentionedModules,
    hallucinatedModules,
    promptPreview: promptText.slice(0, 220),
    responsePreview: responseText.slice(0, 220),
    metadata: {
      reason: delivery.reason || metadata.reason || null,
      status: delivery.status ?? metadata.status ?? null,
      provider: metadata.provider || null,
      fallback: metadata.fallback === true,
      qualityGateStatus: metadata.qualityGateStatus || null,
      sourceFile: metadata.sourceFile || null,
      route: metadata.route || null,
    },
  };
}

function recordResponseFeedback(options = {}) {
  const entry = scoreResponse(options);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

module.exports = {
  scoreResponse,
  recordResponseFeedback,
  BOB_RESPONSE_LOG_PATH: logPath,
};