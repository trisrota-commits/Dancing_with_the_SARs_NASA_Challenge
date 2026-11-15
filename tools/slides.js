// Makes the PDF of the seven demo slides (demo/index.html): one slide a
// page, 1920 x 1080, as the browser prints them.
//
//   python3 tools/serve.py &        # the app on http://127.0.0.1:8765
//   node tools/slides.js            # writes demo/dancing-with-the-sars-slides.pdf
//
// Needs Playwright with Chromium. The pictures in demo/img/ are
// screenshots of the running app; retake them when the app changes.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = path.join(__dirname, '..', 'demo', 'dancing-with-the-sars-slides.pdf');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://127.0.0.1:8765/demo/index.html', { waitUntil: 'networkidle' });
  const missing = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')));
  if (missing.length) throw new Error(`pictures missing: ${missing.join(', ')}`);
  await page.pdf({ path: out, width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
  // A picture of each slide as well, to look at before sending the PDF.
  if (process.argv[2]) {
    const n = await page.locator('.slide').count();
    for (let i = 1; i <= n; i++) {
      await page.goto(`http://127.0.0.1:8765/demo/index.html#${i}`);
      await page.reload({ waitUntil: 'networkidle' });
      await page.screenshot({ path: path.join(process.argv[2], `slide-${i}.png`) });
    }
  }
  await browser.close();
  console.log('written', out);
})();
