/**
 * generate-noise-notice
 *
 * Generates a printable HTML document for a Noise Control Notice issued under
 * the Resource Management Act 1991 (New Zealand).
 *
 * Supported notice types:
 *   - Abatement Notice (AN)        — RMA s.326
 *   - Direction Notice (DN)        — immediate direction
 *   - Excessive Noise Direction (END) — RMA s.327
 *
 * The function:
 *   1. Looks up the issuing officer and organisation
 *   2. Looks up the noise_notice row (created by the field officer)
 *   3. Builds a print-ready A4 HTML document
 *   4. Returns { html, notice_number }
 *
 * POST body:
 *   {
 *     noise_notice_id,   // UUID — required
 *     issued_by,         // UUID — required (officer who pressed "Print")
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    // Authenticate — only logged-in users may generate notices.
    const authResult = await requireAuth(req);
    if (!authResult.user) {
      return new Response(
        JSON.stringify({ error: authResult.error ?? 'Unauthorized' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { noise_notice_id, issued_by } = await req.json()

    if (!noise_notice_id) throw new Error('noise_notice_id is required')
    if (!issued_by) throw new Error('issued_by is required')

    // ── 1. Fetch the notice ──────────────────────────────────────────────────
    const { data: notice, error: noticeErr } = await supabaseAdmin
      .from('noise_notices')
      .select(`
        id, notice_number, notice_type, status,
        recipient_name, recipient_address,
        offence_description, rma_section,
        comply_by,
        penalty_amount_nzd, notes,
        created_at, issued_at, issuing_officer_id,
        organization_id,
        noise_job_id
      `)
      .eq('id', noise_notice_id)
      .single()

    if (noticeErr || !notice) throw new Error('Notice not found')

    // ── 2. Fetch the issuing officer ─────────────────────────────────────────
    const { data: officer } = await supabaseAdmin
      .from('user_profiles')
      .select('first_name, last_name, email, role')
      .eq('id', issued_by)
      .single()

    // ── 3. Fetch the organisation ────────────────────────────────────────────
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, contact_email, contact_phone, address')
      .eq('id', notice.organization_id)
      .single()

    // ── 4. Fetch the job (for address) ───────────────────────────────────────
    let jobAddress = notice.recipient_address ?? ''
    if (notice.noise_job_id) {
      const { data: job } = await supabaseAdmin
        .from('noise_jobs')
        .select('address, suburb, city')
        .eq('id', notice.noise_job_id)
        .single()
      if (job) {
        jobAddress = [job.address, job.suburb, job.city].filter(Boolean).join(', ')
      }
    }

    // ── 5. Build printable HTML ──────────────────────────────────────────────
    const issuedAt = new Date(notice.issued_at ?? notice.created_at)
    const complyByDatetime = notice.comply_by ?? null
    const complyByHours = notice.comply_by
      ? Math.max(1, Math.round((new Date(notice.comply_by).getTime() - issuedAt.getTime()) / (3600 * 1000)))
      : 72

    const html = buildNoticeHtml({
      noticeNumber: notice.notice_number,
      noticeType: notice.notice_type,
      recipientName: notice.recipient_name ?? '',
      recipientAddress: notice.recipient_address ?? jobAddress,
      offenceDescription: notice.offence_description ?? '',
      rmaSection: notice.rma_section ?? '',
      complyByHours,
      complyByDatetime,
      penaltyAmountNzd: notice.penalty_amount_nzd ?? null,
      notes: notice.notes ?? '',
      issuedAt,
      officerName: officer
        ? `${officer.first_name ?? ''} ${officer.last_name ?? ''}`.trim()
        : 'Authorised Officer',
      officerRole: deriveOfficerRole(officer?.role ?? null),
      orgName: org?.name ?? '',
      orgAddress: org?.address ?? '',
      orgPhone: org?.contact_phone ?? '',
      orgEmail: org?.contact_email ?? '',
    })

    return new Response(
      JSON.stringify({ success: true, html, notice_number: notice.notice_number }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('generate-noise-notice error:', message)
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 400 },
    )
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveOfficerRole(role: string | null): string {
  switch (role) {
    case 'admin_officer':
    case 'officer':
      return 'Noise Control Officer'
    case 'admin':
    case 'master':
      return 'Noise Control Administrator'
    default:
      return 'Noise Control Officer'
  }
}

const NOTICE_LABELS: Record<string, { label: string; abbr: string; colour: string; bg: string }> = {
  abatement_notice:   { label: 'Abatement Notice',             abbr: 'AN',  colour: '#92400e', bg: '#fffbeb' },
  direction_notice:   { label: 'Direction Notice',             abbr: 'DN',  colour: '#1e40af', bg: '#eff6ff' },
  enforcement_notice: { label: 'Excessive Noise Direction',    abbr: 'END', colour: '#991b1b', bg: '#fef2f2' },
}

function buildNoticeHtml(p: {
  noticeNumber: string
  noticeType: string
  recipientName: string
  recipientAddress: string
  offenceDescription: string
  rmaSection: string
  complyByHours: number
  complyByDatetime: string | null
  penaltyAmountNzd: number | null
  notes: string
  issuedAt: Date
  officerName: string
  officerRole: string
  orgName: string
  orgAddress: string
  orgPhone: string
  orgEmail: string
}): string {
  const nzDate = (d: Date) =>
    d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland' })
  const nzTime = (d: Date) =>
    d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Pacific/Auckland' })

  const meta = NOTICE_LABELS[p.noticeType] ?? NOTICE_LABELS['enforcement_notice']

  const orgContact = [
    p.orgAddress,
    p.orgPhone ? `Ph: ${p.orgPhone}` : null,
    p.orgEmail ? `Email: ${p.orgEmail}` : null,
  ].filter(Boolean).join('&nbsp;&nbsp;|&nbsp;&nbsp;')

  // Comply-by calculation
  const complyByDate = p.complyByDatetime
    ? new Date(p.complyByDatetime)
    : new Date(p.issuedAt.getTime() + p.complyByHours * 3600 * 1000)

  const isEND = p.noticeType === 'enforcement_notice'

  const penaltyBlock = isEND ? `
    <div style="border:2px solid ${meta.colour};padding:10pt 12pt;margin:10pt 0;background:${meta.bg};">
      <div style="font-size:8.5pt;font-weight:bold;text-transform:uppercase;color:${meta.colour};margin-bottom:6pt;letter-spacing:0.5pt;">Consequences of Non-Compliance</div>
      <table style="width:100%;border-collapse:collapse;font-size:9.5pt;">
        <tr>
          <td style="padding:2pt 8pt 2pt 0;"><strong>Seizure of equipment</strong></td>
          <td style="padding:2pt 0;">Under RMA s.328, noise-causing equipment may be seized by an authorised officer.</td>
        </tr>
        <tr>
          <td style="padding:2pt 8pt 2pt 0;"><strong>Maximum fine</strong></td>
          <td style="padding:2pt 0;"><strong>$10,000</strong> plus <strong>$1,000</strong> per day of continuing offence.</td>
        </tr>
        <tr>
          <td style="padding:2pt 8pt 2pt 0;"><strong>Infringement Notice</strong></td>
          <td style="padding:2pt 0;"><strong>$500</strong> infringement fee may alternatively be issued.</td>
        </tr>
        <tr>
          <td style="padding:2pt 8pt 2pt 0;"><strong>Equipment return fee</strong></td>
          <td style="padding:2pt 0;">Minimum <strong>$150.00</strong> payable before return. Goods held for at least <strong>72 hours</strong>.</td>
        </tr>
      </table>
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(meta.label)} ${esc(p.noticeNumber)}</title>
  <style>
    @page { size: A4; margin: 14mm 16mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #000; background: #fff; }
    .page { width: 100%; max-width: 178mm; margin: 0 auto; }
    .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${meta.colour}; padding-bottom: 7pt; margin-bottom: 10pt; }
    .org-name { font-size: 14pt; font-weight: bold; color: ${meta.colour}; }
    .org-contact { font-size: 7.5pt; color: #555; margin-top: 3pt; }
    .notice-type { font-size: 17pt; font-weight: bold; color: ${meta.colour}; text-align: right; }
    .notice-abbr { font-size: 28pt; font-weight: bold; color: ${meta.colour}; text-align: right; line-height: 1; }
    .notice-meta { font-size: 9pt; color: #555; text-align: right; margin-top: 3pt; }
    .section-title { font-size: 8.5pt; font-weight: bold; text-transform: uppercase; color: #444; letter-spacing: 0.4pt; margin-bottom: 3pt; margin-top: 10pt; border-bottom: 1px solid #e5e7eb; padding-bottom: 2pt; }
    .field-row { display: flex; gap: 12pt; margin-bottom: 6pt; }
    .field { flex: 1; }
    .fl { display: block; font-size: 7.5pt; color: #666; margin-bottom: 1pt; }
    .fv { display: block; font-size: 10pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; min-height: 14pt; }
    .offence-box { border: 1.5px solid #d1d5db; padding: 8pt 10pt; margin: 6pt 0; background: #f9fafb; font-size: 10.5pt; line-height: 1.5; }
    .rma-box { border-left: 4px solid ${meta.colour}; padding: 6pt 10pt; margin: 8pt 0; background: ${meta.bg}; }
    .rma-box-title { font-size: 8pt; font-weight: bold; text-transform: uppercase; color: ${meta.colour}; margin-bottom: 3pt; }
    .comply-box { border: 2px solid ${meta.colour}; padding: 8pt 12pt; margin: 10pt 0; background: ${meta.bg}; }
    .comply-title { font-size: 9pt; font-weight: bold; text-transform: uppercase; color: ${meta.colour}; margin-bottom: 4pt; }
    .comply-time { font-size: 13pt; font-weight: bold; color: ${meta.colour}; }
    .sig-row { display: flex; gap: 20pt; margin-top: 14pt; }
    .sig-cell { flex: 1; }
    .sig-line { border-bottom: 1px solid #555; height: 22pt; margin-bottom: 3pt; }
    .sig-label { font-size: 7.5pt; color: #666; }
    .footer { margin-top: 10pt; font-size: 7.5pt; color: #666; border-top: 1px solid #ccc; padding-top: 5pt; }
    @media screen { .print-bar { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px; margin-bottom: 14pt; display: flex; gap: 8px; align-items: center; border-radius: 6px; } }
    @media print { .print-bar { display: none; } }
  </style>
</head>
<body>
  <div class="print-bar">
    <button onclick="window.print()" style="background:${meta.colour};color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:12px;">🖨️ Print Notice</button>
    <span style="font-size:12px;color:#64748b;">${esc(meta.label)} ${esc(p.noticeNumber)} — ${nzDate(p.issuedAt)}</span>
  </div>

  <div class="page">
    <!-- Header -->
    <div class="hdr">
      <div>
        <div class="org-name">${esc(p.orgName)}</div>
        <div class="org-contact">${orgContact}</div>
        <div style="font-size:9pt;margin-top:6pt;font-weight:bold;color:#555;">NOISE CONTROL NOTICE</div>
        <div style="font-size:9pt;color:#555;">Resource Management Act 1991</div>
      </div>
      <div style="text-align:right;">
        <div class="notice-abbr">${esc(meta.abbr)}</div>
        <div class="notice-type">${esc(meta.label)}</div>
        <div class="notice-meta">
          ${esc(p.noticeNumber)}<br>
          ${nzDate(p.issuedAt)} at ${nzTime(p.issuedAt)}
        </div>
      </div>
    </div>

    <!-- Statutory authority -->
    <div class="rma-box">
      <div class="rma-box-title">Statutory Authority</div>
      <div style="font-size:10pt;">${esc(p.rmaSection)}</div>
    </div>

    <!-- Recipient + Address -->
    <div class="section-title">Party Served</div>
    <div class="field-row">
      <div class="field">
        <span class="fl">Name (if known)</span>
        <span class="fv">${esc(p.recipientName) || '&nbsp;'}</span>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <span class="fl">Address of Property / Premises</span>
        <span class="fv">${esc(p.recipientAddress) || '&nbsp;'}</span>
      </div>
    </div>

    <!-- Offence -->
    <div class="section-title">Description of Excessive Noise / Offence</div>
    <div class="offence-box">${esc(p.offenceDescription).replace(/\n/g, '<br>') || '&nbsp;'}</div>

    ${p.notes ? `<div style="margin-top:4pt;font-size:9.5pt;color:#444;"><strong>Additional Notes:</strong> ${esc(p.notes).replace(/\n/g, '<br>')}</div>` : ''}

    <!-- Comply by -->
    <div class="comply-box">
      <div class="comply-title">Direction: Comply By</div>
      <div class="comply-time">${nzDate(complyByDate)} by ${nzTime(complyByDate)}</div>
      <div style="font-size:9pt;margin-top:4pt;color:${meta.colour};">
        You are directed to immediately reduce or cease the excessive noise. This direction is in effect for <strong>${p.complyByHours} hours</strong>.
      </div>
    </div>

    ${penaltyBlock}

    <!-- Signature block -->
    <div class="section-title">Officer Certification</div>
    <div style="font-size:9.5pt;margin:4pt 0 8pt;">
      I, the undersigned, being an authorised officer of ${esc(p.orgName)}, hereby issue this notice
      pursuant to the Resource Management Act 1991.
    </div>
    <div class="sig-row">
      <div class="sig-cell">
        <div class="sig-line"></div>
        <div class="sig-label"><strong>Issuing Officer:</strong> ${esc(p.officerName)}</div>
        <div class="sig-label">${esc(p.officerRole)}</div>
      </div>
      <div class="sig-cell">
        <div class="sig-line"></div>
        <div class="sig-label">Recipient Acknowledgement (if applicable)</div>
        <div class="sig-label" style="margin-top:4pt;">Date: ____________________</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      ${esc(meta.label)} ${esc(p.noticeNumber)} | Issued by ${esc(p.orgName)} | ${nzDate(p.issuedAt)} |
      Resource Management Act 1991 | Enquiries: ${esc(p.orgPhone || p.orgEmail || p.orgName)}
    </div>
  </div>
</body>
</html>`
}

function esc(s: string | null | undefined): string {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
