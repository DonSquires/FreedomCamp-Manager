/**
 * check-bundle-budget.mjs
 * ───────────────────────
 * Performance budget enforcement script for CI and local pre-deploy checks.
 *
 * Usage:  node scripts/check-bundle-budget.mjs
 *
 * Reads every *.js and *.css file in dist/assets/, gzip-compresses it in
 * memory, and compares the result against the per-file and per-type budgets
 * defined below. Exits 1 if any budget is exceeded so CI pipelines can gate
 * on it.
 *
 * Budget rationale (Weeks 9-10 — performance budget enforcement):
 *   - JS chunks that are large vendor splits (charts, pdf, xlsx) are given
 *     higher allowances since they are cached separately and only downloaded
 *     once per deploy.
 *   - Application page chunks (FieldOfficerPortal, AdminPortal, AppLayout)
 *     must not grow uncontrolled — those affect perceived load on the most
 *     critical paths.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { gzipSync } from 'zlib'

// ─── Budget config ────────────────────────────────────────────────────────────

/** Max gzip size (bytes) for any single JS chunk that is NOT a known heavy vendor. */
const APP_CHUNK_MAX_GZIP = 200 * 1024  // 200 kB gzip

/** Max gzip size (bytes) for any single CSS file. */
const CSS_MAX_GZIP = 50 * 1024         // 50 kB gzip

/**
 * Named overrides for known-large chunks that cannot be split further
 * (e.g. vendor bundles, PDF.js, XLSX).
 * Key: substring of the filename. Value: max gzip bytes.
 */
const NAMED_OVERRIDES = {
  'vendor-charts':    150 * 1024,  // recharts
  'vendor-xlsx':      160 * 1024,  // xlsx
  'pdf-':             160 * 1024,  // PDF.js worker distributed separately
  'pdf.worker':       400 * 1024,  // PDF.js worker mjs (uncompressed, separate path)
  'vendor-radix':      55 * 1024,  // Radix UI primitives
  'vendor-supabase':   65 * 1024,
  'vendor-maps':       70 * 1024,
  'vendor-react':      70 * 1024,
  'vendor-utils':      25 * 1024,
  'vendor-query':      20 * 1024,
  // Known large app shells — monitored but allowed to be larger:
  'FieldOfficerPortal': 55 * 1024,
  'AppLayout':          30 * 1024,
  'BobAssistantStudio': 50 * 1024,
  'index-':            150 * 1024,  // main entry — App.tsx + all route defs; cannot split further
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const distAssets = join(process.cwd(), 'dist', 'assets')

let files
try {
  files = readdirSync(distAssets)
} catch {
  console.error('dist/assets not found — run `npm run build` first.')
  process.exit(2)
}

let violations = 0

for (const file of files.sort()) {
  if (!file.endsWith('.js') && !file.endsWith('.mjs') && !file.endsWith('.css')) continue

  const filePath = join(distAssets, file)
  const size = statSync(filePath).size
  // Skip files larger than 2 MB raw (pdf worker) — they are intentional and
  // separately cached; only the .mjs variant needs a soft check.
  if (size > 2_000_000 && file.endsWith('.mjs')) {
    console.log(`  ⚠️  ${file}  ${(size / 1024).toFixed(0)} kB raw (worker, skipped gzip budget)`)
    continue
  }

  const content = readFileSync(filePath)
  const gzipped = gzipSync(content).length

  // Determine applicable budget
  let budget = file.endsWith('.css') ? CSS_MAX_GZIP : APP_CHUNK_MAX_GZIP
  for (const [key, val] of Object.entries(NAMED_OVERRIDES)) {
    if (file.includes(key)) {
      budget = val
      break
    }
  }

  const gzipKB   = (gzipped / 1024).toFixed(1)
  const budgetKB = (budget  / 1024).toFixed(0)
  const over     = gzipped > budget

  if (over) {
    console.error(`  ❌ ${file}  ${gzipKB} kB gzip  (budget: ${budgetKB} kB)  EXCEEDED`)
    violations++
  } else {
    const pct = Math.round((gzipped / budget) * 100)
    const bar = pct >= 90 ? '⚠️ ' : '✅'
    console.log(`  ${bar} ${file}  ${gzipKB} kB gzip / ${budgetKB} kB  (${pct}%)`)
  }
}

console.log('')
if (violations > 0) {
  console.error(`${violations} bundle budget violation${violations > 1 ? 's' : ''} found. Reduce chunk sizes or raise the budget with justification.`)
  process.exit(1)
} else {
  console.log('All bundle budgets satisfied.')
}
