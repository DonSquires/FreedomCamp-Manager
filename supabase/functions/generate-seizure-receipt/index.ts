/**
 * generate-seizure-receipt
 *
 * Generates a printable HTML "Receipt for Goods Seized" document matching the
 * physical carbon-copy forms used by Nelson City Council and Tasman District
 * Council under RMA s.328.
 *
 * POST body:
 *   {
 *     noise_seizure_id,   // UUID — required
 *     issued_by,          // UUID — required
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { noise_seizure_id, issued_by } = await req.json()

    if (!noise_seizure_id) throw new Error('noise_seizure_id is required')
    if (!issued_by) throw new Error('issued_by is required')

    // ── 1. Fetch seizure ─────────────────────────────────────────────────────
    const { data: seizure, error: seizureErr } = await supabaseAdmin
      .from('noise_seizures')
      .select(`
        id, seizure_number, status,
        equipment_description, equipment_count,
        equipment_type, equipment_make, identification_marks,
        equipment_condition, defects_noted,
        owner_name, estimated_value_nzd,
        storage_location, witness_name,
        police_present, police_officer_name,
        notes, seized_at,
        organization_id, seized_by,
        noise_job_id
      `)
      .eq('id', noise_seizure_id)
      .single()

    if (seizureErr || !seizure) throw new Error('Seizure record not found')

    // ── 2. Fetch the officer ─────────────────────────────────────────────────
    const { data: officer } = await supabaseAdmin
      .from('user_profiles')
      .select('first_name, last_name, role')
      .eq('id', issued_by)
      .single()

    // ── 3. Fetch the org ─────────────────────────────────────────────────────
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, contact_email, contact_phone, address')
      .eq('id', seizure.organization_id)
      .single()

    // ── 4. Fetch job address ─────────────────────────────────────────────────
    let jobAddress = ''
    if (seizure.noise_job_id) {
      const { data: job } = await supabaseAdmin
        .from('noise_jobs')
        .select('address, suburb, city')
        .eq('id', seizure.noise_job_id)
        .single()
      if (job) jobAddress = [job.address, job.suburb, job.city].filter(Boolean).join(', ')
    }

    const html = buildReceiptHtml({
      seizureNumber: seizure.seizure_number,
      jobAddress,
      equipmentDescription: seizure.equipment_description ?? '',
      equipmentCount: seizure.equipment_count ?? 1,
      equipmentType: seizure.equipment_type ?? '',
      equipmentMake: seizure.equipment_make ?? '',
      identificationMarks: seizure.identification_marks ?? '',
      equipmentCondition: seizure.equipment_condition ?? '',
      defectsNoted: seizure.defects_noted ?? '',
      ownerName: seizure.owner_name ?? '',
      storageLocation: seizure.storage_location ?? '',
      witnessName: seizure.witness_name ?? '',
      policePresent: seizure.police_present ?? false,
      policeOfficerName: seizure.police_officer_name ?? '',
      estimatedValueNzd: seizure.estimated_value_nzd ?? null,
      notes: seizure.notes ?? '',
      seizedAt: new Date(seizure.seized_at ?? new Date()),
      officerName: officer
        ? `${officer.first_name ?? ''} ${officer.last_name ?? ''}`.trim()
        : 'Noise Control Officer',
      officerRole: deriveOfficerRole(officer?.role ?? null),
      orgName: org?.name ?? '',
      orgAddress: org?.address ?? '',
      orgPhone: org?.contact_phone ?? '',
      orgEmail: org?.contact_email ?? '',
    })

    return new Response(
      JSON.stringify({ success: true, html, seizure_number: seizure.seizure_number }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('generate-seizure-receipt error:', message)
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

const CONDITION_LABELS: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  damaged: 'Damaged',
}

function buildReceiptHtml(p: {
  seizureNumber: string
  jobAddress: string
  equipmentDescription: string
  equipmentCount: number
  equipmentType: string
  equipmentMake: string
  identificationMarks: string
  equipmentCondition: string
  defectsNoted: string
  ownerName: string
  storageLocation: string
  witnessName: string
  policePresent: boolean
  policeOfficerName: string
  estimatedValueNzd: number | null
  notes: string
  seizedAt: Date
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

  const orgContact = [
    p.orgAddress,
    p.orgPhone ? `Ph: ${p.orgPhone}` : null,
    p.orgEmail ? `Email: ${p.orgEmail}` : null,
  ].filter(Boolean).join('&nbsp;&nbsp;|&nbsp;&nbsp;')

  // Condition checkboxes (matching the physical form)
  const conditions = ['excellent', 'good', 'fair', 'poor', 'damaged']
  const conditionBoxes = conditions.map(c =>
    `<span style="margin-right:12pt;">
      <span style="display:inline-block;width:10pt;height:10pt;border:1.5px solid #555;vertical-align:middle;background:${p.equipmentCondition === c ? '#000' : '#fff'};">&nbsp;</span>
      <span style="font-size:9.5pt;margin-left:3pt;">${CONDITION_LABELS[c] ?? c}</span>
    </span>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Receipt for Goods Seized — ${esc(p.seizureNumber)}</title>
  <style>
    @page { size: A4; margin: 14mm 16mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #000; background: #fff; }
    .page { width: 100%; max-width: 178mm; margin: 0 auto; }
    .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #991b1b; padding-bottom: 7pt; margin-bottom: 10pt; }
    .org-name { font-size: 14pt; font-weight: bold; color: #991b1b; }
    .org-contact { font-size: 7.5pt; color: #555; margin-top: 3pt; }
    .doc-title { font-size: 15pt; font-weight: bold; color: #991b1b; text-align: right; }
    .doc-meta { font-size: 9pt; color: #555; text-align: right; margin-top: 3pt; }
    .section-title { font-size: 8.5pt; font-weight: bold; text-transform: uppercase; color: #444; letter-spacing: 0.4pt; margin-bottom: 3pt; margin-top: 8pt; border-bottom: 1px solid #e5e7eb; padding-bottom: 2pt; }
    .field-row { display: flex; gap: 12pt; margin-bottom: 5pt; }
    .field { flex: 1; }
    .fl { display: block; font-size: 7.5pt; color: #666; margin-bottom: 1pt; }
    .fv { display: block; font-size: 10pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; min-height: 14pt; }
    .authority-box { border-left: 4px solid #991b1b; padding: 6pt 10pt; margin: 6pt 0; background: #fef2f2; font-size: 9.5pt; line-height: 1.5; }
    .return-box { border: 2.5px solid #991b1b; padding: 8pt 12pt; margin: 10pt 0; background: #fef2f2; }
    .return-title { font-size: 8.5pt; font-weight: bold; text-transform: uppercase; color: #991b1b; margin-bottom: 4pt; }
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
    <button onclick="window.print()" style="background:#991b1b;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:12px;">🖨️ Print Receipt</button>
    <span style="font-size:12px;color:#64748b;">Receipt for Goods Seized — ${esc(p.seizureNumber)}</span>
  </div>

  <div class="page">
    <!-- Header -->
    <div class="hdr">
      <div>
        <div class="org-name">${esc(p.orgName)}</div>
        <div class="org-contact">${orgContact}</div>
        <div style="font-size:9pt;margin-top:6pt;font-weight:bold;color:#555;">NOISE CONTROL — RMA s.328</div>
      </div>
      <div style="text-align:right;">
        <div class="doc-title">RECEIPT FOR<br>GOODS SEIZED</div>
        <div class="doc-meta">
          Seizure Ref: ${esc(p.seizureNumber)}<br>
          ${nzDate(p.seizedAt)} at ${nzTime(p.seizedAt)}
        </div>
      </div>
    </div>

    <!-- Statutory acknowledgement -->
    <div class="authority-box">
      I hereby acknowledge receipt of the following goods seized pursuant to the provisions of the
      <strong>Resource Management Act 1991</strong>. This receipt is issued under <strong>Section 328</strong>
      following the issue of an Excessive Noise Direction under Section 327.
    </div>

    <!-- Property -->
    <div class="section-title">Address of Property</div>
    <div class="field-row">
      <div class="field">
        <span class="fl">Address where goods were seized</span>
        <span class="fv">${esc(p.jobAddress) || '&nbsp;'}</span>
      </div>
    </div>

    <!-- Equipment details -->
    <div class="section-title">Description of Goods Seized</div>
    <div class="field-row">
      <div class="field">
        <span class="fl">Type (e.g. amplifier, speakers, DJ deck)</span>
        <span class="fv">${esc(p.equipmentType) || '&nbsp;'}</span>
      </div>
      <div class="field">
        <span class="fl">Make / Brand</span>
        <span class="fv">${esc(p.equipmentMake) || '&nbsp;'}</span>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <span class="fl">Identification Marks (serial numbers, stickers, labels)</span>
        <span class="fv">${esc(p.identificationMarks) || '&nbsp;'}</span>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <span class="fl">Full Description (model, colour, cabling, etc.)</span>
        <span class="fv" style="min-height:28pt;">${esc(p.equipmentDescription).replace(/\n/g, '<br>') || '&nbsp;'}</span>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <span class="fl">Number of Items</span>
        <span class="fv">${p.equipmentCount}</span>
      </div>
      ${p.estimatedValueNzd !== null ? `
      <div class="field">
        <span class="fl">Estimated Value (NZD)</span>
        <span class="fv">$${Number(p.estimatedValueNzd).toFixed(2)}</span>
      </div>` : '<div class="field"></div>'}
    </div>

    <!-- Condition -->
    <div class="section-title">Condition of Goods</div>
    <div style="margin: 5pt 0 3pt;">${conditionBoxes}</div>
    ${p.defectsNoted ? `<div style="font-size:9.5pt;margin-top:4pt;"><strong>Defects noted:</strong> ${esc(p.defectsNoted)}</div>` : ''}

    <!-- Owner and storage -->
    <div class="section-title">Custody Details</div>
    <div class="field-row">
      <div class="field">
        <span class="fl">Owner's Name (if known)</span>
        <span class="fv">${esc(p.ownerName) || '&nbsp;'}</span>
      </div>
      <div class="field">
        <span class="fl">Storage Location</span>
        <span class="fv">${esc(p.storageLocation) || '&nbsp;'}</span>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <span class="fl">Witness</span>
        <span class="fv">${esc(p.witnessName) || '&nbsp;'}</span>
      </div>
      <div class="field">
        <span class="fl">Police Present</span>
        <span class="fv">${p.policePresent ? `Yes — ${esc(p.policeOfficerName) || 'Officer name not recorded'}` : 'No'}</span>
      </div>
    </div>

    <!-- Return conditions -->
    <div class="return-box">
      <div class="return-title">⚠ Conditions for Return of Goods</div>
      <ul style="font-size:9.5pt;line-height:1.7;padding-left:14pt;">
        <li>Goods will <strong>not be returned</strong> until at least <strong>72 hours</strong> following seizure.</li>
        <li>A fee of <strong>$150.00</strong> (minimum) is payable before goods are returned.</li>
        <li>The occupier must satisfy the authorised officer that the excessive noise will not recur.</li>
        <li>Contact ${esc(p.orgName)} to arrange return: ${esc(p.orgPhone || p.orgEmail || '')}.</li>
      </ul>
    </div>

    ${p.notes ? `<div style="margin-top:4pt;font-size:9.5pt;color:#444;"><strong>Notes:</strong> ${esc(p.notes).replace(/\n/g, '<br>')}</div>` : ''}

    <!-- Signature block -->
    <div class="sig-row">
      <div class="sig-cell">
        <div class="sig-line"></div>
        <div class="sig-label"><strong>Authorised Officer:</strong> ${esc(p.officerName)}</div>
        <div class="sig-label">${esc(p.officerRole)} — ${esc(p.orgName)}</div>
        <div class="sig-label" style="margin-top:2pt;">Date: ${nzDate(p.seizedAt)}</div>
      </div>
      <div class="sig-cell">
        <div class="sig-line"></div>
        <div class="sig-label">Occupier / Recipient Signature</div>
        <div class="sig-label" style="margin-top:4pt;">Date: ____________________</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      Receipt for Goods Seized ${esc(p.seizureNumber)} | ${esc(p.orgName)} | ${nzDate(p.seizedAt)} |
      Resource Management Act 1991, s.328 | <strong>Keep this receipt — it is required for return of goods.</strong>
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
