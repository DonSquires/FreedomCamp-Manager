#!/usr/bin/env node

import process from 'node:process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const isCodespaces = String(process.env.CODESPACES || '').toLowerCase() === 'true';

const bobUrl = String(
  process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || ''
)
  .trim()
  .replace(/\/+$/, '');

const bobApiKey = String(
  process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || ''
).trim();

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
  status('BOB/INFERENCE URL', Boolean(bobUrl));
  status('BOB/INFERENCE API key', Boolean(bobApiKey));
  status('Org context header source', Boolean(orgId), orgId ? 'x-org-id will be sent' : 'optional but recommended');
  status('SUPABASE URL', Boolean(supabaseUrl));
  status('SUPABASE SERVICE ROLE', Boolean(supabaseServiceRole));

  const ollama = await probe('http://localhost:11434/api/tags');
  status(
    'Local Ollama localhost:11434',
    ollama.ok,
    ollama.ok ? `HTTP ${ollama.status}` : ollama.error || `HTTP ${ollama.status}`
  );

  if (bobUrl) {
    const health = await probe(`${bobUrl}/health`, {
      headers: bobApiKey
        ? {
            'x-inference-api-key': bobApiKey,
            Authorization: `Bearer ${bobApiKey}`,
          }
        : {},
    });

    status(
      'Bob service /health',
      health.ok,
      health.ok ? `HTTP ${health.status}` : health.error || `HTTP ${health.status}`
    );

    if (bobApiKey) {
      const headers = {
        'Content-Type': 'application/json',
        'x-inference-api-key': bobApiKey,
        Authorization: `Bearer ${bobApiKey}`,
      };
      if (orgId) headers['x-org-id'] = orgId;

      const chat = await probe(
        `${bobUrl}/chat`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ message: 'diagnostic ping' }),
        },
        12000
      );

      status(
        'Bob service /chat auth',
        chat.ok,
        chat.ok ? `HTTP ${chat.status}` : chat.error || `HTTP ${chat.status}`
      );
    }
  }

  console.log('\nRequired Codespaces secrets to set:');
  console.log('- BOB_SERVICE_URL (or INFERENCE_SERVICE_URL)');
  console.log('- BOB_INFERENCE_API_KEY (or INFERENCE_API_KEY)');
  console.log('- BOB_ORG_ID (or ORG_ID) for multi-tenant context');
  console.log('- SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (for admin/ops scripts)');
}

main().catch((error) => {
  console.error('Doctor failed:', error?.message || error);
  process.exit(1);
});
