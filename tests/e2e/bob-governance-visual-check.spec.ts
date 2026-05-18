import { expect, test } from '@playwright/test'
import { loginAs } from './auth'

const hasAdminCreds = !!(process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL)

test.describe('Bob governance visual checks', () => {
  test('renders governance gate status strip badges', async ({ page }) => {
    test.skip(!hasAdminCreds, 'Admin credentials not configured')

    await loginAs(page, 'adminOrg1')
    await page.goto('/bob-assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.getByText('Gate Status', { exact: true })).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Proposal submitted', { exact: true })).toBeVisible()
    await expect(page.getByText('Awaiting approver', { exact: true })).toBeVisible()
    await expect(page.getByText('Approved', { exact: true })).toBeVisible()
    await expect(page.getByText('Blocked', { exact: true })).toBeVisible()
  })

  test('renders execution review decision context and confidence framing', async ({ page }) => {
    test.skip(!hasAdminCreds, 'Admin credentials not configured')

    await page.route('**/functions/v1/onspace-ai-chat*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: 'Governance review complete. Request blocked by emergency gate.',
          executionReview: {
            policyMode: 'master_balanced',
            currentRoute: '/bob-assistant',
            matchedRoutes: ['/bob-assistant'],
            requestedMutationContract: 'create_client_site',
            mutationAccess: {
              allowed: false,
              reason: 'Contract not permitted in this policy mode.',
              reasonCode: 'policy_contract_not_allowed',
            },
            emergencyGate: {
              active: true,
              blocked: true,
              reasonCode: 'emergency_priority_active',
              reason: 'Emergency-priority workflow is active.',
            },
            decisionReasonCodes: ['policy_contract_not_allowed', 'emergency_priority_active'],
            confidence: {
              commandBus: 0.66,
              gateDecision: 0.99,
              composite: 0.858,
            },
          },
        }),
      })
    })

    await loginAs(page, 'adminOrg1')
    await page.goto('/bob-assistant', { waitUntil: 'domcontentloaded' })

    const composer = page.locator('textarea[placeholder*="Ask Bob anything operational"]')
    await composer.fill('Create a new client site while emergency mode is active')
    await composer.press('Enter')

    await expect(page.getByText(/Execution Review/)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/master_balanced/)).toBeVisible()
    await expect(page.getByText('Gate reason: policy_contract_not_allowed')).toBeVisible()
    await expect(page.getByText('Decision codes: policy_contract_not_allowed, emergency_priority_active')).toBeVisible()
    await expect(page.getByText(/Confidence: composite 86%/)).toBeVisible()
  })
})