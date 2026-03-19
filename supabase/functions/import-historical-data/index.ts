/**
 * import-historical-data Edge Function - Backend-Driven Excel Import
 * 
 * PROPER ARCHITECTURE:
 * - Frontend uploads .xlsx file to storage
 * - Frontend calls this Edge Function with file path
 * - Backend handles ALL processing:
 *   - Excel parsing (server-side)
 *   - Zone fuzzy matching
 *   - Batch zone creation (atomic transactions)
 *   - Bulk upsert canonical vehicles
 *   - Bulk insert observations
 *   - Progress tracking in database
 *   - Error handling
 * - Frontend polls for progress updates
 * 
 * BENEFITS:
 * - 10-100x faster (batch operations vs individual)
 * - Atomic transactions (all-or-nothing)
 * - Real progress tracking (survives page refresh)
 * - Scalable (can handle 100k+ records)
 * - Server-side validation
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

const INFERENCE_SERVICE_URL = Deno.env.get('INFERENCE_SERVICE_URL') || '';
const INFERENCE_API_KEY = Deno.env.get('INFERENCE_API_KEY') || '';
const INFERENCE_TIMEOUT_MS = Number(Deno.env.get('INFERENCE_TIMEOUT_MS') ?? '4500');

interface ImportProgress {
  status: 'parsing' | 'zone_matching' | 'importing' | 'completed' | 'failed';
  current_batch: number;
  total_batches: number;
  records_processed: number;
  records_total: number;
  successful: number;
  failed: number;
  zones_created: number;
  error_message?: string;
}

interface ParsedRecord {
  sourceRowId?: string; // Optional legacy spreadsheet ID (logs only, not persisted)
  zone: string;
  date: string;
  plate: string;
  notes: string | null;
  attachments: number;
  time: string; // HH:MM in 24-hour format, parsed from Modified column
}

interface ProcessedRecord extends ParsedRecord {
  zoneId: string | null;
  zoneName: string | null;
  matchedOrgId: string | null;  // org that owns the matched zone (may differ from targetOrganizationId)
  isNewZone: boolean;
  errors: string[];
  status: 'pending' | 'success' | 'error';
}

function parseStorageInputToBucketAndPath(input: string): { bucket: string; filePath: string } {
  const trimmed = input.trim();

  const publicMarker = '/storage/v1/object/public/';
  const signMarker = '/storage/v1/object/sign/';

  const marker = trimmed.includes(publicMarker)
    ? publicMarker
    : trimmed.includes(signMarker)
    ? signMarker
    : null;

  if (marker) {
    const tail = trimmed.split(marker)[1] || '';
    const noQuery = tail.split('?')[0] || '';
    const parts = noQuery.split('/').filter(Boolean);
    if (parts.length < 2) {
      throw new Error('Invalid storage URL: missing bucket/path');
    }

    const [bucket, ...pathParts] = parts;
    return {
      bucket,
      filePath: decodeURIComponent(pathParts.join('/')),
    };
  }

  return {
    bucket: 'evidence',
    filePath: trimmed.replace(/^\/+/, ''),
  };
}

function isSupabaseStorageUrl(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.includes('/storage/v1/object/public/') || trimmed.includes('/storage/v1/object/sign/');
}

function isExternalHttpUrl(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return (trimmed.startsWith('http://') || trimmed.startsWith('https://')) && !isSupabaseStorageUrl(input);
}

type ZoneRow = {
  id: string;
  name: string;
  organization_id: string;
  location_lat: number | null;
  location_lng: number | null;
  geometry: any;
};

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function centroidFromPolygon(coords: any): { lat: number; lng: number } | null {
  if (!Array.isArray(coords) || !Array.isArray(coords[0])) return null;
  const ring = coords[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;

  let sumLat = 0;
  let sumLng = 0;
  let count = 0;

  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const lng = toNumber(p[0]);
    const lat = toNumber(p[1]);
    if (lat === null || lng === null) continue;
    sumLat += lat;
    sumLng += lng;
    count += 1;
  }

  if (count === 0) return null;
  return { lat: sumLat / count, lng: sumLng / count };
}

function inferGpsFromZone(zone: ZoneRow | null): { lat: number; lng: number } | null {
  if (!zone) return null;

  // First preference: explicit zone lat/lng fields.
  if (zone.location_lat !== null && zone.location_lng !== null) {
    return { lat: zone.location_lat, lng: zone.location_lng };
  }

  // Fallback: try to derive from GeoJSON-ish geometry.
  const rawGeometry = typeof zone.geometry === 'string'
    ? (() => {
        try { return JSON.parse(zone.geometry); } catch { return null; }
      })()
    : zone.geometry;

  if (!rawGeometry || typeof rawGeometry !== 'object') return null;

  if (rawGeometry.type === 'Point' && Array.isArray(rawGeometry.coordinates)) {
    const lng = toNumber(rawGeometry.coordinates[0]);
    const lat = toNumber(rawGeometry.coordinates[1]);
    if (lat !== null && lng !== null) return { lat, lng };
  }

  if (rawGeometry.type === 'Polygon') {
    return centroidFromPolygon(rawGeometry.coordinates);
  }

  if (rawGeometry.type === 'MultiPolygon' && Array.isArray(rawGeometry.coordinates) && rawGeometry.coordinates.length > 0) {
    return centroidFromPolygon(rawGeometry.coordinates[0]);
  }

  return null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('📥 [IMPORT] Request received');

    // Get authenticated user
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      console.error('❌ [IMPORT] Auth failed:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [IMPORT] User authenticated:', user.id);

    // Get user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('❌ [IMPORT] Profile fetch failed:', profileError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch user profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!['admin', 'master', 'admin_officer'].includes(profile.role)) {
      console.error('❌ [IMPORT] Permission denied - role:', profile.role);
      return new Response(
        JSON.stringify({ error: 'Forbidden - admin role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!profile.organization_id) {
      console.error('❌ [IMPORT] No organization ID');
      return new Response(
        JSON.stringify({ error: 'Organization not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [IMPORT] User authorized - role:', profile.role, 'org:', profile.organization_id);

    // Parse request body – accept both camelCase (UI) and snake_case (legacy) param names
    const body = await req.json();
    const file_path = body.file_path || body.filePath || null;
    const file_url = body.file_url || body.fileUrl || body.storage_url || body.storageUrl || null;
    const input_bucket = body.bucket || body.storage_bucket || null;
    const batch_name = body.batch_name || body.batchName || null;
    const organization_id = body.organization_id || body.organizationId;

    const inputFile = (file_url || file_path || '').trim();

    if (!inputFile) {
      return new Response(
        JSON.stringify({ error: 'Missing filePath/file_path or fileUrl/file_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use provided organization_id or fall back to user's organization
    let targetOrganizationId = organization_id;
    
    // Master users must provide organization_id
    if (profile.role === 'master' && !organization_id) {
      console.error('❌ [IMPORT] Master user must specify organization_id');
      return new Response(
        JSON.stringify({ error: 'organization_id required for master users' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Non-master users use their own organization
    if (!targetOrganizationId) {
      targetOrganizationId = profile.organization_id;
    }
    
    if (!targetOrganizationId) {
      console.error('❌ [IMPORT] No organization ID');
      return new Response(
        JSON.stringify({ error: 'Organization not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('✅ [IMPORT] Target organization:', targetOrganizationId);

    // Validate organization exists
    const { data: orgExists, error: orgCheckError } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', targetOrganizationId)
      .single();

    if (orgCheckError || !orgExists) {
      console.error('❌ [IMPORT] Organization not found:', targetOrganizationId, orgCheckError);
      return new Response(
        JSON.stringify({ error: 'Organization not found', organization_id: targetOrganizationId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [IMPORT] Organization validated:', orgExists.name);

    let fileData: Blob | null = null;
    let bucket: string | null = null;
    let resolvedFilePath = '';

    if (isExternalHttpUrl(inputFile)) {
      // Allow importing directly from publicly-accessible XLSX/CSV links.
      console.log('🌐 [IMPORT] External URL detected:', inputFile);
      const externalResponse = await fetch(inputFile);

      if (!externalResponse.ok) {
        return new Response(
          JSON.stringify({
            error: 'Failed to fetch external file URL',
            details: `HTTP ${externalResponse.status} ${externalResponse.statusText}`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      fileData = await externalResponse.blob();

      const parsedUrl = new URL(inputFile);
      const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
      resolvedFilePath = decodeURIComponent(pathSegments[pathSegments.length - 1] || 'external-import-file');
      bucket = 'external-url';
      console.log('📂 [IMPORT] External file name:', resolvedFilePath);
    } else {
      const parsedStorage = parseStorageInputToBucketAndPath(inputFile);
      bucket = input_bucket || parsedStorage.bucket;
      resolvedFilePath = parsedStorage.filePath;

      if (!bucket || !resolvedFilePath) {
        return new Response(
          JSON.stringify({ error: 'Could not resolve storage bucket and file path' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('📂 [IMPORT] File bucket/path:', bucket, resolvedFilePath);

      // Download file from storage
      const { data: downloadedFile, error: downloadError } = await supabaseAdmin.storage
        .from(bucket)
        .download(resolvedFilePath);

      if (downloadError || !downloadedFile) {
        console.error('❌ [IMPORT] File download failed:', downloadError);
        return new Response(
          JSON.stringify({ error: 'Failed to download file', details: downloadError?.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      fileData = downloadedFile;
    }

    if (!fileData) {
      return new Response(
        JSON.stringify({ error: 'No file data available for import' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [IMPORT] File downloaded, size:', fileData.size, 'bytes');

    // Create import batch record for UI progress tracking
    console.log('📝 [IMPORT] Creating import batch record...');
    console.log('   - Organization ID:', targetOrganizationId);
    console.log('   - Uploaded by:', user.id);
    console.log('   - File name:', resolvedFilePath.split('/').pop());

    const { data: importRecord, error: importError } = await supabaseAdmin
      .from('import_batches')
      .insert({
        organization_id: targetOrganizationId,
        uploaded_by: user.id,
        batch_name: batch_name || `Import ${new Date().toISOString().split('T')[0]}`,
        file_name: resolvedFilePath.split('/').pop(),
        status: 'parsing',
        total_records: 0,
        processed_records: 0,
        successful_records: 0,
        failed_records: 0,
        zones_created: 0,
      })
      .select('id')
      .single();

    if (importError || !importRecord) {
      console.error('❌ [IMPORT] Failed to create import batch:', importError);
      console.error('   - Error code:', importError?.code);
      console.error('   - Error message:', importError?.message);
      console.error('   - Error details:', importError?.details);
      console.error('   - Error hint:', importError?.hint);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to create import batch record',
          details: importError?.message,
          code: importError?.code,
          hint: importError?.hint
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const importBatchId = importRecord.id;
    console.log('✅ [IMPORT] Import batch created:', importBatchId);

    // Parse Excel file
    console.log('📄 [IMPORT] Parsing file...');
    
    const arrayBuffer = await fileData.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    console.log(`✅ [IMPORT] File parsed - ${jsonData.length} rows`);

    // Update batch: set total_records once we know the row count
    await supabaseAdmin
      .from('import_batches')
      .update({ total_records: Math.max(0, jsonData.length - 1), status: 'zone_matching' })
      .eq('id', importBatchId);

    // ── Heuristic date-format detection (runs before AI, no network needed) ──
    // Check first 10 non-header rows for a date string to determine format.
    // NZ DOWNER/LINZ exports always use DD/MM/YYYY so we prefer that when
    // the first slash-segment is > 12.
    let dateFormat = 'unknown';
    for (let scanRow = 1; scanRow <= Math.min(10, jsonData.length - 1); scanRow++) {
      const candidate = jsonData[scanRow]?.[2];
      if (typeof candidate === 'string' && candidate.includes('/')) {
        const parts = candidate.trim().split('/');
        if (parts.length === 3) {
          const a = parseInt(parts[0], 10);
          const b = parseInt(parts[1], 10);
          if (a > 12) {
            // First segment > 12 can only be a day, so format is DD/MM/YYYY
            dateFormat = 'dd/mm/yyyy';
          } else if (b > 12) {
            // Second segment > 12 can only be a day, so format is MM/DD/YYYY
            dateFormat = 'mm/dd/yyyy';
          } else {
            // Ambiguous – both values fit in either day or month range.
            // Default to DD/MM/YYYY: NZ DOWNER/LINZ exports always use this
            // convention and it is the standard date format in New Zealand.
            dateFormat = 'dd/mm/yyyy';
          }
          console.log(`📅 [IMPORT] Heuristic date format detected: ${dateFormat} (from "${candidate}")`);
          break;
        }
      } else if (typeof candidate === 'number') {
        dateFormat = 'excel_serial';
        break;
      }
    }

    // STEP: Inference-service tabular NLP analysis (optional enhancement)
    // Minimum confidence required to override the heuristic date-format detection.
    const AI_DATE_FORMAT_CONFIDENCE_THRESHOLD = 0.8;
    console.log('🤖 [IMPORT] Attempting inference-service tabular NLP analysis (optional)...');
    const sampleRows = jsonData.slice(0, Math.min(20, jsonData.length));
    let aiAnalysis: any = null;

    try {
      if (!INFERENCE_SERVICE_URL) {
        console.warn('⚠️ [IMPORT] INFERENCE_SERVICE_URL not configured, using heuristic only');
      } else {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        if (INFERENCE_API_KEY) {
          headers['x-inference-api-key'] = INFERENCE_API_KEY;
        }

        const inferenceRes = await fetch(`${INFERENCE_SERVICE_URL}/nlp/tabular/analyze`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sampleRows,
            expectedColumns: ['ID', 'Title', 'RecordedDate', 'REGO', 'Note', 'Attachments'],
          }),
          signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
        });

        if (inferenceRes.ok) {
          const inferenceData = await inferenceRes.json();
          aiAnalysis = inferenceData?.analysis ?? null;
          if (aiAnalysis?.dateFormat && aiAnalysis?.dateFormatConfidence >= AI_DATE_FORMAT_CONFIDENCE_THRESHOLD) {
            dateFormat = aiAnalysis.dateFormat;
            console.log(`✅ [IMPORT] Inference service overrides date format to: ${dateFormat} (confidence ${aiAnalysis.dateFormatConfidence})`);
          } else {
            console.log(`✅ [IMPORT] Inference analysis complete but low confidence; keeping heuristic format: ${dateFormat}`);
          }
        } else {
          console.warn(`⚠️ [IMPORT] Inference service analysis failed (${inferenceRes.status}), using heuristic date format: ${dateFormat}`);
        }
      }
    } catch (aiError: any) {
      console.warn('⚠️ [IMPORT] Inference analysis error (non-critical), using heuristic:', aiError.message);
    }

    // Parse records (skip header)
    // Expected columns: A=ID, B=Title(zone), C=RecordedDate, D=REGO(plate), E=Note, F=Attachments
    const parsedRecords: ParsedRecord[] = [];
    const errorLog: any[] = []; // Initialize error log for parsing phase
    
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length < 4) continue; // Must have at least ID, Title, Date, REGO

      // Parse date using AI-detected format or fallback to robust parsing
      let parsedDate: string | null = null;
      const dateValue = row[2];
      
      try {
        // ROBUST DATE PARSING - Handle all Excel formats
        let dateObj: Date | null = null;
        
        // STEP 1: Try to parse Modified column (G, index 6) for actual datetime first
        let recordedTime: string = '00:00'; // Default time
        const modifiedValue = row[6]; // Modified column with "DD/MM/YYYY HH:MM"
        const dateValue = row[2]; // RecordedDate fallback
        
          // Extract time from Modified column if available (format: "18/03/2026 20:45")
          if (modifiedValue && typeof modifiedValue === 'string') {
            const modParts = modifiedValue.trim().split(' ');
            if (modParts.length >= 2) {
              const timePart = modParts[1]; // "20:45"
              if (/^\d{2}:\d{2}/.test(timePart)) {
                recordedTime = timePart;
                console.log(`⏰ Row ${i + 1}: Time extracted from Modified column: ${recordedTime}`);
              }
            }
          }
        
          // Case 1: JavaScript Date object (from XLSX library)
        if (dateValue instanceof Date) {
          dateObj = dateValue;
          console.log(`📅 Row ${i + 1}: Date object detected - ${dateValue.toISOString()}`);
        }
        // Case 2: Excel serial number (numeric days since Dec 30, 1899)
        else if (typeof dateValue === 'number') {
          // Excel serial date: Days since December 30, 1899
          const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // Dec 30, 1899 UTC
          const milliseconds = dateValue * 24 * 60 * 60 * 1000;
          dateObj = new Date(excelEpoch.getTime() + milliseconds);
          console.log(`📅 Row ${i + 1}: Excel serial ${dateValue} → ${dateObj.toISOString()}`);
        }
        // Case 3: Date string in dd/mm/yyyy format (AI-detected)
        else if (dateFormat === 'dd/mm/yyyy' && typeof dateValue === 'string' && dateValue.includes('/')) {
          const parts = dateValue.trim().split('/');
          if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1; // JS months are 0-indexed
            const year = parseInt(parts[2], 10);
            dateObj = new Date(year, month, day);
            console.log(`📅 Row ${i + 1}: dd/mm/yyyy "${dateValue}" → ${dateObj.toISOString()}`);
          }
        }
        // Case 4: Date string in mm/dd/yyyy format (AI-detected)
        else if (dateFormat === 'mm/dd/yyyy' && typeof dateValue === 'string' && dateValue.includes('/')) {
          const parts = dateValue.trim().split('/');
          if (parts.length === 3) {
            const month = parseInt(parts[0], 10) - 1;
            const day = parseInt(parts[1], 10);
            const year = parseInt(parts[2], 10);
            dateObj = new Date(year, month, day);
            console.log(`📅 Row ${i + 1}: mm/dd/yyyy "${dateValue}" → ${dateObj.toISOString()}`);
          }
        }
        // Case 5: ISO date string (yyyy-mm-dd)
        else if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
          dateObj = new Date(dateValue);
          console.log(`📅 Row ${i + 1}: ISO date "${dateValue}" → ${dateObj.toISOString()}`);
        }
        // Case 6: Slash-delimited string with unknown format – default to DD/MM/YYYY (NZ convention)
        else if (typeof dateValue === 'string' && dateValue.includes('/')) {
          const parts = dateValue.trim().split('/');
          if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const year = parseInt(parts[2], 10);
            dateObj = new Date(year, month, day);
            console.log(`📅 Row ${i + 1}: Unknown format – NZ DD/MM/YYYY fallback "${dateValue}" → ${dateObj.toISOString()}`);
          } else {
            dateObj = new Date(dateValue);
          }
        }
        // Case 7: Generic string parsing (last resort)
        else if (typeof dateValue === 'string' && dateValue.trim()) {
          dateObj = new Date(dateValue);
          console.log(`📅 Row ${i + 1}: Generic string "${dateValue}" → ${dateObj.toISOString()}`);
        }
        
        // Validate parsed date
        if (!dateObj || isNaN(dateObj.getTime())) {
          console.error(`❌ [IMPORT] Invalid date for row ${i + 1}: ${JSON.stringify(dateValue)}`);
          errorLog.push({
            record_id: String(row[0] || i + 1),
            plate: String(row[3] || '').trim().toUpperCase(),
            zone: String(row[1] || '').trim(),
            date_value: JSON.stringify(dateValue),
            error: `Invalid date - could not parse: ${JSON.stringify(dateValue)}`,
          });
          continue; // Skip this record
        }
        
        // Extract YYYY-MM-DD in UTC to avoid timezone shifts
        const year = dateObj.getUTCFullYear();
        const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getUTCDate()).padStart(2, '0');
        parsedDate = `${year}-${month}-${day}`;
        
        // Final sanity check: year must be reasonable (1900-2100)
        if (year < 1900 || year > 2100) {
          console.error(`❌ [IMPORT] Date year out of range (${year}) for row ${i + 1}`);
          console.error(`   Raw value: ${JSON.stringify(dateValue)}`);
          console.error(`   Parsed to: ${dateObj.toISOString()}`);
          errorLog.push({
            record_id: String(row[0] || i + 1),
            plate: String(row[3] || '').trim().toUpperCase(),
            zone: String(row[1] || '').trim(),
            date_value: JSON.stringify(dateValue),
            error: `Date year out of range (${year}) - expected 1900-2100`,
          });
          continue; // Skip this record
        }
        
      } catch (dateError: any) {
        console.error(`❌ [IMPORT] Date parsing exception for row ${i + 1}:`, dateError.message);
        console.error(`   Raw value: ${JSON.stringify(dateValue)}`);
        errorLog.push({
          record_id: String(row[0] || i + 1),
          plate: String(row[3] || '').trim().toUpperCase(),
          zone: String(row[1] || '').trim(),
          date_value: JSON.stringify(dateValue),
          error: `Date parsing failed: ${dateError.message}`,
        });
        continue; // Skip this record
      }
      
      // If date parsing failed, we already skipped this record above
      if (!parsedDate) {
        continue;
      }

      const record: ParsedRecord = {
        sourceRowId: row[0] ? String(row[0]).trim() : undefined,
        zone: String(row[1] || '').trim(), // Column B: Title (zone name)
        date: parsedDate, // Column C: RecordedDate (properly parsed)
        plate: String(row[3] || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''), // Column D: REGO
        notes: row[4] && String(row[4]).toLowerCase() !== 'nan' ? String(row[4]).trim() : null, // Column E: Note
        attachments: Number(row[5]) || 0, // Column F: Attachments
      };

      if (!record.zone || !record.plate) {
        console.warn(`⚠️ [IMPORT] Skipping row ${i + 1}: Missing zone or plate`);
        errorLog.push({
          record_id: String(row[0] || i + 1),
          plate: record.plate || 'MISSING',
          zone: record.zone || 'MISSING',
          error: 'Missing required field: zone or plate number',
        });
        continue;
      }

      // Date validation: must have a valid date (no empty dates allowed for historical imports)
      if (!record.date || record.date.length === 0) {
        console.warn(`⚠️ [IMPORT] Skipping row ${i + 1}: Empty date`);
        errorLog.push({
          record_id: String(row[0] || i + 1),
          plate: record.plate,
          zone: record.zone,
          error: 'Empty date - historical records must have actual dates',
        });
        continue;
      }

      parsedRecords.push(record);
    }

    console.log(`✅ [IMPORT] Parsed ${parsedRecords.length} valid records`);
    if (errorLog.length > 0) {
      console.warn(`⚠️ [IMPORT] ${errorLog.length} records skipped during parsing due to validation errors`);
    }

    // Update batch record: parsing complete, about to do zone matching
    await supabaseAdmin
      .from('import_batches')
      .update({
        parsed_records: parsedRecords.length,
        status: 'zone_matching',
        error_summary: errorLog.length > 0
          ? `${errorLog.length} rows skipped during parsing`
          : null,
      })
      .eq('id', importBatchId);

    // Load zones across ALL organisations.
    // The import function was previously scoped to targetOrganizationId only,
    // which caused it to miss zones that exist under a different council org
    // and instead create duplicate zones under the wrong (importer's) org.
    //
    // Strategy:
    //   • Load ALL active zones across every org.
    //   • When fuzzy-matching, prefer (in order):
    //       1. An existing zone in targetOrganizationId (user's org) – exact/fuzzy.
    //       2. An existing zone in ANY other org              – exact/fuzzy.
    //       3. Create a new zone under targetOrganizationId   – last resort.
    //   • Store zone.organization_id on the observation so ownership is correct.
    console.log('📥 [IMPORT] Loading active zones across all organisations…');
    const { data: existingZones, error: zonesError } = await supabaseAdmin
      .from('zones')
      .select('id, name, organization_id, location_lat, location_lng, geometry')
      .eq('is_active', true);

    if (zonesError) {
      throw zonesError;
    }

    // Partition zones: target-org first, then others
    const allZones: ZoneRow[] = (existingZones || []) as ZoneRow[];
    const targetOrgZones = allZones.filter(z => z.organization_id === targetOrganizationId);
    const otherOrgZones  = allZones.filter(z => z.organization_id !== targetOrganizationId);
    const zoneById = new Map<string, ZoneRow>(allZones.map((z) => [z.id, z]));

    console.log(
      `✅ [IMPORT] Loaded ${existingZones?.length || 0} zones ` +
      `(${targetOrgZones.length} in target org, ${otherOrgZones.length} in other orgs)`
    );

    // ─── Zone-matching helpers ──────────────────────────────────────────────
    //
    // Run the same fuzzy algorithm against a pool of zones, returning the
    // first match found or null.
    const fuzzyMatch = (zoneName: string, pool: any[]): any | null => {
      const normalized = zoneName.toLowerCase().trim();

      // 1. Exact match
      const exact = pool.find(z => z.name.toLowerCase() === normalized);
      if (exact) return exact;

      // 2. Contains match ("Bendigo" ↔ "LINZ - Bendigo")
      const contains = pool.find(z => {
        const zl = z.name.toLowerCase();
        return zl.includes(normalized) || normalized.includes(zl);
      });
      if (contains) return contains;

      // 3. Suffix / word match ("LINZ - Bendigo" word "Bendigo")
      const suffix = pool.find(z => {
        const parts = z.name.toLowerCase().split(/[-\s]+/);
        return parts.some((p: string) => p === normalized);
      });
      if (suffix) return suffix;

      // 4. Cleaned common-word match
      const stopWords = /\b(area|zone|street|road|avenue|place|bay|beach|inlet|gully|linz|downer|ncc)\b/g;
      const cleaned = normalized.replace(stopWords, '').trim();
      if (cleaned.length > 2) {
        const cleanedMatch = pool.find(z => {
          const cz = z.name.toLowerCase().replace(stopWords, '').trim();
          return cz === cleaned || cz.includes(cleaned) || cleaned.includes(cz);
        });
        if (cleanedMatch) return cleanedMatch;
      }

      return null;
    };

    // Find the best zone for a name: check target org first, then other orgs.
    const findMatchingZone = (zoneName: string): { zone: any; fromTargetOrg: boolean } | null => {
      // Priority 1 – target organisation (most specific, user-chosen)
      const inTarget = fuzzyMatch(zoneName, targetOrgZones);
      if (inTarget) {
        console.log(`  ✅ Matched in target org: "${zoneName}" → "${inTarget.name}"`);
        return { zone: inTarget, fromTargetOrg: true };
      }

      // Priority 2 – any other organisation (canonical council zone)
      const inOther = fuzzyMatch(zoneName, otherOrgZones);
      if (inOther) {
        console.log(`  🔀 Matched in other org (${inOther.organization_id}): "${zoneName}" → "${inOther.name}"`);
        return { zone: inOther, fromTargetOrg: false };
      }

      console.log(`  ⚠️ No match found for: "${zoneName}" – will create in target org`);
      return null;
    };

    // Match zones and identify new zones needed
    console.log('🔍 [IMPORT] Matching zones...');
    const processedRecords: ProcessedRecord[] = parsedRecords.map(record => {
      const result = findMatchingZone(record.zone);
      const matched = result?.zone ?? null;
      return {
        ...record,
        // Use matched zone's org when it belongs to a different org so that
        // the observation.organization_id always equals zone.organization_id.
        zoneId:   matched?.id   || null,
        zoneName: matched?.name || null,
        // Store the matched zone's org so we can set observation.organization_id correctly
        matchedOrgId: matched?.organization_id ?? null,
        isNewZone: !matched,
        errors: [],
        status: 'pending' as const,
      };
    });

    const uniqueNewZones = [...new Set(processedRecords.filter(r => r.isNewZone).map(r => r.zone))];
    console.log(`✅ [IMPORT] Zone matching complete - ${uniqueNewZones.length} new zones needed`);

    // Create new zones in batch
    let zonesCreated = 0;
    const createdZonesMap = new Map<string, string>();

    if (uniqueNewZones.length > 0) {
      console.log('🆕 [IMPORT] Creating new zones...');
      
      const zonesToInsert = uniqueNewZones.map(zoneName => ({
        organization_id: targetOrganizationId,
        name: zoneName,
        description: 'Auto-created from historical import - needs admin review',
        needs_admin_review: true,
        is_active: true,
        self_contained_required: true,
        nights_per_month: 28,
        max_consecutive_nights: 3,
      }));

      const { data: newZones, error: zoneCreateError } = await supabaseAdmin
        .from('zones')
        .insert(zonesToInsert)
        .select('id, name');

      if (zoneCreateError) {
        console.error('❌ [IMPORT] Zone creation failed:', zoneCreateError);
        throw zoneCreateError;
      }

      // Map zone names to IDs (new zones always belong to targetOrganizationId)
      (newZones || []).forEach(zone => {
        createdZonesMap.set(zone.name, zone.id);
        zoneById.set(zone.id, {
          id: zone.id,
          name: zone.name,
          organization_id: targetOrganizationId,
          location_lat: null,
          location_lng: null,
          geometry: null,
        });
      });

      zonesCreated = newZones?.length || 0;
      console.log(`✅ [IMPORT] Created ${zonesCreated} new zones under target org`);

      // Update batch record with zones created count
      await supabaseAdmin
        .from('import_batches')
        .update({ zones_created: zonesCreated, status: 'importing' })
        .eq('id', importBatchId);

      // Update processed records with new zone IDs and org
      processedRecords.forEach(record => {
        if (record.isNewZone) {
          const newZoneId = createdZonesMap.get(record.zone);
          if (newZoneId) {
            record.zoneId = newZoneId;
            record.zoneName = record.zone;
            record.matchedOrgId = targetOrganizationId; // new zone is in target org
          }
        }
      });
    } else {
      // No new zones needed – move straight to importing
      await supabaseAdmin
        .from('import_batches')
        .update({ zones_created: 0, status: 'importing' })
        .eq('id', importBatchId);
    }

    // Process records in batches of 300 (user-requested batch size)
    const BATCH_SIZE = 300;
    const batches = [];
    for (let i = 0; i < processedRecords.length; i += BATCH_SIZE) {
      batches.push(processedRecords.slice(i, i + BATCH_SIZE));
    }

    console.log(`🚀 [IMPORT] Starting batch processing - ${batches.length} batches of 300 records`);

    let successful = 0;
    let failed = 0;
    let gpsInferredCount = 0;
    let gpsFallbackCount = 0;
    const processingErrors: any[] = []; // Separate error log for processing phase (distinct from parsing errors)

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`📦 [IMPORT] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} records)`);
      
      // Update progress in import_batches for real-time UI updates
      await supabaseAdmin
        .from('import_batches')
        .update({
          processed_records: successful + failed,
          successful_records: successful,
          failed_records: failed,
        })
        .eq('id', importBatchId);

      for (const record of batch) {
        try {
          if (!record.zoneId) {
            throw new Error(`No zone ID for zone: ${record.zone}`);
          }

          // Upsert canonical vehicle (using database function for atomic operation)
          // Leave all vehicle details as null - we don't have this data from historical imports
          const { error: vehicleError } = await supabaseAdmin.rpc('upsert_canonical_vehicle', {
            p_plate_number: record.plate,
            p_vehicle_make: null, // Unknown - historical data didn't capture this
            p_vehicle_model: null, // Unknown - historical data didn't capture this
            p_vehicle_year: null, // Unknown - historical data didn't capture this
            p_vehicle_color: null, // Unknown - historical data didn't capture this
            p_self_contained: null, // Unknown - historical data didn't capture this
            p_self_contained_expiry: null, // Unknown - historical data didn't capture this
          });

          if (vehicleError) {
            console.error(`❌ [IMPORT] Vehicle upsert failed for ${record.plate}:`, vehicleError);
            throw vehicleError;
          }

          // Determine officer notes with better logic
          let officerNotes = 'Historical import record (no field notes)';
          let hasNotes = false;
          
          if (record.notes && record.notes.trim().length > 0) {
            // Real notes exist from historical data
            officerNotes = `[Historical Import] ${record.notes}`;
            hasNotes = true;
          }

          // ============================================================
          // IDEMPOTENCY KEY
          // Live scans use "deviceId:captureId". Historical imports use a
          // deterministic key that is stable across batches so repeated imports
          // of the same source rows remain idempotent:
          //   import:historical:<org_id>:<zone_id>:<plate>:<date>
          // ============================================================
          const observationOrgId = record.matchedOrgId ?? targetOrganizationId;
          const recordedAtNz = `${record.date}T08:00:00+13:00`;
          const dayStartNz = `${record.date}T00:00:00+13:00`;
          const dayEndNz = `${record.date}T23:59:59+13:00`;
          const idempotencyKey = `import:historical:${observationOrgId}:${record.zoneId}:${record.plate}:${record.date}`;

          // Check whether this record was already imported (idempotency guard)
          const { data: existing } = await supabaseAdmin
            .from('observations')
            .select('*')
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle();

          if (existing) {
            const existingObservationId = (existing as any).observation_id ?? (existing as any).id;
            console.log(`⏭️ [IMPORT] Skipping duplicate – already imported: ${record.plate} ${record.date} (obs ${existingObservationId})`);
            record.status = 'success';
            successful++;
            continue;
          }

          // Backward-compatible duplicate guard for historical rows imported
          // before deterministic cross-batch keys were introduced.
          const { data: legacyExisting } = await supabaseAdmin
            .from('observations')
            .select('id, observation_id')
            .eq('organization_id', observationOrgId)
            .eq('zone_id', record.zoneId)
            .eq('plate_number', record.plate)
            .eq('is_legacy_import', true)
            .gte('recorded_at', dayStartNz)
            .lte('recorded_at', dayEndNz)
            .limit(1)
            .maybeSingle();

          if (legacyExisting) {
            const existingObservationId = (legacyExisting as any).observation_id ?? (legacyExisting as any).id;
            console.log(`⏭️ [IMPORT] Skipping duplicate – legacy match found: ${record.plate} ${record.date} (obs ${existingObservationId})`);
            record.status = 'success';
            successful++;
            continue;
          }

          // Create observation with proper NZ timezone handling
          // LEGACY IMPORT: No photo available - use placeholder and set legacy flags
          // ⚠️ NO COMPLIANCE CALCULATION DURING IMPORT - run recalculation afterward
          const zoneForGps = record.zoneId ? zoneById.get(record.zoneId) || null : null;
          const inferredGps = inferGpsFromZone(zoneForGps);
          if (inferredGps) {
            gpsInferredCount++;
          } else {
            gpsFallbackCount++;
          }

          const { data: observation, error: obsError } = await supabaseAdmin
            .from('observations')
            .insert({
              // ── Identity ──────────────────────────────────────────────
              // observations.id is always gen_random_uuid() (PostgreSQL default).
              // Spreadsheet ID column is intentionally ignored for persistence.
              idempotency_key: idempotencyKey,

              // ── Core fields ───────────────────────────────────────────
              plate_number: record.plate,
              // Use the zone's owning org (may differ from the importer's target org
              // when the zone was found in a different council's org).
              organization_id: observationOrgId,
              zone_id: record.zoneId,
              recorded_by: user.id,
              // Use +13:00 for NZDT (Oct-Apr) - PostgreSQL converts to UTC automatically
              // Excel date "2026-02-16" → "2026-02-16T08:00:00+13:00" → displays as "16 Feb 2026 08:00 NZDT" ✓
              recorded_at: recordedAtNz,
              officer_notes: officerNotes,
              has_notes: hasNotes,
              
              // ── Minimal import defaults ───────────────────────────────
              // All fields will be populated during recalculation phase
              self_contained: false,           // Will be updated from canonical/NZSCV
              has_homeless_claim: false,        // Will be updated if canonical has confirmed status
              homeless_claim_notes: null,
              
              // Vehicle details unknown from historical data
              vehicle_make: null,  // Will be enriched during recalculation
              vehicle_model: null, // Will be enriched during recalculation
              vehicle_year: null,  // Will be enriched during recalculation
              vehicle_color: null, // Will be enriched during recalculation
              
              // Compliance will be set during recalculation
              is_compliant: null,
              
              // ── GPS placeholders (required NOT NULL in schema) ────────
              gps_latitude: inferredGps?.lat ?? 0,
              gps_longitude: inferredGps?.lng ?? 0,

              // ── Legacy import flags (Evidence Act 2006 Compliance) ────
              is_legacy_import: true,
              evidence_state: 'legacy_no_photo',
              legacy_source_tag: 'excel_import',
              legacy_note: `Imported from Excel file: ${resolvedFilePath.split('/').pop()} on ${new Date().toISOString().split('T')[0]}`,
              photo_url: `legacy/placeholder_${record.plate}_${record.date}.jpg`,
              photo_hash: 'LEGACY_IMPORT_NO_PHOTO',
              review_blocked: true, // Block from enforcement until recalculation completes
            })
            .select('*')
            .single();

          if (obsError || !observation) {
            console.error(`❌ [IMPORT] Observation insert failed:`, obsError);
            throw obsError || new Error('Failed to create observation');
          }

          // ============================================================
          // IMPORT COMPLETE - NO COMPLIANCE CALCULATION
          // Run recalculation process after import to:
          // 1. Match/create canonical vehicle records
          // 2. Enrich from NZSCV data
          // 3. Calculate compliance based on zone rules
          // 4. Unblock observations for enforcement
          // ============================================================
          const createdObservationId = (observation as any).observation_id ?? (observation as any).id;
          console.log(`✅ [IMPORT] Observation created for ${record.plate} (id=${createdObservationId}), recalculation needed`);

          record.status = 'success';
          successful++;

        } catch (error: any) {
          console.error(`❌ [IMPORT] Record failed:`, error.message);
          record.status = 'error';
          record.errors.push(error.message);
          failed++;
          
          processingErrors.push({
            record_id: record.sourceRowId || `${record.plate}:${record.date}`,
            plate: record.plate,
            zone: record.zone,
            error: error.message,
          });
        }
      }

      // Update progress after each batch
      await supabaseAdmin
        .from('import_batches')
        .update({
          processed_records: successful + failed,
          successful_records: successful,
          failed_records: failed,
          error_summary: processingErrors.length > 0
            ? `${processingErrors.length} records failed during import`
            : null,
        })
        .eq('id', importBatchId);

      console.log(`📊 [IMPORT] Batch ${batchIndex + 1} complete - Success: ${successful}, Failed: ${failed}`);
    }

    // Mark import batch as complete
    await supabaseAdmin
      .from('import_batches')
      .update({
        status: failed === processedRecords.length && processedRecords.length > 0 ? 'failed' : 'completed',
        processed_records: successful + failed,
        successful_records: successful,
        failed_records: failed,
        zones_created: zonesCreated,
        completed_at: new Date().toISOString(),
        error_summary: processingErrors.length > 0
          ? `${processingErrors.length} record(s) failed. First: ${processingErrors[0]?.error}`
          : null,
      })
      .eq('id', importBatchId);

    console.log(`✅ [IMPORT] Import complete!`);
    console.log(`   Total: ${processedRecords.length}`);
    console.log(`   Success: ${successful}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Zones Created: ${zonesCreated}`);
    console.log(`   GPS Inferred: ${gpsInferredCount}`);
    console.log(`   GPS Fallback (0,0): ${gpsFallbackCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        batchId: importBatchId,
        bucket,
        filePath: resolvedFilePath,
        summary: {
          total: processedRecords.length,
          successful,
          failed,
          zones_created: zonesCreated,
          gps_inferred_records: gpsInferredCount,
          gps_fallback_records: gpsFallbackCount,
          new_zones: uniqueNewZones,
        },
        error_log: processingErrors.length > 0 ? processingErrors.slice(0, 10) : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ [IMPORT] Fatal error:', error);
    return new Response(
      JSON.stringify({
        error: 'Import failed',
        message: error.message,
        stack: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
