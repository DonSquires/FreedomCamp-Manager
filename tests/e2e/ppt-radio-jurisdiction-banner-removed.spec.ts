import { test, expect } from '@playwright/test';
import { loginAs } from './auth';

test.describe('PTT Radio - JurisdictionBanner Removal', () => {
  test('Mobile: JurisdictionBanner removed, no Provider Tactical Mode or handshake message', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 393, height: 851 });
    
    // Authenticate as officer
    await loginAs(page, 'officerOrg1');
    
    // Navigate to PTT Radio
    await page.goto('/radio', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="ptt-main-button"]', { timeout: 10000 });
    
    // Verify banners are NOT present
    const jurisdictionBannerExists = await page.locator('text=Provider Tactical Mode').isVisible().catch(() => false);
    const handshakeMessageExists = await page.locator('text=No active zone').isVisible().catch(() => false);
    
    expect(jurisdictionBannerExists).toBe(false);
    expect(handshakeMessageExists).toBe(false);
    
    // Capture screenshot
    await page.screenshot({ path: 'test-results/ppt-radio-mobile-jurisdiction-removed.png', fullPage: true });
  });

  test('Desktop: JurisdictionBanner removed, no Provider Tactical Mode or handshake message', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 });
    
    // Authenticate as officer
    await loginAs(page, 'officerOrg1');
    
    // Navigate to PTT Radio
    await page.goto('/radio', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="ptt-main-button"]', { timeout: 10000 });
    
    // Verify banners are NOT present
    const jurisdictionBannerExists = await page.locator('text=Provider Tactical Mode').isVisible().catch(() => false);
    const handshakeMessageExists = await page.locator('text=No active zone').isVisible().catch(() => false);
    
    expect(jurisdictionBannerExists).toBe(false);
    expect(handshakeMessageExists).toBe(false);
    
    // Capture screenshot
    await page.screenshot({ path: 'test-results/ppt-radio-desktop-jurisdiction-removed.png', fullPage: true });
  });
});
