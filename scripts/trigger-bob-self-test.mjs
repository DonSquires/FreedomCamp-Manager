#!/usr/bin/env node
/**
 * trigger-bob-self-test.mjs
 *
 * Sends a run_playwright job to Bob's RunPod serverless endpoint,
 * polls until completion, then:
 *   - prints a summary to stdout
 *   - posts a bug_report to Supabase if any tests failed
 *   - exits non-zero on failure (for CI gating)
 *
 * Required env:
 *   INFERENCE_SERVICE_URL  or  RUNPOD_ENDPOINT_ID
 *   INFERENCE_API_KEY      or  RUNPOD_ENDPOINT_API_KEY / RUNPOD_API_KEY
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 *   BOB_SELF_TEST_SCOPE        quick | core | workflows | visual | human | full  (default: quick)
 *   BOB_SELF_TEST_TIMEOUT_MS   max active run time in ms once IN_PROGRESS (default: 600000 = 10 min)
 *   BOB_SELF_TEST_QUEUE_TIMEOUT_MS max queue wait time in ms while IN_QUEUE (default: 900000 = 15 min)
 *   BOB_SELF_TEST_POLL_MS      poll interval         (default: 5000)
 *   BOB_SELF_TEST_DRY_RUN      true = skip Supabase write, just print
 *   BOB_SELF_TEST_PREFLIGHT    true = validate repo/token access before queueing (default: true)
 *   BOB_SELF_TEST_REQUIRE_REPO_TOKEN true = require worker git token for private repos (default: true)
 *   BOB_SELF_TEST_AUTH_MODE    repo-token | embed-url (default: repo-token)
 *   BOB_SELF_TEST_REQUIRE_BUG_REPORT_CONTEXT true = require bug report env completeness before run (default: true)
 *   BOB_SELF_TEST_LAST_RUN_FILE path to persist last run summary (default: data/bob-last-runpod-self-test.json)
 *   SYNTHETIC_MONITOR_USER_ID  reporter UUID for bug_reports (required when BOB_SELF_TEST_REQUIRE_BUG_REPORT_CONTEXT=true)
 *
 * Usage:
 *   node scripts/trigger-bob-self-test.mjs
 *   node scripts/trigger-bob-self-test.mjs --scope core
 *   node scripts/trigger-bob-self-test.mjs --scope quick --quickSpecs tests/e2e/deep-functional.spec.ts
 *   node scripts/trigger-bob-self-test.mjs --rerunFailedOnly
 *   node scripts/trigger-bob-self-test.mjs --dryRun
 */

import https from 'node:https';
import http from 'node:http';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

// ─── Load local env files (.env first, then .env.playwright.local) ─────────
function loadEnvFile(fileName) {
  const envPath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.playwright.local');

function collectForwardedTestEnv() {
  const out = {};
  const prefixes = [
    'PLAYWRIGHT_',
    'E2E_',
    'API_TEST_',
    'SUPABASE_',
    'VITE_',
    'NEXT_PUBLIC_',
    'RADIO_',
    'PTT_',
    'RUNPOD_',
  ];
  const exact = new Set([
    'DEFAULT_PLAYWRIGHT_BASE_URL',
    'PLAYWRIGHT_BASE_URL',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'INFERENCE_SERVICE_URL',
    'INFERENCE_API_KEY',
    'SYNTHETIC_MONITOR_USER_ID',
  ]);

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    const prefixed = prefixes.some((prefix) => key.startsWith(prefix));
    if (prefixed || exact.has(key)) out[key] = value;
  }

  const aliases = [
    ['PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL'],
    ['PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD'],
    ['PLAYWRIGHT_CLIENT_VIEWER_EMAIL', 'PLAYWRIGHT_CLIENT_EMAIL'],
    ['PLAYWRIGHT_CLIENT_VIEWER_PASSWORD', 'PLAYWRIGHT_CLIENT_PASSWORD'],
    ['PLAYWRIGHT_CLIENT_STAFF_EMAIL', 'PLAYWRIGHT_CLIENT_OFFICER_EMAIL'],
    ['PLAYWRIGHT_CLIENT_STAFF_PASSWORD', 'PLAYWRIGHT_CLIENT_OFFICER_PASSWORD'],
  ];
  for (const [target, source] of aliases) {
    if (!out[target] && out[source]) out[target] = out[source];
  }

  return out;
}

function hasAnyEnv(envMap, keys = []) {
  return keys.some((key) => Boolean(envMap[key]));
}

function validateForwardedCredentials(forwardedEnv, specs = []) {
  const missing = [];
  const normalizedSpecs = specs.map((spec) => String(spec || '').toLowerCase());

  if (!forwardedEnv.VITE_SUPABASE_URL && !forwardedEnv.SUPABASE_URL) {
    missing.push('VITE_SUPABASE_URL (or SUPABASE_URL)');
  }
  if (!forwardedEnv.VITE_SUPABASE_ANON_KEY && !forwardedEnv.SUPABASE_ANON_KEY) {
    missing.push('VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)');
  }

  const requiresServiceRole = normalizedSpecs.some((spec) =>
    spec.includes('org-isolation') ||
    spec.includes('phase-b1') ||
    spec.includes('radio-rls') ||
    spec.includes('transcript') ||
    spec.includes('module-route-access') ||
    spec.includes('client-portal-isolation')
  );
  if (requiresServiceRole && !forwardedEnv.SUPABASE_SERVICE_ROLE_KEY) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }

  const allowSharedFallback = String(forwardedEnv.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK || '').trim() === '1';
  const hasSharedCreds = hasAnyEnv(forwardedEnv, ['PLAYWRIGHT_LIVE_EMAIL', 'E2E_LIVE_EMAIL', 'API_TEST_EMAIL']) &&
    hasAnyEnv(forwardedEnv, [
      'PLAYWRIGHT_LIVE_PASSWORD',
      'E2E_LIVE_PASSWORD',
      'API_TEST_PASSWORD',
      'PLAYWRIGHT_TEST_PASSWORD',
      'E2E_TEST_PASSWORD',
    ]);

  const needsRoleMatrixCreds = normalizedSpecs.some((spec) =>
    spec.includes('module-route-access') || spec.includes('client-portal-isolation')
  );

  if (needsRoleMatrixCreds) {
    const roleChecks = [
      {
        label: 'master role credentials',
        emails: ['PLAYWRIGHT_MASTER_EMAIL', 'E2E_MASTER_EMAIL'],
        passwords: ['PLAYWRIGHT_MASTER_PASSWORD', 'E2E_MASTER_PASSWORD'],
      },
      {
        label: 'adminOrg1 role credentials',
        emails: ['PLAYWRIGHT_ADMIN_ORG1_EMAIL', 'PLAYWRIGHT_ADMIN_EMAIL', 'E2E_ADMIN_EMAIL'],
        passwords: ['PLAYWRIGHT_ADMIN_ORG1_PASSWORD', 'PLAYWRIGHT_ADMIN_PASSWORD', 'E2E_ADMIN_PASSWORD'],
      },
      {
        label: 'officerOrg1 role credentials',
        emails: ['PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL', 'E2E_OFFICER_EMAIL'],
        passwords: ['PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD', 'E2E_OFFICER_PASSWORD'],
      },
      {
        label: 'client viewer credentials',
        emails: ['PLAYWRIGHT_CLIENT_VIEWER_EMAIL', 'PLAYWRIGHT_CLIENT_EMAIL', 'E2E_CLIENT_VIEWER_EMAIL'],
        passwords: ['PLAYWRIGHT_CLIENT_VIEWER_PASSWORD', 'PLAYWRIGHT_CLIENT_PASSWORD', 'E2E_CLIENT_VIEWER_PASSWORD'],
      },
    ];

    for (const role of roleChecks) {
      const roleReady = hasAnyEnv(forwardedEnv, role.emails) && hasAnyEnv(forwardedEnv, role.passwords);
      if (!roleReady && !(allowSharedFallback && hasSharedCreds)) {
        missing.push(role.label);
      }
    }
  }

  return missing;
}

function getMissingBugReportContext({ supabaseUrl = '', serviceRole = '', reporterUser = '' } = {}) {
  const missing = [];
  if (!String(supabaseUrl || '').trim()) missing.push('VITE_SUPABASE_URL (or SUPABASE_URL)');
  if (!String(serviceRole || '').trim()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!String(reporterUser || '').trim()) missing.push('SYNTHETIC_MONITOR_USER_ID');
  return missing;
}

// ─── CLI args ─────────────────────────────────────────────────────────────────
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
function getBoolArg(name) {
  const raw = getArg(name, '').toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || process.argv.includes(`--${name}`);
}

function uniq(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function readLastRunFailedSpecs(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const direct = Array.isArray(parsed?.failed_specs) ? parsed.failed_specs : [];
    const fromFailures = Array.isArray(parsed?.failures)
      ? parsed.failures.map((failure) => String(failure?.file || '').trim())
      : [];
    return uniq([...direct, ...fromFailures]);
  } catch {
    return [];
  }
}

function writeLastRunSummary(filePath, summary) {
  const resolved = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function adaptiveRunTimeout(baseTimeoutMs, specs = []) {
  const normalized = specs.map((spec) => String(spec || '').toLowerCase());
  const hasHeavySpec = normalized.some((spec) =>
    spec.includes('module-route-access-field-client') ||
    spec.includes('module-route-access') ||
    spec.includes('client-portal-isolation') ||
    spec.includes('phase-b1')
  );

  if (!hasHeavySpec) return baseTimeoutMs;
  return Math.max(baseTimeoutMs, 780000);
}

// ─── Config ───────────────────────────────────────────────────────────────────
const SCOPE        = getArg('scope', process.env.BOB_SELF_TEST_SCOPE || 'quick');
const TIMEOUT_MS   = Number(process.env.BOB_SELF_TEST_TIMEOUT_MS || 600000);
const QUEUE_TIMEOUT_MS = Number(process.env.BOB_SELF_TEST_QUEUE_TIMEOUT_MS || 900000);
const POLL_MS      = Number(process.env.BOB_SELF_TEST_POLL_MS || 5000);
const DRY_RUN      = getBoolArg('dryRun') || process.env.BOB_SELF_TEST_DRY_RUN === 'true';
const QUICK_SPECS_ARG = getArg('quickSpecs', '');
const RERUN_FAILED_ONLY = getBoolArg('rerunFailedOnly') || envBool('BOB_SELF_TEST_RERUN_FAILED_ONLY', false);
const LAST_RUN_FILE = getArg('lastRunFile', process.env.BOB_SELF_TEST_LAST_RUN_FILE || 'data/bob-last-runpod-self-test.json');
const VALID_SCOPES = new Set(['quick', 'core', 'workflows', 'visual', 'human', 'full']);
const QUICK_SCOPE_DEFAULT_SPECS = ['tests/e2e/deep-functional.spec.ts'];

const rawBase = (
  process.env.INFERENCE_SERVICE_URL ||
  (process.env.RUNPOD_ENDPOINT_ID && `https://api.runpod.ai/v2/${process.env.RUNPOD_ENDPOINT_ID}`) ||
  ''
).trim().replace(/\/(runsync|run)$/i, '').replace(/\/+$/, '');

const API_KEY = (
  process.env.INFERENCE_API_KEY ||
  process.env.RUNPOD_ENDPOINT_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  ''
).trim();

const SUPABASE_URL    = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SERVICE_ROLE    = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const REPORTER_USER   = (process.env.SYNTHETIC_MONITOR_USER_ID || '').trim();

if (!rawBase) {
  console.error('[bob-self-test] INFERENCE_SERVICE_URL or RUNPOD_ENDPOINT_ID required');
  process.exit(1);
}
if (!API_KEY) {
  console.error('[bob-self-test] INFERENCE_API_KEY / RUNPOD_ENDPOINT_API_KEY required');
  process.exit(1);
}
if (!VALID_SCOPES.has(SCOPE)) {
  console.error(`[bob-self-test] Invalid scope: ${SCOPE}`);
  console.error('[bob-self-test] Valid scopes: quick, core, workflows, visual, human, full');
  process.exit(1);
}

function parseSpecArg(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function reqJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const body   = opts.body ? Buffer.from(JSON.stringify(opts.body)) : null;
    const req    = lib.request(url, {
      method:  opts.method || (body ? 'POST' : 'GET'),
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        ...(opts.headers || {}),
        ...(body ? { 'Content-Length': body.length } : {}),
      },
      timeout: 30000,
    }, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function supabasePost(path, body, key) {
  return new Promise((resolve, reject) => {
    const url    = `${SUPABASE_URL}/rest/v1${path}`;
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const bodyBuf = Buffer.from(JSON.stringify(body));
    const req = lib.request(url, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': bodyBuf.length,
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Prefer':        'return=representation',
      },
      timeout: 20000,
    }, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('supabase timeout')); });
    req.write(bodyBuf);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function withGithubAuth(url, token) {
  const rawUrl = String(url || '').trim();
  const rawToken = String(token || '').trim().replace(/\s+/g, '');
  if (!rawUrl || !rawToken) return rawUrl;
  if (!/^https:\/\/github\.com\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.includes('@github.com/')) return rawUrl;
  const encodedToken = encodeURIComponent(rawToken);
  return rawUrl.replace(/^https:\/\/github\.com\//i, `https://x-access-token:${encodedToken}@github.com/`);
}

function envBool(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function normalizeGithubRepoUrl(rawUrl) {
  const value = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  return value.replace(/\.git$/i, '') + '.git';
}

function parseGithubRepoSlug(repoUrl) {
  const normalized = normalizeGithubRepoUrl(repoUrl).replace(/\.git$/i, '');
  const match = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function githubRepoAccessProbe(repoUrl, token = '') {
  const slug = parseGithubRepoSlug(repoUrl);
  if (!slug) {
    return {
      ok: false,
      status: 0,
      error: `Unsupported GITHUB_REPO_URL format: ${repoUrl}`,
    };
  }

  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'bob-self-test-preflight',
  };
  if (token) headers.Authorization = `Bearer ${String(token).trim().replace(/\s+/g, '')}`;

  try {
    const response = await fetch(`https://api.github.com/repos/${slug.owner}/${slug.repo}`, { headers });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      private: Boolean(payload?.private),
      fullName: payload?.full_name || `${slug.owner}/${slug.repo}`,
      error: payload?.message || '',
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: String(error?.message || error),
    };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  const startedAt = new Date().toISOString();
  console.log(`[bob-self-test] scope=${SCOPE} endpoint=${rawBase} dryRun=${DRY_RUN}`);

  // 1. Submit job
  const submitUrl = `${rawBase}/run`;
  const REPO_URL_RAW = process.env.GITHUB_REPO_URL    || 'https://github.com/DonSquires/FreedomCamp-Manager.git';
  const REPO_BRANCH = process.env.GITHUB_REPO_BRANCH || 'main';
  const REPO_TOKEN  = (process.env.BOB_WORKER_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_API || '').trim().replace(/\s+/g, '');
  const PREFLIGHT = envBool('BOB_SELF_TEST_PREFLIGHT', true);
  const REQUIRE_REPO_TOKEN = envBool('BOB_SELF_TEST_REQUIRE_REPO_TOKEN', true);
  const REQUIRE_BUG_REPORT_CONTEXT = envBool('BOB_SELF_TEST_REQUIRE_BUG_REPORT_CONTEXT', true);
  const AUTH_MODE = String(process.env.BOB_SELF_TEST_AUTH_MODE || '').trim().toLowerCase() || 'repo-token';
  const EMBED_REPO_TOKEN_IN_URL = envBool('BOB_SELF_TEST_EMBED_REPO_TOKEN_IN_URL', false);
  const isGithubActionsToken = REPO_TOKEN.startsWith('ghs_');
  const useEmbedUrl = EMBED_REPO_TOKEN_IN_URL || AUTH_MODE === 'embed-url' || isGithubActionsToken;
  const REPO_URL_CLEAN = normalizeGithubRepoUrl(REPO_URL_RAW);
  const REPO_URL    = useEmbedUrl ? withGithubAuth(REPO_URL_CLEAN, REPO_TOKEN) : REPO_URL_CLEAN;

  if (PREFLIGHT) {
    const slug = parseGithubRepoSlug(REPO_URL_CLEAN);
    if (!slug) {
      console.error(`[bob-self-test] Invalid GITHUB_REPO_URL: ${REPO_URL_RAW}`);
      console.error('[bob-self-test] Expected format: https://github.com/<owner>/<repo>.git');
      process.exit(1);
    }
    if (REQUIRE_REPO_TOKEN && !REPO_TOKEN) {
      console.error('[bob-self-test] Missing repo token for worker clone. Set BOB_WORKER_GITHUB_TOKEN (or GITHUB_TOKEN/GH_API).');
      process.exit(1);
    }
    const probe = await githubRepoAccessProbe(REPO_URL_CLEAN, REPO_TOKEN);
    if (!probe.ok) {
      const authHint = REPO_TOKEN
        ? 'Token present but cannot read repo. Ensure token has contents:read on this repository.'
        : 'No token supplied. Provide BOB_WORKER_GITHUB_TOKEN for private repo access.';
      console.error(`[bob-self-test] Repo preflight failed: HTTP ${probe.status} ${probe.error || ''}`.trim());
      console.error(`[bob-self-test] Repo target: ${slug.owner}/${slug.repo}`);
      console.error(`[bob-self-test] ${authHint}`);
      process.exit(1);
    }
    console.log(`[bob-self-test] Repo preflight ok: ${probe.fullName} (private=${probe.private})`);
  }

  const forwardedTestEnv = collectForwardedTestEnv();
  const configuredQuickSpecs = parseSpecArg(QUICK_SPECS_ARG);
  const quickScopeSpecs = SCOPE === 'quick'
    ? (configuredQuickSpecs.length > 0 ? configuredQuickSpecs : QUICK_SCOPE_DEFAULT_SPECS)
    : [];
  const manualSpecs = parseSpecArg(getArg('specs', ''));
  const lastRunFailedSpecs = RERUN_FAILED_ONLY ? readLastRunFailedSpecs(LAST_RUN_FILE) : [];
  const selectedSpecs = lastRunFailedSpecs.length > 0
    ? lastRunFailedSpecs
    : (quickScopeSpecs.length > 0 ? quickScopeSpecs : manualSpecs);

  if (RERUN_FAILED_ONLY) {
    if (lastRunFailedSpecs.length === 0) {
      console.error(`[bob-self-test] --rerunFailedOnly requested but no failed specs were found in ${LAST_RUN_FILE}`);
      process.exit(1);
    }
    console.log(`[bob-self-test] rerunFailedOnly enabled: ${lastRunFailedSpecs.join(', ')}`);
  }

  const missingCredentialKeys = validateForwardedCredentials(forwardedTestEnv, selectedSpecs);
  if (missingCredentialKeys.length > 0) {
    console.error('[bob-self-test] Missing credentials required for selected scope/specs:');
    for (const key of missingCredentialKeys) {
      console.error(`  - ${key}`);
    }
    console.error('[bob-self-test] Populate these keys in .env or .env.playwright.local before triggering RunPod.');
    process.exit(1);
  }

  const missingBugReportContext = getMissingBugReportContext({
    supabaseUrl: SUPABASE_URL,
    serviceRole: SERVICE_ROLE,
    reporterUser: REPORTER_USER,
  });
  if (!DRY_RUN && REQUIRE_BUG_REPORT_CONTEXT && missingBugReportContext.length > 0) {
    console.error('[bob-self-test] Missing bug report context required for non-dry run:');
    for (const key of missingBugReportContext) {
      console.error(`  - ${key}`);
    }
    console.error('[bob-self-test] Set these keys or run with BOB_SELF_TEST_REQUIRE_BUG_REPORT_CONTEXT=false to bypass.');
    process.exit(1);
  }

  const forwardedKeys = Object.keys(forwardedTestEnv).sort();
  console.log(`[bob-self-test] Forwarding ${forwardedKeys.length} env vars to RunPod worker`);
  if (quickScopeSpecs.length > 0) {
    console.log(`[bob-self-test] quick scope specs: ${quickScopeSpecs.join(', ')}`);
  }
  if (isGithubActionsToken) {
    console.log('[bob-self-test] Detected GitHub Actions token; using URL-token repo auth mode for clone compatibility');
  }

  const workerTimeoutMs = adaptiveRunTimeout(Math.max(TIMEOUT_MS - 60000, 60000), selectedSpecs);

  const payload = {
    input: {
      action:      'run_playwright',
      scope:       SCOPE,
      timeout_ms:  workerTimeoutMs,
      reporter:    'json',
      ...(selectedSpecs.length > 0 ? { specs: selectedSpecs } : {}),
      // Repo clone — Bob will git clone/pull this before running tests
      repo_url:    REPO_URL,
      repo_branch: REPO_BRANCH,
      repo_auth_mode: useEmbedUrl ? 'url-token' : 'token',
      ...(REPO_TOKEN && !useEmbedUrl ? { repo_token: REPO_TOKEN } : {}),
      // Pass test/runtime env so worker can build a complete .env for Playwright.
      ...forwardedTestEnv,
    },
  };
  console.log(`[bob-self-test] Submitting run_playwright job to ${submitUrl}...`);
  const submitRes = await reqJson(submitUrl, { body: payload });
  if (submitRes.status !== 200 || !submitRes.data?.id) {
    console.error('[bob-self-test] Job submission failed:', submitRes.status, JSON.stringify(submitRes.data));
    process.exit(1);
  }
  const jobId = submitRes.data.id;
  console.log(`[bob-self-test] Job submitted: id=${jobId} status=${submitRes.data.status}`);

  // 2. Poll for completion
  const pollUrl          = `${rawBase}/status/${jobId}`;
  const queueDeadline    = Date.now() + QUEUE_TIMEOUT_MS;
  let activeDeadline     = null;
  let outputData         = null;
  let lastStatus         = String(submitRes.data.status || '').toUpperCase();

  while (true) {
    await sleep(POLL_MS);
    const pollRes = await reqJson(pollUrl);
    const status  = String(pollRes.data?.status || '').toUpperCase();
    lastStatus = status;
    console.log(`[bob-self-test] poll status=${status}`);

    if (status === 'IN_PROGRESS' && !activeDeadline) {
      activeDeadline = Date.now() + TIMEOUT_MS;
      console.log(`[bob-self-test] queue complete, active timeout budget=${TIMEOUT_MS}ms`);
    }

    if (!activeDeadline && Date.now() > queueDeadline) {
      break;
    }

    if (activeDeadline && Date.now() > activeDeadline) {
      break;
    }

    if (status === 'COMPLETED') {
      outputData = pollRes.data?.output;
      break;
    }
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
      console.error(`[bob-self-test] Job ended with status=${status}`);
      console.error(JSON.stringify(pollRes.data?.output || pollRes.data?.error));
      process.exit(1);
    }
  }

  if (!outputData) {
    const queueTimeoutHit = !activeDeadline;
    const timeoutKind = queueTimeoutHit ? 'queue_timeout' : 'run_timeout';
    console.error(`[bob-self-test] Timed out waiting for job ${jobId} (${timeoutKind}, lastStatus=${lastStatus})`);
    writeLastRunSummary(LAST_RUN_FILE, {
      status: 'timeout',
      timeout_kind: timeoutKind,
      queue_timeout_ms: QUEUE_TIMEOUT_MS,
      run_timeout_ms: TIMEOUT_MS,
      last_status: lastStatus,
      scope: SCOPE,
      job_id: jobId,
      selected_specs: selectedSpecs,
      failed_specs: selectedSpecs,
      created_at: new Date().toISOString(),
    });
    process.exit(1);
  }

  // 3. Parse results
  const stats    = outputData?.stats  || {};
  const failures = outputData?.failures || [];
  const passed   = Number(stats.passed   || 0);
  const failed   = Number(stats.failed   || 0);
  const skipped  = Number(stats.skipped  || 0);
  const success  = outputData?.success === true;

  console.log('\n[bob-self-test] ══ RESULTS ══════════════════════');
  console.log(`  scope:   ${SCOPE}`);
  console.log(`  passed:  ${passed}`);
  console.log(`  failed:  ${failed}`);
  console.log(`  skipped: ${skipped}`);
  console.log(`  success: ${success}`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    ✗ ${f.title} (${f.file})`);
      if (f.error) console.log(`      ${String(f.error).slice(0, 200)}`);
    }
  }
  if (outputData?.stdout_tail) {
    console.log('\n  stdout tail:');
    console.log(outputData.stdout_tail.slice(-1000));
  }
  console.log('══════════════════════════════════════════════\n');

  const failedSpecsFromOutput = uniq((failures || []).map((failure) => String(failure?.file || '').trim()));
  const fallbackFailedSpecs = failed > 0
    ? (failedSpecsFromOutput.length > 0 ? failedSpecsFromOutput : selectedSpecs)
    : [];
  writeLastRunSummary(LAST_RUN_FILE, {
    status: success ? 'success' : 'failed',
    scope: SCOPE,
    job_id: jobId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    selected_specs: selectedSpecs,
    failed_specs: fallbackFailedSpecs,
    stats: { passed, failed, skipped },
    success,
    failures,
  });
  console.log(`[bob-self-test] Saved last run summary to ${LAST_RUN_FILE}`);
  if (!success && fallbackFailedSpecs.length > 0) {
    console.log(`[bob-self-test] Fast retry command: node scripts/trigger-bob-self-test.mjs --rerunFailedOnly --lastRunFile ${LAST_RUN_FILE}`);
  }

  // 4. Post bug report to Supabase if failures found
  if (!success && SUPABASE_URL && SERVICE_ROLE && REPORTER_USER) {
    const timestamp = startedAt;
    const title     = `Bob self-test failed [scope=${SCOPE}] at ${timestamp}`;
    const failureLines = failures.map(f => `- ${f.title}: ${String(f.error || '').slice(0, 150)}`).join('\n');
    const description   = [
      `Bob ran his own Playwright tests (scope: ${SCOPE}) on RunPod and found failures.\n`,
      `Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}\n`,
      failures.length > 0 ? `\nFailures:\n${failureLines}` : '',
      `\nJob ID: ${jobId}`,
      `\nEndpoint: ${rawBase}`,
    ].join('');

    const bugReport = {
      title,
      description,
      severity:   'high',
      issue_type: 'bug',
      status:     'submitted',
      current_page: '/bob-self-test',
      app_version:  'bob-autonomous-tester',
      auto_reported: true,
      admin_notified: false,
      browser_info: {
        userAgent: 'Bob RunPod Self-Test',
        scope: SCOPE,
        job_id: jobId,
        stats: { passed, failed, skipped },
        endpoint: rawBase,
        ran_at: timestamp,
      },
      ...(REPORTER_USER ? { user_id: REPORTER_USER, user_role: 'master' } : {}),
    };

    if (DRY_RUN) {
      console.log('[bob-self-test] DRY RUN — would file bug report:');
      console.log(JSON.stringify(bugReport, null, 2));
    } else {
      try {
        const res = await supabasePost('/bug_reports', bugReport, SERVICE_ROLE);
        if (res.status >= 200 && res.status < 300) {
          const id = (Array.isArray(res.data) ? res.data[0]?.id : res.data?.id) || '?';
          console.log(`[bob-self-test] Bug report filed: id=${id}`);
        } else {
          console.warn('[bob-self-test] Bug report insert failed:', res.status, JSON.stringify(res.data));
        }
      } catch (err) {
        console.warn('[bob-self-test] Could not file bug report:', err.message);
      }
    }
  } else if (!success) {
    console.warn('[bob-self-test] Tests failed but bug reporter context is incomplete (need VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SYNTHETIC_MONITOR_USER_ID) — skipping bug report');
  }

  // 5. Exit code
  process.exitCode = success ? 0 : 1;
  console.log(`[bob-self-test] Done — exit ${process.exitCode}`);
}

run().catch(err => {
  console.error('[bob-self-test] Fatal:', err);
  process.exit(1);
});
