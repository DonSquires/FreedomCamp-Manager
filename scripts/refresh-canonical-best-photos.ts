import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function clamp(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

const LIMIT = clamp(process.env.LIMIT, 500, 1, 100000)
const CONCURRENCY = clamp(process.env.CONCURRENCY, 5, 1, 30)
const FORCE_UPDATE = process.env.FORCE_UPDATE !== '0'
const ONLY_MISSING = process.env.ONLY_MISSING === '1'
const PLATE_FILTER = process.env.PLATE_FILTER?.trim().toUpperCase() || null

async function listTargetPlates(): Promise<string[]> {
  let query = supabase
    .from('canonical_vehicles')
    .select('plate_number, profile_photo')
    .not('plate_number', 'is', null)
    .order('plate_number', { ascending: true })
    .limit(LIMIT)

  if (ONLY_MISSING) {
    query = query.is('profile_photo', null)
  }

  const { data, error } = await query
  if (error) throw error

  let plates = (data ?? [])
    .map((r: any) => String(r.plate_number || '').trim().toUpperCase())
    .filter(Boolean)

  if (PLATE_FILTER) {
    plates = plates.filter((p) => p.includes(PLATE_FILTER))
  }

  return [...new Set(plates)]
}

async function processPlate(plate: string): Promise<{ ok: boolean; skipped: boolean; plate: string; reason?: string }> {
  const { data, error } = await supabase.functions.invoke('select-best-vehicle-photo', {
    body: {
      plate_number: plate,
      force_update: FORCE_UPDATE,
    },
  })

  if (error) {
    return { ok: false, skipped: false, plate, reason: error.message }
  }

  if (!data?.bestPhoto) {
    return { ok: false, skipped: false, plate, reason: data?.error || 'no_best_photo' }
  }

  if (data?.skippedByQualityGate) {
    return { ok: false, skipped: true, plate, reason: 'quality_gate_not_met' }
  }

  return { ok: true, skipped: false, plate }
}

async function main() {
  const plates = await listTargetPlates()
  console.log(`Targets: ${plates.length} plate(s)`)
  if (plates.length === 0) return

  let idx = 0
  let success = 0
  let failed = 0
  let skipped = 0

  const workers = Array.from({ length: Math.min(CONCURRENCY, plates.length) }, async () => {
    while (true) {
      const current = idx
      idx += 1
      if (current >= plates.length) return
      const plate = plates[current]

      const result = await processPlate(plate)
      if (result.ok) {
        success += 1
      } else if (result.skipped) {
        skipped += 1
        console.warn(`SKIPPED ${plate}: ${result.reason}`)
      } else {
        failed += 1
        console.warn(`FAILED ${plate}: ${result.reason}`)
      }

      if ((success + failed + skipped) % 25 === 0 || success + failed + skipped === plates.length) {
        console.log(`Progress ${success + failed + skipped}/${plates.length} (success=${success}, skipped=${skipped}, failed=${failed})`)
      }
    }
  })

  await Promise.all(workers)
  console.log(`Done. Success=${success}, Skipped=${skipped}, Failed=${failed}, Total=${plates.length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
