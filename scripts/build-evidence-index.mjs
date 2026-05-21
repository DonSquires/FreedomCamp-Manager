#!/usr/bin/env node
/**
 * Evidence Index Builder — Ingest photos from Supabase Storage bucket
 * 
 * Indexes all evidence photos in the bucket, extracts EXIF metadata (GPS, timestamp),
 * applies geo-attribution (Nelson/branch matching), and populates the evidence_index
 * table with priority bands and ingest actions.
 * 
 * Usage:
 *   node scripts/build-evidence-index.mjs [--dry-run] [--org-id <uuid>] [--branch-id <uuid>]
 */

import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import ExifParser from 'exif-parser'

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load environment
for (const file of ['.env.local', '.env', '.env.development.local', '.env.development']) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file, override: false })
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
const NCC_ORG_ID = 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993'  // Nelson City Council
const FS_NELSON_ORG_ID = '11111111-0001-0001-0001-000000000002'  // First Security Nelson

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

// Parse CLI args
const isDryRun = process.argv.includes('--dry-run')
const orgIdIdx = process.argv.indexOf('--org-id')
const orgId = orgIdIdx > -1 ? process.argv[orgIdIdx + 1] : NCC_ORG_ID

// ─────────────────────────────────────────────────────────────────────────────
// Geo-Attribution Bounding Boxes
// ─────────────────────────────────────────────────────────────────────────────

const NELSON_BBOX = { minLat: -41.3, maxLat: -41.25, minLon: 172.0, maxLon: 172.15 }
const OTAGO_BBOX = { minLat: -45.5, maxLat: -45.0, minLon: 168.0, maxLon: 169.5 }
const CANTERBURY_BBOX = { minLat: -44.0, maxLat: -43.0, minLon: 171.5, maxLon: 173.5 }
const WESTCOAST_BBOX = { minLat: -43.0, maxLat: -42.0, minLon: 170.5, maxLon: 171.5 }

function inferRegionFromGPS(lat, lon) {
  if (!lat || !lon) return 'unknown'
  if (lat >= NELSON_BBOX.minLat && lat <= NELSON_BBOX.maxLat && lon >= NELSON_BBOX.minLon && lon <= NELSON_BBOX.maxLon) return 'Nelson'
  if (lat >= OTAGO_BBOX.minLat && lat <= OTAGO_BBOX.maxLat && lon >= OTAGO_BBOX.minLon && lon <= OTAGO_BBOX.maxLon) return 'Otago'
  if (lat >= CANTERBURY_BBOX.minLat && lat <= CANTERBURY_BBOX.maxLat && lon >= CANTERBURY_BBOX.minLon && lon <= CANTERBURY_BBOX.maxLon) return 'Canterbury'
  if (lat >= WESTCOAST_BBOX.minLat && lat <= WESTCOAST_BBOX.maxLat && lon >= WESTCOAST_BBOX.minLon && lon <= WESTCOAST_BBOX.maxLon) return 'West Coast'
  return 'no_region_inferred'
}

function assignBranchFromRegion(region) {
  const regionToBranch = {
    'Nelson': FS_NELSON_ORG_ID,
    'Otago': '11111111-0001-0001-0001-000000000003',  // FS Queenstown (if exists)
    'Canterbury': null,  // No branch assigned yet
    'West Coast': null,
  }
  return regionToBranch[region] || null
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract EXIF Metadata
// ─────────────────────────────────────────────────────────────────────────────

async function extractExifMetadata(fileBuffer) {
  try {
    const parser = new ExifParser(fileBuffer)
    const result = parser.parse()
    
    const captureTime = result.tags?.DateTime || result.tags?.DateTimeOriginal
    const gpsLatitude = result.tags?.GPSLatitude
    const gpsLongitude = result.tags?.GPSLongitude
    const deviceMake = result.tags?.Make
    const deviceModel = result.tags?.Model
    
    return {
      captureTime: captureTime ? new Date(captureTime.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')).toISOString() : null,
      gpsLatitude,
      gpsLongitude,
      deviceMake,
      deviceModel,
    }
  } catch (error) {
    return { captureTime: null, gpsLatitude: null, gpsLongitude: null, deviceMake: null, deviceModel: null }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Determine Priority and Action
// ─────────────────────────────────────────────────────────────────────────────

function assignPriorityAndAction(exifData, region) {
  // P0: Has GPS + region matched + branch ready = immediate ingest
  if (exifData.gpsLatitude && exifData.gpsLongitude && region !== 'unknown' && region !== 'no_region_inferred') {
    return {
      priorityBand: 'P0',
      ingestAction: 'ingest_to_branch_pipeline',
    }
  }
  
  // P1: Has GPS but no region inferred yet
  if (exifData.gpsLatitude && exifData.gpsLongitude && region === 'no_region_inferred') {
    return {
      priorityBand: 'P1',
      ingestAction: 'run_secondary_geocoder',
    }
  }
  
  // P2: No GPS, needs OCR/filename enrichment
  if (!exifData.gpsLatitude || !exifData.gpsLongitude) {
    return {
      priorityBand: 'P2',
      ingestAction: 'run_ocr_and_filename_enrichment',
    }
  }
  
  // P3: Default (needs manual review)
  return {
    priorityBand: 'P3',
    ingestAction: 'manual_review',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: Index all evidence photos
// ─────────────────────────────────────────────────────────────────────────────

async function indexEvidencePhotos() {
  console.log('🔍 Starting evidence index build...\n')
  
  // List all objects in evidence bucket
  const { data: files, error: listError } = await supabase.storage.from('evidence').list('', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })
  
  if (listError) {
    console.error('❌ Failed to list evidence bucket:', listError.message)
    process.exit(1)
  }
  
  // Filter to image files only
  const imageFiles = (files || []).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name))
  console.log(`📦 Found ${imageFiles.length} image files in evidence bucket\n`)
  
  let indexed = 0
  let created = 0
  let skipped = 0
  const indexRecords = []
  
  for (const file of imageFiles) {
    try {
      const storagePath = file.name
      
      // Check if already indexed
      const { data: existing } = await supabase
        .from('evidence_index')
        .select('id')
        .eq('storage_path', storagePath)
        .single()
      
      if (existing) {
        skipped++
        continue
      }
      
      // Download file for EXIF parsing
      const { data: fileData, error: downloadError } = await supabase.storage.from('evidence').download(storagePath)
      
      if (downloadError) {
        console.warn(`⚠️  Skipped ${storagePath}: download failed`)
        skipped++
        continue
      }
      
      // Extract EXIF
      const buffer = await fileData.arrayBuffer()
      const exifData = await extractExifMetadata(Buffer.from(buffer))
      
      // Infer region and branch
      const region = inferRegionFromGPS(exifData.gpsLatitude, exifData.gpsLongitude)
      const branchId = assignBranchFromRegion(region)
      const { priorityBand, ingestAction } = assignPriorityAndAction(exifData, region)
      
      // Build index record
      const indexRecord = {
        organization_id: orgId,
        storage_path: storagePath,
        storage_bucket: 'evidence',
        exif_capture_timestamp: exifData.captureTime,
        exif_device_make: exifData.deviceMake,
        exif_device_model: exifData.deviceModel,
        gps_latitude: exifData.gpsLatitude,
        gps_longitude: exifData.gpsLongitude,
        inferred_region: region,
        inferred_branch_id: branchId,
        inferred_loi_id: null,  // Will be populated by edge function via geo-matching
        priority_band: priorityBand,
        ingest_action: ingestAction,
        ingest_status: 'queued',
        indexed_at: new Date().toISOString(),
      }
      
      indexRecords.push(indexRecord)
      indexed++
      
      if (indexed % 10 === 0) {
        console.log(`  [${indexed}/${imageFiles.length}] Indexed ${storagePath}...`)
      }
    } catch (error) {
      console.warn(`⚠️  Error indexing file:`, error.message)
      skipped++
    }
  }
  
  console.log(`\n✅ Indexed ${indexed} new photos (${skipped} skipped)\n`)
  
  // Batch insert into evidence_index
  if (indexRecords.length > 0 && !isDryRun) {
    console.log(`📝 Inserting ${indexRecords.length} records into evidence_index...\n`)
    
    const batchSize = 100
    for (let i = 0; i < indexRecords.length; i += batchSize) {
      const batch = indexRecords.slice(i, i + batchSize)
      const { error: insertError } = await supabase.from('evidence_index').insert(batch)
      
      if (insertError) {
        console.error(`❌ Batch insert failed (${i}-${i + batch.length}):`, insertError.message)
      } else {
        created += batch.length
        console.log(`  ✓ Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(indexRecords.length / batchSize)}`)
      }
    }
  } else if (isDryRun) {
    console.log('📊 DRY RUN: Would insert sample records:')
    indexRecords.slice(0, 3).forEach(r => {
      console.log(`  - ${r.storage_path} [${r.priority_band}] → ${r.ingest_action}`)
    })
  }
  
  console.log(`\n📊 Summary:
  ✓ Total indexed: ${indexed}
  ✓ Created in DB: ${created}
  ✓ Skipped: ${skipped}
  ✓ P0 (ready): ${indexRecords.filter(r => r.priority_band === 'P0').length}
  ✓ P1 (secondary geocode): ${indexRecords.filter(r => r.priority_band === 'P1').length}
  ✓ P2 (OCR enrichment): ${indexRecords.filter(r => r.priority_band === 'P2').length}
  ✓ P3 (manual review): ${indexRecords.filter(r => r.priority_band === 'P3').length}
`)
}

indexEvidencePhotos().catch(error => {
  console.error('❌ Fatal error:', error.message)
  process.exit(1)
})
