import { expect } from '@playwright/test'

export async function assertRouteLoads(page: any, route: string, headingPattern?: RegExp) {
  await page.goto(route, { waitUntil: 'domcontentloaded' })

  if (page.url().includes('/portal-selection')) {
    await page.evaluate(() => {
      window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
    })
    await page.goto(route, { waitUntil: 'domcontentloaded' })
  }

  const currentPath = new URL(page.url()).pathname
  const sameRoute = currentPath === route || currentPath.startsWith(`${route}/`)
  const toleratedFallback =
    (route.startsWith('/admin/') && currentPath === '/admin') ||
    (route.startsWith('/crm/') && currentPath === '/crm') ||
    (route === '/field-officer' && currentPath === '/officer-home') ||
    (route.startsWith('/dispatch/') && currentPath === '/dispatch')

  expect(sameRoute || toleratedFallback).toBeTruthy()

  const accessDeniedVisible = await page.getByRole('heading', { name: /access restricted/i }).isVisible().catch(() => false)
  expect(accessDeniedVisible).toBeFalsy()

  if (headingPattern) {
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toContainText(headingPattern, { timeout: 12000 })
    return
  }

  const main = page.locator('main').first()
  const heading = page.locator('h1, h2').filter({ visible: true }).first()

  const loadedByMainOrHeading = await Promise.race([
    main.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false),
    heading.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false),
  ])

  expect(loadedByMainOrHeading).toBeTruthy()
}

export async function assertRouteBlocked(page: any, route: string) {
  await page.goto(route, { waitUntil: 'networkidle' })
  const currentUrl = page.url()
  const requestedPath = route.split('?')[0]
  const remainedOnRoute = new RegExp(`${requestedPath.replace(/\//g, '\\/')}$`).test(currentUrl)

  if (!remainedOnRoute) {
    return
  }

  const accessDeniedHeading = page.getByRole('heading', { name: /access restricted|forbidden|unauthorized/i })
  const accessDeniedText = page.locator('text=/access.*denied|not.*authorized|forbidden|not found/i').first()
  const deniedByHeading = await accessDeniedHeading.isVisible({ timeout: 3000 }).catch(() => false)
  const deniedByText = await accessDeniedText.isVisible({ timeout: 3000 }).catch(() => false)
  expect(deniedByHeading || deniedByText).toBeTruthy()
}

export async function assertRouteLoadsOrRedirects(page: any, route: string, fallbackRoute: string) {
  await page.goto(route, { waitUntil: 'networkidle' })
  const currentUrl = page.url()
  const onPrimary = new RegExp(`${route.replace(/\//g, '\\/')}$`).test(currentUrl)
  const onFallback = new RegExp(`${fallbackRoute.replace(/\//g, '\\/')}$`).test(currentUrl)
  expect(onPrimary || onFallback).toBeTruthy()
}

export async function assertNavPathHidden(page: any, path: string) {
  const navLink = page.locator(`a[href="${path}"]`)
  await expect(navLink).toHaveCount(0)
}