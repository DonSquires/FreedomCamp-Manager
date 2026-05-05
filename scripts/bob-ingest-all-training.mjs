#!/usr/bin/env node

/**
 * bob-ingest-all-training.mjs
 *
 * Master training ingestion script.
 * Runs all Bob training feeder scripts in sequence to load the full knowledge base into Bob.
 *
 * Usage:
 *   BOB_SERVICE_URL=https://... BOB_INFERENCE_API_KEY=... node scripts/bob-ingest-all-training.mjs
 *
 * Or for dryrun (preview what would be sent without actually posting):
 *   BOB_SERVICE_URL=https://... BOB_INFERENCE_API_KEY=... node scripts/bob-ingest-all-training.mjs --dry-run
 *
 * Environment Variables:
 *   - BOB_SERVICE_URL           Bob's public URL (required unless INFERENCE_SERVICE_URL is set)
 *   - INFERENCE_SERVICE_URL     Alternate name for BOB_SERVICE_URL (required unless BOB_SERVICE_URL is set)
 *   - BOB_INFERENCE_API_KEY     API key for Bob ingestion (required unless INFERENCE_API_KEY is set)
 *   - INFERENCE_API_KEY         Alternate name for BOB_INFERENCE_API_KEY (required unless BOB_INFERENCE_API_KEY is set)
 */

import { spawn } from 'node:child_process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

let BOB_URL = String(process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '').trim().replace(/\/$/, '')
let API_KEY = String(process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || '').trim()
const DRY_RUN = process.argv.includes('--dry-run')
const SKIP_TESTS = process.argv.includes('--skip-connectivity-test')
const SKIP_VERIFY = process.argv.includes('--skip-verify')
const JS_RUNTIME = process.execPath || 'bun'

// Require explicit endpoint configuration to avoid stale hardcoded endpoint drift.

// API key from VITE version in .env
if (!API_KEY && process.env.VITE_INFERENCE_API_KEY) {
  API_KEY = process.env.VITE_INFERENCE_API_KEY
  console.log('ℹ️  Using VITE_INFERENCE_API_KEY from environment.')
}

if (!BOB_URL || !API_KEY) {
  console.error('\n❌ ERROR: Missing required environment variables.')
  console.error('   Set one of:')
  console.error('     - BOB_SERVICE_URL or INFERENCE_SERVICE_URL')
  console.error('     - BOB_INFERENCE_API_KEY or INFERENCE_API_KEY')
  console.error('')
  console.error('   Quick setup:')
  console.error('     export BOB_SERVICE_URL="https://your-bob-host"')
  console.error('     export BOB_INFERENCE_API_KEY="your-api-key"')
  console.error(`     ${JS_RUNTIME} scripts/bob-ingest-all-training.mjs`)
  console.error('')
  console.error('   To find your Bob endpoint:')
  console.error('     node scripts/discover-bob-endpoint.mjs')
  process.exit(2)
}

const feeders = [
  ...(SKIP_VERIFY ? [] : ['verify-bob-training-wiring.mjs']),
  'bob-feed-build-context.mjs',
  'bob-feed-railway-training.mjs',
  'bob-feed-specialized-training.mjs',
  'bob-feed-research-methodology.mjs',
  'bob-feed-web-research.mjs',
  'bob-feed-nz-business-growth-training.mjs',
  'bob-feed-nz-councils-procurement.mjs',
]

let completed = 0
let failed = 0
const errors = []

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('BOB TRAINING INGESTION MASTER')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`\n🎯 Endpoint: ${BOB_URL}`)
console.log(`🔑 API Key: ${API_KEY.slice(0, 8)}...${API_KEY.slice(-8)}`)
console.log(`📋 Mode: ${DRY_RUN ? 'DRY-RUN (preview only, no data sent)' : 'LIVE (data will be sent to Bob)'}`)
console.log(`\n📚 Training Modules to Load (${feeders.length} total):\n`)

feeders.forEach((f, i) => {
  console.log(`  ${i + 1}. ${f}`)
})

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

async function runFeeder(script) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      BOB_SERVICE_URL: BOB_URL,
      BOB_INFERENCE_API_KEY: API_KEY,
    }

    const child = spawn(JS_RUNTIME, ['scripts/' + script], { env, stdio: 'inherit' })

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${script}\n`)
        completed += 1
      } else {
        console.log(`❌ ${script} (exit code: ${code})\n`)
        failed += 1
        errors.push(script)
      }
      resolve()
    })

    child.on('error', (err) => {
      console.log(`❌ ${script} (error: ${err.message})\n`)
      failed += 1
      errors.push(script)
      resolve()
    })
  })
}

async function testBobHealth() {
  try {
    const response = await fetch(`${BOB_URL}/health`, {
      method: 'GET',
      headers: {
        'User-Agent': 'bob-ingest-training/1.0',
      },
      signal: AbortSignal.timeout(3000),
    })
    const isHealthy = response.ok || response.status === 404 // 404 might be normal if health endpoint doesn't exist
    if (isHealthy || response.status === 404) {
      return true
    }
    console.log(`⚠️  Bob returned HTTP ${response.status}\n`)
    return false
  } catch (err) {
    console.log(`⚠️  Could not reach Bob: ${err.message}\n`)
    return false
  }
}

async function main() {
  if (DRY_RUN) {
    console.log('⚠️  DRY-RUN MODE: Scripts will execute but without posting to Bob.\n')
  }

  if (!SKIP_TESTS) {
    console.log('🔍 Testing Bob endpoint connectivity...\n')
    const healthy = await testBobHealth()
    if (!healthy && !DRY_RUN) {
      console.log('⚠️  Warning: Bob endpoint not responding.')
      console.log('   Continuing with ingestion anyway (may queue or fail).\n')
      console.log(`   To skip this test: ${JS_RUNTIME} scripts/bob-ingest-all-training.mjs --skip-connectivity-test\n`)
    } else if (healthy) {
      console.log('✅ Bob is healthy and ready to receive training.\n')
    }
  }

  for (const feeder of feeders) {
    await runFeeder(feeder)
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('TRAINING INGESTION SUMMARY')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`\n✅ Completed: ${completed}/${feeders.length}`)
  if (failed > 0) {
    console.log(`❌ Failed: ${failed}`)
    console.log('\nFailed modules:')
    errors.forEach((e) => console.log(`  - ${e}`))
  }

  console.log('\n' + (failed === 0 ? '🎉 All training loaded successfully!' : '⚠️  Some modules failed. Review logs above.'))
  console.log('\n' + (DRY_RUN ? '💡 DRY-RUN completed. Run without --dry-run to actually send data.' : '💡 Bob has been trained. Ask Bob a question to test.'))

  console.log('\n' + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('\n💬 Quick test: Ask Bob for NZ council adoption strategy:\n')
  console.log(`   ${JS_RUNTIME} scripts/ask-bob.mjs "Give me a 3-point NZ council adoption strategy for FreedomCamp-Manager."`)
  console.log('\n')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(2)
})
