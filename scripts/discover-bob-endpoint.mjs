#!/usr/bin/env node

/**
 * discover-bob-endpoint.mjs
 *
 * Helps locate the live Bob service endpoint (RunPod serverless runsync).
 * Bob runs on RunPod Serverless.
 *
 * Usage:
 *   node scripts/discover-bob-endpoint.mjs
 *   node scripts/discover-bob-endpoint.mjs --test <url>
 *   node scripts/discover-bob-endpoint.mjs --set-env
 */

const RUNPOD_ENDPOINT_ID = String(process.env.RUNPOD_ENDPOINT_ID || '').trim()
const LIKELY_SERVERLESS_URL = RUNPOD_ENDPOINT_ID
  ? `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/runsync`
  : ''

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('BOB ENDPOINT DISCOVERY')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

// Check environment first
const BOB_FROM_ENV = (process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '').trim()

if (BOB_FROM_ENV) {
  console.log('✅ Bob endpoint already set in environment:')
  console.log(`   BOB_SERVICE_URL/INFERENCE_SERVICE_URL=${BOB_FROM_ENV}\n`)
  testEndpoint(BOB_FROM_ENV)
  process.exit(0)
}

console.log('📍 Endpoint not found in environment.\n')
if (LIKELY_SERVERLESS_URL) {
  console.log('Based on RUNPOD_ENDPOINT_ID, the likely RunPod serverless URL is:')
  console.log(`   ${LIKELY_SERVERLESS_URL}\n`)
} else {
  console.log('RUNPOD_ENDPOINT_ID not set, so a likely serverless URL cannot be inferred.')
  console.log('Set RUNPOD_ENDPOINT_ID or provide --test <url>.\n')
}

async function testEndpoint(url) {
  const testUrl = url.replace(/\/$/, '')
  const isServerless = /api\.runpod\.ai\/v2\//.test(testUrl)
  const runpodKey = String(process.env.RUNPOD_API_KEY || process.env.RUNPOD_ENDPOINT_API_KEY || '').trim()

  console.log(`Testing endpoint: ${testUrl}${isServerless ? '' : '/health'}\n`)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    let response

    if (isServerless) {
      const headers = {
        'User-Agent': 'bob-discovery/1.0',
        'Content-Type': 'application/json',
      }
      if (runpodKey) headers['Authorization'] = `Bearer ${runpodKey}`
      response = await fetch(testUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input: { action: 'ping' } }),
        signal: controller.signal,
      })
    } else {
      response = await fetch(`${testUrl}/health`, {
        headers: { 'User-Agent': 'bob-discovery/1.0' },
        signal: controller.signal,
      })
    }

    clearTimeout(timeout)

    if (response.ok) {
      console.log(`✅ Endpoint is reachable and healthy`)
      const data = await response.json()
      console.log(`   Status: ${data.status || (data.output?.success ? 'ok' : 'unknown')}`)
      console.log(`   Response:`, JSON.stringify(data).slice(0, 200))
    } else {
      console.log(`⚠️  Endpoint returned HTTP ${response.status}`)
      if (isServerless && !runpodKey) {
        console.log(`   RUNPOD_API_KEY is not set in this shell; add it to test serverless endpoints.`)
      }
      console.log(`   Try running training ingestion anyway.`)
    }
  } catch (err) {
    console.log(`❌ Could not reach endpoint: ${err.message}`)
    console.log(`\n   Possible causes:`)
    console.log(`   • Serverless endpoint ID is incorrect`)
    console.log(`   • RUNPOD_API_KEY / RUNPOD_ENDPOINT_API_KEY is missing or invalid`)
    console.log(`   • Network connectivity issue`)
  }

  console.log()
}

console.log('Option 1: Test the likely endpoint\n')

testEndpoint(LIKELY_SERVERLESS_URL).then(() => {
  console.log('Option 2: If you have a different URL, set it manually:\n')
  console.log(`   export INFERENCE_SERVICE_URL="https://api.runpod.ai/v2/<endpoint-id>/runsync"`)
  console.log(`   export BOB_SERVICE_URL="$INFERENCE_SERVICE_URL"`)
  console.log(`   node scripts/bob-ingest-all-training.mjs\n`)

  console.log('Option 3: Build URL from endpoint ID\n')
  console.log(`   1. Find your RunPod Serverless endpoint ID`)
  console.log(`   2. Use: https://api.runpod.ai/v2/<endpoint-id>/runsync`)
  console.log(`   3. Export INFERENCE_SERVICE_URL and retry\n`)

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
})
