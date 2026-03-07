import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Bulk Compliance Recalculation Edge Function (v2 – new observations schema)
 *
 * Recalculates is_compliant, breach_type, breach_reason directly on the
 * `observations` table in batches of 150.
 *
 * The old vehicle_observations_v2 and compliance_results tables were dropped in
 * 20260221_rebuild_observations_clean.sql. This function operates solely on the
 * new `observations` table and reads zone rules from `zone_compliance_matrix`
 * (falling back to the `zones` table when no matrix row exists).
 *
 * Accepts both the legacy frontend parameter format and the structured format:
 *   Legacy:     { organization_id?, zone_id?, date_from?, date_to? }
 *   Structured: { scope_type?, zone_ids?, organization_ids?,
 *                 date_range_start?, date_range_end? }
 */

const BATCH_SIZE = 150;

interface RecalculationRequest {
  // Legacy frontend params (ComplianceRecalculation.tsx)
  organization_id?: string;
  zone_id?: string;
  observation_id?: string;
  observation_ids?: string[];
  date_from?: string;
  date_to?: string;
  // Structured params
  scope_type?: 'ZONE' | 'ORG' | 'BUILD';
  zone_ids?: string[];
  organization_ids?: string[];
  date_range_start?: string;
  date_range_end?: string;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDayStartUtc(raw: string): string {
  return `${raw}T00:00:00.000Z`;
}

function toNextDayStartUtc(raw: string): string {
  const d = new Date(`${raw}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

interface RecalculationResult {
  action_id: string | null;
  observations_processed: number;
  compliance_changed: number;
  drift_events_created: number;
  duration_seconds: number;
  status: 'completed' | 'failed';
  error_message?: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user info from JWT
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify admin/master/admin_officer permissions
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'master', 'admin_officer'].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const request = await req.json() as RecalculationRequest;
    const startTime = Date.now();

    // ── Normalise parameters (support legacy and structured formats) ──────────

    // Date range
    const dateStartRaw = request.date_from || request.date_range_start;
    const dateEndRaw   = request.date_to   || request.date_range_end;
    const dateStart = dateStartRaw && DATE_ONLY_RE.test(dateStartRaw)
      ? toDayStartUtc(dateStartRaw)
      : dateStartRaw;
    const dateEndExclusive = dateEndRaw && DATE_ONLY_RE.test(dateEndRaw)
      ? toNextDayStartUtc(dateEndRaw)
      : null;
    const dateEndInclusive = dateEndRaw && !DATE_ONLY_RE.test(dateEndRaw)
      ? dateEndRaw
      : null;

    // Zone filter
    let zoneIdFilter: string[] = [];
    if (request.zone_id) {
      zoneIdFilter = [request.zone_id];
    } else if (request.zone_ids && request.zone_ids.length > 0) {
      zoneIdFilter = request.zone_ids;
    }

    // Direct observation filter
    let observationIdFilter: string[] = [];
    if (request.observation_id) {
      observationIdFilter = [request.observation_id];
    } else if (request.observation_ids && request.observation_ids.length > 0) {
      observationIdFilter = request.observation_ids;
    }

    // Organisation filter
    let orgIdFilter: string | null = null;
    if (request.organization_id) {
      orgIdFilter = request.organization_id;
    } else if (request.organization_ids && request.organization_ids.length > 0) {
      orgIdFilter = request.organization_ids[0];
    }

    // Non-master admins are always restricted to their own org
    if (profile.role !== 'master' && !orgIdFilter) {
      orgIdFilter = profile.organization_id;
    }

    // ── Create audit record (table may not exist in older deployments) ────────
    let actionId: string | null = null;
    try {
      const scopeType = request.scope_type
        || (zoneIdFilter.length > 0 ? 'ZONE' : orgIdFilter ? 'ORG' : 'BUILD');

      const { data: action } = await supabaseAdmin
        .from('admin_recalculation_actions')
        .insert({
          scope_type: scopeType,
          target_zone_ids: zoneIdFilter,
          target_org_ids: orgIdFilter ? [orgIdFilter] : [],
          date_range_start: dateStart || null,
          date_range_end: dateEnd || null,
          performed_by: user.id,
          status: 'running',
        })
        .select('id')
        .single();

      if (action) actionId = action.id;
    } catch (_auditErr) {
      // audit table may not exist in older deployments – proceed without it
      console.warn('admin_recalculation_actions table unavailable; running without audit record');
    }

    let observationsProcessed = 0;
    let complianceChanged     = 0;
    let updateErrors          = 0;

    try {
      // ── Pre-load zone compliance matrices (avoid N+1 per observation) ───────
      const { data: matrices } = await supabaseAdmin
        .from('zone_compliance_matrix')
        .select('zone_id, version, self_contained_required, requires_csc, nights_per_month, max_consecutive_nights, day_visit_only, allowed_days, homeless_exemption')
        .is('effective_to', null); // active versions only

      const matrixByZone: Record<string, any> = {};
      for (const m of (matrices ?? [])) {
        // Keep the highest version per zone
        if (!matrixByZone[m.zone_id] || m.version > matrixByZone[m.zone_id].version) {
          matrixByZone[m.zone_id] = m;
        }
      }

      // Fallback: load zone rules directly for zones that have no matrix row
      const { data: zones } = await supabaseAdmin
        .from('zones')
        .select('id, nights_per_month, max_consecutive_nights, self_contained_required, day_visit_only, allowed_days');

      const zoneById: Record<string, any> = {};
      for (const z of (zones ?? [])) {
        zoneById[z.id] = z;
      }

      // ── Pre-load homeless vehicles for exemption checks ───────────────────
      const { data: homelessVehicles } = await supabaseAdmin
        .from('canonical_vehicles')
        .select('plate_number')
        .eq('homeless_status', 'confirmed');

      const homelessPlates = new Set((homelessVehicles ?? []).map((v: any) => v.plate_number));

      // ── Build base observation filter ─────────────────────────────────────
      const buildQuery = () => {
        let q = supabaseAdmin
          .from('observations')
          .select('id, zone_id, organization_id, plate_number, recorded_at, is_compliant, breach_type, nights_stayed_this_month, consecutive_nights, self_contained')
          .is('deleted_at', null);

        if (zoneIdFilter.length > 0) q = q.in('zone_id', zoneIdFilter);
        if (observationIdFilter.length > 0) q = q.in('id', observationIdFilter);
        if (orgIdFilter)            q = q.eq('organization_id', orgIdFilter);
        if (dateStart)              q = q.gte('recorded_at', dateStart);
        if (dateEndExclusive)       q = q.lt('recorded_at', dateEndExclusive);
        if (dateEndInclusive)       q = q.lte('recorded_at', dateEndInclusive);

        return q;
      };

      // ── Process in batches of BATCH_SIZE ──────────────────────────────────
      let offset = 0;
      // Reuse a single Intl formatter for NZ timezone conversion (avoids re-creation per observation)
      const nzHourFormatter = new Intl.DateTimeFormat('en-NZ', {
        timeZone: 'Pacific/Auckland',
        hour: '2-digit',
        hour12: false,
      });

      while (true) {
        const { data: batch, error: batchError } = await buildQuery()
          .order('recorded_at', { ascending: true })
          .range(offset, offset + BATCH_SIZE - 1);

        if (batchError) {
          throw new Error(`Failed to fetch observation batch: ${batchError.message}`);
        }
        if (!batch || batch.length === 0) break;

        console.log(`Processing batch offset=${offset}, size=${batch.length}`);

        for (const obs of batch) {
          try {
            const rules = matrixByZone[obs.zone_id] ?? zoneById[obs.zone_id];

            if (!rules) {
              console.log(`No compliance rules for zone ${obs.zone_id}, skipping ${obs.id}`);
              continue;
            }

            const isHomeless = homelessPlates.has(obs.plate_number);

            let isCompliant  = true;
            let breachType: string | null  = null;
            let breachReason: string | null = null;

            // ── Day-visit-only zone check ─────────────────────────────────
            if (rules.day_visit_only) {
              const observedAt = new Date(obs.recorded_at);
              // Accurate NZ hour via pre-built Intl formatter (handles NZDT/NZST transitions)
              const nzHourStr = nzHourFormatter.format(observedAt);
              const nzHour = parseInt(nzHourStr, 10);

              if (nzHour >= 20 || nzHour < 8) {
                isCompliant  = false;
                breachType   = 'day_visit_violation';
                breachReason = `Night visit in day-only zone (observed at ${nzHourStr}:00 NZ time)`;
              }
            }

            // ── Monthly nights limit check ────────────────────────────────
            if (isCompliant && rules.nights_per_month != null) {
              const nightsStayed = obs.nights_stayed_this_month ?? 0;
              if (nightsStayed > rules.nights_per_month) {
                const exempt = isHomeless && rules.homeless_exemption;
                if (!exempt) {
                  isCompliant  = false;
                  breachType   = 'monthly_limit';
                  breachReason = `Exceeded monthly stay limit: ${nightsStayed} nights this month, limit is ${rules.nights_per_month}`;
                }
              }
            }

            // ── Consecutive nights limit check ────────────────────────────
            if (isCompliant && rules.max_consecutive_nights != null) {
              const consecutive = obs.consecutive_nights ?? 0;
              if (consecutive > rules.max_consecutive_nights) {
                const exempt = isHomeless && rules.homeless_exemption;
                if (!exempt) {
                  isCompliant  = false;
                  breachType   = 'consecutive_nights';
                  breachReason = `Exceeded consecutive nights limit: ${consecutive} consecutive nights, limit is ${rules.max_consecutive_nights}`;
                }
              }
            }

            // ── Self-contained / CSC check ────────────────────────────────
            if (isCompliant && (rules.self_contained_required || rules.requires_csc)) {
              if (!obs.self_contained) {
                const exempt = isHomeless && rules.homeless_exemption;
                if (!exempt) {
                  isCompliant  = false;
                  breachType   = 'self_contained';
                  breachReason = 'Zone requires a self-contained vehicle; no valid CSC on record';
                }
              }
            }

            const complianceWouldChange = (obs.is_compliant ?? true) !== isCompliant;

            // Update the observation
            const { error: updateError } = await supabaseAdmin
              .from('observations')
              .update({
                is_compliant:  isCompliant,
                breach_type:   breachType,
                breach_reason: breachReason,
              })
              .eq('id', obs.id);

            if (updateError) {
              updateErrors++;
              console.error(`Failed to update observation ${obs.id}:`, updateError.message);
            } else {
              observationsProcessed++;
              if (complianceWouldChange) {
                complianceChanged++;
              }
            }
          } catch (obsErr: any) {
            console.error(`Error processing observation ${obs.id}:`, obsErr.message ?? obsErr);
          }
        }

        if (batch.length < BATCH_SIZE) break;
        offset += BATCH_SIZE;
      }

      if (updateErrors > 0) {
        throw new Error(`Recalculation completed with ${updateErrors} observation update errors`);
      }

      const duration = Math.round((Date.now() - startTime) / 1000);

      // ── Update audit record ───────────────────────────────────────────────
      if (actionId) {
        await supabaseAdmin
          .from('admin_recalculation_actions')
          .update({
            observations_processed: observationsProcessed,
            compliance_changed:     complianceChanged,
            drift_events_created:   0,
            status:                 'completed',
            completed_at:           new Date().toISOString(),
            duration_seconds:       duration,
          })
          .eq('id', actionId);
      }

      const result: RecalculationResult = {
        action_id:              actionId,
        observations_processed: observationsProcessed,
        compliance_changed:     complianceChanged,
        drift_events_created:   0,
        duration_seconds:       duration,
        status:                 'completed',
      };

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error: any) {
      const duration = Math.round((Date.now() - startTime) / 1000);

      if (actionId) {
        await supabaseAdmin
          .from('admin_recalculation_actions')
          .update({
            status:          'failed',
            error_message:   error.message,
            completed_at:    new Date().toISOString(),
            duration_seconds: duration,
          })
          .eq('id', actionId);
      }

      throw error;
    }

  } catch (error: any) {
    console.error('Recalculation error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Recalculation failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
