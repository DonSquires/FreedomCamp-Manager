#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DIST_ASSETS = path.resolve(process.cwd(), 'dist/assets')
const DEFAULT_MAX_JS_KB = 550
const DEFAULT_MAX_CSS_KB = 250
const DEFAULT_MAX_TOTAL_JS_KB = 7200
const DEFAULT_EXEMPT_TOKENS = ['pdf.worker']

function parseNumberEnv(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function parseExemptTokens() {
  const raw = String(process.env.BUILD_BUDGET_EXEMPT_TOKENS || '').trim()
  if (!raw) return [...DEFAULT_EXEMPT_TOKENS]
  return raw.split(',').map((token) => token.trim()).filter(Boolean)
}

function toKb(bytes) {
  return bytes / 1024
}

async function loadAssetRows() {
  const entries = await fs.readdir(DIST_ASSETS, { withFileTypes: true })
  const rows = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const fullPath = path.join(DIST_ASSETS, entry.name)
    const stat = await fs.stat(fullPath)
    rows.push({
      file: entry.name,
      bytes: stat.size,
      kb: toKb(stat.size),
      ext: path.extname(entry.name).toLowerCase(),
    })
  }

  return rows
}

function isExempt(file, tokens) {
  return tokens.some((token) => file.includes(token))
}

async function main() {
  const maxJsKb = parseNumberEnv('BUILD_BUDGET_MAX_JS_KB', DEFAULT_MAX_JS_KB)
  const maxCssKb = parseNumberEnv('BUILD_BUDGET_MAX_CSS_KB', DEFAULT_MAX_CSS_KB)
  const maxTotalJsKb = parseNumberEnv('BUILD_BUDGET_MAX_TOTAL_JS_KB', DEFAULT_MAX_TOTAL_JS_KB)
  const exemptTokens = parseExemptTokens()

  let rows = []
  try {
    rows = await loadAssetRows()
  } catch {
    throw new Error('dist/assets not found. Run bun run build before budget checks.')
  }

  const jsRows = rows.filter((row) => row.ext === '.js' || row.ext === '.mjs')
  const cssRows = rows.filter((row) => row.ext === '.css')

  const nonExemptJsRows = jsRows.filter((row) => !isExempt(row.file, exemptTokens))
  const nonExemptCssRows = cssRows.filter((row) => !isExempt(row.file, exemptTokens))

  const jsOverBudget = nonExemptJsRows.filter((row) => row.kb > maxJsKb).sort((a, b) => b.kb - a.kb)
  const cssOverBudget = nonExemptCssRows.filter((row) => row.kb > maxCssKb).sort((a, b) => b.kb - a.kb)
  const totalJsKb = nonExemptJsRows.reduce((sum, row) => sum + row.kb, 0)

  const failures = []

  if (jsOverBudget.length > 0) {
    failures.push(`JS chunk budget exceeded (${maxJsKb} kB max).`)
  }

  if (cssOverBudget.length > 0) {
    failures.push(`CSS asset budget exceeded (${maxCssKb} kB max).`)
  }

  if (totalJsKb > maxTotalJsKb) {
    failures.push(`Total JS budget exceeded (${maxTotalJsKb} kB max, got ${totalJsKb.toFixed(2)} kB).`)
  }

  console.log('[build-budget] Summary')
  console.log(`- JS chunk max: ${maxJsKb} kB`)
  console.log(`- CSS asset max: ${maxCssKb} kB`)
  console.log(`- Total JS max: ${maxTotalJsKb} kB`)
  console.log(`- Exempt tokens: ${exemptTokens.join(', ')}`)
  console.log(`- Total non-exempt JS: ${totalJsKb.toFixed(2)} kB`)

  if (jsOverBudget.length > 0) {
    console.log('[build-budget] JS over budget:')
    for (const row of jsOverBudget.slice(0, 10)) {
      console.log(`- ${row.file}: ${row.kb.toFixed(2)} kB`)
    }
  }

  if (cssOverBudget.length > 0) {
    console.log('[build-budget] CSS over budget:')
    for (const row of cssOverBudget.slice(0, 10)) {
      console.log(`- ${row.file}: ${row.kb.toFixed(2)} kB`)
    }
  }

  if (failures.length > 0) {
    console.error('[build-budget] FAIL')
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exit(1)
  }

  console.log('[build-budget] PASS')
}

main().catch((error) => {
  console.error(`[build-budget] ${error.message}`)
  process.exit(1)
})
