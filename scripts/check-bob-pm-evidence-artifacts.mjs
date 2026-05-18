#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const EVIDENCE_DIR = path.resolve(ROOT, 'tools', 'bob-pm-evidence', 'latest')
const REPORT_PATH = path.join(EVIDENCE_DIR, 'bob-pm-evidence.json')
const MAX_AGE_DAYS = Number.parseInt(process.env.BOB_PM_EVIDENCE_MAX_AGE_DAYS || '7', 10)

const REQUIRED_EVIDENCE_FILES = [
  'alpr-local-image-inventory.json',
  'alpr-local-image-inventory.md',
  'bob-pm-evidence.json',
  'bob-pm-evidence.md',
  'face-review-adjudication-packet.json',
  'face-review-adjudication-packet.md',
  'smoke-reviewer-sampling-packet.json',
  'smoke-reviewer-sampling-packet.md',
]

const REQUIRED_FORMAT_FILES = [
  'tools/bob-pm-evidence/redacted-format/README.md',
  'tools/bob-pm-evidence/redacted-format/alpr-redacted-sample-template.json',
  'tools/bob-pm-evidence/redacted-format/alpr-redacted-sample.schema.json',
  'tools/bob-pm-evidence/redacted-format/face-review-redacted-sample-template.json',
  'tools/bob-pm-evidence/redacted-format/face-review-redacted-sample.schema.json',
]

async function exists(absPath) {
  try {
    await fs.access(absPath)
    return true
  } catch {
    return false
  }
}

async function main() {
  const failures = []

  for (const fileName of REQUIRED_EVIDENCE_FILES) {
    const absPath = path.join(EVIDENCE_DIR, fileName)
    if (!(await exists(absPath))) {
      failures.push(`Missing generated evidence file: ${fileName}`)
    }
  }

  for (const relPath of REQUIRED_FORMAT_FILES) {
    const absPath = path.resolve(ROOT, relPath)
    if (!(await exists(absPath))) {
      failures.push(`Missing redacted sample-set format file: ${relPath}`)
    }
  }

  if (!(await exists(REPORT_PATH))) {
    failures.push('Missing bob-pm-evidence.json report.')
  }

  let report = null
  if (!failures.length) {
    try {
      report = JSON.parse(await fs.readFile(REPORT_PATH, 'utf8'))
    } catch (error) {
      failures.push(`Unable to parse bob-pm-evidence.json: ${error.message}`)
    }
  }

  if (report) {
    const generatedAt = new Date(String(report.generatedAt || ''))
    if (Number.isNaN(generatedAt.getTime())) {
      failures.push('bob-pm-evidence.json has invalid generatedAt timestamp.')
    } else {
      const ageMs = Date.now() - generatedAt.getTime()
      const ageDays = ageMs / (1000 * 60 * 60 * 24)
      if (ageDays > MAX_AGE_DAYS) {
        failures.push(`Evidence packet is stale (${ageDays.toFixed(1)} days old; max ${MAX_AGE_DAYS}).`)
      }
    }

    if (!report?.capabilities?.smokeRecommendation?.reviewerSamplingPacketAttached) {
      failures.push('Smoke reviewer sampling packet must be attached.')
    }
    if (!report?.capabilities?.alprInference?.corpusInventoryAttached) {
      failures.push('ALPR corpus inventory marker must be attached in evidence report.')
    }
    if (!report?.capabilities?.faceReview?.adjudicationArtifactAttached) {
      failures.push('Face-review adjudication artifact must be attached.')
    }
  }

  if (failures.length) {
    console.error('[bob-pm-evidence] FAIL: strict artifact checks failed')
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exit(1)
  }

  console.log('[bob-pm-evidence] PASS: strict artifact checks passed')
}

main().catch((error) => {
  console.error(`[bob-pm-evidence] ${error.message}`)
  process.exit(1)
})