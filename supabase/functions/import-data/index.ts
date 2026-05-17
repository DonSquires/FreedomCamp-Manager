import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, getCorsHeaders } from '../_shared/withCors.ts';
import { bobChat } from '../_shared/bobInfer.ts';
import { buildBobContext } from '../_shared/bobContext.ts';

interface ImportRequest {
  fileName: string;
  isImage?: boolean;
  recordDate?: string;
  organizationId?: string;
  auditBucket?: string;
  auditPrefix?: string;
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

Deno.serve(withCors(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
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

    const reqBody = await req.json();
    const {
      fileContent,
      fileName,
      isImage,
      recordDate,
      organizationId,
      auditBucket,
      auditPrefix,
    }: ImportRequest = reqBody;

    const resolvedOrgId =
      organizationId ||
      (user as any)?.user_metadata?.organization_id ||
      (user as any)?.app_metadata?.organization_id ||
      null;

    if (!fileContent || !fileName) {
      return new Response(JSON.stringify({ error: 'Missing required fields: fileContent, fileName' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use Bob/Ollama to analyze and extract data
    console.log('Processing import:', { fileName, contentLength: fileContent.length });

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

    const bobResult = await bobChat({
      message: aiPrompt,
      temperature: 0.1,
      context: buildBobContext({
        operation: 'import-data',
        source: 'data-import-extraction',
        userId: user.id,
        organizationId: resolvedOrgId,
        context: {
          file_name: fileName,
          is_image: Boolean(isImage),
          record_date: recordDate || null,
        },
      }),
    });

    const extractedData = JSON.parse(
      (bobResult.response || '{}').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    );

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
        .select('id, created_at')
        .eq('name', 'To Sort')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

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
    const zoneLoiMap = new Map<string, string | null>();

    if (extractedData.zones && extractedData.zones.length > 0) {
      for (const zone of extractedData.zones) {
        if (!zone.name) continue;

        // Check if zone exists
        const { data: existingZone } = await supabaseClient
          .from('zones')
          .select('id, loi_id')
          .eq('name', zone.name)
          .eq('organization_id', targetOrgId)
          .limit(1)
          .maybeSingle();

        if (existingZone) {
          zoneMap.set(zone.name, existingZone.id);
          zoneLoiMap.set(zone.name, (existingZone as any).loi_id ?? null);
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
          zoneLoiMap.set(zone.name, (newZone as any).loi_id ?? null);
          console.log('Created zone:', zone.name, newZone.id);
        }
      }
    }

    // Insert vehicle observations (new schema)
    const observationsToInsert = [];
    const seenObservationKeys = new Set<string>();
    const skippedRecords = [];

    for (const record of extractedData.records || []) {
      // Must have plate number and either zone name or loi_id
      if (!record.plate_number || (!record.zone_name && !record.loi_id)) {
        skippedRecords.push({ record, reason: 'Missing plate number and zone/loi context' });
        continue;
      }

      let zoneId = record.zone_name ? zoneMap.get(record.zone_name) : undefined;
      let resolvedLoiId: string | null = record.loi_id ?? null;

      if (!zoneId && resolvedLoiId) {
        const { data: zoneFromLoi } = await supabaseClient
          .from('zones')
          .select('id, name, loi_id')
          .eq('organization_id', targetOrgId)
          .eq('loi_id', resolvedLoiId)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (zoneFromLoi) {
          zoneId = zoneFromLoi.id;
          zoneMap.set(zoneFromLoi.name, zoneFromLoi.id);
          zoneLoiMap.set(zoneFromLoi.name, (zoneFromLoi as any).loi_id ?? null);
        }
      }

      if (!resolvedLoiId && record.zone_name) {
        resolvedLoiId = zoneLoiMap.get(record.zone_name) ?? null;
      }

      if (!zoneId) {
        skippedRecords.push({ record, reason: `Zone not found: ${record.zone_name ?? `loi_id=${record.loi_id}`}` });
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

      const plate = String(record.plate_number || '').toUpperCase();
      const day = timestamp.slice(0, 10);
      const idempotencyKey = `import:historical:${targetOrgId}:${zoneId}:${plate}:${day}`;

      if (seenObservationKeys.has(idempotencyKey)) {
        skippedRecords.push({ record, reason: `Duplicate row in file (idempotency key ${idempotencyKey})` });
        continue;
      }
      seenObservationKeys.add(idempotencyKey);

      observationsToInsert.push({
        organization_id: targetOrgId,
        zone_id: zoneId,
        loi_id: resolvedLoiId,
        plate_number: plate,
        self_contained: record.is_self_contained ?? false,
        recorded_at: timestamp,
        recorded_by: user.id,
        idempotency_key: idempotencyKey,
        officer_notes: record.notes || null,
        has_notes: !!record.notes,
        is_compliant: record.is_compliant ?? true,
      });
    }

    let insertedCount = 0;
    let duplicateCount = 0;
    const insertErrors = [];

    if (observationsToInsert.length > 0) {
      for (const row of observationsToInsert) {
        const { data: existingByKey, error: existingErr } = await supabaseClient
          .from('observations')
          .select('id, observation_id')
          .eq('idempotency_key', row.idempotency_key)
          .limit(1)
          .maybeSingle();

        if (existingErr) {
          console.error('Error checking duplicate observation:', existingErr);
          insertErrors.push(existingErr.message);
          continue;
        }

        if (existingByKey) {
          duplicateCount += 1;
          continue;
        }

        const { error: insertError } = await supabaseClient
          .from('observations')
          .insert(row);

        if (insertError) {
          console.error('Error inserting observation row:', insertError);
          insertErrors.push(insertError.message);
        } else {
          insertedCount += 1;
        }
      }
    }

    const summary = {
      success: true,
      zonesCreated: zoneMap.size,
      observationsInserted: insertedCount,
      duplicateObservationsSkipped: duplicateCount,
      recordsSkipped: skippedRecords.length,
      errors: insertErrors,
      details: {
        zones: Array.from(zoneMap.keys()),
        skippedRecords: skippedRecords.slice(0, 10), // First 10 skipped records
      },
    };

    const auditPayload = {
      generated_at: new Date().toISOString(),
      importer: 'import-data',
      source_file: fileName,
      organization_id: targetOrgId,
      metrics: {
        zones_created: zoneMap.size,
        observations_inserted: insertedCount,
        duplicate_observations_skipped: duplicateCount,
        records_skipped: skippedRecords.length,
      },
      skipped_records_sample: skippedRecords.slice(0, 50),
      errors: insertErrors,
    };

    let auditArtifactPath: string | null = null;
    const effectiveAuditBucket = String(auditBucket || '').trim() || 'import-audits';
    const effectiveAuditPrefix = String(auditPrefix || '').trim() || 'historical-imports';

    try {
      const safeFileName = String(fileName || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      auditArtifactPath = `${effectiveAuditPrefix}/import-data/${targetOrgId}/${ts}_${safeFileName}.json`;

      const { error: auditUploadError } = await supabaseClient.storage
        .from(effectiveAuditBucket)
        .upload(auditArtifactPath, JSON.stringify(auditPayload, null, 2), {
          contentType: 'application/json',
          upsert: true,
        });

      if (auditUploadError) {
        console.warn('Failed to upload historical import audit artifact:', auditUploadError.message);
        insertErrors.push(`audit_upload_failed:${auditUploadError.message}`);
        auditArtifactPath = null;
      }
    } catch (auditError: any) {
      console.warn('Failed to write historical import audit artifact:', auditError?.message || String(auditError));
      insertErrors.push(`audit_write_failed:${auditError?.message || String(auditError)}`);
      auditArtifactPath = null;
    }

    console.log('Import summary:', summary);

    return new Response(JSON.stringify({
      ...summary,
      audit_artifact: {
        bucket: effectiveAuditBucket,
        path: auditArtifactPath,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Import error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
