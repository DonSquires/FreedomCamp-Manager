#!/usr/bin/env node

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

function tsStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function login(baseUrl, anonKey, email, password) {
  const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function authedGet(baseUrl, anonKey, token, restPath) {
  const res = await fetch(`${baseUrl}${restPath}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function authedPost(baseUrl, anonKey, token, fnPath, data) {
  const res = await fetch(`${baseUrl}/functions/v1/${fnPath}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  return { status: res.status, text };
}

function loadMapRouteCoverage(repoRoot) {
  const matrixPath = path.join(repoRoot, 'tools/route-role-matrix/route-role-matrix.json');
  if (!fs.existsSync(matrixPath)) return { totalMapGeoZoneRoutes: 0, routes: [] };
  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  const routes = (matrix.routes || []).filter((r) => {
    const p = String(r.path || '').toLowerCase();
    return p.includes('map') || p.includes('geo') || p.includes('zone');
  });
  return {
    totalMapGeoZoneRoutes: routes.length,
    routes: routes.map((r) => ({ path: r.path, roles: r.roles || [] })),
  };
}

async function main() {
  const repoRoot = process.cwd();
  loadEnvFile(path.join(repoRoot, '.env'));
  loadEnvFile(path.join(repoRoot, '.env.local'));
  loadEnvFile(path.join(repoRoot, '.env.playwright.local'));

  const baseUrl = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = String(process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();

  if (!baseUrl || !anonKey) {
    console.error('Missing SUPABASE URL/ANON KEY env vars.');
    process.exit(1);
  }

  const personaSlots = [
    { slot: 'master', emailVar: 'PLAYWRIGHT_MASTER_EMAIL', passVar: 'PLAYWRIGHT_MASTER_PASSWORD', allowedRoles: ['master', 'grand_master'] },
    { slot: 'admin_org1', emailVar: 'PLAYWRIGHT_ADMIN_ORG1_EMAIL', passVar: 'PLAYWRIGHT_ADMIN_ORG1_PASSWORD', allowedRoles: ['admin', 'admin_officer'] },
    { slot: 'admin_org2', emailVar: 'PLAYWRIGHT_ADMIN_ORG2_EMAIL', passVar: 'PLAYWRIGHT_ADMIN_ORG2_PASSWORD', allowedRoles: ['admin', 'admin_officer'] },
    { slot: 'officer_org1', emailVar: 'PLAYWRIGHT_OFFICER_ORG1_EMAIL', passVar: 'PLAYWRIGHT_OFFICER_ORG1_PASSWORD', allowedRoles: ['officer'] },
    { slot: 'client_viewer', emailVar: 'PLAYWRIGHT_CLIENT_VIEWER_EMAIL', passVar: 'PLAYWRIGHT_CLIENT_VIEWER_PASSWORD', allowedRoles: ['client_viewer'] },
    { slot: 'client_staff', emailVar: 'PLAYWRIGHT_CLIENT_STAFF_EMAIL', passVar: 'PLAYWRIGHT_CLIENT_STAFF_PASSWORD', allowedRoles: ['client_officer', 'client_admin', 'admin_officer'] },
    { slot: 'bob_admin_officer', emailVar: 'PLAYWRIGHT_BOB_ADMIN_OFFICER_EMAIL', passVar: 'PLAYWRIGHT_BOB_ADMIN_OFFICER_PASSWORD', allowedRoles: ['admin_officer'] },
    { slot: 'bob_grand_master', emailVar: 'PLAYWRIGHT_BOB_GRAND_MASTER_EMAIL', passVar: 'PLAYWRIGHT_BOB_GRAND_MASTER_PASSWORD', allowedRoles: ['grand_master'] },
  ];

  const results = [];

  for (const p of personaSlots) {
    const email = String(process.env[p.emailVar] || '').trim();
    const password = String(process.env[p.passVar] || '').trim();

    if (!email || !password) {
      results.push({
        slot: p.slot,
        email,
        status: 'missing-credentials',
      });
      continue;
    }

    const auth = await login(baseUrl, anonKey, email, password);
    if (!auth.ok || !auth.body?.access_token) {
      results.push({
        slot: p.slot,
        email,
        status: 'auth-failed',
        authStatus: auth.status,
      });
      continue;
    }

    const token = String(auth.body.access_token);
    const uid = String(auth.body.user?.id || '');

    const profileRes = await authedGet(
      baseUrl,
      anonKey,
      token,
      `/rest/v1/user_profiles?select=id,email,role,organization_id&id=eq.${encodeURIComponent(uid)}&limit=1`
    );
    const profile = JSON.parse(profileRes.text || '[]')[0] || null;
    const role = profile?.role || null;
    const rolePass = role ? p.allowedRoles.includes(role) : false;

    const zonesRes = await authedGet(
      baseUrl,
      anonKey,
      token,
      '/rest/v1/zones?select=id&limit=5'
    );
    let zonesCount = null;
    try {
      const z = JSON.parse(zonesRes.text || '[]');
      zonesCount = Array.isArray(z) ? z.length : null;
    } catch {
      zonesCount = null;
    }

    const radioRes = await authedPost(baseUrl, anonKey, token, 'radio-session-grant', {
      channelScope: `org:${p.slot}:${Date.now()}`,
    });

    results.push({
      slot: p.slot,
      email,
      status: 'ok',
      profileRole: role,
      rolePass,
      profileStatus: profileRes.status,
      zonesStatus: zonesRes.status,
      zonesCount,
      radioSessionGrantStatus: radioRes.status,
    });
  }

  const coverage = loadMapRouteCoverage(repoRoot);

  const report = {
    checkedAt: new Date().toISOString(),
    supabaseBaseUrl: baseUrl,
    personaResults: results,
    mapRouteCoverage: coverage,
    summary: {
      personaSlots: results.length,
      authOk: results.filter((r) => r.status === 'ok').length,
      rolePass: results.filter((r) => r.status === 'ok' && r.rolePass).length,
      missingCredentials: results.filter((r) => r.status === 'missing-credentials').length,
      authFailed: results.filter((r) => r.status === 'auth-failed').length,
      totalMapGeoZoneRoutes: coverage.totalMapGeoZoneRoutes,
    },
  };

  const outDir = path.join(repoRoot, 'data/e2e-test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `no-browser-role-map-audit-${tsStamp()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`report: ${outPath}`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
