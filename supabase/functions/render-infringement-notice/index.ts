import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { corsHeaders } from '../_shared/cors.ts'
import { generateNoticeHtml, NZ_DEFAULT_SUMMARY_OF_RIGHTS } from '../_shared/infringement-notice.ts'

const PRINT_ARTIFACT_BUCKET = 'notice-artifacts'

function formatDbError(err: { message?: string | null; code?: string | null; details?: string | null; hint?: string | null }) {
  const parts = [
    err.message || 'Database error',
    err.code ? `code=${err.code}` : null,
    err.details ? `details=${err.details}` : null,
    err.hint ? `hint=${err.hint}` : null,
  ].filter(Boolean)
  return parts.join(' | ')
}

function extractBearerToken(req: Request): string | null {
  const candidates = [
    req.headers.get('Authorization'),
    req.headers.get('authorization'),
    req.headers.get('x-authorization'),
    req.headers.get('x-forwarded-authorization'),
    req.headers.get('x-supabase-authorization'),
  ]

  for (const value of candidates) {
    if (!value) continue
    const match = value.match(/^Bearer\s+(.+)$/i)
    if (match?.[1]) return match[1].trim()
  }

  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const token = extractBearerToken(req)
    if (!token) {
      return new Response(JSON.stringify({ success: false, error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid session', details: authError?.message || null }), {
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

    const baseSelect = `
      id,
      notice_number,
      notice_pdf_url,
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
    `

    let notice: any = null
    const withArtifactSelect = `notice_html_path, ${baseSelect}`

    const { data: noticeWithArtifact, error: noticeWithArtifactError } = await supabaseAdmin
      .from('infringement_notices')
      .select(withArtifactSelect)
      .eq('id', notice_id)
      .single()

    if (noticeWithArtifactError?.code === '42703') {
      const { data: legacyNotice, error: legacyNoticeError } = await supabaseAdmin
        .from('infringement_notices')
        .select(baseSelect)
        .eq('id', notice_id)
        .single()

      if (legacyNoticeError || !legacyNotice) {
        return new Response(JSON.stringify({ success: false, error: formatDbError(legacyNoticeError || { message: 'Notice not found' }) }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      notice = { ...legacyNotice, notice_html_path: null }
    } else if (noticeWithArtifactError || !noticeWithArtifact) {
      return new Response(JSON.stringify({ success: false, error: formatDbError(noticeWithArtifactError || { message: 'Notice not found' }) }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } else {
      notice = noticeWithArtifact
    }

    if (profile.role !== 'master' && notice.organization_id !== profile.organization_id) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (notice.notice_html_path) {
      try {
        const { data: artifactData, error: artifactError } = await supabaseAdmin.storage
          .from(PRINT_ARTIFACT_BUCKET)
          .download(notice.notice_html_path)

        if (!artifactError && artifactData) {
          const artifactHtml = await artifactData.text()
          if (artifactHtml.trim().length > 0) {
            return new Response(JSON.stringify({
              success: true,
              notice_id: notice.id,
              notice_number: notice.notice_number,
              html: artifactHtml,
              source: 'stored-artifact',
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
          }
        }
      } catch {
        // Fall back to legacy URL or server-side regeneration.
      }
    }

    if (notice.notice_pdf_url) {
      try {
        const artifactResponse = await fetch(notice.notice_pdf_url)
        if (artifactResponse.ok) {
          const artifactHtml = await artifactResponse.text()
          if (artifactHtml.trim().length > 0) {
            return new Response(JSON.stringify({
              success: true,
              notice_id: notice.id,
              notice_number: notice.notice_number,
              html: artifactHtml,
              source: 'stored-artifact',
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
          }
        }
      } catch {
        // Fall back to server-side regeneration if artifact fetch is unavailable.
      }
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
      source: 'regenerated',
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