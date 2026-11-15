// Turns raw feed events into incidents: one dot per real-world event, even when
// several feeds report it, plus links between different incidents that overlap.

import { CATEGORIES, RELATED_KM, RELATED_DAYS } from './config.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Gap between two time ranges; zero when they overlap.
function timeGap(a, b) {
  if (a.time > b.endTime) return a.time - b.endTime;
  if (b.time > a.endTime) return b.time - a.endTime;
  return 0;
}

function sameIncident(a, b) {
  if (a.category !== b.category || a.source === b.source) return false;
  const rule = CATEGORIES[a.category];
  return timeGap(a, b) <= rule.mergeHours * HOUR && distanceKm(a, b) <= rule.mergeKm;
}

export function buildIncidents(events) {
  // Union-find over events that describe the same thing in different feeds.
  const parent = events.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  // The feeds each group holds. A feed lists one event once, so two groups
  // that both hold a report from the same feed are two events: a mainshock
  // and its aftershock minutes apart must not become one because a second
  // feed reports them both.
  const feeds = events.map((ev) => new Set([ev.source]));
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (!sameIncident(events[i], events[j])) continue;
      const a = find(i);
      const b = find(j);
      if (a === b || [...feeds[b]].some((f) => feeds[a].has(f))) continue;
      parent[b] = a;
      for (const f of feeds[b]) feeds[a].add(f);
    }
  }

  const groups = new Map();
  events.forEach((ev, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(ev);
  });

  const incidents = [...groups.values()].map((reports) => {
    reports.sort((a, b) => b.severity - a.severity);
    // An earthquake's place, time and magnitude are the USGS's when it has
    // reported it: the other feeds relay or estimate them, and their
    // "severity" is an alert level, not a magnitude.
    const lead = (reports[0].category === 'earthquake' && reports.find((r) => r.source === 'usgs')) || reports[0];
    return {
      id: reports.map((r) => r.id).sort()[0],
      category: lead.category,
      title: lead.title,
      lat: lead.lat,
      lon: lead.lon,
      time: Math.min(...reports.map((r) => r.time)),
      endTime: Math.max(...reports.map((r) => r.endTime)),
      severity: reports[0].severity,
      magnitude: lead.magnitude,
      track: reports.find((r) => r.track)?.track || null,
      reports,
      related: [],
      nisarScenes: [],
    };
  });

  for (let i = 0; i < incidents.length; i++) {
    for (let j = i + 1; j < incidents.length; j++) {
      const a = incidents[i];
      const b = incidents[j];
      if (timeGap(a, b) > RELATED_DAYS * DAY) continue;
      const km = distanceKm(a, b);
      if (km > RELATED_KM) continue;
      a.related.push({ incident: b, km });
      b.related.push({ incident: a, km });
    }
  }
  for (const inc of incidents) inc.related.sort((x, y) => x.km - y.km);
  return incidents.sort((a, b) => b.endTime - a.endTime);
}

// The same longitude, written within half a turn of `ref`. A scene across
// the date line has an outline that runs past 180° (178° to 181°, say), and
// a point at 179.5°W is inside it as 180.5°.
export const lonNear = (lon, ref) => lon + 360 * Math.round((ref - lon) / 360);

export function pointInPolygon(lat, lon, ring) {
  if (ring.length) lon = lonNear(lon, ring[0].lon);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.lat > lat !== b.lat > lat && lon < ((b.lon - a.lon) * (lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

// Marks which incidents sit under a recently acquired radar scene.
export function tagNisarCoverage(incidents, scenes) {
  for (const inc of incidents) {
    inc.nisarScenes = scenes.filter((s) => pointInPolygon(inc.lat, inc.lon, s.ring));
  }
}
