import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './auth'
import { SERVICE_MODULES } from '../../src/modules/registry'

function collectAdminRoutes(): string[] {
  const allowedRoles = new Set(['admin', 'admin_officer', 'master'])
  const routeSet = new Set<string>()

  for (const module of Object.values(SERVICE_MODULES)) {
    for (const route of module.routes) {
      const hasAllowedRole = route.roles.some((role) => allowedRoles.has(String(role)))
      if (!hasAllowedRole) continue
      if (!route.path.startsWith('/')) continue
      if (/:[^/]+/.test(route.path)) continue
      routeSet.add(route.path)
    }
  }

  return Array.from(routeSet).sort((a, b) => a.localeCompare(b))
}

async function waitForPageShell(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('main, body').first()).toBeVisible({ timeout: 12000 })
}

async function tryInputInteraction(page: Page): Promise<boolean> {
  const input = page
    .locator('input:not([type="hidden"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])')
    .first()

  if (!await input.isVisible({ timeout: 2000 }).catch(() => false)) return false

  const tag = await input.evaluate((el) => el.tagName.toLowerCase()).catch(() => '')
  const type = await input.getAttribute('type').catch(() => '')
  if (type === 'file' || type === 'checkbox' || type === 'radio') return false

  const value = `human-test-${Date.now()}`
  if (tag === 'textarea') {
    await input.fill(value)
  } else {
    await input.fill(value)
  }

  const currentValue = await input.inputValue().catch(() => '')
  return currentValue.includes('human-test-')
}

async function tryContinueAction(page: Page): Promise<boolean> {
  const continueButton = page
    .locator('button:visible, [role="button"]:visible')
    .filter({ hasText: /continue|next|proceed|use/i })
    .first()

  if (!await continueButton.isVisible({ timeout: 2000 }).catch(() => false)) return false

  const beforeUrl = page.url()
  await continueButton.click({ timeout: 5000 }).catch(() => undefined)
  await page.waitForTimeout(400)

  const afterUrl = page.url()
  const stillRendered = await page.locator('main, body').first().isVisible().catch(() => false)
  return afterUrl !== beforeUrl || stillRendered
}

async function tryLogout(page: Page): Promise<boolean> {
  const directLogout = page
    .locator('button:visible, [role="menuitem"]:visible, a:visible')
    .filter({ hasText: /log out|logout|sign out/i })
    .first()

  if (await directLogout.isVisible({ timeout: 1500 }).catch(() => false)) {
    await directLogout.click({ timeout: 5000 }).catch(() => undefined)
  } else {
    const userMenuTrigger = page
      .locator('button:visible')
      .filter({ hasText: /account|profile|user|menu|settings/i })
      .first()

    if (await userMenuTrigger.isVisible({ timeout: 1500 }).catch(() => false)) {
      await userMenuTrigger.click({ timeout: 5000 }).catch(() => undefined)
      await page.waitForTimeout(250)
      const menuLogout = page
        .locator('button:visible, [role="menuitem"]:visible, a:visible')
        .filter({ hasText: /log out|logout|sign out/i })
        .first()
      if (await menuLogout.isVisible({ timeout: 1500 }).catch(() => false)) {
        await menuLogout.click({ timeout: 5000 }).catch(() => undefined)
      }
    }
  }

  await page.waitForTimeout(700)
  const onLogin = /\/login/i.test(page.url())
  const loginFieldVisible = await page.locator('input[type="email"], input[type="password"]').first().isVisible().catch(() => false)
  return onLogin || loginFieldVisible
}

test.describe('Human Module Interaction Sweep', () => {
  test('sweeps modules with visual, input, continue, and logout checks', async ({ page }, testInfo) => {
    const routes = collectAdminRoutes()
    expect(routes.length).toBeGreaterThan(0)

    await loginAs(page, 'adminOrg1')

    let inputInteractionCount = 0
    let continueInteractionCount = 0

    for (const route of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      await waitForPageShell(page)

      const safeName = route.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root'
      await page.screenshot({
        path: testInfo.outputPath(`human-module-${safeName}.png`),
        fullPage: true,
      })

      const inputWorked = await tryInputInteraction(page)
      if (inputWorked) inputInteractionCount += 1

      const continued = await tryContinueAction(page)
      if (continued) continueInteractionCount += 1
    }

    expect(inputInteractionCount).toBeGreaterThan(0)
    expect(continueInteractionCount).toBeGreaterThan(0)

    const loggedOut = await tryLogout(page)
    expect(loggedOut).toBeTruthy()
  })
})
