import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ImportRequest {
  fileContent: string;
  fileName: string;
  isImage?: boolean;
  recordDate?: string;
  organizationId?: string;
}

function normalizeTimestamp(input: unknown): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Date-only inputs are anchored to 19:00Z to preserve existing import behavior.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T19:00:00Z`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { fileContent, fileName, isImage, recordDate, organizationId }: ImportRequest = await req.json();

    console.log('Processing import:', { fileName, contentLength: fileContent.length });

    // Use AI to analyze and extract data
    const aiBaseUrl = Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
    const aiApiKey = Deno.env.get('OPENAI_API_KEY');

    if (!aiBaseUrl || !aiApiKey) {
      return new Response(JSON.stringify({ error: 'AI service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiPrompt = `Analyze this data file and extract structured information for a freedom camping management system.

The data may contain:
- Vehicle registration/plate numbers
- Zone/location names
- Dates/timestamps
- Vehicle descriptions
- Notes/descriptions
- Contact information
- Compliance/status information

Return a JSON response with this structure:
{
  "zones": [{"name": "string", "description": "string"}],
  "records": [{
    "zone_name": "string",
    "plate_number": "string",
    "recorded_at": "ISO date string",
    "notes": "string",
    "is_self_contained": boolean or null,
    "is_compliant": boolean or null
  }]
}

Rules:
- Extract all unique zone names
- Normalize plate numbers (uppercase, remove special chars except spaces)
- Parse dates to ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
- If date cannot be determined, use null
- If is_self_contained or is_compliant cannot be determined, use null
- Combine all available information into notes field
- Skip rows with no useful information

File content:
${fileContent}`;

    const aiResponse = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${aiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: aiPrompt,
          },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI service error:', errorText);
      return new Response(JSON.stringify({ error: `AI service error: ${errorText}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiResult = await aiResponse.json();
    const extractedData = JSON.parse(aiResult.choices[0].message.content);

    console.log('AI extracted data:', extractedData);

    // Determine target organization
    let targetOrgId: string;

    if (organizationId) {
      // Use provided organization ID (master user selected one)
      targetOrgId = organizationId;
      console.log('Using provided organization ID:', targetOrgId);
    } else {
      // Get or create "To Sort" organization for non-master users
      let toSortOrg = await supabaseClient
        .from('organizations')
        .select('id')
        .eq('name', 'To Sort')
        .single();

      if (!toSortOrg.data) {
        const { data: newOrg, error: orgError } = await supabaseClient
          .from('organizations')
          .insert({
            name: 'To Sort',
            contact_email: 'tosort@example.com',
            contact_phone: null,
          })
          .select()
          .single();

        if (orgError) {
          console.error('Error creating organization:', orgError);
          return new Response(JSON.stringify({ error: `Failed to create organization: ${orgError.message}` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        targetOrgId = newOrg.id;
        console.log('Created "To Sort" organization:', targetOrgId);
      } else {
        targetOrgId = toSortOrg.data.id;
        console.log('Using existing "To Sort" organization:', targetOrgId);
      }
    }

    // Create zones that don't exist
    const zoneMap = new Map<string, string>();

    if (extractedData.zones && extractedData.zones.length > 0) {
      for (const zone of extractedData.zones) {
        if (!zone.name) continue;

        // Check if zone exists
        const { data: existingZone } = await supabaseClient
          .from('zones')
          .select('id')
          .eq('name', zone.name)
          .eq('organization_id', targetOrgId)
          .single();

        if (existingZone) {
          zoneMap.set(zone.name, existingZone.id);
        } else {
          // Create new zone
          const { data: newZone, error: zoneError } = await supabaseClient
            .from('zones')
            .insert({
              organization_id: targetOrgId,
              name: zone.name,
              description: zone.description || `Imported zone from ${fileName}`,
              self_contained_required: true,
              nights_per_month: 28,
              max_consecutive_nights: 3,
              is_active: true,
            })
            .select()
            .single();

          if (zoneError) {
            console.error('Error creating zone:', zoneError);
            continue;
          }

          zoneMap.set(zone.name, newZone.id);
          console.log('Created zone:', zone.name, newZone.id);
        }
      }
    }

    // Insert vehicle observations (new schema)
    const observationsToInsert = [];
    const skippedRecords = [];

    for (const record of extractedData.records || []) {
      // Must have at least plate number and zone
      if (!record.plate_number || !record.zone_name) {
        skippedRecords.push({ record, reason: 'Missing plate number or zone' });
        continue;
      }

      const zoneId = zoneMap.get(record.zone_name);
      if (!zoneId) {
        skippedRecords.push({ record, reason: `Zone not found: ${record.zone_name}` });
        continue;
      }

      // Prefer explicit request date; otherwise use timestamp fields from source data.
      // Do not default to "now" for legacy imports because that destroys historical timing.
      let timestamp: string | null = null;
      if (recordDate) {
        const dateOnly = recordDate.split('T')[0];
        timestamp = normalizeTimestamp(dateOnly);
      } else {
        timestamp =
          normalizeTimestamp(record.recorded_at) ||
          normalizeTimestamp(record.created_at) ||
          normalizeTimestamp(record.timestamp);
      }

      if (!timestamp) {
        skippedRecords.push({ record, reason: 'Missing/invalid timestamp in source data' });
        continue;
      }

      observationsToInsert.push({
        organization_id: targetOrgId,
        zone_id: zoneId,
        plate_number: record.plate_number.toUpperCase(),
        self_contained: record.is_self_contained ?? false,
        recorded_at: timestamp,
        recorded_by: user.id,
        officer_notes: record.notes || null,
        has_notes: !!record.notes,
        is_compliant: record.is_compliant ?? true,
      });
    }

    let insertedCount = 0;
    const insertErrors = [];

    if (observationsToInsert.length > 0) {
      const { data, error: insertError } = await supabaseClient
        .from('observations')
        .insert(observationsToInsert)
        .select();

      if (insertError) {
        console.error('Error inserting observations:', insertError);
        insertErrors.push(insertError.message);
      } else {
        insertedCount = data?.length || 0;
      }
    }

    const summary = {
      success: true,
      zonesCreated: zoneMap.size,
      observationsInserted: insertedCount,
      recordsSkipped: skippedRecords.length,
      errors: insertErrors,
      details: {
        zones: Array.from(zoneMap.keys()),
        skippedRecords: skippedRecords.slice(0, 10), // First 10 skipped records
      },
    };

    console.log('Import summary:', summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Import error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
