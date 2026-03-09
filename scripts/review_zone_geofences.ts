import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
}

const DRY_RUN = process.env.DRY_RUN !== '0';
const REVIEW_MONTH = normalizeReviewMonth(process.env.REVIEW_MONTH);
const REVIEW_MONTH_KEY = REVIEW_MONTH.toISOString().slice(0, 10);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface ZoneRow {
  id: string;
  organization_id: string;
  name: string;
  zone_type: string | null;
  is_active: boolean;
  geometry: any;
  location_lat: number | null;
  location_lng: number | null;
  created_at: string;
  updated_at: string;
}

interface SnapshotRow {
  zone_id: string;
  snapshot_month: string;
  geometry_hash: string | null;
  quality_status: string;
}

interface ZoneQuality {
  qualityStatus: 'ok' | 'degraded';
  qualityReason: string | null;
  geometryType: string | null;
  geometryHash: string | null;
  metrics: Record<string, JsonValue>;
}

interface DriftInsert {
  organization_id: string;
  zone_id: string;
  status: string;
  event_type: 'geofence_new_zone' | 'geofence_boundary_change' | 'geofence_degraded_zone';
  review_month: string;
  metadata: Record<string, JsonValue>;
}

function normalizeReviewMonth(raw?: string): Date {
  const base = raw ? new Date(raw) : new Date();
  if (Number.isNaN(base.getTime())) {
    throw new Error(`Invalid REVIEW_MONTH value: ${raw}`);
  }
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
}

function previousMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item as JsonValue)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`).join(',')}}`;
}

function countCoordinates(node: any): number {
  if (!Array.isArray(node)) return 0;
  if (node.length === 0) return 0;

  if (typeof node[0] === 'number' && typeof node[1] === 'number') {
    return 1;
  }

  return node.reduce((sum: number, child: any) => sum + countCoordinates(child), 0);
}

function assessZoneGeometry(zone: ZoneRow): ZoneQuality {
  const geometry = zone.geometry;

  if (!geometry || typeof geometry !== 'object') {
    const hasPointFallback = zone.location_lat !== null && zone.location_lng !== null;
    if (hasPointFallback) {
      const fallbackGeom = {
        type: 'Point',
        coordinates: [zone.location_lng, zone.location_lat],
      };
      return {
        qualityStatus: 'ok',
        qualityReason: 'geometry_missing_using_location_point',
        geometryType: 'Point',
        geometryHash: createHash('sha256').update(stableStringify(fallbackGeom)).digest('hex'),
        metrics: {
          has_geometry: false,
          has_location_point: true,
          coordinate_count: 1,
        },
      };
    }

    return {
      qualityStatus: 'degraded',
      qualityReason: 'missing_geometry_and_location_point',
      geometryType: null,
      geometryHash: null,
      metrics: {
        has_geometry: false,
        has_location_point: false,
        coordinate_count: 0,
      },
    };
  }

  const geometryType = typeof geometry.type === 'string' ? geometry.type : null;
  const coordinateCount = countCoordinates(geometry.coordinates);

  if (!geometryType || coordinateCount === 0) {
    return {
      qualityStatus: 'degraded',
      qualityReason: 'malformed_geojson',
      geometryType,
      geometryHash: null,
      metrics: {
        has_geometry: true,
        coordinate_count: coordinateCount,
      },
    };
  }

  if (geometryType === 'Polygon' && coordinateCount < 4) {
    return {
      qualityStatus: 'degraded',
      qualityReason: 'polygon_too_few_vertices',
      geometryType,
      geometryHash: null,
      metrics: {
        has_geometry: true,
        coordinate_count: coordinateCount,
      },
    };
  }

  if (geometryType === 'MultiPolygon' && coordinateCount < 8) {
    return {
      qualityStatus: 'degraded',
      qualityReason: 'multipolygon_too_few_vertices',
      geometryType,
      geometryHash: null,
      metrics: {
        has_geometry: true,
        coordinate_count: coordinateCount,
      },
    };
  }

  const normalized = stableStringify(geometry as JsonValue);
  const geometryHash = createHash('sha256').update(normalized).digest('hex');

  return {
    qualityStatus: 'ok',
    qualityReason: null,
    geometryType,
    geometryHash,
    metrics: {
      has_geometry: true,
      coordinate_count: coordinateCount,
      geometry_type: geometryType,
    },
  };
}

async function fetchZones(): Promise<ZoneRow[]> {
  const { data, error } = await supabase
    .from('zones')
    .select('id, organization_id, name, zone_type, is_active, geometry, location_lat, location_lng, created_at, updated_at')
    .eq('is_active', true);

  if (error) throw new Error(`Failed to fetch zones: ${error.message}`);
  return (data || []) as ZoneRow[];
}

async function fetchSnapshots(monthIso: string): Promise<Map<string, SnapshotRow>> {
  const { data, error } = await supabase
    .from('zone_geofence_monthly_snapshots')
    .select('zone_id, snapshot_month, geometry_hash, quality_status')
    .eq('snapshot_month', monthIso);

  if (error) {
    if (/Could not find the table .*zone_geofence_monthly_snapshots/i.test(error.message)) {
      throw new Error(
        "Missing table public.zone_geofence_monthly_snapshots. Apply migration 20260324000001_geofence_monthly_review_and_drift.sql first."
      );
    }
    throw new Error(`Failed to fetch snapshots for ${monthIso}: ${error.message}`);
  }

  const map = new Map<string, SnapshotRow>();
  for (const row of data || []) {
    map.set((row as SnapshotRow).zone_id, row as SnapshotRow);
  }
  return map;
}

async function fetchExistingDrift(monthIso: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('drift_events')
    .select('zone_id, event_type')
    .eq('review_month', monthIso)
    .in('event_type', ['geofence_new_zone', 'geofence_boundary_change', 'geofence_degraded_zone']);

  if (error) {
    if (/column .*event_type.* does not exist|column .*review_month.* does not exist/i.test(error.message)) {
      throw new Error(
        "Missing drift_events geofence columns. Apply migration 20260324000001_geofence_monthly_review_and_drift.sql first."
      );
    }
    throw new Error(`Failed to fetch existing drift events: ${error.message}`);
  }

  const keys = new Set<string>();
  for (const row of data || []) {
    const r = row as { zone_id: string; event_type: string };
    keys.add(`${r.zone_id}::${r.event_type}`);
  }
  return keys;
}

async function upsertSnapshots(rows: any[]): Promise<void> {
  if (rows.length === 0 || DRY_RUN) return;

  const { error } = await supabase
    .from('zone_geofence_monthly_snapshots')
    .upsert(rows, { onConflict: 'zone_id,snapshot_month' });

  if (error) throw new Error(`Failed upserting snapshots: ${error.message}`);
}

async function insertDriftEvents(rows: DriftInsert[]): Promise<void> {
  if (rows.length === 0 || DRY_RUN) return;

  const { error } = await supabase
    .from('drift_events')
    .insert(rows);

  if (error) throw new Error(`Failed inserting drift events: ${error.message}`);
}

async function runMonthlyReview(): Promise<void> {
  console.log(`\n🛰️ Geofence monthly review (${DRY_RUN ? 'DRY RUN' : 'LIVE RUN'})`);
  console.log(`   Review month: ${REVIEW_MONTH_KEY}`);

  const prevMonth = previousMonth(REVIEW_MONTH);
  const prevMonthKey = prevMonth.toISOString().slice(0, 10);

  const zones = await fetchZones();
  console.log(`   Active zones loaded: ${zones.length}`);

  let previousSnapshots = new Map<string, SnapshotRow>();
  let existingDrift = new Set<string>();
  let migrationReady = true;

  try {
    previousSnapshots = await fetchSnapshots(prevMonthKey);
    existingDrift = await fetchExistingDrift(REVIEW_MONTH_KEY);
  } catch (error: any) {
    migrationReady = false;
    if (!DRY_RUN) {
      throw error;
    }
    console.warn(`   ⚠️ ${error.message}`);
    console.warn('   ⚠️ Continuing in dry-run preview mode without DB snapshot/drift reads.');
  }

  const snapshotRows: any[] = [];
  const driftRows: DriftInsert[] = [];

  let newZones = 0;
  let boundaryChanges = 0;
  let degradedZones = 0;

  for (const zone of zones) {
    const quality = assessZoneGeometry(zone);

    snapshotRows.push({
      zone_id: zone.id,
      organization_id: zone.organization_id,
      snapshot_month: REVIEW_MONTH_KEY,
      zone_name: zone.name,
      zone_type: zone.zone_type,
      geometry_type: quality.geometryType,
      geometry_hash: quality.geometryHash,
      quality_status: quality.qualityStatus,
      quality_reason: quality.qualityReason,
      quality_metrics: quality.metrics,
      source_updated_at: zone.updated_at,
    });

    const prev = previousSnapshots.get(zone.id);

    if (!prev) {
      const createdAt = new Date(zone.created_at).getTime();
      const monthStart = REVIEW_MONTH.getTime();
      // New-zone signal is scoped to zones created in this review month
      if (createdAt >= monthStart) {
        const key = `${zone.id}::geofence_new_zone`;
        if (!existingDrift.has(key)) {
          driftRows.push({
            organization_id: zone.organization_id,
            zone_id: zone.id,
            status: 'pending',
            event_type: 'geofence_new_zone',
            review_month: REVIEW_MONTH_KEY,
            metadata: {
              zone_name: zone.name,
              zone_type: zone.zone_type,
              reason: 'new_zone_created_in_review_month',
              source_updated_at: zone.updated_at,
            },
          });
          newZones++;
        }
      }
    } else {
      if (
        quality.geometryHash &&
        prev.geometry_hash &&
        quality.geometryHash !== prev.geometry_hash
      ) {
        const key = `${zone.id}::geofence_boundary_change`;
        if (!existingDrift.has(key)) {
          driftRows.push({
            organization_id: zone.organization_id,
            zone_id: zone.id,
            status: 'pending',
            event_type: 'geofence_boundary_change',
            review_month: REVIEW_MONTH_KEY,
            metadata: {
              zone_name: zone.name,
              previous_geometry_hash: prev.geometry_hash,
              current_geometry_hash: quality.geometryHash,
              source_updated_at: zone.updated_at,
            },
          });
          boundaryChanges++;
        }
      }

      if (prev.quality_status !== 'degraded' && quality.qualityStatus === 'degraded') {
        const key = `${zone.id}::geofence_degraded_zone`;
        if (!existingDrift.has(key)) {
          driftRows.push({
            organization_id: zone.organization_id,
            zone_id: zone.id,
            status: 'pending',
            event_type: 'geofence_degraded_zone',
            review_month: REVIEW_MONTH_KEY,
            metadata: {
              zone_name: zone.name,
              quality_reason: quality.qualityReason,
              quality_metrics: quality.metrics,
              source_updated_at: zone.updated_at,
            },
          });
          degradedZones++;
        }
      }
    }
  }

  if (migrationReady) {
    await upsertSnapshots(snapshotRows);
    await insertDriftEvents(driftRows);
  }

  console.log('\n📊 Geofence monthly review summary');
  console.log(`   Snapshot month:           ${REVIEW_MONTH_KEY}`);
  console.log(`   Previous snapshot month:  ${prevMonthKey}`);
  console.log(`   Snapshots to upsert:      ${snapshotRows.length}`);
  console.log(`   New-zone drift events:    ${newZones}`);
  console.log(`   Boundary-change events:   ${boundaryChanges}`);
  console.log(`   Degraded-zone events:     ${degradedZones}`);
  console.log(`   Total drift events:       ${driftRows.length}`);
  if (!migrationReady) {
    console.log('   Migration state:          pending (preview-only)');
  }

  if (DRY_RUN) {
    console.log('\nℹ️ Dry run only. No database rows were written.');
  }
}

runMonthlyReview()
  .then(() => {
    console.log('\n✅ Review complete.');
  })
  .catch((error) => {
    console.error('\n❌ Review failed:', error.message || error);
    process.exit(1);
  });
