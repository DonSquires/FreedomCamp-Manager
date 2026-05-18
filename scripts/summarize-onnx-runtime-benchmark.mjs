#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

function parseArgs(argv) {
  const args = {
    inFile: '',
    outFile: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if ((token === '--in' || token === '-i') && argv[i + 1]) {
      args.inFile = String(argv[i + 1]).trim()
      i += 1
    } else if ((token === '--out' || token === '-o') && argv[i + 1]) {
      args.outFile = String(argv[i + 1]).trim()
      i += 1
    }
  }

  if (!args.inFile) {
    throw new Error('Missing required --in <benchmark-json-path> argument')
  }

  if (!args.outFile) {
    const dir = path.dirname(args.inFile)
    const base = path.basename(args.inFile, path.extname(args.inFile))
    args.outFile = path.join(dir, `${base}.md`)
  }

  return args
}

function formatMetric(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a'
  return `${Number(value).toFixed(2)}${suffix}`
}

function toMarkdown(report) {
  const meta = report?.meta || {}
  const recommendation = report?.recommendation || {}
  const results = Array.isArray(report?.results) ? report.results : []

  const lines = []
  lines.push('# ONNX Runtime Profile Benchmark Report')
  lines.push('')
  lines.push(`- Generated: ${meta.generatedAt || 'n/a'}`)
  lines.push(`- Profiles: ${(meta.profiles || []).join(', ') || 'n/a'}`)
  lines.push(`- Iterations: ${meta.iterations ?? 'n/a'}`)
  lines.push(`- Warmup: ${meta.warmup ?? 'n/a'}`)
  lines.push(`- CPU Count: ${meta.cpuCount ?? 'n/a'}`)
  lines.push('')
  lines.push('## Recommendation')
  lines.push('')
  lines.push(`- Recommended Profile: ${recommendation.recommendedProfile || 'n/a'}`)
  lines.push(`- Reason: ${recommendation.reason || 'n/a'}`)
  lines.push('')
  lines.push('## Benchmark Rows')
  lines.push('')
  lines.push('| Profile | Model | Mean (ms) | P95 (ms) | Throughput (req/s) | Status |')
  lines.push('| --- | --- | ---: | ---: | ---: | --- |')

  for (const row of results) {
    if (row.error || !row.stats) {
      lines.push(`| ${row.profile || 'n/a'} | ${row.model || 'n/a'} | n/a | n/a | n/a | error: ${row.error || 'unknown'} |`)
      continue
    }

    lines.push(`| ${row.profile} | ${row.model} | ${formatMetric(row.stats.meanMs)} | ${formatMetric(row.stats.p95Ms)} | ${formatMetric(row.stats.throughputPerSecond)} | ok |`)
  }

  lines.push('')
  lines.push('## Suggested Environment Baseline')
  lines.push('')
  lines.push('Use the recommended profile as the first-choice default:')
  lines.push('')
  lines.push('```env')
  lines.push(`ONNX_RUNTIME_PROFILE=${recommendation.recommendedProfile || 'balanced'}`)
  lines.push('# Optional explicit overrides only after host-specific testing:')
  lines.push('# ONNX_INTRA_OP_THREADS=4')
  lines.push('# ONNX_INTER_OP_THREADS=1')
  lines.push('# ONNX_GRAPH_OPT_LEVEL=all')
  lines.push('```')
  lines.push('')

  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inPath = path.resolve(args.inFile)
  const outPath = path.resolve(args.outFile)

  const raw = await fs.readFile(inPath, 'utf8')
  const report = JSON.parse(raw)
  const markdown = toMarkdown(report)

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${markdown}\n`, 'utf8')

  console.log(`Benchmark summary markdown written: ${outPath}`)
}

main().catch((error) => {
  console.error('[summarize-onnx-runtime-benchmark] fatal:', error?.message || error)
  process.exit(1)
})
