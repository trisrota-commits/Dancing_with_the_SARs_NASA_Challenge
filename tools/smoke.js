// Browser smoke test: loads the app in headless Chromium against the live
// services and checks the main paths for page errors.
//
//   python3 -m http.server 8765 &
//   node tools/smoke.js            (needs Playwright; no build step)
//
// In a proxied environment set HTTPS_PROXY first. It talks to real NASA,
// USGS and GDACS servers, so results change with the data of the day.

const { chromium } = require('playwright');

const URL = process.env.APP_URL || 'http://127.0.0.1:8765/index.html';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;

(async () => {
  const browser = await chromium.launch({ proxy, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push((e.stack || e.message).slice(0, 400)));
  const step = async (name, fn) => {
    try {
      console.log(`ok    ${name}: ${await fn()}`);
    } catch (e) {
      console.log(`FAIL  ${name}: ${e.message.split('\n')[0]}`);
      errors.push(`${name}: ${e.message.split('\n')[0]}`);
    }
  };

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await step('feeds load', async () => {
    await page.waitForFunction(() => +document.getElementById('event-count').textContent > 0, null, { timeout: 60000 });
    return `${await page.locator('#event-count').innerText()} events`;
  });
  await page.locator('#welcome-close').click().catch(() => {});
  // A stylesheet slip once left these rules applying on phones only.
  await step('desktop styles', async () => {
    const got = await page.evaluate(() => [getComputedStyle(document.getElementById('stories')).display, getComputedStyle(document.getElementById('share')).position].join(', '));
    if (got !== 'grid, absolute') throw new Error(`stories and share button are styled ${got}`);
    return got;
  });
  await step('reports bar', async () => (await page.locator('#ticker-text').innerText()).slice(0, 60));
  await step('story with a time-lapse', async () => {
    await page.click('[data-story="vatnajokull"]');
    await page.waitForFunction(() => document.querySelector('#lapse-chart svg'), null, { timeout: 200000 });
    return (await page.locator('.facts li').first().innerText()).replace(/\s+/g, ' ').slice(0, 90);
  });
  await step('event panel', async () => {
    await page.click('#ticker-text');
    // An event opens as a small card; the panel follows on request.
    await page.waitForSelector('#card:not([hidden]) #card-details', { timeout: 30000 });
    if (await page.locator('#right').isVisible()) throw new Error('the details panel opened without being asked');
    await page.click('#card-details');
    await page.waitForFunction(() => document.querySelector('#radar') && !document.querySelector('#radar .spinner') && document.querySelector('#story-text p'), null, { timeout: 60000 });
    return (await page.locator('#detail h3').first().innerText()).slice(0, 60);
  });
  await step('menu folds and returns', async () => {
    // The left menu steps aside while something is selected.
    if (await page.locator('#left').isVisible()) throw new Error('the menu stayed open over a selection');
    await page.click('#close');
    await page.waitForSelector('#left', { state: 'visible', timeout: 5000 });
    return 'folded while selected, back after closing';
  });
  await step('archive window', async () => {
    await page.selectOption('#window', 'nisar');
    await page.waitForFunction(() => /Events since/.test(document.getElementById('window-note').textContent), null, { timeout: 60000 });
    return `${await page.locator('#event-count').innerText()} events`;
  });
  await step('search', async () => {
    await page.fill('#search-box', 'earthquake');
    await page.waitForSelector('#search-results .hit', { timeout: 15000 });
    return `${await page.locator('#search-results .hit').count()} hits`;
  });

  console.log(errors.length ? `\n${errors.length} problem(s):\n${[...new Set(errors)].join('\n')}` : '\nNo page errors.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
