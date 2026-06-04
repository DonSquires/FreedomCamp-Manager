#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['\"]|['\"]$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

function parseArgs(argv) {
  const args = {
    out: '',
    format: 'env',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    const next = String(argv[i + 1] || '');
    if (token === '--out' && next) args.out = next;
    if (token.startsWith('--out=')) args.out = token.slice('--out='.length);
    if (token === '--format' && next) args.format = next;
    if (token.startsWith('--format=')) args.format = token.slice('--format='.length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  loadEnvFile(path.join(repoRoot, '.env'));
  loadEnvFile(path.join(repoRoot, '.env.local'));
  loadEnvFile(path.join(repoRoot, '.env.playwright.local'));

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error('Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket },
  });

  const stamp = Date.now();
  const defaultPassword = process.env.E2E_TEMP_PASSWORD || process.env.PLAYWRIGHT_MASTER_PASSWORD || 'Run2thesun??';
  const masterEmail = process.env.PLAYWRIGHT_MASTER_EMAIL || process.env.TEST_OWNER_EMAIL || 'squires.don@live.com';

  const { data: masterRow } = await supabase
    .from('user_profiles')
    .select('organization_id, employer_organization_id')
    .eq('email', masterEmail)
    .maybeSingle();

  const orgId = masterRow?.organization_id || masterRow?.employer_organization_id;
  if (!orgId) {
    throw new Error(`Could not resolve organization id from master profile: ${masterEmail}`);
  }

  const personas = [
    ['PLAYWRIGHT_ADMIN_ORG1_EMAIL', 'PLAYWRIGHT_ADMIN_ORG1_PASSWORD', 'admin', 'admin_org1'],
    ['PLAYWRIGHT_ADMIN_ORG2_EMAIL', 'PLAYWRIGHT_ADMIN_ORG2_PASSWORD', 'admin', 'admin_org2'],
    ['PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'officer', 'officer_org1'],
    ['PLAYWRIGHT_CLIENT_VIEWER_EMAIL', 'PLAYWRIGHT_CLIENT_VIEWER_PASSWORD', 'client_viewer', 'client_viewer'],
    ['PLAYWRIGHT_CLIENT_STAFF_EMAIL', 'PLAYWRIGHT_CLIENT_STAFF_PASSWORD', 'client_admin', 'client_staff'],
    ['PLAYWRIGHT_BOB_ADMIN_OFFICER_EMAIL', 'PLAYWRIGHT_BOB_ADMIN_OFFICER_PASSWORD', 'admin_officer', 'bob_admin_officer'],
    ['PLAYWRIGHT_BOB_GRAND_MASTER_EMAIL', 'PLAYWRIGHT_BOB_GRAND_MASTER_PASSWORD', 'grand_master', 'bob_grand_master'],
  ];

  const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);
  const existingByEmail = new Map((listed?.users || []).map((u) => [String(u.email || '').toLowerCase(), u]));
  const reuseConfiguredEmails = String(process.env.PLAYWRIGHT_SEED_USE_CONFIGURED_EMAILS || '').trim() === '1';

  async function resolveIsolatedPersonaEmail(preferredEmail, label) {
    const generated = `e2e.${label}.${stamp}@example.test`;
    if (!reuseConfiguredEmails) return generated;

    const candidate = String(preferredEmail || '').trim().toLowerCase();
    const normalizedMaster = String(masterEmail || '').trim().toLowerCase();

    if (!candidate) return generated;
    if (candidate === normalizedMaster) return generated;

    const { data: profileRow } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('email', candidate)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const existingRole = String(profileRow?.role || '').trim().toLowerCase();
    if (existingRole === 'master' || existingRole === 'grand_master') {
      return generated;
    }

    return candidate;
  }

  const envPairs = [];
  const summary = [];

  for (const [emailVar, passVar, role, label] of personas) {
    const email = await resolveIsolatedPersonaEmail(process.env[emailVar], label);
    const password = process.env[passVar] || defaultPassword;

    const existing = existingByEmail.get(String(email).toLowerCase());
    let userId = existing?.id;

    if (!userId) {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { source: 'seed-e2e-personas', label },
      });
      if (createErr) throw new Error(`createUser failed for ${label}: ${createErr.message}`);
      userId = created.user.id;
      summary.push({ label, email, action: 'created' });
    } else {
      const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, { password, email_confirm: true });
      if (updateErr) throw new Error(`updateUser failed for ${label}: ${updateErr.message}`);
      summary.push({ label, email, action: 'updated' });
    }

    const profile = {
      id: userId,
      email,
      role,
      organization_id: orgId,
      employer_organization_id: orgId,
      is_active: true,
      first_name: 'E2E',
      last_name: label,
      enabled_portals: ['dispatch', 'roster', 'patrol'],
      portal_access: ['dispatch', 'roster', 'patrol-schedule', 'client-sites'],
      extra_organization_ids: [],
    };
    const { error: profileErr } = await supabase.from('user_profiles').upsert(profile, { onConflict: 'id' });
    if (profileErr) throw new Error(`profile upsert failed for ${label}: ${profileErr.message}`);

    envPairs.push([emailVar, email]);
    envPairs.push([passVar, password]);
  }

  const bobAdminEmail = envPairs.find(([k]) => k === 'PLAYWRIGHT_BOB_ADMIN_OFFICER_EMAIL')?.[1];
  const bobAdminPass = envPairs.find(([k]) => k === 'PLAYWRIGHT_BOB_ADMIN_OFFICER_PASSWORD')?.[1];
  const gmEmail = envPairs.find(([k]) => k === 'PLAYWRIGHT_BOB_GRAND_MASTER_EMAIL')?.[1];
  const gmPass = envPairs.find(([k]) => k === 'PLAYWRIGHT_BOB_GRAND_MASTER_PASSWORD')?.[1];
  if (bobAdminEmail) envPairs.push(['PLAYWRIGHT_BOB_EMAIL', bobAdminEmail]);
  if (bobAdminPass) envPairs.push(['PLAYWRIGHT_BOB_PASSWORD', bobAdminPass]);
  if (gmEmail) envPairs.push(['PLAYWRIGHT_GRANDMASTER_EMAIL', gmEmail]);
  if (gmPass) envPairs.push(['PLAYWRIGHT_GRANDMASTER_PASSWORD', gmPass]);

  const lines = envPairs.map(([k, v]) => `${k}=${String(v).replace(/\n/g, '')}`);
  const output = lines.join('\n') + '\n';

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, output, 'utf8');
  } else {
    process.stdout.write(output);
  }

  console.error(JSON.stringify({ seeded: summary.length, orgId, summary }, null, 2));
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
