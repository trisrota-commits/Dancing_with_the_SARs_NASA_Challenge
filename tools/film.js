// Films the app: the 30-second demo of the lead case (rice fields of
// Bardhaman), shot frame by frame.
//
//   python3 tools/serve.py &            # the app on http://127.0.0.1:8765
//   node tools/film.js [folder]         # frames into <folder> (default: film/)
//   ffmpeg -y -framerate 30 -i film/f-%04d.jpg -c:v libx264 -preset slow \
//     -crf 19 -pix_fmt yuv420p -movflags +faststart demo.mp4
//
// Needs Playwright with Chromium (`require('playwright')`) and ffmpeg.
// Takes about six minutes for 30 seconds of film.
//
// How it works, and what was learnt making it (15 November 2026):
// - The page's clock is taken over (`page.clock`): each frame steps it
//   1/30 s and then takes a screenshot. The film is smooth however slowly
//   the machine draws, so it can be shot without a graphics card
//   (about 0.3 s a frame in a software renderer).
// - Anything that waits on the network does so in real time, between
//   frames. So tiles appear to load faster in the film than they do live.
//   The film therefore says nothing about speed.
// - The place is visited once off camera first ("warm"), so that on
//   camera it is as on a second visit: sharp at once.
// - Scenes are `shoot(seconds, each)`; `each(t)` runs before every frame
//   with t from 0 to 1 (used for smooth scrolling of the panel). Scroll
//   quickly (1.5 s) and then hold, or the reader never sees the target.
// - Captions go into a bar injected into the page, set per scene. Keep it
//   104 px above the bottom: lower, it sits on the timeline bar. CSS
//   transitions run on real time, not on the stepped clock, so opacity is
//   set directly.
// - One plain sentence a scene; no claim the app cannot back (no "first",
//   no "predicts"; numbers as the panel shows them).
// - After changing the panel or the layers, look at a contact sheet of
//   frames before joining them: the target of a scroll is easily cut off.
// - To film another case, change the scenes below; the helpers stay.
const { chromium } = require('playwright');
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const FPS = 30;
const OUT = process.argv[2] || 'film';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ proxy, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#welcome-close').click({ timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => window.app && document.getElementById('date').value && window.app.globe.dots.items.length > 5, null, { timeout: 60000 });
  const unfinished = () => page.evaluate(() => { const T = window.app.globe.tiles; return [...T.tiles.values()].filter((t) => t.mesh.visible && (t.dirty || t.topDirty || t.recalling || !t.whole)).length + T.awaited; });
  const settle = async (max) => { const t0 = Date.now(); for (let calm = 0; calm < 3 && Date.now() - t0 < max * 1000;) { calm = (await unfinished()) === 0 ? calm + 1 : 0; await page.waitForTimeout(200); } };
  // ---- off camera: go there once, so the place is as it is on a second visit ----
  const home = await page.evaluate(() => { const c = window.app.globe.controls; window.app.globe.spinning = false; return { lat: c.lat, lon: c.lon, alt: c.alt }; });
  await page.evaluate(() => document.querySelector('[data-site="west-bengal"]').click());
  await page.waitForSelector('#detect-slot .forecast', { timeout: 90000 });
  await page.waitForTimeout(3000); await settle(120);
  await page.locator('#measured-map').click(); await page.waitForTimeout(5000); await settle(60);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.evaluate((h) => { const g = window.app.globe; g.flyTo(18, 78, h.alt * 6371000); }, home);
  await page.waitForTimeout(4000); await settle(90);
  console.log('warmed:', await page.evaluate(() => { const T = window.app.globe.tiles; return `kept ${T.kept.size}, panel open: ${!!document.querySelector('#detail')?.textContent.trim()}, alt ${Math.round(window.app.globe.controls.alt * 6371)} km`; }));
  // ---- the caption bar ----
  await page.evaluate(() => { const bar = document.createElement('div'); bar.id = 'film-caption'; bar.style.cssText = 'position:fixed;left:50%;bottom:104px;transform:translateX(-50%);max-width:820px;padding:10px 18px;border-radius:10px;background:rgba(6,10,16,0.82);border:1px solid rgba(255,255,255,0.14);color:#fff;font:500 19px/1.35 Inter,system-ui,sans-serif;text-align:center;z-index:9999;opacity:0;pointer-events:none;letter-spacing:0.1px'; document.body.append(bar); });
  const caption = (text) => page.evaluate((t) => { const b = document.getElementById('film-caption'); b.textContent = t || ''; b.style.opacity = t ? '1' : '0'; }, text);
  // ---- from here the page's clock is ours ----
  await page.clock.install(); await page.clock.pauseAt(Date.now() + 500);
  let n = 0; const t0 = Date.now();
  const shoot = async (seconds, each) => { const frames = Math.round(seconds * FPS); for (let i = 0; i < frames; i++) { if (each) await each(i / Math.max(1, frames - 1)); await page.clock.runFor(1000 / FPS); await page.screenshot({ path: `${OUT}/f-${String(n++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 93 }); } };
  const ease = (t) => t * t * (3 - 2 * t);
  const scrollTo = async (selector, offset = 0) => page.evaluate(([sel, off]) => { const el = document.querySelector(sel); let box = el; while (box && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement; if (!box) return null; window.__box = box; return { from: box.scrollTop, to: Math.max(0, Math.min(box.scrollHeight - box.clientHeight, box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - off)) }; }, [selector, offset]);
  const scroll = (from, to) => (t) => page.evaluate(([a, b, k]) => { window.__box.scrollTop = a + (b - a) * k; }, [from, to, ease(t)]);

  // 1. The whole planet, turning.
  await page.evaluate(() => { window.app.globe.spinning = true; });
  await caption("The whole planet as NASA's NISAR radar sees it: 48 days of passes, the newest on top");
  await shoot(4.2);
  // 2. To the rice fields.
  await page.evaluate(() => { window.app.globe.spinning = false; document.querySelector('[data-site="west-bengal"]').click(); });
  await caption('One place through time: the rice fields of Bardhaman, West Bengal');
  await shoot(4.6);
  // 3. The measurements.
  let s = await scrollTo('#measured-slot', 8);
  await caption("Measured from NISAR's calibrated data: twelve passes through one crop season");
  await shoot(2.2, s && scroll(s.from, s.to));
  await caption('Flooded paddies in July, standing rice in October, the harvest in November');
  await shoot(3.6);
  // 4. The change map.
  await page.evaluate(() => document.getElementById('measured-map').click());
  await caption('Orange: where the radar echo grew stronger from June to October');
  await shoot(5.0);
  // 5. The prediction check.
  s = await scrollTo('#forecast-slot', 6);
  await caption('Could the next pass have been predicted? Tested field by field, with its error');
  await shoot(2.4, s && scroll(s.from, s.to));
  s = await scrollTo('#forecast-slot .forecast-table:last-of-type', 40);
  await caption('While the rice grew, almost every field stayed in the expected range. At the harvest, 16 % did not');
  await shoot(1.5, s && scroll(s.from, s.to));
  await shoot(3.1);
  // 6. Back out.
  await page.keyboard.press('Escape');
  await page.evaluate((h) => { window.app.globe.flyTo(18, 78, h.alt * 6371000); }, home);
  await caption('Dancing with the SARs · any place on Earth · open source, live NASA data');
  await shoot(3.4);
  console.log(`${n} frames (${(n / FPS).toFixed(1)} s of film) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  await browser.close();
})();
