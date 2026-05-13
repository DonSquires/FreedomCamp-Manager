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
 *     due_date?,           // Ignored: pay-by is always 28 days from issue date
 *     service_method,      // 'hand' | 'post' | 'email'
 *     recipient_name?,
 *     recipient_email?,
 *     recipient_address?,
 *     summary_of_rights?,  // Custom override; defaults to standard NZ text
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.0.0/mod.ts'
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts'
import { buildAccessibleOrgIds, orgAccessDenied } from '../_shared/orgAccess.ts'

const PRINT_ARTIFACT_BUCKET = 'notice-artifacts'
const FUNCTION_BUILD = 'generate-infringement-2026-03-17f'

function formatDbError(err: { message?: string | null; code?: string | null; details?: string | null; hint?: string | null }) {
  const parts = [
    err.message || 'Database error',
    err.code ? `code=${err.code}` : null,
    err.details ? `details=${err.details}` : null,
    err.hint ? `hint=${err.hint}` : null,
  ].filter(Boolean)
  return parts.join(' | ')
}

function buildFallbackNoticeNumber() {
  const now = new Date()
  const yy = String(now.getUTCFullYear()).slice(-2)
  const epochPart = String(Math.floor(now.getTime() / 1000)).slice(-8)
  const randomPart = Math.floor(Math.random() * 900 + 100).toString()
  return `INF-${yy}-${epochPart}${randomPart}`
}

function extractBearerToken(req: Request): string | null {
  // Accept only standard Authorization header (case-insensitive)
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) return null
  
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

function joinAddressParts(parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(', ')
}

function formatGpsCoordinates(latitude?: number | null, longitude?: number | null) {
  if (latitude == null || longitude == null) return ''
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
}

function deriveOfficerRole(profileRole?: string | null, issuingAuthority?: string | null, enforcementAuthority?: string | null) {
  if (issuingAuthority?.trim()) return issuingAuthority.trim()
  if (enforcementAuthority?.trim()) return enforcementAuthority.trim()

  switch (profileRole) {
    case 'admin_officer':
    case 'officer':
      return 'Warranted Enforcement Officer'
    case 'admin':
      return 'Authorised Enforcement Administrator'
    case 'master':
      return 'Authorised Enforcement Officer'
    default:
      return 'Authorised Enforcement Officer'
  }
}

const NZ_DEFAULT_SUMMARY_OF_RIGHTS = `
NOTES TO DEFENDANT — FREEDOM CAMPING ACT 2011

This infringement notice is issued under the Freedom Camping Act 2011 (FCA) and the Freedom Camping (Penalties for Infringement Offences) Regulations 2023. Your rights and obligations are set out in sections 22–28 of the FCA and section 21 of the Summary Proceedings Act 1957.

YOU MAY:

1. PAY THE INFRINGEMENT FEE (ss 22–23 FCA 2011)
   Pay the fee shown on the front of this notice to the enforcement authority within 28 days of the date of issue. If you pay within 28 days, no further action will be taken in respect of this notice.

2. MAKE OBJECTIONS (s 24 FCA 2011)
   You may write to the enforcement authority within 28 days of the date of issue setting out the circumstances relating to the alleged offence. The enforcement authority will consider your objections and may cancel the notice if satisfied that it should not have been issued. This option does not require you to admit or deny liability.

3. REQUEST A COURT HEARING (s 21 Summary Proceedings Act 1957; s 24 FCA 2011)
   If you deny liability for this offence, send a written notice to the enforcement authority within 28 days of the date of issue requesting that the matter be dealt with by a District Court. Court costs may be awarded against you if you are found guilty by the court.

4. ADMISSION OF LIABILITY WITH SUBMISSIONS (s 24 FCA 2011)
   If you wish to admit liability but want to make written submissions to the court regarding the penalty, write to the enforcement authority within 28 days. Your submissions will be placed before the court. The court may reduce the penalty in light of your circumstances.

IF YOU DO NOTHING
If you do not pay, make objections, or request a hearing within 28 days, a reminder notice may be served for up to 1.5 times the original fee. Continued non-payment may result in the matter being referred to the District Court or the Ministry of Justice for debt collection.

DEFENCES (s 25 FCA 2011)
It is a defence to this infringement notice if you prove on the balance of probabilities that the act or omission was necessary to save life or to prevent serious damage to property.

RENTAL / HIRE VEHICLES (s 26 FCA 2011)
If this vehicle is a hired vehicle and the hirer does not pay the fee immediately, the enforcement officer is required to transfer this notice to the vehicle hire company. The hire company may then seek recovery from the hirer.

PAYMENT AND INQUIRIES
Direct all payments and inquiries regarding this notice to the enforcement authority shown on the front of this notice. Quote the infringement notice number in all correspondence.

This notice is issued pursuant to section 20 of the Freedom Camping Act 2011.
`.trim()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
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
      loi_id,
      offence_description,
      legal_basis,
      offence_date,
      offence_location,
      amount_cents = 40000,
      service_method = 'hand',
      recipient_name,
      recipient_email,
      recipient_address,
      summary_of_rights,
      vehicle_make,
      vehicle_model,
    } = body

    let resolvedZoneId: string | null = zone_id ?? null

    // Validate required fields
    if (!plate_number || !offence_description || !legal_basis) {
      return new Response(
        JSON.stringify({ success: false, error: 'plate_number, offence_description and legal_basis are required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    if (!observation_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Manual infringement notices are not permitted. Issue notices from a recorded observation.' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // Get the calling user's ID from the auth header
    const token = extractBearerToken(req)
    if (!token) {
      const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Authentication required (missing bearer token)',
          hint: 'Ensure the client sends Authorization: Bearer <access_token> when invoking edge functions.',
          build: FUNCTION_BUILD,
          auth_debug: {
            has_authorization_header: Boolean(authHeader),
            authorization_prefix: authHeader ? authHeader.slice(0, 16) : null,
          },
        }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid session',
          details: authError?.message || null,
          build: FUNCTION_BUILD,
        }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // Get issuing officer profile + org
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, first_name, last_name, organization_id, role, warrant_number, warrant_expiry, issuing_authority, employer_organization_id, extra_organization_ids, authorized_work_locations')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ success: false, error: 'Officer profile not found' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    if (!['admin', 'admin_officer', 'master', 'officer'].includes(profile.role)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Insufficient permissions to issue infringement notices' }),
        { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    if (!profile.warrant_number?.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: 'Issuing officer must have a warrant number before an infringement notice can be issued.' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    if (profile.warrant_expiry && profile.warrant_expiry < new Date().toISOString().split('T')[0]) {
      return new Response(
        JSON.stringify({ success: false, error: 'Issuing officer warrant has expired. Renew the warrant before issuing an infringement notice.' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    let observationData: {
      gps_latitude: number | null
      gps_longitude: number | null
      recorded_at: string
      vehicle_make: string | null
      vehicle_model: string | null
      zone_id: string | null
      loi_id: string | null
    } | null = null

    if (observation_id) {
      const { data: observation, error: observationError } = await supabaseAdmin
        .from('observations')
        .select('gps_latitude, gps_longitude, recorded_at, vehicle_make, vehicle_model, zone_id, loi_id')
        .eq('observation_id', observation_id)
        .single()

      if (observationError || !observation) {
        return new Response(
          JSON.stringify({ success: false, error: 'Linked observation was not found. Refresh the page and try again.' }),
          { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        )
      }

      observationData = observation
      resolvedZoneId = resolvedZoneId ?? observation.zone_id ?? null

      if (!resolvedZoneId) {
        const observationLoiId = observation.loi_id ?? loi_id ?? null
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

    if (!resolvedZoneId) {
      return new Response(
        JSON.stringify({ success: false, error: 'zone_id or loi_id is required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // Get zone + org details for the notice letterhead
    const { data: zoneData, error: zoneError } = await supabaseAdmin
      .from('zones')
      .select('id, name, location_lat, location_lng, enforcement_authority, organizations!inner(id, name, address, contact_phone, contact_email, logo_url)')
      .eq('id', resolvedZoneId)
      .single()

    if (zoneError || !zoneData) {
      return new Response(
        JSON.stringify({ success: false, error: 'Selected zone was not found. Please refresh and choose a valid zone.' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const orgName    = (zoneData?.organizations as any)?.name           ?? 'Issuing Authority'
    const orgAddress  = (zoneData?.organizations as any)?.address        ?? ''
    const orgPhone    = (zoneData?.organizations as any)?.contact_phone  ?? ''
    const orgEmail    = (zoneData?.organizations as any)?.contact_email  ?? ''
    const orgLogoUrl  = (zoneData?.organizations as any)?.logo_url       ?? ''
    const zoneOrgId   = (zoneData?.organizations as any)?.id as string | undefined
    const orgId       = profile.organization_id ?? zoneOrgId

    if (!orgId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Could not determine issuing organization for this notice.' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const allowedOrganizationIds = await buildAccessibleOrgIds(supabaseAdmin, profile)

    if (profile.role !== 'master' && zoneOrgId && orgAccessDenied(allowedOrganizationIds, zoneOrgId)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Selected zone is outside your organization scope.' }),
        { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const { data: legalConfig, error: legalConfigError } = await supabaseAdmin
      .from('zone_legal_config')
      .select('org_office_name, org_street_address, org_po_box, org_city, org_postcode, org_phone, org_email, org_website, enforcement_authority, payment_online_url, payment_bank_account, payment_instructions, objections_email, objections_postal_address, dispute_portal_url')
      .eq('zone_id', resolvedZoneId)
      .maybeSingle()

    if (legalConfigError) {
      console.warn('⚠️ zone_legal_config lookup failed', formatDbError(legalConfigError))
    }

    const legalOfficeAddress = joinAddressParts([
      legalConfig?.org_street_address,
      legalConfig?.org_po_box,
      legalConfig?.org_city,
      legalConfig?.org_postcode,
    ])
    const resolvedVehicleMake = vehicle_make ?? observationData?.vehicle_make ?? null
    const resolvedVehicleModel = vehicle_model ?? observationData?.vehicle_model ?? null
    const resolvedGps = formatGpsCoordinates(
      observationData?.gps_latitude ?? zoneData?.location_lat,
      observationData?.gps_longitude ?? zoneData?.location_lng,
    )
    const resolvedOffenceLocation = offence_location?.trim()
      || legalOfficeAddress
      || orgAddress
      || zoneData?.name
      || 'Location not recorded'
    const jurisdictionLabel = zoneData?.name?.trim() || `${orgName} Jurisdiction`
    const officerRoleLabel = deriveOfficerRole(
      profile.role,
      profile.issuing_authority,
      legalConfig?.enforcement_authority ?? zoneData?.enforcement_authority,
    )
    const paymentOnlineUrl = legalConfig?.payment_online_url?.trim() || legalConfig?.org_website?.trim() || ''
    const paymentBankAccount = legalConfig?.payment_bank_account?.trim() || ''
    const paymentInstructions = legalConfig?.payment_instructions?.trim() || ''
    const objectionsEmail = legalConfig?.objections_email?.trim() || legalConfig?.org_email?.trim() || orgEmail || ''
    const objectionsPostalAddress = legalConfig?.objections_postal_address?.trim() || legalOfficeAddress || orgAddress || ''
    const disputePortalUrl = legalConfig?.dispute_portal_url?.trim() || ''
    const paymentMethods = [
      paymentOnlineUrl ? 'online' : null,
      paymentBankAccount ? 'bank_transfer' : null,
      objectionsEmail ? 'email_contact' : null,
    ].filter(Boolean)

    // Generate unique notice number
    const { data: rpcNoticeNumber, error: numError } = await supabaseAdmin
      .rpc('generate_infringement_number', { p_org_id: orgId })

    const noticeNumber = (!numError && rpcNoticeNumber)
      ? String(rpcNoticeNumber)
      : buildFallbackNoticeNumber()

    if (numError || !rpcNoticeNumber) {
      console.warn('⚠️ generate_infringement_number unavailable, using fallback notice number', {
        error: numError ? formatDbError(numError) : 'missing_rpc_result',
        noticeNumber,
      })
    }

    // Calculate dates
    const issuedAt = new Date()
    const offenceDt = offence_date ? new Date(offence_date) : observationData?.recorded_at ? new Date(observationData.recorded_at) : new Date()
    const dueDt = new Date(issuedAt.getTime() + 28 * 24 * 60 * 60 * 1000)

    const rightsText = summary_of_rights || NZ_DEFAULT_SUMMARY_OF_RIGHTS
    const amountDollars = (amount_cents / 100).toFixed(2)

    // ── Generate notice HTML ──────────────────────────────────────────────────
    const noticeHtml = generateNoticeHtml({
      noticeNumber,
      platNumber: plate_number,
      vehicleMake: resolvedVehicleMake,
      vehicleModel: resolvedVehicleModel,
      offenceDescription: offence_description,
      legalBasis: legal_basis,
      offenceDate: offenceDt,
      offenceLocation: resolvedOffenceLocation,
      offenceGps: resolvedGps,
      jurisdiction: jurisdictionLabel,
      amountDollars,
      dueDt,
      serviceMethod: service_method,
      recipientName: recipient_name,
      issuerWarrantNumber: profile.warrant_number,
      issuerRole: officerRoleLabel,
      orgName,
      orgAddress: legalOfficeAddress || orgAddress,
      orgPhone: legalConfig?.org_phone ?? orgPhone,
      orgEmail: legalConfig?.org_email ?? orgEmail,
      paymentOnlineUrl,
      paymentBankAccount,
      paymentInstructions,
      objectionsEmail,
      objectionsPostalAddress,
      disputePortalUrl,
      orgLogoUrl,
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
        zone_id: resolvedZoneId,
        plate_number,
        offence_description,
        legal_basis,
        offence_date: offenceDt.toISOString(),
        offence_location: resolvedOffenceLocation,
        offence_location_gps: resolvedGps || null,
        notice_number: noticeNumber,
        notice_type: 'infringement',
        amount_cents,
        issued_at: issuedAt.toISOString(),
        due_date: dueDt.toISOString().split('T')[0],
        payment_deadline: dueDt.toISOString().split('T')[0],
        payment_methods: paymentMethods.length > 0 ? paymentMethods : null,
        payment_reference: noticeNumber,
        service_method,
        recipient_name: recipient_name ?? null,
        recipient_email: recipient_email ?? null,
        recipient_address: recipient_address ?? null,
        summary_of_rights: rightsText,
        status: 'issued',
        created_by: user.id,
        issued_by: user.id,
        vehicle_make: resolvedVehicleMake,
        vehicle_model: resolvedVehicleModel,
      })
      .select('id, notice_number')
      .single()

    if (insertError) {
      console.error('❌ Insert error:', insertError)
      return new Response(
        JSON.stringify({ success: false, error: formatDbError(insertError) }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
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

    // Send email if service method is email and recipient email provided
    if (service_method === 'email' && recipient_email?.trim()) {
      try {
        await sendInfringementEmailAsync({
          toEmail: recipient_email.trim(),
          recipientName: recipient_name || 'Vehicle Owner',
          noticeNumber,
          plateNumber: plate_number,
          amountDollars,
          orgName,
          orgEmail: legalConfig?.org_email || orgEmail,
          html: noticeHtml,
        }).catch(err => {
          console.warn(`⚠️ Failed to send infringement email to ${recipient_email}:`, err.message)
        })
      } catch (emailErr) {
        console.warn(`⚠️ Email dispatch error (notice still created):`, emailErr)
      }
    }

    console.log(`✅ Infringement notice ${noticeNumber} issued for ${plate_number}`)

    return new Response(
      JSON.stringify({
        success: true,
        notice_id: notice.id,
        notice_number: notice.notice_number,
        html: noticeHtml,
      }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('❌ generate-infringement error:', err)
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
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
// Email Sending Helper
// ──────────────────────────────────────────────────────────────────────────────
async function sendInfringementEmailAsync(params: {
  toEmail: string
  recipientName: string
  noticeNumber: string
  plateNumber: string
  amountDollars: string
  orgName: string
  orgEmail: string
  html: string
}): Promise<void> {
  const SMTP_TIMEOUT_MS = 15000
  const smtpHost = Deno.env.get('SMTP_HOST')
  const smtpPort = parseInt(Deno.env.get('SMTP_PORT') ?? '587', 10)
  const smtpUser = Deno.env.get('SMTP_USERNAME')
  const smtpPass = Deno.env.get('SMTP_PASSWORD')
  const smtpFrom = Deno.env.get('SMTP_FROM_EMAIL')
  const smtpFromName = Deno.env.get('SMTP_FROM_NAME') ?? 'Field Compliance Manager - Enforcement Notices'

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    throw new Error('SMTP not configured')
  }

  const subject = `Infringement Notice ${params.noticeNumber} – Vehicle ${params.plateNumber}`
  const text = [
    `Dear ${params.recipientName},`,
    '',
    `You have received Infringement Notice ${params.noticeNumber} for vehicle ${params.plateNumber}.`,
    `Amount due: NZD $${params.amountDollars}`,
    `Issued by: ${params.orgName}`,
    `Contact: ${params.orgEmail}`,
    '',
    'See attached notice for full details including payment options and rights.',
    'This is an automated message. Please do not reply to this email.',
  ].join('\n')

  const useTls = smtpPort === 465

  const client = new SMTPClient({
    connection: {
      hostname: smtpHost,
      port: smtpPort,
      tls: useTls,
      auth: {
        username: smtpUser,
        password: smtpPass,
      },
    },
  })

  await Promise.race([
    (async () => {
      try {
        await client.send({
          from: `${smtpFromName} <${smtpFrom}>`,
          to: params.toEmail,
          subject,
          html: params.html,
          content: text,
        })
      } finally {
        await client.close()
      }
    })()
    , new Promise<void>((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), SMTP_TIMEOUT_MS)),
  ])
}

// ──────────────────────────────────────────────────────────────────────────────
// HTML Notice Generator (ADR-style two-sided form)
// ──────────────────────────────────────────────────────────────────────────────
function generateNoticeHtml(params: {
  noticeNumber: string
  platNumber: string
  vehicleMake: string | null
  vehicleModel: string | null
  offenceDescription: string
  legalBasis: string
  offenceDate: Date
  offenceLocation: string
  offenceGps: string
  jurisdiction: string
  amountDollars: string
  dueDt: Date
  serviceMethod: string
  recipientName?: string
  issuerWarrantNumber: string
  issuerRole: string
  orgName: string
  orgAddress: string
  orgPhone: string
  orgEmail: string
  orgLogoUrl: string
  paymentOnlineUrl: string
  paymentBankAccount: string
  paymentInstructions: string
  objectionsEmail: string
  objectionsPostalAddress: string
  disputePortalUrl: string
  zoneName: string
  summaryOfRights: string
}): string {
  const nzDate = (d: Date) =>
    d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland' })
  const nzTime = (d: Date) =>
    d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Pacific/Auckland' })

  const vehicleDesc = [params.vehicleMake, params.vehicleModel].filter(Boolean).join(' ') || 'Not recorded'
  const orgContactLines = [
    params.orgAddress,
    params.orgPhone ? `Ph: ${params.orgPhone}` : null,
    params.orgEmail ? `Email: ${params.orgEmail}` : null,
  ].filter(Boolean).join('&nbsp;&nbsp;|&nbsp;&nbsp;')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Infringement Notice ${params.noticeNumber}</title>
  <base href="https://www.ironeaglesecurity.co.nz">
  <style>
    @page { size: A4; margin: 12mm 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #000; background: #fff; }
    .page { width: 100%; max-width: 180mm; margin: 0 auto; }
    .page-break { page-break-before: always; }
    /* Header */
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a8a; padding-bottom: 7pt; margin-bottom: 10pt; }
    .org-name { font-size: 15pt; font-weight: bold; color: #1e3a8a; }
    .org-contact { font-size: 7.5pt; color: #444; margin-top: 3pt; }
    .notice-type { font-size: 18pt; font-weight: bold; color: #dc2626; text-align: right; }
    .notice-meta { font-size: 9pt; color: #444; text-align: right; margin-top: 3pt; }
    /* Plate box */
    .plate-box { border: 3px solid #000; padding: 6pt 14pt; display: inline-block; font-size: 26pt; font-weight: bold; font-family: 'Courier New', monospace; letter-spacing: 4pt; margin: 6pt 0 2pt; background: #fff; }
    /* Sections */
    .section { margin-bottom: 9pt; }
    .section-title { font-weight: bold; font-size: 8.5pt; text-transform: uppercase; color: #444; border-bottom: 1px solid #bbb; padding-bottom: 2pt; margin-bottom: 4pt; letter-spacing: 0.5pt; }
    .field-row { display: flex; gap: 14pt; margin-bottom: 4pt; }
    .field { flex: 1; }
    .field-label { font-size: 7.5pt; color: #666; margin-bottom: 1pt; }
    .field-value { font-size: 10pt; border-bottom: 1px solid #ccc; padding-bottom: 1pt; min-height: 13pt; }
    /* Amount box */
    .amount-box { border: 2.5px solid #dc2626; padding: 7pt 12pt; text-align: center; margin: 8pt 0; background: #fff9f9; }
    .amount-label { font-size: 8.5pt; text-transform: uppercase; color: #dc2626; font-weight: bold; letter-spacing: 0.5pt; }
    .amount-value { font-size: 22pt; font-weight: bold; color: #dc2626; margin: 2pt 0; }
    .amount-due { font-size: 9pt; color: #555; }
    /* Authority payment box */
    .payment-box { border: 1px solid #1e3a8a; padding: 6pt 10pt; margin: 8pt 0; background: #f0f4ff; font-size: 9pt; }
    .payment-box-title { font-weight: bold; color: #1e3a8a; margin-bottom: 3pt; font-size: 8.5pt; text-transform: uppercase; }
    .contact-box { border: 1px solid #334155; padding: 6pt 10pt; margin: 8pt 0; background: #f8fafc; font-size: 9pt; }
    .contact-box-title { font-weight: bold; color: #0f172a; margin-bottom: 3pt; font-size: 8.5pt; text-transform: uppercase; }
    /* Footer */
    .footer { margin-top: 10pt; font-size: 7.5pt; color: #666; border-top: 1px solid #ccc; padding-top: 5pt; }
    /* Rights page */
    .rights-title { font-size: 13pt; font-weight: bold; color: #1e3a8a; margin-bottom: 10pt; border-bottom: 2px solid #1e3a8a; padding-bottom: 4pt; }
    .rights-text { font-size: 9.5pt; line-height: 1.55; white-space: pre-wrap; }
    /* Print bar */
    @media screen { .print-bar { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px; margin-bottom: 14pt; display: flex; gap: 8px; align-items: center; border-radius: 6px; } }
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

    <!-- Header: enforcement authority + notice title -->
    <div class="header">
      <div>
        ${params.orgLogoUrl ? `<img src="${params.orgLogoUrl}" alt="${params.orgName}" style="max-height:56px;max-width:200px;object-fit:contain;display:block;margin-bottom:5pt;">` : ''}
        <div class="org-name">${params.orgName}</div>
        <div style="font-size:8.5pt;color:#1e3a8a;font-weight:bold;margin-top:1pt;">Freedom Camping Act 2011 — Infringement Notice</div>
        ${orgContactLines ? `<div class="org-contact">${orgContactLines}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div class="notice-type">INFRINGEMENT NOTICE</div>
        <div class="notice-meta">Notice No: <strong>${params.noticeNumber}</strong></div>
        <div class="notice-meta">Date Issued: <strong>${nzDate(new Date())}</strong></div>
        <div class="notice-meta">Time Issued: <strong>${nzTime(new Date())}</strong></div>
      </div>
    </div>

    <!-- Vehicle details -->
    <div class="section">
      <div class="section-title">Vehicle Identification</div>
      <div class="field-row">
        <div class="field" style="flex:0 0 auto;">
          <div class="field-label">Registration Plate</div>
          <div class="plate-box">${params.platNumber}</div>
        </div>
        <div class="field" style="padding-top:6pt;">
          <div class="field-row" style="margin-bottom:0;">
            <div class="field">
              <div class="field-label">Vehicle Make</div>
              <div class="field-value">${params.vehicleMake ?? '&nbsp;'}</div>
            </div>
            <div class="field">
              <div class="field-label">Vehicle Model</div>
              <div class="field-value">${params.vehicleModel ?? '&nbsp;'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Offence details -->
    <div class="section">
      <div class="section-title">Alleged Offence</div>
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
        <div class="field-label">Jurisdiction</div>
        <div class="field-value">${params.jurisdiction}</div>
      </div>
      <div class="field" style="margin-bottom:4pt;">
        <div class="field-label">Location of Offence (recorded address / locality)</div>
        <div class="field-value">${params.offenceLocation}</div>
      </div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">GPS Coordinates</div>
          <div class="field-value">${params.offenceGps || '&nbsp;'}</div>
        </div>
        <div class="field">
          <div class="field-label">Zone</div>
          <div class="field-value">${params.zoneName || '&nbsp;'}</div>
        </div>
      </div>
      <div class="field" style="margin-bottom:4pt;">
        <div class="field-label">Nature of Alleged Offence</div>
        <div class="field-value" style="font-weight:bold;">${params.offenceDescription}</div>
      </div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Legal Basis</div>
          <div class="field-value">${params.legalBasis}</div>
        </div>
        <div class="field">
          <div class="field-label">Offence Reference No.</div>
          <div class="field-value">${params.noticeNumber}-01</div>
        </div>
      </div>
    </div>

    <!-- Fine amount -->
    <div class="amount-box">
      <div class="amount-label">Infringement Fee Payable</div>
      <div class="amount-value">NZD $${params.amountDollars}</div>
      <div class="amount-due">Payment due within 28 days — by <strong>${nzDate(params.dueDt)}</strong></div>
    </div>

    <!-- Payment authority -->
    <div class="payment-box">
      <div class="payment-box-title">How To Pay This Infringement</div>
      <div>${params.orgName}${params.orgAddress ? ' &mdash; ' + params.orgAddress : ''}</div>
      ${params.orgPhone ? `<div>Phone: ${params.orgPhone}</div>` : ''}
      ${params.orgEmail ? `<div>Email: ${params.orgEmail}</div>` : ''}
      ${params.paymentOnlineUrl ? `<div>Online payment: ${params.paymentOnlineUrl}</div>` : ''}
      ${params.paymentBankAccount ? `<div>Bank account: ${params.paymentBankAccount}</div>` : ''}
      ${params.paymentInstructions ? `<div style="margin-top:3pt;">${params.paymentInstructions}</div>` : ''}
      <div style="margin-top:3pt;font-size:8.5pt;color:#444;">Quote infringement notice number <strong>${params.noticeNumber}</strong> in all correspondence.</div>
    </div>

    <div class="contact-box">
      <div class="contact-box-title">How To Lodge An Objection</div>
      ${params.objectionsEmail ? `<div>Email objections to: ${params.objectionsEmail}</div>` : ''}
      ${params.objectionsPostalAddress ? `<div>Post objections to: ${params.objectionsPostalAddress}</div>` : ''}
      ${!params.objectionsEmail && !params.objectionsPostalAddress ? `<div>Send written objections to ${params.orgName} using the contact details above.</div>` : ''}
      <div style="margin-top:3pt;font-size:8.5pt;color:#444;">Written objections must quote notice number <strong>${params.noticeNumber}</strong> and be sent within 28 days.</div>
      ${params.disputePortalUrl ? `<div style="margin-top:5pt;"><strong>Online dispute portal:</strong> <a href="${params.disputePortalUrl}" style="color:#1e3a8a;">${params.disputePortalUrl}</a></div>` : ''}
    </div>

    <!-- Issued to / service -->
    <div class="section">
      <div class="section-title">Issued To</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Name (if known)</div>
          <div class="field-value">${params.recipientName ?? 'Owner / Registered Operator of Vehicle'}</div>
        </div>
        <div class="field">
          <div class="field-label">Service Method</div>
          <div class="field-value" style="text-transform:capitalize;">${params.serviceMethod === 'hand' ? 'Hand delivered (on-site)' : params.serviceMethod === 'post' ? 'Posted' : 'Email'}</div>
        </div>
      </div>
    </div>

    <!-- Issuing officer -->
    <div class="section">
      <div class="section-title">Enforcement Officer</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Officer Warrant No.</div>
          <div class="field-value">${params.issuerWarrantNumber}</div>
        </div>
        <div class="field">
          <div class="field-label">Role / Authority</div>
          <div class="field-value">${params.issuerRole}</div>
        </div>
      </div>
      <div class="field-row">
        <div class="field" style="flex:2;">
          <div class="field-label">Officer Signature</div>
          <div class="field-value" style="height:28pt;"></div>
        </div>
        <div class="field">
          <div class="field-label">Date Signed</div>
          <div class="field-value" style="height:28pt;"></div>
        </div>
      </div>
    </div>

    <div class="footer">
      See overleaf for Notes to Defendant (Summary of Rights). This notice is issued under section 20 of the Freedom Camping Act 2011 and/or the applicable territorial authority bylaw.
      Infringement notice number <strong>${params.noticeNumber}</strong> issued by <strong>${params.orgName}</strong> on ${nzDate(new Date())}.
    </div>
    <div style="margin-top:6pt;padding-top:4pt;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:7pt;color:#94a3b8;">Enforcement management by <strong style="color:#1e3a8a;">Field Compliance Manager</strong> &mdash; Iron Eagle Security</span>
      <img src="/iron-eagle-security-logo.jpg" alt="Iron Eagle Security" style="height:22px;opacity:0.55;object-fit:contain;">
    </div>
  </div>

  <!-- BACK OF NOTICE — Notes to Defendant (page break for print) -->
  <div class="page page-break">
    <div class="rights-title">NOTES TO DEFENDANT — SUMMARY OF RIGHTS</div>
    <div class="rights-text">${params.summaryOfRights}</div>
    <div class="footer" style="margin-top:20pt;">
      Notice No: ${params.noticeNumber}&nbsp;&nbsp;|&nbsp;&nbsp;Vehicle: ${params.platNumber} ${vehicleDesc}&nbsp;&nbsp;|&nbsp;&nbsp;Issued: ${nzDate(new Date())}&nbsp;&nbsp;|&nbsp;&nbsp;${params.orgName}
    </div>
  </div>
</body>
</html>`
}
