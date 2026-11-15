// Records two animated GIFs from the running app: the change detection
// ("What stood out here?") shown pass by pass on the map.
//
//   demo/img/flood-passes.gif + .jpg   the flood case (#proof-flood)
//   demo/img/rice-passes.gif  + .jpg   the rice fields of Bardhaman (#proof-crop)
//
// How to run (the app must already be served, the data comes live from NASA):
//
//   python3 tools/serve.py &                  # the app on http://127.0.0.1:8765
//   node tools/demo_gifs.js [folder] [flood|rice|both] [--assemble]
//
// [folder] takes the frames (default: /tmp/demo_gifs). `--assemble` skips the
// recording and only joins frames already in the folder. Needs Playwright with
// Chromium (`require('playwright')`) and python3 with Pillow. About two
// minutes a case in a software renderer (longer when the tiles are new).
//
// What it does:
// - Opens the case from the welcome card, closes the reports ticker, then
//   clicks each row of the pass table in turn (`#detect-slot tr[data-pass]`).
//   A click draws that pass's flagged 500 m cells on the satellite map.
// - Before each screenshot it waits until no map tile is unfinished, then
//   writes a caption bar into the page. The date and the share are read
//   from the row itself, the event date from the card's headline: nothing
//   is typed in here except the words around them.
// - The caption sits 100 px above the bottom, centred on the free map
//   between the key (left) and the map buttons and panel (right): lower,
//   it covers the timeline bar; wider than three short lines, it covers
//   the key. The script warns if it overlaps any part of the app.
// - The app flies to the area and centres it in the whole window, where
//   the caption would hide the lowest cells. For the film only, the
//   camera frames the same area in the map left free (under the note,
//   above the caption): `flyToBounds` is replaced in the page.
// - A small note says the film was assembled with an AI assistant (a rule
//   of the hackathon for AI-assisted media).
// - The frames are joined by the few lines of Python at the bottom
//   (Pillow): 1100 px wide, 1.8 s a pass, 2.6 s on the first pass after
//   the event and on the last frame, looping forever. The still (.jpg) is
//   the first pass after the event, or the last pass where there is none,
//   and the film starts on that pass and runs round from there.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OUT = args[0] || '/tmp/demo_gifs';
const WHICH = args[1] || 'both';
const ONLY_ASSEMBLE = process.argv.includes('--assemble');
const IMG = path.join(__dirname, '..', 'demo', 'img');
const WIDTH = 1100;

const CASES = {
  flood: { button: '#proof-flood', event: 'the flood was reported', marks: {} },
  // The harvest fell on the pass of 11 November 2026; said only on that row.
  rice: { button: '#proof-crop', event: '', marks: { '2026-11-11': 'the harvest' } },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

async function record(browser, name) {
  const c = CASES[name];
  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#proof:not([hidden])', { timeout: 30000 });
  await page.evaluate(() => { window.app.globe.spinning = false; });
  await page.click(c.button);
  await page.waitForSelector('#detect-slot .forecast', { timeout: 120000 });
  await page.evaluate(() => document.getElementById('ticker-close')?.click());
  const unfinished = () => page.evaluate(() => { const T = window.app.globe.tiles; return [...T.tiles.values()].filter((t) => t.mesh.visible && (t.dirty || t.topDirty || t.recalling || !t.whole)).length + T.awaited; });
  const settle = async (max) => { const t0 = Date.now(); let calm = 0; while (calm < 4 && Date.now() - t0 < max * 1000) { calm = (await unfinished()) === 0 ? calm + 1 : 0; await page.waitForTimeout(400); } return calm >= 4; };

  // The card: the event date from its headline, one row a pass.
  const card = await page.evaluate(() => {
    const slot = document.getElementById('detect-slot');
    return {
      head: slot.querySelector('.forecast strong, .forecast p')?.textContent.trim().slice(0, 300) || '',
      text: slot.textContent,
      rows: [...slot.querySelectorAll('tr[data-pass]')].map((tr) => ({
        pass: tr.dataset.pass,
        date: (tr.cells[0].textContent.match(/\d{4}-\d{2}-\d{2}/) || [''])[0],
        tags: [...tr.cells[0].querySelectorAll('.tag')].map((t) => t.textContent.trim()),
        cells: [...tr.cells].map((td) => td.textContent.trim()),
      })),
    };
  });
  const eventDate = (card.text.match(/after the event of (\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  console.log(`${name}: ${card.rows.length} passes, event ${eventDate || 'none'}; headline: ${card.head}`);

  // The caption bar and the note, both above everything in the page.
  await page.evaluate(() => {
    const bar = document.createElement('div');
    bar.id = 'gif-caption';
    bar.style.cssText = 'position:fixed;bottom:100px;transform:translateX(-50%);padding:8px 20px 10px;border-radius:10px;background:rgba(6,10,16,0.88);border:1px solid rgba(255,255,255,0.16);color:#fff;font:500 22px/1.22 Inter,system-ui,sans-serif;text-align:center;z-index:99999;pointer-events:none;white-space:nowrap';
    bar.innerHTML = '<div id="gif-line1"></div><div id="gif-when"></div><div id="gif-line2" style="font-weight:700;font-size:31px;line-height:1.25"></div>';
    const note = document.createElement('div');
    note.id = 'gif-note';
    note.textContent = 'Recorded from our app · assembled with an AI assistant';
    note.style.cssText = 'position:fixed;padding:4px 9px;border-radius:6px;background:rgba(6,10,16,0.88);color:#fff;font:500 13px/1.3 Inter,system-ui,sans-serif;z-index:99999;pointer-events:none;white-space:nowrap';
    document.body.append(bar, note);
  });
  // Placed on the free map: between the key or menu (left) and the panel (right).
  const place = () => page.evaluate(() => {
    const seen = (id) => { const el = document.getElementById(id); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? r : null; };
    const W = innerWidth;
    const bar = document.getElementById('gif-caption');
    const note = document.getElementById('gif-note');
    let left = 0, right = W;
    for (const id of ['left', 'legend', 'right', 'card', 'nav']) {
      const r = seen(id);
      if (!r) continue;
      if (r.left + r.width / 2 < W / 2) left = Math.max(left, r.right); else right = Math.min(right, r.left);
    }
    bar.style.left = `${(left + right) / 2}px`;
    const top = seen('topbar');
    const panel = seen('right');
    note.style.top = `${(top ? top.bottom : 0) + 8}px`;
    note.style.right = `${W - (panel ? panel.left : W) + 8}px`;
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const over = [];
    for (const [who, el] of [['caption', bar], ['note', note]]) {
      const r = el.getBoundingClientRect();
      if (r.left < 0 || r.right > W) over.push(`${who} leaves the window`);
      for (const id of ['topbar', 'left', 'right', 'legend', 'card', 'nav', 'replay', 'proof', 'ticker']) { const o = seen(id); if (o && hit(r, o)) over.push(`${who} over #${id}`); }
    }
    // The map left free: under the note, above the caption, between key and buttons.
    const free = { x0: left + 12, x1: right - 12, y0: note.getBoundingClientRect().bottom + 8, y1: bar.getBoundingClientRect().top - 12 };
    return { over, free };
  });

  // First click: the key appears and the camera flies there.
  await page.click(`#detect-slot tr[data-pass="${card.rows[0].pass}"]`);
  await page.waitForTimeout(4000);
  // The app centres the area in the whole window, where the caption would
  // hide its lower cells. For the film the camera frames it in the free map
  // instead: same place, looking straight down, a little further out.
  await page.evaluate((lines) => { for (const [id, t] of Object.entries(lines)) document.getElementById(id).textContent = t; }, { 'gif-line1': 'NISAR pass of 28 September 2026', 'gif-when': CASES[name].event ? 'x' : '', 'gif-line2': '0.0 % of the ground stood out' });
  const { free } = await place();
  await page.evaluate((r) => {
    const g = window.app.globe;
    const RAD = Math.PI / 180;
    g.flyToBounds = function (b) {
      const lat = (b.north + b.south) / 2, lon = (b.west + b.east) / 2;
      const tall = (b.north - b.south) * RAD, wide = (b.east - b.west) * RAD * Math.cos(lat * RAD);
      // The ground the whole window shows from top to bottom, in radians.
      const fit = Math.max((tall * this.height) / (r.y1 - r.y0), (wide * this.height) / (r.x1 - r.x0)) * 1.04;
      const alt = fit / 2 / Math.tan((this.camera.fov * RAD) / 2);
      const at = [lat - ((this.height / 2 - (r.y0 + r.y1) / 2) * fit) / this.height / RAD, lon + ((this.width / 2 - (r.x0 + r.x1) / 2) * fit) / this.height / RAD / Math.cos(lat * RAD)];
      this.controls.flyTo(at[0], at[1], alt, 1.6, { pitch: 0, heading: 0 });
      this.loadAhead(at[0], at[1], alt);
    };
  }, free);
  await page.click(`#detect-slot tr[data-pass="${card.rows[0].pass}"]`);
  await page.waitForTimeout(6000);
  if (!(await settle(180))) console.log(`${name}: WARNING the map had not settled after the flight`);
  // The panel: the pass table in view, and left there for every frame.
  await page.evaluate(() => document.querySelector('#detect-slot tr[data-pass]').closest('table').scrollIntoView({ block: 'center' }));

  const frames = [];
  for (const [i, row] of card.rows.entries()) {
    await page.click(`#detect-slot tr[data-pass="${row.pass}"]`);
    await page.waitForTimeout(2500);
    const calm = await settle(90);
    const share = row.cells[1];
    const first = row.tags.includes('after the event');
    let line1 = `NISAR pass of ${longDate(row.date)}`;
    // Where the card names an event: how far the pass lies from it, on a line of its own.
    let when = '';
    if (eventDate && c.event) {
      const n = days(row.date, eventDate);
      when = n < 0 ? `${-n} day${n === -1 ? '' : 's'} before ${c.event}` : n === 0 ? `the day ${c.event}` : `${n} day${n === 1 ? '' : 's'} after ${c.event}`;
    }
    if (c.marks[row.date]) line1 += ` · ${c.marks[row.date]}`;
    const line2 = /\d/.test(share) ? `${share.replace(/\s*%/, ' %')} of the ground stood out` : 'not judged on this pass';
    await page.evaluate(([a, w, b]) => { document.getElementById('gif-line1').textContent = a; document.getElementById('gif-when').textContent = w; document.getElementById('gif-line2').textContent = b; }, [line1, when, line2]);
    const { over } = await place();
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({ on: document.querySelector('#detect-slot tr.on')?.dataset.pass ?? null, key: document.getElementById('legend')?.textContent.trim().replace(/\s+/g, ' ').slice(0, 160) }));
    const file = `f-${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(dir, file) });
    frames.push({ file, date: row.date, share, first, line1, when, line2, cells: row.cells, tags: row.tags, calm, rowShown: state.on, key: state.key, over });
    console.log(`${name} ${i}: ${line1} | ${when} | ${line2} | row on: ${state.on} | settled: ${calm}${over.length ? ' | WARNING ' + over.join(', ') : ''}`);
  }
  fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ name, eventDate, headline: card.head, frames }, null, 1));
  await page.close();
}

// Joins the frames of one case (Pillow). Smaller than 4 MB, or it tries again with fewer colours or pixels.
const ASSEMBLE = `
import json, os, sys
from PIL import Image
folder, out, width = sys.argv[1], sys.argv[2], int(sys.argv[3])
meta = json.load(open(os.path.join(folder, 'frames.json')))
rows = meta['frames']
firsts = [i for i, r in enumerate(rows) if r['first']]
hold = set(firsts[:1]) | {len(rows) - 1}
durations = [2600 if i in hold else 1800 for i in range(len(rows))]
still = firsts[0] if firsts else len(rows) - 1
for w, colours in ((width, 256), (width, 192), (960, 256), (960, 128)):
    pics = []
    for r in rows:
        im = Image.open(os.path.join(folder, r['file'])).convert('RGB')
        pics.append(im.resize((w, round(im.height * w / im.width)), Image.LANCZOS))
    # An octree palette: a median cut loses the orange and blue of the cells,
    # which cover little of the picture, and turns them grey.
    pal = [p.quantize(colors=colours, method=Image.FASTOCTREE) for p in pics]
    # The film starts on the pass it is about and runs on round from there:
    # where a GIF is shown without playing (a slide being edited, a
    # thumbnail), its first frame is all there is to see.
    turn = list(range(still, len(rows))) + list(range(still))
    pal, timing = [pal[i] for i in turn], [durations[i] for i in turn]
    pal[0].save(out + '.gif', save_all=True, append_images=pal[1:], duration=timing, loop=0, optimize=True, disposal=1)
    size = os.path.getsize(out + '.gif')
    if size < 4_000_000: break
pics[still].save(out + '.jpg', quality=86, optimize=True)
print(f"{out}.gif: {len(rows)} frames, {w} px, {colours} colours, {size / 1e6:.2f} MB, durations {durations}; still = frame {still} ({rows[still]['date']}), {os.path.getsize(out + '.jpg') / 1e3:.0f} kB")
`;

(async () => {
  const names = WHICH === 'both' ? ['flood', 'rice'] : [WHICH];
  if (!ONLY_ASSEMBLE) {
    const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
    const browser = await chromium.launch({ proxy, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    for (const name of names) await record(browser, name);
    await browser.close();
  }
  for (const name of names) console.log(execFileSync('python3', ['-c', ASSEMBLE, path.join(OUT, name), path.join(IMG, `${name}-passes`), String(WIDTH)], { encoding: 'utf8' }).trim());
})().catch((e) => { console.error(e); process.exit(1); });
