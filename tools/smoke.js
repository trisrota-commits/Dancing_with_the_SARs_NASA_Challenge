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
    // The menu may be folded, so the count is read from the page itself.
    return `${await page.evaluate(() => document.getElementById('event-count').textContent)} events`;
  });
  await step('opening card comes back', async () => {
    // Every visit starts with the card and the menu folded.
    await page.waitForSelector('#welcome', { state: 'visible', timeout: 5000 });
    if (await page.locator('#left').isVisible()) throw new Error('the menu is open at the start');
    await page.click('#welcome-story');
    await page.waitForSelector('#right', { state: 'visible', timeout: 10000 });
    await page.click('#close');
    await page.waitForSelector('#welcome', { state: 'visible', timeout: 5000 });
    // "Explore the globe" ends that and shows the menu, every section folded.
    await page.click('#welcome-close');
    await page.waitForSelector('#left', { state: 'visible', timeout: 5000 });
    const open = await page.locator('#left details[open]').count();
    if (open) throw new Error(`${open} menu sections start unfolded`);
    return 'card back after ✕, menu shown with every section folded after "Explore the globe"';
  });
  // A stylesheet slip once left these rules applying on phones only.
  await step('desktop styles', async () => {
    const got = await page.evaluate(() => [getComputedStyle(document.getElementById('stories')).display, getComputedStyle(document.getElementById('share')).position].join(', '));
    if (got !== 'grid, absolute') throw new Error(`stories and share button are styled ${got}`);
    return got;
  });
  await step('reports bar', async () => (await page.locator('#ticker-text').innerText()).slice(0, 60));
  await step('story with a time-lapse', async () => {
    await page.click('#left summary:has-text("More stories")');
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
  await step('menu keeps out of the way', async () => {
    // The menu folds away for anything that is opened.
    if (await page.locator('#left').isVisible()) throw new Error('the menu stayed open over a selection');
    // ✕ on the details steps back to the card; ✕ on the card lets go.
    await page.click('#close');
    await page.waitForSelector('#card:not([hidden])', { timeout: 5000 });
    if (await page.locator('#right').isVisible()) throw new Error('the details stayed open');
    await page.click('#card-close');
    await page.waitForTimeout(600);
    if (await page.locator('#left').isVisible()) throw new Error('the menu came back by itself');
    if (await page.locator('#welcome').isVisible()) throw new Error('the opening card came back after "Explore the globe"');
    // Its button opens it; pressing anything outside folds it.
    await page.click('#menu');
    await page.waitForSelector('#left', { state: 'visible', timeout: 5000 });
    await page.mouse.click(900, 400);
    await page.waitForSelector('#left', { state: 'hidden', timeout: 5000 });
    // With the details open, the menu takes their place.
    await page.click('#ticker-text');
    await page.waitForSelector('#card:not([hidden]) #card-details', { timeout: 30000 });
    await page.click('#card-details');
    await page.waitForSelector('#right', { state: 'visible', timeout: 5000 });
    await page.click('#menu');
    await page.waitForSelector('#left', { state: 'visible', timeout: 5000 });
    if (await page.locator('#right').isVisible()) throw new Error('the menu and the details are open side by side');
    await page.click('#card-close');
    // The title brings the opening card back.
    await page.click('#home');
    await page.waitForSelector('#welcome', { state: 'visible', timeout: 5000 });
    await page.click('#welcome-close');
    return 'folds for a selection, stays folded, opens by its button, folds on an outside press, never beside the details; title shows the opening card';
  });
  await step('show more', async () => {
    await page.click('#ticker-more');
    await page.waitForSelector('#right', { state: 'visible', timeout: 5000 });
    const rows = await page.locator('#detail .links li').count();
    if (rows < 5) throw new Error(`only ${rows} lines in the list`);
    const title = await page.locator('#detail .links li span').first().innerText();
    await page.locator('#detail .links li').first().click();
    await page.waitForFunction(() => !document.getElementById('card').hidden || !document.getElementById('right').hidden, null, { timeout: 30000 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    return `${rows} lines, first: ${title.slice(0, 50)}`;
  });
  await step('archive window', async () => {
    // The period is chosen in the menu, under "Events on the map".
    await page.click('#menu');
    await page.click('#left summary:has-text("Events on the map")');
    await page.selectOption('#window', 'nisar');
    await page.waitForFunction(() => /Events since/.test(document.getElementById('window-note').textContent), null, { timeout: 60000 });
    // The menu may be folded, so the count is read from the page itself.
    return `${await page.evaluate(() => document.getElementById('event-count').textContent)} events`;
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
