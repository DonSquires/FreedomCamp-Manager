#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

function parseArgs(argv) {
  const options = {
    bucket: 'evidence',
    outDir: 'tmp/docs/storage-review/evidence-full-index',
    limit: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--bucket' && argv[i + 1]) {
      options.bucket = argv[i + 1]
      i += 1
    } else if (arg === '--outDir' && argv[i + 1]) {
      options.outDir = argv[i + 1]
      i += 1
    } else if (arg === '--limit' && argv[i + 1]) {
      const parsed = Number(argv[i + 1])
      options.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : null
      i += 1
    }
  }

  return options
}

function readUInt(view, offset, littleEndian, bytes) {
  if (bytes === 2) return littleEndian ? view.getUint16(offset, true) : view.getUint16(offset, false)
  if (bytes === 4) return littleEndian ? view.getUint32(offset, true) : view.getUint32(offset, false)
  throw new Error('Unsupported integer size')
}

function rational(view, offset, littleEndian) {
  const numerator = readUInt(view, offset, littleEndian, 4)
  const denominator = readUInt(view, offset + 4, littleEndian, 4)
  if (!denominator) return null
  return numerator / denominator
}

function parseIFD(view, tiffStart, ifdOffset, littleEndian) {
  const entries = new Map()
  const count = readUInt(view, tiffStart + ifdOffset, littleEndian, 2)
  let ptr = tiffStart + ifdOffset + 2

  for (let i = 0; i < count; i += 1) {
    const tag = readUInt(view, ptr, littleEndian, 2)
    const type = readUInt(view, ptr + 2, littleEndian, 2)
    const itemCount = readUInt(view, ptr + 4, littleEndian, 4)
    const valueOrOffset = readUInt(view, ptr + 8, littleEndian, 4)
    entries.set(tag, { tag, type, count: itemCount, valueOrOffset, entryPtr: ptr })
    ptr += 12
  }

  return entries
}

function readAscii(view, tiffStart, record, littleEndian) {
  const bytes = record.count
  const offset = bytes <= 4 ? record.entryPtr + 8 : tiffStart + record.valueOrOffset
  const raw = new Uint8Array(view.buffer, view.byteOffset + offset, record.count)
  const text = Buffer.from(raw).toString('ascii').replace(/\0+$/, '')
  return text
}

function readRationalArray(view, tiffStart, record, littleEndian) {
  const base = tiffStart + record.valueOrOffset
  const values = []
  for (let i = 0; i < record.count; i += 1) {
    values.push(rational(view, base + i * 8, littleEndian))
  }
  return values
}

function dmsToDecimal(values, ref) {
  if (!values || values.length < 3) return null
  const [d, m, s] = values
  if ([d, m, s].some((v) => v == null || Number.isNaN(v))) return null

  let decimal = d + m / 60 + s / 3600
  if (ref === 'S' || ref === 'W') decimal *= -1
  return decimal
}

function parseExifFromJpeg(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null

  let cursor = 2
  while (cursor + 4 < view.byteLength) {
    if (view.getUint8(cursor) !== 0xff) break

    const marker = view.getUint8(cursor + 1)
    const segmentLength = view.getUint16(cursor + 2)

    if (marker === 0xe1 && segmentLength >= 10) {
      const exifHeader = Buffer.from(buffer.subarray(cursor + 4, cursor + 10)).toString('ascii')
      if (exifHeader === 'Exif\u0000\u0000') {
        const tiffStart = cursor + 10
        const endianMark = Buffer.from(buffer.subarray(tiffStart, tiffStart + 2)).toString('ascii')
        const littleEndian = endianMark === 'II'
        const magic = readUInt(view, tiffStart + 2, littleEndian, 2)
        if (magic !== 42) return null

        const ifd0Offset = readUInt(view, tiffStart + 4, littleEndian, 4)
        const ifd0 = parseIFD(view, tiffStart, ifd0Offset, littleEndian)

        const result = {
          make: null,
          model: null,
          datetime_original: null,
          gps_latitude: null,
          gps_longitude: null,
        }

        const makeRec = ifd0.get(0x010f)
        const modelRec = ifd0.get(0x0110)
        if (makeRec) result.make = readAscii(view, tiffStart, makeRec, littleEndian)
        if (modelRec) result.model = readAscii(view, tiffStart, modelRec, littleEndian)

        const exifPtr = ifd0.get(0x8769)
        if (exifPtr) {
          const exifIfd = parseIFD(view, tiffStart, exifPtr.valueOrOffset, littleEndian)
          const dto = exifIfd.get(0x9003)
          const dt = exifIfd.get(0x0132)
          if (dto) result.datetime_original = readAscii(view, tiffStart, dto, littleEndian)
          if (!result.datetime_original && dt) result.datetime_original = readAscii(view, tiffStart, dt, littleEndian)
        }

        const gpsPtr = ifd0.get(0x8825)
        if (gpsPtr) {
          const gpsIfd = parseIFD(view, tiffStart, gpsPtr.valueOrOffset, littleEndian)
          const latRefRec = gpsIfd.get(0x0001)
          const latRec = gpsIfd.get(0x0002)
          const lonRefRec = gpsIfd.get(0x0003)
          const lonRec = gpsIfd.get(0x0004)

          const latRef = latRefRec ? readAscii(view, tiffStart, latRefRec, littleEndian) : null
          const lonRef = lonRefRec ? readAscii(view, tiffStart, lonRefRec, littleEndian) : null

          if (latRec) result.gps_latitude = dmsToDecimal(readRationalArray(view, tiffStart, latRec, littleEndian), latRef)
          if (lonRec) result.gps_longitude = dmsToDecimal(readRationalArray(view, tiffStart, lonRec, littleEndian), lonRef)
        }

        return result
      }
    }

    if (marker === 0xda || segmentLength < 2) break
    cursor += 2 + segmentLength
  }

  return null
}

function inferBranchAttribution(lat, lon) {
  if (lat == null || lon == null) {
    return {
      region: null,
      jurisdiction: null,
      branch: null,
      confidence: null,
    }
  }

  // Canonical First Security branch jurisdictions (approx geofence boxes).
  const zones = [
    {
      branch: 'First Security - Nelson',
      region: 'Nelson/Tasman',
      jurisdiction: 'Nelson',
      latMin: -41.95,
      latMax: -40.8,
      lonMin: 172.2,
      lonMax: 174.6,
    },
    {
      branch: 'First Security - Nelson',
      region: 'Nelson/Tasman',
      jurisdiction: 'Tasman',
      latMin: -41.9,
      latMax: -40.3,
      lonMin: 172.0,
      lonMax: 173.6,
    },
    {
      branch: 'First Security - Blenheim',
      region: 'Marlborough',
      jurisdiction: 'Marlborough',
      latMin: -42.5,
      latMax: -40.7,
      lonMin: 173.0,
      lonMax: 174.7,
    },
    {
      branch: 'First Security - Greymouth',
      region: 'West Coast',
      jurisdiction: 'Buller/Grey/Westland',
      latMin: -44.3,
      latMax: -41.0,
      lonMin: 168.8,
      lonMax: 172.2,
    },
    {
      branch: 'First Security - Christchurch',
      region: 'Canterbury',
      jurisdiction: 'North Canterbury',
      latMin: -43.2,
      latMax: -42.0,
      lonMin: 171.8,
      lonMax: 173.4,
    },
    {
      branch: 'First Security - Christchurch',
      region: 'Canterbury',
      jurisdiction: 'Central Canterbury',
      latMin: -44.2,
      latMax: -43.1,
      lonMin: 171.5,
      lonMax: 173.3,
    },
    {
      branch: 'First Security - Timaru',
      region: 'Canterbury',
      jurisdiction: 'South Canterbury',
      latMin: -44.9,
      latMax: -43.3,
      lonMin: 170.2,
      lonMax: 172.1,
    },
    {
      branch: 'First Security - Oamaru',
      region: 'Otago',
      jurisdiction: 'North Otago',
      latMin: -45.5,
      latMax: -44.0,
      lonMin: 169.0,
      lonMax: 171.4,
    },
    {
      branch: 'First Security - Queenstown',
      region: 'Otago',
      jurisdiction: 'Central Otago',
      latMin: -46.0,
      latMax: -44.4,
      lonMin: 168.0,
      lonMax: 170.3,
    },
    {
      branch: 'First Security - Dunedin',
      region: 'Otago',
      jurisdiction: 'Otago',
      latMin: -46.5,
      latMax: -44.0,
      lonMin: 168.0,
      lonMax: 171.6,
    },
    {
      branch: 'First Security - Invercargill',
      region: 'Southland',
      jurisdiction: 'Southland',
      latMin: -47.7,
      latMax: -45.0,
      lonMin: 166.2,
      lonMax: 169.8,
    },
  ]

  const match = zones.find((z) => lat >= z.latMin && lat <= z.latMax && lon >= z.lonMin && lon <= z.lonMax)
  if (!match) {
    return {
      region: 'Unknown/Outside NZ South-Island map',
      jurisdiction: 'Unknown',
      branch: 'Unknown',
      confidence: 'low',
    }
  }

  return {
    region: match.region,
    jurisdiction: match.jurisdiction,
    branch: match.branch,
    confidence: 'approx_bbox',
  }
}

function toCsv(rows) {
  const headers = [
    'bucket',
    'path',
    'updated_at',
    'size_bytes',
    'exif_found',
    'datetime_original',
    'make',
    'model',
    'gps_latitude',
    'gps_longitude',
    'inferred_region',
    'inferred_jurisdiction',
    'inferred_branch',
    'region_confidence',
    'download_error',
  ]

  const escape = (value) => {
    if (value == null) return ''
    const str = String(value)
    if (!/[",\n]/.test(str)) return str
    return `"${str.replace(/"/g, '""')}"`
  }

  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','))
  }
  return `${lines.join('\n')}\n`
}

async function walkBucket(supabase, bucket) {
  const stack = ['']
  const files = []

  while (stack.length) {
    const prefix = stack.pop()
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 100, sortBy: { column: 'updated_at', order: 'desc' } })

    if (error) continue

    for (const item of data || []) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id === null) {
        stack.push(fullPath)
      } else {
        files.push({
          bucket,
          path: fullPath,
          updated_at: item.updated_at || null,
          size_bytes: item.metadata?.size ?? null,
        })
      }
    }
  }

  return files
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  loadLocalEnv()
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  await fs.mkdir(options.outDir, { recursive: true })

  const allFiles = await walkBucket(supabase, options.bucket)
  const imageFiles = allFiles.filter((f) => /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(f.path))
  const target = options.limit ? imageFiles.slice(0, options.limit) : imageFiles

  const rows = []
  for (let i = 0; i < target.length; i += 1) {
    const file = target[i]
    const progress = `${i + 1}/${target.length}`
    try {
      const { data, error } = await supabase.storage.from(options.bucket).download(file.path)
      if (error || !data) {
        rows.push({
          ...file,
          exif_found: false,
          datetime_original: null,
          make: null,
          model: null,
          gps_latitude: null,
          gps_longitude: null,
          inferred_region: null,
          region_confidence: null,
          download_error: error?.message || 'download returned empty data',
        })
        continue
      }

      const binary = Buffer.from(await data.arrayBuffer())
      const exif = parseExifFromJpeg(binary)
      const attribution = inferBranchAttribution(exif?.gps_latitude ?? null, exif?.gps_longitude ?? null)

      rows.push({
        ...file,
        exif_found: !!exif,
        datetime_original: exif?.datetime_original || null,
        make: exif?.make || null,
        model: exif?.model || null,
        gps_latitude: exif?.gps_latitude ?? null,
        gps_longitude: exif?.gps_longitude ?? null,
        inferred_region: attribution.region,
        inferred_jurisdiction: attribution.jurisdiction,
        inferred_branch: attribution.branch,
        region_confidence: attribution.confidence,
        download_error: null,
      })

      if ((i + 1) % 25 === 0 || i + 1 === target.length) {
        console.log(`Indexed ${progress}`)
      }
    } catch (error) {
      rows.push({
        ...file,
        exif_found: false,
        datetime_original: null,
        make: null,
        model: null,
        gps_latitude: null,
        gps_longitude: null,
        inferred_region: null,
        region_confidence: null,
        download_error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const regionSummary = {}
  const branchSummary = {}
  const jurisdictionSummary = {}
  for (const row of rows) {
    const key = row.inferred_region || 'No region inferred'
    regionSummary[key] = (regionSummary[key] || 0) + 1

    const branchKey = row.inferred_branch || 'No branch inferred'
    branchSummary[branchKey] = (branchSummary[branchKey] || 0) + 1

    const jurisdictionKey = row.inferred_jurisdiction || 'No jurisdiction inferred'
    jurisdictionSummary[jurisdictionKey] = (jurisdictionSummary[jurisdictionKey] || 0) + 1
  }

  const output = {
    generated_at: new Date().toISOString(),
    bucket: options.bucket,
    scanned_files: allFiles.length,
    image_files: imageFiles.length,
    indexed_images: rows.length,
    with_exif: rows.filter((r) => r.exif_found).length,
    with_gps: rows.filter((r) => r.gps_latitude != null && r.gps_longitude != null).length,
    region_summary: regionSummary,
    branch_summary: branchSummary,
    jurisdiction_summary: jurisdictionSummary,
    rows,
  }

  const jsonPath = path.join(options.outDir, 'evidence-exif-index.json')
  const csvPath = path.join(options.outDir, 'evidence-exif-index.csv')
  const summaryPath = path.join(options.outDir, 'region-summary.json')

  await fs.writeFile(jsonPath, JSON.stringify(output, null, 2))
  await fs.writeFile(csvPath, toCsv(rows))
  await fs.writeFile(summaryPath, JSON.stringify({
    generated_at: output.generated_at,
    bucket: output.bucket,
    scanned_files: output.scanned_files,
    image_files: output.image_files,
    indexed_images: output.indexed_images,
    with_exif: output.with_exif,
    with_gps: output.with_gps,
    region_summary: output.region_summary,
    branch_summary: output.branch_summary,
    jurisdiction_summary: output.jurisdiction_summary,
  }, null, 2))

  console.log('Evidence EXIF index complete')
  console.log(`JSON: ${jsonPath}`)
  console.log(`CSV: ${csvPath}`)
  console.log(`Summary: ${summaryPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
