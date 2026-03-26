import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { corsHeaders } from '../_shared/cors.ts'

function normalizeRef(input: string): string {
  return String(input || '').trim().toUpperCase()
}

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
    const ref = normalizeRef(body?.reference || '')
    const plate = String(body?.plate_number || '').trim().toUpperCase()

    if (!ref || ref.length < 4) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a valid notice reference.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Try infringement notice first
    const { data: infringement, error: infrError } = await supabaseAdmin
      .from('infringement_notices')
      .select(`
        id, notice_number, plate_number, offence_description, legal_basis,
        offence_date, offence_location, issued_at, due_date, status,
        observation_id, breach_alert_id, zone_id,
        zone:zones!zone_id(name)
      `)
      .eq('notice_number', ref)
      .maybeSingle()

    if (!infrError && infringement) {
      if (plate && String(infringement.plate_number || '').toUpperCase() !== plate) {
        return new Response(
          JSON.stringify({ success: false, error: 'Reference and plate do not match.' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      let evidencePhotoUrl: string | null = null
      if ((infringement as any).observation_id) {
        const { data: obs } = await supabaseAdmin
          .from('observations')
          .select('photo, photo_url')
          .eq('observation_id', (infringement as any).observation_id)
          .maybeSingle()
        evidencePhotoUrl = String((obs as any)?.photo || (obs as any)?.photo_url || '') || null
      }

      return new Response(
        JSON.stringify({
          success: true,
          case_type: 'infringement',
          case: {
            reference: (infringement as any).notice_number,
            plate_number: (infringement as any).plate_number,
            status: (infringement as any).status,
            issued_at: (infringement as any).issued_at,
            due_date: (infringement as any).due_date,
            zone_name: (infringement as any)?.zone?.name || null,
            reason: (infringement as any).offence_description,
            legal_basis: (infringement as any).legal_basis,
            offence_date: (infringement as any).offence_date,
            offence_location: (infringement as any).offence_location,
          },
          evidence: {
            photo_url: evidencePhotoUrl,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Then notice to vacate
    const { data: ntv, error: ntvError } = await supabaseAdmin
      .from('notices_to_vacate')
      .select(`
        id, reference_number, plate_number, breach_reason, nights_stayed,
        status, issued_at, vacate_deadline, breach_alert_id, zone_id,
        zone:zones!zone_id(name)
      `)
      .eq('reference_number', ref)
      .maybeSingle()

    if (!ntvError && ntv) {
      if (plate && String((ntv as any).plate_number || '').toUpperCase() !== plate) {
        return new Response(
          JSON.stringify({ success: false, error: 'Reference and plate do not match.' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      let evidencePhotoUrl: string | null = null
      if ((ntv as any).breach_alert_id) {
        const { data: breach } = await supabaseAdmin
          .from('breach_alerts')
          .select('observation_id')
          .eq('id', (ntv as any).breach_alert_id)
          .maybeSingle()

        const obsId = (breach as any)?.observation_id
        if (obsId) {
          const { data: obs } = await supabaseAdmin
            .from('observations')
            .select('photo, photo_url')
            .eq('observation_id', obsId)
            .maybeSingle()
          evidencePhotoUrl = String((obs as any)?.photo || (obs as any)?.photo_url || '') || null
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          case_type: 'notice_to_vacate',
          case: {
            reference: (ntv as any).reference_number,
            plate_number: (ntv as any).plate_number,
            status: (ntv as any).status,
            issued_at: (ntv as any).issued_at,
            vacate_deadline: (ntv as any).vacate_deadline,
            zone_name: (ntv as any)?.zone?.name || null,
            reason: (ntv as any).breach_reason,
            nights_stayed: (ntv as any).nights_stayed,
          },
          evidence: {
            photo_url: evidencePhotoUrl,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ success: false, error: 'No notice found for that reference.' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (_err) {
    return new Response(
      JSON.stringify({ success: false, error: 'Lookup failed.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
