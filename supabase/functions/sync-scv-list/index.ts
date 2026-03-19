/**
 * SYNC SCV LIST
 *
 * Reads the NZSCV Self-Contained Vehicle Excel list from Supabase Storage,
 * compares it against canonical_vehicles, and updates records accordingly.
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
 *   scv_url   string   — override storage URL for the Excel file
 *   offset    number   — canonical_vehicles pagination offset (default: 0)
 *   batch_size number  — canonical_vehicles page size, max 1000 (default: 500)
 *   include_related_updates boolean — if true, also update observations and breach_alerts (default: false)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import * as XLSX from 'npm:xlsx';

interface SyncResult {
  total_in_scv_list: number;
  canonical_vehicles_checked: number;
  set_to_current: number;
  set_to_not_current: number;
  expiry_corrected: number;
  unchanged: number;
  observations_updated: number;
  breach_alerts_resolved: number;
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
    const scvUrl: string =
      body.scv_url ??
      `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/Scv%20list/Vehicle%20List%20-%2017022026.xlsx`;

    const result: SyncResult = {
      total_in_scv_list: 0,
      canonical_vehicles_checked: 0,
      set_to_current: 0,
      set_to_not_current: 0,
      expiry_corrected: 0,
      unchanged: 0,
      observations_updated: 0,
      breach_alerts_resolved: 0,
      errors: [],
    };

    // ── Step 1: Download and parse the SCV Excel list ────────────────────────

    type ScvEntry = { status: string; expiry: string | null };
    let scvMap: Map<string, ScvEntry>;

    try {
      const scvRes = await fetch(scvUrl);
      if (!scvRes.ok) {
        throw new Error(`HTTP ${scvRes.status} ${scvRes.statusText} fetching SCV list`);
      }
      const buf = await scvRes.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);

      scvMap = new Map();
      for (const row of rows) {
        const plate = (row['Vehicle Registration'] ?? '').trim().toUpperCase();
        const status = (row['Certificate Status'] ?? '').trim();
        const issueDateRaw = (row['Certificate Issue Date'] ?? '').trim();
        if (plate && status === 'Current') {
          scvMap.set(plate, { status, expiry: status === 'Current' ? calculateExpiry(issueDateRaw) : null });
        }
      }
      result.total_in_scv_list = scvMap.size;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return json(500, { error: `Failed to load SCV list: ${msg}` });
    }

    // ── Step 2: Load a canonical_vehicles batch ─────────────────────────────

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

    const updateBatch: CanonicalUpdate[] = [];
    const nowIso = new Date().toISOString();

    for (const cv of canonicalVehicles ?? []) {
      const plate = (cv.plate_number ?? '').trim().toUpperCase();
      const scvEntry = scvMap.get(plate);
      const isCurrent = scvEntry?.status === 'Current';
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
      }
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
