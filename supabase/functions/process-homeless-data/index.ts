import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';
import { bobChat } from '../_shared/bobInfer.ts';

interface HomelessRecord {
  last_known_site: string;
  date: string;
  vehicle_description: string;
  name_contact: string;
  confirmed_homeless: 'yes' | 'no' | 'unknown' | 'possibly';
  raw_status: string;
  safety_concern: boolean;
  safety_description: string;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const { data: tableData } = await req.json();

    if (!tableData || !Array.isArray(tableData)) {
      throw new Error('Invalid input: expected array of table data');
    }

    console.log('📊 Processing homeless status data:', tableData.length, 'records');

    // Initialize Supabase client with service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('🤖 Using Bob/Ollama to parse and normalize data...');

    // Prepare prompt to extract structured data
    const systemContent = `You are a data normalization and safety analysis expert. Extract vehicle plate numbers, homeless status, and DETECT SAFETY CONCERNS from messy data.

Output ONLY valid JSON array with this exact structure:
[
  {
    "plate_number": "ABC123",
    "last_known_site": "Site Name",
    "date": "2025-01-15",
    "vehicle_description": "description",
    "name_contact": "name",
    "confirmed_homeless": "yes" | "no" | "unknown" | "possibly",
    "raw_status": "original status text",
    "safety_concern": true/false,
    "safety_description": "extracted safety concern details or empty string"
  }
]

Rules:
- Extract ONLY valid New Zealand plate numbers (remove spaces, special chars)
- Normalize homeless status:
  - "Yes" → "yes"
  - "No" → "no"
  - "?" or empty or "NaN" → "unknown"
  - "possibly" or "doubt" or contains question → "possibly"
- Skip records with no valid plate number
- Normalize dates to YYYY-MM-DD format
- Replace "NaN" or empty values with null or empty string

🚨 SAFETY CONCERN DETECTION:
Set "safety_concern": true if text contains ANY of these indicators:
- Abusive language/behavior: "abusive", "abuse", "verbal abuse", "verbally abusive"
- Aggression: "aggressive", "aggression", "hostile", "confrontational"
- Violence: "violent", "violence", "physical", "assault"
- Threats: "threat", "threaten", "intimidate"

Extract and include the EXACT text describing the behavior in "safety_description"`;

    const bobResult = await bobChat({
      message: `Parse this table data:\n\n${JSON.stringify(tableData, null, 2)}`,
      systemPrompt: systemContent,
      temperature: 0.1,
    });

    const aiContent = bobResult.response;

    if (!aiContent) {
      throw new Error('AI returned empty response');
    }

    console.log('🤖 AI Response:', aiContent);

    // Parse AI response (remove markdown code blocks if present)
    let parsedRecords: HomelessRecord[];
    try {
      const jsonMatch = aiContent.match(/```json\n([\s\S]*?)\n```/) || 
                        aiContent.match(/\[[\s\S]*\]/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : aiContent;
      parsedRecords = JSON.parse(jsonStr);
    } catch (error) {
      console.error('Failed to parse AI response:', aiContent);
      throw new Error('AI response was not valid JSON');
    }

    console.log('✅ AI parsed', parsedRecords.length, 'valid records');

    // Get system user for automated actions
    const { data: authData } = await supabaseAdmin.auth.getUser();
    const systemUserId = authData?.user?.id;

    // Process each record
    const results = {
      processed: 0,
      matched: 0,
      updated: 0,
      created: 0,
      skipped: 0,
      flagged_vehicles: 0,
      incidents_created: 0,
      errors: [] as string[],
    };

    for (const record of parsedRecords) {
      try {
        results.processed++;

        if (!record.plate_number || record.plate_number === 'NaN') {
          results.skipped++;
          continue;
        }

        // Normalize plate number
        const plateNumber = record.plate_number.toUpperCase().replace(/\s+/g, '');

        console.log(`🔍 Processing plate: ${plateNumber}`);

        // Find matching canonical vehicle
        const { data: canonicalVehicle, error: searchError } = await supabaseAdmin
          .from('canonical_vehicles')
          .select('plate_number, homeless_status, homeless_confirmed, homeless_confirmed_at, homeless_confirmed_by')
          .eq('plate_number', plateNumber)
          .single();

        if (searchError) {
          console.log(`⚠️ No canonical vehicle found for ${plateNumber}`);
          results.skipped++;
          continue;
        }

        results.matched++;

        // Determine homeless status based on AI-normalized data
        let homeless_claimed = false;
        let homeless_confirmed: boolean | null = null;

        switch (record.confirmed_homeless) {
          case 'yes':
            homeless_claimed = true;
            homeless_confirmed = true;
            break;
          case 'no':
            homeless_claimed = false;
            homeless_confirmed = false;
            break;
          case 'possibly':
            homeless_claimed = true;
            homeless_confirmed = null; // Pending admin review
            break;
          case 'unknown':
          default:
            homeless_claimed = false;
            homeless_confirmed = null;
            break;
        }

        const currentStatus = String(canonicalVehicle.homeless_status ?? '').toLowerCase()
        const homelessStatus = homeless_confirmed === true
          ? 'confirmed'
          : homeless_confirmed === false
          ? 'declined'
          : homeless_claimed
          ? 'claimed'
          : 'freedom_camper'

        // Update canonical vehicle homeless status
        const needsUpdate =
          currentStatus !== homelessStatus ||
          canonicalVehicle.homeless_confirmed !== homeless_confirmed;

        if (needsUpdate) {

          const { error: updateError } = await supabaseAdmin
            .from('canonical_vehicles')
            .update({
              homeless_status: homelessStatus,
              homeless_confirmed: homeless_confirmed,
              homeless_confirmed_at: homeless_confirmed !== null ? new Date().toISOString() : null,
              homeless_confirmed_by: homeless_confirmed !== null ? systemUserId : null,
              homeless_notes: `Auto-imported from homeless status list. Site: ${record.last_known_site || 'Unknown'}. Original status: "${record.raw_status}". Contact: ${record.name_contact || 'Unknown'}.`,
            })
            .eq('plate_number', plateNumber);

          if (updateError) {
            throw updateError;
          }

          results.updated++;
          console.log(`✅ Updated ${plateNumber}: status=${homelessStatus}, confirmed=${homeless_confirmed}`);
        } else {
          console.log(`⏭️ Skipped ${plateNumber}: already up-to-date`);
        }

        // Find most recent observation once so we can scope downstream records.
        const { data: recentObs } = await supabaseAdmin
          .from('observations')
          .select('organization_id, zone_id, loi_id, recorded_at')
          .eq('plate_number', plateNumber)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .single();

        // Maintain an auditable homeless_records row for compliance/reporting.
        if (recentObs?.organization_id && ['claimed', 'confirmed', 'suspected', 'declined'].includes(homelessStatus)) {
          const nowIso = new Date().toISOString();
          const { error: homelessUpsertError } = await supabaseAdmin
            .from('homeless_records')
            .upsert(
              {
                organization_id: recentObs.organization_id,
                plate_number: plateNumber,
                status: homelessStatus,
                source: 'process-homeless-data',
                notes: `Auto-imported from homeless status list. Site: ${record.last_known_site || 'Unknown'}. Original status: "${record.raw_status}". Contact: ${record.name_contact || 'Unknown'}.`,
                first_reported_at: recentObs.recorded_at || nowIso,
                last_reported_at: nowIso,
                is_active: true,
                created_by: systemUserId || null,
                updated_by: systemUserId || null,
                updated_at: nowIso,
              },
              {
                onConflict: 'organization_id,plate_number',
                ignoreDuplicates: false,
              }
            );

          if (homelessUpsertError) {
            console.error(`Failed to upsert homeless record for ${plateNumber}:`, homelessUpsertError);
            results.errors.push(`${plateNumber} homeless record: ${homelessUpsertError.message}`);
          }
        }

        // 🚨 SAFETY CONCERN PROCESSING
        if (record.safety_concern && record.safety_description) {
          console.log(`⚠️ SAFETY CONCERN detected for ${plateNumber}: ${record.safety_description}`);

          if (!recentObs) {
            console.log(`⚠️ No observations found for ${plateNumber}, skipping safety processing`);
            continue;
          }

          const organizationId = recentObs.organization_id;
          let zoneId = recentObs.zone_id;
          const loiId = (recentObs as any).loi_id ?? null;

          if (!zoneId && loiId) {
            const { data: zoneFromLoi } = await supabaseAdmin
              .from('zones')
              .select('id')
              .eq('organization_id', organizationId)
              .eq('loi_id', loiId)
              .eq('is_active', true)
              .limit(1)
              .maybeSingle();
            zoneId = zoneFromLoi?.id ?? null;
          }

          // 1. Create/Update Flagged Vehicle
          try {
            const { data: existingFlag } = await supabaseAdmin
              .from('flagged_vehicles')
              .select('id, notes')
              .eq('organization_id', organizationId)
              .eq('plate_number', plateNumber)
              .single();

            const flagNotes = `⚠️ SAFETY CONCERN: ${record.safety_description}\n\nSite: ${record.last_known_site || 'Unknown'}\nDate: ${record.date || 'Unknown'}\nContact: ${record.name_contact || 'Unknown'}\nSource: Auto-imported homeless data`;

            if (existingFlag) {
              // Update existing flag - append new concern
              const updatedNotes = `${existingFlag.notes || ''}\n\n--- NEW CONCERN (${new Date().toISOString().split('T')[0]}) ---\n${flagNotes}`;
              
              const { error: updateFlagError } = await supabaseAdmin
                .from('flagged_vehicles')
                .update({
                  notes: updatedNotes,
                  priority: 'high',
                  is_active: true,
                  last_known_site: record.last_known_site || null,
                  date_recorded: record.date ? new Date(record.date) : new Date(),
                })
                .eq('id', existingFlag.id);

              if (updateFlagError) throw updateFlagError;
              console.log(`🚩 Updated flagged vehicle: ${plateNumber}`);
            } else {
              // Create new flagged vehicle
              const { error: insertFlagError } = await supabaseAdmin
                .from('flagged_vehicles')
                .insert({
                  organization_id: organizationId,
                  plate_number: plateNumber,
                  last_known_site: record.last_known_site || null,
                  date_recorded: record.date ? new Date(record.date) : new Date(),
                  vehicle_description: record.vehicle_description || null,
                  name_contact: record.name_contact || null,
                  confirmed_homeless: homeless_confirmed,
                  notes: flagNotes,
                  priority: 'high',
                  is_active: true,
                  created_by: systemUserId || null,
                });

              if (insertFlagError) throw insertFlagError;
              console.log(`🚩 Created flagged vehicle: ${plateNumber}`);
            }

            results.flagged_vehicles++;
          } catch (flagError: any) {
            console.error(`Failed to create/update flag for ${plateNumber}:`, flagError);
            results.errors.push(`${plateNumber} flag: ${flagError.message}`);
          }

          // 2. Create Health & Safety Incident Report
          try {
            const { error: incidentError } = await supabaseAdmin
              .from('incidents')
              .insert({
                organization_id: organizationId,
                user_id: systemUserId || null,
                zone_id: zoneId,
                incident_type: 'health_safety',
                description: `🚨 Safety Concern - Aggressive/Abusive Behavior\n\nPlate Number: ${plateNumber}\nLocation: ${record.last_known_site || 'Unknown'}\nDate: ${record.date || 'Unknown'}\nVehicle: ${record.vehicle_description || 'Unknown'}\nContact: ${record.name_contact || 'Unknown'}\n\nBehavior Description:\n${record.safety_description}\n\nOriginal Status: "${record.raw_status}"\n\n⚠️ This incident was auto-generated from homeless data import. Officer should be cautious when approaching this vehicle.`,
                status: 'pending',
                severity: 'high',
                recorded_at: record.date ? new Date(record.date) : new Date(),
                metadata: {
                  source: 'process-homeless-data',
                  loi_id: loiId,
                  imported_site: record.last_known_site || null,
                },
              });

            if (incidentError) throw incidentError;

            results.incidents_created++;
            console.log(`📋 Created H&S incident for ${plateNumber}`);
          } catch (incidentError: any) {
            console.error(`Failed to create incident for ${plateNumber}:`, incidentError);
            results.errors.push(`${plateNumber} incident: ${incidentError.message}`);
          }
        }

      } catch (error: any) {
        console.error(`❌ Error processing ${record.plate_number}:`, error);
        results.errors.push(`${record.plate_number}: ${error.message}`);
      }
    }

    console.log('📊 Processing complete:', results);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        message: `Processed ${results.processed} records. Matched ${results.matched} existing vehicles. Updated ${results.updated} records. Created ${results.flagged_vehicles} safety flags and ${results.incidents_created} H&S incidents.`,
      }),
      { 
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error: any) {
    console.error('❌ Function error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Unknown error',
        details: error.toString(),
      }),
      { 
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
