#!/usr/bin/env node

import process from 'node:process'

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

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function parseCsvSet(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  )
}

function deriveInvokeUrl(endpointUrl, endpointId) {
  const explicitUrl = String(endpointUrl || '').trim()
  if (explicitUrl) return explicitUrl
  const id = String(endpointId || '').trim()
  if (id) return `https://api.runpod.ai/v2/${id}/run`
  throw new Error('RUNPOD_ENDPOINT_URL or RUNPOD_ENDPOINT_ID is required')
}

function deriveStatusUrl({ endpointUrl, endpointId, statusJobId }) {
  if (endpointId) {
    return `https://api.runpod.ai/v2/${endpointId}/status/${encodeURIComponent(statusJobId)}`
  }
  if (endpointUrl.includes('/run')) {
    return endpointUrl.replace(/\/runs?$/i, `/status/${encodeURIComponent(statusJobId)}`)
  }
  throw new Error('Unable to derive status URL; provide RUNPOD_ENDPOINT_ID')
}

async function httpJson(url, apiKey, body) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  let json = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Endpoint returned non-JSON response (${response.status}): ${text.slice(0, 300)}`)
  }

  if (!response.ok) {
    throw new Error(`Endpoint HTTP ${response.status}: ${JSON.stringify(json).slice(0, 500)}`)
  }

  return json
}

function isTerminalStatus(status) {
  const value = String(status || '').toUpperCase()
  return value === 'COMPLETED' || value === 'FAILED' || value === 'CANCELLED' || value === 'TIMED_OUT'
}

async function pollStatus({ endpointUrl, endpointId, apiKey, statusJobId, intervalMs, timeoutMs }) {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const statusUrl = deriveStatusUrl({ endpointUrl, endpointId, statusJobId })
    const statusData = await httpJson(statusUrl, apiKey, null)
    const status = statusData?.status
    if (isTerminalStatus(status)) return statusData
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Polling timed out after ${timeoutMs}ms`)
}

function extractModelText(output) {
  if (!output || typeof output !== 'object') return ''
  const candidates = [output.message, output.response, output.text]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function extractCitedPaths(response) {
  const line = response
    .split('\n')
    .find((l) => /^CITED_PATHS\s*:/i.test(l.trim()))

  if (!line) return []
  const value = line.split(':').slice(1).join(':')
  return value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
}

function extractCitedSymbols(response) {
  const line = response
    .split('\n')
    .find((l) => /^CITED_SYMBOLS\s*:/i.test(l.trim()))

  if (!line) return []
  const value = line.split(':').slice(1).join(':').trim()
  if (!value || /^NONE$/i.test(value)) return []
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function extractPathLikeTokens(response) {
  const matches = response.match(/\b[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|sql|sh)\b/g) || []
  return Array.from(new Set(matches))
}

function collectSectionBullets(response, sectionHeading) {
  const lines = response.split('\n')
  const headingIndex = lines.findIndex((line) => line.trim().toUpperCase() === sectionHeading.toUpperCase())
  if (headingIndex < 0) return []

  const bullets = []
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue

    if (/^[A-Z_]+\s*:/.test(line)) break

    // Accept common list styles from LLM output while preserving strict section parsing.
    if (/^(?:[-*•]|\d+\.|[a-zA-Z]\))\s+/.test(line)) {
      bullets.push(line.replace(/^(?:[-*•]|\d+\.|[a-zA-Z]\))\s+/, '').trim())
    }
  }

  return bullets
}

function getBasename(path) {
  const parts = String(path).split('/')
  return parts[parts.length - 1] || path
}

function buildBasenameCounts(paths) {
  const counts = new Map()
  for (const path of paths) {
    const basename = getBasename(path)
    counts.set(basename, (counts.get(basename) || 0) + 1)
  }
  return counts
}

function isAllowedPathMention(pathToken, allowedPaths, basenameCounts) {
  if (allowedPaths.has(pathToken)) return true
  return (basenameCounts.get(pathToken) || 0) === 1
}

function validateResponse({
  response,
  allowedPaths,
  allowedSymbols,
  minCitations,
  minGuidance,
  minValidationChecks,
  requirePathMapping,
}) {
  const errors = []
  const basenameCounts = buildBasenameCounts(allowedPaths)

  const hasAck = /\bACK\b/i.test(response)
  if (!hasAck) errors.push('Missing ACK token.')

  const citedPaths = extractCitedPaths(response)
  const citedSymbols = extractCitedSymbols(response)
  if (citedPaths.length < minCitations) {
    errors.push(`Expected at least ${minCitations} cited paths in CITED_PATHS line.`)
  }

  const unknownCitedPaths = citedPaths.filter((path) => !allowedPaths.has(path))
  if (unknownCitedPaths.length > 0) {
    errors.push(`CITED_PATHS contains unknown entries: ${unknownCitedPaths.join(', ')}`)
  }

  const mentionedPaths = extractPathLikeTokens(response)
  const unknownMentioned = mentionedPaths.filter(
    (path) => !isAllowedPathMention(path, allowedPaths, basenameCounts),
  )
  if (unknownMentioned.length > 0) {
    errors.push(`Response mentioned unknown path-like tokens: ${unknownMentioned.join(', ')}`)
  }

  const unknownCitedSymbols = citedSymbols.filter((symbol) => !allowedSymbols.has(symbol))
  if (unknownCitedSymbols.length > 0) {
    errors.push(`CITED_SYMBOLS contains unknown entries: ${unknownCitedSymbols.join(', ')}`)
  }

  const guidanceBullets = collectSectionBullets(response, 'GUIDANCE:')
  const validationBullets = collectSectionBullets(response, 'VALIDATION_CHECKS:')

  if (guidanceBullets.length < minGuidance) {
    errors.push(`Expected at least ${minGuidance} GUIDANCE bullets.`)
  }

  if (validationBullets.length < minValidationChecks) {
    errors.push(`Expected at least ${minValidationChecks} VALIDATION_CHECKS bullets.`)
  }

  if (requirePathMapping && citedPaths.length > 0) {
    const actionableText = [...guidanceBullets, ...validationBullets].join('\n')
    const unmappedCitedPaths = citedPaths.filter((path) => {
      const basename = getBasename(path)
      const canUseBasename = (basenameCounts.get(basename) || 0) === 1
      return !actionableText.includes(path) && (!canUseBasename || !actionableText.includes(basename))
    })
    if (unmappedCitedPaths.length > 0) {
      errors.push(`CITED_PATHS missing from actionable sections: ${unmappedCitedPaths.join(', ')}`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    citedPaths,
    citedSymbols,
    mentionedPaths,
    guidanceBullets,
    validationBullets,
  }
}

function buildPrompt({ basePrompt, allowedPaths, allowedSymbols }) {
  const pathsList = Array.from(allowedPaths).join('\n- ')
  const symbolsList = Array.from(allowedSymbols).join('\n- ')

  return [
    'TRAINING ACK REQUIRED: start first line with ACK and confirm all constraints.',
    'CONSTRAINTS:',
    '1) Repo-grounded only. Do not invent files, APIs, hooks, or frameworks.',
    '2) Use only the ALLOWED_PATHS listed below for file references.',
    '3) If uncertain, output INSUFFICIENT_CONTEXT and ask for narrower scope.',
    '4) Output format must be exactly:',
    'ACK: <short>',
    'CITED_PATHS: <comma-separated exact allowed paths>',
    'CITED_SYMBOLS: <comma-separated symbols or NONE>',
    'GUIDANCE:',
    '- <bullet 1>',
    '- <bullet 2>',
    '- <bullet 3>',
    'VALIDATION_CHECKS:',
    '- <check 1>',
    '- <check 2>',
    '',
    `ALLOWED_PATHS:\n- ${pathsList}`,
    `ALLOWED_SYMBOLS:\n- ${symbolsList || 'NONE'}`,
    '',
    `TASK:\n${basePrompt}`,
  ].join('\n')
}

async function invokeModel({ endpointUrl, endpointId, apiKey, prompt, intervalMs, timeoutMs }) {
  const invokeData = await httpJson(endpointUrl, apiKey, {
    input: {
      message: prompt,
      prompt,
    },
  })

  const invokeStatus = String(invokeData?.status || '').toUpperCase()
  if (isTerminalStatus(invokeStatus) && invokeStatus !== 'IN_PROGRESS') {
    return invokeData
  }

  const jobId = invokeData?.id || invokeData?.jobId
  if (!jobId) return invokeData

  return pollStatus({
    endpointUrl,
    endpointId,
    apiKey,
    statusJobId: String(jobId),
    intervalMs,
    timeoutMs,
  })
}

async function main() {
  const apiKey = requiredEnv('RUNPOD_ENDPOINT_API_KEY')
  const endpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim()
  const endpointUrl = deriveInvokeUrl(process.env.RUNPOD_ENDPOINT_URL, endpointId)

  const basePrompt = String(getArg('prompt', '')).trim()
  if (!basePrompt) throw new Error('--prompt is required')

  const allowedPaths = parseCsvSet(getArg('allowedPaths', ''))
  if (allowedPaths.size === 0) {
    throw new Error('--allowedPaths must include at least one workspace path')
  }

  const allowedSymbols = parseCsvSet(getArg('allowedSymbols', ''))
  const minCitations = Number(getArg('minCitations', '2'))
  const minGuidance = Number(getArg('minGuidance', '3'))
  const minValidationChecks = Number(getArg('minValidationChecks', '2'))
  const requirePathMapping = String(getArg('requirePathMapping', 'true')).toLowerCase() !== 'false'
  const retries = Number(getArg('retries', '1'))
  const intervalMs = Number(getArg('intervalMs', '3000'))
  const timeoutMs = Number(getArg('timeoutMs', '120000'))

  if (!Number.isFinite(minCitations) || minCitations < 1) throw new Error('minCitations must be >= 1')
  if (!Number.isFinite(minGuidance) || minGuidance < 1) throw new Error('minGuidance must be >= 1')
  if (!Number.isFinite(minValidationChecks) || minValidationChecks < 1) {
    throw new Error('minValidationChecks must be >= 1')
  }
  if (!Number.isFinite(retries) || retries < 0) throw new Error('retries must be >= 0')

  let attempt = 0
  let finalResponse = ''
  let finalValidation = { ok: false, errors: ['No response'], citedPaths: [], mentionedPaths: [] }

  while (attempt <= retries) {
    const prompt = buildPrompt({ basePrompt, allowedPaths, allowedSymbols })
    const result = await invokeModel({ endpointUrl, endpointId, apiKey, prompt, intervalMs, timeoutMs })
    const responseText = extractModelText(result?.output || result)
    finalResponse = responseText || JSON.stringify(result)

    finalValidation = validateResponse({
      response: finalResponse,
      allowedPaths,
      allowedSymbols,
      minCitations,
      minGuidance,
      minValidationChecks,
      requirePathMapping,
    })

    if (finalValidation.ok) break

    attempt += 1
    if (attempt > retries) break

    const correction = [
      'Your last response failed validation.',
      ...finalValidation.errors.map((e) => `- ${e}`),
      'Retry and follow the exact output format and allowed paths constraints.',
    ].join('\n')

    const correctedPrompt = `${basePrompt}\n\nCORRECTION_REQUIRED:\n${correction}`
    const correctedResult = await invokeModel({
      endpointUrl,
      endpointId,
      apiKey,
      prompt: buildPrompt({ basePrompt: correctedPrompt, allowedPaths, allowedSymbols }),
      intervalMs,
      timeoutMs,
    })

    finalResponse = extractModelText(correctedResult?.output || correctedResult) || JSON.stringify(correctedResult)
    finalValidation = validateResponse({
      response: finalResponse,
      allowedPaths,
      allowedSymbols,
      minCitations,
      minGuidance,
      minValidationChecks,
      requirePathMapping,
    })

    if (finalValidation.ok) break
    attempt += 1
  }

  const payload = {
    ok: finalValidation.ok,
    attemptsUsed: attempt + 1,
    validation: finalValidation,
    response: finalResponse,
  }

  console.log(JSON.stringify(payload, null, 2))
  process.exit(finalValidation.ok ? 0 : 2)
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`)
  process.exit(1)
})
