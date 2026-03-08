#!/usr/bin/env bun

/**
 * Verify compliance outcomes by homeless category for observations since a date.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 * Optional env vars:
 *   DATE_FROM=2025-12-01T00:00:00Z
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATE_FROM = process.env.DATE_FROM || '2025-12-01T00:00:00Z';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

async function fetchAll(pathWithQuery) {
  const rows = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const sep = pathWithQuery.includes('?') ? '&' : '?';
    const url = `${SUPABASE_URL}${pathWithQuery}${sep}limit=${pageSize}&offset=${offset}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Request failed (${res.status}): ${url}\n${await res.text()}`);
    }

    const data = await res.json();
    rows.push(...data);

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function toCategory(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'confirmed') return 'confirmed';
  if (s === 'claimed') return 'claimed';
  if (s === 'declined') return 'declined';
  return 'freedom_camper';
}

async function main() {
  const observations = await fetchAll(
    `/rest/v1/observations?select=plate_number,is_compliant,recorded_at&recorded_at=gte.${encodeURIComponent(DATE_FROM)}`
  );

  const uniquePlates = [...new Set(observations.map((o) => o.plate_number).filter(Boolean))];

  const homelessStatusByPlate = new Map();
  for (let i = 0; i < uniquePlates.length; i += 200) {
    const chunk = uniquePlates.slice(i, i + 200);
    const inList = chunk.map((p) => `"${String(p).replace(/"/g, '')}"`).join(',');

    const vehicles = await fetchAll(
      `/rest/v1/canonical_vehicles?select=plate_number,homeless_status&plate_number=in.(${encodeURIComponent(inList)})`
    );

    for (const row of vehicles) {
      homelessStatusByPlate.set(row.plate_number, row.homeless_status);
    }
  }

  const summary = {
    confirmed: { total: 0, compliant: 0, non_compliant: 0 },
    claimed: { total: 0, compliant: 0, non_compliant: 0 },
    declined: { total: 0, compliant: 0, non_compliant: 0 },
    freedom_camper: { total: 0, compliant: 0, non_compliant: 0 },
  };

  for (const obs of observations) {
    const category = toCategory(homelessStatusByPlate.get(obs.plate_number));
    summary[category].total += 1;

    if (obs.is_compliant) summary[category].compliant += 1;
    else summary[category].non_compliant += 1;
  }

  console.log(
    JSON.stringify(
      {
        date_from: DATE_FROM,
        observations: observations.length,
        by_homeless_category: summary,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
