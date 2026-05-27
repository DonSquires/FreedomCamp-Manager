#!/usr/bin/env node
/**
 * Bob Inference Endpoint Smoke-Check
 *
 * Polls all configured inference endpoints, measures latency and availability,
 * then writes a JSON artifact to data/inference-endpoint-health.json for Bob's
 * Doctor system to consume.
 *
 * Usage:
 *   BOB_INFERENCE_URLS="https://primary.example.com,https://fallback.example.com" \
 *   node scripts/check-inference-endpoints.mjs
 *
 * Exits 0 if at least one endpoint is healthy, 1 if all are degraded/down.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUTPUT_PATH = resolve(ROOT, 'data', 'inference-endpoint-health.json')
const PROBE_TIMEOUT_MS = 8000
const HARD_TIMEOUT_MS = Number.parseInt(process.env.BOB_INFERENCE_SMOKE_HARD_TIMEOUT_MS || '120000', 10)
const PROBE_PROMPT = 'ping'

/**
 * Collect all candidate inference URLs from environment variables,
 * mirroring the same priority order used in bobInfer.ts.
 */
function collectEndpoints() {
  const env = process.env
  const candidates = [
    env.INFERENCE_SERVICE_URL,
    env.INFERENCE_SERVICE_FALLBACK_URL,
    env.INFERENCE_SERVICE_URL_SECONDARY,
    env.RUNPOD_ENDPOINT_URL,
    env.INFERENCE_SERVICE_URL_RUNPOD,
    ...(env.BOB_INFERENCE_URLS ?? '').split(',').map((s) => s.trim()),
  ]

  const seen = new Set()
  return candidates
    .filter(Boolean)
    .map((u) => {
      const t = u.trim().replace(/\/$/, '')
      return /^https?:\/\//i.test(t) ? t : `https://${t}`
    })
    .filter((u) => {
      try {
        new URL(u)
        if (seen.has(u)) return false
        seen.add(u)
        return true
      } catch {
        return false
      }
    })
}

function isRunpodServerless(url) {
  return /api\.runpod\.ai\/v2\/[^/]+/i.test(url)
}

/**
 * Build the minimal health-probe request body for a given endpoint.
 * RunPod serverless expected a /runsync job; others get a plain chat body.
 */
function buildProbeBody(url) {
  if (isRunpodServerless(url)) {
    return JSON.stringify({
      input: {
        prompt: PROBE_PROMPT,
        max_tokens: 1,
        stream: false,
      },
    })
  }
  return JSON.stringify({
    model: process.env.OLLAMA_MODEL ?? 'llama3',
    messages: [{ role: 'user', content: PROBE_PROMPT }],
    stream: false,
    options: { num_predict: 1 },
  })
}

/**
 * Resolve the correct probe URL path for an endpoint.
 */
function buildProbeUrl(base) {
  if (isRunpodServerless(base)) {
    // Normalise: strip trailing /run or /runsync then append /runsync
    const clean = base.replace(/\/(run|runsync)\/?$/i, '')
    return `${clean}/runsync`
  }
  return `${base}/api/chat`
}

/** Probe a single endpoint and return a health result record. */
async function probeEndpoint(base) {
  const probeUrl = buildProbeUrl(base)
  const body = buildProbeBody(base)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const start = Date.now()

  const headers = { 'Content-Type': 'application/json' }
  const apiKey = process.env.INFERENCE_SERVICE_API_KEY ?? process.env.RUNPOD_API_KEY
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  try {
    const res = await fetch(probeUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    const latencyMs = Date.now() - start
    clearTimeout(timer)

    let status = 'degraded'
    let detail = `HTTP ${res.status}`
    if (res.ok) {
      status = 'healthy'
      detail = 'ok'
    } else if (res.status === 503 || res.status === 429) {
      status = 'degraded'
    } else if (res.status >= 500) {
      status = 'down'
    }

    return { url: base, probeUrl, status, latencyMs, httpStatus: res.status, detail, checkedAt: new Date().toISOString() }
  } catch (err) {
    const latencyMs = Date.now() - start
    clearTimeout(timer)
    const isTimeout = err.name === 'AbortError'
    return {
      url: base,
      probeUrl,
      status: 'down',
      latencyMs,
      httpStatus: null,
      detail: isTimeout ? 'timeout' : String(err.message ?? err),
      checkedAt: new Date().toISOString(),
    }
  }
}

async function main() {
  const endpoints = collectEndpoints()

  if (endpoints.length === 0) {
    console.error('No inference endpoints configured. Set INFERENCE_SERVICE_URL or BOB_INFERENCE_URLS.')
    process.exit(1)
  }

  console.log(`Probing ${endpoints.length} endpoint(s)…\n`)

  const timedResults = Promise.race([
    Promise.all(endpoints.map(probeEndpoint)),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`inference_smoke_hard_timeout_${HARD_TIMEOUT_MS}ms`)), HARD_TIMEOUT_MS)
    }),
  ])

  let results
  try {
    results = await timedResults
  } catch (error) {
    const failureSummary = {
      generatedAt: new Date().toISOString(),
      totalEndpoints: endpoints.length,
      healthyCount: 0,
      degradedCount: 0,
      downCount: endpoints.length,
      primaryEndpoint: endpoints[0] ?? null,
      primaryStatus: 'down',
      recommended: null,
      hardTimeoutMs: HARD_TIMEOUT_MS,
      error: String(error?.message ?? error),
      endpoints: endpoints.map((url) => ({
        url,
        probeUrl: buildProbeUrl(url),
        status: 'down',
        latencyMs: null,
        httpStatus: null,
        detail: 'hard-timeout',
        checkedAt: new Date().toISOString(),
      })),
    }

    mkdirSync(resolve(ROOT, 'data'), { recursive: true })
    writeFileSync(OUTPUT_PATH, JSON.stringify(failureSummary, null, 2))
    console.error(`\nInference endpoint smoke check hit hard timeout (${HARD_TIMEOUT_MS}ms).`)
    process.exit(1)
  }

  const healthy = results.filter((r) => r.status === 'healthy')
  const degraded = results.filter((r) => r.status === 'degraded')
  const down = results.filter((r) => r.status === 'down')

  // Human-readable summary
  for (const r of results) {
    const icon = r.status === 'healthy' ? '✓' : r.status === 'degraded' ? '⚠' : '✗'
    console.log(`${icon} [${r.status.toUpperCase().padEnd(8)}] ${r.url}  (${r.latencyMs}ms) — ${r.detail}`)
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    totalEndpoints: endpoints.length,
    healthyCount: healthy.length,
    degradedCount: degraded.length,
    downCount: down.length,
    primaryEndpoint: endpoints[0] ?? null,
    primaryStatus: results[0]?.status ?? 'unknown',
    recommended: healthy[0]?.url ?? degraded[0]?.url ?? null,
    endpoints: results,
  }

  // Ensure data/ dir exists
  mkdirSync(resolve(ROOT, 'data'), { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2))
  console.log(`\nHealth artifact written → ${OUTPUT_PATH}`)

  if (healthy.length === 0) {
    console.error('\nAll inference endpoints are down or degraded.')
    process.exit(1)
  } else {
    console.log(`\n${healthy.length}/${endpoints.length} endpoint(s) healthy. Primary recommended: ${summary.recommended}`)
    process.exit(0)
  }
}

main()
