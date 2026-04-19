#!/usr/bin/env node

import process from 'node:process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const isCodespaces = String(process.env.CODESPACES || '').toLowerCase() === 'true';

const runpodUrl = String(
  process.env.RUNPOD_GATEWAY_URL ||
    process.env.RUNPOD_SERVERLESS_URL ||
    process.env.RUNPOD_URL ||
    'https://api.runpod.ai/v2/apynoxmf9eiyzd/runsync'
)
  .trim()
  .replace(/\/+$/, '');

const runpodApiKey = String(process.env.RUNPOD_API_KEY || process.env.DR_BOB_API || '').trim();

const orgId = String(
  process.env.BOB_ORG_ID || process.env.ORG_ID || process.env.DEFAULT_ORG_ID || ''
).trim();

const supabaseUrl = String(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
).trim();

const supabaseServiceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

function status(name, ok, detail = '') {
  const icon = ok ? 'OK  ' : 'MISS';
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${icon} ${name}${suffix}`);
}

async function probe(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text().catch(() => '');
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log('Bob Codespaces Doctor');
  console.log('---------------------');

  status('CODESPACES flag', isCodespaces, isCodespaces ? 'true' : 'not true');
  status('RunPod runsync URL', Boolean(runpodUrl));
  status('RUNPOD_API_KEY', Boolean(runpodApiKey));
  status('Org context header source', Boolean(orgId), orgId ? 'x-org-id will be sent' : 'optional but recommended');
  status('SUPABASE URL', Boolean(supabaseUrl));
  status('SUPABASE SERVICE ROLE', Boolean(supabaseServiceRole));

  if (runpodUrl && runpodApiKey) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runpodApiKey}`,
    };
    if (orgId) headers['x-org-id'] = orgId;

    const ping = await probe(
      runpodUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ input: { action: 'ping' } }),
      },
      15000
    );

    let detail = ping.ok ? `HTTP ${ping.status}` : ping.error || `HTTP ${ping.status}`;
    if (ping.ok && ping.text) {
      try {
        const parsed = JSON.parse(ping.text);
        const msg =
          parsed?.output?.message ||
          parsed?.message ||
          parsed?.status ||
          '';
        if (msg) detail = `HTTP ${ping.status} (${String(msg).slice(0, 80)})`;
      } catch {
        // Keep generic HTTP detail when response is not JSON.
      }
    }

    status('RunPod runsync ping', ping.ok, detail);
  }

  console.log('\nRequired Codespaces secrets to set:');
  console.log('- RUNPOD_API_KEY (or DR_BOB_API)');
  console.log('- RUNPOD_GATEWAY_URL (or RUNPOD_SERVERLESS_URL, optional override for the runsync endpoint)');
  console.log('- BOB_ORG_ID (or ORG_ID) for multi-tenant context');
  console.log('- SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (for admin/ops scripts)');
}

main().catch((error) => {
  console.error('Doctor failed:', error?.message || error);
  process.exit(1);
});
