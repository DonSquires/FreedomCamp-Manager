import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { corsHeaders } from '../_shared/cors.ts'

// ---------------------------------------------------------------------------
// In-memory IP rate limiter
// BUILD_PLAN_V3 §6: max DISPUTE_RATE_LIMIT_PER_10MIN submissions per IP per
// 10-minute rolling window (default: 3).  Uses an in-memory Map so it resets
// on cold-start; sufficient for abuse deterrence without an external store.
// ---------------------------------------------------------------------------
const WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const ipCounts = new Map<string, { count: number; windowStart: number }>()

function getRateLimitMax(): number {
  const raw = Deno.env.get('DISPUTE_RATE_LIMIT_PER_10MIN')
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = ipCounts.get(ip)
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // First request in this window: initialise count at 1, allow through.
    ipCounts.set(ip, { count: 1, windowStart: now })
    return false
  }
  // Subsequent requests in the same window: increment then compare.
  // Using `>` (not `>=`) is intentional: count 1 → N are each incremented
  // before checking, so `count > max` blocks the (max+1)th request, allowing
  // exactly `max` submissions per window (e.g. max=3 → requests 1,2,3 pass,
  // request 4 is blocked).
  entry.count += 1
  return entry.count > getRateLimitMax()
}

// Generic error response — must not leak internal or PII details (§31)
const SUBMISSION_FAILED = JSON.stringify({ success: false, error: 'Submission failed.' })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Rate-limit by IP address
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      'unknown'

    if (isRateLimited(clientIp)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const body = await req.json()

    const sourceType = String(body?.source_type || 'other').trim()
    const sourceReference = body?.source_reference ? String(body.source_reference).trim() : null
    const claimantName = body?.claimant_name ? String(body.claimant_name).trim() : null
    const claimantEmail = body?.claimant_email ? String(body.claimant_email).trim() : null
    const claimantPhone = body?.claimant_phone ? String(body.claimant_phone).trim() : null
    const plateNumber = body?.plate_number ? String(body.plate_number).trim().toUpperCase() : null
    const message = String(body?.message || '').trim()
    const zoneId = body?.zone_id ? String(body.zone_id) : null
    const organizationId = body?.organization_id ? String(body.organization_id) : null
    const requestHomelessReview = Boolean(body?.request_homeless_review)
    const hardshipContext = body?.hardship_context ? String(body.hardship_context).trim() : null
    const evidenceStatement = body?.evidence_statement ? String(body.evidence_statement).trim() : null

    if (!message || message.length < 10) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide dispute details (minimum 10 characters).' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const allowed = new Set(['notice_to_vacate', 'infringement', 'homeless_status', 'other'])
    if (!allowed.has(sourceType)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unsupported dispute type.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data, error } = await supabaseAdmin
      .from('dispute_intake')
      .insert({
        organization_id: organizationId,
        zone_id: zoneId,
        source_type: sourceType,
        source_reference: sourceReference,
        plate_number: plateNumber,
        claimant_name: claimantName,
        claimant_email: claimantEmail,
        claimant_phone: claimantPhone,
        message,
        submitted_via: 'public_portal',
        request_homeless_review: requestHomelessReview,
        hardship_context: hardshipContext,
        evidence_statement: evidenceStatement,
      })
      .select('id, submitted_at')
      .single()

    if (error) {
      // Do NOT surface DB error details to the caller (§31)
      console.error('[submit-dispute-intake] insert error:', error.code)
      return new Response(
        SUBMISSION_FAILED,
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ success: true, dispute_id: data.id, submitted_at: data.submitted_at }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (_err) {
    // Do NOT surface internal error details to the caller (§31)
    return new Response(
      SUBMISSION_FAILED,
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
