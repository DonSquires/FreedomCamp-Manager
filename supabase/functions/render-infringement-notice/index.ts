import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { corsHeaders } from '../_shared/cors.ts'
import { generateNoticeHtml, NZ_DEFAULT_SUMMARY_OF_RIGHTS } from '../_shared/infringement-notice.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { notice_id } = await req.json()
    if (!notice_id) {
      return new Response(JSON.stringify({ success: false, error: 'notice_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, organization_id, role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return new Response(JSON.stringify({ success: false, error: 'Officer profile not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!['admin', 'admin_officer', 'master', 'officer'].includes(profile.role)) {
      return new Response(JSON.stringify({ success: false, error: 'Insufficient permissions' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: notice, error: noticeError } = await supabaseAdmin
      .from('infringement_notices')
      .select(`
        id,
        notice_number,
        plate_number,
        offence_description,
        legal_basis,
        offence_date,
        offence_location,
        amount_cents,
        due_date,
        service_method,
        recipient_name,
        organization_id,
        zone:zones!zone_id(name, organizations!inner(id, name)),
        issuer:user_profiles!created_by(first_name, last_name, role),
        summary_of_rights
      `)
      .eq('id', notice_id)
      .single()

    if (noticeError || !notice) {
      return new Response(JSON.stringify({ success: false, error: 'Notice not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (profile.role !== 'master' && notice.organization_id !== profile.organization_id) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const noticeHtml = generateNoticeHtml({
      noticeNumber: notice.notice_number,
      platNumber: notice.plate_number || 'UNKNOWN',
      offenceDescription: notice.offence_description || 'Freedom camping offence',
      legalBasis: notice.legal_basis || 'Freedom Camping Act 2011',
      offenceDate: notice.offence_date ? new Date(notice.offence_date) : new Date(),
      offenceLocation: notice.offence_location || notice.zone?.name || 'Unknown location',
      amountDollars: (((notice.amount_cents || 0) as number) / 100).toFixed(2),
      dueDt: notice.due_date ? new Date(notice.due_date) : new Date(),
      serviceMethod: notice.service_method || 'hand',
      recipientName: notice.recipient_name || undefined,
      issuerName: `${notice.issuer?.first_name || ''} ${notice.issuer?.last_name || ''}`.trim() || 'Unknown officer',
      issuerRole: notice.issuer?.role || 'officer',
      orgName: notice.zone?.organizations?.name || 'Issuing Authority',
      zoneName: notice.zone?.name || '',
      summaryOfRights: notice.summary_of_rights || NZ_DEFAULT_SUMMARY_OF_RIGHTS,
    })

    return new Response(JSON.stringify({
      success: true,
      notice_id: notice.id,
      notice_number: notice.notice_number,
      html: noticeHtml,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})