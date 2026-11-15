// Fetches the wildlife sightings from GBIF once and keeps them in
// data/wildlife/sightings.json, so that the app does not have to ask GBIF
// 108 times in every visitor's browser (GBIF refuses requests that come
// that fast; see js/wildlife.js).
//
//   node tools/wildlife_snapshot.mjs
//
// The requests and what is kept of the answers are the app's own
// (monthUrl, monthRecords, withoutDoubles in js/wildlife.js): one request
// for each species and month of the year, one after another with a pause.
// Nothing is written unless every request was answered.
//
// Behind a proxy: NODE_USE_ENV_PROXY=1 node tools/wildlife_snapshot.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES, monthUrl, monthRecords, withoutDoubles, REQUESTS } from '../js/wildlife.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'wildlife', 'sightings.json');
const PAUSE = 400; // milliseconds between requests
const TRIES = 6;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function answer(url) {
  for (let n = 0; n < TRIES; n++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status !== 503) throw new Error(`GBIF answered ${res.status} for ${url}`);
    await sleep(5000 * (n + 1));
  }
  throw new Error(`GBIF kept refusing ${url}`);
}

const all = [];
let done = 0;
for (const species of SPECIES) {
  for (let month = 1; month <= 12; month++) {
    all.push(...monthRecords(species, month, await answer(monthUrl(species, month))));
    process.stdout.write(`\r${++done} of ${REQUESTS} requests`);
    await sleep(PAUSE);
  }
}
// The common and scientific names are in the app's species list.
const sightings = withoutDoubles(all).map(({ common, sci, ...rest }) => rest);
const count = Object.fromEntries(SPECIES.map((s) => [s.id, sightings.filter((x) => x.species === s.id).length]));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({
    source: 'GBIF occurrence search, https://api.gbif.org/v1/occurrence/search',
    cite: `GBIF.org (${new Date().toISOString().slice(0, 10)}) GBIF Occurrence Search. Each record links to its page at GBIF, which names its dataset and licence.`,
    fetched: new Date().toISOString().slice(0, 10),
    requests: REQUESTS,
    bySpecies: count,
    sightings,
  }) + '\n',
);
console.log(`\nwritten ${OUT}: ${sightings.length} records`, count);
