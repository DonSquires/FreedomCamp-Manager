#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function getArg(name, fallback = '') {
  const key = `--${name}`
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === key) return String(argv[i + 1] || fallback)
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1)
  }
  return fallback
}

function readLines(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function safeJson(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function mean(values) {
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function f1(tp, fp, fn) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall)
}

function evaluateVariant(records, variantName) {
  const rows = records
    .map((r) => ({
      gtAction: r?.ground_truth_action,
      gtExcessive: r?.ground_truth_excessive,
      v: r?.variants?.[variantName],
    }))
    .filter((r) => r.v)

  if (!rows.length) return null

  const actionCorrect = rows.filter((r) => r.v.predicted_action === r.gtAction).length

  let tp = 0
  let fp = 0
  let fn = 0
  for (const r of rows) {
    const pred = Boolean(r.v.predicted_excessive)
    const gt = Boolean(r.gtExcessive)
    if (pred && gt) tp += 1
    if (pred && !gt) fp += 1
    if (!pred && gt) fn += 1
  }

  const overrideRate = rows.filter((r) => Boolean(r.v.human_override)).length / rows.length
  const confidence = rows.map((r) => Number(r.v.confidence)).filter((x) => Number.isFinite(x))
  const decisionSeconds = rows.map((r) => Number(r.v.decision_seconds)).filter((x) => Number.isFinite(x))

  return {
    sampleSize: rows.length,
    actionAccuracy: Number((actionCorrect / rows.length).toFixed(4)),
    excessiveF1: Number(f1(tp, fp, fn).toFixed(4)),
    overrideRate: Number(overrideRate.toFixed(4)),
    avgConfidence: confidence.length ? Number(mean(confidence).toFixed(4)) : null,
    avgDecisionSeconds: decisionSeconds.length ? Number(mean(decisionSeconds).toFixed(3)) : null,
  }
}

function main() {
  const out = resolve(process.cwd(), getArg('out', 'data/research-smoke-ablation.json'))
  const input = getArg('input', 'data/smoke-ablation-evals.jsonl')

  const lines = readLines(resolve(process.cwd(), input))
  const records = lines.map(safeJson).filter(Boolean)

  const variants = ['sfa_only', 'sfa_with_duration', 'sfa_contextual']
  const results = Object.fromEntries(variants.map((v) => [v, evaluateVariant(records, v)]))

  const bestVariant = variants
    .map((v) => ({ v, score: results[v]?.actionAccuracy ?? -1 }))
    .sort((a, b) => b.score - a.score)[0]

  const payload = {
    generatedAt: new Date().toISOString(),
    input,
    framework: {
      note: 'Smoke Force Assessment (SFA) ablation: testing smoke profile scoring with duration and context variants',
      variants: ['sfa_only', 'sfa_with_duration', 'sfa_contextual'],
      baseline: 'sfa_only',
    },
    metrics: results,
    bestVariant: bestVariant?.v,
    notes: [
      'sfa_only: Base SFA score (opacity, color, materials, duration, continuity, drifting, odor)',
      'sfa_with_duration: SFA + duration term emphasizes long-burning fires',
      'sfa_contextual: SFA + context bias for residential_domestic and burn_off cases',
    ],
  }

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(`smoke_ablation=${out}`)
  console.log(`records=${records.length}`)
  console.log(`best_variant=${bestVariant?.v}`)
}

main()
