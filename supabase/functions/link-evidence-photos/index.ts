// ============================================================================
// link-evidence-photos  —  Edge Function
// ============================================================================
// Iterates files in the `evidence` storage bucket, runs ALPR on each image,
// and when a plate is recognised links the photo to the matching
// canonical_vehicles record by setting profile_photo / profile_photo_url.
//
// POST body (all optional):
//   {
//     path_prefix?:     string,    // only process files under this folder prefix
//     paths?:           string[],  // explicit list of paths (skips bucket listing)
//     min_confidence?:  number,    // minimum ALPR confidence 0–1 (default 0.7)
//     force_update?:    boolean,   // overwrite existing profile_photo (default false)
//     dry_run?:         boolean,   // report only, no DB writes (default false)
//     limit?:           number,    // max files per call (default 20, max 50)
//   }
//
// Requires: admin or master role.
// Uses service-role key — must only be invoked from authenticated admin sessions.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';
import { alprWithBytes } from '../_shared/alpr.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}

/** Uppercase and strip everything that isn't A-Z or 0-9. */
function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Decode a JWT payload without a network round-trip. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function extractBearerToken(req: Request): string | null {
  const value =
    req.headers.get('Authorization') ??
    req.headers.get('authorization') ??
    req.headers.get('x-authorization');
  if (!value) return null;
  const m = value.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

/**
 * Recurse through a bucket folder and collect all file paths.
 * Folders are items where `id === null`.
 */
async function listAllFiles(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  folder = '',
  acc: string[] = [],
): Promise<string[]> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(folder, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });

  if (error || !data) {
    console.warn(`⚠️ list error in ${bucket}/${folder}:`, error?.message);
    return acc;
  }

  for (const item of data) {
    const fullPath = folder ? `${folder}/${item.name}` : item.name;
    if (item.id === null) {
      // It's a virtual folder — recurse
      await listAllFiles(supabase, bucket, fullPath, acc);
    } else {
      acc.push(fullPath);
    }
  }
  return acc;
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_MIN_CONFIDENCE = 0.7;

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── Auth ──────────────────────────────────────────────────────────────
    const jwt = extractBearerToken(req);
    if (!jwt) return json(401, { error: 'Missing Authorization header' });

    let userId: string | null = null;

    // Prefer local decode (no network round-trip; avoids intermittent 401s)
    const payload = decodeJwtPayload(jwt);
    if (typeof payload?.sub === 'string' && payload.sub.length > 0) {
      userId = payload.sub;
    }

    if (!userId) {
      const { data: authData, error: authErr } = await supabase.auth.getUser(jwt);
      if (authErr || !authData?.user?.id) {
        return json(401, { error: 'Invalid or expired token' });
      }
      userId = authData.user.id;
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (!profile || !['admin', 'master'].includes(profile.role)) {
      return json(403, { error: 'Admin or master role required' });
    }

    // ── Parse request body ────────────────────────────────────────────────
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // empty / non-JSON body is fine
    }

    const minConfidence: number =
      typeof body.min_confidence === 'number' ? body.min_confidence : DEFAULT_MIN_CONFIDENCE;
    const forceUpdate = body.force_update === true;
    const dryRun = body.dry_run === true;
    const limit = typeof body.limit === 'number'
      ? Math.min(Math.max(1, body.limit), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const pathPrefix = typeof body.path_prefix === 'string' ? body.path_prefix : '';
    const specificPaths = Array.isArray(body.paths)
      ? (body.paths as unknown[]).filter((p): p is string => typeof p === 'string')
      : null;

    // ── Collect files to process ──────────────────────────────────────────
    let filePaths: string[];

    if (specificPaths && specificPaths.length > 0) {
      filePaths = specificPaths;
    } else {
      filePaths = await listAllFiles(supabase, 'evidence', pathPrefix);
    }

    // Keep image files only, then apply limit
    filePaths = filePaths
      .filter((p) => IMAGE_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext)))
      .slice(0, limit);

    console.log(
      `🗂️  link-evidence-photos: processing ${filePaths.length} file(s) ` +
      `(dryRun=${dryRun}, forceUpdate=${forceUpdate}, minConfidence=${minConfidence})`,
    );

    // ── Processing results ────────────────────────────────────────────────
    const results = {
      total: filePaths.length,
      processed: 0,
      matched: 0,
      updated: 0,
      no_plate: 0,
      not_in_db: 0,
      errors: 0,
      dry_run: dryRun,
      details: [] as Record<string, unknown>[],
    };

    for (const filePath of filePaths) {
      try {
        // Download image bytes via service role (works for private and public buckets)
        const { data: fileData, error: dlErr } = await supabase.storage
          .from('evidence')
          .download(filePath);

        if (dlErr || !fileData) {
          results.errors++;
          results.details.push({
            path: filePath,
            status: 'download_error',
            error: dlErr?.message ?? 'no data returned',
          });
          continue;
        }

        const bytes = new Uint8Array(await fileData.arrayBuffer());

        // ── ALPR ──────────────────────────────────────────────────────────
        const alpr = await alprWithBytes(bytes, { timeout: 12000 });
        results.processed++;

        const rawPlate = alpr.plate;
        const confidence = alpr.confidence ?? 0;

        if (!rawPlate || confidence < minConfidence) {
          results.no_plate++;
          results.details.push({
            path: filePath,
            status: 'no_plate',
            raw_plate: rawPlate,
            confidence,
          });
          continue;
        }

        const plate = normalizePlate(rawPlate);
        if (!plate) {
          results.no_plate++;
          results.details.push({ path: filePath, status: 'no_plate', raw_plate: rawPlate });
          continue;
        }

        // ── Canonical vehicle lookup ──────────────────────────────────────
        const { data: vehicle, error: lookupErr } = await supabase
          .from('canonical_vehicles')
          .select('vehicle_id, plate_number, profile_photo, profile_photo_url')
          .eq('plate_number', plate)
          .maybeSingle();

        if (lookupErr) {
          results.errors++;
          results.details.push({
            path: filePath,
            status: 'lookup_error',
            plate,
            error: lookupErr.message,
          });
          continue;
        }

        if (!vehicle) {
          results.not_in_db++;
          results.details.push({
            path: filePath,
            status: 'not_in_db',
            plate,
            confidence,
          });
          continue;
        }

        results.matched++;

        // Decide whether to update the profile photo
        const alreadyHasPhoto = !!vehicle.profile_photo;
        if (alreadyHasPhoto && !forceUpdate) {
          results.details.push({
            path: filePath,
            status: 'matched_no_update',
            plate,
            vehicle_id: vehicle.vehicle_id,
            existing_photo: vehicle.profile_photo,
            reason: 'profile_photo already set; pass force_update=true to override',
          });
          continue;
        }

        // Build public URL for the evidence bucket file
        const { data: urlData } = supabase.storage
          .from('evidence')
          .getPublicUrl(filePath);
        const publicUrl = urlData?.publicUrl ?? null;

        if (!dryRun) {
          const { error: updateErr } = await supabase
            .from('canonical_vehicles')
            .update({
              profile_photo: `evidence/${filePath}`,
              profile_photo_url: publicUrl,
              profile_photo_score: Math.round(confidence * 100),
              profile_photo_updated_at: new Date().toISOString(),
              profile_photo_selected_at: new Date().toISOString(),
            })
            .eq('vehicle_id', vehicle.vehicle_id);

          if (updateErr) {
            results.errors++;
            results.details.push({
              path: filePath,
              status: 'update_error',
              plate,
              vehicle_id: vehicle.vehicle_id,
              error: updateErr.message,
            });
            continue;
          }
        }

        results.updated++;
        results.details.push({
          path: filePath,
          status: dryRun ? 'dry_run_would_update' : 'updated',
          plate,
          vehicle_id: vehicle.vehicle_id,
          confidence,
          public_url: publicUrl,
        });
      } catch (fileErr) {
        results.errors++;
        results.details.push({
          path: filePath,
          status: 'error',
          error: String(fileErr),
        });
      }
    }

    console.log(
      `✅ link-evidence-photos complete: ${results.updated} updated, ` +
      `${results.matched} matched, ${results.no_plate} no plate, ` +
      `${results.not_in_db} not in DB, ${results.errors} errors`,
    );

    return json(200, results);
  } catch (err) {
    console.error('❌ link-evidence-photos unhandled error:', err);
    return json(500, { error: 'Internal server error', detail: String(err) });
  }
});
