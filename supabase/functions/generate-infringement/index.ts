/**
 * generate-infringement
 * 
 * Creates an infringement notice record and returns printable HTML for the notice.
 * Modelled on the ADR / TicketOr2 format used by NZ parking enforcement agencies.
 * 
 * Flow:
 *   1. Validates issuing officer has authority (warrant / org membership)
 *   2. Generates unique notice number via generate_infringement_number() RPC
 *   3. Builds printable HTML notice (front + back / summary of rights)
 *   4. INSERTs infringement_notices record with status='issued'
 *   5. Returns { notice_id, notice_number, html }
 * 
 * POST body:
 *   {
 *     breach_alert_id?,    // Optional — pre-fills offence details
 *     observation_id?,     // Optional — links to scan evidence
 *     plate_number,        // Required
 *     zone_id,             // Required
 *     offence_description, // Required
 *     legal_basis,         // Required — e.g. "FCA 2011 s20(1)(a)"
 *     offence_date,        // ISO string
 *     offence_location,    // Free text location description
 *     amount_cents,        // Fine in cents (default 20000 = NZD $200)
 *     due_date?,           // Payment deadline (default +28 days)
 *     service_method,      // 'hand' | 'post' | 'email'
 *     recipient_name?,
 *     recipient_email?,
 *     recipient_address?,
 *     summary_of_rights?,  // Custom override; defaults to standard NZ text
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { corsHeaders } from '../_shared/cors.ts'

const PRINT_ARTIFACT_BUCKET = 'notice-artifacts'

const NZ_DEFAULT_SUMMARY_OF_RIGHTS = `
SUMMARY OF RIGHTS — FREEDOM CAMPING ACT 2011 (s20)

You have received this infringement notice for an alleged offence under the Freedom Camping Act 2011 (FCA) and/or the applicable local authority bylaw.

YOUR OPTIONS:

1. PAY THE FEE
   Pay the infringement fee shown on the front of this notice within 28 days of the issue date. Payment details are on the front of this notice.

2. WRITE IN (DENY THE OFFENCE)
   Send written submissions to the issuing authority within 28 days. Your submissions will be considered and you will be advised of the outcome. If the infringement is not cancelled, you may be served with a reminder notice.

3. REQUEST A COURT HEARING
   You may elect to have the matter dealt with by a court. Contact the issuing authority in writing within 28 days to request a hearing. Court costs may be awarded against you if you are convicted.

4. DO NOTHING
   If you do not respond within 28 days, a reminder notice may be issued with an additional fee. The matter may then be referred to the District Court.

For further information contact the issuing authority shown on the front of this notice.

This notice is issued under the Freedom Camping Act 2011 and/or the applicable territorial authority bylaw.
`.trim()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json()
    const {
      breach_alert_id,
      observation_id,
      plate_number,
      zone_id,
      offence_description,
      legal_basis,
      offence_date,
      offence_location,
      amount_cents = 20000,
      due_date,
      service_method = 'hand',
      recipient_name,
      recipient_email,
      recipient_address,
      summary_of_rights,
    } = body

    // Validate required fields
    if (!plate_number || !zone_id || !offence_description || !legal_basis) {
      return new Response(
        JSON.stringify({ success: false, error: 'plate_number, zone_id, offence_description and legal_basis are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the calling user's ID from the auth header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get issuing officer profile + org
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, first_name, last_name, organization_id, role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ success: false, error: 'Officer profile not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!['admin', 'admin_officer', 'master', 'officer'].includes(profile.role)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Insufficient permissions to issue infringement notices' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get zone + org details for the notice letterhead
    const { data: zoneData } = await supabaseAdmin
      .from('zones')
      .select('id, name, location_lat, location_lng, organizations!inner(id, name)')
      .eq('id', zone_id)
      .single()

    const orgName = (zoneData?.organizations as any)?.name ?? 'Issuing Authority'
    const orgId = profile.organization_id ?? (zoneData?.organizations as any)?.id

    // Generate unique notice number
    const { data: noticeNumber, error: numError } = await supabaseAdmin
      .rpc('generate_infringement_number', { p_org_id: orgId })

    if (numError || !noticeNumber) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to generate notice number' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Calculate due date
    const offenceDt = offence_date ? new Date(offence_date) : new Date()
    const dueDt = due_date
      ? new Date(due_date)
      : new Date(offenceDt.getTime() + 28 * 24 * 60 * 60 * 1000)

    const rightsText = summary_of_rights || NZ_DEFAULT_SUMMARY_OF_RIGHTS
    const amountDollars = (amount_cents / 100).toFixed(2)

    // ── Generate notice HTML ──────────────────────────────────────────────────
    const noticeHtml = generateNoticeHtml({
      noticeNumber,
      platNumber: plate_number,
      offenceDescription: offence_description,
      legalBasis: legal_basis,
      offenceDate: offenceDt,
      offenceLocation: offence_location ?? zoneData?.name ?? 'See attached observation',
      amountDollars,
      dueDt,
      serviceMethod: service_method,
      recipientName: recipient_name,
      issuerName: `${profile.first_name} ${profile.last_name}`,
      issuerRole: profile.role,
      orgName,
      zoneName: zoneData?.name ?? '',
      summaryOfRights: rightsText,
    })

    // ── INSERT infringement_notices ──────────────────────────────────────────
    const { data: notice, error: insertError } = await supabaseAdmin
      .from('infringement_notices')
      .insert({
        organization_id: orgId,
        observation_id: observation_id ?? null,
        breach_alert_id: breach_alert_id ?? null,
        zone_id,
        plate_number,
        offence_description,
        legal_basis,
        offence_date: offenceDt.toISOString(),
        offence_location: offence_location ?? zoneData?.name,
        notice_number: noticeNumber,
        notice_type: 'infringement',
        amount_cents,
        issue_date: new Date().toISOString().split('T')[0],
        due_date: dueDt.toISOString().split('T')[0],
        service_method,
        recipient_name: recipient_name ?? null,
        recipient_email: recipient_email ?? null,
        recipient_address: recipient_address ?? null,
        summary_of_rights: rightsText,
        status: 'issued',
        created_by: user.id,
      })
      .select('id, notice_number')
      .single()

    if (insertError) {
      console.error('❌ Insert error:', insertError)
      return new Response(
        JSON.stringify({ success: false, error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    try {
      const htmlHash = await sha256Hex(noticeHtml)
      const artifactPath = `artifacts/infringements/${orgId}/${notice.notice_number}.html`
      const uploadBody = new Blob([noticeHtml], { type: 'text/html;charset=utf-8' })

      const { error: uploadError } = await supabaseAdmin.storage
        .from(PRINT_ARTIFACT_BUCKET)
        .upload(artifactPath, uploadBody, {
          contentType: 'text/html; charset=utf-8',
          upsert: true,
        })

      if (uploadError) {
        console.error('⚠️ Failed to persist notice artifact:', uploadError)
      } else {
        await supabaseAdmin
          .from('infringement_notices')
          .update({
            notice_html_path: artifactPath,
            notice_html_hash: htmlHash,
          })
          .eq('id', notice.id)
      }
    } catch (artifactError) {
      console.error('⚠️ Notice artifact persistence error:', artifactError)
    }

    // Update breach alert status if provided
    if (breach_alert_id) {
      await supabaseAdmin
        .from('breach_alerts')
        .update({ status: 'enforcement_started' })
        .eq('id', breach_alert_id)
    }

    console.log(`✅ Infringement notice ${noticeNumber} issued for ${plate_number}`)

    return new Response(
      JSON.stringify({
        success: true,
        notice_id: notice.id,
        notice_number: notice.notice_number,
        html: noticeHtml,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('❌ generate-infringement error:', err)
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// ──────────────────────────────────────────────────────────────────────────────
// HTML Notice Generator (ADR-style two-sided form)
// ──────────────────────────────────────────────────────────────────────────────
function generateNoticeHtml(params: {
  noticeNumber: string
  platNumber: string
  offenceDescription: string
  legalBasis: string
  offenceDate: Date
  offenceLocation: string
  amountDollars: string
  dueDt: Date
  serviceMethod: string
  recipientName?: string
  issuerName: string
  issuerRole: string
  orgName: string
  zoneName: string
  summaryOfRights: string
}): string {
  const nzDate = (d: Date) =>
    d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland' })
  const nzTime = (d: Date) =>
    d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Pacific/Auckland' })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Infringement Notice ${params.noticeNumber}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #000; background: #fff; }
    .page { width: 100%; max-width: 180mm; margin: 0 auto; }
    .page-break { page-break-before: always; }
    /* Header */
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a8a; padding-bottom: 8pt; margin-bottom: 12pt; }
    .org-name { font-size: 16pt; font-weight: bold; color: #1e3a8a; }
    .notice-type { font-size: 20pt; font-weight: bold; color: #dc2626; text-align: right; }
    .notice-number { font-size: 10pt; color: #666; text-align: right; }
    /* Plate box */
    .plate-box { border: 3px solid #000; padding: 8pt 16pt; display: inline-block; font-size: 28pt; font-weight: bold; font-family: 'Courier New', monospace; letter-spacing: 4pt; margin: 8pt 0; background: #fff; }
    /* Sections */
    .section { margin-bottom: 10pt; }
    .section-title { font-weight: bold; font-size: 9pt; text-transform: uppercase; color: #555; border-bottom: 1px solid #ccc; padding-bottom: 2pt; margin-bottom: 4pt; }
    .field-row { display: flex; gap: 16pt; margin-bottom: 4pt; }
    .field { flex: 1; }
    .field-label { font-size: 8pt; color: #777; }
    .field-value { font-size: 10pt; border-bottom: 1px solid #ccc; padding-bottom: 1pt; min-height: 14pt; }
    /* Amount box */
    .amount-box { border: 2px solid #dc2626; padding: 8pt 12pt; text-align: center; margin: 8pt 0; }
    .amount-label { font-size: 9pt; text-transform: uppercase; color: #dc2626; }
    .amount-value { font-size: 24pt; font-weight: bold; color: #dc2626; }
    .amount-due { font-size: 9pt; color: #555; }
    /* Footer */
    .footer { margin-top: 12pt; font-size: 8pt; color: #777; border-top: 1px solid #ccc; padding-top: 6pt; }
    /* Rights page */
    .rights-title { font-size: 14pt; font-weight: bold; color: #1e3a8a; margin-bottom: 12pt; border-bottom: 2px solid #1e3a8a; padding-bottom: 4pt; }
    .rights-text { font-size: 10pt; line-height: 1.5; white-space: pre-wrap; }
    /* Print bar */
    @media screen { .print-bar { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px; margin-bottom: 16pt; display: flex; gap: 8px; align-items: center; } }
    @media print { .print-bar { display: none; } }
  </style>
</head>
<body>
  <div class="print-bar">
    <button onclick="window.print()" style="background:#1e3a8a;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:12px;">🖨️ Print Notice</button>
    <span style="font-size:12px;color:#64748b;">Notice ${params.noticeNumber} — ${params.platNumber}</span>
  </div>

  <!-- FRONT OF NOTICE -->
  <div class="page">
    <div class="header">
      <div>
        <div class="org-name">${params.orgName}</div>
        <div style="font-size:9pt;color:#555;margin-top:2pt;">FREEDOM CAMPING ENFORCEMENT</div>
      </div>
      <div>
        <div class="notice-type">INFRINGEMENT NOTICE</div>
        <div class="notice-number">Notice No: <strong>${params.noticeNumber}</strong></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Vehicle Registration</div>
      <div class="plate-box">${params.platNumber}</div>
    </div>

    <div class="section">
      <div class="section-title">Offence Details</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Date of Offence</div>
          <div class="field-value">${nzDate(params.offenceDate)}</div>
        </div>
        <div class="field">
          <div class="field-label">Time of Offence</div>
          <div class="field-value">${nzTime(params.offenceDate)}</div>
        </div>
      </div>
      <div class="field" style="margin-bottom:4pt;">
        <div class="field-label">Location</div>
        <div class="field-value">${params.offenceLocation}</div>
      </div>
      <div class="field" style="margin-bottom:4pt;">
        <div class="field-label">Description of Offence</div>
        <div class="field-value">${params.offenceDescription}</div>
      </div>
      <div class="field">
        <div class="field-label">Legal Basis</div>
        <div class="field-value">${params.legalBasis}</div>
      </div>
    </div>

    <div class="amount-box">
      <div class="amount-label">Infringement Fee</div>
      <div class="amount-value">NZD $${params.amountDollars}</div>
      <div class="amount-due">Payment due by: <strong>${nzDate(params.dueDt)}</strong></div>
    </div>

    <div class="section">
      <div class="section-title">Issued To</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Name / Company</div>
          <div class="field-value">${params.recipientName ?? 'Owner / Occupier of Vehicle'}</div>
        </div>
        <div class="field">
          <div class="field-label">Service Method</div>
          <div class="field-value" style="text-transform:capitalize;">${params.serviceMethod}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Issuing Officer</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Officer Name</div>
          <div class="field-value">${params.issuerName}</div>
        </div>
        <div class="field">
          <div class="field-label">Date Issued</div>
          <div class="field-value">${nzDate(new Date())}</div>
        </div>
      </div>
      <div class="field-row">
        <div class="field" style="flex:2;">
          <div class="field-label">Signature</div>
          <div class="field-value" style="height:30pt;"></div>
        </div>
        <div class="field">
          <div class="field-label">Role</div>
          <div class="field-value" style="text-transform:capitalize;">${params.issuerRole.replace('_', ' ')}</div>
        </div>
      </div>
    </div>

    <div class="footer">
      See overleaf for your Summary of Rights. This notice is issued under the Freedom Camping Act 2011 and/or the applicable territorial authority bylaw.
      Notice number ${params.noticeNumber} issued by ${params.orgName}.
    </div>
  </div>

  <!-- BACK OF NOTICE (page break for print) -->
  <div class="page page-break">
    <div class="rights-title">SUMMARY OF RIGHTS</div>
    <div class="rights-text">${params.summaryOfRights}</div>
    <div class="footer" style="margin-top:24pt;">
      Notice No: ${params.noticeNumber} | Plate: ${params.platNumber} | Issued: ${nzDate(new Date())} | ${params.orgName}
    </div>
  </div>
</body>
</html>`
}
