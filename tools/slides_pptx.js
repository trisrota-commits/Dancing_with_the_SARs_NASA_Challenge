// Makes the PowerPoint file of the seven demo slides, with the animations
// in it: demo/dancing-with-the-sars-slides.pptx
//
//   npm install pptxgenjs            # once (not part of the app)
//   python3 tools/serve.py &         # the app on http://127.0.0.1:8765
//   node tools/slides_pptx.js
//
// Needs Playwright with Chromium, like tools/slides.js.
//
// Why a PowerPoint file as well as the PDF: a PDF cannot play a GIF. In a
// .pptx an animated GIF plays in PowerPoint's slide show, in Keynote and in
// Google Slides (upload the file to Google Drive, open it with Google
// Slides, share it as "anyone with the link can view": that link needs no
// login and the animations run in the browser).
//
// How: every slide of demo/index.html is photographed without its animated
// pictures and becomes the slide's background, so it looks exactly like
// the web page whatever fonts the reader has. Each animated picture is then
// laid over the place it has on the page, as the GIF itself. The team's
// name and members on slide 1 are a real text box, so that they can be
// changed in PowerPoint or Google Slides without rebuilding anything, each
// member on a line of their own. The
// words of every slide are also in its speaker notes, for search and for
// screen readers.
const { chromium } = require('playwright');
const pptxgen = require('pptxgenjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

const W = 1920;
const H = 1080;
const INCH = 13.333 / W; // LAYOUT_WIDE is 13.333 in by 7.5 in
(async () => {
  const demo = path.join(__dirname, '..', 'demo');
  const out = path.join(demo, 'dancing-with-the-sars-slides.pptx');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5 });
  await page.goto('http://127.0.0.1:8765/demo/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.getElementById('nav').style.display = 'none';
    // The animations and the team's lines are put on as real objects.
    for (const el of document.querySelectorAll('img[data-still], .who')) el.style.visibility = 'hidden';
  });
  const n = await page.locator('.slide').count();
  const slides = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate((k) => document.querySelectorAll('.slide').forEach((s, j) => s.classList.toggle('on', j === k)), i);
    const info = await page.evaluate((k) => {
      const s = document.querySelectorAll('.slide')[k];
      const o = s.getBoundingClientRect();
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
      };
      const who = s.querySelector('.who');
      return {
        gifs: [...s.querySelectorAll('img[data-still]')].map((img) => ({ ...box(img), src: img.getAttribute('src'), alt: img.alt })),
        who: who && { ...box(who), team: s.querySelector('#team-name').textContent, members: [...s.querySelectorAll('#team-members li')].map((li) => ({ name: li.querySelector('b').textContent, rest: li.textContent.slice(li.querySelector('b').textContent.length) })) },
        words: s.innerText.replace(/\n{2,}/g, '\n').trim(),
        label: s.getAttribute('aria-label'),
      };
    }, i);
    const file = path.join(tmp, `slide-${i + 1}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    slides.push({ ...info, file });
  }
  await browser.close();

  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = 'Dancing with the SARs';
  pres.subject = 'NASA Space Apps Challenge 2026: Dancing with the SARs';
  for (const s of slides) {
    const slide = pres.addSlide();
    slide.background = { path: s.file };
    for (const g of s.gifs) {
      slide.addImage({ path: path.join(demo, g.src), x: g.x * INCH, y: g.y * INCH, w: g.w * INCH, h: g.h * INCH, altText: g.alt, objectName: `Animation: ${path.basename(g.src)}` });
    }
    if (s.who) {
      // The team and each member's part, as text that can be edited.
      const runs = [
        { text: 'Team: ', options: { bold: true, color: 'FFFFFF' } },
        { text: s.who.team, options: { color: 'A9B6C6', breakLine: true } },
      ];
      s.who.members.forEach((m, k) => {
        runs.push({ text: m.name, options: { bold: true, color: 'FFFFFF' } });
        runs.push({ text: m.rest, options: { color: 'A9B6C6', breakLine: k < s.who.members.length - 1 } });
      });
      slide.addText(runs, { x: s.who.x * INCH, y: s.who.y * INCH, w: s.who.w * INCH + 0.3, h: (s.who.h + 12) * INCH, fontFace: 'Arial', fontSize: 13, lineSpacingMultiple: 1.3, margin: 0, valign: 'top', isTextBox: true, objectName: 'Team and members' });
    }
    slide.addNotes(s.words);
  }
  // The library also writes the folders themselves into the file; files
  // like that have failed to open through cloud services. Only the parts
  // are kept.
  const JSZip = require('jszip'); // comes with pptxgenjs
  const made = await JSZip.loadAsync(await pres.write({ outputType: 'nodebuffer' }));
  const clean = new JSZip();
  for (const [name, part] of Object.entries(made.files)) {
    if (!part.dir) clean.file(name, await part.async('nodebuffer'), { createFolders: false });
  }
  fs.writeFileSync(out, await clean.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`written ${out}: ${slides.length} slides, ${slides.reduce((a, s) => a + s.gifs.length, 0)} animations, ${Math.round(fs.statSync(out).size / 1024)} kB`);
})();
