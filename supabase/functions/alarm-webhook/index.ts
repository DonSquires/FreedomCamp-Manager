/**
 * alarm-webhook — B-24 Alarm System Integration
 *
 * Accepts inbound alarm events from external security systems
 * (GDS Alarm Receiving Centre, Mark43, ADT, Bosch, Paradox, etc.)
 * via a signed POST webhook.
 *
 * Authentication:
 *   Callers must pass the shared secret in the Authorization header:
 *   `Authorization: Bearer <ALARM_WEBHOOK_SECRET>`
 *   or via the `x-alarm-secret` header.
 *   The secret is stored as `ALARM_WEBHOOK_SECRET` Supabase secret.
 *
 * POST body (application/json):
 * {
 *   organization_id:  string   — org to associate this event with
 *   source_system:    string   — e.g. "gds" | "mark43" | "adt" | "bosch"
 *   alarm_type:       string   — e.g. "intruder" | "panic" | "duress" | "fire" | "tamper"
 *   severity?:        string   — "critical"|"high"|"medium"|"low"  (default "high")
 *   trigger_time?:    string   — ISO 8601 (default: now)
 *   address?:         string   — street address of the alarmed site
 *   site_reference?:  string   — external site ID from the alarm panel
 *   zone_id?:         string   — UUID of matching Supabase zone
 *   notes?:           string   — free-text notes from the alarm system
 * }
 *
 * Response:
 *   { success: true, event_id: string }
 *
 * Required env:
 *   ALARM_WEBHOOK_SECRET     — shared secret for caller auth
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const ALLOWED_ALARM_TYPES = new Set([
  'intruder', 'panic', 'duress', 'fire', 'tamper', 'hold_up',
  'medical', 'perimeter', 'motion', 'door_open', 'door_forced',
  'power_failure', 'comms_failure', 'test', 'other',
])

const ALLOWED_SEVERITIES = new Set(['critical', 'high', 'medium', 'low'])

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ── Auth: shared secret ──────────────────────────────────────────────────
  const secret = Deno.env.get('ALARM_WEBHOOK_SECRET') ?? ''
  const authHeader = req.headers.get('authorization') ?? ''
  const xAlarmSecret = req.headers.get('x-alarm-secret') ?? ''
  const callerSecret = authHeader.replace(/^Bearer\s+/i, '').trim() || xAlarmSecret.trim()

  if (!secret) {
    // Secret not configured — reject all calls
    return new Response(
      JSON.stringify({ error: 'Alarm webhook not configured (ALARM_WEBHOOK_SECRET missing)' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  if (callerSecret !== secret) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, any>
  try {
    body = await req.json()
  } catch {
    return new Response(
      JSON.stringify({ error: 'Request body must be valid JSON' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const {
    organization_id,
    source_system,
    alarm_type,
    severity = 'high',
    trigger_time,
    address,
    site_reference,
    zone_id,
    notes,
  } = body

  if (!organization_id || typeof organization_id !== 'string') {
    return new Response(
      JSON.stringify({ error: 'organization_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
  if (!source_system || typeof source_system !== 'string') {
    return new Response(
      JSON.stringify({ error: 'source_system is required (e.g. "gds", "mark43")' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const normalizedAlarmType = String(alarm_type ?? 'other').toLowerCase().replace(/[^a-z_]/g, '_')
  const finalAlarmType = ALLOWED_ALARM_TYPES.has(normalizedAlarmType) ? normalizedAlarmType : 'other'
  const finalSeverity = ALLOWED_SEVERITIES.has(String(severity).toLowerCase())
    ? String(severity).toLowerCase()
    : 'high'

  const triggerTs = trigger_time
    ? new Date(trigger_time).toISOString()
    : new Date().toISOString()

  // ── Write to Supabase ─────────────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const insertPayload = {
    organization_id,
    source_system: String(source_system).toLowerCase(),
    alarm_type: finalAlarmType,
    severity: finalSeverity,
    trigger_time: triggerTs,
    address: typeof address === 'string' ? address : null,
    site_reference: typeof site_reference === 'string' ? site_reference : null,
    zone_id: typeof zone_id === 'string' ? zone_id : null,
    notes: typeof notes === 'string' ? notes : null,
    status: 'active',
    raw_payload: body,
  }

  const { data, error } = await supabase
    .from('alarm_events')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error) {
    console.error('alarm-webhook: insert error', error)
    return new Response(
      JSON.stringify({ error: 'Failed to record alarm event', detail: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // ── Broadcast to Realtime channel for live admin dashboard ────────────────
  try {
    await supabase.channel('alarm-events')
      .send({
        type: 'broadcast',
        event: 'alarm_received',
        payload: {
          event_id: data.id,
          organization_id,
          source_system: insertPayload.source_system,
          alarm_type: finalAlarmType,
          severity: finalSeverity,
          trigger_time: triggerTs,
          address: insertPayload.address,
        },
      })
  } catch (realtimeErr) {
    // Non-fatal — alarm is saved; broadcast failure is logged only
    console.warn('alarm-webhook: realtime broadcast failed', realtimeErr)
  }

  return new Response(
    JSON.stringify({ success: true, event_id: data.id }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
