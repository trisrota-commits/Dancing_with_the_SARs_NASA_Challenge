// Press coverage for an event. This is context written by other people, not
// data: the panel labels it as unverified and links out to every source.
//
// GDACS keeps a news list for each of its events, already matched by the
// agency. For events GDACS does not carry, the GDELT news index is searched
// with words taken from the event itself, and only articles whose headline
// names the place and the kind of event are kept, because a loose search
// returns unrelated news.

const KEYWORDS = {
  earthquake: 'earthquake',
  wildfire: '(wildfire OR fire)',
  flood: '(flood OR flooding)',
  storm: '(storm OR cyclone OR hurricane OR typhoon)',
  volcano: '(volcano OR eruption)',
  drought: 'drought',
  ice: '(ice OR iceberg)',
};

// Words that show a headline is about this kind of event. Both sources
// match loosely (GDACS by topic and country, the search by any words in the
// article), so a headline that does not name the event type is left out: a
// restaurant review must never appear as news about a forest fire.
export const ON_TOPIC = {
  earthquake: /quake|seism|\btremor|\bmagnitude|tsunami/i,
  wildfire: /\b(wild|forest|bush)?fires?\b|\bblazes?\b|\bburn(s|t|ed|ing)?\b|\bflames\b/i,
  flood: /\bflood|inundat|\bdeluge|\brain(s|fall)?\b|\bmonsoon/i,
  storm: /\bstorms?\b|cyclone|hurricane|typhoon|\bwinds?\b|\btornado/i,
  volcano: /volcan|\berupt|\blava\b|\bash\b/i,
  drought: /drought|\bdry\b|water shortage/i,
  ice: /\bice\b|glacier|iceberg/i,
};

async function fromGdacs(key) {
  const res = await fetch(`https://www.gdacs.org/gdacsapi/api/emm/getemmnewsbykey?eventtype=${encodeURIComponent(key.type)}&eventid=${encodeURIComponent(key.id)}`);
  if (!res.ok) return [];
  const list = await res.json();
  return (Array.isArray(list) ? list : []).map((a) => ({
    title: a.title,
    source: a.source,
    time: Date.parse(/Z$/.test(a.pubdate) ? a.pubdate : `${a.pubdate}Z`),
    url: a.link,
    image: null,
  }));
}

// The place an event title names: "M 5.2 - 59 km WSW of Houma, Tonga" gives
// "Tonga"; "Wildfire Red Hill, Perry, Mississippi" gives "Mississippi".
export function placeWord(title) {
  const last = String(title || '')
    .split(',')
    .pop()
    .replace(/^.*\b(of|in|near)\s+/i, '')
    .trim();
  return /^[\p{L} .'-]{3,40}$/u.test(last) ? last : null;
}

async function fromGdelt(incident) {
  const place = placeWord(incident.title);
  const word = KEYWORDS[incident.category];
  if (!place || !word) return [];
  const query = `"${place}" ${word}`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=20&timespan=14d&sort=datedesc`;
  // GDELT allows one request every five seconds and refuses the rest, so a
  // refusal is tried once more after a pause.
  let res = await fetch(url).catch(() => null);
  if (!res || !res.ok) {
    await new Promise((r) => setTimeout(r, 6000));
    res = await fetch(url).catch(() => null);
  }
  if (!res || !res.ok) return [];
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return []; // GDELT answers in plain text when it is rate-limiting
  }
  const needle = place.toLowerCase();
  return (data.articles || [])
    .filter((a) => (a.title || '').toLowerCase().includes(needle))
    .map((a) => {
      const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)/.exec(a.seendate || '');
      return {
        title: a.title,
        source: a.domain,
        time: m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN,
        url: a.url,
        image: /^https:\/\//.test(a.socialimage || '') ? a.socialimage : null,
      };
    });
}

// Returns { articles, via } where via says how the articles were matched.
export async function newsFor(incident) {
  const key = incident.reports.find((r) => r.gdacsKey)?.gdacsKey;
  if (key) {
    const articles = await fromGdacs(key).catch(() => []);
    const fitting = dedupe(articles, ON_TOPIC[incident.category]);
    if (fitting.length) return { articles: fitting, via: 'gdacs' };
  }
  const articles = await fromGdelt(incident).catch(() => []);
  return { articles: dedupe(articles, ON_TOPIC[incident.category]), via: 'gdelt' };
}

// One entry per headline, newest first, and only headlines that name the
// kind of event (when there is a word list for it).
export function dedupe(articles, onTopic) {
  const seen = new Set();
  return articles
    .filter((a) => a.title && /^https?:\/\//.test(a.url || '') && (!onTopic || onTopic.test(a.title)) && !seen.has(a.title) && seen.add(a.title))
    .sort((a, b) => (b.time || 0) - (a.time || 0))
    .slice(0, 8);
}
