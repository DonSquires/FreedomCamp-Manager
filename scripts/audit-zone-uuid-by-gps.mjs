#!/usr/bin/env bun

/**
 * Audit observation.zone_id against zone geofence match from GPS coordinates.
 *
 * Matching rules (per organization):
 * 1) Polygon zones (geometry.type = 'Polygon', excluding 'Other Location').
 * 2) Circle zones (geometry.type = 'Point' + radius, excluding 'Other Location').
 *
 * If multiple polygons match, the smallest polygon area is preferred.
 * If multiple circles match, the smallest radius is preferred.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function polygonAreaApprox(coords) {
  // Shoelace area in lon/lat degrees; only for relative comparison.
  if (!Array.isArray(coords) || coords.length < 3) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < coords.length; i += 1) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[(i + 1) % coords.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function pointInPolygon(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi;

    if (intersects) inside = !inside;
  }
  return inside;
}

async function fetchAll(pathWithQuery) {
  const rows = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const sep = pathWithQuery.includes('?') ? '&' : '?';
    const url = `${SUPABASE_URL}${pathWithQuery}${sep}limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Fetch failed (${res.status}) ${url}\n${body}`);
    }
    const data = await res.json();
    rows.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function normalizeZoneBuckets(zones) {
  const byOrg = new Map();

  for (const z of zones) {
    if (!z.organization_id || !z.geometry || !z.is_active) continue;

    const org = byOrg.get(z.organization_id) || { polygons: [], circles: [], byId: new Map() };
    org.byId.set(z.id, z);

    if (z.name === 'Other Location') {
      byOrg.set(z.organization_id, org);
      continue;
    }

    const type = z.geometry?.type;
    if (type === 'Polygon') {
      const ring = z.geometry?.coordinates?.[0];
      if (Array.isArray(ring) && ring.length >= 3) {
        org.polygons.push({
          id: z.id,
          name: z.name,
          ring,
          area: polygonAreaApprox(ring),
        });
      }
    }

    if (type === 'Point') {
      const lng = Number(z.geometry?.coordinates?.[0]);
      const lat = Number(z.geometry?.coordinates?.[1]);
      const radius = Number(z.geometry?.radius ?? 100);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radius)) {
        org.circles.push({ id: z.id, name: z.name, lat, lng, radius });
      }
    }

    byOrg.set(z.organization_id, org);
  }

  for (const [, org] of byOrg) {
    org.polygons.sort((a, b) => a.area - b.area);
    org.circles.sort((a, b) => a.radius - b.radius);
  }

  return byOrg;
}

function expectedZoneIdForObservation(obs, orgZones) {
  if (!orgZones) return null;

  const lat = Number(obs.gps_latitude);
  const lon = Number(obs.gps_longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  for (const p of orgZones.polygons) {
    if (pointInPolygon(lat, lon, p.ring)) return p.id;
  }

  for (const c of orgZones.circles) {
    if (haversineMeters(lat, lon, c.lat, c.lng) <= c.radius) return c.id;
  }

  return null;
}

async function main() {
  console.log('Loading active zones with geometry...');
  const zones = await fetchAll(
    '/rest/v1/zones?select=id,organization_id,name,is_active,geometry&is_active=eq.true&geometry=not.is.null'
  );

  console.log('Loading observations with GPS + zone assignment...');
  const observations = await fetchAll(
    '/rest/v1/observations?select=observation_id,organization_id,zone_id,gps_latitude,gps_longitude&gps_latitude=not.is.null&gps_longitude=not.is.null'
  );

  const zonesByOrg = normalizeZoneBuckets(zones);

  let matchedByGps = 0;
  let mismatches = 0;
  let same = 0;
  let noGpsMatch = 0;

  const examples = [];

  for (const obs of observations) {
    const orgZones = zonesByOrg.get(obs.organization_id);
    const expected = expectedZoneIdForObservation(obs, orgZones);

    if (!expected) {
      noGpsMatch += 1;
      continue;
    }

    matchedByGps += 1;
    if (obs.zone_id === expected) {
      same += 1;
      continue;
    }

    mismatches += 1;
    if (examples.length < 20) {
      const zoneNameCurrent = orgZones?.byId?.get(obs.zone_id)?.name || null;
      const zoneNameExpected = orgZones?.byId?.get(expected)?.name || null;
      examples.push({
        observation_id: obs.observation_id,
        organization_id: obs.organization_id,
        current_zone_id: obs.zone_id,
        current_zone_name: zoneNameCurrent,
        expected_zone_id: expected,
        expected_zone_name: zoneNameExpected,
        gps_latitude: obs.gps_latitude,
        gps_longitude: obs.gps_longitude,
      });
    }
  }

  const report = {
    totals: {
      observations_with_gps: observations.length,
      matched_by_gps_geofence: matchedByGps,
      matched_same_zone_uuid: same,
      mismatched_zone_uuid: mismatches,
      no_geofence_match: noGpsMatch,
    },
    mismatch_rate_of_gps_matches: matchedByGps > 0 ? Number(((mismatches / matchedByGps) * 100).toFixed(2)) : 0,
    sample_mismatches: examples,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('Audit failed:', err?.message || err);
  process.exit(1);
});
