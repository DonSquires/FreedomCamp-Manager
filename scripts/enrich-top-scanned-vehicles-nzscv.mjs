#!/usr/bin/env node

/**
 * Enrich most-scanned vehicles with NZSCV payload data.
 *
 * Flow:
 * 1) Auth as a temporary user (signup enabled in this project)
 * 2) Fetch top-N vehicles from canonical_vehicles by total_observations
 * 3) Call check-nzscv-status for each plate to persist full NZSCV payload
 *
 * Usage:
 *   TOP_N=100 CONCURRENCY=3 node scripts/enrich-top-scanned-vehicles-nzscv.mjs
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://kxwjcupuxnnbnzcgmkoi.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TOP_N = Number(process.env.TOP_N || '100');
const CONCURRENCY = Number(process.env.CONCURRENCY || '3');

if (!SUPABASE_ANON_KEY) {
  console.error('Missing VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

async function signupAndGetToken() {
  const email = `apitest_${Date.now()}@example.com`;
  const password = 'TempPass123!';

  const resp = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  const body = await resp.json();
  const token = body?.session?.access_token || body?.access_token || null;
  if (!token) {
    throw new Error(`Failed to obtain token via signup (${resp.status})`);
  }
  return token;
}

function authHeaders(token) {
  return {
    'content-type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
  };
}

async function fetchTopPlates(token) {
  const url = `${SUPABASE_URL}/rest/v1/canonical_vehicles?select=plate_number,total_observations&order=total_observations.desc.nullslast&limit=${TOP_N}`;
  const resp = await fetch(url, { headers: authHeaders(token) });
  const text = await resp.text();

  if (!resp.ok) {
    throw new Error(`Failed to fetch top vehicles (${resp.status}): ${text}`);
  }

  const rows = JSON.parse(text);
  const banned = new Set([
    'PROCESSING...',
    'MANUAL_REQUIRED',
    'UNKNOWN',
    'NO_PLATE',
    'UNREADABLE',
    'N/A',
    'NULL',
  ]);

  function isLikelyPlate(raw) {
    if (!raw) return false;
    const plate = String(raw).toUpperCase().trim();
    if (banned.has(plate)) return false;
    // NZ-style plates are typically alphanumeric without punctuation.
    // Accept a broad 2-8 length range to avoid over-filtering valid variants.
    return /^[A-Z0-9]{2,8}$/.test(plate);
  }

  return rows
    .filter((r) => isLikelyPlate(r?.plate_number))
    .map((r) => ({
      plate: String(r.plate_number).toUpperCase().trim(),
      totalObservations: Number(r.total_observations || 0),
    }));
}

async function checkPlate(token, plate) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/check-nzscv-status`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ plate_number: plate }),
  });

  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  return {
    status: resp.status,
    body,
  };
}

async function runPool(items, worker, concurrency) {
  const queue = [...items];
  const out = [];

  async function runner() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      out.push(await worker(item));
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => runner()));
  return out;
}

async function main() {
  console.log(`Starting NZSCV enrichment for top ${TOP_N} scanned vehicles...`);

  const token = await signupAndGetToken();
  const topPlates = await fetchTopPlates(token);

  console.log(`Fetched ${topPlates.length} plates. Calling check-nzscv-status...`);

  let processed = 0;
  const results = await runPool(
    topPlates,
    async (row) => {
      const res = await checkPlate(token, row.plate);
      processed += 1;
      if (processed % 10 === 0 || processed === topPlates.length) {
        console.log(`Progress: ${processed}/${topPlates.length}`);
      }
      return {
        plate: row.plate,
        totalObservations: row.totalObservations,
        ...res,
      };
    },
    CONCURRENCY
  );

  const success = results.filter((r) => r.status === 200).length;
  const found = results.filter((r) => r.status === 200 && r.body?.found === true).length;
  const notFound = results.filter((r) => r.status === 200 && r.body?.found === false).length;
  const errors = results.filter((r) => r.status !== 200).length;

  const withVin = results.filter((r) => r.body?.result?.vin).length;
  const withIssueDate = results.filter((r) => r.body?.result?.issue_date).length;
  const withMaxOccupants = results.filter((r) => r.body?.result?.max_occupants != null).length;
  const withLogo = results.filter((r) => r.body?.logo_url).length;

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    topNRequested: TOP_N,
    processed: results.length,
    success,
    found,
    notFound,
    errors,
    enrichedFields: {
      withVin,
      withIssueDate,
      withMaxOccupants,
      withLogo,
    },
  }, null, 2));

  const sample = results.slice(0, 5).map((r) => ({
    plate: r.plate,
    totalObservations: r.totalObservations,
    status: r.status,
    found: r.body?.found,
    selfContained: r.body?.result?.is_self_contained,
    certificateStatus: r.body?.result?.certificate_status || r.body?.result?.status || null,
    issueDate: r.body?.result?.issue_date || null,
    vin: r.body?.result?.vin || null,
    maxOccupants: r.body?.result?.max_occupants ?? null,
  }));

  console.log('\n=== SAMPLE (first 5) ===');
  console.log(JSON.stringify(sample, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
