import { createClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'

// Ensure you set these environment variables before running!
const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// Safely parse the DD/MM/YYYY format to YYYY-MM-DD
function parseExpiryDate(dateStr?: string) {
  if (!dateStr || dateStr.trim() === '') return null
  const parts = dateStr.trim().split('/')
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}` // YYYY-MM-DD
  }
  return dateStr // Fallback if it's already an ISO string
}

function parseBool(val?: string) {
  if (!val) return false
  return val.trim().toUpperCase() === 'TRUE'
}

function parseIntSafe(val?: string) {
  if (!val || val.trim() === '') return 0
  const parsed = parseInt(val, 10)
  return isNaN(parsed) ? 0 : parsed
}

async function runImport() {
  console.log('📥 Fetching file from storage bucket "imports_canonical_vehicles"...')
  
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('imports_canonical_vehicles')
    .download('canonical_vehicles_rows.csv')
    
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

  console.log(`📊 Found ${records.length} records. Mapping to new schema...`)

  const mappedRecords = records.map((row: any) => {
    // Safely parse metadata JSON if it exists
    let photoMetadata = null
    if (row.profile_photo_metadata && row.profile_photo_metadata.trim() !== '') {
      try { photoMetadata = JSON.parse(row.profile_photo_metadata) } catch (e) { }
    }

    return {
      plate_number: row.plate_number?.trim().toUpperCase(),
      vehicle_make: row.make?.trim() || null,
      vehicle_model: row.model?.trim() || null,
      vehicle_year: parseIntSafe(row.year) || null,
      vehicle_color: row.colour?.trim() || null,
      
      self_contained: parseBool(row.self_contained),
      self_contained_expiry: parseExpiryDate(row.self_contained_expiry),
      
      homeless_status: row.homeless_status?.trim() || 'none',
      homeless_confirmed_at: row.homeless_confirmed_at || null,
      homeless_confirmed_by: row.homeless_confirmed_by || null,
      homeless_notes: row.homeless_notes?.trim() || null,
      
      is_flagged: parseBool(row.is_flagged),
      flagged_priority: row.flagged_priority?.trim() || null,
      flagged_reason: row.flagged_reason?.trim() || null,
      flagged_notes: row.flagged_notes?.trim() || null,
      flagged_at: row.flagged_at || null,
      flagged_by: row.flagged_by || null,
      
      owner_first_name: row.owner_first_name?.trim() || null,
      owner_last_name: row.owner_last_name?.trim() || null,
      owner_company_name: row.owner_company_name?.trim() || null,
      owner_address: row.owner_address?.trim() || null,
      owner_address_verified: parseBool(row.owner_address_verified),
      
      profile_photo: row.profile_photo?.trim() || null,
      profile_photo_selected_at: row.profile_photo_selected_at || null,
      profile_photo_metadata: photoMetadata,
      
      total_notes: parseIntSafe(row.total_notes),
      last_note_at: row.last_note_at || null,
      last_note_preview: row.last_note_preview?.trim() || null,
      
      first_seen_at: row.first_seen_at || new Date().toISOString(),
      last_seen_at: row.last_seen_at || new Date().toISOString(),
      
      total_observations: parseIntSafe(row.total_observations),
      total_breaches: parseIntSafe(row.total_breaches),
      total_incidents: parseIntSafe(row.total_incidents),
      total_hs_reports: parseIntSafe(row.total_hs_reports),
      
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString(),
      
      nzscv_last_checked: row.nzscv_last_checked || null,
      nzscv_source: row.nzscv_source?.trim() || null,
    }
  }).filter((r: any) => r.plate_number && r.plate_number !== '') // Required Primary Key

  // Batch Upsert
  const BATCH_SIZE = 500
  let successCount = 0

  for (let i = 0; i < mappedRecords.length; i += BATCH_SIZE) {
    const batch = mappedRecords.slice(i, i + BATCH_SIZE)
    
    const { error: upsertError } = await supabase
      .from('canonical_vehicles')
      .upsert(batch, { 
        onConflict: 'plate_number',
        ignoreDuplicates: false 
      })

    if (upsertError) {
      console.error(`❌ Error in batch ${i / BATCH_SIZE + 1}:`, upsertError.message)
    } else {
      successCount += batch.length
      console.log(`✅ Processed ${successCount} / ${mappedRecords.length} records...`)
    }
  }

  console.log('🎉 Import complete!')
}

runImport().catch(console.error)
