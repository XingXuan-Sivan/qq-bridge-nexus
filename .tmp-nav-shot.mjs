import { chromium } from 'playwright-core';
import { startConsoleFixture } from './scripts/console-ui-fixture.mjs';
const fixture = await startConsoleFixture();
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(fixture.url + '/#behaviors');
await page.waitForFunction(() => document.querySelector('main section[data-page="behaviors"]')?.dataset.pageReady === '1', null, { timeout: 8000 });
await page.waitForTimeout(300);
const info = await page.evaluate(() => ({
  icons: [...document.querySelectorAll('#mainNav .nav-item')].map((b) => ({ v: b.dataset.view, icon: b.querySelector('.nav-icon')?.textContent, w: Math.round(b.querySelector('.nav-icon')?.getBoundingClientRect().width) })),
  title: document.getElementById('pageTitle')?.textContent,
  crumb: document.querySelector('.crumb-current')?.textContent,
  h2: document.querySelector('main section[data-page="behaviors"] h2')?.textContent,
}));
console.log(JSON.stringify(info));
await page.screenshot({ path: '.tmp-shots/40-nav.png' });
await browser.close();
await fixture.close();
