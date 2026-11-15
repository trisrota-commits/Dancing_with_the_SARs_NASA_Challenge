// Makes the PDF of the seven demo slides (demo/index.html): one slide a
// page, 16:9.
//
//   python3 tools/serve.py &        # the app on http://127.0.0.1:8765
//   node tools/slides.js [folder]   # writes demo/dancing-with-the-sars-slides.pdf
//                                   # and, with a folder, a picture of each slide
//
// Needs Playwright with Chromium.
//
// Each page of the PDF is a picture of the slide, not text. Printing the
// page as text looked wrong in several PDF readers (15 November 2026):
// Chromium embeds the slides' font (Inter, an OpenType font) as "Type 3"
// glyphs, and readers space those badly, so letters ran into each other.
// A picture looks the same everywhere. The price: the text cannot be
// selected and the link on the last slide cannot be clicked, so that
// address is written out on the slide.
//
// Animated pictures (GIFs) cannot play in a PDF: an <img data-still="...">
// is swapped for its still picture first. The slides as a web page
// (demo/index.html, once the site is hosted) show the animations.
//
// The pictures in demo/img/ are screenshots of the running app and
// animations made from its data (tools/demo_gifs.js, tools/explain_gif.py);
// retake them when the app changes.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const out = path.join(__dirname, '..', 'demo', 'dancing-with-the-sars-slides.pdf');
  const keep = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5 });
  await page.goto('http://127.0.0.1:8765/demo/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.getElementById('nav').style.display = 'none';
    for (const img of document.querySelectorAll('img[data-still]')) img.src = img.dataset.still;
  });
  await page.waitForLoadState('networkidle');
  // Swapped pictures may still be on their way: wait for each, up to 30 s.
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth), null, { timeout: 30000 }).catch(() => {});
  const missing = await page.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute('src')));
  if (missing.length) throw new Error(`pictures missing: ${missing.join(', ')}`);
  const n = await page.locator('.slide').count();
  const shots = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate((k) => document.querySelectorAll('.slide').forEach((s, j) => s.classList.toggle('on', j === k)), i);
    // Text that runs out of its slide is a fault of the slide: say so.
    const over = await page.evaluate((k) => {
      const s = document.querySelectorAll('.slide')[k];
      const box = s.getBoundingClientRect();
      const foot = s.querySelector('.foot').getBoundingClientRect();
      return [...s.querySelectorAll('h1, h2, p, li, td, th, figcaption, img')]
        .filter((el) => !el.closest('.foot'))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width && (r.bottom > foot.top + 2 || r.right > box.right + 2)).length;
    }, i);
    if (over) console.log(`slide ${i + 1}: ${over} element(s) run into the footer or off the slide`);
    const shot = await page.screenshot({ type: 'jpeg', quality: 92 });
    shots.push(shot.toString('base64'));
    if (keep) fs.writeFileSync(path.join(keep, `slide-${i + 1}.jpg`), shot);
  }
  const sheet = await browser.newPage();
  await sheet.setContent(
    `<style>@page { size: 1920px 1080px; margin: 0 } html, body { margin: 0; background: #05090f } img { display: block; width: 1920px; height: 1080px; break-after: page }</style>` +
      shots.map((b) => `<img src="data:image/jpeg;base64,${b}">`).join(''),
  );
  await sheet.pdf({ path: out, width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
  await browser.close();
  console.log(`written ${out}: ${n} slides, ${Math.round(fs.statSync(out).size / 1024)} kB`);
})();
