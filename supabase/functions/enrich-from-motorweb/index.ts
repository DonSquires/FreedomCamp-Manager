import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

const RAILWAY_PROXY_URL = Deno.env.get('RAILWAY_PROXY_URL') || 'https://freedomcamp-manager-production.up.railway.app';

// XML parsing helper - extracts text content from XML tag
function getXmlValue(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

// Extract nested tag value (e.g., <owner-name-parts><first-name>...)
function getNestedXmlValue(xml: string, parentTag: string, childTag: string): string | null {
  const parentRegex = new RegExp(`<${parentTag}[^>]*>(.*?)</${parentTag}>`, 'is');
  const parentMatch = xml.match(parentRegex);
  if (!parentMatch) return null;
  
  const childRegex = new RegExp(`<${childTag}[^>]*>([^<]*)</${childTag}>`, 'i');
  const childMatch = parentMatch[1].match(childRegex);
  return childMatch ? childMatch[1].trim() : null;
}

// Extract attribute value from tag (e.g., <year-of-manufacture value="2021">)
function getXmlAttribute(xml: string, tagName: string, attributeName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*${attributeName}="([^"]*)"`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { plateNumber, specificReason } = await req.json();

    if (!plateNumber) {
      return new Response(
        JSON.stringify({ error: 'plateNumber is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔍 Enriching vehicle from MotorWeb: ${plateNumber}`);

    // Step 1: Call Railway proxy to query MotorWeb API
    const reason = specificReason || 'Freedom Camping Compliance Check';
    const motorwebUrl = `${RAILWAY_PROXY_URL}/motorweb/currentOwnerCheck?plateOrVin=${encodeURIComponent(plateNumber)}&specificReason=${encodeURIComponent(reason)}`;
    
    console.log(`📡 Calling proxy: ${motorwebUrl}`);
    
    const motorwebResponse = await fetch(motorwebUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/xml',
      },
    });

    if (!motorwebResponse.ok) {
      const errorText = await motorwebResponse.text();
      console.error(`❌ MotorWeb API error [${motorwebResponse.status}]:`, errorText);
      
      return new Response(
        JSON.stringify({ 
          error: 'MotorWeb API request failed',
          status: motorwebResponse.status,
          details: errorText,
        }),
        { status: motorwebResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Parse XML response
    const xmlData = await motorwebResponse.text();
    console.log(`📄 Received XML response (${xmlData.length} chars)`);

    // Extract vehicle data
    const vehicleData = {
      plate_number: plateNumber.toUpperCase().trim(),
      vehicle_year: getXmlAttribute(xmlData, 'year-of-manufacture', 'value') || getXmlValue(xmlData, 'year-of-manufacture'),
      vehicle_make: getXmlValue(xmlData, 'make'),
      vehicle_model: getXmlValue(xmlData, 'model'),
      mvr_model: getXmlValue(xmlData, 'mvr-model'),
      vehicle_color: getXmlValue(xmlData, 'colour'),
      body_type: getXmlValue(xmlData, 'body'),
      vin: getXmlValue(xmlData, 'vin'),
      chassis: getXmlValue(xmlData, 'chassis'),
      engine_number: getXmlValue(xmlData, 'engine-number'),
      engine_capacity: getXmlValue(xmlData, 'engine-capacity'),
      transmission: getXmlValue(xmlData, 'transmission'),
      fuel_type: getXmlValue(xmlData, 'fuel'),
      gross_mass: getXmlValue(xmlData, 'gross-mass'),
      wof_expiry: getXmlValue(xmlData, 'wof'),
      licence_expiry: getXmlValue(xmlData, 'licence'),
      registration_status: getXmlValue(xmlData, 'registration'),
      odometer_reading: getXmlValue(xmlData, 'latest-odometer'),
    };

    // Extract owner data
    const ownerData = {
      owner_first_name: getNestedXmlValue(xmlData, 'owner-name-parts', 'first-name'),
      owner_last_name: getNestedXmlValue(xmlData, 'owner-name-parts', 'last-name'),
      owner_company_name: getXmlValue(xmlData, 'owner-name'), // Full name or company
      owner_address_line1: getNestedXmlValue(xmlData, 'address-parts', 'street-number') 
        ? `${getNestedXmlValue(xmlData, 'address-parts', 'street-number')} ${getNestedXmlValue(xmlData, 'address-parts', 'street-name')}`.trim()
        : getXmlValue(xmlData, 'line-1'),
      owner_suburb: getNestedXmlValue(xmlData, 'address-parts', 'suburb'),
      owner_town: getNestedXmlValue(xmlData, 'address-parts', 'town'),
      owner_postcode: getNestedXmlValue(xmlData, 'address-parts', 'post-code'),
      ownership_date: getXmlAttribute(xmlData, 'ownership-date', 'value'),
      owner_status: getXmlAttribute(xmlData, 'owner-status', 'code'),
    };

    console.log('📊 Parsed vehicle data:', vehicleData);
    console.log('👤 Parsed owner data:', ownerData);

    // Step 3: Update canonical_vehicles table
    const { data: existingVehicle, error: fetchError } = await supabaseAdmin
      .from('canonical_vehicles')
      .select('*')
      .eq('plate_number', plateNumber.toUpperCase().trim())
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found (OK to create)
      console.error('Database fetch error:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch vehicle record', details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare update data (only update fields that have values from MotorWeb)
    const updateData: any = {
      nzscv_last_checked: new Date().toISOString(),
      nzscv_source: 'motorweb',
    };

    // Vehicle details
    if (vehicleData.vehicle_year) updateData.vehicle_year = parseInt(vehicleData.vehicle_year);
    if (vehicleData.vehicle_make) updateData.vehicle_make = vehicleData.vehicle_make;
    if (vehicleData.vehicle_model) updateData.vehicle_model = vehicleData.vehicle_model;
    if (vehicleData.vehicle_color) updateData.vehicle_color = vehicleData.vehicle_color;

    // Owner details
    if (ownerData.owner_first_name) updateData.owner_first_name = ownerData.owner_first_name;
    if (ownerData.owner_last_name) updateData.owner_last_name = ownerData.owner_last_name;
    if (ownerData.owner_company_name) {
      // Only set company name if it's not just first+last name concatenated
      const fullNameMatch = `${ownerData.owner_first_name || ''} ${ownerData.owner_last_name || ''}`.trim();
      if (ownerData.owner_company_name !== fullNameMatch) {
        updateData.owner_company_name = ownerData.owner_company_name;
      }
    }
    
    // Owner address
    if (ownerData.owner_address_line1 || ownerData.owner_suburb || ownerData.owner_town || ownerData.owner_postcode) {
      const addressParts = [
        ownerData.owner_address_line1,
        ownerData.owner_suburb,
        ownerData.owner_town,
        ownerData.owner_postcode,
      ].filter(Boolean);
      updateData.owner_address = addressParts.join(', ');
      updateData.owner_address_verified = true; // MotorWeb data is authoritative
    }

    updateData.updated_at = new Date().toISOString();

    // Upsert to canonical_vehicles
    const { data: updatedVehicle, error: updateError } = await supabaseAdmin
      .from('canonical_vehicles')
      .upsert(updateData, {
        onConflict: 'plate_number',
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (updateError) {
      console.error('Database update error:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update vehicle record', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Vehicle enriched successfully: ${plateNumber}`);

    // Step 4: Return enriched data
    return new Response(
      JSON.stringify({
        success: true,
        plate_number: plateNumber.toUpperCase().trim(),
        enriched: true,
        source: 'motorweb',
        timestamp: new Date().toISOString(),
        vehicle_data: vehicleData,
        owner_data: ownerData,
        canonical_record: updatedVehicle,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Enrich from MotorWeb failed:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
