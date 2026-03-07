import { createClient } from '@supabase/supabase-js';

type JsonGeometry = {
  type: string;
  coordinates?: any;
  radius?: number;
};

type Zone = {
  id: string;
  name: string;
  organization_id: string;
  geometry: JsonGeometry | null;
  location_lat: number | null;
  location_lng: number | null;
  is_active: boolean;
};

type ObservationV2 = {
  observation_id: string;
  zone_id: string;
  organization_id: string;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
};

type UpdatePayload = {
  zone_id?: string;
  gps_latitude?: number;
  gps_longitude?: number;
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 500);
const MAX_ROWS = Number(process.env.MAX_ROWS || 0);
const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';
const PROXIMITY_THRESHOLD_METERS = Number(process.env.PROXIMITY_THRESHOLD_METERS || 500);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function toRadians(v: number): number {
  return (v * Math.PI) / 180;
}

function calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function isPointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInGeometry(lat: number, lng: number, geometry: JsonGeometry | null): boolean {
  if (!geometry) return false;

  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const [centerLng, centerLat] = geometry.coordinates;
    const radius = Number(geometry.radius || 100);
    return calculateDistanceMeters(lat, lng, centerLat, centerLng) <= radius;
  }

  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates?.[0])) {
    return isPointInRing(lat, lng, geometry.coordinates[0]);
  }

  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    for (const poly of geometry.coordinates) {
      if (Array.isArray(poly?.[0]) && isPointInRing(lat, lng, poly[0])) {
        return true;
      }
    }
  }

  return false;
}

function ringCentroid(ring: number[][]): { lat: number; lng: number } | null {
  if (!Array.isArray(ring) || ring.length === 0) return null;

  let sumLng = 0;
  let sumLat = 0;
  let count = 0;

  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (!Array.isArray(p) || p.length < 2) continue;
    sumLng += Number(p[0]);
    sumLat += Number(p[1]);
    count++;
  }

  if (count === 0) return null;
  return { lng: sumLng / count, lat: sumLat / count };
}

function geometryCentroid(geometry: JsonGeometry | null): { lat: number; lng: number } | null {
  if (!geometry) return null;

  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    return { lng: Number(geometry.coordinates[0]), lat: Number(geometry.coordinates[1]) };
  }

  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates?.[0])) {
    return ringCentroid(geometry.coordinates[0]);
  }

  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates?.[0]?.[0])) {
    return ringCentroid(geometry.coordinates[0][0]);
  }

  return null;
}

function zoneLogicalPoint(zone: Zone): { lat: number; lng: number } | null {
  const centroid = geometryCentroid(zone.geometry);
  if (centroid) return centroid;

  if (zone.location_lat != null && zone.location_lng != null) {
    return { lat: Number(zone.location_lat), lng: Number(zone.location_lng) };
  }

  return null;
}

function closestZone(lat: number, lng: number, zones: Zone[]): Zone | null {
  let best: Zone | null = null;
  let bestDistance = Infinity;

  for (const zone of zones) {
    const p = zoneLogicalPoint(zone);
    if (!p) continue;

    const d = calculateDistanceMeters(lat, lng, p.lat, p.lng);
    if (d < bestDistance && d <= PROXIMITY_THRESHOLD_METERS) {
      bestDistance = d;
      best = zone;
    }
  }

  return best;
}

async function fetchActiveZones(): Promise<Zone[]> {
  const { data, error } = await supabase
    .from('zones')
    .select('id, name, organization_id, geometry, location_lat, location_lng, is_active')
    .eq('is_active', true);

  if (error) throw error;
  return (data || []) as Zone[];
}

async function fetchObservationBatch(offset: number): Promise<ObservationV2[]> {
  let query = supabase
    .from('vehicle_observations_v2')
    .select('observation_id, zone_id, organization_id, gps_latitude, gps_longitude, gps_accuracy')
    .order('recorded_at', { ascending: true })
    .range(offset, offset + BATCH_SIZE - 1);

  if (MAX_ROWS > 0) {
    const upper = Math.min(offset + BATCH_SIZE - 1, MAX_ROWS - 1);
    query = query.range(offset, upper);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ObservationV2[];
}

async function updateObservation(observationId: string, payload: UpdatePayload): Promise<void> {
  if (DRY_RUN) return;

  const { error } = await supabase
    .from('vehicle_observations_v2')
    .update(payload)
    .eq('observation_id', observationId);

  if (error) throw error;
}

async function main() {
  console.log('Starting observation-zone reconciliation...');
  console.log(`dry_run=${DRY_RUN} batch_size=${BATCH_SIZE} max_rows=${MAX_ROWS || 'ALL'}`);

  const zones = await fetchActiveZones();
  const zonesByOrg = new Map<string, Zone[]>();
  const zoneById = new Map<string, Zone>();

  for (const z of zones) {
    zoneById.set(z.id, z);
    const current = zonesByOrg.get(z.organization_id) || [];
    current.push(z);
    zonesByOrg.set(z.organization_id, current);
  }

  let offset = 0;
  let scanned = 0;
  let updatedZone = 0;
  let backfilledGps = 0;
  let updatedBoth = 0;
  let unchanged = 0;
  let skippedNoLogicalPoint = 0;

  while (true) {
    const rows = await fetchObservationBatch(offset);
    if (rows.length === 0) break;

    for (const obs of rows) {
      scanned++;

      const orgZones = zonesByOrg.get(obs.organization_id) || [];
      if (orgZones.length === 0) {
        unchanged++;
        continue;
      }

      const currentZone = zoneById.get(obs.zone_id);
      let lat = obs.gps_latitude != null ? Number(obs.gps_latitude) : null;
      let lng = obs.gps_longitude != null ? Number(obs.gps_longitude) : null;
      let derivedGps = false;

      if (lat == null || lng == null) {
        if (!currentZone) {
          skippedNoLogicalPoint++;
          continue;
        }

        const p = zoneLogicalPoint(currentZone);
        if (!p) {
          skippedNoLogicalPoint++;
          continue;
        }

        lat = p.lat;
        lng = p.lng;
        derivedGps = true;
      }

      let targetZone: Zone | null = null;

      if (currentZone && isPointInGeometry(lat, lng, currentZone.geometry)) {
        targetZone = currentZone;
      } else {
        for (const zone of orgZones) {
          if (isPointInGeometry(lat, lng, zone.geometry)) {
            targetZone = zone;
            break;
          }
        }

        if (!targetZone) {
          targetZone = closestZone(lat, lng, orgZones);
        }

        if (!targetZone && currentZone) {
          targetZone = currentZone;
        }
      }

      const payload: UpdatePayload = {};

      if (derivedGps && lat != null && lng != null) {
        payload.gps_latitude = lat;
        payload.gps_longitude = lng;
      }

      if (targetZone && targetZone.id !== obs.zone_id) {
        payload.zone_id = targetZone.id;
      }

      if (Object.keys(payload).length === 0) {
        unchanged++;
        continue;
      }

      await updateObservation(obs.observation_id, payload);

      const zoneChanged = payload.zone_id != null;
      const gpsChanged = payload.gps_latitude != null && payload.gps_longitude != null;

      if (zoneChanged && gpsChanged) {
        updatedBoth++;
      } else if (zoneChanged) {
        updatedZone++;
      } else if (gpsChanged) {
        backfilledGps++;
      }
    }

    offset += rows.length;
    if (MAX_ROWS > 0 && offset >= MAX_ROWS) break;
    console.log(`Processed ${offset} observations...`);
  }

  console.log('Reconciliation complete');
  console.log(JSON.stringify({
    scanned,
    updated_zone: updatedZone,
    backfilled_gps: backfilledGps,
    updated_both: updatedBoth,
    unchanged,
    skipped_no_logical_point: skippedNoLogicalPoint,
    dry_run: DRY_RUN,
  }, null, 2));
}

main().catch((err) => {
  console.error('Fatal error:', err?.message || err);
  process.exit(1);
});
