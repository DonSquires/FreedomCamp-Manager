#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function parseArgs(argv) {
  const args = {
    mode: 'human-trial-release-gate',
    outDir: 'tools/human-trial-gate',
    dryRun: false,
    maxDiffBytes: 300000,
    required: ['build', 'research', 'triage'],
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === '--mode') args.mode = String(argv[i + 1] || args.mode)
    else if (token.startsWith('--mode=')) args.mode = token.slice('--mode='.length)
    else if (token === '--out-dir') args.outDir = String(argv[i + 1] || args.outDir)
    else if (token.startsWith('--out-dir=')) args.outDir = token.slice('--out-dir='.length)
    else if (token === '--dry-run') args.dryRun = true
    else if (token === '--max-diff-bytes') args.maxDiffBytes = Number.parseInt(String(argv[i + 1] || args.maxDiffBytes), 10)
    else if (token.startsWith('--max-diff-bytes=')) args.maxDiffBytes = Number.parseInt(token.slice('--max-diff-bytes='.length), 10)
    else if (token === '--required') {
      args.required = String(argv[i + 1] || '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    } else if (token.startsWith('--required=')) {
      args.required = token.slice('--required='.length)
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    }
  }

  if (!Number.isFinite(args.maxDiffBytes) || args.maxDiffBytes < 10000) {
    throw new Error('--max-diff-bytes must be an integer >= 10000')
  }

  const allowed = new Set(['build', 'research', 'triage'])
  args.required = args.required.filter((value) => allowed.has(value))
  if (args.required.length === 0) {
    throw new Error('--required must include one or more of: build,research,triage')
  }

  return args
}

function safeText(value) {
  return String(value || '').trim()
}

function normalizeUrl(raw) {
  const input = safeText(raw)
  if (!input) return ''
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`
  return withScheme.replace(/\/+$/, '')
}

function redactSecrets(text) {
  return String(text || '')
    .replace(/(api[_-]?key\s*[=:]\s*)([^\s"']+)/gi, '$1[REDACTED]')
    .replace(/(token\s*[=:]\s*)([^\s"']+)/gi, '$1[REDACTED]')
    .replace(/(password\s*[=:]\s*)([^\s"']+)/gi, '$1[REDACTED]')
    .replace(/(authorization:\s*bearer\s+)([^\s]+)/gi, '$1[REDACTED]')
}

async function git(args) {
  const { stdout } = await execFileAsync('git', args, { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 })
  return String(stdout || '')
}

async function collectGitContext(maxDiffBytes) {
  const headSha = safeText(await git(['rev-parse', 'HEAD']).catch(() => ''))
  const baseSha = safeText(await git(['rev-parse', 'HEAD~1']).catch(() => ''))

  const fileListRaw = baseSha
    ? await git(['diff', '--name-only', `${baseSha}..${headSha}`]).catch(() => '')
    : await git(['show', '--name-only', '--pretty=format:', headSha]).catch(() => '')

  const files = fileListRaw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  let diffText = ''
  if (baseSha) {
    diffText = await git(['diff', '--no-color', '--unified=1', `${baseSha}..${headSha}`]).catch(() => '')
  } else if (headSha) {
    diffText = await git(['show', '--no-color', '--unified=1', '--pretty=format:', headSha]).catch(() => '')
  }

  let truncated = false
  if (Buffer.byteLength(diffText, 'utf8') > maxDiffBytes) {
    diffText = diffText.slice(0, maxDiffBytes)
    truncated = true
  }

  return {
    headSha,
    baseSha,
    files,
    diffText: redactSecrets(diffText),
    truncated,
  }
}

function buildAnalyzePayload({ mode, gitContext }) {
  const repo = safeText(process.env.GITHUB_REPOSITORY) || 'DonSquires/FreedomCamp-Manager'
  const runId = safeText(process.env.GITHUB_RUN_ID)

  return {
    repository: repo,
    pull_request_id: runId ? Number.parseInt(runId, 10) || 0 : 0,
    diffs: gitContext.diffText,
    language: 'typescript',
    framework: 'react-vite-supabase',
    context: [
      `mode=${mode}`,
      `head=${gitContext.headSha}`,
      `base=${gitContext.baseSha || 'none'}`,
      `changed_files=${gitContext.files.length}`,
      gitContext.truncated ? 'diff_truncated=true' : 'diff_truncated=false',
    ].join('; '),
    redact_secrets: true,
  }
}

async function postJson(url, body, apiKey = '') {
  const headers = {
    'Content-Type': 'application/json',
  }

  const key = safeText(apiKey)
  if (key) {
    headers.Authorization = `Bearer ${key}`
    headers['x-api-key'] = key
    headers['x-inference-api-key'] = key
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const raw = await response.text()
  let parsed = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }

  return {
    ok: response.ok,
    status: response.status,
    raw,
    parsed,
  }
}

async function tryOpenAIStyleEndpoint(payload, apiKey) {
  const direct = normalizeUrl(process.env.AI_ASSIST_ANALYZE_URL)
  const base = normalizeUrl(process.env.AI_ASSIST_BASE_URL)
  const analyzeUrl = direct || (base ? `${base}/api/v1/analyze-pr` : '')

  if (!analyzeUrl) {
    return { attempted: false, success: false, provider: 'openai-style', reason: 'analyze-endpoint-not-configured' }
  }

  const result = await postJson(analyzeUrl, payload, apiKey)
  if (!result.ok) {
    return {
      attempted: true,
      success: false,
      provider: 'openai-style',
      url: analyzeUrl,
      status: result.status,
      reason: `http-${result.status}`,
      bodyPreview: String(result.raw || '').slice(0, 500),
    }
  }

  return {
    attempted: true,
    success: true,
    provider: 'openai-style',
    url: analyzeUrl,
    status: result.status,
    response: result.parsed || result.raw,
  }
}

function capabilityQuestion(capability, payload) {
  const changedFiles = Array.isArray(payload?.changedFiles) ? payload.changedFiles : []

  if (capability === 'build') {
    return [
      'Mandatory build assistance request.',
      `Repository: ${payload.repository}`,
      `Head: ${payload.headSha}`,
      `Base: ${payload.baseSha || 'none'}`,
      `Changed files (${changedFiles.length}): ${changedFiles.join(', ') || 'none'}`,
      'Provide top blockers, major risks, and immediate fixes required for this build gate.',
    ].join('\n')
  }

  if (capability === 'research') {
    return [
      'Mandatory research assistance request.',
      `Repository: ${payload.repository}`,
      `Head: ${payload.headSha}`,
      `Base: ${payload.baseSha || 'none'}`,
      `Changed files (${changedFiles.length}): ${changedFiles.join(', ') || 'none'}`,
      'Provide grounded research pointers for architecture, testing, and rollout risk within this codebase.',
    ].join('\n')
  }

  return [
    'Mandatory triage assistance request.',
    `Repository: ${payload.repository}`,
    `Head: ${payload.headSha}`,
    `Base: ${payload.baseSha || 'none'}`,
    `Changed files (${changedFiles.length}): ${changedFiles.join(', ') || 'none'}`,
    'Provide a triage plan grouped by blocker, major, minor including immediate next actions.',
  ].join('\n')
}

function capabilityCategory(capability) {
  if (capability === 'research') return 'general'
  if (capability === 'triage') return 'architecture'
  return 'architecture'
}

function buildOpenAIAnalyzePayload(capability, basePayload) {
  const contextPrefix = `capability=${capability}; mandatory_assistance=true; `
  return {
    ...basePayload,
    context: `${contextPrefix}${basePayload.context}`,
  }
}

async function tryBobAskCopilot(capability, payload) {
  const base = normalizeUrl(process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL)
  const key = safeText(process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY)

  if (!base || !key) {
    return {
      attempted: false,
      success: false,
      provider: 'bob-ask-copilot',
      reason: 'bob-url-or-key-not-configured',
    }
  }

  const body = {
    question: capabilityQuestion(capability, payload),
    category: capabilityCategory(capability),
    source: 'human-trial-release-gate',
    context: {
      mode: payload.mode,
      capability,
      head: payload.headSha,
      base: payload.baseSha,
      changed_files: Array.isArray(payload?.changedFiles) ? payload.changedFiles : [],
    },
  }

  const result = await postJson(`${base}/ask-copilot`, body, key)
  if (!result.ok) {
    return {
      attempted: true,
      success: false,
      provider: 'bob-ask-copilot',
      url: `${base}/ask-copilot`,
      status: result.status,
      reason: `http-${result.status}`,
      bodyPreview: String(result.raw || '').slice(0, 500),
    }
  }

  return {
    attempted: true,
    success: true,
    provider: 'bob-ask-copilot',
    url: `${base}/ask-copilot`,
    status: result.status,
    response: result.parsed || result.raw,
  }
}

async function executeCapability(capability, analyzePayload, basePayload) {
  const openAiStyle = await tryOpenAIStyleEndpoint(
    buildOpenAIAnalyzePayload(capability, analyzePayload),
    process.env.AI_ASSIST_API_KEY || process.env.INFERENCE_API_KEY,
  )

  if (openAiStyle.success) {
    return {
      capability,
      success: true,
      selectedProvider: openAiStyle.provider,
      providerAttempts: [openAiStyle],
      response: openAiStyle.response || null,
    }
  }

  const bobFallback = await tryBobAskCopilot(capability, basePayload)
  return {
    capability,
    success: bobFallback.success,
    selectedProvider: bobFallback.success ? bobFallback.provider : null,
    providerAttempts: [openAiStyle, bobFallback],
    response: bobFallback.success ? (bobFallback.response || null) : null,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = path.resolve(args.outDir)
  await fs.mkdir(outDir, { recursive: true })

  const gitContext = await collectGitContext(args.maxDiffBytes)
  const analyzePayload = buildAnalyzePayload({ mode: args.mode, gitContext })

  const audit = {
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    repository: safeText(process.env.GITHUB_REPOSITORY) || 'DonSquires/FreedomCamp-Manager',
    headSha: gitContext.headSha,
    baseSha: gitContext.baseSha,
    changedFiles: gitContext.files,
    diffTruncated: gitContext.truncated,
    requiredCapabilities: args.required,
    capabilityResults: [],
    providerAttempts: [],
    selectedProviders: {},
    success: false,
  }

  if (args.dryRun) {
    audit.success = true
    for (const capability of args.required) {
      audit.capabilityResults.push({
        capability,
        success: true,
        selectedProvider: 'dry-run',
        providerAttempts: [{ attempted: true, success: true, provider: 'dry-run', capability }],
      })
      audit.selectedProviders[capability] = 'dry-run'
    }
    audit.providerAttempts = audit.capabilityResults.flatMap((item) => item.providerAttempts)
  } else {
    for (const capability of args.required) {
      const capabilityResult = await executeCapability(capability, analyzePayload, {
        mode: args.mode,
        repository: audit.repository,
        headSha: gitContext.headSha,
        baseSha: gitContext.baseSha,
        changedFiles: gitContext.files,
      })

      audit.capabilityResults.push(capabilityResult)
      audit.providerAttempts.push(...capabilityResult.providerAttempts)
      if (capabilityResult.success && capabilityResult.selectedProvider) {
        audit.selectedProviders[capability] = capabilityResult.selectedProvider
      }
    }

    audit.success = audit.capabilityResults.every((item) => item.success)
  }

  const payloadPath = path.join(outDir, 'ai-assist-request.json')
  const resultPath = path.join(outDir, 'ai-assist-result.json')

  await fs.writeFile(payloadPath, `${JSON.stringify(analyzePayload, null, 2)}\n`, 'utf8')
  await fs.writeFile(resultPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')

  console.log('[mandatory-ai-build-assist] artifacts:')
  console.log(`- ${payloadPath}`)
  console.log(`- ${resultPath}`)

  if (!audit.success) {
    const reasons = audit.capabilityResults
      .filter((item) => !item.success)
      .map((item) => {
        const attempts = item.providerAttempts
          .map((attempt) => `${attempt.provider}:${attempt.reason || (attempt.success ? 'ok' : 'failed')}`)
          .join('|')
        return `${item.capability}[${attempts}]`
      })
      .join(', ')

    console.error(`[mandatory-ai-build-assist] failed: ${reasons}`)
    process.exit(1)
  }

  const providersUsed = Object.entries(audit.selectedProviders)
    .map(([capability, provider]) => `${capability}:${provider}`)
    .join(', ')

  console.log(`[mandatory-ai-build-assist] success via ${providersUsed}`)
}

main().catch((error) => {
  console.error('[mandatory-ai-build-assist] fatal:', error?.message || error)
  process.exit(1)
})
