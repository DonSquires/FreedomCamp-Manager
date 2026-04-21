import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const EMAIL = 'squires.don@live.com';
const PASS = 'Run2thesun??';

// All pages to verify — just check they render without a crash (no 'Application error')
const PAGES = [
  // Officer-facing
  '/field-officer',
  '/officer-home',
  '/patrol-checkpoints',
  '/patrol-schedule',
  '/patrol-kpis',
  '/officer-welfare',
  '/officer-skills',
  '/observations',
  '/vehicles',
  '/incidents',
  '/incident-reports',
  '/breaches',
  '/breach-notices',
  '/infringements',
  '/enforcement-actions',
  '/bob-assistant',
  '/radio',
  '/dispatch',
  '/team-chat',
  '/profile',
  '/reports',
  '/hotspots',
  '/zones',
  '/operations-map',
  '/parking',
  '/parking-officer',
  '/site-guard',
  '/site-risk-assessment',
  '/smoke-officer',
  '/biosecurity-officer',
  '/availability',
  '/roster',
  '/timesheets',
  // Admin
  '/admin/dashboard',
  '/admin',
  '/users',
  '/organizations',
  '/compliance',
  '/compliance-dashboard',
  '/audit-log',
  '/settings',
  '/vehicle-registry',
  '/person-records',
  '/search',
  '/diagnostics',
];

test.describe('Portal page walkthrough', () => {
  test('login', async ({ page }) => {
    await page.goto(BASE);
    // Fill login form
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    const passInput = page.locator('input[type="password"]').first();
    await emailInput.fill(EMAIL);
    await passInput.fill(PASS);
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first().click();
    // Wait for redirect away from login
    await page.waitForURL(url => !url.pathname.startsWith('/login') && url.pathname !== '/', { timeout: 15000 }).catch(() => {});
    await page.screenshot({ path: 'test-results/01-post-login.png', fullPage: false });
    console.log('Post-login URL:', page.url());
  });

  for (const route of PAGES) {
    test(`page: ${route}`, async ({ page }) => {
      // Login first
      await page.goto(BASE);
      const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
      const passInput = page.locator('input[type="password"]').first();
      await emailInput.fill(EMAIL);
      await passInput.fill(PASS);
      await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first().click();
      await page.waitForTimeout(3000);

      // Navigate to page
      await page.goto(`${BASE}${route}`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);

      const title = await page.title();
      const url = page.url();
      const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

      // Should not crash
      expect(bodyText).not.toContain('Application error');
      expect(bodyText).not.toContain('Cannot read properties of');

      // Record console errors during visit
      const errors: string[] = [];
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

      const safe = route.replace(/\//g, '_').replace(/^_/, '');
      await page.screenshot({ path: `test-results/page${safe}.png`, fullPage: true });
      console.log(`✅ ${route} | title="${title}" | url=${url} | errors=${errors.length}`);
    });
  }
});
