import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = String(process.env.APPLY || 'false').toLowerCase() === 'true';
// Default to full-scope reconciliation so all zones are covered unless explicitly limited.
const LEGACY_ONLY = String(process.env.LEGACY_ONLY || 'false').toLowerCase() === 'true';
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : null;
const UPDATE_RECORDED_BY = String(process.env.UPDATE_RECORDED_BY || 'false').toLowerCase() === 'true';
const RECORDED_BY = process.env.RECORDED_BY || null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log('Starting observations reassignment...');
  console.log(
    `apply=${APPLY} legacy_only=${LEGACY_ONLY} limit=${LIMIT ?? 'ALL'} ` +
      `update_recorded_by=${UPDATE_RECORDED_BY} recorded_by=${RECORDED_BY ?? 'NULL'}`
  );

  if (LEGACY_ONLY) {
    console.log('Scope is limited to legacy imports only. Set LEGACY_ONLY=false to process all zones.');
  }

  const { data, error } = await supabase.rpc('reassign_observations_to_current_zones', {
    p_apply: APPLY,
    p_legacy_only: LEGACY_ONLY,
    p_limit: LIMIT,
    p_update_recorded_by: UPDATE_RECORDED_BY,
    p_recorded_by: RECORDED_BY,
  });

  if (error) {
    throw error;
  }

  const summary = Array.isArray(data) && data.length > 0 ? data[0] : data;

  console.log('Reassignment function complete');
  console.log(JSON.stringify(summary, null, 2));

  if (!APPLY) {
    console.log('Dry run only. Set APPLY=true to persist updates.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err?.message || err);
  process.exit(1);
});
