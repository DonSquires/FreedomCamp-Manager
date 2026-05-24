import { test, expect, type Locator, type Page } from '@playwright/test';

type LocatorScope = Page | Locator;

function firstNonEmpty(values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function requireEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  throw new Error(`Missing required env. Tried: ${keys.join(', ')}`);
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

    const blocked = /\/login/i.test(page.url());
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

async function waitForBootstrapToClear(page: Page): Promise<void> {
  const splash = page.getByText(/preparing the freedom camp enforcement workspace/i);
  const splashVisible = await splash.isVisible().catch(() => false);
  if (splashVisible) {
    await expect(splash).toBeHidden({ timeout: 90000 });
  }
}

test.describe('Bob Autonomous Human Data Entry Simulation', () => {
  test.setTimeout(300000);

  test('types login and provisions location + employee from UI only', async ({ page, context }) => {
    const baseUrl = firstNonEmpty([
      process.env.PLAYWRIGHT_BASE_URL,
      process.env.DEFAULT_PLAYWRIGHT_BASE_URL,
      process.env.VITE_APP_URL,
      'http://localhost:5173',
    ]);

    const email = requireEnv('PLAYWRIGHT_MASTER_EMAIL', 'PLAYWRIGHT_ADMIN_ORG1_EMAIL', 'PLAYWRIGHT_TEST_EMAIL');
    const password = requireEnv('PLAYWRIGHT_MASTER_PASSWORD', 'PLAYWRIGHT_ADMIN_ORG1_PASSWORD', 'PLAYWRIGHT_TEST_PASSWORD');

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const failedBackendResponses: string[] = [];

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (/Services health check failed: No active session found/i.test(text)) return;
      consoleErrors.push(text);
    });

    page.on('response', (response) => {
      const status = response.status();
      if (status >= 500 || status === 0) {
        failedBackendResponses.push(`${status} ${response.url()}`);
      }
    });

    await context.clearCookies();
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await waitForBootstrapToClear(page);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);

    await fillFirstVisible(page, ['input[type="email"]', '#email', 'input[name="email"]'], email);
    await fillFirstVisible(page, ['input[type="password"]', '#password', 'input[name="password"]'], password);
    await clickFirstVisible(page, [
      'button:has-text("Sign In")',
      'button:has-text("Login")',
      'button:has-text("Log in")',
      'button[type="submit"]',
    ]);

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
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
      await waitForSessionGateToClear(page);
    }

    const locationName = `Automation Yard ${Date.now()}`;
    await gotoFirstReachable(page, baseUrl, ['/locations', '/admin/locations', '/camp-locations']);

    await clickFirstVisible(page, [
      'button:has-text("Add Location")',
      'button:has-text("Create Location")',
      'button:has-text("New Location")',
    ]);

    const locationDialog = page.getByRole('dialog').first();
    const locationScope: LocatorScope = (await locationDialog.isVisible().catch(() => false)) ? locationDialog : page;

    await fillFirstVisible(locationScope, [
      'input[name="name"]',
      '#name',
      'input[placeholder*="location" i]',
    ], locationName);

    await fillFirstVisible(locationScope, [
      'input[name="address"]',
      '#address',
      'input[placeholder*="address" i]',
    ], '123 Wharf Road, Nelson');

    await fillFirstVisible(locationScope, [
      'input[name="latitude"]',
      '#latitude',
      'input[placeholder*="lat" i]',
    ], '-41.2706');

    await fillFirstVisible(locationScope, [
      'input[name="longitude"]',
      '#longitude',
      'input[placeholder*="lng" i]',
      'input[placeholder*="lon" i]',
    ], '173.2840');

    await clickFirstVisible(locationScope, [
      'button:has-text("Save")',
      'button:has-text("Create")',
      'button[type="submit"]',
    ]);

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
    const locationVisible = await page.getByText(locationName, { exact: false }).first().isVisible().catch(() => false);
    expect(locationVisible, `Expected location ${locationName} to be visible after save`).toBeTruthy();

    await gotoFirstReachable(page, baseUrl, ['/users', '/admin/users']);

    await clickFirstVisible(page, [
      'button:has-text("Create User")',
      'button:has-text("New User")',
      'button:has-text("Add User")',
    ]);

    const userDialog = page.getByRole('dialog').first();
    const employeeEmail = `human.emulation.${Date.now()}@example.com`;

    await fillFirstVisible(userDialog, ['#email', 'input[type="email"]'], employeeEmail);
    await fillFirstVisible(userDialog, ['#firstName', 'input[placeholder*="first" i]'], 'Taylor');
    await fillFirstVisible(userDialog, ['#lastName', 'input[placeholder*="last" i]'], 'Operator');

    const roleSelect = userDialog.getByRole('combobox').first();
    await roleSelect.click();
    await clickFirstVisible(page, ['[role="option"]:has-text("Admin Officer")', '[role="option"]:has-text("Officer")']);

    await fillFirstVisible(userDialog, ['#createPassword', 'input[type="password"]'], 'SafeDryUser!1');
    await fillFirstVisible(userDialog, ['#createConfirmPassword', 'input[id*="confirm" i]'], 'SafeDryUser!1');

    await clickFirstVisible(userDialog, [
      'button:has-text("Create User")',
      'button:has-text("Create")',
    ]);

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);

    const userCreatedToast = page.getByText(/user created successfully/i).first();
    const userVisible = await userCreatedToast.isVisible().catch(() => false);
    expect(userVisible, 'Expected successful user creation signal in UI').toBeTruthy();

    expect(pageErrors, `Unhandled page errors: ${pageErrors.join('\n')}`).toHaveLength(0);
    expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toHaveLength(0);
    expect(failedBackendResponses, `Backend 5xx/failed responses: ${failedBackendResponses.join('\n')}`).toHaveLength(0);
  });
});
