import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
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

    // 6. Generate notice HTML
    const noticeHtml = generateNoticeHtml({
      legalConfig,
      plateNumber,
      breachReason,
      nightsStayed,
      vacateDeadline,
      signatory,
      zone: legalConfig.zones,
    });

    // 7. Create notice record
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

    // 8. Create enforcement action record
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

    // 9. Return notice details
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
  const { legalConfig, plateNumber, breachReason, vacateDeadline, signatory, zone } = params;
  
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
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
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
  </div>

  <div class="signature-block">
    <p>Yours sincerely,</p>
    
    ${signatory.signature_url ? `<img src="${signatory.signature_url}" alt="Signature" class="signature-image">` : '<div style="height: 60px;"></div>'}
    
    <div class="signatory-name">${signatory.name}</div>
    <div class="signatory-title">${signatory.title}</div>
  </div>
</body>
</html>
  `;
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
