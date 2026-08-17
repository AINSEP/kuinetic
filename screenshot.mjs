import { chromium } from 'playwright-core';
import { fileURLToPath } from 'url';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  
  // Go to dev server root
  await page.goto('http://localhost:8934/');
  await page.waitForLoadState('networkidle');
  
  await page.screenshot({ path: 'screenshot-desktop.png' });
  
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'screenshot-mobile.png' });
  
  await browser.close();
  console.log('Screenshots saved.');
})();
