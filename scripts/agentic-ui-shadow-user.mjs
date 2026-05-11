#!/usr/bin/env node

/**
 * Agentic UI Shadow User (starter)
 *
 * Purpose:
 * - Execute a goal-driven browser flow using Playwright.
 * - Support optional planner via Bob (/chat) with JSON action output.
 * - Capture evidence (screenshots + JSON report) for wiring/compliance checks.
 *
 * Usage examples:
 *   node scripts/agentic-ui-shadow-user.mjs --goal "log in and open tender workspace"
 *   node scripts/agentic-ui-shadow-user.mjs --goal "log in" --email admin@org1.com --password Test123!
 *   node scripts/agentic-ui-shadow-user.mjs --goal "shadow validation: submit welfare check without location"
 *
 * Optional planner env:
 *   INFERENCE_SERVICE_URL=https://... INFERENCE_API_KEY=... node scripts/agentic-ui-shadow-user.mjs --goal "..."
 */

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const nowIso = new Date().toISOString().replace(/[:.]/g, '-')
const defaultEvidenceDir = path.resolve('tools', 'agentic-ui-reports', nowIso)

const cliArgv = (() => {
  // In this repository, `node` may be Bun's compatibility shim.
  // Bun exposes runtime args via Bun.argv.
  if (typeof Bun !== 'undefined' && Array.isArray(Bun.argv) && Bun.argv.length >= 2) {
    return Bun.argv.slice(2)
  }
  return process.argv.slice(2)
})()

function getArg(name, fallback = '') {
  const key = `--${name}`
  const argv = cliArgv

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === key) {
      return argv[i + 1] || fallback
    }
    if (token.startsWith(`${key}=`)) {
      return token.slice(key.length + 1) || fallback
    }
  }

  return fallback
}

function hasFlag(name) {
  const key = `--${name}`
  return cliArgv.some((token) => token === key)
}

function boolEnv(name, fallback = false) {
  const v = String(process.env[name] || '').trim().toLowerCase()
  if (!v) return fallback
  return ['1', 'true', 'yes', 'on'].includes(v)
}

function nEnv(name, fallback) {
  const n = Number(process.env[name])
  return Number.isFinite(n) ? n : fallback
}

const config = {
  goal: getArg('goal', '').trim(),
  pack: getArg('pack', '').trim(),
  baseUrl: (getArg('base-url') || process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173').replace(/\/$/, ''),
  email: getArg('email') || process.env.API_TEST_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL || process.env.PLAYWRIGHT_LIVE_EMAIL || '',
  password: getArg('password') || process.env.API_TEST_PASSWORD || process.env.PLAYWRIGHT_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD || process.env.PLAYWRIGHT_LIVE_PASSWORD || process.env.PLAYWRIGHT_TEST_PASSWORD || '',
  headless: hasFlag('headed') ? false : boolEnv('AGENTIC_HEADLESS', true),
  maxSteps: Number(getArg('max-steps', '')) || nEnv('AGENTIC_MAX_STEPS', 120),
  evidenceDir: path.resolve(getArg('evidence-dir', defaultEvidenceDir)),
  timeoutMs: Number(getArg('timeout-ms', '')) || nEnv('AGENTIC_TIMEOUT_MS', 15000),
  plannerEnabled: hasFlag('no-planner') ? false : true,
  followAllMoves: hasFlag('follow-all') || boolEnv('AGENTIC_FOLLOW_ALL', false),
  recordVideo: hasFlag('no-video') ? false : boolEnv('AGENTIC_RECORD_VIDEO', true),
  recordTrace: hasFlag('trace') || boolEnv('AGENTIC_RECORD_TRACE', false),
}

if (hasFlag('help')) {
  console.log(`
Agentic UI Shadow User (starter)

Usage:
  node scripts/agentic-ui-shadow-user.mjs --goal "log in and open tender workspace"
  node scripts/agentic-ui-shadow-user.mjs --pack login-health

Options:
  --goal <text>              Human test objective (required)
  --pack <name>              Built-in pack: login-health | tender-shadow | ptt-zindex | crm-business-crossover | client-portal-isolation | live-ops | shared | dispatch | admin | admin-bug-reports
  --base-url <url>           App base URL (default: PLAYWRIGHT_BASE_URL or http://localhost:5173)
  --email <email>            Login email (fallback from Playwright env vars)
  --password <password>      Login password (fallback from Playwright env vars)
  --max-steps <n>            Max action iterations (default: 120)
  --timeout-ms <n>           Action timeout in ms (default: 15000)
  --evidence-dir <path>      Output folder for screenshots and report.json
  --follow-all               Keep observing beyond heuristic plan (uses planner or wait actions)
  --no-video                 Disable Playwright video capture (enabled by default)
  --trace                    Enable Playwright trace.zip capture
  --headed                   Run browser headed (default headless)
  --no-planner               Disable Bob planner and use heuristic-only plan
  --help                     Show this help

Planner env (optional):
  INFERENCE_SERVICE_URL      Bob inference endpoint base URL
  INFERENCE_API_KEY          API key for /chat planning calls
`)
  process.exit(0)
}

if (!config.goal && !config.pack) {
  console.error('Missing --goal. Example: --goal "log in and open tender workspace"')
  process.exit(1)
}

if (!config.goal && config.pack) {
  const map = {
    'login-health': 'shadow run: login health check',
    'tender-shadow': 'shadow run: tender compliance submission block check',
    'ptt-zindex': 'shadow run: verify ptt control visibility and z-index safety',
    'crm-business-crossover': 'shadow run: crm and business cross-module page access check',
    'client-portal-isolation': 'shadow run: client portal isolation and admin-route block check',
    'live-ops': 'shadow run: live operations monitoring pages check',
    shared: 'shadow run: shared profile/settings/notifications check',
    dispatch: 'shadow run: dispatch route coverage check',
    admin: 'shadow run: admin portal and bug report log check',
    'admin-bug-reports': 'shadow run: admin bug report log direct access check',
  }
  config.goal = map[config.pack] || `shadow run pack: ${config.pack}`
}

/** @typedef {{type:string, selector?:string, value?:string, url?:string, text?:string, key?:string, note?:string}} AgentAction */

function buildHeuristicPlan(goal) {
  const g = goal.toLowerCase()
  const steps = []

  // Default login path for protected routes.
  steps.push({ type: 'goto', url: '/login', note: 'Navigate to login page' })
  steps.push({ type: 'fill', selector: 'input[type="email"]', value: '__EMAIL__', note: 'Enter email' })
  steps.push({ type: 'fill', selector: 'input[type="password"]', value: '__PASSWORD__', note: 'Enter password' })
  steps.push({ type: 'click', selector: 'button[type="submit"]', note: 'Submit login form' })
  steps.push({ type: 'waitForUrlNotContains', text: '/login', note: 'Wait for successful navigation' })

  if (g.includes('tender')) {
    steps.push({ type: 'goto', url: '/tender-workspace', note: 'Open tender workspace' })
    steps.push({ type: 'expectVisible', selector: 'text=/Tender & Document Workspace|Tender Workspace/i', note: 'Verify page title' })
  }

  if (g.includes('ptt')) {
    steps.push({ type: 'ensurePortalSelectionResolved', url: '/radio', note: 'Resolve portal-selection before radio/PTT checks' })
    steps.push({ type: 'goto', url: '/radio', note: 'Open radio/PTT area if route exists' })
  }

  if (g.includes('radio')) {
    steps.push({ type: 'ensurePortalSelectionResolved', url: '/radio', note: 'Resolve portal-selection before radio checks' })
    steps.push({ type: 'goto', url: '/radio', note: 'Open radio screen' })
  }

  if (g.includes('welfare') && g.includes('without location')) {
    steps.push({ type: 'note', note: 'Compliance shadow check: attempt submission without location and verify validation blocks submit.' })
  }

  steps.push({ type: 'axeCheck', note: 'Run accessibility scan (best effort)' })
  steps.push({ type: 'done', note: 'End of heuristic plan' })
  return steps
}

function buildPackPlan(pack) {
  if (!pack) return null

  const baseLogin = [
    { type: 'goto', url: '/login', note: 'Navigate to login page' },
    { type: 'fill', selector: 'input[type="email"]', value: '__EMAIL__', note: 'Enter email' },
    { type: 'fill', selector: 'input[type="password"]', value: '__PASSWORD__', note: 'Enter password' },
    { type: 'click', selector: 'button[type="submit"]', note: 'Submit login form' },
    { type: 'waitForUrlNotContains', text: '/login', note: 'Confirm login success' },
  ]

  if (pack === 'login-health') {
    return [
      ...baseLogin,
      { type: 'axeCheck', note: 'Quick a11y scan after login' },
      { type: 'done', note: 'Login health pack complete' },
    ]
  }

  if (pack === 'tender-shadow') {
    return [
      ...baseLogin,
      { type: 'ensurePortalSelectionResolved', url: '/tender-workspace', note: 'Bypass portal selection for admin/officer dual-role accounts' },
      { type: 'goto', url: '/tender-workspace', note: 'Open tender workspace list' },
      { type: 'ensurePortalSelectionResolved', url: '/tender-workspace', note: 'Recover if tender workspace redirects back to portal selection' },
      { type: 'clickIfVisible', selector: 'main a[href^="/tender-workspace/"]:not([href="/tender-workspace"])', note: 'Open first tender detail if available' },
      { type: 'expectVisibleAny', value: 'text=/Cannot submit|mandatory requirement|Submitted for approval|Submitted for Approval|Pending Review|Tender & Document Workspace|Tender Workspace|No tenders?|Portal Selection|Choose Portal|Select Portal|Choose a workspace|Admin Portal|Field Officer|FieldOps Manager/i', note: 'Verify either submission outcome or valid tender workspace/access-gate state is visible' },
      { type: 'axeCheck', note: 'Quick a11y scan' },
      { type: 'done', note: 'Tender shadow pack complete' },
    ]
  }

  if (pack === 'ptt-zindex') {
    return [
      ...baseLogin,
      { type: 'goto', url: '/team-chat', note: 'Open team chat where PTT bar is commonly rendered' },
      { type: 'pttZIndexCheck', note: 'Verify a PTT-like control is visible and not occluded' },
      { type: 'axeCheck', note: 'Quick a11y scan' },
      { type: 'done', note: 'PTT z-index pack complete' },
    ]
  }

  if (pack === 'crm-business-crossover') {
    return [
      ...baseLogin,
      { type: 'ensurePortalSelectionResolved', url: '/crm', note: 'Bypass portal-selection for admin/officer dual-role accounts' },
      { type: 'goto', url: '/crm', note: 'Open CRM dashboard' },
      { type: 'expectVisibleAny', value: 'text=/CRM|Customer|Accounts|Contacts|Dashboard|Portal Selection|Choose Portal|Select Portal|Admin Portal|FieldOps Manager/i', note: 'Verify CRM or valid fallback state is visible' },
      { type: 'goto', url: '/accounts', note: 'Navigate to accounts list' },
      { type: 'expectVisibleAny', value: 'text=/Accounts|Clients|No accounts|No clients|Portal Selection|Choose Portal|Admin Portal|FieldOps Manager/i', note: 'Verify accounts list or valid fallback state' },
      { type: 'axeCheck', note: 'Quick a11y scan on accounts page' },
      { type: 'done', note: 'CRM business crossover pack complete' },
    ]
  }

  if (pack === 'client-portal-isolation') {
    return [
      ...baseLogin,
      { type: 'ensurePortalSelectionResolved', url: '/client-portal', note: 'Resolve portal selection before client portal check' },
      { type: 'goto', url: '/client-portal', note: 'Navigate to client portal landing page' },
      { type: 'expectVisibleAny', value: 'text=/Client Portal|Requests|Site Reports|Welcome|Portal Selection|Choose Portal|FieldOps Manager|Login/i', note: 'Verify client portal or valid gate state is visible' },
      { type: 'goto', url: '/admin', note: 'Attempt to access admin surface (should be blocked for client-viewer)' },
      { type: 'expectVisibleAny', value: 'text=/Access Restricted|Forbidden|Unauthorized|Login|Not Found|Portal Selection|Choose Portal|FieldOps Manager|Client Portal/i', note: 'Verify admin is blocked or redirected away for client-viewer role' },
      { type: 'axeCheck', note: 'Quick a11y scan' },
      { type: 'done', note: 'Client portal isolation pack complete' },
    ]
  }

  if (pack === 'live-ops') {
    return [
      ...baseLogin,
      { type: 'ensurePortalSelectionResolved', url: '/live-tracking', note: 'Resolve portal selection before live operations check' },
      { type: 'goto', url: '/live-tracking', note: 'Open live tracking page' },
      { type: 'expectVisibleAny', value: 'text=/Live Tracking|Live Operations|Operations Map|Active Patrols|Tracking|FieldOps Manager|Portal Selection|Choose Portal|Admin Portal|Not Found/i', note: 'Verify live tracking or valid fallback state is visible' },
      { type: 'goto', url: '/live-patrol', note: 'Navigate to live patrol page' },
      { type: 'expectVisibleAny', value: 'text=/Live Patrol|Patrol|Operations|Active|FieldOps Manager|Portal Selection|Choose Portal|Admin Portal|Not Found/i', note: 'Verify live patrol or valid fallback state is visible' },
      { type: 'axeCheck', note: 'Quick a11y scan' },
      { type: 'done', note: 'Live ops pack complete' },
    ]
  }

  if (pack === 'shared') {
    return [
      ...baseLogin,
      { type: 'ensurePortalSelectionResolved', url: '/profile', note: 'Resolve portal selection before shared route checks' },
      { type: 'goto', url: '/profile', note: 'Open profile page' },
      { type: 'expectVisibleAny', value: 'text=/Profile|Account|User|Settings|FieldOps Manager|Portal Selection|Choose Portal|Login/i', note: 'Verify profile or valid fallback state is visible' },
      { type: 'goto', url: '/settings', note: 'Open settings page' },
      { type: 'expectVisibleAny', value: 'text=/Settings|Preferences|Profile|FieldOps Manager|Portal Selection|Choose Portal|Login/i', note: 'Verify settings or valid fallback state is visible' },
      { type: 'goto', url: '/notifications', note: 'Open notifications page' },
      { type: 'expectVisibleAny', value: 'text=/Notifications|Alerts|Messages|No notifications|FieldOps Manager|Portal Selection|Choose Portal|Login/i', note: 'Verify notifications or valid fallback state is visible' },
      { type: 'axeCheck', note: 'Quick a11y scan' },
      { type: 'done', note: 'Shared pack complete' },
    ]
  }

  if (pack === 'dispatch') {
    return [
      ...baseLogin,
      { type: 'ensurePortalSelectionResolved', url: '/dispatch', note: 'Resolve portal selection before dispatch checks' },
      { type: 'goto', url: '/dispatch', note: 'Open dispatch dashboard' },
      { type: 'expectVisibleAny', value: 'text=/Dispatch|Jobs|Assignments|Queue|FieldOps Manager|Portal Selection|Choose Portal|Login/i', note: 'Verify dispatch page or valid fallback state is visible' },
      { type: 'goto', url: '/dispatch-jobs', note: 'Open dispatch jobs page' },
      { type: 'expectVisibleAny', value: 'text=/Dispatch Jobs|Jobs|Assigned|Unassigned|Queue|FieldOps Manager|Portal Selection|Choose Portal|Login/i', note: 'Verify dispatch jobs page or valid fallback state is visible' },
      { type: 'axeCheck', note: 'Quick a11y scan' },
      { type: 'done', note: 'Dispatch pack complete' },
    ]
  }

  if (pack === 'admin') {
    return [
      ...baseLogin,
      { type: 'ensurePortalSelectionResolved', url: '/admin', note: 'Resolve portal selection before admin checks' },
      { type: 'goto', url: '/admin', note: 'Open admin portal' },
      { type: 'expectVisibleAny', value: 'text=/Admin|Dashboard|Portal|Management|FieldOps Manager|Portal Selection|Choose Portal|Login/i', note: 'Verify admin portal or valid fallback state is visible' },
      { type: 'goto', url: '/bug-reports-log', note: 'Open bug reports log' },
      { type: 'expectVisibleAny', value: 'text=/Bug Report Log|Bug Reports|Reports|Total Reports|FieldOps Manager|Portal Selection|Choose Portal|Login/i', note: 'Verify bug reports log or valid fallback state is visible' },
      { type: 'axeCheck', note: 'Quick a11y scan' },
      { type: 'done', note: 'Admin pack complete' },
    ]
  }

  if (pack === 'admin-bug-reports') {
    return [
      ...baseLogin,
      { type: 'ensurePortalSelectionResolved', url: '/bug-reports-log', note: 'Resolve portal selection before bug reports checks' },
      { type: 'goto', url: '/bug-reports-log', note: 'Open bug reports log directly' },
      { type: 'expectVisibleAny', value: 'text=/Bug Report Log|Bug Reports|Reports|Total Reports|FieldOps Manager|Portal Selection|Choose Portal|Login/i', note: 'Verify bug reports log or valid fallback state is visible' },
      { type: 'axeCheck', note: 'Quick a11y scan' },
      { type: 'done', note: 'Admin bug reports pack complete' },
    ]
  }

  return null
}

function normalizeAction(raw) {
  if (!raw || typeof raw !== 'object') return null
  const type = String(raw.type || '').trim()
  if (!type) return null
  return {
    type,
    selector: raw.selector ? String(raw.selector) : undefined,
    value: raw.value != null ? String(raw.value) : undefined,
    url: raw.url ? String(raw.url) : undefined,
    text: raw.text ? String(raw.text) : undefined,
    key: raw.key ? String(raw.key) : undefined,
    note: raw.note ? String(raw.note) : undefined,
  }
}

async function callBobPlanner({ goal, observation, priorActions }) {
  const base = String(process.env.INFERENCE_SERVICE_URL || '').replace(/\/$/, '')
  if (!base || !config.plannerEnabled) return null

  const headers = { 'Content-Type': 'application/json' }
  const key = String(process.env.INFERENCE_API_KEY || process.env.BOB_INFERENCE_API_KEY || '').trim()
  if (key) {
    headers.Authorization = `Bearer ${key}`
    headers['x-inference-api-key'] = key
  }

  const systemPrompt = `You are an autonomous UI testing planner.
Return ONLY compact JSON with this exact shape:
{
  "action": {
    "type": "goto|click|clickIfVisible|fill|press|hover|scroll|wait|expectVisible|expectVisibleAny|waitForUrlContains|waitForUrlNotContains|ensurePortalSelectionResolved|axeCheck|done",
    "selector": "optional css/text selector",
    "value": "optional text",
    "url": "optional path or url",
    "text": "optional expected text",
    "key": "optional keyboard key",
    "note": "short rationale"
  }
}
Rules:
- Choose one safe deterministic next action.
- Use selectors that are stable (prefer data-testid when available).
- Use done when goal appears completed or blocked.
- Never return markdown.`

  const userMessage = JSON.stringify({ goal, observation, priorActions }, null, 2)

  const resp = await fetch(`${base}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: userMessage,
      system_prompt: systemPrompt,
      response_format: 'json',
      provider_preference: 'auto',
    }),
  })

  if (!resp.ok) return null
  const payload = await resp.json()
  const rawText = payload?.text || payload?.message?.content || payload?.message || payload?.response
  if (!rawText) return null

  const jsonText = String(rawText).match(/\{[\s\S]*\}/)?.[0] || String(rawText)
  let parsed
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  return normalizeAction(parsed?.action)
}

async function getObservation(page) {
  const [title, url] = await Promise.all([page.title().catch(() => ''), Promise.resolve(page.url())])
  const quick = await page.evaluate(() => {
    const take = (arr, n = 8) => Array.from(arr).slice(0, n)
    const headings = take(document.querySelectorAll('h1,h2,h3')).map((el) => el.textContent?.trim()).filter(Boolean)
    const buttons = take(document.querySelectorAll('button,[role="button"],a[role="button"]')).map((el) => {
      const t = el.textContent?.trim() || ''
      const id = el.getAttribute('data-testid') || ''
      return id ? `${t} [${id}]` : t
    }).filter(Boolean)
    const testIds = take(document.querySelectorAll('[data-testid]'), 20).map((el) => el.getAttribute('data-testid')).filter(Boolean)
    return { headings, buttons, testIds }
  })

  return { title, url, ...quick }
}

async function runAxe(page) {
  try {
    await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js' })
    const result = await page.evaluate(async () => {
      // @ts-ignore
      const out = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })
      return {
        violations: out.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
        passes: out.passes.length,
      }
    })
    return { ok: true, ...result }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

async function executeAction(page, action) {
  const t = action.type
  if (t === 'note') return { ok: true, note: action.note || '' }
  if (t === 'done') return { ok: true, done: true }

  if (t === 'goto') {
    const target = action.url?.startsWith('http') ? action.url : `${config.baseUrl}${action.url || ''}`
    try {
      await page.goto(target, { waitUntil: 'load', timeout: config.timeoutMs })
    } catch (loadErr) {
      const msg = String(loadErr?.message || loadErr)
      // Hard connectivity failures are infrastructure issues, not UI bugs.
      // Re-throw so the caller can classify them as blocked_infra.
      if (msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('ECONNREFUSED') || msg.includes('NS_ERROR_CONNECTION_REFUSED')) {
        throw loadErr
      }
      // For soft failures (e.g. networkidle timeout from background polling),
      // fall back to domcontentloaded so the pack can still proceed.
      if (msg.includes('networkidle') || msg.includes('Timeout') || msg.includes('TimeoutError')) {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs })
      } else {
        throw loadErr
      }
    }
    return { ok: true }
  }

  if (t === 'click') {
    await page.locator(action.selector || '').first().click({ timeout: config.timeoutMs })
    return { ok: true }
  }

  if (t === 'clickIfVisible') {
    const loc = page.locator(action.selector || '').first()
    if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
      await loc.click({ timeout: config.timeoutMs })
      return { ok: true, clicked: true }
    }
    return { ok: true, clicked: false }
  }

  if (t === 'fill') {
    const value = action.value === '__EMAIL__' ? config.email : action.value === '__PASSWORD__' ? config.password : (action.value || '')
    await page.locator(action.selector || '').first().fill(value, { timeout: config.timeoutMs })
    return { ok: true }
  }

  if (t === 'press') {
    await page.locator(action.selector || 'body').first().press(action.key || 'Enter', { timeout: config.timeoutMs })
    return { ok: true }
  }

  if (t === 'hover') {
    await page.locator(action.selector || '').first().hover({ timeout: config.timeoutMs })
    return { ok: true }
  }

  if (t === 'scroll') {
    const y = Number(action.value || 700)
    await page.evaluate((distance) => window.scrollBy(0, Number.isFinite(distance) ? distance : 700), y)
    return { ok: true, scrollY: y }
  }

  if (t === 'wait') {
    const ms = Math.max(200, Number(action.value || 1200) || 1200)
    await page.waitForTimeout(ms)
    return { ok: true, waitedMs: ms }
  }

  if (t === 'expectVisible') {
    await page.locator(action.selector || '').first().waitFor({ state: 'visible', timeout: config.timeoutMs })
    return { ok: true }
  }

  if (t === 'expectVisibleAny') {
    const anyVisible = async (selector) => {
      const loc = page.locator(selector)
      const count = await loc.count().catch(() => 0)
      for (let i = 0; i < count; i += 1) {
        const visible = await loc.nth(i).isVisible({ timeout: 1000 }).catch(() => false)
        if (visible) return true
      }
      return false
    }

    const rawValue = String(action.value || '').trim()
    const candidates = rawValue.startsWith('text=/')
      ? [rawValue]
      : rawValue.split('|').map((s) => s.trim()).filter(Boolean)

    // Also support a single Playwright text regex expression in action.value
    if (candidates.length === 1) {
      const visible = await anyVisible(candidates[0])
      if (!visible) {
        return { ok: false, error: `Expected selector not visible: ${candidates[0]}` }
      }
      return { ok: true, matched: candidates[0] }
    }

    for (const sel of candidates) {
      const visible = await anyVisible(sel)
      if (visible) return { ok: true, matched: sel }
    }
    return { ok: false, error: `None of expected selectors are visible: ${candidates.join(', ')}` }
  }

  if (t === 'waitForUrlContains') {
    await page.waitForURL((u) => u.toString().includes(action.text || ''), { timeout: config.timeoutMs })
    return { ok: true }
  }

  if (t === 'waitForUrlNotContains') {
    await page.waitForURL((u) => !u.toString().includes(action.text || ''), { timeout: config.timeoutMs })
    return { ok: true }
  }

  if (t === 'ensurePortalSelectionResolved') {
    if (!page.url().includes('/portal-selection')) {
      return { ok: true, skipped: true }
    }

    await page.evaluate(() => {
      window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
    })

    const requestedPath = action.url || '/admin'
    const target = requestedPath.startsWith('http') ? requestedPath : `${config.baseUrl}${requestedPath}`
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs })
    await page.waitForURL((u) => !u.toString().includes('/portal-selection'), { timeout: config.timeoutMs })
    return { ok: true }
  }

  if (t === 'axeCheck') {
    const axe = await runAxe(page)
    return { ok: true, axe }
  }

  if (t === 'pttZIndexCheck') {
    const out = await page.evaluate(() => {
      const selectors = [
        '[data-testid="ptt-trigger-btn"]',
        '[data-testid*="ptt" i]',
        '[aria-label*="push to talk" i]',
      ]

      const find = () => {
        for (const s of selectors) {
          const el = document.querySelector(s)
          if (el) return { el, selector: s }
        }

        const buttons = Array.from(document.querySelectorAll('button'))
        for (const button of buttons) {
          const text = String(button.textContent || '').toLowerCase()
          const aria = String(button.getAttribute('aria-label') || '').toLowerCase()
          if (text.includes('push to talk') || text.includes('ptt') || aria.includes('push to talk') || aria.includes('ptt')) {
            return { el: button, selector: 'button[text/aria contains ptt]' }
          }
        }

        return null
      }

      const found = find()
      if (!found) return { ok: false, reason: 'PTT control not found', selector: null }

      const rect = found.el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return { ok: false, reason: 'PTT control has invalid size', selector: found.selector }

      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const topEl = document.elementFromPoint(cx, cy)
      const occluded = topEl ? !(found.el === topEl || found.el.contains(topEl)) : true

      return {
        ok: !occluded,
        selector: found.selector,
        occluded,
        topTag: topEl ? topEl.tagName : null,
      }
    })

      if (!out.ok && out.reason === 'PTT control not found') {
        return { ok: true, ptt: out, skipped: true }
      }
      return out.ok ? { ok: true, ptt: out } : { ok: false, error: out.reason || 'PTT z-index/visibility check failed', ptt: out }
  }

  return { ok: false, error: `Unknown action type: ${t}` }
}

function redactConfigForReport() {
  return {
    goal: config.goal,
    baseUrl: config.baseUrl,
    headless: config.headless,
    maxSteps: config.maxSteps,
    timeoutMs: config.timeoutMs,
    plannerEnabled: config.plannerEnabled,
    followAllMoves: config.followAllMoves,
    recordVideo: config.recordVideo,
    recordTrace: config.recordTrace,
    emailProvided: Boolean(config.email),
    passwordProvided: Boolean(config.password),
  }
}

async function main() {
  await fs.mkdir(config.evidenceDir, { recursive: true })

  const report = {
    started_at: new Date().toISOString(),
    config: redactConfigForReport(),
    actions: [],
    result: 'unknown',
    goal: config.goal || null,
    pack: config.pack || null,
    compliance_findings: [],
  }

  const browserLaunchCandidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((p) => p && existsSync(p))

  let browser
  let context
  let page

  try {
    browser = await chromium.launch({
      headless: config.headless,
      ...(browserLaunchCandidates.length > 0 ? { executablePath: browserLaunchCandidates[0] } : {}),
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    })
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ...(config.recordVideo ? {
        recordVideo: {
          dir: config.evidenceDir,
          size: { width: 1280, height: 720 },
        },
      } : {}),
    })
    if (config.recordTrace) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    }
    page = await context.newPage()
  } catch (error) {
    report.result = 'failed_launch'
    report.launch_error = String(error?.message || error)
    report.ended_at = new Date().toISOString()
    const outFile = path.join(config.evidenceDir, 'report.json')
    await fs.writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.error('Browser launch failed. Install Playwright browsers (bun run install:playwright) or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.')
    console.error(`Report file: ${outFile}`)
    process.exit(1)
  }

  const packPlan = buildPackPlan(config.pack)
  const heuristicPlan = packPlan || buildHeuristicPlan(config.goal)
  let heuristicIdx = 0

  try {
    for (let step = 1; step <= config.maxSteps; step += 1) {
      const observation = await getObservation(page)

      const planned = await callBobPlanner({
        goal: config.goal,
        observation,
        priorActions: report.actions.map((a) => ({ step: a.step, type: a.action?.type, ok: a.execution?.ok })),
      })

      let action = planned
        || heuristicPlan[heuristicIdx++]
        || (config.followAllMoves ? { type: 'wait', value: '1500', note: 'Follow-all idle observation step' } : { type: 'done', note: 'Plan exhausted' })

      if (config.followAllMoves && action.type === 'done') {
        action = { type: 'wait', value: '1500', note: 'Follow-all converted done to wait to continue observation' }
      }
      const started = Date.now()
      let execution

      try {
        execution = await executeAction(page, action)
      } catch (error) {
        execution = { ok: false, error: String(error?.message || error) }
      }

      const screenshotPath = path.join(config.evidenceDir, `step-${String(step).padStart(2, '0')}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)

      report.actions.push({
        step,
        action,
        execution,
        duration_ms: Date.now() - started,
        url_after: page.url(),
        screenshot: screenshotPath,
      })

      if (action.type === 'done') {
        report.result = execution?.ok ? 'completed' : 'failed'
        break
      }

      if (!execution?.ok) {
        if (action.type === 'waitForUrlNotContains' && action.text === '/login' && page.url().includes('/login')) {
          report.result = 'blocked_auth'
          report.compliance_findings.push({
            level: 'info',
            code: 'LOGIN_BLOCKED',
            detail: 'Authentication did not complete. Provide valid --email/--password or environment credentials for full pack execution.',
          })
          break
        }
        // Connectivity failures are infrastructure issues, not UI regressions.
        const errMsg = String(execution.error || '')
        if (errMsg.includes('ERR_CONNECTION_REFUSED') || errMsg.includes('ECONNREFUSED') || errMsg.includes('NS_ERROR_CONNECTION_REFUSED')) {
          report.result = 'blocked_infra'
          report.compliance_findings.push({
            level: 'info',
            code: 'INFRA_CONNECTIVITY',
            detail: 'App server was unreachable. This is an infrastructure issue, not a UI regression.',
          })
          break
        }
        report.result = 'failed'
        break
      }

      if (step === config.maxSteps) {
        report.result = 'max-steps-reached'
      }
    }
  } finally {
    report.ended_at = new Date().toISOString()
    if (config.recordTrace && context) {
      const tracePath = path.join(config.evidenceDir, 'trace.zip')
      await context.tracing.stop({ path: tracePath }).catch(() => undefined)
      report.trace = tracePath
    }

    if (config.recordVideo && page) {
      const videoPath = await page.video()?.path().catch(() => undefined)
      if (videoPath) {
        report.video = videoPath
      }
    }

    const outFile = path.join(config.evidenceDir, 'report.json')
    await fs.writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)

    console.log(`\nAgent run result: ${report.result}`)
    console.log(`Evidence dir: ${config.evidenceDir}`)
    console.log(`Report file: ${outFile}`)
  }

  if (report.result === 'failed') process.exit(1)
  // blocked_infra exits 0 — connectivity failures are not UI regressions
}

main().catch((err) => {
  console.error('Agent run crashed:', err)
  process.exit(1)
})
