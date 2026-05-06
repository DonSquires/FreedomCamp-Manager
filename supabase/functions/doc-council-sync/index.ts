/**
 * doc-council-sync (B-12)
 *
 * Automated DOC / council freedom-camping zone data sync.
 *
 * Triggers:
 *   - Nightly via Supabase cron (pg_cron schedule or external scheduler)
 *   - Manual via POST with { "source": "manual", "org_id": "<uuid>" } from admin UI
 *
 * Behaviour:
 *   1. Fetch zone data from the configured DOC API and/or council feeds.
 *   2. Upsert zone records into `public.zones`.
 *   3. Write a result row to `public.doc_council_sync_log`.
 *   4. If any zones changed, notify admin users via a Supabase Realtime
 *      broadcast on channel `doc-sync-updates`.
 *
 * Environment variables required:
 *   DOC_API_BASE_URL  — Base URL of the DOC Freedom Camping API
 *   DOC_API_KEY       — Auth token / API key for DOC API (set in Supabase secrets)
 *   SUPABASE_URL      — Auto-injected by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — Auto-injected by Supabase runtime
 *
 * NOTE: DOC_API_KEY is currently unconfirmed. Until the key is provisioned the
 *       function runs in "dry-run" mode and logs a 'pending' status row without
 *       modifying zone records.
 */

import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SyncRequest {
  source?: 'doc_api' | 'council_feed' | 'manual'
  org_id?: string
  dry_run?: boolean
}

interface DocZone {
  id?: string
  externalId: string          // ID in the DOC / council system
  name: string
  description?: string
  zone_type: string           // e.g. 'freedom_camping'
  latitude?: number
  longitude?: number
  maxConsecutiveNights?: number
  selfContainedRequired?: boolean
  dayVisitOnly?: boolean
  bylawReference?: string
  landManager?: string
  seasonalOpenMonth?: number
  seasonalCloseMonth?: number
}

interface SyncResult {
  zonesAdded: number
  zonesUpdated: number
  zonesRemoved: number
  errorMessage?: string
  rawSummary?: Record<string, unknown>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch zones from the DOC API.
 * Returns null when DOC_API_KEY is not configured (dry-run fallback).
 */
async function fetchDocZones(apiBase: string, apiKey: string): Promise<DocZone[] | null> {
  const url = `${apiBase}/freedom-camping/zones`
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  })

  if (!resp.ok) {
    throw new Error(`DOC API returned ${resp.status} ${resp.statusText}`)
  }

  const json = await resp.json()
  // DOC API shape assumed: { data: DocZone[] }
  return Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : null
}

/**
 * Upsert a single zone row into public.zones using the unique
 * (external_id, external_source) constraint added by migration 20260505000004.
 * Returns 'inserted' for HTTP 201, 'updated' otherwise.
 */
async function upsertZone(
  supabase: ReturnType<typeof createClient>,
  zone: DocZone,
  source: string,
): Promise<'inserted' | 'updated'> {
  const row = {
    name:                     zone.name,
    description:              zone.description ?? null,
    zone_type:                zone.zone_type,
    is_active:                true,
    location_lat:             zone.latitude ?? null,
    location_lng:             zone.longitude ?? null,
    max_consecutive_nights:   zone.maxConsecutiveNights ?? null,
    self_contained_required:  zone.selfContainedRequired ?? null,
    day_visit_only:           zone.dayVisitOnly ?? null,
    bylaw_reference:          zone.bylawReference ?? null,
    land_manager:             zone.landManager ?? null,
    seasonal_open_month:      zone.seasonalOpenMonth ?? null,
    seasonal_close_month:     zone.seasonalCloseMonth ?? null,
    external_id:              zone.externalId,
    external_source:          source,
  }

  const { error, status } = await (supabase as any)
    .from('zones')
    .upsert(row, { onConflict: 'external_id,external_source' })
    .select('id')
    .single()

  if (error) throw error
  return status === 201 ? 'inserted' : 'updated'
}

/**
 * Write a log row to doc_council_sync_log.
 */
async function writeSyncLog(
  supabase: ReturnType<typeof createClient>,
  source: string,
  result: SyncResult,
  orgId: string | null,
  triggeredBy: string | null,
) {
  await (supabase as any).from('doc_council_sync_log').insert({
    source,
    status:          result.errorMessage ? 'error' : result.zonesAdded + result.zonesUpdated > 0 ? 'success' : 'partial',
    zones_added:     result.zonesAdded,
    zones_updated:   result.zonesUpdated,
    zones_removed:   result.zonesRemoved,
    error_message:   result.errorMessage ?? null,
    raw_summary:     result.rawSummary ?? null,
    organization_id: orgId ?? null,
    triggered_by:    triggeredBy ?? null,
  })
}

/**
 * Send a Realtime broadcast so the admin UI can show a toast on zone changes.
 * Errors are non-fatal and logged to stderr.
 */
async function broadcastChanges(
  supabase: ReturnType<typeof createClient>,
  result: SyncResult,
  source: string,
) {
  if (result.zonesAdded + result.zonesUpdated + result.zonesRemoved === 0) return
  try {
    const channel = supabase.channel('doc-sync-updates')
    // Subscribe before sending to ensure the channel is ready
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve()
      })
    })
    await channel.send({
      type: 'broadcast',
      event: 'zones_updated',
      payload: {
        source,
        zonesAdded:   result.zonesAdded,
        zonesUpdated: result.zonesUpdated,
        zonesRemoved: result.zonesRemoved,
        at:           new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('Realtime broadcast failed (non-fatal):', err)
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl      = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const docApiBase       = Deno.env.get('DOC_API_BASE_URL') ?? ''
    const docApiKey        = Deno.env.get('DOC_API_KEY') ?? ''

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Parse request body (POST) or default to doc_api nightly run
    let body: SyncRequest = {}
    if (req.method === 'POST') {
      try { body = await req.json() } catch { /* empty body is fine */ }
    }

    const source  = body.source ?? 'doc_api'
    const orgId   = body.org_id ?? null
    const dryRun  = body.dry_run ?? false

    // Resolve caller identity for the audit log.
    // Use getUser() to validate the JWT; if it fails or returns no user the
    // call originated from the service role (cron / server-to-server).
    let triggeredBy: string | null = null
    const authHeader = req.headers.get('Authorization') ?? ''
    if (authHeader.startsWith('Bearer ')) {
      const { data } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
      triggeredBy = data?.user?.id ?? null
    }

    // ── Dry-run / missing API key ────────────────────────────────────────────
    if (!docApiKey || dryRun) {
      const result: SyncResult = {
        zonesAdded:   0,
        zonesUpdated: 0,
        zonesRemoved: 0,
        rawSummary: {
          mode: dryRun ? 'dry_run' : 'api_key_not_configured',
          message: dryRun
            ? 'Dry-run mode — no zones were modified.'
            : 'DOC_API_KEY not configured. Set the secret in Supabase to enable live sync.',
        },
      }
      await writeSyncLog(supabase, source, result, orgId, triggeredBy)
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Live sync ────────────────────────────────────────────────────────────
    const result: SyncResult = { zonesAdded: 0, zonesUpdated: 0, zonesRemoved: 0 }

    try {
      const zones = await fetchDocZones(docApiBase, docApiKey)

      if (!zones) {
        result.errorMessage = 'DOC API returned an unexpected response shape.'
      } else {
        for (const zone of zones) {
          const outcome = await upsertZone(supabase, zone, source)
          if (outcome === 'inserted') result.zonesAdded++
          else result.zonesUpdated++
        }

        result.rawSummary = {
          fetchedCount: zones.length,
          source,
        }
      }
    } catch (err: unknown) {
      result.errorMessage = err instanceof Error ? err.message : String(err)
    }

    await writeSyncLog(supabase, source, result, orgId, triggeredBy)

    if (!result.errorMessage) {
      await broadcastChanges(supabase, result, source)
    }

    return new Response(JSON.stringify({ ok: !result.errorMessage, ...result }), {
      status: result.errorMessage ? 500 : 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
