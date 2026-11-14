// Search without keyword lists: fuzzy matching over the events already on
// the map, plus place names from the open Photon geocoder (OpenStreetMap).

import { CATEGORIES } from './config.js';

const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const words = (s) => fold(s).split(/[^a-z0-9.]+/).filter(Boolean);

// Number of single-character edits between two words, capped for speed.
function editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

// How well one typed word matches one word of an event: 0 is no match.
function wordScore(typed, word) {
  if (word === typed) return 4;
  if (word.startsWith(typed)) return 3;
  if (typed.length >= 3 && word.includes(typed)) return 2;
  const slack = typed.length >= 7 ? 2 : typed.length >= 4 ? 1 : 0;
  if (slack && editDistance(typed, word.slice(0, typed.length + slack), slack) <= slack) return 1;
  return 0;
}

export function searchEvents(query, incidents, limit = 6) {
  const typed = words(query);
  if (!typed.length) return [];
  const hits = [];
  for (const incident of incidents) {
    const haystack = words(`${incident.title} ${CATEGORIES[incident.category].label} ${incident.reports.map((r) => r.detail.join(' ')).join(' ')}`);
    let total = 0;
    for (const t of typed) {
      let best = 0;
      for (const w of haystack) best = Math.max(best, wordScore(t, w));
      if (!best) {
        total = 0;
        break;
      }
      total += best;
    }
    if (total) hits.push({ incident, score: total + incident.severity });
  }
  return hits
    .sort((a, b) => b.score - a.score || b.incident.endTime - a.incident.endTime)
    .slice(0, limit)
    .map((h) => h.incident);
}

export async function searchPlaces(query, signal) {
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=en`, { signal });
  if (!res.ok) return [];
  const data = await res.json();
  const seen = new Set();
  const out = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    if (!p.name || !f.geometry) continue;
    const where = [p.state, p.country].filter((x) => x && x !== p.name).join(', ');
    const label = where ? `${p.name}, ${where}` : p.name;
    if (seen.has(label)) continue;
    seen.add(label);
    const [lon, lat] = f.geometry.coordinates;
    // Photon gives the extent as west, north, east, south.
    const bounds = p.extent ? { west: p.extent[0], north: p.extent[1], east: p.extent[2], south: p.extent[3] } : null;
    out.push({ label, kind: p.osm_value || p.type || 'place', lat, lon, bounds });
  }
  return out.slice(0, 5);
}
