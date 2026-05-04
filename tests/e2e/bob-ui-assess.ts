/**
 * Bob UI Assessment helper for Playwright tests.
 *
 * After each key login state, takes a full-page screenshot and POSTs it to
 * Bob's /assess/ui/screenshot endpoint. Results are attached to the test
 * report as JSON and a warning annotation is added when scores fall below
 * the configured threshold.
 *
 * Env vars:
 *   BOB_SERVICE_URL          – base URL of the inference service (e.g. http://localhost:3001)
 *                              If unset, assessment is skipped with a console warning.
 *   BOB_INFERENCE_API_KEY    – optional bearer token for the Bob service
 *   BOB_UI_SCORE_THRESHOLD   – minimum acceptable overall score 0-100 (default 60)
 *   BOB_UI_HARD_FAIL         – set to "1" to fail the test when score < threshold
 *                              (default: warn only)
 */

import type { Page, TestInfo } from '@playwright/test'

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] || '').trim()
    if (value) return value
  }
  return ''
}

const rawBobServiceUrlCandidates = [
  readEnv('BOB_UI_ASSESS_URL'),
  readEnv('BOB_SERVICE_URL'),
  readEnv('INFERENCE_SERVICE_URL'),
  readEnv('VITE_INFERENCE_SERVICE_URL'),
].filter(Boolean)

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

const BOB_SERVICE_URL = rawBobServiceUrlCandidates.find((url) => !isLocalhostUrl(url)) || rawBobServiceUrlCandidates[0] || ''
const BOB_API_KEY = readEnv('BOB_INFERENCE_API_KEY')
const BOB_SCORE_THRESHOLD = parseInt(readEnv('BOB_UI_SCORE_THRESHOLD') || '60', 10)
const BOB_HARD_FAIL = readEnv('BOB_UI_HARD_FAIL') === '1'
const BOB_ASSESS_MAX_MS = parseInt(readEnv('BOB_UI_ASSESS_MAX_MS') || '8000', 10)
const RUNPOD_SERVERLESS_URL = readEnv(
  'RUNPOD_ENDPOINT_URL',
  'RUNPOD_RUNSYNC_URL',
  'RUNPOD_GATEWAY_URL',
  'RUNPOD_SERVERLESS_URL',
  'RUNPOD_URL'
)
const RUNPOD_API_KEY = readEnv('RUNPOD_API_KEY', 'DR_BOB_API', 'BOB_INFERENCE_API_KEY', 'INFERENCE_API_KEY', 'VITE_INFERENCE_API_KEY')
const ALLOW_SUPABASE_FALLBACK = readEnv('BOB_UI_ALLOW_SUPABASE_FALLBACK') === '1'
const SUPABASE_URL = readEnv('VITE_SUPABASE_URL')
const SUPABASE_ANON_KEY = readEnv('VITE_SUPABASE_ANON_KEY')

export type BobAssessmentResult = {
  available: boolean
  skipped?: boolean
  skipReason?: string
  scores?: {
    overall: number
    layout?: number
    contrast?: number
    accessibility?: number
    consistency?: number
  }
  observations?: string[]
  recommendations?: string[]
  passedThreshold?: boolean
}

function parseOverallScoreFromText(text: string): number | null {
  const normalized = String(text || '')
  if (!normalized) return null

  const outOf10Match = normalized.match(/(\d(?:\.\d+)?)\s*\/\s*10/i)
  if (outOf10Match) {
    const value = Number(outOf10Match[1])
    if (Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value * 10)))
  }

  const outOf100Match = normalized.match(/(\d{1,3})\s*\/\s*100/i)
  if (outOf100Match) {
    const value = Number(outOf100Match[1])
    if (Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)))
  }

  return null
}

async function getAccessTokenFromBrowser(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const storages: Storage[] = [window.localStorage, window.sessionStorage]

    for (const storage of storages) {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i)
        if (!key || !key.startsWith('sb-') || !key.includes('-auth-token')) continue

        const raw = storage.getItem(key)
        if (!raw) continue

        try {
          const parsed = JSON.parse(raw)
          if (typeof parsed?.access_token === 'string' && parsed.access_token.length > 20) {
            return parsed.access_token
          }
        } catch {
          // ignore malformed storage values
        }
      }
    }

    return null
  })
}

async function assessViaDirectBob(
  screenshotBuffer: Buffer,
  label: string
): Promise<BobAssessmentResult | null> {
  if (!BOB_SERVICE_URL) return null

  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'X-Screenshot-Label': label,
  }
  if (BOB_API_KEY) {
    headers['Authorization'] = `Bearer ${BOB_API_KEY}`
  }

  const response = await fetch(`${BOB_SERVICE_URL}/assess/ui/screenshot`, {
    method: 'POST',
    headers,
    body: screenshotBuffer,
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    return {
      available: true,
      skipped: true,
      skipReason: `Bob responded with ${response.status}`,
    }
  }

  const body = await response.json() as {
    scores?: BobAssessmentResult['scores']
    observations?: string[]
    recommendations?: string[]
  }

  const overall = body.scores?.overall ?? 0
  return {
    available: true,
    skipped: false,
    scores: body.scores,
    observations: body.observations ?? [],
    recommendations: body.recommendations ?? [],
    passedThreshold: overall >= BOB_SCORE_THRESHOLD,
  }
}

async function assessViaSupabaseUiVision(
  page: Page,
  screenshotBuffer: Buffer,
  label: string
): Promise<BobAssessmentResult | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null

  const accessToken = await getAccessTokenFromBrowser(page)
  if (!accessToken) return null

  const response = await fetch(`${SUPABASE_URL}/functions/v1/onspace-ai-chat`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'ui_vision',
      image_b64: screenshotBuffer.toString('base64'),
      focus: 'wording clarity, layout hierarchy, modern human-friendly workflow',
      context:
        `Playwright UI review for ${label}. ` +
        'Evaluate wording readability, visual hierarchy, interaction clarity, and mobile/desktop usability.',
    }),
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) return null

  const payload = await response.json() as {
    success?: boolean
    analysis?: {
      summary?: string
      issues?: Array<{ description?: string; suggestion?: string; severity?: string }>
      overall_score_out_of_10?: number
      top_3_improvements?: string[]
    }
    raw_response?: string
  }

  if (!payload?.success) return null

  const score10 = payload.analysis?.overall_score_out_of_10
  const computedOverall =
    typeof score10 === 'number'
      ? Math.max(0, Math.min(100, Math.round(score10 * 10)))
      : parseOverallScoreFromText(payload.raw_response || '')

  const observations: string[] = []

  if (payload.analysis?.summary) observations.push(payload.analysis.summary)
  for (const issue of payload.analysis?.issues || []) {
    if (issue.description) observations.push(issue.description)
  }
  if (observations.length === 0 && payload.raw_response) {
    observations.push(payload.raw_response)
  }

  return {
    available: true,
    skipped: false,
    ...(computedOverall != null ? { scores: { overall: computedOverall } } : {}),
    observations,
    recommendations: payload.analysis?.top_3_improvements || [],
    ...(computedOverall != null ? { passedThreshold: computedOverall >= BOB_SCORE_THRESHOLD } : {}),
  }
}

async function assessViaRunpodServerless(
  screenshotBuffer: Buffer,
  label: string
): Promise<BobAssessmentResult | null> {
  if (!RUNPOD_SERVERLESS_URL || !RUNPOD_API_KEY) return null

  const response = await fetch(RUNPOD_SERVERLESS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({
      input: {
        action: 'ui_vision',
        image_b64: screenshotBuffer.toString('base64'),
        focus: 'general',
        context:
          `Playwright UI review for ${label}. ` +
          'Evaluate wording readability, layout hierarchy, modern visual language, and human-friendly task flow.',
      },
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    return {
      available: true,
      skipped: true,
      skipReason: `RunPod serverless responded with ${response.status}`,
    }
  }

  const payload = await response.json() as {
    success?: boolean
    output?: {
      success?: boolean
      analysis?: {
        summary?: string
        issues?: Array<{ description?: string; suggestion?: string; severity?: string }>
        overall_score_out_of_10?: number
        top_3_improvements?: string[]
      } | string
      raw_response?: string
    }
  }

  const output = payload?.output ?? payload
  if (!output?.success) return null

  const analysis = output.analysis
  const analysisObject = analysis && typeof analysis === 'object' ? analysis : null

  const score10 = analysisObject?.overall_score_out_of_10
  const computedOverall =
    typeof score10 === 'number'
      ? Math.max(0, Math.min(100, Math.round(score10 * 10)))
      : parseOverallScoreFromText(
          output.raw_response || (typeof analysis === 'string' ? analysis : '')
        )

  const observations: string[] = []

  if (analysisObject?.summary) observations.push(analysisObject.summary)
  for (const issue of analysisObject?.issues || []) {
    if (issue.description) observations.push(issue.description)
  }
  if (observations.length === 0 && typeof analysis === 'string' && analysis.trim()) {
    observations.push(analysis)
  }
  if (observations.length === 0 && output.raw_response) {
    observations.push(output.raw_response)
  }

  return {
    available: true,
    skipped: false,
    ...(computedOverall != null ? { scores: { overall: computedOverall } } : {}),
    observations,
    recommendations: analysisObject?.top_3_improvements || [],
    ...(computedOverall != null ? { passedThreshold: computedOverall >= BOB_SCORE_THRESHOLD } : {}),
  }
}

/**
 * Takes a full-page screenshot of the current page state, sends it to Bob's
 * /assess/ui/screenshot endpoint, and attaches the result to the Playwright
 * test report.
 *
 * @param page      - Playwright Page
 * @param testInfo  - Playwright TestInfo (for attachments & annotations)
 * @param label     - Human-readable label for the screenshot (e.g. 'adminOrg1-dashboard')
 */
export async function bobAssessPage(
  page: Page,
  testInfo: TestInfo,
  label: string
): Promise<BobAssessmentResult> {
  // Take a bounded screenshot so heavy dashboards do not consume the full test timeout.
  let screenshotBuffer: Buffer
  try {
    screenshotBuffer = await page.screenshot({ fullPage: true, timeout: 5000 })
  } catch {
    try {
      screenshotBuffer = await page.screenshot({ fullPage: false, timeout: 3000 })
    } catch {
      const captureFailure: BobAssessmentResult = {
        available: false,
        skipped: true,
        skipReason: 'Screenshot capture timed out',
      }

      await testInfo.attach(`bob-assessment-${label}`, {
        body: Buffer.from(JSON.stringify(captureFailure, null, 2)),
        contentType: 'application/json',
      })

      testInfo.annotations.push({
        type: 'warning',
        description: `Bob review skipped for "${label}": screenshot capture timed out`,
      })

      return captureFailure
    }
  }

  // Attach screenshot to report (always visible in the Playwright HTML report)
  await testInfo.attach(`bob-screenshot-${label}`, {
    body: screenshotBuffer,
    contentType: 'image/png',
  })

  let result: BobAssessmentResult
  try {
    const assessmentWork = async (): Promise<BobAssessmentResult> => {
      // Prefer direct assessment endpoint, then RunPod serverless ui_vision.
      // Supabase fallback is opt-in only to avoid masking emulator wiring issues.
      return (
        (await assessViaDirectBob(screenshotBuffer, label)) ||
        (await assessViaRunpodServerless(screenshotBuffer, label)) ||
        (ALLOW_SUPABASE_FALLBACK ? await assessViaSupabaseUiVision(page, screenshotBuffer, label) : null) ||
        {
          available: false,
          skipped: true,
          skipReason:
            'No reachable Bob assessment path (direct endpoint and RunPod serverless unavailable' +
            (ALLOW_SUPABASE_FALLBACK ? '; Supabase fallback also unavailable)' : ')'),
        }
      )
    }

    const timedOut = new Promise<BobAssessmentResult>((resolve) => {
      setTimeout(() => {
        resolve({
          available: false,
          skipped: true,
          skipReason: `Bob assessment exceeded ${BOB_ASSESS_MAX_MS}ms budget`,
        })
      }, BOB_ASSESS_MAX_MS)
    })

    result = await Promise.race([assessmentWork(), timedOut])
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    result = {
      available: false,
      skipped: true,
      skipReason: `Network error: ${message}`,
    }
  }

  // Attach JSON result
  await testInfo.attach(`bob-assessment-${label}`, {
    body: Buffer.from(JSON.stringify(result, null, 2)),
    contentType: 'application/json',
  })

  // Annotate the test with key observations
  const overall = result.scores?.overall

  if (result.skipped) {
    testInfo.annotations.push({
      type: 'warning',
      description: `Bob review skipped for "${label}": ${result.skipReason || 'unknown reason'}`,
    })
    return result
  }

  if (overall == null || result.passedThreshold == null) {
    testInfo.annotations.push({
      type: 'info',
      description: `Bob review captured for "${label}" (wording/layout observations recorded, no numeric score returned).`,
    })
    return result
  }

  if (!result.passedThreshold) {
    const message =
      `Bob UI score ${overall}/100 is below threshold ${BOB_SCORE_THRESHOLD} for "${label}". ` +
      (result.recommendations?.slice(0, 2).join(' | ') ?? '')

    testInfo.annotations.push({ type: 'warning', description: message })

    if (BOB_HARD_FAIL) {
      throw new Error(message)
    } else {
      console.warn(`[bob-ui-assess] ${message}`)
    }
  } else {
    testInfo.annotations.push({
      type: 'info',
      description: `Bob UI score ${overall}/100 ✓ threshold ${BOB_SCORE_THRESHOLD} for "${label}"`,
    })
  }

  return result
}

/**
 * Convenience: check Bob's design-system endpoint is reachable.
 * Called from global-setup to give an early warning if Bob is offline.
 */
export async function checkBobUiCapability(): Promise<void> {
  if (!BOB_SERVICE_URL && !RUNPOD_SERVERLESS_URL && !(ALLOW_SUPABASE_FALLBACK && SUPABASE_URL)) {
    console.warn('[bob-ui-assess] Bob UI assessment disabled: no direct Bob URL, no RunPod serverless URL, and Supabase fallback disabled/unconfigured')
    return
  }

  if (BOB_SERVICE_URL) {
    try {
      const headers: Record<string, string> = {}
      if (BOB_API_KEY) headers['Authorization'] = `Bearer ${BOB_API_KEY}`

      const response = await fetch(`${BOB_SERVICE_URL}/assess/ui/design-system`, {
        signal: AbortSignal.timeout(5000),
        headers,
      })

      if (response.ok) {
        console.log(`[bob-ui-assess] Bob direct UI assessment available at ${BOB_SERVICE_URL}`)
        return
      }
    } catch {
      // Continue to fallback path below.
    }
  }

  if (SUPABASE_URL) {
    if (ALLOW_SUPABASE_FALLBACK) {
      console.warn('[bob-ui-assess] Direct Bob/RunPod serverless unavailable; UI assessments will fallback to Supabase ui_vision when authenticated')
    }
    return
  }

  if (RUNPOD_SERVERLESS_URL) {
    console.warn('[bob-ui-assess] Direct Bob endpoint unavailable; UI assessments will use RunPod serverless path')
    return
  }

  console.warn(`[bob-ui-assess] Bob service unreachable at ${BOB_SERVICE_URL} – UI assessments will be skipped`)
}
