/**
 * generate-warning-notice
 *
 * Creates a formal Warning Notice record and returns printable HTML.
 * This is the first step in the enforcement escalation ladder:
 *   Warning Notice → Notice to Vacate → Infringement Notice
 *
 * Flow:
 *   1. Validates issuing officer (org membership, role)
 *   2. Generates unique warning number via sequence counter
 *   3. Builds printable HTML notice
 *   4. INSERTs enforcement_actions record with action_type='warning'
 *   5. Returns { action_id, warning_number, html }
 *
 * POST body:
 *   {
 *     plate_number,        // Required
 *     zone_id,             // Required
 *     breach_type,         // Required — e.g. "overstay", "prohibited_zone"
 *     breach_reason,       // Required — human-readable description
 *     observation_id?,     // Optional — links to scan evidence
 *     breach_alert_id?,    // Optional — links to breach alert
 *     issued_by,           // Required — user UUID
 *     recipient_name?,
 *     recipient_email?,
 *     additional_notes?,
 *     delivery_method?,    // 'email' | 'physical' (default: 'physical')
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
    // Authenticate — only logged-in users may generate warning notices.
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

    const {
      plate_number,
      zone_id,
      loi_id,
      breach_type,
      breach_reason,
      observation_id,
      breach_alert_id,
      issued_by,
      recipient_name,
      recipient_email,
      additional_notes,
      delivery_method = 'physical',
    } = await req.json()

    let resolvedZoneId: string | null = zone_id ?? null

    // ── Validation ───────────────────────────────────────────────────────────
    if (!plate_number?.trim()) throw new Error('plate_number is required')
    if (!resolvedZoneId && observation_id) {
      const { data: observation } = await supabaseAdmin
        .from('observations')
        .select('zone_id, loi_id')
        .eq('observation_id', observation_id)
        .maybeSingle()

      resolvedZoneId = (observation as any)?.zone_id ?? null

      if (!resolvedZoneId) {
        const observationLoiId = (observation as any)?.loi_id ?? loi_id ?? null
        if (observationLoiId) {
          const { data: zoneFromLoi } = await supabaseAdmin
            .from('zones')
            .select('id')
            .eq('loi_id', observationLoiId)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle()
          resolvedZoneId = zoneFromLoi?.id ?? null
        }
      }
    }

    if (!resolvedZoneId && loi_id) {
      const { data: zoneFromLoi } = await supabaseAdmin
        .from('zones')
        .select('id')
        .eq('loi_id', loi_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      resolvedZoneId = zoneFromLoi?.id ?? null
    }

    if (!resolvedZoneId) throw new Error('zone_id or loi_id is required')
    if (!breach_type?.trim()) throw new Error('breach_type is required')
    if (!breach_reason?.trim()) throw new Error('breach_reason is required')
    if (!issued_by) throw new Error('issued_by is required')

    const plate = plate_number.toUpperCase().trim()

    // ── 1. Get issuing officer ───────────────────────────────────────────────
    const { data: officer, error: officerErr } = await supabaseAdmin
      .from('user_profiles')
      .select('id, first_name, last_name, email, role, organization_id')
      .eq('id', issued_by)
      .single()

    if (officerErr || !officer) {
      throw new Error('Issuing officer not found')
    }

    const orgId = officer.organization_id
    if (!orgId) throw new Error('Issuing officer has no organisation')

    // ── 2. Get zone + org details ────────────────────────────────────────────
    const { data: zone, error: zoneErr } = await supabaseAdmin
      .from('zones')
      .select('id, name, organization_id, loi_id')
      .eq('id', resolvedZoneId)
      .single()

    if (zoneErr || !zone) throw new Error('Zone not found')

    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('id, name, contact_email, contact_phone, address')
      .eq('id', orgId)
      .single()

    if (orgErr || !org) throw new Error('Organisation not found')

    // ── 3. Generate warning number ───────────────────────────────────────────
    // Use enforcement_actions count as a simple sequential reference
    const { count } = await supabaseAdmin
      .from('enforcement_actions')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('action_type', 'warning')

    const year = new Date().getFullYear()
    const seq = String((count ?? 0) + 1).padStart(5, '0')
    const warningNumber = `WRN-${year}-${seq}`

    // ── 4. Insert enforcement_actions record ─────────────────────────────────
    const { data: action, error: actionErr } = await supabaseAdmin
      .from('enforcement_actions')
      .insert({
        organization_id: orgId,
        created_by: issued_by,
        observation_id: observation_id ?? null,
        plate_number: plate,
        zone_id: resolvedZoneId,
        action_type: 'warning',
        status: 'issued',
        notes: [
          `Warning number: ${warningNumber}`,
          `Breach type: ${breach_type}`,
          breach_reason,
          additional_notes,
        ].filter(Boolean).join('\n'),
      })
      .select('id')
      .single()

    if (actionErr || !action) {
      throw new Error(`Failed to create warning record: ${actionErr?.message ?? 'unknown'}`)
    }

    // ── 5. Build HTML notice ──────────────────────────────────────────────────
    const html = buildWarningHtml({
      warningNumber,
      plate,
      zoneName: zone.name,
      breachType: breach_type.replace(/_/g, ' '),
      breachReason: breach_reason,
      additionalNotes: additional_notes ?? '',
      recipientName: recipient_name ?? '',
      recipientEmail: recipient_email ?? '',
      officerName: `${officer.first_name ?? ''} ${officer.last_name ?? ''}`.trim() || 'Enforcement Officer',
      officerRole: deriveOfficerRole(officer.role),
      orgName: org.name,
      orgAddress: org.address ?? '',
      orgPhone: org.contact_phone ?? '',
      orgEmail: org.contact_email ?? '',
      issuedAt: new Date(),
      deliveryMethod: delivery_method,
    })

    return new Response(
      JSON.stringify({
        success: true,
        action_id: action.id,
        warning_number: warningNumber,
        html,
      }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('generate-warning-notice error:', message)
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
      return 'Enforcement Officer'
    case 'admin':
    case 'master':
      return 'Authorised Enforcement Administrator'
    default:
      return 'Enforcement Officer'
  }
}

function buildWarningHtml(p: {
  warningNumber: string
  plate: string
  zoneName: string
  breachType: string
  breachReason: string
  additionalNotes: string
  recipientName: string
  recipientEmail: string
  officerName: string
  officerRole: string
  orgName: string
  orgAddress: string
  orgPhone: string
  orgEmail: string
  issuedAt: Date
  deliveryMethod: string
}): string {
  const nzDate = (d: Date) =>
    d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland' })
  const nzTime = (d: Date) =>
    d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Pacific/Auckland' })

  const orgContact = [p.orgAddress, p.orgPhone ? `Ph: ${p.orgPhone}` : null, p.orgEmail ? `Email: ${p.orgEmail}` : null]
    .filter(Boolean)
    .join('&nbsp;&nbsp;|&nbsp;&nbsp;')

  const recipientBlock = p.recipientName
    ? `<tr><td class="fl"><span class="fl-label">Recipient</span><span class="fl-value">${esc(p.recipientName)}</span></td></tr>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Warning Notice ${esc(p.warningNumber)}</title>
  <style>
    @page { size: A4; margin: 14mm 16mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #000; background: #fff; }
    .page { width: 100%; max-width: 178mm; margin: 0 auto; }
    /* Header */
    .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a8a; padding-bottom: 7pt; margin-bottom: 10pt; }
    .org-name { font-size: 14pt; font-weight: bold; color: #1e3a8a; }
    .org-contact { font-size: 7.5pt; color: #555; margin-top: 3pt; }
    .notice-type { font-size: 17pt; font-weight: bold; color: #f59e0b; text-align: right; }
    .notice-meta { font-size: 9pt; color: #555; text-align: right; margin-top: 3pt; }
    /* Plate */
    .plate-wrap { margin: 8pt 0 4pt; }
    .plate-box { border: 3px solid #000; padding: 5pt 14pt; display: inline-block; font-size: 26pt; font-weight: bold; font-family: 'Courier New', monospace; letter-spacing: 4pt; background: #fff; }
    /* Field list */
    table.fl { width: 100%; border-collapse: collapse; }
    table.fl td { padding: 3pt 4pt; vertical-align: top; }
    .fl-label { display: block; font-size: 7.5pt; color: #666; margin-bottom: 1pt; }
    .fl-value { display: block; font-size: 10pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; min-height: 14pt; }
    /* Warning box */
    .warn-box { border: 2.5px solid #f59e0b; padding: 8pt 12pt; margin: 10pt 0; background: #fffbeb; }
    .warn-box-title { font-size: 9pt; font-weight: bold; text-transform: uppercase; color: #92400e; letter-spacing: 0.5pt; margin-bottom: 4pt; }
    .warn-box-body { font-size: 10.5pt; line-height: 1.5; color: #000; }
    /* Action required */
    .action-box { border: 1.5px solid #1e3a8a; padding: 7pt 11pt; margin: 8pt 0; background: #eff6ff; }
    .action-title { font-size: 9pt; font-weight: bold; text-transform: uppercase; color: #1e3a8a; margin-bottom: 3pt; }
    /* Signature */
    .sig-row { display: flex; gap: 20pt; margin-top: 14pt; }
    .sig-cell { flex: 1; }
    .sig-line { border-bottom: 1px solid #555; height: 22pt; margin-bottom: 3pt; }
    .sig-label { font-size: 7.5pt; color: #666; }
    /* Footer */
    .footer { margin-top: 10pt; font-size: 7.5pt; color: #666; border-top: 1px solid #ccc; padding-top: 5pt; }
    /* Print bar */
    @media screen { .print-bar { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px; margin-bottom: 14pt; display: flex; gap: 8px; align-items: center; border-radius: 6px; } }
    @media print { .print-bar { display: none; } }
  </style>
</head>
<body>
  <div class="print-bar">
    <button onclick="window.print()" style="background:#1e3a8a;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:12px;">🖨️ Print Notice</button>
    <span style="font-size:12px;color:#64748b;">Warning Notice ${esc(p.warningNumber)} — ${esc(p.plate)}</span>
  </div>

  <div class="page">
    <!-- Header -->
    <div class="hdr">
      <div>
        <div class="org-name">${esc(p.orgName)}</div>
        <div class="org-contact">${orgContact}</div>
      </div>
      <div>
        <div class="notice-type">⚠ WARNING NOTICE</div>
        <div class="notice-meta">
          ${esc(p.warningNumber)}<br>
          ${nzDate(p.issuedAt)} at ${nzTime(p.issuedAt)}
        </div>
      </div>
    </div>

    <!-- Vehicle -->
    <div class="plate-wrap">
      <div style="font-size:8.5pt;font-weight:bold;text-transform:uppercase;color:#444;margin-bottom:3pt;">Vehicle Registration</div>
      <div class="plate-box">${esc(p.plate)}</div>
    </div>

    <!-- Details table -->
    <table class="fl" style="margin-top:8pt;">
      <tbody>
        ${recipientBlock}
        <tr>
          <td class="fl"><span class="fl-label">Zone / Location</span><span class="fl-value">${esc(p.zoneName)}</span></td>
          <td class="fl"><span class="fl-label">Breach Type</span><span class="fl-value">${esc(p.breachType)}</span></td>
        </tr>
        <tr>
          <td class="fl" colspan="2"><span class="fl-label">Date &amp; Time Issued</span><span class="fl-value">${nzDate(p.issuedAt)} ${nzTime(p.issuedAt)}</span></td>
        </tr>
      </tbody>
    </table>

    <!-- Warning box -->
    <div class="warn-box">
      <div class="warn-box-title">Reason for this Warning</div>
      <div class="warn-box-body">${esc(p.breachReason).replace(/\n/g, '<br>')}</div>
      ${p.additionalNotes ? `<div style="margin-top:6pt;font-size:9.5pt;color:#444;"><strong>Additional information:</strong><br>${esc(p.additionalNotes).replace(/\n/g, '<br>')}</div>` : ''}
    </div>

    <!-- Action required -->
    <div class="action-box">
      <div class="action-title">Action Required</div>
      <p style="font-size:10pt;">This Warning Notice is issued to advise you that your vehicle is currently in breach of freedom camping regulations at the location shown above.</p>
      <p style="font-size:10pt;margin-top:5pt;"><strong>You are required to comply with the applicable zone regulations immediately.</strong> If your vehicle remains in breach, a formal Notice to Vacate or Infringement Notice may be issued under the Freedom Camping Act 2011.</p>
      <p style="font-size:9pt;margin-top:5pt;color:#555;">If you believe this warning has been issued in error, please contact ${esc(p.orgName)} at the address shown above.</p>
    </div>

    <!-- Signature block -->
    <div class="sig-row">
      <div class="sig-cell">
        <div class="sig-line"></div>
        <div class="sig-label">Enforcement Officer: ${esc(p.officerName)}</div>
        <div class="sig-label" style="margin-top:1pt;">${esc(p.officerRole)}</div>
      </div>
      <div class="sig-cell">
        <div class="sig-line"></div>
        <div class="sig-label">Recipient Acknowledgement (if applicable)</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      Warning Notice ${esc(p.warningNumber)} | Issued by ${esc(p.orgName)} | ${nzDate(p.issuedAt)} |
      This notice does not constitute an infringement under the Freedom Camping Act 2011 but may be used as evidence of prior knowledge in subsequent enforcement action.
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
