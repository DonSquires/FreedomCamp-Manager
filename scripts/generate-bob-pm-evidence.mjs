#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative, extname } from 'node:path'

const ROOT = process.cwd()

function readText(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), 'utf8')
}

function readJsonl(relativePath) {
  return readText(relativePath)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function walkFiles(relativeDir) {
  const rootPath = resolve(ROOT, relativeDir)
  if (!existsSync(rootPath)) return []

  const results = []
  for (const entry of readdirSync(rootPath)) {
    const absolutePath = resolve(rootPath, entry)
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) {
      results.push(...walkFiles(relative(ROOT, absolutePath)))
    } else {
      results.push(relative(ROOT, absolutePath).replace(/\\/g, '/'))
    }
  }
  return results
}

function mean(values) {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function f1(tp, fp, fn) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall)
}

function countBy(records, selector) {
  return records.reduce((acc, record) => {
    const key = String(selector(record))
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

function firstPerKey(records, selector) {
  const seen = new Set()
  const selected = []

  for (const record of records) {
    const key = String(selector(record))
    if (seen.has(key)) continue
    seen.add(key)
    selected.push(record)
  }

  return selected
}

function evaluateVariant(records, variantName) {
  const rows = records
    .map((record) => ({
      gtAction: record.ground_truth_action,
      gtExcessive: Boolean(record.ground_truth_excessive),
      variant: record?.variants?.[variantName],
    }))
    .filter((row) => row.variant)

  if (!rows.length) return null

  const actionCorrect = rows.filter((row) => row.variant.predicted_action === row.gtAction).length
  let tp = 0
  let fp = 0
  let fn = 0

  for (const row of rows) {
    const predicted = Boolean(row.variant.predicted_excessive)
    const actual = Boolean(row.gtExcessive)
    if (predicted && actual) tp += 1
    if (predicted && !actual) fp += 1
    if (!predicted && actual) fn += 1
  }

  const confidence = rows
    .map((row) => Number(row.variant.confidence))
    .filter((value) => Number.isFinite(value))
  const decisionSeconds = rows
    .map((row) => Number(row.variant.decision_seconds))
    .filter((value) => Number.isFinite(value))
  const overrides = rows.filter((row) => Boolean(row.variant.human_override)).length

  return {
    sampleSize: rows.length,
    actionAccuracy: Number((actionCorrect / rows.length).toFixed(4)),
    excessiveF1: Number(f1(tp, fp, fn).toFixed(4)),
    avgConfidence: confidence.length ? Number(mean(confidence).toFixed(4)) : null,
    avgDecisionSeconds: decisionSeconds.length ? Number(mean(decisionSeconds).toFixed(3)) : null,
    overrideRate: Number((overrides / rows.length).toFixed(4)),
  }
}

function buildAlprInventory() {
  const inventoryRoots = ['src/assets', 'public', 'tests/e2e/__snapshots__']
  const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp'])
  const relevantFiles = inventoryRoots
    .flatMap((dir) => walkFiles(dir))
    .filter((filePath) => imageExtensions.has(extname(filePath).toLowerCase()))
    .filter((filePath) => /(sticker|plate|vehicle|face|car|evidence)/i.test(filePath))

  const assets = relevantFiles.map((filePath) => {
    let category = 'other_reference'
    if (/sticker/i.test(filePath)) category = 'sticker_reference'
    else if (/face/i.test(filePath)) category = 'face_ui_snapshot'
    else if (/(vehicle|plate|car)/i.test(filePath)) category = 'vehicle_ui_snapshot'

    return {
      path: filePath,
      category,
      evidenceClass: filePath.startsWith('src/assets/') ? 'reference_asset' : 'ui_snapshot',
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    scope: 'repo-local-image-anchors',
    intendedUse: 'ALPR and face-review PM evidence grounding',
    inventoryStatus: assets.some((asset) => asset.category === 'sticker_reference')
      ? 'local-reference-attached'
      : 'no-local-alpr-assets-found',
    counts: countBy(assets, (asset) => asset.category),
    assets,
    limitations: [
      'No raw production observation corpus is checked into this repository.',
      'This inventory covers local reference assets and UI snapshots only.',
    ],
  }
}

function makeAlprInventoryMarkdown(inventory) {
  const rows = inventory.assets.length
    ? inventory.assets.map((asset) => `| ${asset.category} | ${asset.evidenceClass} | ${asset.path} |`).join('\n')
    : '| none | none | none |'

  return `# ALPR Local Image Inventory\n\nGenerated: ${inventory.generatedAt}\n\n- Scope: ${inventory.scope}\n- Status: ${inventory.inventoryStatus}\n\n| Category | Evidence class | Path |\n|---|---|---|\n${rows}\n\n## Limitations\n\n${inventory.limitations.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n`
}

function buildSmokeReviewerPacket(records) {
  const ordered = [...records].sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')))
  const sample = firstPerKey(ordered, (record) => record.ground_truth_action || 'unknown').slice(0, 5)

  return {
    generatedAt: new Date().toISOString(),
    source: 'data/smoke-ablation-evals.jsonl',
    reviewStatus: 'sampling-packet-attached-human-signoff-pending',
    sampleSize: sample.length,
    sampledRecords: sample.map((record) => ({
      id: record.id,
      groundTruthAction: record.ground_truth_action,
      groundTruthExcessive: Boolean(record.ground_truth_excessive),
      summary: {
        opacity: record?.source?.opacity,
        color: record?.source?.color,
        fireType: record?.source?.fire_type,
        durationMinutes: record?.source?.duration_minutes,
        prohibitedMaterialsSuspected: Boolean(record?.source?.prohibited_materials_suspected),
        smokeAffectingRoad: Boolean(record?.source?.smoke_affecting_road),
      },
    })),
    reviewerChecklist: [
      'Confirm the action label matches the observed source facts, not the model prediction.',
      'Confirm excessive or non-excessive classification is still defensible under the current policy.',
      'Confirm no ambiguity requires adjudication or escalation.',
      'Record reviewer identity and review date outside the generated packet before PM use.',
    ],
  }
}

function makeSmokeReviewerMarkdown(packet) {
  const rows = packet.sampledRecords
    .map((record) => `| ${record.id} | ${record.groundTruthAction} | ${record.groundTruthExcessive} | ${record.summary.opacity}/${record.summary.color} | ${record.summary.fireType} | ${record.summary.durationMinutes} |`)
    .join('\n')

  return `# Smoke Reviewer Sampling Packet\n\nGenerated: ${packet.generatedAt}\n\n- Source: ${packet.source}\n- Review status: ${packet.reviewStatus}\n- Sample size: ${packet.sampleSize}\n\n| Record ID | Action | Excessive | Smoke profile | Fire type | Duration (min) |\n|---|---|---|---|---|---|\n${rows}\n\n## Reviewer Checklist\n\n${packet.reviewerChecklist.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n`
}

function buildFaceAdjudicationPacket(alprInventory) {
  const faceSnapshots = alprInventory.assets.filter((asset) => asset.category === 'face_ui_snapshot').map((asset) => asset.path)
  return {
    generatedAt: new Date().toISOString(),
    reviewStatus: 'adjudication-packet-attached-case-samples-pending',
    schemaAnchors: {
      faceRecordsTable: 'supabase/migrations/20260425000002_face_records_table.sql',
      matchFaceRpc: [
        'supabase/migrations/20260426000001_poi_face_matching.sql',
        'supabase/migrations/20260426000002_poi_face_matching_v2.sql',
      ],
      reviewSurface: 'src/pages/FaceRecordLog.tsx',
    },
    evidenceAnchors: {
      faceUiSnapshots: faceSnapshots,
      requiredFields: [
        'id',
        'label',
        'detection_method',
        'embedding_quality',
        'person_record_id',
        'photo_url',
        'incident_id',
        'observation_id',
      ],
      adjudicationDecisions: [
        'identity_match',
        'poi_status',
        'image_quality',
        'duplicate_face_record',
        'manual_escalation_required',
      ],
    },
    adjudicationChecklist: [
      'Confirm embedding quality and photo evidence are sufficient before any identity link is accepted.',
      'Use inconclusive when quality, angle, or occlusion prevents a defensible match.',
      'Treat duplicate detection separately from identity certainty.',
      'Require human confirmation for POI-sensitive or trespass-sensitive outcomes before operations use.',
    ],
  }
}

function makeFaceAdjudicationMarkdown(packet) {
  const snapshotLines = packet.evidenceAnchors.faceUiSnapshots.length
    ? packet.evidenceAnchors.faceUiSnapshots.map((path) => `- ${path}`).join('\n')
    : '- none'

  return `# Face Review Adjudication Packet\n\nGenerated: ${packet.generatedAt}\n\n- Review status: ${packet.reviewStatus}\n- Face log surface: ${packet.schemaAnchors.reviewSurface}\n\n## Schema Anchors\n\n- faceRecordsTable: ${packet.schemaAnchors.faceRecordsTable}\n- matchFaceRpc: ${packet.schemaAnchors.matchFaceRpc.join(', ')}\n- reviewSurface: ${packet.schemaAnchors.reviewSurface}\n\n## Evidence Anchors\n\n${snapshotLines}\n\n## Required Decisions\n\n${packet.evidenceAnchors.adjudicationDecisions.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\n## Adjudication Checklist\n\n${packet.adjudicationChecklist.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n`
}

function makeMarkdown(report) {
  const smoke = report.capabilities.smokeRecommendation
  const alpr = report.capabilities.alprInference
  const face = report.capabilities.faceReview

  const variantRows = Object.entries(smoke.variantMetrics)
    .map(([name, metrics]) => {
      if (!metrics) {
        return `| ${name} | 0 | n/a | n/a | n/a | n/a |`
      }
      return `| ${name} | ${metrics.sampleSize} | ${metrics.actionAccuracy} | ${metrics.excessiveF1} | ${metrics.avgConfidence ?? 'n/a'} | ${metrics.overrideRate} |`
    })
    .join('\n')

  const actionRows = Object.entries(smoke.actionDistribution)
    .map(([name, count]) => `| ${name} | ${count} |`)
    .join('\n')

  return `# Bob PM Evidence Packet\n\nGenerated: ${report.generatedAt}\n\n## Executive Summary\n\n- Overall PM posture: ${report.pmPosture}\n- Smoke recommendation: ${smoke.pmPosture}\n- ALPR inference: ${alpr.pmPosture}\n- Face review: ${face.pmPosture}\n\n## Smoke Evaluation Evidence\n\n- Corpus path: ${smoke.datasetPath}\n- Records: ${smoke.recordCount}\n- Best variant: ${smoke.bestVariant}\n- Reviewer sampling packet attached: ${smoke.reviewerSamplingPacketAttached ? 'yes' : 'no'}\n- Independent reviewer sign-off complete: ${smoke.independentReviewerSignoffComplete ? 'yes' : 'no'}\n\n### Action distribution\n\n| Action | Count |\n|---|---|\n${actionRows}\n\n### Variant metrics\n\n| Variant | Sample size | Action accuracy | Excessive F1 | Avg confidence | Override rate |\n|---|---|---|---|---|---|\n${variantRows}\n\n## ALPR Readiness\n\n- Contract path: ${alpr.contractPath}\n- Runtime path: ${alpr.runtimePath}\n- Corpus inventory attached: ${alpr.corpusInventoryAttached ? 'yes' : 'no'}\n- Inventory scope: ${alpr.inventoryScope}\n- PM posture: ${alpr.pmPosture}\n\n## Face Review Readiness\n\n- Migration anchors: ${face.migrationPaths.join(', ')}\n- Human adjudication artifact attached: ${face.adjudicationArtifactAttached ? 'yes' : 'no'}\n- Adjudicated case sample attached: ${face.adjudicatedCaseSampleAttached ? 'yes' : 'no'}\n- PM posture: ${face.pmPosture}\n\n## Blocking Gaps\n\n${report.blockingGaps.map((gap, index) => `${index + 1}. ${gap}`).join('\n')}\n\n## Rules For PM Presentation\n\n1. Present smoke as evidence-backed assistive recommendation quality, not autonomous enforcement.\n2. Present ALPR as a contract-defined inference path backed by local reference inventory until a production observation corpus is attached.\n3. Present face review as human-reviewed matching support only, unless a redacted adjudicated case set is attached.\n4. Keep unknown, inconclusive, and manual-review states visible.\n`
}

function main() {
  const outDir = resolve(ROOT, 'tools', 'bob-pm-evidence', 'latest')
  const jsonPath = resolve(outDir, 'bob-pm-evidence.json')
  const mdPath = resolve(outDir, 'bob-pm-evidence.md')
  const alprInventoryJsonPath = resolve(outDir, 'alpr-local-image-inventory.json')
  const alprInventoryMdPath = resolve(outDir, 'alpr-local-image-inventory.md')
  const smokePacketJsonPath = resolve(outDir, 'smoke-reviewer-sampling-packet.json')
  const smokePacketMdPath = resolve(outDir, 'smoke-reviewer-sampling-packet.md')
  const facePacketJsonPath = resolve(outDir, 'face-review-adjudication-packet.json')
  const facePacketMdPath = resolve(outDir, 'face-review-adjudication-packet.md')

  const smokeDatasetPath = 'data/smoke-ablation-evals.jsonl'
  const smokeRecords = readJsonl(smokeDatasetPath)
  const variants = ['sfa_only', 'sfa_with_duration', 'sfa_contextual']
  const variantMetrics = Object.fromEntries(variants.map((name) => [name, evaluateVariant(smokeRecords, name)]))
  const bestVariant = variants
    .map((name) => ({ name, accuracy: variantMetrics[name]?.actionAccuracy ?? -1, f1: variantMetrics[name]?.excessiveF1 ?? -1 }))
    .sort((left, right) => {
      if (right.accuracy !== left.accuracy) return right.accuracy - left.accuracy
      return right.f1 - left.f1
    })[0]?.name || null

  const alprContractPath = 'docs/INFERENCE_CONTRACT_V1.md'
  const alprRuntimePath = 'supabase/functions/alpr-process/index.ts'
  const facePaths = [
    'supabase/migrations/20260426000001_poi_face_matching.sql',
    'supabase/migrations/20260426000002_poi_face_matching_v2.sql',
  ]

  const alprInventory = buildAlprInventory()
  const smokeReviewerPacket = buildSmokeReviewerPacket(smokeRecords)
  const faceAdjudicationPacket = buildFaceAdjudicationPacket(alprInventory)

  const report = {
    generatedAt: new Date().toISOString(),
    pmPosture: 'partial-pass',
    capabilities: {
      smokeRecommendation: {
        pmPosture: 'evidence-backed-assistive',
        datasetPath: smokeDatasetPath,
        recordCount: smokeRecords.length,
        actionDistribution: countBy(smokeRecords, (record) => record.ground_truth_action || 'unknown'),
        excessiveDistribution: countBy(smokeRecords, (record) => Boolean(record.ground_truth_excessive)),
        variantMetrics,
        bestVariant,
        reviewerSamplingPacketAttached: true,
        independentReviewerSignoffComplete: false,
        reviewerSamplingPacketPath: relative(ROOT, smokePacketMdPath).replace(/\\/g, '/'),
        notes: [
          'Repo contains a labeled evaluation corpus and an existing ablation script.',
          'A deterministic reviewer sampling packet is now attached in-repo.',
          'Independent human reviewer sign-off is still pending.',
        ],
      },
      alprInference: {
        pmPosture: 'reference-inventory-attached-manual-review',
        contractPath: alprContractPath,
        runtimePath: alprRuntimePath,
        contractPresent: existsSync(resolve(ROOT, alprContractPath)),
        runtimePresent: existsSync(resolve(ROOT, alprRuntimePath)),
        corpusInventoryAttached: true,
        inventoryScope: alprInventory.inventoryStatus,
        inventoryPath: relative(ROOT, alprInventoryMdPath).replace(/\\/g, '/'),
      },
      faceReview: {
        pmPosture: 'human-reviewed-only',
        migrationPaths: facePaths,
        migrationAnchorsPresent: facePaths.every((relativePath) => existsSync(resolve(ROOT, relativePath))),
        adjudicationArtifactAttached: true,
        adjudicatedCaseSampleAttached: false,
        adjudicationArtifactPath: relative(ROOT, facePacketMdPath).replace(/\\/g, '/'),
      },
    },
    blockingGaps: [
      'ALPR production observation corpus is still not checked into the repository; the attached inventory covers local reference assets and UI snapshots only.',
      'Smoke reviewer sampling packet is attached, but independent human reviewer sign-off is still pending.',
      'Face-review adjudication packet is attached, but no redacted adjudicated case sample set is stored in-repo yet.',
    ],
  }

  mkdirSync(outDir, { recursive: true })
  writeJson(alprInventoryJsonPath, alprInventory)
  writeFileSync(alprInventoryMdPath, `${makeAlprInventoryMarkdown(alprInventory)}\n`, 'utf8')
  writeJson(smokePacketJsonPath, smokeReviewerPacket)
  writeFileSync(smokePacketMdPath, `${makeSmokeReviewerMarkdown(smokeReviewerPacket)}\n`, 'utf8')
  writeJson(facePacketJsonPath, faceAdjudicationPacket)
  writeFileSync(facePacketMdPath, `${makeFaceAdjudicationMarkdown(faceAdjudicationPacket)}\n`, 'utf8')
  writeJson(jsonPath, report)
  writeFileSync(mdPath, `${makeMarkdown(report)}\n`, 'utf8')

  console.log(`[bob-pm-evidence] alpr_inventory=${alprInventoryMdPath}`)
  console.log(`[bob-pm-evidence] smoke_review_packet=${smokePacketMdPath}`)
  console.log(`[bob-pm-evidence] face_adjudication_packet=${facePacketMdPath}`)
  console.log(`[bob-pm-evidence] json=${jsonPath}`)
  console.log(`[bob-pm-evidence] markdown=${mdPath}`)
  console.log(`[bob-pm-evidence] smoke_records=${smokeRecords.length}`)
  console.log(`[bob-pm-evidence] best_variant=${bestVariant}`)
}

main()