import { test, expect, type Locator, type Page } from '@playwright/test'
import { loginAs } from './auth'

function slug(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

async function chooseOptionByComboboxIndex(scope: Locator, index: number, optionName: RegExp) {
  await scope.getByRole('combobox').nth(index).click()
  await scope.page().getByRole('option', { name: optionName }).first().click({ force: true })
}

async function createDispatchJob(page: Page, jobTypeLabel: RegExp, title: string) {
  await expect(page.getByTestId('console-title')).toBeVisible({ timeout: 15000 })

  const dialog = page.getByRole('dialog').filter({ hasText: /new dispatch job/i }).first()
  const dialogAlreadyOpen = await dialog.isVisible({ timeout: 1000 }).catch(() => false)

  if (!dialogAlreadyOpen) {
    const newJobTrigger = page.getByTestId('dispatch-new-job-button')
    const hasStableTrigger = await newJobTrigger.isVisible({ timeout: 5000 }).catch(() => false)
    if (hasStableTrigger) {
      await newJobTrigger.click()
    } else {
      await page.getByRole('button', { name: /new job/i }).click()
    }
  }

  await expect(dialog).toBeVisible({ timeout: 10000 })

  await chooseOptionByComboboxIndex(dialog, 0, jobTypeLabel)
  await dialog.locator('input[placeholder*="Brief job description"]').first().fill(title)

  await page.keyboard.press('Escape').catch(() => undefined)
  await dialog.getByRole('button', { name: /^create job$/i }).click({ force: true })

  const toastVisible = await page.getByText(/job created/i).first().isVisible({ timeout: 8000 }).catch(() => false)
  if (!toastVisible) {
    const createdTitleVisible = await page.getByText(title, { exact: false }).first().isVisible({ timeout: 15000 }).catch(() => false)
    const dialogClosed = await dialog.isHidden({ timeout: 5000 }).catch(() => false)
    expect(createdTitleVisible || dialogClosed).toBe(true)
  }
}

async function gotoWithLoginRecovery(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45000 })
  if (/\/login(?:\?|$|#)/i.test(page.url())) {
    await loginAs(page, 'master')
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45000 })
  }
}

test.describe('Human-emulated live dispatch chain', () => {
  test.describe.configure({ mode: 'serial' })

  test('service provider to patrol/dispatch chain surfaces disconnects', async ({ page }) => {
    test.setTimeout(180000)
    const findings: string[] = []
    const createdOrgName = `SP E2E ${slug('org')}`
    const createdSiteName = `E2E Site ${slug('site')}`

    const alarmTitle = `Alarm ${slug('alarm')}`
    const noiseTitle = `Noise ${slug('noise')}`
    const bioTitle = `Biosecurity ${slug('bio')}`
    const freedomTitle = `Freedom Camping ${slug('freedom')}`

    await loginAs(page, 'master')

    await test.step('Create organisation from UI', async () => {
      await gotoWithLoginRecovery(page, '/organizations')
      await expect(page).not.toHaveURL(/\/login/)

      await page.getByRole('button', { name: /new organisation/i }).click()
      const dialog = page.getByRole('dialog').filter({ hasText: /new organisation/i }).first()
      await expect(dialog).toBeVisible({ timeout: 10000 })

      await dialog.locator('#createName').fill(createdOrgName)
      await dialog.locator('#createOrgType').click()
      await page.getByRole('option', { name: /client/i }).first().click()
      await dialog.getByRole('button', { name: /create organisation/i }).click()

      await expect(page.getByText(/organisation created successfully/i).first()).toBeVisible({ timeout: 15000 })
      await expect(page.getByText(createdOrgName).first()).toBeVisible({ timeout: 15000 })
    })

    await test.step('Create client site in the new organisation', async () => {
      await gotoWithLoginRecovery(page, '/client-sites')
      await expect(page).not.toHaveURL(/\/login/)

      // Scope to the organisation just created.
      await page.getByRole('combobox').first().click()
      await page.getByRole('option', { name: new RegExp(createdOrgName, 'i') }).first().click()

      await page.getByRole('button', { name: /add site/i }).click()
      const dialog = page.getByRole('dialog').filter({ hasText: /add client site/i }).first()
      await expect(dialog).toBeVisible({ timeout: 10000 })

      await dialog.locator('input').first().fill(createdSiteName)
      await dialog.getByRole('button', { name: /^create site$/i }).click()

      await expect(page.getByText(/site created/i).first()).toBeVisible({ timeout: 15000 })
      await expect(page.getByText(createdSiteName).first()).toBeVisible({ timeout: 15000 })
    })

    await test.step('Create patrol run/schedule (or capture blocker)', async () => {
      await gotoWithLoginRecovery(page, '/patrol-schedule')
      await expect(page).not.toHaveURL(/\/login/)

      await page.getByRole('button', { name: /create patrol schedule/i }).first().click()
      const dialog = page.getByRole('dialog').filter({ hasText: /create patrol schedule/i }).first()
      await expect(dialog).toBeVisible({ timeout: 10000 })

      const zoneCombo = dialog.getByRole('combobox').nth(1)
      await zoneCombo.click()
      const availableZone = page.getByRole('option').filter({ hasText: /.+/ }).first()
      const hasZone = await availableZone.isVisible({ timeout: 3000 }).catch(() => false)

      if (!hasZone) {
        findings.push('Patrol schedule cannot be created: no selectable zone options are available.')
        await page.keyboard.press('Escape').catch(() => undefined)
      } else {
        await availableZone.click()
        await dialog.getByRole('button', { name: /create & send/i }).click()

        const patrolCreated = await page.getByText(/patrol (created|scheduled)/i).first().isVisible({ timeout: 10000 }).catch(() => false)
        if (!patrolCreated) {
          findings.push('Patrol schedule submit did not show a success toast; patrol run creation may be disconnected.')
        }
      }
    })

    await test.step('Create alarm/noise/biosecurity/freedom jobs in dispatch UI', async () => {
      await gotoWithLoginRecovery(page, '/dispatch')
      await expect(page).not.toHaveURL(/\/login/)

      await createDispatchJob(page, /alarm response/i, alarmTitle)
      await createDispatchJob(page, /noise complaint/i, noiseTitle)
      await createDispatchJob(page, /biosecurity inspection/i, bioTitle)
      await createDispatchJob(page, /freedom camping/i, freedomTitle)

      const alarmTypeError = page.getByText(/could not find the 'alarm_type' column of 'dispatch_jobs' in the schema cache/i)
      const hasAlarmTypeError = await alarmTypeError.isVisible({ timeout: 2000 }).catch(() => false)
      if (hasAlarmTypeError) {
        findings.push('Dispatch create still emits schema cache error for dispatch_jobs.alarm_type.')
      }
    })

    await test.step('Create attendance entry in EMS UI', async () => {
      await gotoWithLoginRecovery(page, '/ems')
      await expect(page).not.toHaveURL(/\/login/)

      await page.getByRole('button', { name: /new attendance/i }).click()
      const dialog = page.getByRole('dialog').filter({ hasText: /log ems attendance/i }).first()
      await expect(dialog).toBeVisible({ timeout: 10000 })

      try {
        await chooseOptionByComboboxIndex(dialog, 0, /installation|field_visit|maintenance|inspection/i)
        await dialog.locator('input[type="time"]').first().fill('09:00')
        await dialog.getByRole('button', { name: /submit attendance/i }).click()

        const attendanceOk = await page.getByText(/ems attendance submitted/i).first().isVisible({ timeout: 15000 }).catch(() => false)
        if (!attendanceOk) {
          findings.push('EMS attendance submit did not confirm success.')
        }
      } catch (e) {
        findings.push(`EMS attendance combobox options unavailable or not interactable: ${(e as Error).message.split('\n')[0]}`)
        // Close dialog if still open
        await page.keyboard.press('Escape').catch(() => {})
      }
    })

    await test.step('Verify jobs are received by patrol/dispatch surfaces', async () => {
      await gotoWithLoginRecovery(page, '/dispatch-monitor')
      await expect(page).not.toHaveURL(/\/login/)

      const expectedTitles = [alarmTitle, noiseTitle, bioTitle, freedomTitle]
      for (const title of expectedTitles) {
        const visible = await page.getByText(title, { exact: false }).first().isVisible({ timeout: 10000 }).catch(() => false)
        if (!visible) {
          findings.push(`Dispatch monitor missing expected job title: ${title}`)
        }
      }
    })

    if (findings.length > 0) {
      test.info().annotations.push({ type: 'disconnects', description: findings.join(' | ') })
    }

    expect(findings, `Disconnects found:\n- ${findings.join('\n- ')}`).toEqual([])
  })
})
