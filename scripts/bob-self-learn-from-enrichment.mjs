#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const HELP_TEXT = `
Build self-learning lessons from enrichment artifacts.

Usage:
  node scripts/bob-self-learn-from-enrichment.mjs [options]

Options:
  --enrichment <file>      Enrichment artifact path (default: logs/site-roster-enrichment-artifact.json).
  --briefings <file>       Briefing artifact path (default: logs/site-roster-briefings-artifact.json).
  --queue <file>           Queue model artifact path (default: logs/site-roster-queue-model-artifact.json).
  --lessons-file <file>    Lessons file path (default: docs/LESSONS_LEARNED.md).
  --artifact-out <file>    Output self-learning artifact (default: logs/bob-self-learning-artifact.json).
  --write-lessons          Append derived lessons to lessons file.
  --help, -h               Show help.
`

function parseArgs(argv) {
  const args = {
    enrichment: 'logs/site-roster-enrichment-artifact.json',
    briefings: 'logs/site-roster-briefings-artifact.json',
    queue: 'logs/site-roster-queue-model-artifact.json',
    lessonsFile: 'docs/LESSONS_LEARNED.md',
    artifactOut: 'logs/bob-self-learning-artifact.json',
    writeLessons: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--enrichment' && argv[i + 1]) {
      args.enrichment = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--briefings' && argv[i + 1]) {
      args.briefings = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--queue' && argv[i + 1]) {
      args.queue = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--lessons-file' && argv[i + 1]) {
      args.lessonsFile = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--artifact-out' && argv[i + 1]) {
      args.artifactOut = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--write-lessons') {
      args.writeLessons = true
      continue
    }
    if (token === '--help' || token === '-h') {
      args.help = true
      continue
    }
    throw new Error(`Unknown argument: ${token}`)
  }

  return args
}

function readJsonIfExists(filePath) {
  const resolved = path.resolve(process.cwd(), filePath)
  if (!fs.existsSync(resolved)) return null
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(filePath, payload) {
  const resolved = path.resolve(process.cwd(), filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`Artifact written: ${resolved}`)
}

function buildDerivedLessons(enrichment, briefings, queue) {
  const lessons = []

  const medium = Number(briefings?.summary?.mediumConfidenceBriefings || 0)
  const ready = Number(briefings?.summary?.managementActions?.readyForPublishCount || 0)
  if (medium > 0 && ready > 0) {
    lessons.push({
      trigger: 'site-roster-briefings-artifact management summary',
      mistake: 'Medium-confidence briefings were routed to ready_for_publish instead of review_required.',
      risk: 'Admins can treat advisory confidence as approved truth, causing weak-confidence operational decisions.',
      fix: 'Updated enrichment data-management action mapping so only high confidence is ready_for_publish.',
      preventionRule: 'Any confidence below high must require review/confirmation before publish actions.',
    })
  }

  const dossierFailures = Number(enrichment?.dossierCompletionGate?.dossiersWithCriticalUncertainty || 0)
  if (dossierFailures > 0) {
    lessons.push({
      trigger: 'site-roster-enrichment dossier completion gate',
      mistake: `Critical uncertainties were present for ${dossierFailures} site dossier(s).`,
      risk: 'Applying uncertain ownership/boundary/safety context can misdirect enforcement and officer decisions.',
      fix: 'Keep apply blocked by default and require explicit operator override only after review.',
      preventionRule: 'Never apply enrichment writes while critical dossier uncertainties remain unresolved.',
    })
  }

  if (enrichment?.incidentContext?.warning) {
    lessons.push({
      trigger: 'incident context fetch warning',
      mistake: `Incident linkage source failed: ${enrichment.incidentContext.warning}`,
      risk: 'Previous-issues briefing can become incomplete or misleading.',
      fix: 'Use schema-adaptive incident sourcing and record provenance/warnings in artifacts.',
      preventionRule: 'Always include incident source provenance and warning state in briefings and queue models.',
    })
  }

  const queueRows = Number(queue?.summary?.totalQueueRows || 0)
  const inserted = Number(queue?.summary?.published?.inserted || 0)
  const skippedExisting = Number(queue?.summary?.published?.skippedExisting || 0)
  if (queue?.mode === 'apply' && queueRows > 0 && inserted === 0 && skippedExisting === 0) {
    lessons.push({
      trigger: 'queue model apply publish result',
      mistake: 'No new queue rows were published during apply despite available queue rows.',
      risk: 'App review queue may silently stall and stop reflecting new enrichment context.',
      fix: 'Track inserted/skipped counts and surface as run blocker when unexpected.',
      preventionRule: 'Apply runs must publish queue rows or explicitly justify skip conditions.',
    })
  }

  return lessons
}

function appendLessonsIfNeeded(lessonsFilePath, lessons) {
  if (!lessons.length) return { appended: 0, skippedExisting: 0 }

  const resolved = path.resolve(process.cwd(), lessonsFilePath)
  const current = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf8') : '# Lessons Learned\n\n## Current Lessons\n'

  let next = current
  let appended = 0
  let skippedExisting = 0
  const today = new Date().toISOString().slice(0, 10)

  for (const lesson of lessons) {
    const fingerprint = `Trigger: ${lesson.trigger}`
    if (next.includes(fingerprint)) {
      skippedExisting += 1
      continue
    }

    const block = [
      '',
      `- Date: ${today}`,
      `- Trigger: ${lesson.trigger}`,
      `- Mistake: ${lesson.mistake}`,
      `- Risk: ${lesson.risk}`,
      `- Fix: ${lesson.fix}`,
      `- Prevention Rule: ${lesson.preventionRule}`,
      '',
    ].join('\n')

    next += block
    appended += 1
  }

  if (appended > 0) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, next, 'utf8')
    console.log(`Updated lessons file: ${resolved}`)
  }

  return { appended, skippedExisting }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  const enrichment = readJsonIfExists(args.enrichment)
  const briefings = readJsonIfExists(args.briefings)
  const queue = readJsonIfExists(args.queue)

  const derivedLessons = buildDerivedLessons(enrichment, briefings, queue)
  const lessonWrite = args.writeLessons
    ? appendLessonsIfNeeded(args.lessonsFile, derivedLessons)
    : { appended: 0, skippedExisting: 0 }

  const artifact = {
    runAt: new Date().toISOString(),
    mode: args.writeLessons ? 'write-lessons' : 'report-only',
    inputs: {
      enrichment: args.enrichment,
      briefings: args.briefings,
      queue: args.queue,
      lessonsFile: args.lessonsFile,
    },
    derivedLessons,
    lessonWrite,
  }

  writeJson(args.artifactOut, artifact)

  console.log('[Summary]')
  console.log(`  derived_lessons: ${derivedLessons.length}`)
  console.log(`  lessons_appended: ${lessonWrite.appended}`)
  console.log(`  lessons_skipped_existing: ${lessonWrite.skippedExisting}`)
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})
