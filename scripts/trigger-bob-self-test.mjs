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
 *   BOB_SELF_TEST_TIMEOUT_MS   max poll time in ms  (default: 600000 = 10 min)
 *   BOB_SELF_TEST_POLL_MS      poll interval         (default: 5000)
 *   BOB_SELF_TEST_DRY_RUN      true = skip Supabase write, just print
 *   SYNTHETIC_MONITOR_USER_ID  reporter UUID for bug_reports (optional)
 *
 * Usage:
 *   node scripts/trigger-bob-self-test.mjs
 *   node scripts/trigger-bob-self-test.mjs --scope core
 *   node scripts/trigger-bob-self-test.mjs --dryRun
 */

import https from 'node:https';
import http from 'node:http';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

// ─── Load local .env ─────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
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

// ─── Config ───────────────────────────────────────────────────────────────────
const SCOPE        = getArg('scope', process.env.BOB_SELF_TEST_SCOPE || 'quick');
const TIMEOUT_MS   = Number(process.env.BOB_SELF_TEST_TIMEOUT_MS || 600000);
const POLL_MS      = Number(process.env.BOB_SELF_TEST_POLL_MS || 5000);
const DRY_RUN      = getBoolArg('dryRun') || process.env.BOB_SELF_TEST_DRY_RUN === 'true';

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

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  const startedAt = new Date().toISOString();
  console.log(`[bob-self-test] scope=${SCOPE} endpoint=${rawBase} dryRun=${DRY_RUN}`);

  // 1. Submit job
  const submitUrl = `${rawBase}/run`;
  const REPO_URL    = process.env.GITHUB_REPO_URL    || 'https://github.com/DonSquires/FreedomCamp-Manager.git';
  const REPO_BRANCH = process.env.GITHUB_REPO_BRANCH || 'main';
  const REPO_TOKEN  = process.env.BOB_WORKER_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';

  const payload = {
    input: {
      action:      'run_playwright',
      scope:       SCOPE,
      timeout_ms:  Math.max(TIMEOUT_MS - 60000, 60000),
      reporter:    'json',
      // Repo clone — Bob will git clone/pull this before running tests
      repo_url:    REPO_URL,
      repo_branch: REPO_BRANCH,
      ...(REPO_TOKEN ? { repo_token: REPO_TOKEN } : {}),
      // Pass Supabase creds so Bob can write .env for tests
      ...(process.env.VITE_SUPABASE_URL        ? { VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL }           : {}),
      ...(process.env.VITE_SUPABASE_ANON_KEY   ? { VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY } : {}),
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
  const pollUrl      = `${rawBase}/status/${jobId}`;
  const deadline     = Date.now() + TIMEOUT_MS;
  let   outputData   = null;

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const pollRes = await reqJson(pollUrl);
    const status  = String(pollRes.data?.status || '').toUpperCase();
    console.log(`[bob-self-test] poll status=${status}`);

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
    console.error(`[bob-self-test] Timed out waiting for job ${jobId}`);
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

  // 4. Post bug report to Supabase if failures found
  if (!success && SUPABASE_URL && SERVICE_ROLE) {
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
    console.warn('[bob-self-test] Tests failed but VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — skipping bug report');
  }

  // 5. Exit code
  process.exitCode = success ? 0 : 1;
  console.log(`[bob-self-test] Done — exit ${process.exitCode}`);
}

run().catch(err => {
  console.error('[bob-self-test] Fatal:', err);
  process.exit(1);
});
