import { createClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'

// Ensure you set these environment variables before running!
const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

function parseBool(val?: string) {
  if (!val) return false
  return val.trim().toUpperCase() === 'TRUE'
}

function parseIntSafe(val?: string) {
  if (!val || val.trim() === '') return 0
  const parsed = parseInt(val, 10)
  return isNaN(parsed) ? 0 : parsed
}

function parseFloatSafe(val?: string) {
  if (!val || val.trim() === '') return null
  const parsed = parseFloat(val)
  return isNaN(parsed) ? null : parsed
}

async function runImport() {
  console.log('📥 Fetching file from storage bucket "imports_canonical_vehicles"...')
  
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('imports_canonical_vehicles')
    .download('zones_rows.csv')
    
  if (downloadError) {
    console.error('❌ Failed to download file:', downloadError.message)
    return
  }

  const csvText = await fileData.text()
  
  // Auto-detect if it's tab-separated (TSV) or comma-separated (CSV)
  const firstLine = csvText.split('\n')[0]
  const delimiter = firstLine.includes('\t') ? '\t' : ','
  console.log(`🔍 Detected delimiter: ${delimiter === '\t' ? 'Tab' : 'Comma'}`)

  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    delimiter: delimiter,
    relax_quotes: true
  })

  console.log(`📊 Found ${records.length} records. Mapping to zones schema...`)

  const mappedRecords = records.map((row: any) => {
    // Safely parse JSON arrays for allowed_days
    let allowedDays = null
    if (row.allowed_days && row.allowed_days.trim() !== '') {
      try {
        allowedDays = JSON.parse(row.allowed_days)
      } catch (_err) {
        // Keep null when source data is malformed.
      }
    }

    // Safely parse JSON for geometry
    let geometry = null
    if (row.geometry && row.geometry.trim() !== '') {
      try {
        geometry = JSON.parse(row.geometry)
      } catch (_err) {
        // Keep null when source data is malformed.
      }
    }

    return {
      id: row.id?.trim() || null,
      organization_id: row.organization_id?.trim() || null,
      name: row.name?.trim() || 'Unnamed Zone',
      description: row.description?.trim() || null,
      
      self_contained_required: parseBool(row.self_contained_required),
      nights_per_month: parseIntSafe(row.nights_per_month),
      max_consecutive_nights: parseIntSafe(row.max_consecutive_nights),
      day_visit_only: parseBool(row.day_visit_only),
      
      geometry: geometry,
      location_lat: parseFloatSafe(row.location_lat),
      location_lng: parseFloatSafe(row.location_lng),
      
      is_active: parseBool(row.is_active),
      allowed_days: allowedDays,
      
      parent_zone_id: row.parent_zone_id?.trim() || null,
      zone_type: row.zone_type?.trim() || 'specific',
      
      auto_created_from_observation: parseBool(row.auto_created_from_observation),
      needs_admin_review: parseBool(row.needs_admin_review),
      boundary_source: row.boundary_source?.trim() || null,
      
      bylaw_source_url: row.bylaw_source_url?.trim() || null,
      bylaw_pdf_hash: row.bylaw_pdf_hash?.trim() || null,
      bylaw_clause: row.bylaw_clause?.trim() || null,
      bylaw_effective_date: row.bylaw_effective_date || null,
      
      land_manager: row.land_manager?.trim() || null,
      enforcement_authority: row.enforcement_authority?.trim() || null,
      parkpow_lot_id: row.parkpow_lot_id?.trim() || null,
      is_placeholder: parseBool(row.is_placeholder),
      
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString(),
    }
  }).filter((r: any) => r.id && r.organization_id) // Requires ID and Org ID

  // Batch Upsert
  const BATCH_SIZE = 100
  let successCount = 0

  for (let i = 0; i < mappedRecords.length; i += BATCH_SIZE) {
    const batch = mappedRecords.slice(i, i + BATCH_SIZE)
    
    const { error: upsertError } = await supabase
      .from('zones')
      .upsert(batch, { 
        onConflict: 'id',
        ignoreDuplicates: false 
      })

    if (upsertError) {
      console.error(`❌ Error in batch ${i / BATCH_SIZE + 1}:`, upsertError.message)
    } else {
      successCount += batch.length
      console.log(`✅ Processed ${successCount} / ${mappedRecords.length} records...`)
    }
  }

  console.log('🎉 Zones Import complete!')
}

runImport().catch(console.error)
