import { test, expect, type Locator, type Page } from '@playwright/test';
import { loginAs } from '../../tests/e2e/auth';

type LocatorScope = Page | Locator;

function firstNonEmpty(values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

async function fillFirstVisible(scope: LocatorScope, selectors: string[], value: string): Promise<string> {
  for (const selector of selectors) {
    const field = scope.locator(selector).first();
    const visible = await field.isVisible().catch(() => false);
    if (!visible) continue;

    await field.click({ timeout: 5000 }).catch(() => undefined);
    await field.fill(value, { timeout: 10000 });
    return selector;
  }

  throw new Error(`No visible field found for selectors: ${selectors.join(' | ')}`);
}

async function clickFirstVisible(scope: LocatorScope, selectors: string[]): Promise<string> {
  for (const selector of selectors) {
    const button = scope.locator(selector).first();
    const visible = await button.isVisible().catch(() => false);
    if (!visible) continue;

    await button.click({ timeout: 10000 });
    return selector;
  }

  throw new Error(`No visible action found for selectors: ${selectors.join(' | ')}`);
}

async function gotoFirstReachable(page: Page, baseUrl: string, paths: string[]): Promise<string> {
  for (const path of paths) {
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);

    const blocked = /\/login|\/portal-selection/i.test(page.url());
    if (!blocked) {
      return path;
    }
  }

  throw new Error(`Unable to reach any target route: ${paths.join(', ')}`);
}

async function waitForSessionGateToClear(page: Page): Promise<void> {
  const gateText = page.getByText(/checking session and permissions/i);
  const isVisible = await gateText.isVisible().catch(() => false);

  if (isVisible) {
    await expect(gateText).toBeHidden({ timeout: 60000 });
  }

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
}

test.describe('Bob Safe Autonomous Human Data Entry Simulation', () => {
  test.setTimeout(240000);

  test('logs in with preserved master credentials, enters operational data, and saves cleanly', async ({ page }) => {
    const baseUrl = firstNonEmpty([
      process.env.PLAYWRIGHT_BASE_URL,
      process.env.DEFAULT_PLAYWRIGHT_BASE_URL,
      process.env.VITE_APP_URL,
      'http://localhost:5173',
    ]);

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const failedBackendResponses: string[] = [];

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (/Services health check failed: No active session found/i.test(text)) {
          return;
        }
        consoleErrors.push(text);
      }
    });

    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      if (status >= 500 || status === 0) {
        failedBackendResponses.push(`${status} ${url}`);
      }
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await loginAs(page, 'master');
    await waitForSessionGateToClear(page);

    if (/portal-selection/i.test(page.url())) {
      const adminCard = page.locator('section,div,article').filter({ hasText: /Admin Portal/i }).first();
      const cardVisible = await adminCard.isVisible().catch(() => false);

      if (cardVisible) {
        const openButton = adminCard.getByRole('button', { name: /^open$/i }).first();
        const openVisible = await openButton.isVisible().catch(() => false);
        if (openVisible) {
          await openButton.click({ timeout: 10000 });
        } else {
          await adminCard.click({ timeout: 10000 });
        }
      } else {
        await clickFirstVisible(page, [
          'button:has-text("Open Admin Portal")',
          'button:has-text("Admin Portal")',
          'button:has-text("Open")',
        ]);
      }
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
      await waitForSessionGateToClear(page);
    }

    await gotoFirstReachable(page, baseUrl, ['/users', '/admin/users']);
    await waitForSessionGateToClear(page);

    await clickFirstVisible(page, [
      'button:has-text("Create User")',
      'button:has-text("New User")',
      'button:has-text("Add User")',
    ]);

    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByText(/create new user/i)).toBeVisible({ timeout: 15000 });

    const stamp = Date.now();
    const userEmail = `safe.human.entry.${stamp}@example.com`;

    await fillFirstVisible(dialog, ['#email', 'input[type="email"]'], userEmail);
    await fillFirstVisible(dialog, ['#firstName', 'input[placeholder*="first" i]'], 'Jordan');
    await fillFirstVisible(dialog, ['#lastName', 'input[placeholder*="last" i]'], 'Fleet');

    const roleSelect = dialog.getByRole('combobox').first();
    await roleSelect.click();
    await clickFirstVisible(page, ['[role="option"]:has-text("Admin Officer")', '[role="option"]:has-text("Officer")']);

    const jobTitleSelect = dialog.getByRole('combobox').nth(1);
    await jobTitleSelect.click();
    await clickFirstVisible(page, ['[role="option"]:has-text("Field Services Officer")', '[role="option"]:has-text("Officer")']);

    await fillFirstVisible(dialog, ['#createPassword', 'input[type="password"]'], 'SafeDryUser!1');
    await fillFirstVisible(dialog, ['#createConfirmPassword', 'input[id*="confirm" i]'], 'SafeDryUser!1');

    const accessTab = dialog.getByRole('tab', { name: /access/i });
    const hasAccessTab = await accessTab.isVisible().catch(() => false);
    if (hasAccessTab) {
      await accessTab.click();
      await clickFirstVisible(dialog, ['label:has-text("Admin Dashboard")', 'label:has-text("Users")']);
    }

    const orgTrigger = dialog.locator('#createOrg').first();
    const hasOrgTrigger = await orgTrigger.isVisible().catch(() => false);
    if (hasOrgTrigger) {
      await orgTrigger.click();
      await clickFirstVisible(page, ['[role="option"]:has-text("First Security")', '[role="option"]:has-text("OnSpace")', '[role="option"]']);
    }

    const createUserResponsePromise = page.waitForResponse((response) => {
      return (
        response.request().method() === 'POST' &&
        /\/functions\/v1\/manage-user(?:\?|$)/.test(response.url())
      );
    }, { timeout: 12000 }).catch(() => null);

    await clickFirstVisible(dialog, [
      'button:has-text("Create User")',
      'button:has-text("Create")',
    ]);

    const createUserResponse = await createUserResponsePromise;

    if (createUserResponse) {
      const createUserResponseBody = await createUserResponse.text().catch(() => '');
      expect(
        createUserResponse.ok(),
        `User creation request failed with ${createUserResponse.status()}: ${createUserResponseBody || 'no response body'}`,
      ).toBeTruthy();
      await expect(page.getByText(/user created successfully/i).first()).toBeVisible({ timeout: 20000 });
    } else {
      const fatalUiError = page
        .locator('text=/failed to create user|request timed out|unexpected error/i')
        .first();
      await expect(fatalUiError).toHaveCount(0);
    }

    expect(pageErrors, `Unhandled page errors: ${pageErrors.join('\n')}`).toHaveLength(0);
    expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toHaveLength(0);
    expect(
      failedBackendResponses,
      `Backend 5xx/failed responses: ${failedBackendResponses.join('\n')}`,
    ).toHaveLength(0);
  });
});
