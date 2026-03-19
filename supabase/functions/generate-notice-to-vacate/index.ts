import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.0.0/mod.ts';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Generate Notice to Vacate Edge Function
 * Creates customized legal notices based on zone configuration
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { 
      zoneId,
      plateNumber,
      vehicleId,
      nightsStayed,
      breachDate,
      breachDetails,
      issuedBy,
      deliveryMethod,
      deliverToEmail,
      deliverToOfficer,
      breachAlertId,
    } = await req.json();

    console.log('📝 Generating Notice to Vacate:', { zoneId, plateNumber, nightsStayed });

    // 1. Get zone legal configuration
    const { data: legalConfig, error: configError } = await supabaseAdmin
      .from('zone_legal_config')
      .select('*, zones(name, organization_id)')
      .eq('zone_id', zoneId)
      .single();

    if (configError || !legalConfig) {
      throw new Error('Legal configuration not found for this zone');
    }

    // Validate all required legal configuration fields are present
    const requiredFields = ['land_owner', 'legal_description', 'org_street_address', 'authorized_signatories'];
    const missingFields = requiredFields.filter(field => !legalConfig[field]);
    if (missingFields.length > 0) {
      throw new Error(`Legal configuration incomplete for zone. Missing: ${missingFields.join(', ')}`);
    }

    // 2. Get issuing user details
    const { data: issuingUser, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('first_name, last_name, email, role')
      .eq('id', issuedBy)
      .single();

    if (userError || !issuingUser) {
      throw new Error('Issuing user not found');
    }

    // Only admins can issue notices
    if (!['admin', 'master'].includes(issuingUser.role)) {
      throw new Error('Only administrators can issue Notice to Vacate');
    }

    // 3. Get first authorized signatory
    const authorizedSignatories = legalConfig.authorized_signatories || [];
    const signatory = authorizedSignatories.length > 0 ? authorizedSignatories[0] : null;

    if (!signatory) {
      throw new Error('No authorized signatory configured for this zone');
    }

    // 4. Generate breach reason text
    const breachReason = generateBreachReason(legalConfig, nightsStayed, breachDetails);

    // 5. Calculate vacate deadline
    const vacateDeadline = new Date();
    vacateDeadline.setHours(vacateDeadline.getHours() + (legalConfig.vacate_hours || 4));

    // 6. Fetch org logo
    let orgLogoUrl = ''
    const orgId = (legalConfig.zones as any)?.organization_id
    if (orgId) {
      const { data: orgData } = await supabaseAdmin
        .from('organizations')
        .select('logo_url')
        .eq('id', orgId)
        .single()
      orgLogoUrl = orgData?.logo_url ?? ''
    }
    const appOrigin = req.headers.get('origin') ?? 'https://www.ironeaglesecurity.co.nz'

    // 7. Generate notice HTML
    const noticeHtml = generateNoticeHtml({
      legalConfig,
      plateNumber,
      breachReason,
      nightsStayed,
      vacateDeadline,
      signatory,
      zone: legalConfig.zones,
      orgLogoUrl,
      appOrigin,
    });

    // 8. Create notice record
    const { data: notice, error: noticeError } = await supabaseAdmin
      .from('notices_to_vacate')
      .insert({
        organization_id: legalConfig.organization_id,
        zone_id: zoneId,
        vehicle_id: vehicleId,
        plate_number: plateNumber,
        recipient_name: `The Owner / Occupier of the vehicle with registration ${plateNumber}`,
        breach_reason: breachReason,
        nights_stayed: nightsStayed,
        breach_date: breachDate || new Date().toISOString().split('T')[0],
        breach_details: breachDetails || {},
        notice_html: noticeHtml,
        delivery_method: deliveryMethod || 'printed_onsite',
        delivered_to_email: deliverToEmail,
        delivered_to_officer: deliverToOfficer,
        status: 'issued',
        issued_by: issuedBy,
        issued_at: new Date().toISOString(),
        authorized_by: signatory.user_id,
        authorized_at: new Date().toISOString(),
        vacate_deadline: vacateDeadline.toISOString(),
        breach_alert_id: breachAlertId || null,
      })
      .select()
      .single();

    if (noticeError) {
      throw new Error('Failed to create notice record: ' + noticeError.message);
    }

    console.log('✅ Notice created:', notice.reference_number);

    // 9. Create enforcement action record
    const { error: enforcementError } = await supabaseAdmin
      .from('enforcement_actions')
      .insert({
        organization_id: legalConfig.organization_id,
        created_by: issuedBy,
        zone_id: zoneId,
        plate_number: plateNumber,
        action_type: 'notice_to_vacate',
        status: 'issued',
        notes: `Notice to Vacate issued - Reference: ${notice.reference_number}\n\nBreach: ${breachReason}`,
        attachment: {
          type: 'notice_to_vacate',
          notice_id: notice.id,
          reference: notice.reference_number,
        },
      ]), // Native JSONB array, not stringified
      });

    if (enforcementError) {
      console.error('⚠️ Failed to create enforcement action:', enforcementError);
      // Don't throw - notice was created successfully
    } else {
      console.log('✅ Enforcement action created');
    }

    // 10. Send email if delivery method is email and recipient email provided
    if (deliveryMethod === 'email' && deliverToEmail?.trim()) {
      try {
        await sendNoticeToVacateEmailAsync({
          toEmail: deliverToEmail.trim(),
          plateNumber,
          vacateDeadline,
          orgName: legalConfig?.org_office_name || 'Enforcement Authority',
          orgEmail: legalConfig?.org_email || '',
          html: noticeHtml,
        }).catch(err => {
          console.warn(`⚠️ Failed to send notice email to ${deliverToEmail}:`, err.message)
        })
      } catch (emailErr) {
        console.warn(`⚠️ Email dispatch error (notice still created):`, emailErr)
      }
    }

    // 11. Return notice details
    return new Response(
      JSON.stringify({
        success: true,
        notice: {
          id: notice.id,
          reference_number: notice.reference_number,
          html: noticeHtml,
          vacate_deadline: vacateDeadline.toISOString(),
          delivery_method: deliveryMethod,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('❌ Notice generation error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Email Sending Helper
// ──────────────────────────────────────────────────────────────────────────────
async function sendNoticeToVacateEmailAsync(params: {
  toEmail: string
  plateNumber: string
  vacateDeadline: Date
  orgName: string
  orgEmail: string
  html: string
}): Promise<void> {
  const SMTP_TIMEOUT_MS = 15000;
  const smtpHost = Deno.env.get('SMTP_HOST');
  const smtpPort = parseInt(Deno.env.get('SMTP_PORT') ?? '587', 10);
  const smtpUser = Deno.env.get('SMTP_USERNAME');
  const smtpPass = Deno.env.get('SMTP_PASSWORD');
  const smtpFrom = Deno.env.get('SMTP_FROM_EMAIL');
  const smtpFromName = Deno.env.get('SMTP_FROM_NAME') ?? 'FreedomCamp Manager - Enforcement Notices';

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    throw new Error('SMTP not configured');
  }

  const vacateDateStr = params.vacateDeadline.toLocaleString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const subject = `Notice to Vacate – Vehicle ${params.plateNumber}`;
  const text = [
    `Notice to Vacate issued for vehicle: ${params.plateNumber}`,
    '',
    `You must vacate the land by: ${vacateDateStr}`,
    `Issued by: ${params.orgName}`,
    `Contact: ${params.orgEmail}`,
    '',
    'See attached notice for full details and instructions.',
    'This is an automated message. Please do not reply to this email.',
  ].join('\n');

  const client = new SMTPClient();
  const useTls = smtpPort === 465;

  await Promise.race([
    (async () => {
      if (useTls) {
        await client.connectTLS({ hostname: smtpHost, port: smtpPort, username: smtpUser, password: smtpPass });
      } else {
        await client.connect({ hostname: smtpHost, port: smtpPort, username: smtpUser, password: smtpPass });
      }
      try {
        await client.send({
          from: `${smtpFromName} <${smtpFrom}>`,
          to: params.toEmail,
          subject,
          html: params.html,
          content: text,
        });
      } finally {
        await client.close();
      }
    })()
    , new Promise<void>((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), SMTP_TIMEOUT_MS)),
  ]);
}

function generateBreachReason(config: any, nightsStayed: number, breachDetails: any): string {
  const maxNights = config.max_stay_nights || 3;
  
  let reason = `you have not been authorised to occupy this land for longer than the ${maxNights}-night maximum stay`;
  
  if (config.self_contained_required && breachDetails?.not_self_contained) {
    reason += ', and your vehicle does not meet the self-contained requirements';
  }
  
  if (nightsStayed) {
    reason += `. You have stayed ${nightsStayed} night${nightsStayed !== 1 ? 's' : ''}`;
  }
  
  return reason;
}

function generateNoticeHtml(params: any): string {
  const { legalConfig, plateNumber, breachReason, vacateDeadline, signatory, zone, orgLogoUrl = '', appOrigin = '' } = params;
  
  const today = new Date().toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  
  const vacateTime = new Date(vacateDeadline).toLocaleString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const enforcementText = generateEnforcementText(legalConfig);
  const reviewContactSection = generateReviewContactSection(legalConfig, plateNumber, today)
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <base href="${appOrigin}">
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #000;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
    }
    .letterhead {
      margin-bottom: 30px;
    }
    .org-name {
      font-size: 14pt;
      font-weight: bold;
      margin-bottom: 5px;
    }
    .office {
      font-size: 12pt;
      margin-bottom: 20px;
    }
    .address {
      font-size: 10pt;
      line-height: 1.4;
    }
    .reference {
      margin: 20px 0;
      font-weight: bold;
    }
    .date {
      margin-bottom: 30px;
    }
    .recipient {
      margin: 20px 0;
      font-weight: bold;
    }
    .subject {
      margin: 20px 0;
      font-weight: bold;
      text-decoration: underline;
    }
    .content {
      text-align: justify;
      margin: 20px 0;
    }
    .contact-box {
      border: 1px solid #334155;
      background: #f8fafc;
      padding: 12px;
      margin: 20px 0;
      font-size: 10pt;
      line-height: 1.5;
    }
    .contact-title {
      font-size: 9pt;
      text-transform: uppercase;
      font-weight: bold;
      color: #0f172a;
      margin-bottom: 6px;
      letter-spacing: 0.4px;
    }
    .signature-block {
      margin-top: 50px;
    }
    .signature-image {
      max-width: 200px;
      margin: 10px 0;
    }
    .signatory-name {
      font-weight: bold;
    }
    .signatory-title {
      font-style: italic;
    }
    @media print {
      body {
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="letterhead">
    ${orgLogoUrl ? `<img src="${orgLogoUrl}" alt="Organisation logo" style="max-height:60px;max-width:200px;object-fit:contain;display:block;margin-bottom:8px;">` : ''}
    <div class="org-name">${legalConfig.land_owner}</div>
    ${legalConfig.managing_authority ? `<div class="org-name">${legalConfig.managing_authority}</div>` : ''}
    
    <div class="office">${legalConfig.org_office_name}</div>
    
    <div class="address">
      ${legalConfig.org_building ? legalConfig.org_building + '<br>' : ''}
      ${legalConfig.org_street_address}<br>
      ${legalConfig.org_po_box ? legalConfig.org_po_box + '<br>' : ''}
      ${legalConfig.org_city} ${legalConfig.org_postcode}<br>
      ${legalConfig.org_country}<br>
      ${legalConfig.org_phone ? 'T ' + legalConfig.org_phone + '<br>' : ''}
      ${legalConfig.org_fax ? 'F ' + legalConfig.org_fax + '<br>' : ''}
      ${legalConfig.org_email ? 'E ' + legalConfig.org_email + '<br>' : ''}
      ${legalConfig.org_website ? 'W ' + legalConfig.org_website : ''}
    </div>
  </div>

  <div class="date">${today}</div>

  <div class="recipient">
    To: The Owner / Occupier of the vehicle with registration <strong>${plateNumber}</strong> parked on part of the land at ${zone.name}
  </div>

  <div class="subject">
    Re: Unauthorised Occupation of ${zone.name} – Notice to Vacate
  </div>

  <div class="content">
    <p>The above land, legally described as: <strong>${legalConfig.legal_description}</strong>, is held under the ${legalConfig.land_act}. ${legalConfig.land_owner} exercises rights of ownership and has statutory responsibility for such land. ${legalConfig.managing_authority ? 'They are supported in this role by ' + legalConfig.managing_authority + '.' : ''}</p>

    <p>The purpose of this letter is to advise that ${breachReason} at ${zone.name}. Therefore, please remove your vehicle and other belongings from this land by <strong>${vacateTime}</strong>.</p>

    ${enforcementText}

    <p>It is important that you comply with this notice. If you do not, we will take steps to ${legalConfig.enforcement_type === 'trespass' ? 'trespass you from the land and' : ''} remove any vehicles or property. We wish to avoid this.</p>

    ${reviewContactSection}
  </div>

  <div class="signature-block">
    <p>Yours sincerely,</p>
    
    ${signatory.signature_url ? `<img src="${signatory.signature_url}" alt="Signature" class="signature-image">` : '<div style="height: 60px;"></div>'}
    
    <div class="signatory-name">${signatory.name}</div>
    <div class="signatory-title">${signatory.title}</div>
  </div>
  <div style="margin-top:24px;padding-top:8px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:8pt;color:#94a3b8;">Enforcement management by <strong style="color:#1e3a8a;">FreedomCamp Manager</strong> &mdash; Iron Eagle Security / OnSpace AI</span>
    <img src="/iron-eagle-security-logo.jpg" alt="Iron Eagle Security" style="height:24px;opacity:0.55;object-fit:contain;">
  </div>
</body>
</html>
  `;
}

function generateReviewContactSection(config: any, plateNumber: string, issueDateLabel: string): string {
  const email = String(config?.objections_email || config?.org_email || '').trim()
  const phone = String(config?.org_phone || '').trim()
  const postalAddress = [
    config?.objections_postal_address,
  ].filter(Boolean).join(' ').trim()

  const fallbackAddress = [
    config?.org_street_address,
    config?.org_po_box,
    [config?.org_city, config?.org_postcode].filter(Boolean).join(' '),
    config?.org_country,
  ].filter(Boolean).join(', ')

  const resolvedPostal = postalAddress || fallbackAddress
  const lines: string[] = []

  const portalUrl = String(config?.dispute_portal_url || '').trim()

  if (email) lines.push(`<div>Email: ${email}</div>`)
  if (phone) lines.push(`<div>Phone: ${phone}</div>`)
  if (resolvedPostal) lines.push(`<div>Post: ${resolvedPostal}</div>`)
  if (portalUrl) lines.push(`<div><strong>Online dispute portal:</strong> <a href="${portalUrl}" style="color:#1e3a8a;">${portalUrl}</a></div>`)

  if (lines.length === 0) {
    return ''
  }

  return `
  <div class="contact-box">
    <div class="contact-title">How To Request Review / Dispute This Notice</div>
    <div>If you believe this notice is incorrect (including where circumstances such as housing hardship or homelessness may apply), contact the enforcement office using one of the channels below as soon as possible.</div>
    <div style="margin-top: 6px;">
      ${lines.join('')}
    </div>
    <div style="margin-top: 6px; font-size: 9pt; color: #334155;">
      Include your vehicle plate <strong>${plateNumber}</strong> and notice issue date <strong>${issueDateLabel}</strong> in all correspondence.
    </div>
  </div>`
}

function generateEnforcementText(config: any): string {
  const { enforcement_type, trespass_duration_years, fine_amount, enforcement_authority } = config;
  
  if (enforcement_type === 'trespass') {
    return `<p>Failure to comply will result in a trespass notice being issued, and the matter will be referred to ${enforcement_authority || 'the Police'}. Please note that a trespass notice remains in effect for ${trespass_duration_years || 2} years, during which time you will not be permitted to visit any of our freedom camping sites.</p>`;
  } else if (enforcement_type === 'fine') {
    return `<p>Failure to comply may result in a fine of up to $${fine_amount?.toFixed(2) || '200.00'} being issued by ${enforcement_authority || 'Council Compliance Officers'}.</p>`;
  } else if (enforcement_type === 'warning') {
    return `<p>Failure to comply will be recorded, and repeat offences may result in further enforcement action by ${enforcement_authority || 'the appropriate authorities'}.</p>`;
  } else {
    return `<p>Failure to comply will result in enforcement action being taken by ${enforcement_authority || 'the appropriate authorities'}.</p>`;
  }
}
