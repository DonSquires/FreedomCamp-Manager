import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
}

const DRY_RUN = process.env.DRY_RUN !== '0';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface ZoneRow {
  id: string;
  organization_id: string;
  name: string;
  zone_type: string | null;
  created_at: string | null;
  is_active: boolean | null;
}

interface MergePlan {
  key: string;
  keepId: string;
  keepName: string;
  keepObsCount: number;
  mergeIds: string[];
}

const ZONE_ID_TABLES = [
  'observations',
  'breach_alerts',
  'patrols',
  'patrol_checkpoints',
  'zone_compliance_matrix',
  'enforcement_actions',
  'health_safety_reports',
  'incidents',
  'investigation_jobs',
  'drift_events',
  'plate_scans',
  'zone_legal_config',
  'notices_to_vacate',
  'person_observations',
  'infringement_notices',
  'vehicle_observations',
  'vehicle_records',
  'compliance_results',
] as const;

function normalizeZoneName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function zoneSortKey(zone: ZoneRow, obsCount: number): [number, number, number, string] {
  const activeRank = zone.is_active ? 1 : 0;
  const createdAtMs = zone.created_at ? new Date(zone.created_at).getTime() : Number.MAX_SAFE_INTEGER;
  // Sort DESC obs, DESC active, ASC created_at, ASC id
  return [obsCount, activeRank, -createdAtMs, zone.id];
}

async function fetchZones(): Promise<ZoneRow[]> {
  const { data, error } = await supabase
    .from('zones')
    .select('id, organization_id, name, zone_type, created_at, is_active')
    .eq('zone_type', 'specific');

  if (error) throw new Error(`Failed to fetch zones: ${error.message}`);
  return (data || []) as ZoneRow[];
}

async function fetchObservationCounts(zoneIds: string[]): Promise<Map<string, number>> {
  const countMap = new Map<string, number>();
  if (zoneIds.length === 0) return countMap;

  const chunkSize = 200;
  for (let i = 0; i < zoneIds.length; i += chunkSize) {
    const chunk = zoneIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('observations')
      .select('zone_id')
      .in('zone_id', chunk);

    if (error) {
      throw new Error(`Failed to fetch observation counts: ${error.message}`);
    }

    for (const row of data || []) {
      const zoneId = (row as any).zone_id as string;
      countMap.set(zoneId, (countMap.get(zoneId) || 0) + 1);
    }
  }

  return countMap;
}

async function countRefs(table: string, zoneId: string, column: 'zone_id' | 'parent_zone_id'): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select(column, { count: 'exact', head: true })
    .eq(column, zoneId);

  if (error) {
    if (/does not exist|column .* does not exist/i.test(error.message)) {
      return 0;
    }
    throw new Error(`Count failed for ${table}.${column}: ${error.message}`);
  }

  return count || 0;
}

async function updateRefs(table: string, fromZoneId: string, toZoneId: string, column: 'zone_id' | 'parent_zone_id'): Promise<number> {
  const refCount = await countRefs(table, fromZoneId, column);
  if (refCount === 0) return 0;

  if (DRY_RUN) return refCount;

  const { error } = await supabase
    .from(table)
    .update({ [column]: toZoneId } as any)
    .eq(column, fromZoneId);

  if (error) {
    throw new Error(`Update failed for ${table}.${column}: ${error.message}`);
  }

  return refCount;
}

async function findDuplicatePlans(zones: ZoneRow[]): Promise<MergePlan[]> {
  const byGroup = new Map<string, ZoneRow[]>();

  for (const zone of zones) {
    const key = `${zone.organization_id}::${normalizeZoneName(zone.name)}`;
    const arr = byGroup.get(key) || [];
    arr.push(zone);
    byGroup.set(key, arr);
  }

  const plans: MergePlan[] = [];

  for (const [key, group] of byGroup.entries()) {
    if (group.length < 2) continue;

    const obsMap = await fetchObservationCounts(group.map((z) => z.id));
    const sorted = [...group].sort((a, b) => {
      const aKey = zoneSortKey(a, obsMap.get(a.id) || 0);
      const bKey = zoneSortKey(b, obsMap.get(b.id) || 0);

      // obs DESC
      if (aKey[0] !== bKey[0]) return bKey[0] - aKey[0];
      // active DESC
      if (aKey[1] !== bKey[1]) return bKey[1] - aKey[1];
      // created ASC (stored as negative for helper)
      if (aKey[2] !== bKey[2]) return bKey[2] - aKey[2];
      // id ASC
      return aKey[3].localeCompare(bKey[3]);
    });

    const keep = sorted[0];
    const keepObsCount = obsMap.get(keep.id) || 0;
    const mergeIds = sorted.slice(1).map((z) => z.id);

    plans.push({
      key,
      keepId: keep.id,
      keepName: keep.name,
      keepObsCount,
      mergeIds,
    });
  }

  return plans;
}

async function mergeDuplicateZones(): Promise<void> {
  console.log(`\n🧹 Zone dedupe start (${DRY_RUN ? 'DRY RUN' : 'LIVE RUN'})`);

  const zones = await fetchZones();
  console.log(`   Loaded ${zones.length} specific zones.`);

  const plans = await findDuplicatePlans(zones);
  if (plans.length === 0) {
    console.log('✅ No duplicate specific-zone names found by organization.');
    return;
  }

  console.log(`   Found ${plans.length} duplicate groups to merge.`);

  let groupsProcessed = 0;
  let zoneIdsMerged = 0;
  let refsMoved = 0;
  let deleted = 0;
  let deactivated = 0;

  for (const plan of plans) {
    groupsProcessed++;
    console.log(`\n[${groupsProcessed}/${plans.length}] ${plan.key}`);
    console.log(`   Keep: ${plan.keepName} (${plan.keepId}) observations=${plan.keepObsCount}`);

    for (const mergeId of plan.mergeIds) {
      console.log(`   Merge from: ${mergeId}`);
      zoneIdsMerged++;

      for (const table of ZONE_ID_TABLES) {
        const moved = await updateRefs(table, mergeId, plan.keepId, 'zone_id');
        if (moved > 0) {
          refsMoved += moved;
          console.log(`      ${table}.zone_id -> moved ${moved}`);
        }
      }

      const parentMoved = await updateRefs('zones', mergeId, plan.keepId, 'parent_zone_id');
      if (parentMoved > 0) {
        refsMoved += parentMoved;
        console.log(`      zones.parent_zone_id -> moved ${parentMoved}`);
      }

      if (DRY_RUN) {
        continue;
      }

      const { error: deleteError } = await supabase
        .from('zones')
        .delete()
        .eq('id', mergeId);

      if (!deleteError) {
        deleted++;
        console.log('      deleted duplicate zone');
        continue;
      }

      const { error: deactivateError } = await supabase
        .from('zones')
        .update({ is_active: false })
        .eq('id', mergeId);

      if (deactivateError) {
        console.warn(`      ⚠️ delete failed (${deleteError.message}) and deactivate failed (${deactivateError.message})`);
      } else {
        deactivated++;
        console.warn(`      ⚠️ delete blocked (${deleteError.message}); zone deactivated instead`);
      }
    }
  }

  console.log('\n📊 Zone dedupe summary');
  console.log(`   Groups processed:  ${groupsProcessed}`);
  console.log(`   Duplicate zone ids: ${zoneIdsMerged}`);
  console.log(`   References moved:   ${refsMoved}`);
  if (!DRY_RUN) {
    console.log(`   Zones deleted:      ${deleted}`);
    console.log(`   Zones deactivated:  ${deactivated}`);
  }
}

mergeDuplicateZones()
  .then(() => {
    console.log('\n✅ Done.');
  })
  .catch((error) => {
    console.error('\n❌ Merge failed:', error.message || error);
    process.exit(1);
  });
