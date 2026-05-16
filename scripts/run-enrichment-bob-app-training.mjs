#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const HELP_TEXT = `
Run staged enrichment + Bob training + app training checks.

Usage:
  node scripts/run-enrichment-bob-app-training.mjs [options]

Options:
  --apply                  Execute commands (default is dry-run plan output).
  --with-feeds             Include Bob training feed steps.
  --with-app-checks        Include app/runtime validation checks.
  --bucket <name>          Intake bucket (default: evidence).
  --prefix <path>          Intake prefix (default: historical-imports).
  --limit <n>              Intake batch limit (default: 100).
  --organization-id <id>   Optional org override for intake apply.
  --since-date <YYYY-MM-DD> Optional roster history floor for site enrichment.
  --allow-uncertain-writes Allow site enrichment writes to proceed despite dossier gate blockers.
  --allow-critical-lessons Continue even when self-learning detects critical lessons.
  --skip-app-queue         Skip app queue model generation/publish step.
  --polygon-input <file>   Optional GeoJSON input path for polygon conversion.
  --artifact-out <file>    Optional JSON artifact output path.
  --skip-intake            Skip intake phase.
  --skip-bootstrap         Skip org/site bootstrap phase.
  --skip-validation        Skip validation phase.
  --help, -h               Show help.
`

function parseArgs(argv) {
  const args = {
    apply: false,
    withFeeds: false,
    withAppChecks: false,
    bucket: 'evidence',
    prefix: 'historical-imports',
    limit: '100',
    organizationId: '',
    sinceDate: '',
    allowUncertainWrites: false,
    allowCriticalLessons: false,
    skipAppQueue: false,
    polygonInput: '',
    artifactOut: 'logs/enrichment-training-artifact.json',
    skipIntake: false,
    skipBootstrap: false,
    skipValidation: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]

    if (token === '--apply') {
      args.apply = true
      continue
    }
    if (token === '--with-feeds') {
      args.withFeeds = true
      continue
    }
    if (token === '--with-app-checks') {
      args.withAppChecks = true
      continue
    }
    if (token === '--skip-intake') {
      args.skipIntake = true
      continue
    }
    if (token === '--skip-bootstrap') {
      args.skipBootstrap = true
      continue
    }
    if (token === '--skip-validation') {
      args.skipValidation = true
      continue
    }
    if (token === '--skip-app-queue') {
      args.skipAppQueue = true
      continue
    }
    if (token === '--help' || token === '-h') {
      args.help = true
      continue
    }

    if (token === '--bucket' && argv[i + 1]) {
      args.bucket = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--prefix' && argv[i + 1]) {
      args.prefix = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--limit' && argv[i + 1]) {
      args.limit = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--organization-id' && argv[i + 1]) {
      args.organizationId = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--since-date' && argv[i + 1]) {
      args.sinceDate = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--allow-uncertain-writes') {
      args.allowUncertainWrites = true
      continue
    }
    if (token === '--allow-critical-lessons') {
      args.allowCriticalLessons = true
      continue
    }
    if (token === '--polygon-input' && argv[i + 1]) {
      args.polygonInput = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--artifact-out' && argv[i + 1]) {
      args.artifactOut = String(argv[i + 1]).trim()
      i += 1
      continue
    }

    throw new Error(`Unknown argument: ${token}`)
  }

  return args
}

function firstNonEmpty(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim()
    if (value) return value
  }
  return ''
}

function requireEnvForApply(args) {
  if (!args.apply) return

  const supabaseUrl = firstNonEmpty('SUPABASE_URL', 'VITE_SUPABASE_URL')
  const supabaseServiceRole = firstNonEmpty('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceRole) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for apply mode.')
  }

  if (args.withFeeds) {
    const bobUrl = firstNonEmpty('BOB_SERVICE_URL', 'INFERENCE_SERVICE_URL')
    const bobKey = firstNonEmpty('BOB_INFERENCE_API_KEY', 'INFERENCE_API_KEY')
    if (!bobUrl || !bobKey) {
      throw new Error('Missing Bob inference URL/key for --with-feeds apply mode.')
    }
  }
}

function buildIntakeCommand(args, apply) {
  const base = apply
    ? 'node scripts/backfill-bob-intakes-from-storage.mjs --apply'
    : 'node scripts/backfill-bob-intakes-from-storage.mjs'

  const suffix = [
    `--bucket ${args.bucket}`,
    `--prefix ${args.prefix}`,
    `--limit ${args.limit}`,
    args.organizationId ? `--organization-id ${args.organizationId}` : '',
    !apply ? '--verbose' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return `${base} ${suffix}`
}

function plan(args) {
  const steps = []

  if (!args.skipIntake) {
    steps.push({ phase: 'Phase 1 - Intake dry-run', command: buildIntakeCommand(args, false) })
    if (args.apply) {
      steps.push({ phase: 'Phase 1 - Intake apply', command: buildIntakeCommand(args, true) })
    }
  }

  if (!args.skipBootstrap) {
    steps.push({
      phase: 'Phase 3 - Bootstrap org hierarchy',
      command: `node scripts/bootstrap-first-security-orgs.mjs${args.apply ? ' --apply' : ''}`,
    })
    steps.push({
      phase: 'Phase 3 - Bootstrap Marlborough parking',
      command: `node scripts/bootstrap-marlborough-parking.mjs${args.apply ? ' --apply' : ''}`,
    })
  }

  const enrichmentFlags = [
    args.apply ? '--apply' : '',
    args.organizationId ? `--organization-id ${args.organizationId}` : '--global-training',
    args.sinceDate ? `--since-date ${args.sinceDate}` : '',
    args.allowUncertainWrites ? '--allow-uncertain-writes' : '',
    '--artifact-out logs/site-roster-enrichment-artifact.json',
    '--briefings-out logs/site-roster-briefings-artifact.json',
  ].filter(Boolean).join(' ')

  steps.push({
    phase: 'Phase 4 - Site roster enrichment dossiers',
    command: `node scripts/enrich-site-roster-costing.mjs ${enrichmentFlags}`,
  })

  if (!args.skipAppQueue) {
    const queueFlags = [
      args.apply ? '--apply' : '',
      '--briefings-in logs/site-roster-briefings-artifact.json',
      '--artifact-out logs/site-roster-queue-model-artifact.json',
      args.organizationId ? `--organization-id ${args.organizationId}` : '',
    ].filter(Boolean).join(' ')

    steps.push({
      phase: 'Phase 4.1 - App queue model sync',
      command: `node scripts/build-bob-enrichment-queue-model.mjs ${queueFlags}`,
    })
  }

  const selfLearnFlags = [
    '--enrichment logs/site-roster-enrichment-artifact.json',
    '--briefings logs/site-roster-briefings-artifact.json',
    '--queue logs/site-roster-queue-model-artifact.json',
    '--artifact-out logs/bob-self-learning-artifact.json',
    args.apply ? '--write-lessons' : '',
  ].filter(Boolean).join(' ')

  steps.push({
    phase: 'Phase 4.2 - Bob self-learning loop',
    command: `node scripts/bob-self-learn-from-enrichment.mjs ${selfLearnFlags}`,
  })

  if (args.polygonInput) {
    steps.push({
      phase: 'Phase 5 - Polygon normalization helper',
      command: `node scripts/geojson-to-polygon-converter.mjs ${args.polygonInput} --output=data/geofences-from-geojson.json`,
    })
  } else {
    steps.push({
      phase: 'Phase 5 - Polygon normalization helper',
      command: 'echo "Polygon converter ready. Provide --polygon-input <file> to execute conversion."',
    })
  }

  if (args.withFeeds) {
    steps.push({
      phase: 'Bob training - Build context feed',
      command: 'node scripts/bob-feed-build-context.mjs',
    })
    steps.push({
      phase: 'Bob training - Storage grounding feed',
      command: 'node scripts/bob-feed-storage-bucket-grounding.mjs',
    })
  }

  if (!args.skipValidation) {
    steps.push({ phase: 'Phase 6 - Staging doc lint', command: 'npm run lint:staging-doc' })
    steps.push({ phase: 'Phase 6 - Type check', command: 'npm run typecheck' })
    steps.push({ phase: 'Phase 6 - Build', command: 'npm run build' })
    steps.push({
      phase: 'Phase 6 - Spatial boundary test',
      command: 'node scripts/geo-boundary-transition-test.mjs --providerOrgId b3dcef79-9cc1-4f3b-bae0-a190297c52b7 --fromLat -41.290916 --fromLng 174.006908 --toLat -41.2849278 --toLng 174.0033421 --aiRetries 3 --allowAiTimeout',
    })
    steps.push({ phase: 'Phase 6 - Spatial intelligence test', command: 'npm run bob:test:spatial' })
  }

  if (args.withAppChecks) {
    steps.push({ phase: 'Phase 7 - Bob runtime status', command: 'npm run e2e:bob:chromium:status' })
    steps.push({
      phase: 'Phase 7 - Capability gate',
      command: 'node scripts/bob-capability-gate.mjs --required chat --retries 3 --timeoutMs 90000',
      retries: 3,
      allowFailure: true,
    })
  }

  return steps
}

function printPlan(steps, args) {
  const mode = args.apply ? 'apply' : 'dry-run'
  console.log(`Enrichment/Bob/App training plan (${mode})`)
  console.log('------------------------------------------------------------')
  steps.forEach((step, index) => {
    console.log(`${index + 1}. [${step.phase}]`)
    console.log(`   ${step.command}`)
  })
}

function runCommand(command) {
  const result = spawnSync(command, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? 'unknown'}): ${command}`)
  }
}

function runCommandWithRetries(command, retries = 1) {
  let lastError = null
  const maxAttempts = Number.isFinite(retries) && retries > 0 ? Math.trunc(retries) : 1

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      runCommand(command)
      return { attempts: attempt, success: true }
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts) {
        throw error
      }
      console.warn(`Command retry ${attempt}/${maxAttempts} failed; retrying: ${command}`)
    }
  }

  throw lastError || new Error(`Command failed: ${command}`)
}

function runStep(step) {
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()

  try {
    const execution = runCommandWithRetries(step.command, step.retries || 1)
    return {
      phase: step.phase,
      command: step.command,
      allowFailure: Boolean(step.allowFailure),
      success: true,
      attempts: execution?.attempts || 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
    }
  } catch (error) {
    if (step.allowFailure) {
      console.warn(`Non-blocking step failed after retries: ${step.phase}`)
      console.warn(String(error?.message || error))
      return {
        phase: step.phase,
        command: step.command,
        allowFailure: true,
        success: false,
        attempts: Number.isFinite(step.retries) ? step.retries : 1,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
        error: String(error?.message || error),
        nonBlocking: true,
      }
    }
    throw error
  }
}

function writeArtifact(artifactOut, payload) {
  if (!artifactOut) return

  const resolved = path.resolve(process.cwd(), artifactOut)
  const dir = path.dirname(resolved)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`Artifact written: ${resolved}`)
}

function readJsonFileIfExists(filePath) {
  const resolved = path.resolve(process.cwd(), filePath)
  if (!fs.existsSync(resolved)) return null
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'))
  } catch {
    return null
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  requireEnvForApply(args)

  const steps = plan(args)
  printPlan(steps, args)

  if (!args.apply) {
    console.log('\nDry-run only. Re-run with --apply to execute.')
    return
  }

  const stepReports = []

  for (const step of steps) {
    console.log(`\n>>> ${step.phase}`)
    const report = runStep(step)
    if (report) stepReports.push(report)
  }

  const blockers = stepReports
    .filter((entry) => entry.success === false)
    .map((entry) => ({
      phase: entry.phase,
      command: entry.command,
      error: entry.error || 'unknown failure',
      nonBlocking: Boolean(entry.nonBlocking),
    }))

  const rosterArtifact = readJsonFileIfExists('logs/site-roster-enrichment-artifact.json')
  const briefingArtifact = readJsonFileIfExists('logs/site-roster-briefings-artifact.json')
  const selfLearningArtifact = readJsonFileIfExists('logs/bob-self-learning-artifact.json')
  const rosterGate = rosterArtifact?.dossierCompletionGate || null
  if (rosterGate && rosterGate.pass === false) {
    blockers.push({
      phase: 'Phase 4 - Site roster enrichment dossiers',
      command: 'node scripts/enrich-site-roster-costing.mjs ...',
      error: `Dossier gate blockers: ${rosterGate.dossiersWithCriticalUncertainty}`,
      nonBlocking: Boolean(args.allowUncertainWrites),
    })
  }

  const criticalLessons = Number(selfLearningArtifact?.severityCounts?.critical || 0)
  if (criticalLessons > 0 && !args.allowCriticalLessons) {
    blockers.push({
      phase: 'Phase 4.2 - Bob self-learning loop',
      command: 'node scripts/bob-self-learn-from-enrichment.mjs ...',
      error: `Critical lessons detected: ${criticalLessons}`,
      nonBlocking: false,
    })
  }

  writeArtifact(args.artifactOut, {
    runAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    settings: {
      withFeeds: args.withFeeds,
      withAppChecks: args.withAppChecks,
      skipIntake: args.skipIntake,
      skipBootstrap: args.skipBootstrap,
      skipValidation: args.skipValidation,
      skipAppQueue: args.skipAppQueue,
      sinceDate: args.sinceDate || null,
      allowUncertainWrites: args.allowUncertainWrites,
      allowCriticalLessons: args.allowCriticalLessons,
    },
    stepReports,
    rosterEnrichment: {
      artifactPath: 'logs/site-roster-enrichment-artifact.json',
      dossierCompletionGate: rosterGate,
    },
    appBriefings: {
      artifactPath: 'logs/site-roster-briefings-artifact.json',
      summary: briefingArtifact?.summary || null,
    },
    appQueueModel: {
      artifactPath: 'logs/site-roster-queue-model-artifact.json',
      summary: readJsonFileIfExists('logs/site-roster-queue-model-artifact.json')?.summary || null,
    },
    selfLearning: {
      artifactPath: 'logs/bob-self-learning-artifact.json',
      summary: selfLearningArtifact || null,
    },
    blockers,
    degraded: blockers.length > 0,
  })

  console.log('\nCompleted enrichment + Bob training + app training workflow.')
}

main().catch((error) => {
  console.error(`Error: ${error.message}`)
  process.exit(1)
})
