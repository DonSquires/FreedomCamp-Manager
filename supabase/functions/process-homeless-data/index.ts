import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface HomelessRecord {
  plate_number: string;
  last_known_site: string;
  date: string;
  vehicle_description: string;
  name_contact: string;
  confirmed_homeless: 'yes' | 'no' | 'unknown' | 'possibly';
  raw_status: string;
  safety_concern: boolean;
  safety_description: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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

    // Use OnSpace AI to intelligently parse and normalize the data
    const aiApiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const aiBaseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');

    if (!aiApiKey || !aiBaseUrl) {
      throw new Error('OnSpace AI not configured');
    }

    console.log('🤖 Using AI to parse and normalize data...');

    // Prepare AI prompt to extract structured data
    const aiResponse = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${aiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: `You are a data normalization and safety analysis expert. Extract vehicle plate numbers, homeless status, and DETECT SAFETY CONCERNS from messy data.

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
- Violence: "violent", "violence", "physical", "assault", "attack", "hit", "push", "shove"
- Anger: "angry", "anger", "temper", "rage", "furious"
- Threats: "threat", "threaten", "intimidate", "menacing"
- Weapons: "weapon", "knife", "gun"
- Refusal/Resistance: "refused", "uncooperative" (combined with other negative terms)

Extract and include the EXACT text describing the behavior in "safety_description"`
          },
          {
            role: 'user',
            content: `Parse this table data:\n\n${JSON.stringify(tableData, null, 2)}`
          }
        ],
        temperature: 0.1,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI parsing failed: ${errorText}`);
    }

    const aiResult = await aiResponse.json();
    const aiContent = aiResult.choices[0]?.message?.content;

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

        // Update canonical vehicle homeless status
        const needsUpdate = 
          (homeless_claimed && canonicalVehicle.homeless_status === 'none') ||
          (homeless_claimed && canonicalVehicle.homeless_confirmed !== homeless_confirmed);

        if (needsUpdate) {
          const homelessStatus = homeless_confirmed === true ? 'confirmed' : 
                                homeless_confirmed === false ? 'not_homeless' : 
                                homeless_claimed ? 'claimed' : 'none';

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

        // 🚨 SAFETY CONCERN PROCESSING
        if (record.safety_concern && record.safety_description) {
          console.log(`⚠️ SAFETY CONCERN detected for ${plateNumber}: ${record.safety_description}`);

          // Get the most recent observation for this vehicle to determine org/zone
          const { data: recentObs } = await supabaseAdmin
            .from('observations')
            .select('organization_id, zone_id')
            .eq('plate_number', plateNumber)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .single();

          if (!recentObs) {
            console.log(`⚠️ No observations found for ${plateNumber}, skipping safety processing`);
            continue;
          }

          const organizationId = recentObs.organization_id;
          const zoneId = recentObs.zone_id;

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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
