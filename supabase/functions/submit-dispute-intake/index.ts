import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
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
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ success: true, dispute_id: data.id, submitted_at: data.submitted_at }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error?.message || 'Unexpected error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
