// Real wildlife sightings from GBIF (the Global Biodiversity Information
// Facility), an open database of species records. The app plays them by
// month of the year, so migrating animals appear and disappear where they
// were actually seen. Records show where people looked as well as where
// animals were, so busy coasts and well-studied areas have more of them.

const API = 'https://api.gbif.org/v1/occurrence/search';
const YEARS = '2010,2025';
const PER_MONTH = 25; // records per species per month of the year

export const SPECIES = [
  {
    id: 'humpback',
    common: 'Humpback whale',
    sci: 'Megaptera novaeangliae',
    color: '#7fd4ff',
    splash: true,
    note: 'Migrates between cold feeding waters in summer and warm breeding waters in winter, one of the longest migrations of any mammal.',
  },
  {
    id: 'blue-whale',
    common: 'Blue whale',
    sci: 'Balaenoptera musculus',
    color: '#4f8dff',
    splash: true,
    note: 'The largest animal known to have lived. It follows seasonal krill blooms.',
  },
  {
    id: 'whale-shark',
    common: 'Whale shark',
    sci: 'Rhincodon typus',
    color: '#58e0c0',
    splash: false,
    note: 'The largest fish. It gathers at a few coasts each year when plankton blooms.',
  },
  {
    id: 'manta',
    common: 'Giant manta ray',
    sci: 'Mobula birostris',
    color: '#c79bff',
    splash: false,
    note: 'A giant ray of open oceans and coasts, often seen at cleaning stations on reefs.',
  },
  {
    id: 'stingray',
    common: 'Common stingray',
    sci: 'Dasyatis pastinaca',
    color: '#e0a8ff',
    splash: false,
    note: 'A stingray of the eastern Atlantic and the Mediterranean, resting on sandy and muddy seabeds.',
  },
  {
    id: 'leatherback',
    common: 'Leatherback turtle',
    sci: 'Dermochelys coriacea',
    color: '#9be37a',
    splash: false,
    note: 'Crosses whole ocean basins between nesting beaches and feeding grounds.',
  },
  {
    id: 'arctic-tern',
    common: 'Arctic tern',
    sci: 'Sterna paradisaea',
    color: '#ffffff',
    splash: false,
    note: 'Flies from the Arctic to the Antarctic and back every year, the longest known migration of any animal.',
  },
  {
    id: 'kob',
    common: 'White-eared kob',
    sci: 'Kobus kob leucotis',
    color: '#ffcf6b',
    splash: false,
    note: 'Moves across South Sudan’s floodplains with the seasons, in one of the largest land mammal migrations. NISAR maps the floods it follows.',
  },
  {
    id: 'wildebeest',
    common: 'Blue wildebeest',
    sci: 'Connochaetes taurinus',
    color: '#ff9b6b',
    splash: false,
    note: 'Follows the rains and fresh grass in a yearly loop across the Serengeti and Maasai Mara.',
  },
];

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

async function fetchMonth(species, month) {
  const q = new URLSearchParams({
    scientificName: species.sci,
    hasCoordinate: 'true',
    hasGeospatialIssue: 'false',
    occurrenceStatus: 'PRESENT',
    year: YEARS,
    month: String(month),
    limit: String(PER_MONTH),
  });
  const res = await fetch(`${API}?${q}`);
  if (!res.ok) throw new Error(`GBIF answered ${res.status}`);
  const json = await res.json();
  return (json.results || [])
    .filter((r) => Number.isFinite(r.decimalLatitude) && Number.isFinite(r.decimalLongitude))
    .map((r) => ({
      species: species.id,
      common: species.common,
      sci: species.sci,
      lat: r.decimalLatitude,
      lon: r.decimalLongitude,
      month,
      date: r.eventDate ? String(r.eventDate).slice(0, 10) : r.year ? String(r.year) : null,
      country: r.country || null,
      dataset: r.datasetName || null,
      basis: r.basisOfRecord || null,
      url: `https://www.gbif.org/occurrence/${r.key}`,
    }));
}

// All sightings for all species, loaded a few requests at a time.
// onProgress(done, total) reports progress.
export async function loadSightings(onProgress) {
  const jobs = [];
  for (const species of SPECIES) for (let m = 1; m <= 12; m++) jobs.push([species, m]);
  const out = [];
  let done = 0;
  let failed = 0;
  const worker = async () => {
    while (jobs.length) {
      const [species, m] = jobs.shift();
      try {
        out.push(...(await fetchMonth(species, m)));
      } catch {
        failed++;
      }
      onProgress?.(++done, SPECIES.length * 12);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (!out.length && failed) throw new Error('GBIF could not be reached');
  // Drop exact duplicates (the same spot and date from several datasets).
  const seen = new Set();
  return out.filter((s) => {
    const key = `${s.species}:${s.lat.toFixed(2)}:${s.lon.toFixed(2)}:${s.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Points of interest, purely for exploring: not NISAR data and not events.
export const POIS = [
  {
    id: 'titanic',
    name: 'Wreck of the Titanic',
    lat: 41.7325,
    lon: -49.9469,
    text: 'The RMS Titanic sank here on 15 April 1912, after striking an iceberg. The wreck lies about 3,800 m deep and was found in 1985.',
  },
  {
    id: 'challenger-deep',
    name: 'Challenger Deep',
    lat: 11.3733,
    lon: 142.5917,
    text: 'The deepest known point in the ocean, nearly 11 km down, in the Mariana Trench.',
  },
  {
    id: 'point-nemo',
    name: 'Point Nemo',
    lat: -48.8767,
    lon: -123.3933,
    text: 'The point in the ocean farthest from any land, about 2,700 km from the nearest coast. Old spacecraft are steered to fall into the sea near here.',
  },
];
