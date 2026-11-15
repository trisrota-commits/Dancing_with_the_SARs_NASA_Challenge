// Picks the events worth measuring with calibrated NISAR data, by itself.
//
// It reads the same live feeds and archives as the app, with the app's own
// code, takes the strongest recent events, and keeps those NISAR has passed over on
// the same track both before and after. The result goes into
// tools/measure_events.json, which tools/measure.py measures along with
// the hand-picked places. Nobody has to name an event for a judge to find
// calibrated numbers on it.
//
//   node tools/pick_events.mjs            (no login needed)
//   node tools/pick_events.mjs --dry      (print the picks, write nothing)
//
// Behind a proxy, set NODE_USE_ENV_PROXY=1 as well as HTTPS_PROXY.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { FEEDS, CATEGORIES, NISAR_LOOKBACK_DAYS } from '../js/config.js';
import { fetchFeed, fetchArchive } from '../js/feeds.js';
import { buildIncidents } from '../js/incidents.js';
import { scenesAt, bestPair } from '../js/nisar.js';

const FILE = new URL('./measure_events.json', import.meta.url);
const DAY = 86400_000;
const LOOK_AT = 90; // strongest recent events to check against the archive
const ADD_PER_RUN = 24; // new events taken on in one run
const PER_KIND = 8; // of which at most this many of one kind
const KEEP = 40; // events kept in the list; the oldest fall out
const MAX_AGE_DAYS = 45; // an event older than this is not "recent"
// Kinds whose reported point lies on ground the radar can be read on. A
// storm's point is the eye of its track and an iceberg's is at sea: open
// water changes with the wind from pass to pass, which says nothing.
const ON_LAND = new Set(['earthquake', 'volcano', 'landslide', 'wildfire', 'flood']);
// A new pass can only arrive every 12 days, so an event is followed for a
// while after it ends and then left as it is.
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

const dry = process.argv.includes('--dry');

async function main() {
  const events = [];
  for (const name of Object.keys(FEEDS)) {
    try {
      const batch = await fetchFeed(name);
      events.push(...batch);
      console.log(`${FEEDS[name].label}: ${batch.length} reports`);
    } catch (err) {
      console.log(`${FEEDS[name].label}: not reachable (${err.message})`);
    }
  }
  // The live feeds hold the last days only, and NASA publishes a pass up
  // to two weeks late: an event that new rarely has a pass after it yet.
  // The agencies' archives (the app's "Since NISAR data began") hold the
  // larger events of the weeks before, which do.
  try {
    const older = await fetchArchive();
    events.push(...older);
    console.log(`Archives: ${older.length} reports`);
  } catch (err) {
    console.log(`Archives: not reachable (${err.message})`);
  }
  if (!events.length) {
    console.log('No feed answered; the list is left as it is.');
    return;
  }
  const now = Date.now();
  // The strongest of each kind, taken in turn, so one busy kind (small
  // quakes, say) does not crowd out a flood or a fire.
  const byKind = new Map();
  for (const inc of buildIncidents(events)) {
    if (now - inc.time > MAX_AGE_DAYS * DAY || now - inc.time < DAY) continue;
    if (!ON_LAND.has(inc.category)) continue;
    if (!byKind.has(inc.category)) byKind.set(inc.category, []);
    byKind.get(inc.category).push(inc);
  }
  for (const group of byKind.values()) group.sort((a, b) => b.severity - a.severity || b.time - a.time);
  const recent = [];
  for (let rank = 0; recent.length < LOOK_AT && [...byKind.values()].some((g) => g.length > rank); rank++) {
    for (const group of byKind.values()) if (group[rank] && recent.length < LOOK_AT) recent.push(group[rank]);
  }
  console.log(`${recent.length} strong recent events of ${byKind.size} kinds to check against the NISAR archive`);

  const list = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { sites: [] };
  const known = new Set(list.sites.map((s) => s.event_id));
  const picked = [];
  for (const inc of recent) {
    if (picked.length >= ADD_PER_RUN) break;
    if (known.has(inc.id)) continue;
    // The same event can come from a feed and from an archive under two
    // names: one already in the list within 30 km and three days is it.
    const near = (s) => Math.abs(Date.parse(s.event) - inc.time) < 3 * DAY && Math.hypot(s.lat - inc.lat, (s.lon - inc.lon) * Math.cos((inc.lat * Math.PI) / 180)) * 111 < 30;
    if (list.sites.some(near)) continue;
    if (picked.filter((p) => p.category === inc.category).length >= PER_KIND) continue;
    let found;
    try {
      found = await scenesAt(inc.lat, inc.lon, inc.time - NISAR_LOOKBACK_DAYS * DAY, now);
    } catch (err) {
      console.log(`  ${inc.title}: archive search failed (${err.message})`);
      continue;
    }
    // The same rule the app uses for its change view, without needing a
    // preview picture: the measurement reads the full product.
    const pair = bestPair(found.backscatter, inc.time, false, inc);
    if (!pair) {
      console.log(`  ${inc.title}: no passes on both sides yet`);
      continue;
    }
    console.log(`  ${inc.title}: passes on ${day(pair.before.time)} and ${day(pair.after.time)} → picked`);
    picked.push({
      id: `event-${inc.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      event_id: inc.id,
      name: inc.title,
      category: inc.category,
      kind: CATEGORIES[inc.category]?.label || inc.category,
      lat: +inc.lat.toFixed(4),
      lon: +inc.lon.toFixed(4),
      event: day(inc.time),
      // Only the passes around the event are read, not the whole mission.
      start: day(inc.time - NISAR_LOOKBACK_DAYS * DAY),
      picked: day(now),
    });
  }

  const sites = [...list.sites, ...picked].sort((a, b) => (a.event < b.event ? 1 : -1)).slice(0, KEEP);
  console.log(`${picked.length} new, ${sites.length} in the list`);
  if (dry || !picked.length) return;
  writeFileSync(
    FILE,
    JSON.stringify(
      {
        about:
          'Written by tools/pick_events.mjs, not by hand: the strongest recent events that NISAR has passed over on one track both before and after. tools/measure.py measures them across the event date. Edit tools/measure_sites.json for places chosen by people.',
        sites,
      },
      null,
      2,
    ) + '\n',
  );
}

main().catch((err) => {
  // A failed pick must not stop the measuring of what is already listed.
  console.log(`Picking failed: ${err.message}`);
});
