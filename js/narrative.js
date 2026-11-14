// The words about an event: one plain text that explains it and names every
// source it draws on as a link, a one-line NISAR summary for the popup, and
// a small timeline of the event against NISAR's passes.
//
// Nothing here is free writing. Each sentence is a fixed template filled
// from the feeds and the NISAR catalogue, and a sentence only appears when
// its data has arrived.

import { CATEGORIES, FEEDS, RELATED_KM, RELATED_DAYS, WHO_USES } from './config.js';
import { nextPass, bestPair, REPEAT_DAYS } from './nisar.js';

const DAY = 86400_000;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const date = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const clock = (ms) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
const many = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function span(ms) {
  const hours = Math.round(Math.abs(ms) / 3600_000);
  return hours < 24 ? many(Math.max(1, hours), 'hour') : many(Math.round(hours / 24), 'day');
}

function list(parts) {
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '';
}

// A source named in the text. Hovering explains it; clicking opens the
// part of the panel that holds what was taken from it.
const link = (source, label, section) => `<a href="#${section}" class="src" data-src="${source}" data-open="${section}">${esc(label)}</a>`;

// What each source is, for the hover box.
export const SOURCE_NOTES = {
  usgs: 'U.S. Geological Survey. Earthquake time, place, magnitude and shaking maps, updated every minute.',
  eonet: "NASA's Earth Observatory Natural Event Tracker. Curated natural events and storm tracks.",
  gdacs: 'Global Disaster Alert and Coordination System, run by the UN and the EU. Alert levels, affected areas and linked news.',
  nisar: 'The NASA-ISRO radar satellite. Passes and preview images come live from NASA’s archive at the Alaska Satellite Facility.',
  news: 'Press articles: written by news outlets, not checked by this app.',
  linked: 'Other events from the same feeds, close in place and time.',
  replay: 'Every part of what is drawn on the globe for this event, with its source and whether it is observed, agency analysis or computed here.',
};

const passesAround = (inc, found) => {
  const all = found.backscatter;
  const before = all.filter((s) => s.time < inc.time).sort((a, b) => b.time - a.time);
  const after = all.filter((s) => s.time >= inc.time).sort((a, b) => a.time - b.time);
  return { all, before, after };
};

// What a change in the two radar channels is typical of: textbook rules of
// thumb for L-band radar, applied to the values of two passes. The result
// is a hypothesis and is labelled as one. The kind of event plays no part,
// so the reading cannot simply echo what the feeds already said.
const CLEAR_STEP = 25; // of 255: smaller differences are not read at all

export function channelReading(before, after, pol) {
  if (before.cross == null || after.cross == null || !pol?.cross) return null;
  const co = after.co - before.co;
  const cross = after.cross - before.cross;
  const signed = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`;
  const moved = `${esc(pol.co)} changed by ${signed(co)} and ${esc(pol.cross)} by ${signed(cross)}`;
  const up = (v) => v >= CLEAR_STEP;
  const down = (v) => v <= -CLEAR_STEP;
  let reading;
  if (!up(co) && !down(co) && !up(cross) && !down(cross)) return `Between these two passes ${moved}: too little to read anything into.`;
  if (down(co) && down(cross)) reading = 'Both channels fell, which is typical of open water covering the ground, of wet snow, or of vegetation that was burnt, cut or harvested. The two values cannot tell these apart.';
  else if (up(co) && up(cross)) reading = 'Both channels rose, which is typical of growing vegetation, wetter soil, rougher ground, or snow that froze again. The two values cannot tell these apart.';
  else if (down(cross)) reading = `The twisted echo (${esc(pol.cross)}) fell while the straight one held, which is typical of lost leaves and branches: burning, clearing or harvest.`;
  else if (up(cross)) reading = `The twisted echo (${esc(pol.cross)}) rose while the straight one held, which is typical of vegetation growing in.`;
  else if (up(co)) reading = `The straight echo (${esc(pol.co)}) rose while the twisted one held, which is typical of water standing among plants or buildings, where the pulse bounces twice.`;
  else reading = `The straight echo (${esc(pol.co)}) fell while the twisted one held, which is typical of ground that became smoother, or of calm water where plants are sparse.`;
  return `<span class="badge computed">Hypothesis</span> ${moved}. ${reading} This is a rule of thumb applied to two preview values, not a finding.`;
}

// One line for the popup.
export function nisarLine(inc, found) {
  if (!found) return 'Checking what NISAR has seen here…';
  if (found.failed) return 'The NISAR archive could not be searched just now.';
  const { all, before, after } = passesAround(inc, found);
  if (!all.length) return 'NISAR has not imaged this spot around the event.';
  if (before.length && after.length) return `NISAR imaged this place ${span(inc.time - before[0].time)} before and ${span(after[0].time - inc.time)} after.`;
  const est = nextPass(found.newest?.length ? found.newest : all);
  const next = est ? ` Next pass expected around ${shortDate(est.time)}.` : '';
  if (before.length) return `NISAR last imaged this place ${span(inc.time - before[0].time)} before the event.${next}`;
  return `NISAR first imaged this place ${span(after[0].time - inc.time)} after the event began.${next}`;
}

// The text for the details panel, as HTML paragraphs.
// given: { found, news, history, sizeText }; each may still be missing.
export function narrate(inc, { found, news, history, sizeText }) {
  const out = [];

  // What happened, when, and who says so.
  const feeds = [...new Set(inc.reports.map((r) => r.source))];
  const lasting = inc.endTime - inc.time > 6 * 3600_000;
  const fresh = Date.now() - inc.endTime < 2 * DAY;
  let p = `<b>${esc(inc.title)}.</b> `;
  p += lasting
    ? `It was first reported on ${date(inc.time)} and last updated on ${date(inc.endTime)}, ${span(inc.endTime - inc.time)} later${fresh ? ', so it may still be going on' : ''}.`
    : `It happened on ${date(inc.time)} at ${clock(inc.time)}.`;
  if (sizeText) p += ` Reported size: ${esc(sizeText)}.`;
  p += ` This comes from ${list(feeds.map((f) => link(f, FEEDS[f].label, 'sec-reports')))}${feeds.length > 1 ? ', whose reports the app merged into one event' : ''}.`;
  out.push(p);

  // What NISAR has seen.
  const nisar = link('nisar', 'NISAR', 'sec-nisar');
  if (!found) {
    out.push(`Searching the ${nisar} archive for passes over this place…`);
  } else if (found.failed) {
    out.push(`The ${nisar} archive could not be searched just now, so nothing can be said here about what the radar saw. Selecting the event again repeats the search.`);
  } else {
    const { all, before, after } = passesAround(inc, found);
    let n;
    if (!all.length && !found.interferograms.length) {
      n = `${nisar}, the radar satellite this app is built around, has not imaged this spot in the weeks around the event. It comes round every ${REPEAT_DAYS} days, and open ocean is mostly not imaged.`;
    } else {
      n = `${nisar}, the radar satellite this app is built around, imaged this place ${many(all.length, 'time')} around the event: ${before.length} before and ${after.length} after.`;
      if (before.length) n += ` The last pass before it was on ${date(before[0].time)}, ${span(inc.time - before[0].time)} earlier`;
      if (before.length) n += after.length ? `, and the first after it on ${date(after[0].time)}, ${span(after[0].time - inc.time)} later.` : '; there has been no pass since.';
      else if (after.length) n += ` The first pass was on ${date(after[0].time)}, ${span(after[0].time - inc.time)} after the event began.`;
      const pair = bestPair(all, inc.time, true, inc);
      if (pair) n += ` Two passes on the same track, ${shortDate(pair.before.time)} and ${shortDate(pair.after.time)}, let the app show ${link('nisar', 'what changed between them', 'sec-nisar')}.`;
      if (found.interferograms.some((g) => g.refTime < inc.time && g.secTime > inc.time)) n += ` An ${link('nisar', 'interferogram', 'sec-nisar')} spans the event and shows how the ground moved.`;
    }
    const est = nextPass(found.newest?.length ? found.newest : all);
    if (est) n += ` The next overpass is expected around ${date(est.time)}; that is an estimate from the ${REPEAT_DAYS}-day repeat cycle, not a schedule.`;
    out.push(n);
  }
  if (history) {
    // The pass just before the event against the first one after it, when
    // this track has both; otherwise the range over all its passes.
    const pts = history.points;
    const before = pts.filter((q) => q.time < inc.time).pop();
    const after = pts.find((q) => q.time >= inc.time);
    const low = pts.reduce((a, b) => (b.co < a.co ? b : a));
    const high = pts.reduce((a, b) => (b.co > a.co ? b : a));
    const read = (q) => `${Math.round(q.co)} on ${shortDate(q.time)}`;
    let h = `At this exact spot the radar echo (${esc(history.pol)}) `;
    h += before && after
      ? `read ${read(before)}, the last pass on this track before the event, and ${read(after)}, the first one after it. Over ${pts.length} passes it ranged from ${read(low)} to ${read(high)}.`
      : `ranged from ${read(low)} to ${read(high)} over ${pts.length} passes.`;
    h += ` ${link('nisar', 'See every pass in the chart', 'sec-nisar')}. These are values from NASA's preview pictures, on a scale of 0 to 255, not calibrated measurements.`;
    out.push(h);
    // Which channel moved says something about why.
    const reading = before && after ? channelReading(before, after, history.pols) : null;
    if (reading) out.push(reading);
  }

  // Press, neighbours, and how the animation is made.
  const rest = [];
  if (news) {
    if (news.articles.length) {
      const top = news.articles[0];
      rest.push(
        `${many(news.articles.length, 'press article')} ${news.via === 'gdacs' ? `${news.articles.length === 1 ? 'is' : 'are'} linked to this event by GDACS` : `turned up in a search of the GDELT news index`}; the latest is “${esc(top.title)}”${top.source ? ` (${esc(top.source)})` : ''}. ${link('news', 'Read the coverage', 'sec-news')}.`,
      );
    } else {
      rest.push('No press coverage was found for this event.');
    }
  }
  if (inc.related.length) rest.push(`${many(inc.related.length, 'other event')} ${inc.related.length === 1 ? 'lies' : 'lie'} within ${RELATED_KM} km and ${RELATED_DAYS} days; ${link('linked', 'see them', 'sec-linked')}.`);
  rest.push(`What is drawn on the globe for this event comes only from data; ${link('replay', 'see what each part is', 'sec-replay')}.`);
  out.push(rest.join(' '));

  // Who this is for. Ours to say, and marked so.
  const who = Object.hasOwn(WHO_USES, inc.category) ? WHO_USES[inc.category] : WHO_USES.other;
  out.push(`<span class="badge">Our view</span> Who could use NISAR here? ${esc(who)}`);

  return out.map((text) => `<p>${text}</p>`).join('');
}

// The event against NISAR's passes, as a small picture.
export function timeline(inc, found, now = Date.now()) {
  const W = 348;
  const H = 86;
  const LEFT = 50;
  const RIGHT = 10;
  const passes = found ? found.backscatter.map((s) => s.time) : [];
  const est = found ? nextPass(found.newest?.length ? found.newest : found.backscatter) : null;
  const first = Math.min(inc.time, ...passes);
  const last = Math.max(now, inc.endTime, est ? est.time : 0);
  const pad = Math.max(2 * DAY, (last - first) * 0.05);
  const t0 = first - pad;
  const t1 = last + pad;
  const x = (t) => LEFT + ((t - t0) / (t1 - t0)) * (W - LEFT - RIGHT);
  const color = CATEGORIES[inc.category].color;
  const start = x(inc.time);
  const end = Math.max(start + 4, x(inc.endTime));
  const lasting = inc.endTime - inc.time > DAY;
  // The date label stays inside the picture.
  const flip = start > W - 110;
  const labelStart = flip ? Math.min(W - RIGHT, end) : Math.max(LEFT, start);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline: the event from ${date(inc.time)}${lasting ? ` to ${date(inc.endTime)}` : ''}, with ${passes.length} NISAR passes${est ? ` and the next one expected on ${date(est.time)}` : ''}">`;
  svg += `<text x="0" y="33" class="row">Event</text><text x="0" y="57" class="row">NISAR</text>`;
  svg += `<line x1="${LEFT}" x2="${W - RIGHT}" y1="29" y2="29" class="rail" /><line x1="${LEFT}" x2="${W - RIGHT}" y1="53" y2="53" class="rail" />`;
  svg += `<line x1="${x(now).toFixed(1)}" x2="${x(now).toFixed(1)}" y1="18" y2="66" class="today" /><text x="${Math.min(W - 34, x(now) - 14).toFixed(1)}" y="80" class="tick">today</text>`;
  svg += `<rect x="${start.toFixed(1)}" y="24" width="${(end - start).toFixed(1)}" height="10" rx="3" fill="${color}" />`;
  svg += `<text x="${labelStart.toFixed(1)}" y="14" class="tick"${flip ? ' text-anchor="end"' : ''}>${shortDate(inc.time)}${lasting ? ` to ${shortDate(inc.endTime)}` : ''}</text>`;
  for (const t of passes) svg += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="46" y2="60" class="pass" />`;
  if (est) svg += `<line x1="${x(est.time).toFixed(1)}" x2="${x(est.time).toFixed(1)}" y1="46" y2="60" class="pass next" />`;
  svg += '</svg>';
  const key = found
    ? `${passes.length} NISAR pass${passes.length === 1 ? '' : 'es'} over this place${est ? '; the dashed line is the next one expected' : ''}.`
    : 'Looking for NISAR passes…';
  return `${svg}<p class="hint">${key}</p>`;
}
