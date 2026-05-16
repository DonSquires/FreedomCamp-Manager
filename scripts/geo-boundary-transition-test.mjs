#!/usr/bin/env node

import process from 'node:process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

function getArg(name, fallback = '') {
  const key = `--${name}`
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '')
    if (token === key) return String(args[i + 1] || fallback)
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1) || fallback
  }
  return fallback
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`)
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || '').trim()
    if (trimmed) return trimmed
  }
  return ''
}

function toNumber(raw, fallback) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return fallback
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : fallback
}

function buildSystemPrompt(context) {
  if (!context) {
    return [
      'You are Bob, an enforcement AI for New Zealand freedom camping operations.',
      'Apply standard NZ Freedom Camping Act and operational policy guidance.',
      'Answer clearly with actionable field advice.',
    ].join(' ')
  }

  const workspaceName = String(context.workspace_name || 'Operational Workspace')
  const bylaws = context.bylaws ? JSON.stringify(context.bylaws) : 'No specific bylaw payload provided.'
  return [
    'You are Bob, an enforcement AI.',
    `You are currently operating in ${workspaceName}.`,
    `Apply these jurisdiction bylaws and constraints: ${bylaws}`,
    'Respond with practical patrol-ready guidance and clearly call out uncertainty when needed.',
  ].join(' ')
}

function extractAnswer(payload) {
  const output = payload?.output || {}
  const message = output?.message || {}
  const firstChoice = output?.choices?.[0]?.message || {}
  const candidates = [
    payload?.response,
    payload?.message,
    output?.response,
    output?.message,
    message?.content,
    firstChoice?.content,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return ''
}

async function callSupabaseRpc({ supabaseUrl, serviceRoleKey, rpcName, body }) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }

  if (!response.ok) {
    throw new Error(`RPC ${rpcName} failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`)
  }

  return payload
}

async function resolveProviderOrgId({ supabaseUrl, serviceRoleKey, providerOrgId, providerName }) {
  if (providerOrgId) return providerOrgId
  if (!providerName) return ''

  const response = await fetch(
    `${supabaseUrl}/rest/v1/organizations?select=id,name&name=ilike.*${encodeURIComponent(providerName)}*&limit=5`,
    {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
    },
  )

  const payload = await response.json().catch(() => [])
  if (!response.ok) {
    throw new Error(`Organization lookup failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`)
  }

  if (!Array.isArray(payload) || !payload.length) {
    return ''
  }

  return String(payload[0]?.id || '').trim()
}

async function countActiveContractorAccess({ supabaseUrl, serviceRoleKey, providerOrgId }) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/contractor_access?select=id&provider_org_id=eq.${providerOrgId}&status=eq.active&limit=1`,
    {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        Prefer: 'count=exact',
      },
    },
  )

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(`contractor_access preflight failed (${response.status}): ${payload.slice(0, 300)}`)
  }

  const contentRange = response.headers.get('content-range') || ''
  const total = Number(contentRange.split('/')[1] || '0')
  return Number.isFinite(total) ? total : 0
}

async function askOnspaceAiChat({ supabaseUrl, serviceRoleKey, prompt, context }) {
  const response = await fetch(`${supabaseUrl}/functions/v1/onspace-ai-chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'inference',
      model: 'qwen2.5:7b',
      temperature: 0.2,
      messages: [
        { role: 'system', content: buildSystemPrompt(context) },
        { role: 'user', content: prompt },
      ],
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`onspace-ai-chat failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`)
  }

  return {
    answer: extractAnswer(payload),
    provider: String(payload?.provider || ''),
    model: String(payload?.model || ''),
  }
}

function isIdleTimeoutError(error) {
  const message = String(error?.message || '').toUpperCase()
  return message.includes('IDLE_TIMEOUT') || message.includes('504')
}

async function askOnspaceAiChatWithRetry({ supabaseUrl, serviceRoleKey, prompt, context, retries }) {
  let lastError = null

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await askOnspaceAiChat({ supabaseUrl, serviceRoleKey, prompt, context })
    } catch (error) {
      lastError = error
      const retryable = isIdleTimeoutError(error)
      if (!retryable || attempt >= retries) {
        throw error
      }

      console.warn(`onspace-ai-chat attempt ${attempt}/${retries} timed out; retrying...`)
    }
  }

  throw lastError || new Error('Unknown AI request failure')
}

async function inspectPoint({
  supabaseUrl,
  serviceRoleKey,
  providerOrgId,
  lat,
  lng,
  prompt,
  aiRetries,
  allowAiTimeout,
}) {
  const contextPayload = await callSupabaseRpc({
    supabaseUrl,
    serviceRoleKey,
    rpcName: 'get_active_context',
    body: {
      officer_lat: lat,
      officer_lng: lng,
      provider_id: providerOrgId,
    },
  })

  const context = Array.isArray(contextPayload) ? contextPayload[0] || null : contextPayload || null
  let ai
  let aiTimedOut = false

  try {
    ai = await askOnspaceAiChatWithRetry({
      supabaseUrl,
      serviceRoleKey,
      prompt,
      context,
      retries: aiRetries,
    })
  } catch (error) {
    if (allowAiTimeout && isIdleTimeoutError(error)) {
      aiTimedOut = true
      ai = {
        answer: '[AI response unavailable: inference idle timeout]',
        provider: 'inference-timeout',
        model: 'unknown',
      }
    } else {
      throw error
    }
  }

  return {
    lat,
    lng,
    context,
    ai,
    aiTimedOut,
  }
}

async function main() {
  const supabaseUrl = firstNonEmpty(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_URL)
  const serviceRoleKey = firstNonEmpty(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const providerOrgIdRaw = firstNonEmpty(getArg('providerOrgId', ''), process.env.PROVIDER_ORG_ID, process.env.BOB_ORG_ID, process.env.ORG_ID)
  const providerName = firstNonEmpty(getArg('providerName', ''), process.env.PROVIDER_ORG_NAME, 'First Security')
  const prompt = firstNonEmpty(getArg('prompt', ''), 'What are the overnight rules here?')
  const aiRetriesRaw = Number(getArg('aiRetries', '3'))
  const aiRetries = Number.isFinite(aiRetriesRaw) && aiRetriesRaw > 0 ? Math.trunc(aiRetriesRaw) : 3
  const allowAiTimeout = hasFlag('allowAiTimeout')
  const allowNoTransition = hasFlag('allowNoTransition')

  const fromLat = toNumber(getArg('fromLat', ''), -41.328)
  const fromLng = toNumber(getArg('fromLng', ''), 173.18)
  const toLat = toNumber(getArg('toLat', ''), -41.5)
  const toLng = toNumber(getArg('toLng', ''), 173.5)

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL in environment.')
  }
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in environment.')
  }

  const providerOrgId = await resolveProviderOrgId({
    supabaseUrl,
    serviceRoleKey,
    providerOrgId: providerOrgIdRaw,
    providerName,
  })

  if (!providerOrgId) {
    throw new Error(
      'Could not resolve provider organization id. Pass --providerOrgId=<uuid> or set PROVIDER_ORG_ID.',
    )
  }

  const activeAccessCount = await countActiveContractorAccess({
    supabaseUrl,
    serviceRoleKey,
    providerOrgId,
  })

  if (activeAccessCount === 0) {
    console.error(`No active contractor_access rows found for provider ${providerOrgId}.`)
    console.error('Boundary test blocked: handshake cannot activate until provider-to-workspace access is configured.')
    console.error('Seed or create access rows, then rerun bob:test:boundary.')
    process.exit(3)
  }

  console.log(`Boundary test provider org: ${providerOrgId}`)
  console.log(`Point A: lat=${fromLat}, lng=${fromLng}`)
  console.log(`Point B: lat=${toLat}, lng=${toLng}`)

  const [pointA, pointB] = await Promise.all([
    inspectPoint({
      supabaseUrl,
      serviceRoleKey,
      providerOrgId,
      lat: fromLat,
      lng: fromLng,
      prompt,
      aiRetries,
      allowAiTimeout,
    }),
    inspectPoint({
      supabaseUrl,
      serviceRoleKey,
      providerOrgId,
      lat: toLat,
      lng: toLng,
      prompt,
      aiRetries,
      allowAiTimeout,
    }),
  ])

  const jurisdictionA = String(pointA.context?.workspace_name || 'General')
  const jurisdictionB = String(pointB.context?.workspace_name || 'General')
  const changed = jurisdictionA !== jurisdictionB

  console.log('\n=== Boundary Test Result ===')
  console.log(`Jurisdiction A: ${jurisdictionA}`)
  console.log(`Jurisdiction B: ${jurisdictionB}`)
  console.log(`Context switched: ${changed ? 'YES' : 'NO'}`)
  console.log(`Model/provider A: ${pointA.ai.model || 'unknown'} / ${pointA.ai.provider || 'unknown'}`)
  console.log(`Model/provider B: ${pointB.ai.model || 'unknown'} / ${pointB.ai.provider || 'unknown'}`)

  console.log('\n--- Bob answer @ Point A ---')
  console.log(pointA.ai.answer || '[empty]')
  console.log('\n--- Bob answer @ Point B ---')
  console.log(pointB.ai.answer || '[empty]')

  if (pointA.aiTimedOut || pointB.aiTimedOut) {
    console.warn('\nAI timeout fallback was used for one or more points; context transition result is still enforced.')
  }

  if (!changed) {
    if (allowNoTransition) {
      console.warn('\nBoundary transition was not detected. Continuing in degraded mode because --allowNoTransition is set.')
      console.warn('Follow-up required: verify get_active_context coverage and test coordinates for this provider.')
      return
    }

    console.error('\nBoundary test did not detect a jurisdiction transition across provided points.')
    process.exit(2)
  }

  console.log('\nBoundary test passed: live context transitioned across the two coordinates.')
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})
