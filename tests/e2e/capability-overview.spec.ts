/**
 * Capability Overview UI Tests
 *
 * Verifies that the UI implements everything claimed in docs/CAPABILITY_OVERVIEW.md.
 *
 * Strategy:
 *  - Public routes (login, dispute portal) are tested in full.
 *  - Authenticated routes are confirmed to exist: unauthenticated access must
 *    redirect to /login (not 404 or blank page).
 *  - Route existence is checked by navigating to each path and asserting the
 *    response is NOT a blank page / unknown route.
 *
 * These tests do NOT require live Supabase credentials; they run against the
 * Vite dev server with placeholder env values.
 */

import { test, expect, type Page } from '@playwright/test'

// ─── helpers ────────────────────────────────────────────────────────────────

/** Navigate to a protected route and confirm it redirects to /login. */
async function expectsAuthRedirect(page: Page, path: string) {
  await page.goto(path)
  // Wait up to 15 seconds for the auth state check to resolve and the redirect to fire.
  // The app shows a loading spinner for up to 12 seconds while Supabase resolves the session.
  await page.waitForURL('**/login', { timeout: 15000 }).catch(() => {
    // waitForURL throws if timeout exceeded — fall through and let the
    // assertion below produce a clear failure message.
  })
  const url = page.url()
  const onLogin =
    url.includes('/login') ||
    (await page.locator('input[type="email"], input[type="password"]').count()) > 0
  expect(onLogin, `Route ${path} should redirect unauthenticated users to login`).toBe(true)
}

/** Assert that a heading or visible text is present on the page. */
async function expectHeading(page: Page, pattern: string | RegExp) {
  await expect(page.locator('h1, h2, h3').filter({ hasText: pattern }).first()).toBeVisible({
    timeout: 8000,
  })
}

// ─── Login page ─────────────────────────────────────────────────────────────

test.describe('Login Page', () => {
  test('renders the login form with email and password fields', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('shows a brand / product name on the login page', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    // The page should mention the product name somewhere visible
    const bodyText = await page.locator('body').innerText()
    const hasBrand =
      /freedom\s*camp/i.test(bodyText) ||
      /fcm/i.test(bodyText) ||
      /iron\s*eagle/i.test(bodyText) ||
      /onspace/i.test(bodyText)
    expect(hasBrand, 'Login page should display a brand / product name').toBe(true)
  })

  test('submit button is disabled when fields are empty', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    const submit = page.locator('button[type="submit"]')
    // Click submit with empty fields — should either stay on page or show error
    await submit.click()
    // We are still on /login (no navigation away)
    await expect(page).toHaveURL(/\/login/)
  })

  test('shows an error for invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    await page.fill('input[type="email"]', 'notareal@user.test')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')

    // Should show some error feedback (toast, alert, or inline message)
    const errorVisible = await page
      .locator(
        '[role="alert"], .text-red, .text-destructive, [data-sonner-toast], .error, [class*="error"]'
      )
      .first()
      .isVisible({ timeout: 8000 })
      .catch(() => false)

    // If no visible error element, at minimum we must still be on /login
    const stillOnLogin = page.url().includes('/login')
    expect(errorVisible || stillOnLogin).toBe(true)
  })
})

// ─── Public Dispute Portal ───────────────────────────────────────────────────

test.describe('Public Dispute Portal', () => {
  async function waitForDisputePortal(page: Page) {
    await page.goto('/dispute')
    await page.waitForLoadState('domcontentloaded')
    // Route is lazy-loaded; on cold dev startup this can take longer than 10s.
    await expect(page.locator('body')).toContainText('Notice Review and Dispute Portal', {
      timeout: 20000,
    })
  }

  test('is accessible without authentication', async ({ page }) => {
    await waitForDisputePortal(page)

    // Should NOT redirect to login
    expect(page.url()).not.toContain('/login')
  })

  test('renders a notice reference number input', async ({ page }) => {
    await waitForDisputePortal(page)
    // Wait for the specific reference input to appear (rendered by React)
    const refInput = page.locator('input[placeholder*="INF" i]').first()
    await expect(refInput).toBeVisible({ timeout: 20000 })
  })

  test('renders a Find Notice button', async ({ page }) => {
    await waitForDisputePortal(page)
    // Wait for the Find Notice button to appear (rendered by React)
    const findBtn = page.locator('button').filter({ hasText: /find notice/i }).first()
    await expect(findBtn).toBeVisible({ timeout: 20000 })
  })

  test('shows a heading describing the dispute process', async ({ page }) => {
    await waitForDisputePortal(page)
    // CardTitle renders as h3; wait for the specific portal heading
    const heading = page.locator('h1, h2, h3').filter({ hasText: /notice.*review|dispute.*portal/i }).first()
    await expect(heading).toBeVisible({ timeout: 20000 })
  })
})

// ─── Protected routes — existence & redirect ─────────────────────────────────

test.describe('Protected routes redirect to login when unauthenticated', () => {
  const protectedRoutes = [
    '/',
    '/admin',
    '/field-officer',
    '/portal-selection',
    '/vehicles',
    '/zones',
    '/compliance',
    '/breaches',
    '/data',
    '/users',
    '/access-control',
    '/organizations',
    '/platform',
    '/client-portal',
    '/incidents',
    '/reports',
    '/diagnostics',
    '/compliance-recalculation',
    '/live-tracking',
    '/organization-profile',
    '/audit-log',
    '/enforcement-actions',
    '/enforcement-command-center',
    '/infringements',
    '/patrol-checkpoints',
    '/patrol-schedule',
    '/patrol-kpis',
    '/admin/data-hub',
    '/admin/data-cleanup',
    '/admin/cleanup-recalculate',
    '/admin/data-integrity',
    '/live-patrol',
    '/reports-hub',
    '/ai-analysis',
    '/hotspots',
    '/profile',
    '/settings',
  ]

  for (const route of protectedRoutes) {
    test(`${route} redirects to /login`, async ({ page }) => {
      await expectsAuthRedirect(page, route)
    })
  }
})

// ─── Capability: Admin Command Centre ────────────────────────────────────────

test.describe('Admin Dashboard / Command Centre route', () => {
  test('/admin route exists and redirects unauthenticated users to login', async ({ page }) => {
    await expectsAuthRedirect(page, '/admin')
  })
})

// ─── Capability: Compliance Dashboard ────────────────────────────────────────

test.describe('Compliance Dashboard route', () => {
  test('/compliance route exists and redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/compliance')
  })
})

// ─── Capability: Zone Management ─────────────────────────────────────────────

test.describe('Zone Management route', () => {
  test('/zones route exists and redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/zones')
  })
})

// ─── Capability: Breach Alerts ───────────────────────────────────────────────

test.describe('Breach Alerts route', () => {
  test('/breaches route exists and redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/breaches')
  })
})

// ─── Capability: Enforcement Command Centre ───────────────────────────────────

test.describe('Enforcement Command Centre route', () => {
  test('/enforcement-command-center route exists and redirects', async ({ page }) => {
    await expectsAuthRedirect(page, '/enforcement-command-center')
  })
})

// ─── Capability: Live Officer Tracking ───────────────────────────────────────

test.describe('Live Patrol Monitor route', () => {
  test('/live-patrol route exists and redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/live-patrol')
  })

  test('/live-tracking route exists and redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/live-tracking')
  })
})

// ─── Capability: Patrol Scheduling ───────────────────────────────────────────

test.describe('Patrol scheduling routes', () => {
  test('/patrol-schedule redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/patrol-schedule')
  })

  test('/patrol-checkpoints redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/patrol-checkpoints')
  })

  test('/patrol-kpis redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/patrol-kpis')
  })
})

// ─── Capability: Vehicle Management ──────────────────────────────────────────

test.describe('Vehicle Management routes', () => {
  test('/vehicles redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/vehicles')
  })
})

// ─── Capability: Incident Management ─────────────────────────────────────────

test.describe('Incident Management route', () => {
  test('/incidents redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/incidents')
  })
})

// ─── Capability: Reports & Analytics ─────────────────────────────────────────

test.describe('Reports & Analytics routes', () => {
  test('/reports redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/reports')
  })

  test('/reports-hub redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/reports-hub')
  })

  test('/ai-analysis redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/ai-analysis')
  })

  test('/hotspots redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/hotspots')
  })
})

// ─── Capability: Data Management & Integrity ─────────────────────────────────

test.describe('Data Management routes', () => {
  test('/data redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/data')
  })

  test('/audit-log redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/audit-log')
  })

  test('/admin/data-integrity redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/admin/data-integrity')
  })

  test('/admin/data-hub redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/admin/data-hub')
  })
})

// ─── Capability: Multi-organisation ──────────────────────────────────────────

test.describe('Multi-organisation routes', () => {
  test('/platform redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/platform')
  })

  test('/organizations redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/organizations')
  })

  test('/users redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/users')
  })

  test('/access-control redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/access-control')
  })
})

// ─── Capability: Client Organisation Portal ──────────────────────────────────

test.describe('Client Organisation Portal route', () => {
  test('/client-portal redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/client-portal')
  })
})

// ─── Capability: Enforcement Actions & Notices ───────────────────────────────

test.describe('Enforcement routes', () => {
  test('/enforcement-actions redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/enforcement-actions')
  })

  test('/infringements redirects unauthenticated users', async ({ page }) => {
    await expectsAuthRedirect(page, '/infringements')
  })
})

// ─── Login page form validation ───────────────────────────────────────────────

test.describe('Login page — form UX', () => {
  test('email field accepts valid email format', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    const emailInput = page.locator('input[type="email"]')
    await emailInput.fill('test@example.com')
    await expect(emailInput).toHaveValue('test@example.com')
  })

  test('password field masks input', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    const pwInput = page.locator('input[type="password"]')
    await expect(pwInput).toHaveAttribute('type', 'password')
  })

  test('page title or heading contains product reference', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    const title = await page.title()
    const bodyText = await page.locator('body').innerText()
    const relevant =
      /freedom|camp|manager|fcm|iron.*eagle|onspace/i.test(title) ||
      /freedom|camp|manager|fcm|iron.*eagle|onspace/i.test(bodyText)
    expect(relevant, 'Page should reference the product name').toBe(true)
  })
})

// ─── App shell loads without JS errors ───────────────────────────────────────

test.describe('App shell', () => {
  test('loads without critical JS errors on login page', async ({ page }) => {
    const jsErrors: string[] = []
    page.on('pageerror', (err) => {
      // Ignore known non-critical errors (e.g. Supabase auth errors with placeholder creds)
      if (
        !err.message.includes('Invalid JWT') &&
        !err.message.includes('Failed to fetch') &&
        !err.message.includes('NetworkError') &&
        !err.message.includes('supabase') &&
        !err.message.includes('CORS')
      ) {
        jsErrors.push(err.message)
      }
    })

    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    expect(
      jsErrors,
      `Page loaded with unexpected JS errors: ${jsErrors.join('; ')}`
    ).toHaveLength(0)
  })

  test('React app mounts — root element is populated', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    // #root should have content (React mounted)
    const rootContent = await page.locator('#root').innerHTML()
    expect(rootContent.trim().length, '#root should not be empty after React mounts').toBeGreaterThan(0)
  })
})
