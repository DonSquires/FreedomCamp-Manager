#!/usr/bin/env node

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DEFAULT_OUTPUT = resolve(ROOT, 'tools', 'mlops', 'domain-canary', 'latest.json');
const DEFAULT_HISTORY = resolve(ROOT, 'tools', 'mlops', 'domain-canary', 'history.jsonl');
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_RETRIES = 2;
const STRICT = String(process.env.MLOPS_CANARY_STRICT || 'false').trim().toLowerCase() === 'true';

const DOMAINS = [
  {
    id: 'biosecurity',
    prompt: 'Officer photo report: possible invasive weed near freedom camping edge. Need immediate containment recommendation and legal basis summary.',
  },
  {
    id: 'noise',
    prompt: 'Night callout: repeated loud party near campground. Need compliant noise enforcement recommendation and legal basis summary.',
  },
  {
    id: 'parking',
    prompt: 'Overstay vehicle in a freedom camping controlled zone. Need parking enforcement recommendation and legal basis summary.',
  },
];

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

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function isRunpodLikeUrl(url) {
  return /api\.runpod\.ai\/v2\//i.test(url) || /\/runsync$/i.test(url);
}

function buildEndpoint(baseUrl) {
  if (isRunpodLikeUrl(baseUrl)) {
    return baseUrl.replace(/\/(run|runsync)\/?$/i, '') + '/runsync';
  }
  return baseUrl + '/api/generate';
}

function createPrompt(domainId, domainPrompt) {
  return [
    'You are an operations assistant for New Zealand freedom camping enforcement.',
    `Domain: ${domainId}.`,
    `Scenario: ${domainPrompt}`,
    'Respond with STRICT JSON only, no markdown, with fields:',
    '{"domain":"<domain>","classification":"low|medium|high|critical","recommended_action":"<short action>","legal_basis":"<short legal or policy basis>"}',
  ].join('\n');
}

function normalizeJsonText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return '';

  if (text.startsWith('{') && text.endsWith('}')) {
    return text;
  }

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return text.slice(first, last + 1);
  }

  return text;
}

function parseDomainPayload(rawText) {
  const cleaned = normalizeJsonText(rawText);
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function validateDomainPayload(payload, expectedDomain) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'response_not_json_object' };
  }

  const domain = String(payload.domain || '').trim().toLowerCase();
  if (domain !== expectedDomain) {
    return { ok: false, reason: `domain_mismatch:${domain || 'missing'}` };
  }

  const classification = String(payload.classification || '').trim().toLowerCase();
  if (!['low', 'medium', 'high', 'critical'].includes(classification)) {
    return { ok: false, reason: `invalid_classification:${classification || 'missing'}` };
  }

  const action = String(payload.recommended_action || '').trim();
  if (!action) {
    return { ok: false, reason: 'missing_recommended_action' };
  }

  const legalBasis = String(payload.legal_basis || '').trim();
  if (!legalBasis) {
    return { ok: false, reason: 'missing_legal_basis' };
  }

  return { ok: true, reason: 'ok' };
}

async function callInference(endpoint, baseUrl, apiKey, timeoutMs, domainId, domainPrompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers['x-inference-api-key'] = apiKey;
  }

  const prompt = createPrompt(domainId, domainPrompt);

  const body = isRunpodLikeUrl(baseUrl)
    ? {
        input: {
          message: prompt,
          prompt,
          stream: false,
        },
      }
    : {
        model: String(process.env.OLLAMA_MODEL || 'qwen2.5:7b').trim(),
        prompt,
        stream: false,
        format: 'json',
      };

  const startedAt = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startedAt;
    const raw = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        latencyMs,
        httpStatus: response.status,
        rawResponse: raw.slice(0, 1000),
        reason: `http_${response.status}`,
      };
    }

    let text = raw;
    try {
      const parsed = JSON.parse(raw);
      text = String(
        parsed?.output?.message
          || parsed?.output?.response
          || parsed?.response
          || parsed?.message
          || raw,
      );
    } catch {
      text = raw;
    }

    return {
      ok: true,
      latencyMs,
      httpStatus: response.status,
      rawResponse: text.slice(0, 1500),
      reason: 'ok',
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const timeout = error?.name === 'AbortError';
    return {
      ok: false,
      latencyMs,
      httpStatus: null,
      rawResponse: '',
      reason: timeout ? 'timeout' : `network_error:${String(error?.message || error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function shouldRetry(result) {
  if (!result || result.ok) return false;
  if (result.reason === 'timeout') return true;
  if (String(result.reason || '').startsWith('network_error:')) return true;
  return String(result.reason || '').startsWith('http_5');
}

async function callInferenceWithRetry(endpoint, baseUrl, apiKey, timeoutMs, retries, domainId, domainPrompt) {
  const attempts = [];

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const result = await callInference(endpoint, baseUrl, apiKey, timeoutMs, domainId, domainPrompt);
    attempts.push({
      attempt,
      ok: result.ok,
      reason: result.reason,
      latencyMs: result.latencyMs,
      httpStatus: result.httpStatus,
    });

    if (result.ok || !shouldRetry(result) || attempt === retries) {
      return { result, attempts };
    }
  }

  return {
    result: {
      ok: false,
      latencyMs: 0,
      httpStatus: null,
      rawResponse: '',
      reason: 'unknown_retry_failure',
    },
    attempts,
  };
}

function writeReport(outputPath, report) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
}

function appendHistory(historyPath, report) {
  mkdirSync(dirname(historyPath), { recursive: true });
  appendFileSync(historyPath, `${JSON.stringify(report)}\n`);
}

async function main() {
  const outputArg = argValue('--out');
  const historyArg = argValue('--history');
  const timeoutArg = Number.parseInt(argValue('--timeoutMs') || '', 10);
  const retryArg = Number.parseInt(argValue('--retries') || '', 10);
  const outputPath = outputArg ? resolve(ROOT, outputArg) : DEFAULT_OUTPUT;
  const historyPath = historyArg ? resolve(ROOT, historyArg) : DEFAULT_HISTORY;
  const timeoutMs = Number.isFinite(timeoutArg) && timeoutArg > 0
    ? timeoutArg
    : Number.parseInt(String(process.env.MLOPS_CANARY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS;
  const retries = Number.isFinite(retryArg) && retryArg > 0
    ? retryArg
    : Number.parseInt(String(process.env.MLOPS_CANARY_RETRIES || DEFAULT_RETRIES), 10) || DEFAULT_RETRIES;

  const baseUrl = normalizeBaseUrl(firstNonEmpty([
    process.env.BOB_SERVICE_URL,
    process.env.INFERENCE_SERVICE_URL,
    process.env.VITE_INFERENCE_SERVICE_URL,
  ]));

  const apiKey = firstNonEmpty([
    process.env.BOB_INFERENCE_API_KEY,
    process.env.INFERENCE_API_KEY,
    process.env.VITE_INFERENCE_API_KEY,
  ]);

  const startedAt = new Date().toISOString();

  if (!baseUrl) {
    const report = {
      generatedAt: startedAt,
      strict: STRICT,
      status: STRICT ? 'failed' : 'skipped',
      reason: 'missing_inference_service_url',
      endpoint: null,
      domains: [],
    };
    writeReport(outputPath, report);
    console.error('Missing inference service URL. Set BOB_SERVICE_URL or INFERENCE_SERVICE_URL.');
    process.exit(STRICT ? 1 : 0);
  }

  if (!apiKey) {
    const report = {
      generatedAt: startedAt,
      strict: STRICT,
      status: STRICT ? 'failed' : 'skipped',
      reason: 'missing_inference_api_key',
      endpoint: buildEndpoint(baseUrl),
      domains: [],
    };
    writeReport(outputPath, report);
    console.error('Missing inference API key. Set BOB_INFERENCE_API_KEY or INFERENCE_API_KEY.');
    process.exit(STRICT ? 1 : 0);
  }

  const endpoint = buildEndpoint(baseUrl);
  const domainResults = [];

  for (const domain of DOMAINS) {
    const { result: call, attempts } = await callInferenceWithRetry(
      endpoint,
      baseUrl,
      apiKey,
      timeoutMs,
      retries,
      domain.id,
      domain.prompt,
    );
    let validation = { ok: false, reason: call.reason };
    let parsed = null;

    if (call.ok) {
      parsed = parseDomainPayload(call.rawResponse);
      validation = validateDomainPayload(parsed, domain.id);
    }

    domainResults.push({
      domain: domain.id,
      ok: call.ok && validation.ok,
      reason: validation.reason,
      latencyMs: call.latencyMs,
      httpStatus: call.httpStatus,
      attempts,
      responsePreview: call.rawResponse.slice(0, 300),
      parsed,
    });
  }

  const passedCount = domainResults.filter((d) => d.ok).length;
  const failedCount = domainResults.length - passedCount;
  const status = failedCount === 0 ? 'passed' : 'failed';

  const report = {
    generatedAt: startedAt,
    strict: STRICT,
    status,
    reason: failedCount === 0 ? 'ok' : 'domain_canary_failures',
    endpoint,
    timeoutMs,
    retries,
    passedCount,
    failedCount,
    domains: domainResults,
  };

  writeReport(outputPath, report);
  appendHistory(historyPath, report);

  console.log(`Domain canary endpoint: ${endpoint}`);
  console.log(`Passed: ${passedCount}/${domainResults.length}`);
  for (const result of domainResults) {
    const icon = result.ok ? 'PASS' : 'FAIL';
    console.log(`${icon} ${result.domain} (${result.latencyMs}ms) reason=${result.reason}`);
  }

  if (failedCount > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
