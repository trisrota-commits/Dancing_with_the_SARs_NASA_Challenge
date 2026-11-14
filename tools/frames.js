// Frame counter: shows that the globe rests when nothing on it moves and
// keeps drawing while something does (fire, flood water, a storm).
//
//   python3 -m http.server 8765 &
//   node tools/frames.js           (needs Playwright; takes a few minutes)
//
// It opens the strongest live event of each kind and counts the frames the
// globe really draws. At rest and on an earthquake that has played out it
// should be about one a second (the satellite's clock); with fire or water
// on the globe it should keep drawing. Headless rendering is software-only,
// so the counts say whether frames are drawn, not how fast a real GPU is.
const { chromium } = require('playwright');
const URL = process.env.APP_URL || 'http://127.0.0.1:8765/index.html';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
(async () => {
  const browser = await chromium.launch({ proxy, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#welcome-close').click({ timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => window.app && window.app.state.incidents && window.app.state.incidents.length > 20, null, { timeout: 120000 });
  await page.evaluate(() => {
    const g = window.app.globe;
    g.spinning = false;
    window.__draws = 0;
    const render = g.renderer.render.bind(g.renderer);
    let scene = g.scene;
    g.renderer.render = (s, c) => { if (s === scene) window.__draws++; render(s, c); };
  });
  const count = async (label, ms = 3000) => {
    await page.evaluate(() => (window.__draws = 0));
    await page.waitForTimeout(ms);
    const n = await page.evaluate(() => window.__draws);
    const r = await page.evaluate(() => { const r = window.app.replay, g = window.app.globe; return `fire=${g.fire.hot.visible} vortex=${g.vortex.mesh.visible} water=${g.tiles.masked} playing=${r.playing} intro=${r.intro}`; });
    console.log(`${label.padEnd(44)} ${String(n).padStart(4)} frames in ${ms / 1000} s   ${r}`);
    return n;
  };
  await page.waitForTimeout(15000);
  await count('globe at rest, nothing selected');
  const pick = async (cat) => page.evaluate((cat) => {
    const list = window.app.state.incidents.filter((i) => i.category === cat);
    const inc = list.sort((a, b) => b.severity - a.severity)[0];
    return inc ? { id: inc.id, title: inc.title } : null;
  }, cat);
  const wrap = () => page.evaluate(() => {
    const g = window.app.globe;
    g.spinning = false;
    window.__draws = 0;
    const render = g.renderer.render.bind(g.renderer);
    g.renderer.render = (s, c) => { if (s === g.scene) window.__draws++; render(s, c); };
  });
  const picks = {};
  for (const cat of ['earthquake', 'wildfire', 'flood', 'storm', 'volcano']) picks[cat] = await pick(cat);
  for (const [cat, inc] of Object.entries(picks)) {
    if (!inc) { console.log(`no ${cat} in the feed right now`); continue; }
    await page.goto('about:blank');
    await page.goto(URL + '#event=' + encodeURIComponent(inc.id), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.app && window.app.replay.plan && window.app.replay.timeline, null, { timeout: 150000 }).catch(() => console.log('  (timeline did not open)'));
    await wrap();
    await count(`${cat}: just opened`, 2000);
    await page.waitForTimeout(20000);
    await count(`${cat}: later, standing on latest`);
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(8000);
  await count('after closing everything');
  console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'no page errors');
  await browser.close();
})();
