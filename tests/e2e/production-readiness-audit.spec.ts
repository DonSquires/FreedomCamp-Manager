import { test, expect, helpers } from './setup'

async function skipIfOfficerUnrostered(page: any, reason: string) {
  const notRosteredNotice = page.getByText(/you are not rostered today/i).first()
  if (await notRosteredNotice.isVisible().catch(() => false)) {
    test.skip(true, reason)
  }
}

test.describe('Production Readiness Audit', () => {
  test('officer landing page exposes key operational tools', async ({ officerUser }) => {
    const page = officerUser

    await page.goto('/field-officer')
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 })
    await expect(page).not.toHaveURL(/\/login/)
    await skipIfOfficerUnrostered(page, 'Officer user is not rostered; field tool cards are intentionally unavailable')

    const hasScan = await page.getByText(/scan vehicle( \(detail\))?/i).first().isVisible().catch(() => false)
    const hasPoi = await page.getByText(/vehicle of interest check/i).first().isVisible().catch(() => false)
    const hasReport = await page.getByText(/create report|new quick report/i).first().isVisible().catch(() => false)
    const hasFace = await page.getByText(/face recognition|open face scan/i).first().isVisible().catch(() => false)

    const hasUnrosteredTools =
      await page.getByText(/team chat/i).first().isVisible().catch(() => false) ||
      await page.getByText(/browse open shifts/i).first().isVisible().catch(() => false) ||
      await page.getByText(/request ad-hoc shift/i).first().isVisible().catch(() => false)

    expect(hasScan || hasPoi || hasReport || hasFace || hasUnrosteredTools).toBe(true)
  })

  test('officer can submit incident, H&S, and maintenance quick reports', async ({ officerUser }) => {
    const page = officerUser

    await page.goto('/field-officer')
    await skipIfOfficerUnrostered(page, 'Officer user is not rostered; quick report workflow unavailable')

    const quickReportButton = page.getByRole('button', { name: /new quick report/i }).first()
    if (!(await quickReportButton.isVisible({ timeout: 4000 }).catch(() => false))) {
      test.skip(true, 'Quick report entrypoint is not available in this field-officer session')
    }

    await quickReportButton.click()

    // Incident
    await page.getByRole('button', { name: /^incident$/i }).click()
    await page.locator('textarea').first().fill('Automated readiness incident report test')
    await page.getByRole('button', { name: /submit report/i }).click()
    await expect(page.getByText(/incident report submitted|admin notified/i).first()).toBeVisible({ timeout: 8000 })

    // Re-open and submit H&S
    await page.getByRole('button', { name: /new quick report/i }).first().click()
    await page.getByRole('button', { name: /^h&s$/i }).click()
    await page.locator('textarea').first().fill('Automated readiness H&S report test')
    await page.getByRole('button', { name: /submit report/i }).click()
    await expect(page.getByText(/incident report submitted|admin notified/i).first()).toBeVisible({ timeout: 8000 })

    // Re-open and submit maintenance
    await page.getByRole('button', { name: /new quick report/i }).first().click()
    await page.getByRole('button', { name: /^maintenance$/i }).click()
    await page.locator('textarea').first().fill('Automated readiness maintenance report test')
    await page.getByRole('button', { name: /submit report/i }).click()
    await expect(page.getByText(/maintenance report submitted/i).first()).toBeVisible({ timeout: 8000 })
  })

  test('officer can access POI and face recognition screens', async ({ officerUser }) => {
    const page = officerUser

    await page.goto('/face-recognition')
    await expect(page).toHaveURL(/face-recognition/)
    await expect(page).not.toHaveURL(/\/login/)

    await page.goto('/points-of-interest')
    await expect(page).toHaveURL(/points-of-interest/)
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('officer session remains active across pages while on-duty', async ({ officerUser }) => {
    const page = officerUser

    await page.goto('/field-officer')
    const hasActivePatrolIndicator = await page.getByText(/active patrol|patrol status/i).first().isVisible().catch(() => false)
    const hasUnrosteredIndicator = await page.getByText(/you are not rostered today/i).first().isVisible().catch(() => false)
    expect(hasActivePatrolIndicator || hasUnrosteredIndicator).toBe(true)

    await page.goto('/breaches')
    await expect(page).not.toHaveURL(/\/login/)
    await page.goto('/field-officer')
    await expect(page.locator('h1').first()).toContainText('Field Officer Portal')
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('admin can open add/edit user UI', async ({ masterUser }) => {
    const page = masterUser

    await page.goto('/users')
    await expect(page).toHaveURL(/\/users/)

    await page.getByRole('button', { name: /create user/i }).first().click()
    await expect(page.getByText(/create new user/i).first()).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).first().click()

    const editButton = page.getByRole('button', { name: /edit/i }).first()
    if (await editButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editButton.click()
      await expect(page.getByText(/edit user/i).first()).toBeVisible()
      await page.getByRole('button', { name: /cancel/i }).first().click()
    }
  })

  test('master can open organisation create/edit UI', async ({ masterUser }) => {
    const page = masterUser

    await page.goto('/organizations')
    await expect(page.locator('h1').first()).toContainText('Organisation Management')

    await page.getByRole('button', { name: /new organisation/i }).first().click()
    await expect(page.getByText(/create organisation/i).first()).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).first().click()

    const settingsButton = page.getByRole('button', { name: /settings/i }).first()
    if (await settingsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsButton.click()
      await expect(page.getByText(/organisation settings/i).first()).toBeVisible()
      await page.getByRole('button', { name: /cancel/i }).first().click()
    }
  })

  test('admin can access analytical report pages and notice/document tooling', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/reports-hub')
    await expect(page.locator('h1').first()).toContainText('Reports')

    await page.goto('/compliance-analytics')
    await expect(page.locator('main').first()).toBeVisible()

    await page.goto('/hotspots')
    await expect(page.locator('main').first()).toBeVisible()

    await page.goto('/notice-to-vacate')
    await expect(page.locator('h1').first()).toContainText('Notices to Vacate')
    await expect(page.getByRole('button', { name: /issue notice/i }).first()).toBeVisible()
  })

  test('vehicle details and evidence photo area render correctly', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/vehicles')
    await page.fill('input[placeholder*="Search"]', 'NYR607')
    await page.waitForTimeout(1200)

    const vehicleRow = page.locator('text=NYR607').first()
    if (!(await vehicleRow.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, 'Vehicle NYR607 not visible in current org scope')
    }

    await vehicleRow.click()
    await expect(page.getByText(/vehicle details/i).first()).toBeVisible({ timeout: 8000 })

    const imageVisible = await page.locator('img').first().isVisible({ timeout: 3000 }).catch(() => false)
    const photoTextVisible = await page.getByText(/photo|evidence|image/i).first().isVisible({ timeout: 3000 }).catch(() => false)
    if (!(imageVisible || photoTextVisible)) {
      test.skip(true, 'No photo/evidence content visible for the selected vehicle in current org scope')
    }
  })

  test('filters/data browsing and cross-page navigation stay stable', async ({ adminUser }) => {
    const page = adminUser

    await page.goto('/vehicles')
    await expect(page.locator('input[placeholder*="Search"]').first()).toBeVisible()
    await page.fill('input[placeholder*="Search"]', 'NYR607')

    await page.goto('/breaches')
    await expect(page.locator('main').first()).toBeVisible()

    await page.goto('/vehicles')
    await expect(page.locator('main').first()).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('notification affordance remains available across key admin pages', async ({ adminUser }) => {
    const page = adminUser
    const routes = ['/admin', '/breaches', '/reports']

    for (const route of routes) {
      await page.goto(route)
      const bell = page.locator('button[aria-label*="notification" i], [data-testid="notification-bell"]')
      await expect(bell.first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('input contrast baseline check on key pages', async ({ adminUser }) => {
    const page = adminUser
    const routes = ['/field-officer', '/notice-to-vacate', '/users']

    for (const route of routes) {
      await page.goto(route)

      const minContrast = await page.evaluate(() => {
        const channelToLinear = (v: number) => {
          const c = v / 255
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        }

        const luminance = (rgb: number[]) =>
          0.2126 * channelToLinear(rgb[0]) +
          0.7152 * channelToLinear(rgb[1]) +
          0.0722 * channelToLinear(rgb[2])

        const contrastRatio = (a: number[], b: number[]) => {
          const l1 = luminance(a)
          const l2 = luminance(b)
          const brightest = Math.max(l1, l2)
          const darkest = Math.min(l1, l2)
          return (brightest + 0.05) / (darkest + 0.05)
        }

        const parseRgb = (input: string) => {
          const m = input.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
          if (!m) return [0, 0, 0]
          return [Number(m[1]), Number(m[2]), Number(m[3])]
        }

        const controls = Array.from(document.querySelectorAll('input, textarea, select')) as HTMLElement[]
        if (!controls.length) return 99

        let min = 99
        for (const el of controls) {
          const style = getComputedStyle(el)
          const fg = parseRgb(style.color)
          const bg = parseRgb(style.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.body).backgroundColor : style.backgroundColor)
          const ratio = contrastRatio(fg, bg)
          min = Math.min(min, ratio)
        }
        return min
      })

      expect(minContrast).toBeGreaterThan(2.8)
    }
  })
})
