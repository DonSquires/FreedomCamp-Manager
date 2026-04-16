/**
 * biosecurity-notice
 *
 * Generates a printable HTML notice for Biosecurity enforcement under the
 * Biosecurity Act 1993 (New Zealand).
 *
 * Supported notice types:
 *   - Notice of Direction (NOD) — Biosecurity Act 1993 s.128
 *   - Infringement Notice (INF) — formal financial penalty
 *   - Formal Warning (FW)       — advisory / first-contact
 *
 * POST body:
 *   {
 *     biosecurity_notice_id: string  — UUID (required)
 *     issued_by:             string  — officer UUID (required)
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders, withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

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

  const { biosecurity_notice_id, issued_by } = await req.json()

  if (!biosecurity_notice_id) return errorResponse('biosecurity_notice_id is required', req, 400)
  if (!issued_by) return errorResponse('issued_by is required', req, 400)

  // ── Fetch notice ───────────────────────────────────────────────────────────
  const { data: notice, error: noticeErr } = await supabase
    .from('biosecurity_notices')
    .select(`
      id, notice_number, notice_type, status,
      recipient_name, recipient_address, recipient_phone, recipient_email,
      offence_description, biosecurity_act_section, species_identified,
      infestation_location, required_actions, comply_by,
      penalty_amount_nzd, notes, created_at,
      organization_id, biosecurity_job_id
    `)
    .eq('id', biosecurity_notice_id)
    .single()

  if (noticeErr || !notice) return errorResponse('Notice not found', req, 404)

  // ── Fetch officer ──────────────────────────────────────────────────────────
  const { data: officer } = await supabase
    .from('user_profiles')
    .select('first_name, last_name, email, role')
    .eq('id', issued_by)
    .single()

  // ── Fetch org ──────────────────────────────────────────────────────────────
  const { data: org } = await supabase
    .from('organizations')
    .select('name, contact_email, contact_phone, address')
    .eq('id', notice.organization_id)
    .single()

  const officerName = officer
    ? `${officer.first_name ?? ''} ${officer.last_name ?? ''}`.trim()
    : 'Authorised Officer'
  const officerRole = 'Biosecurity Compliance Officer'
  const orgContact = [
    org?.address,
    org?.contact_phone ? `Ph: ${org.contact_phone}` : null,
    org?.contact_email ? `Email: ${org.contact_email}` : null,
  ].filter(Boolean).join('  |  ')

  const html = buildBiosecurityNoticeHtml({
    noticeNumber:       notice.notice_number,
    noticeType:         notice.notice_type,
    recipientName:      notice.recipient_name ?? '',
    recipientAddress:   notice.recipient_address ?? '',
    recipientPhone:     notice.recipient_phone ?? '',
    offenceDescription: notice.offence_description ?? '',
    actSection:         notice.biosecurity_act_section ?? 'Biosecurity Act 1993 s.128',
    speciesIdentified:  notice.species_identified ?? '',
    infestationLocation: notice.infestation_location ?? '',
    requiredActions:    notice.required_actions ?? '',
    complyBy:           notice.comply_by ? new Date(notice.comply_by) : null,
    penaltyAmountNzd:   notice.penalty_amount_nzd ?? null,
    notes:              notice.notes ?? '',
    issuedAt:           new Date(notice.created_at),
    officerName,
    officerRole,
    orgName:            org?.name ?? '',
    orgContact,
  })

  return jsonResponse({ success: true, html, notice_number: notice.notice_number }, req)
}))

// ─── HTML Builder ─────────────────────────────────────────────────────────────

const NOTICE_META: Record<string, { label: string; abbr: string; colour: string; bg: string }> = {
  notice_of_direction: { label: 'Notice of Direction',   abbr: 'NOD', colour: '#14532d', bg: '#f0fdf4' },
  infringement_notice: { label: 'Infringement Notice',   abbr: 'INF', colour: '#7f1d1d', bg: '#fef2f2' },
  formal_warning:      { label: 'Formal Warning',        abbr: 'FW',  colour: '#78350f', bg: '#fffbeb' },
}

function buildBiosecurityNoticeHtml(p: {
  noticeNumber: string; noticeType: string; recipientName: string;
  recipientAddress: string; recipientPhone: string; offenceDescription: string;
  actSection: string; speciesIdentified: string; infestationLocation: string;
  requiredActions: string; complyBy: Date | null; penaltyAmountNzd: number | null;
  notes: string; issuedAt: Date; officerName: string; officerRole: string;
  orgName: string; orgContact: string;
}): string {
  const esc = (s: string | null | undefined) =>
    String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const nzDate = (d: Date) =>
    d.toLocaleDateString('en-NZ', { day:'2-digit', month:'long', year:'numeric', timeZone:'Pacific/Auckland' })
  const nzTime = (d: Date) =>
    d.toLocaleTimeString('en-NZ', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Pacific/Auckland' })

  const m = NOTICE_META[p.noticeType] ?? NOTICE_META['notice_of_direction']
  const penaltyBlock = p.penaltyAmountNzd ? `
    <div style="border:2px solid ${m.colour};padding:10pt;margin:10pt 0;background:${m.bg};">
      <div style="font-weight:bold;font-size:9pt;text-transform:uppercase;color:${m.colour};margin-bottom:4pt;">Financial Penalty</div>
      <div style="font-size:11pt;">Infringement fee: <strong>NZD $${p.penaltyAmountNzd.toFixed(2)}</strong></div>
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
      <div style="font-size:9pt;font-weight:bold;color:#555;margin-top:6pt">BIOSECURITY ENFORCEMENT NOTICE</div>
      <div style="font-size:9pt;color:#555">Biosecurity Act 1993 (New Zealand)</div>
    </div>
    <div style="text-align:right">
      <div class="notice-abbr">${esc(m.abbr)}</div>
      <div class="notice-type">${esc(m.label)}</div>
      <div class="notice-meta">${esc(p.noticeNumber)}<br>${nzDate(p.issuedAt)} at ${nzTime(p.issuedAt)}</div>
    </div>
  </div>
  <div style="border-left:4px solid ${m.colour};padding:6pt 10pt;margin:8pt 0;background:${m.bg}">
    <div style="font-size:8pt;font-weight:bold;text-transform:uppercase;color:${m.colour}">Statutory Authority</div>
    <div style="font-size:10pt">${esc(p.actSection)}</div>
  </div>
  <div class="stitle">Party Served</div>
  <div class="frow">
    <div class="field"><span class="fl">Name</span><span class="fv">${esc(p.recipientName) || '&nbsp;'}</span></div>
    <div class="field"><span class="fl">Phone</span><span class="fv">${esc(p.recipientPhone) || '&nbsp;'}</span></div>
  </div>
  <div class="frow"><div class="field"><span class="fl">Address / Property</span><span class="fv">${esc(p.recipientAddress) || '&nbsp;'}</span></div></div>
  <div class="stitle">Species Identified &amp; Infestation Location</div>
  <div class="frow">
    <div class="field"><span class="fl">Species</span><span class="fv">${esc(p.speciesIdentified) || 'Chilean Needlegrass (Nassella neesiana)'}</span></div>
    <div class="field"><span class="fl">Location on Property</span><span class="fv">${esc(p.infestationLocation) || '&nbsp;'}</span></div>
  </div>
  <div class="stitle">Description of Offence / Breach</div>
  <div class="box">${esc(p.offenceDescription).replace(/\n/g,'<br>') || '&nbsp;'}</div>
  <div class="stitle">Required Actions</div>
  <div class="box">${esc(p.requiredActions).replace(/\n/g,'<br>') || '&nbsp;'}</div>
  ${p.complyBy ? `<div class="comply-box">
    <div style="font-size:9pt;font-weight:bold;text-transform:uppercase;color:${m.colour};margin-bottom:4pt">Direction: Comply By</div>
    <div class="comply-time">${nzDate(p.complyBy)} by ${nzTime(p.complyBy)}</div>
  </div>` : ''}
  ${penaltyBlock}
  ${p.notes ? `<div style="margin-top:4pt;font-size:9.5pt"><strong>Notes:</strong> ${esc(p.notes).replace(/\n/g,'<br>')}</div>` : ''}
  <div class="stitle">Officer Certification</div>
  <div style="font-size:9.5pt;margin:4pt 0 8pt">I, the undersigned authorised officer of ${esc(p.orgName)}, issue this notice pursuant to the Biosecurity Act 1993.</div>
  <div class="sig-row">
    <div class="sig-cell"><div class="sig-line"></div><div class="sig-label"><strong>${esc(p.officerName)}</strong></div><div class="sig-label">${esc(p.officerRole)}</div></div>
    <div class="sig-cell"><div class="sig-line"></div><div class="sig-label">Recipient Acknowledgement (if applicable)</div><div class="sig-label" style="margin-top:4pt">Date: ____________________</div></div>
  </div>
  <div class="footer">${esc(m.label)} ${esc(p.noticeNumber)} | ${esc(p.orgName)} | ${nzDate(p.issuedAt)} | Biosecurity Act 1993</div>
</div></body></html>`
}
