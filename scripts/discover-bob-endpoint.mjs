#!/usr/bin/env node

/**
 * discover-bob-endpoint.mjs
 *
 * Helps locate the live Bob service endpoint (RunPod gateway).
 * Bob runs on RunPod Serverless with an Ollama gateway.
 *
 * Usage:
 *   node scripts/discover-bob-endpoint.mjs
 *   node scripts/discover-bob-endpoint.mjs --test <url>
 *   node scripts/discover-bob-endpoint.mjs --set-env
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const RUNPOD_ENDPOINT_ID = String(process.env.RUNPOD_ENDPOINT_ID || '').trim()
const LIKELY_GATEWAY_URL = RUNPOD_ENDPOINT_ID
  ? `https://${RUNPOD_ENDPOINT_ID}-8080.proxy.runpod.net`
  : ''

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('BOB ENDPOINT DISCOVERY')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

// Check environment first
const BOB_FROM_ENV = (process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '').trim()

if (BOB_FROM_ENV) {
  console.log('✅ Bob endpoint already set in environment:')
  console.log(`   BOB_SERVICE_URL=${BOB_FROM_ENV}\n`)
  testEndpoint(BOB_FROM_ENV)
  process.exit(0)
}

console.log('📍 Endpoint not found in environment.\n')
if (LIKELY_GATEWAY_URL) {
  console.log('Based on RUNPOD_ENDPOINT_ID, the likely RunPod gateway URL is:')
  console.log(`   ${LIKELY_GATEWAY_URL}\n`)
} else {
  console.log('RUNPOD_ENDPOINT_ID not set, so a likely gateway URL cannot be inferred.')
  console.log('Set RUNPOD_ENDPOINT_ID or provide --test <url>.\n')
}

async function testEndpoint(url) {
  const testUrl = url.replace(/\/$/, '')
  console.log(`Testing endpoint: ${testUrl}/health\n`)

  try {
    const response = await fetch(`${testUrl}/health`, {
      timeout: 5000,
      headers: { 'User-Agent': 'bob-discovery/1.0' },
    })

    if (response.ok) {
      console.log(`✅ Endpoint is reachable and healthy`)
      const data = await response.json()
      console.log(`   Status: ${data.status || 'ok'}`)
      console.log(`   Response:`, JSON.stringify(data).slice(0, 200))
    } else {
      console.log(`⚠️  Endpoint returned HTTP ${response.status}`)
      console.log(`   This may be normal if health endpoint requires authentication.`)
      console.log(`   Try running training ingestion anyway.`)
    }
  } catch (err) {
    console.log(`❌ Could not reach endpoint: ${err.message}`)
    console.log(`\n   Possible causes:`)
    console.log(`   • RunPod pod is not running`)
    console.log(`   • Gateway service is not healthy`)
    console.log(`   • Network connectivity issue`)
  }

  console.log()
}

console.log('Option 1: Test the likely endpoint\n')

testEndpoint(LIKELY_GATEWAY_URL).then(() => {
  console.log('Option 2: If you have a different URL, set it manually:\n')
  console.log(`   export BOB_SERVICE_URL="https://your-actual-endpoint"`)
  console.log(`   node scripts/bob-ingest-all-training.mjs\n`)

  console.log('Option 3: Find your RunPod gateway URL\n')
  console.log(`   1. Go to RunPod pod SSH or control panel`)
  console.log(`   2. Check the pod's exposed ports/gateway URLs`)
  console.log(`   3. Look for a URL like: https://{pod-id}-8080.proxy.runpod.net`)
  console.log(`   4. Use that URL with --set-env:\n`)
  console.log(`      node scripts/discover-bob-endpoint.mjs --set-env https://your-url\n`)

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
})
