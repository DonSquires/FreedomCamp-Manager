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
  --global-learning-out <file> Output global learning JSONL (default: data/bob-global-learning-catalog.jsonl).
  --user-direction <text>  Optional operator/user direction to evaluate and learn from (repeatable).
  --write-lessons          Append derived lessons to lessons file.
  --write-global-learning  Append normalized success/failure/direction learnings to global catalog.
  --help, -h               Show help.
`

function parseArgs(argv) {
  const args = {
    enrichment: 'logs/site-roster-enrichment-artifact.json',
    briefings: 'logs/site-roster-briefings-artifact.json',
    queue: 'logs/site-roster-queue-model-artifact.json',
    lessonsFile: 'docs/LESSONS_LEARNED.md',
    artifactOut: 'logs/bob-self-learning-artifact.json',
    globalLearningOut: 'data/bob-global-learning-catalog.jsonl',
    userDirections: [],
    writeLessons: false,
    writeGlobalLearning: false,
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
    if (token === '--global-learning-out' && argv[i + 1]) {
      args.globalLearningOut = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--user-direction' && argv[i + 1]) {
      const direction = String(argv[i + 1]).trim()
      if (direction) args.userDirections.push(direction)
      i += 1
      continue
    }
    if (token === '--write-lessons') {
      args.writeLessons = true
      continue
    }
    if (token === '--write-global-learning') {
      args.writeGlobalLearning = true
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

function appendJsonLines(filePath, rows) {
  if (!rows.length) return { appended: 0 }
  const resolved = path.resolve(process.cwd(), filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const payload = rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  fs.appendFileSync(resolved, payload, 'utf8')
  return { appended: rows.length }
}

function buildDerivedLessons(enrichment, briefings, queue) {
  const lessons = []

  const medium = Number(briefings?.summary?.mediumConfidenceBriefings || 0)
  const ready = Number(briefings?.summary?.managementActions?.readyForPublishCount || 0)
  if (medium > 0 && ready > 0) {
    lessons.push({
      severity: 'high',
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
      severity: 'critical',
      trigger: 'site-roster-enrichment dossier completion gate',
      mistake: `Critical uncertainties were present for ${dossierFailures} site dossier(s).`,
      risk: 'Applying uncertain ownership/boundary/safety context can misdirect enforcement and officer decisions.',
      fix: 'Keep apply blocked by default and require explicit operator override only after review.',
      preventionRule: 'Never apply enrichment writes while critical dossier uncertainties remain unresolved.',
    })
  }

  if (enrichment?.incidentContext?.warning) {
    lessons.push({
      severity: 'medium',
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
      severity: 'high',
      trigger: 'queue model apply publish result',
      mistake: 'No new queue rows were published during apply despite available queue rows.',
      risk: 'App review queue may silently stall and stop reflecting new enrichment context.',
      fix: 'Track inserted/skipped counts and surface as run blocker when unexpected.',
      preventionRule: 'Apply runs must publish queue rows or explicitly justify skip conditions.',
    })
  }

  return lessons
}

function buildSuccessPatterns(enrichment, briefings, queue) {
  const patterns = []

  const dossierPass = Boolean(enrichment?.dossierCompletionGate?.pass)
  if (dossierPass) {
    patterns.push({
      severity: 'low',
      trigger: 'dossier completion gate',
      pattern: 'Dossier gate passed with zero critical uncertainties.',
      value: 'Safe to continue enrichment apply under normal policy gates.',
      reuseRule: 'Preserve strict write blocking unless explicit override flags are used.',
      tags: ['enrichment', 'safety', 'dossier-gate'],
    })
  }

  const reviewRequired = Number(briefings?.summary?.managementActions?.reviewRequiredCount || 0)
  const readyPublish = Number(briefings?.summary?.managementActions?.readyForPublishCount || 0)
  const mediumConfidence = Number(briefings?.summary?.mediumConfidenceBriefings || 0)
  if (mediumConfidence > 0 && reviewRequired >= mediumConfidence && readyPublish === 0) {
    patterns.push({
      severity: 'low',
      trigger: 'confidence routing policy',
      pattern: 'Medium-confidence briefings routed to review_required queue.',
      value: 'Policy-aligned confirmation-first behavior is active.',
      reuseRule: 'Only high confidence can be ready_for_publish unless policy explicitly changes.',
      tags: ['enrichment', 'app-queue', 'confidence-policy'],
    })
  }

  const queueRows = Number(queue?.summary?.totalQueueRows || 0)
  const inserted = Number(queue?.summary?.published?.inserted || 0)
  const skippedExisting = Number(queue?.summary?.published?.skippedExisting || 0)
  if (queueRows > 0 && (inserted > 0 || skippedExisting > 0)) {
    patterns.push({
      severity: 'low',
      trigger: 'queue model publish',
      pattern: inserted > 0 ? 'Queue rows published to intake queue.' : 'Queue model idempotent sync detected.',
      value: inserted > 0 ? 'App queue received new enrichment management items.' : 'No duplicate queue writes; existing items preserved.',
      reuseRule: 'Treat inserted=0 with skippedExisting>0 as healthy idempotent replay, not failure.',
      tags: ['app-queue', 'idempotency', 'autonomy'],
    })
  }

  return patterns
}

function evaluateUserDirections(directions) {
  const denied = [
    /allow-uncertain-writes/i,
    /allow-critical-lessons/i,
    /skip[-_ ]?rls/i,
    /bypass/i,
    /disable.*(safety|guard|gate)/i,
    /ignore.*(tenant|organization|org[-_ ]scope)/i,
  ]

  const accepted = []
  const rejected = []

  for (const raw of directions) {
    const text = String(raw || '').trim()
    if (!text) continue
    const blockedBy = denied.find((rule) => rule.test(text))
    if (blockedBy) {
      rejected.push({
        direction: text,
        reason: `blocked_by_policy:${blockedBy}`,
        severity: 'high',
      })
      continue
    }

    accepted.push({
      direction: text,
      reason: 'allowed_within_guardrails',
      severity: 'low',
      tags: ['user-direction', 'policy-checked'],
    })
  }

  return { accepted, rejected }
}

function buildGlobalLearningEntries({ runAt, derivedLessons, successPatterns, directionEval }) {
  const entries = []

  for (const lesson of derivedLessons) {
    entries.push({
      runAt,
      kind: 'failure_lesson',
      scope: 'global_cross_training',
      severity: lesson.severity || 'medium',
      trigger: lesson.trigger,
      summary: lesson.mistake,
      rule: lesson.preventionRule,
      reusableWhen: 'matches_task_context_and_policy_guardrails',
      source: 'enrichment-self-learning',
    })
  }

  for (const pattern of successPatterns) {
    entries.push({
      runAt,
      kind: 'success_pattern',
      scope: 'global_cross_training',
      severity: pattern.severity || 'low',
      trigger: pattern.trigger,
      summary: pattern.pattern,
      value: pattern.value,
      rule: pattern.reuseRule,
      tags: pattern.tags || [],
      reusableWhen: 'fits_role_scope_and_policy_constraints',
      source: 'enrichment-self-learning',
    })
  }

  for (const item of directionEval.accepted) {
    entries.push({
      runAt,
      kind: 'user_direction_accepted',
      scope: 'global_cross_training',
      severity: item.severity,
      summary: item.direction,
      rule: 'Apply only when direction remains within safety, tenant, and confidence guardrails.',
      tags: item.tags || [],
      reusableWhen: 'direction_is_still_policy_compliant',
      source: 'user-provided-direction',
    })
  }

  for (const item of directionEval.rejected) {
    entries.push({
      runAt,
      kind: 'user_direction_rejected',
      scope: 'global_cross_training',
      severity: item.severity,
      summary: item.direction,
      rule: item.reason,
      reusableWhen: 'never_without_policy_change',
      source: 'user-provided-direction',
    })
  }

  return entries
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
      `- Severity: ${lesson.severity || 'medium'}`,
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
  const successPatterns = buildSuccessPatterns(enrichment, briefings, queue)
  const directionEval = evaluateUserDirections(args.userDirections)
  const globalLearningEntries = buildGlobalLearningEntries({
    runAt: new Date().toISOString(),
    derivedLessons,
    successPatterns,
    directionEval,
  })
  const severityCounts = {
    critical: derivedLessons.filter((lesson) => lesson.severity === 'critical').length,
    high: derivedLessons.filter((lesson) => lesson.severity === 'high').length,
    medium: derivedLessons.filter((lesson) => lesson.severity === 'medium').length,
    low: derivedLessons.filter((lesson) => lesson.severity === 'low').length,
  }
  const lessonWrite = args.writeLessons
    ? appendLessonsIfNeeded(args.lessonsFile, derivedLessons)
    : { appended: 0, skippedExisting: 0 }
  const globalLearningWrite = args.writeGlobalLearning
    ? appendJsonLines(args.globalLearningOut, globalLearningEntries)
    : { appended: 0 }

  const artifact = {
    runAt: new Date().toISOString(),
    mode: args.writeLessons ? 'write-lessons' : 'report-only',
    inputs: {
      enrichment: args.enrichment,
      briefings: args.briefings,
      queue: args.queue,
      lessonsFile: args.lessonsFile,
      globalLearningOut: args.globalLearningOut,
      userDirections: args.userDirections,
    },
    derivedLessons,
    successPatterns,
    directionEvaluation: directionEval,
    globalLearningEntries,
    severityCounts,
    lessonWrite,
    globalLearningWrite,
  }

  writeJson(args.artifactOut, artifact)

  console.log('[Summary]')
  console.log(`  derived_lessons: ${derivedLessons.length}`)
  console.log(`  success_patterns: ${successPatterns.length}`)
  console.log(`  accepted_directions: ${directionEval.accepted.length}`)
  console.log(`  rejected_directions: ${directionEval.rejected.length}`)
  console.log(`  critical_lessons: ${severityCounts.critical}`)
  console.log(`  lessons_appended: ${lessonWrite.appended}`)
  console.log(`  global_learning_appended: ${globalLearningWrite.appended}`)
  console.log(`  lessons_skipped_existing: ${lessonWrite.skippedExisting}`)
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})
