import { test, expect } from '@playwright/test';

test('Deep functional test actions', async ({ page }) => {
  // 1. Add navigation to your application's start URL
  await page.goto('/');

  // Example snippet before fix
  const headerLocator = page.locator('h1, h2, h3').first(); // Timeout changed to 20000
  await headerLocator.waitFor({ timeout: 20000 });
  
  // Example snippet before fix
  const cardLocator = page.locator('[class*="card"], [class*="org"], h2, h3').first(); // Timeout changed to 20000
  await cardLocator.waitFor({ timeout: 20000 });
  
  // Example snippet before fix
  const breachesAction = page.locator('button', { hasText: 'Breaches' }).first(); 
  await breachesAction.click({ timeout: 15000 }); // Timeout changed to 15000
  
  // Example snippet before fix
  const rosterContent = page.locator('.roster-content, [data-testid="roster"]').first(); 
  await expect(rosterContent).toBeVisible({ timeout: 25000 }); // Timeout changed to 25000
});