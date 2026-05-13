/**
 * smoke-notice
 *
 * Generates a printable HTML notice for smoke/fire nuisance enforcement under
 * the Resource Management Act 1991 and local Fire & Smoke Nuisance Bylaws (NZ).
 *
 * Supported notice types:
 *   - Abatement Notice (ABT)      — RMA s.17A / Local Bylaw
 *   - Infringement Notice (INF)   — $300–$1,000 fine
 *   - Prosecution Referral (PRS)  — Environment Court / council legal team
 *
 * POST body:
 *   {
 *     smoke_notice_id: string  — UUID (required)
 *     issued_by:       string  — officer UUID (required)
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders, withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'
import { buildAccessibleOrgIds, orgAccessDenied } from '../_shared/orgAccess.ts'

Deno.serve(withCors(async (req: Request) => {
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return new Response(
      JSON.stringify({ error: authResult.error ?? 'Unauthorized' }),
      { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { smoke_notice_id, issued_by } = await req.json()

  if (!smoke_notice_id) return errorResponse('smoke_notice_id is required', req, 400)
  if (!issued_by) return errorResponse('issued_by is required', req, 400)

  const { data: profile, error: profileErr } = await supabase
    .from('user_profiles')
    .select('id, role, organization_id, employer_organization_id, extra_organization_ids, authorized_work_locations')
    .eq('id', authResult.user.id)
    .single()

  if (profileErr || !profile) return errorResponse('User profile not found', req, 403)

  if (!['admin', 'admin_officer', 'master', 'officer'].includes(profile.role)) {
    return errorResponse('Insufficient permissions', req, 403)
  }

  const allowedOrganizationIds = await buildAccessibleOrgIds(supabase, profile as any)

  const canOverrideIssuedBy = ['admin', 'admin_officer', 'master'].includes(profile.role)
  if (!canOverrideIssuedBy && issued_by !== authResult.user.id) {
    return errorResponse('issued_by must match the authenticated user', req, 403)
  }

  // ── Fetch notice ───────────────────────────────────────────────────────────
  const { data: notice, error: noticeErr } = await supabase
    .from('smoke_notices')
    .select(`
      id, notice_number, notice_type, status,
      recipient_name, recipient_address, recipient_phone,
      offence_description, rma_section,
      issued_at, comply_by, penalty_amount_nzd, notes,
      previous_notice_count, organization_id, smoke_job_id,
      created_at
    `)
    .eq('id', smoke_notice_id)
    .single()

  if (noticeErr || !notice) return errorResponse('Notice not found', req, 404)

  if (profile.role !== 'master' && orgAccessDenied(allowedOrganizationIds, notice.organization_id as string)) {
    return errorResponse('Forbidden', req, 403)
  }

  const { data: officer } = await supabase
    .from('user_profiles')
    .select('first_name, last_name, email, role')
    .eq('id', issued_by)
    .single()

  const { data: org } = await supabase
    .from('organizations')
    .select('name, contact_email, contact_phone, address')
    .eq('id', notice.organization_id)
    .single()

  let jobAddress = notice.recipient_address ?? ''
  if (notice.smoke_job_id) {
    const { data: job } = await supabase
      .from('smoke_jobs')
      .select('address, suburb, city')
      .eq('id', notice.smoke_job_id)
      .single()
    if (job) {
      jobAddress = [job.address, job.suburb, job.city].filter(Boolean).join(', ')
    }
  }

  const officerName = officer
    ? `${officer.first_name ?? ''} ${officer.last_name ?? ''}`.trim()
    : 'Authorised Officer'
  const orgContact = [
    org?.address,
    org?.contact_phone ? `Ph: ${org.contact_phone}` : null,
    org?.contact_email ? `Email: ${org.contact_email}` : null,
  ].filter(Boolean).join('  |  ')

  const html = buildSmokeNoticeHtml({
    noticeNumber:       notice.notice_number,
    noticeType:         notice.notice_type,
    recipientName:      notice.recipient_name ?? '',
    recipientAddress:   notice.recipient_address ?? jobAddress,
    recipientPhone:     notice.recipient_phone ?? '',
    offenceDescription: notice.offence_description ?? '',
    rmaSection:         notice.rma_section ?? 'RMA s.17A',
    complyBy:           notice.comply_by ? new Date(notice.comply_by) : null,
    penaltyAmountNzd:   notice.penalty_amount_nzd ?? null,
    previousNoticeCount: notice.previous_notice_count ?? 0,
    notes:              notice.notes ?? '',
    issuedAt:           new Date(notice.issued_at ?? notice.created_at),
    officerName,
    officerRole:        'Environmental Compliance Officer',
    orgName:            org?.name ?? '',
    orgContact,
  })

  return jsonResponse({ success: true, html, notice_number: notice.notice_number }, req)
}))

// ─── HTML Builder ─────────────────────────────────────────────────────────────

const SMOKE_META: Record<string, { label: string; abbr: string; colour: string; bg: string }> = {
  abatement_notice:     { label: 'Abatement Notice',       abbr: 'ABT', colour: '#92400e', bg: '#fffbeb' },
  infringement_notice:  { label: 'Infringement Notice',    abbr: 'INF', colour: '#7f1d1d', bg: '#fef2f2' },
  prosecution_referral: { label: 'Prosecution Referral',   abbr: 'PRS', colour: '#3b0764', bg: '#faf5ff' },
}

function buildSmokeNoticeHtml(p: {
  noticeNumber: string; noticeType: string; recipientName: string;
  recipientAddress: string; recipientPhone: string; offenceDescription: string;
  rmaSection: string; complyBy: Date | null; penaltyAmountNzd: number | null;
  previousNoticeCount: number; notes: string; issuedAt: Date;
  officerName: string; officerRole: string; orgName: string; orgContact: string;
}): string {
  const esc = (s: string | null | undefined) =>
    String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const nzDate = (d: Date) =>
    d.toLocaleDateString('en-NZ', { day:'2-digit', month:'long', year:'numeric', timeZone:'Pacific/Auckland' })
  const nzTime = (d: Date) =>
    d.toLocaleTimeString('en-NZ', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Pacific/Auckland' })

  const m = SMOKE_META[p.noticeType] ?? SMOKE_META['abatement_notice']

  const penaltyBlock = p.penaltyAmountNzd ? `
    <div style="border:2px solid ${m.colour};padding:10pt;margin:10pt 0;background:${m.bg}">
      <div style="font-weight:bold;font-size:9pt;text-transform:uppercase;color:${m.colour};margin-bottom:4pt">Infringement Fee</div>
      <div style="font-size:12pt;font-weight:bold;color:${m.colour}">NZD $${p.penaltyAmountNzd.toFixed(2)}</div>
      <div style="font-size:9pt;margin-top:4pt">This fee is payable to ${esc(p.orgName)}. Failure to pay may result in further enforcement action.</div>
    </div>` : ''

  const priorBlock = p.previousNoticeCount > 0 ? `
    <div style="border-left:4px solid ${m.colour};padding:6pt 10pt;margin:8pt 0;background:${m.bg}">
      <span style="font-size:9pt;font-weight:bold;color:${m.colour}">⚠ Note: ${p.previousNoticeCount} prior notice${p.previousNoticeCount !== 1 ? 's' : ''} on record for this property.</span>
    </div>` : ''

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${esc(m.label)} ${esc(p.noticeNumber)}</title>
<style>
  @page{size:A4;margin:14mm 16mm}*{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#000}
  .page{max-width:178mm;margin:0 auto}
  .hdr{display:flex;justify-content:space-between;border-bottom:3px solid ${m.colour};padding-bottom:7pt;margin-bottom:10pt}
  .org-name{font-size:13pt;font-weight:bold;color:${m.colour}}
  .notice-abbr{font-size:28pt;font-weight:bold;color:${m.colour};text-align:right;line-height:1}
  .notice-type{font-size:14pt;font-weight:bold;color:${m.colour};text-align:right}
  .notice-meta{font-size:9pt;color:#555;text-align:right;margin-top:3pt}
  .stitle{font-size:8.5pt;font-weight:bold;text-transform:uppercase;color:#444;border-bottom:1px solid #e5e7eb;padding-bottom:2pt;margin:10pt 0 4pt}
  .frow{display:flex;gap:12pt;margin-bottom:6pt}.field{flex:1}
  .fl{display:block;font-size:7.5pt;color:#666;margin-bottom:1pt}
  .fv{display:block;font-size:10pt;border-bottom:1px solid #ccc;padding-bottom:2pt;min-height:14pt}
  .box{border:1.5px solid #d1d5db;padding:8pt;margin:6pt 0;background:#f9fafb;font-size:10.5pt;line-height:1.5}
  .comply-box{border:2px solid ${m.colour};padding:8pt;margin:10pt 0;background:${m.bg}}
  .comply-time{font-size:12pt;font-weight:bold;color:${m.colour}}
  .sig-row{display:flex;gap:20pt;margin-top:14pt}.sig-cell{flex:1}
  .sig-line{border-bottom:1px solid #555;height:22pt;margin-bottom:3pt}
  .sig-label{font-size:7.5pt;color:#666}
  .footer{margin-top:10pt;font-size:7.5pt;color:#666;border-top:1px solid #ccc;padding-top:5pt}
  @media screen{.print-bar{background:#f8fafc;border:1px solid #e2e8f0;padding:10px;margin-bottom:14pt;display:flex;gap:8px;border-radius:6px}}
  @media print{.print-bar{display:none}}
</style></head><body>
<div class="print-bar">
  <button onclick="window.print()" style="background:${m.colour};color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">🖨️ Print Notice</button>
  <span style="font-size:12px;color:#64748b">${esc(m.label)} ${esc(p.noticeNumber)} — ${nzDate(p.issuedAt)}</span>
</div>
<div class="page">
  <div class="hdr">
    <div>
      <div class="org-name">${esc(p.orgName)}</div>
      <div style="font-size:7.5pt;color:#555;margin-top:2pt">${esc(p.orgContact)}</div>
      <div style="font-size:9pt;font-weight:bold;color:#555;margin-top:6pt">SMOKE / AIR QUALITY NUISANCE NOTICE</div>
      <div style="font-size:9pt;color:#555">Resource Management Act 1991 &amp; Local Bylaws</div>
    </div>
    <div style="text-align:right">
      <div class="notice-abbr">${esc(m.abbr)}</div>
      <div class="notice-type">${esc(m.label)}</div>
      <div class="notice-meta">${esc(p.noticeNumber)}<br>${nzDate(p.issuedAt)} at ${nzTime(p.issuedAt)}</div>
    </div>
  </div>
  <div style="border-left:4px solid ${m.colour};padding:6pt 10pt;margin:8pt 0;background:${m.bg}">
    <div style="font-size:8pt;font-weight:bold;text-transform:uppercase;color:${m.colour}">Statutory Authority</div>
    <div style="font-size:10pt">${esc(p.rmaSection)}</div>
  </div>
  ${priorBlock}
  <div class="stitle">Party Served</div>
  <div class="frow">
    <div class="field"><span class="fl">Name</span><span class="fv">${esc(p.recipientName) || '&nbsp;'}</span></div>
    <div class="field"><span class="fl">Phone</span><span class="fv">${esc(p.recipientPhone) || '&nbsp;'}</span></div>
  </div>
  <div class="frow"><div class="field"><span class="fl">Address / Property</span><span class="fv">${esc(p.recipientAddress) || '&nbsp;'}</span></div></div>
  <div class="stitle">Description of Discharge / Offence</div>
  <div class="box">${esc(p.offenceDescription).replace(/\n/g,'<br>') || '&nbsp;'}</div>
  ${p.complyBy ? `<div class="comply-box">
    <div style="font-size:9pt;font-weight:bold;text-transform:uppercase;color:${m.colour};margin-bottom:4pt">Comply By</div>
    <div class="comply-time">${nzDate(p.complyBy)} by ${nzTime(p.complyBy)}</div>
    <div style="font-size:9pt;margin-top:4pt;color:${m.colour}">You are directed to immediately cease the discharge of offensive smoke or fire.</div>
  </div>` : ''}
  ${penaltyBlock}
  ${p.notes ? `<div style="margin-top:4pt;font-size:9.5pt"><strong>Notes:</strong> ${esc(p.notes).replace(/\n/g,'<br>')}</div>` : ''}
  <div class="stitle">Officer Certification</div>
  <div style="font-size:9.5pt;margin:4pt 0 8pt">I, the undersigned authorised officer of ${esc(p.orgName)}, issue this notice pursuant to the ${esc(p.rmaSection)} and applicable local bylaws.</div>
  <div class="sig-row">
    <div class="sig-cell"><div class="sig-line"></div><div class="sig-label"><strong>${esc(p.officerName)}</strong></div><div class="sig-label">${esc(p.officerRole)}</div></div>
    <div class="sig-cell"><div class="sig-line"></div><div class="sig-label">Recipient Acknowledgement (if applicable)</div><div class="sig-label" style="margin-top:4pt">Date: ____________________</div></div>
  </div>
  <div class="footer">${esc(m.label)} ${esc(p.noticeNumber)} | ${esc(p.orgName)} | ${nzDate(p.issuedAt)} | RMA 1991</div>
</div></body></html>`
}
