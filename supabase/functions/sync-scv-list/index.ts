/**
 * SYNC SCV LIST
 *
 * Syncs SCV status using client-supplied SCV entries,
 * compares them against canonical_vehicles, and updates records accordingly.
 *
 * For vehicles found in the list with "Current" status:
 *   - Sets self_contained = true
 *   - Calculates and sets self_contained_expiry (issue date + 4 years − 1 day)
 *   - Sets nzscv_source = 'scv_list', nzscv_last_checked = file date
 *   - Updates observations.self_contained = true for that plate
 *   - Resolves any pending 'self_contained' breach_alerts for that plate
 *
 * For canonical vehicles NOT in the list:
 *   - Sets self_contained = false, self_contained_expiry = null
 *   (only if they were previously marked as self_contained = true)
 *
 * POST body (all optional):
 *   dry_run   boolean  — if true, only report what would change (no DB writes)
 *   file_date string   — ISO timestamp to stamp as nzscv_last_checked (default: 2026-02-17T00:00:00Z)
 *   scv_current_entries array — [{ plate_number, expiry }] for Current SCV vehicles
 *   scv_total_in_list number  — total Current vehicles in source list
 *   offset    number   — canonical_vehicles pagination offset (default: 0)
 *   batch_size number  — canonical_vehicles page size, max 1000 (default: 500)
 *   include_related_updates boolean — if true, also update observations and breach_alerts (default: false)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface SyncResult {
  total_in_scv_list: number;
  canonical_vehicles_checked: number;
  set_to_current: number;
  set_to_not_current: number;
  expiry_corrected: number;
  unchanged: number;
  observations_updated: number;
  breach_alerts_resolved: number;
  canonical_scv_enriched: number;
  errors: string[];
}

interface BatchMeta {
  offset: number;
  batch_size: number;
  processed: number;
  total_canonical_vehicles: number | null;
  next_offset: number | null;
  has_more: boolean;
  batch_number: number;
  total_batches: number | null;
}

interface ScvCurrentEntry {
  plate_number: string;
  expiry: string | null;
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function normalizeBearerToken(rawAuthHeader: string | null): string | null {
  if (!rawAuthHeader) return null;
  const match = rawAuthHeader.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;
  return match[1].trim();
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseBatchNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

/**
 * Parse an NZ date string "DD/MM/YYYY" into ISO date "YYYY-MM-DD".
 * Returns null if the string is invalid.
 */
function parseNZDateToISO(s: string): string | null {
  if (!s) return null;
  const parts = s.trim().split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy || yyyy.length !== 4) return null;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/**
 * NZ CSC certificates expire exactly 4 years from issue date, minus 1 day.
 * e.g. issued 2024-10-21 → expires 2028-10-20
 */
function calculateExpiry(issueDateStr: string): string | null {
  const iso = parseNZDateToISO(issueDateStr);
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 4);
  d.setUTCDate(d.getUTCDate() - 1);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const token = normalizeBearerToken(req.headers.get('Authorization'));
    if (!token) return json(401, { error: 'Missing bearer token' });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    let authUserId: string | null = null;
    const jwtPayload = parseJwtPayload(token);
    if (typeof jwtPayload?.sub === 'string' && jwtPayload.sub.length > 0) {
      authUserId = jwtPayload.sub;
    }

    if (!authUserId) {
      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (!authError && authData?.user?.id) {
        authUserId = authData.user.id;
      }
    }

    if (!authUserId) {
      return json(401, { error: 'Unauthorized' });
    }

    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', authUserId)
      .single();

    if (profileError || !userProfile) {
      return json(403, { error: 'Unable to resolve user role' });
    }

    if (!['admin', 'master'].includes(userProfile.role)) {
      return json(403, { error: 'Insufficient permissions — admin or master role required' });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body.dry_run === true;
    const includeRelatedUpdates: boolean = body.include_related_updates === true;
    const fileDate: string = body.file_date ?? '2026-02-17T00:00:00Z';
    const offset = parseBatchNumber(body.offset, 0);
    const batchSize = Math.min(1000, Math.max(1, parseBatchNumber(body.batch_size, 500)));
    const scvCurrentEntries: ScvCurrentEntry[] = Array.isArray(body.scv_current_entries)
      ? body.scv_current_entries
      : [];
    const scvTotalInList = parseBatchNumber(body.scv_total_in_list, 0);

    if (scvCurrentEntries.length === 0) {
      return json(400, {
        error: 'Missing scv_current_entries. Please update client to pre-parse SCV list.',
      });
    }

    const result: SyncResult = {
      total_in_scv_list: 0,
      canonical_vehicles_checked: 0,
      set_to_current: 0,
      set_to_not_current: 0,
      expiry_corrected: 0,
      unchanged: 0,
      observations_updated: 0,
      breach_alerts_resolved: 0,
      canonical_scv_enriched: 0,
      errors: [],
    };

    // ── Step 1: Load a canonical_vehicles batch ─────────────────────────────

    const { data: canonicalVehicleRows, error: cvError } = await supabaseAdmin
      .from('canonical_vehicles')
      .select('plate_number, self_contained, self_contained_expiry, nzscv_source')
      .order('plate_number', { ascending: true })
      .range(offset, offset + batchSize);

    if (cvError) {
      return json(500, { error: `Failed to fetch canonical vehicles: ${cvError.message}` });
    }

    const canonicalVehicles = (canonicalVehicleRows ?? []).slice(0, batchSize);
    result.canonical_vehicles_checked = canonicalVehicles.length;

    const processed = offset + result.canonical_vehicles_checked;
    const hasMore = (canonicalVehicleRows?.length ?? 0) > batchSize;
    const batch: BatchMeta = {
      offset,
      batch_size: batchSize,
      processed,
      total_canonical_vehicles: null,
      next_offset: hasMore ? processed : null,
      has_more: hasMore,
      batch_number: result.canonical_vehicles_checked === 0 && offset === 0 ? 0 : Math.floor(offset / batchSize) + 1,
      total_batches: null,
    };

    // ── Step 2: Build SCV lookup from client-supplied entries ───────────────

    type ScvEntry = { expiry: string | null };
    const scvMap: Map<string, ScvEntry> = new Map();

    for (const entry of scvCurrentEntries) {
      const plate = String(entry?.plate_number ?? '').trim().toUpperCase();
      if (!plate) continue;
      scvMap.set(plate, { expiry: entry?.expiry ?? null });
    }
    result.total_in_scv_list = scvTotalInList || scvMap.size;

    // ── Step 3: Classify changes ─────────────────────────────────────────────

    // Plates that are moving true → true (expiry updated) or false → true
    const toSetCurrent: string[] = [];
    // Plates that are moving true → false
    const toSetNotCurrent: string[] = [];

    type CanonicalUpdate = {
      plate_number: string;
      self_contained: boolean;
      self_contained_expiry: string | null;
      nzscv_source: string;
      nzscv_last_checked: string;
      updated_at: string;
    };

    type CanonicalScvUpdate = {
      plate_number: string;
      is_self_contained: boolean;
      certificate_expiry: string | null;
      source: string;
      verified_at: string;
      updated_at: string;
    };

    const updateBatch: CanonicalUpdate[] = [];
    const canonicalScvUpdateBatch: CanonicalScvUpdate[] = [];
    const nowIso = new Date().toISOString();

    for (const cv of canonicalVehicles ?? []) {
      const plate = (cv.plate_number ?? '').trim().toUpperCase();
      const scvEntry = scvMap.get(plate);
      const isCurrent = !!scvEntry;
      const expectedExpiry = scvEntry?.expiry ?? null;

      if (isCurrent) {
        // Vehicle is confirmed self-contained in the SCV list
        const alreadyTrue = cv.self_contained === true;
        const expiryMatches = cv.self_contained_expiry === expectedExpiry;

        if (alreadyTrue && expiryMatches) {
          result.unchanged++;
        } else {
          updateBatch.push({
            plate_number: plate,
            self_contained: true,
            self_contained_expiry: expectedExpiry,
            nzscv_source: 'scv_list',
            nzscv_last_checked: fileDate,
            updated_at: nowIso,
          });

          if (!alreadyTrue) {
            toSetCurrent.push(plate);
            result.set_to_current++;
          } else {
            // Was already true but expiry was wrong/missing
            result.expiry_corrected++;
          }
        }

        canonicalScvUpdateBatch.push({
          plate_number: plate,
          is_self_contained: true,
          certificate_expiry: expectedExpiry,
          source: 'scv_list',
          verified_at: fileDate,
          updated_at: nowIso,
        });
      } else {
        // Vehicle is not in the SCV list (or status is not Current)
        if (cv.self_contained === true) {
          updateBatch.push({
            plate_number: plate,
            self_contained: false,
            self_contained_expiry: null,
            nzscv_source: 'scv_list',
            nzscv_last_checked: fileDate,
            updated_at: nowIso,
          });
          toSetNotCurrent.push(plate);
          result.set_to_not_current++;
        } else {
          result.unchanged++;
        }

        canonicalScvUpdateBatch.push({
          plate_number: plate,
          is_self_contained: false,
          certificate_expiry: null,
          source: 'scv_list',
          verified_at: fileDate,
          updated_at: nowIso,
        });
      }
    }

    // Count how many SCV-list entries will be directly upserted to canonical_scv.
    // Only on the first batch call so the dry-run response also reports this number.
    if (offset === 0) {
      result.canonical_scv_enriched = scvCurrentEntries.length;
    }

    // ── Dry-run early return ─────────────────────────────────────────────────

    if (dryRun) {
      return json(200, {
        dry_run: true,
        result,
        batch,
        sample_set_to_current: toSetCurrent.slice(0, 20),
        sample_set_to_not_current: toSetNotCurrent.slice(0, 20),
      });
    }

    // ── Step 4: Apply canonical_vehicles updates (batched) ───────────────────

    const BATCH_SIZE = 50;

    for (let i = 0; i < updateBatch.length; i += BATCH_SIZE) {
      const chunk = updateBatch.slice(i, i + BATCH_SIZE);
      const { error } = await supabaseAdmin
        .from('canonical_vehicles')
        .upsert(chunk, { onConflict: 'plate_number' });
      if (error) {
        result.errors.push(`canonical update batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
      }
    }

    // Keep canonical_scv in sync as explicit SCV source of truth.
    for (let i = 0; i < canonicalScvUpdateBatch.length; i += BATCH_SIZE) {
      const chunk = canonicalScvUpdateBatch.slice(i, i + BATCH_SIZE);
      const { error } = await supabaseAdmin
        .from('canonical_scv')
        .upsert(chunk, { onConflict: 'plate_number' });
      if (error) {
        result.errors.push(`canonical_scv update batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
      }
    }

    // ── Step 4b: Direct canonical_scv enrichment from the full SCV list ──────
    // Upsert ALL SCV-certified plates from scvCurrentEntries into canonical_scv
    // so the table reflects the complete NZSCV registry, not just plates that
    // already exist in canonical_vehicles.
    // Only runs on the first batch (offset === 0) to avoid redundant writes.
    if (offset === 0 && scvCurrentEntries.length > 0) {
      const DIRECT_BATCH_SIZE = 200;
      for (let i = 0; i < scvCurrentEntries.length; i += DIRECT_BATCH_SIZE) {
        const chunk = scvCurrentEntries.slice(i, i + DIRECT_BATCH_SIZE);
        const scvRows: CanonicalScvUpdate[] = [];
        for (const entry of chunk) {
          const plate = String(entry?.plate_number ?? '').trim().toUpperCase();
          if (!plate) continue;
          scvRows.push({
            plate_number: plate,
            is_self_contained: true,
            certificate_expiry: entry.expiry ?? null,
            source: 'scv_list',
            verified_at: fileDate,
            updated_at: nowIso,
          });
        }
        if (scvRows.length > 0) {
          const { error } = await supabaseAdmin
            .from('canonical_scv')
            .upsert(scvRows, { onConflict: 'plate_number' });
          if (error) {
            result.errors.push(`canonical_scv list enrichment batch ${Math.floor(i / DIRECT_BATCH_SIZE)}: ${error.message}`);
          }
        }
      }
    }

    // ── Step 5: Fix observations.self_contained for newly-confirmed plates ───
    // When a plate moves from false → true in canonical_vehicles, existing
    // observations that inherited self_contained=false are now incorrect.

    if (includeRelatedUpdates && toSetCurrent.length > 0) {
      for (let i = 0; i < toSetCurrent.length; i += BATCH_SIZE) {
        const chunk = toSetCurrent.slice(i, i + BATCH_SIZE);
        const { error } = await supabaseAdmin
          .from('observations')
          .update({ self_contained: true })
          .in('plate_number', chunk)
          .eq('self_contained', false);
        if (error) {
          result.errors.push(`obs update batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
        }
      }

      // Use an upper-bound estimate without expensive count queries.
      result.observations_updated = toSetCurrent.length;
    }

    // ── Step 6: Resolve incorrect CSC breach_alerts ──────────────────────────
    // Any pending/acknowledged/enforcement_started breach alert for a plate
    // that is now confirmed self-contained should be resolved.

    if (includeRelatedUpdates && toSetCurrent.length > 0) {
      const resolvedNote =
        `CSC verified via SCV list sync (${new Date(fileDate).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' })})`;

      for (let i = 0; i < toSetCurrent.length; i += BATCH_SIZE) {
        const chunk = toSetCurrent.slice(i, i + BATCH_SIZE);
        const { error } = await supabaseAdmin
          .from('breach_alerts')
          .update({
            status: 'resolved',
            resolution_notes: resolvedNote,
            resolved_at: nowIso,
          })
          .in('plate_number', chunk)
          .in('status', ['pending', 'acknowledged', 'enforcement_started'])
          .eq('breach_type', 'self_contained');

        if (error) {
          result.errors.push(`breach_alert resolve batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
        }
      }

      // Use an upper-bound estimate without expensive count queries.
      result.breach_alerts_resolved = toSetCurrent.length;
    }

    return json(200, {
      success: true,
      dry_run: false,
      include_related_updates: includeRelatedUpdates,
      result,
      batch,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(500, { error: msg });
  }
});
