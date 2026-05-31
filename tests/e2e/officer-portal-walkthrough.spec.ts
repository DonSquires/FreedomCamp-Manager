import { test, expect } from '@playwright/test';

const BASE =
  process.env.PLAYWRIGHT_FOCUSED_BASE_URL ||
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.DEFAULT_PLAYWRIGHT_BASE_URL ||
  'http://localhost:5173';
const EMAIL = 'squires.don@live.com';
const PASS = 'Run2thesun??';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(BASE)
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first()
  const passInput = page.locator('input[type="password"]').first()

  // Base route can transiently render as "/" before deciding whether to
  // show login or redirect to an authenticated landing page.
  await Promise.race([
    emailInput.waitFor({ state: 'visible', timeout: 7000 }).catch(() => undefined),
    page.waitForURL(url => !url.pathname.startsWith('/login') && url.pathname !== '/', { timeout: 7000 }).catch(() => undefined),
  ])

  const path = pathFromUrl(page.url())
  if (path !== '/login' && path !== '/') {
    return
  }

  const canFillLogin = await emailInput.isVisible({ timeout: 5000 }).catch(() => false)
  if (!canFillLogin) {
    await page.waitForURL(url => !url.pathname.startsWith('/login') && url.pathname !== '/', { timeout: 10000 }).catch(() => {})
    return
  }

  await emailInput.fill(EMAIL)
  await passInput.fill(PASS)
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first().click()
  await page.waitForURL(url => !url.pathname.startsWith('/login') && url.pathname !== '/', { timeout: 15000 }).catch(() => {})
}

async function gotoWithSessionRecovery(
  page: import('@playwright/test').Page,
  route: string,
): Promise<{ url: string; bodyText: string }> {
  await page.goto(`${BASE}${route}`)
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

  if (pathFromUrl(page.url()) === '/login') {
    await login(page)
    await page.goto(`${BASE}${route}`)
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
  }

  await page.waitForTimeout(1000)
  const url = page.url()
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  return { url, bodyText }
}

function pathFromUrl(raw: string): string {
  try {
    return new URL(raw).pathname;
  } catch {
    return raw;
  }
}

function getExpectedLandingPaths(route: string): string[] {
  const fallbacks: Record<string, string[]> = {
    '/field-officer': ['/field-officer', '/officer-home'],
    '/compliance-dashboard': ['/compliance-dashboard', '/compliance'],
    '/admin/dashboard': ['/admin/dashboard', '/admin'],
    '/field-officer/dispatch': ['/field-officer/dispatch', '/dispatch'],
    '/admin/dispatch': ['/admin/dispatch', '/dispatch'],
    '/admin/enforcement': ['/admin/enforcement', '/enforcement-actions'],
  }

  return fallbacks[route] || [route]
}

function isExpectedLandingPath(route: string, currentPath: string): boolean {
  if (currentPath === route || currentPath.startsWith(`${route}/`)) return true
  return getExpectedLandingPaths(route).includes(currentPath)
}

function topErrorSignatures(messages: string[], limit = 3): string[] {
  const counts = new Map<string, number>()
  for (const msg of messages) {
    counts.set(msg, (counts.get(msg) || 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([msg, count]) => `${count}x ${msg}`)
}

function toCompactUrl(raw: string): string {
  try {
    const url = new URL(raw)
    return `${url.pathname}${url.search}`
  } catch {
    return raw
  }
}

const MANUAL_SECTIONS: Record<string, string[]> = {
  // Instruction Manual §2 (login + officer standby/field portal shell)
  getting_started: [
    '/field-officer',
    '/officer-home',
    '/profile',
  ],
  // Instruction Manual §4.1 Patrols & Scheduling
  patrols_scheduling: [
    '/patrol-checkpoints',
    '/patrol-schedule',
    '/patrol-kpis',
    '/availability',
    '/roster',
    '/timesheets',
  ],
  // Instruction Manual §4.1 Compliance & Enforcement
  compliance_enforcement: [
    '/compliance',
    '/compliance-dashboard',
    '/breaches',
    '/breach-notices',
    '/infringements',
    '/enforcement-actions',
    '/incident-reports',
  ],
  // Instruction Manual §4.1 Vehicles & ALPR
  vehicles_alpr: [
    '/vehicles',
    '/vehicle-registry',
  ],
  // Instruction Manual §4.1 Zones & Geofencing
  zones_geofencing: [
    '/zones',
    '/hotspots',
    '/operations-map',
  ],
  // Instruction Manual §4.1 Communications + Dispatch + Core admin pages
  comms_dispatch_admin: [
    '/radio',
    '/dispatch',
    '/team-chat',
    '/admin',
    '/admin/dashboard',
    '/users',
    '/organizations',
    '/audit-log',
    '/settings',
    '/search',
  ],
  // Specialist officer portals listed in Instruction Manual Part C
  specialist_portals: [
    '/parking',
    '/parking-officer',
    '/site-guard',
    '/site-risk-assessment',
    '/smoke-officer',
    '/biosecurity-officer',
    '/officer-welfare',
    '/officer-skills',
    '/observations',
    '/incidents',
    '/reports',
    '/person-records',
  ],
}

const SECTION_ORDER = [
  'getting_started',
  'patrols_scheduling',
  'compliance_enforcement',
  'vehicles_alpr',
  'zones_geofencing',
  'comms_dispatch_admin',
  'specialist_portals',
] as const

test.describe('Portal page walkthrough', () => {
  test('login', async ({ page }) => {
    await login(page)
    await page.screenshot({ path: 'test-results/01-post-login.png', fullPage: false })
    console.log('Post-login URL:', page.url())
  });

  test('walk pages with one session', async ({ page, context }) => {
    test.setTimeout(10 * 60 * 1000);

    const requestedSection = (process.env.WALKTHROUGH_SECTION || 'all').trim().toLowerCase()
    const activeSections = requestedSection === 'all'
      ? [...SECTION_ORDER]
      : SECTION_ORDER.filter((sectionId) => sectionId === requestedSection)

    if (activeSections.length === 0) {
      throw new Error(
        `INVALID_WALKTHROUGH_SECTION: "${requestedSection}". Valid: all, ${SECTION_ORDER.join(', ')}`,
      )
    }

    await page.addInitScript(() => {
      ;(window as any).__PTT_MOCK_MODE__ = true
    })

    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: -36.8485, longitude: 174.7633 })

    const errors: string[] = [];
    const pageErrors: string[] = [];
    const failedResponses: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => pageErrors.push(String(err?.message || err)));
    page.on('response', res => {
      const status = res.status()
      if (status >= 400) {
        failedResponses.push(`${status} ${res.request().method()} ${toCompactUrl(res.url())}`)
      }
    })

    await login(page)

    const postLoginPath = pathFromUrl(page.url());
    if (postLoginPath === '/login' || postLoginPath === '/') {
      throw new Error(
        [
          'LOGIN_NOT_ESTABLISHED',
          'EXPECTED: authenticated session before walkthrough navigation',
          `ACTUAL: still on ${postLoginPath}`,
          `FINAL_URL: ${page.url()}`,
          `CONSOLE_ERROR_1: ${errors[0] || 'none'}`,
          `PAGE_ERROR_1: ${pageErrors[0] || 'none'}`,
        ].join('\n'),
      );
    }

    const resetSectionSession = async (sectionId: string) => {
      await page.goto(BASE)
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
      const path = pathFromUrl(page.url())
      if (path === '/login' || path === '/') {
        await login(page)
        const retryPath = pathFromUrl(page.url())
        if (retryPath === '/login' || retryPath === '/') {
          throw new Error(`SECTION_RESET_FAILED (${sectionId}): expected authenticated session but landed on ${retryPath}`)
        }
      }
    }

    const walk = async (routes: string[], sectionId: string) => {
      console.log(`SECTION_START ${sectionId} routes=${routes.length}`)
      for (const route of routes) {
        const errorsBefore = errors.length
        const pageErrorsBefore = pageErrors.length
        const failedResponsesBefore = failedResponses.length

        const { url, bodyText } = await gotoWithSessionRecovery(page, route)
        const title = await page.title();

        expect(bodyText).not.toContain('Application error');
        expect(bodyText).not.toContain('Cannot read properties of');

        const finalPath = pathFromUrl(url);
        expect(
          isExpectedLandingPath(route, finalPath),
          [
            `UNEXPECTED_REDIRECT for ${route} (${sectionId})`,
            `EXPECTED: one of ${getExpectedLandingPaths(route).join(', ')}`,
            `ACTUAL: landed on ${finalPath}`,
            `FINAL_URL: ${url}`,
            `CONSOLE_ERROR_1: ${errors[0] || 'none'}`,
            `PAGE_ERROR_1: ${pageErrors[0] || 'none'}`,
          ].join('\n'),
        ).toBeTruthy();

        const newConsoleErrors = errors.slice(errorsBefore)
        const newPageErrors = pageErrors.slice(pageErrorsBefore)
        const routeFailedResponses = failedResponses.slice(failedResponsesBefore)
        if (newConsoleErrors.length > 0 || newPageErrors.length > 0) {
          console.log(
            `⚠ [${sectionId}] ${route} | newConsoleErrors=${newConsoleErrors.length} | newPageErrors=${newPageErrors.length} | routeFailedResponses=${routeFailedResponses.length} | firstConsoleError="${newConsoleErrors[0] || 'none'}" | firstPageError="${newPageErrors[0] || 'none'}" | firstFailedResponse="${routeFailedResponses[0] || 'none'}"`,
          )
        }

        const safe = route.replace(/\//g, '_').replace(/^_/, '');
        await page.screenshot({ path: `test-results/page-${sectionId}-${safe}.png`, fullPage: true });
        console.log(`✅ [${sectionId}] ${route} | title="${title}" | url=${url} | totalErrors=${errors.length} | routeNewErrors=${newConsoleErrors.length}`);
      }
      console.log(`SECTION_DONE ${sectionId}`)
    };

    for (const sectionId of activeSections) {
      await resetSectionSession(sectionId)
      await walk(MANUAL_SECTIONS[sectionId], sectionId)
    }

    const topConsoleErrors = topErrorSignatures(errors)
    if (topConsoleErrors.length > 0) {
      console.log('CONSOLE_ERROR_SUMMARY')
      for (const line of topConsoleErrors) console.log(line)
    }

    const topFailedResponses = topErrorSignatures(failedResponses, 8)
    if (topFailedResponses.length > 0) {
      console.log('FAILED_RESPONSE_SUMMARY')
      for (const line of topFailedResponses) console.log(line)
    }
  });
});
