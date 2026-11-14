// Everything that touches the 3D globe (CesiumJS, loaded globally from the CDN).

import { CATEGORIES, BASEMAPS, OVERLAYS, NISAR_TILES } from './config.js';

const C = window.Cesium;
const DAY = 86400_000;

const css = (hex, alpha = 1) => C.Color.fromCssColorString(hex).withAlpha(alpha);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// A great-circle arc lifted off the surface, so links read as vectors.
function arc(a, b, lift = 0.12) {
  const start = C.Cartographic.fromDegrees(a.lon, a.lat);
  const end = C.Cartographic.fromDegrees(b.lon, b.lat);
  const geodesic = new C.EllipsoidGeodesic(start, end);
  const peak = Math.max(20_000, geodesic.surfaceDistance * lift);
  const points = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const p = geodesic.interpolateUsingFraction(t);
    points.push(C.Cartesian3.fromRadians(p.longitude, p.latitude, Math.sin(Math.PI * t) * peak));
  }
  return points;
}

export class Globe {
  constructor(containerId) {
    const container = document.getElementById(containerId);
    C.Ion.defaultAccessToken = undefined;
    this.viewer = new C.Viewer(container, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });
    const { scene } = this.viewer;
    scene.globe.baseColor = css('#0b1420');
    scene.skyAtmosphere.show = true;
    scene.globe.showGroundAtmosphere = true;
    scene.screenSpaceCameraController.minimumZoomDistance = 2_000;
    scene.screenSpaceCameraController.maximumZoomDistance = 60_000_000;
    this.viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(20, 15, 24_000_000) });

    this.layers = { base: null, overlays: {}, nisar: [], scenes: [] };
    this.incidents = new C.CustomDataSource('incidents');
    this.footprints = new C.CustomDataSource('footprints');
    this.marks = new C.CustomDataSource('marks');
    this.viewer.dataSources.add(this.footprints);
    this.viewer.dataSources.add(this.incidents);
    this.viewer.dataSources.add(this.marks);
    this.lookup = new Map();
    this.born = new Map();

    // Slow spin until the user takes over.
    this.spinning = true;
    const stop = () => (this.spinning = false);
    container.addEventListener('pointerdown', stop, { once: true });
    container.addEventListener('wheel', stop, { once: true });
    this.viewer.clock.onTick.addEventListener(() => {
      if (this.spinning) this.viewer.camera.rotate(C.Cartesian3.UNIT_Z, -0.0008);
    });
  }

  onPick(callback) {
    this.viewer.screenSpaceEventHandler.setInputAction((click) => {
      const hits = this.viewer.scene.drillPick(click.position, 12);
      const found = [];
      for (const hit of hits) {
        const item = hit.id && this.lookup.get(hit.id.id);
        if (item && !found.includes(item)) found.push(item);
      }
      callback(found);
    }, C.ScreenSpaceEventType.LEFT_CLICK);
  }

  // ---------- imagery ----------

  tiles(def, date) {
    return new C.UrlTemplateImageryProvider({
      url: def.url.replace('{date}', date || ''),
      maximumLevel: def.maxLevel,
      credit: def.credit || 'NASA GIBS',
    });
  }

  setBasemap(key) {
    const def = BASEMAPS[key];
    const layers = this.viewer.imageryLayers;
    if (this.layers.base) layers.remove(this.layers.base);
    const date = def.dated ? iso(Date.now() - DAY) : null;
    this.layers.base = layers.addImageryProvider(this.tiles(def, date), 0);
  }

  setLighting(on) {
    this.viewer.scene.globe.enableLighting = on;
  }

  setOverlay(key, on, date) {
    const layers = this.viewer.imageryLayers;
    if (this.layers.overlays[key]) {
      layers.remove(this.layers.overlays[key]);
      delete this.layers.overlays[key];
    }
    if (!on) return;
    const layer = layers.addImageryProvider(this.tiles(OVERLAYS[key], date));
    layer.alpha = 0.85;
    this.layers.overlays[key] = layer;
    this.raiseScenes();
  }

  // Daily radar swaths; stacking several days fills in a wider mosaic.
  setNisarTiles(on, endDate, days) {
    const layers = this.viewer.imageryLayers;
    this.layers.nisar.forEach((l) => layers.remove(l));
    this.layers.nisar = [];
    if (!on || !endDate) return;
    const end = Date.parse(endDate);
    for (let i = days - 1; i >= 0; i--) {
      const date = iso(end - i * DAY);
      if (date < NISAR_TILES.firstDate) continue;
      this.layers.nisar.push(layers.addImageryProvider(this.tiles(NISAR_TILES, date)));
    }
    this.raiseScenes();
  }

  raiseScenes() {
    this.layers.scenes.forEach((l) => this.viewer.imageryLayers.raiseToTop(l));
  }

  clearScenes() {
    this.layers.scenes.forEach((l) => this.viewer.imageryLayers.remove(l));
    this.layers.scenes = [];
    this.viewer.scene.splitPosition = 0.5;
  }

  async addScene(scene, bounds, side) {
    const provider = await C.SingleTileImageryProvider.fromUrl(scene.image, {
      rectangle: C.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
      credit: 'NISAR preview: NASA/ISRO, ASF DAAC',
    });
    const layer = this.viewer.imageryLayers.addImageryProvider(provider);
    // The previews pad the swath with black; treat that as see-through.
    layer.colorToAlpha = C.Color.BLACK;
    layer.colorToAlphaThreshold = 0.004;
    if (side === 'left') layer.splitDirection = C.SplitDirection.LEFT;
    if (side === 'right') layer.splitDirection = C.SplitDirection.RIGHT;
    this.layers.scenes.push(layer);
    return layer;
  }

  setSplit(fraction) {
    this.viewer.scene.splitPosition = fraction;
  }

  flyToBounds(b) {
    this.spinning = false;
    const pad = 0.6;
    this.viewer.camera.flyTo({
      destination: C.Rectangle.fromDegrees(b.west - pad, b.south - pad, b.east + pad, b.north + pad),
      duration: 1.6,
    });
  }

  flyTo(lat, lon, height = 1_800_000) {
    this.spinning = false;
    this.viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat, height), duration: 1.6 });
  }

  // ---------- incidents ----------

  renderIncidents(list, freshIds) {
    const ents = this.incidents.entities;
    ents.suspendEvents();
    ents.removeAll();
    for (const [id, item] of this.lookup) if (item.kind === 'incident') this.lookup.delete(id);
    const now = Date.now();
    for (const id of freshIds) if (!this.born.has(id)) this.born.set(id, now);

    for (const inc of list) {
      const color = CATEGORIES[inc.category].color;
      const position = C.Cartesian3.fromDegrees(inc.lon, inc.lat);
      const imaged = inc.nisarScenes.length > 0;
      const id = `inc:${inc.id}`;
      this.lookup.set(id, { kind: 'incident', incident: inc });
      ents.add({
        id,
        position,
        point: {
          pixelSize: 7 + inc.severity * 11 + (inc.reports.length > 1 ? 2 : 0),
          color: css(color, 0.92),
          outlineColor: imaged ? css('#ffffff') : css('#05080d', 0.8),
          outlineWidth: imaged ? 2.5 : 1,
          scaleByDistance: new C.NearFarScalar(8e5, 1.5, 3e7, 0.75),
        },
      });
      if (inc.track) {
        ents.add({
          polyline: {
            positions: inc.track.map((p) => C.Cartesian3.fromDegrees(p.lon, p.lat)),
            width: 2,
            material: css(color, 0.7),
            arcType: C.ArcType.GEODESIC,
          },
        });
      }
      const bornAt = this.born.get(inc.id);
      if (bornAt && now - bornAt < 90_000) {
        // Expanding ring on events that arrived while the page was open.
        const phase = () => ((Date.now() - bornAt) % 1800) / 1800;
        ents.add({
          position,
          point: {
            pixelSize: new C.CallbackProperty(() => 12 + phase() * 46, false),
            color: css(color, 0),
            outlineColor: new C.CallbackProperty(() => css(color, 1 - phase()), false),
            outlineWidth: 2,
          },
        });
      }
    }
    ents.resumeEvents();
  }

  renderFootprints(scenes, on) {
    const ents = this.footprints.entities;
    ents.suspendEvents();
    ents.removeAll();
    for (const [id, item] of this.lookup) if (item.kind === 'scene') this.lookup.delete(id);
    if (on) {
      const now = Date.now();
      for (const scene of scenes) {
        const ageDays = (now - scene.time) / DAY;
        const strength = Math.max(0.25, 1 - ageDays / 4);
        const ring = scene.ring.flatMap((p) => [p.lon, p.lat]);
        const id = `scene:${scene.id}`;
        this.lookup.set(id, { kind: 'scene', scene });
        ents.add({
          id,
          polygon: {
            hierarchy: C.Cartesian3.fromDegreesArray(ring),
            material: css('#39e6c4', 0.1 * strength),
          },
          polyline: {
            positions: C.Cartesian3.fromDegreesArray(ring),
            width: 1.2,
            material: css('#39e6c4', 0.75 * strength),
            clampToGround: true,
          },
        });
      }
    }
    ents.resumeEvents();
  }

  // Ring on the chosen incident plus arcs to everything linked to it.
  select(incident, scenes = []) {
    const ents = this.marks.entities;
    ents.removeAll();
    if (incident) this.markIncident(incident);
    for (const scene of scenes) {
      const ring = scene.ring.flatMap((p) => [p.lon, p.lat]);
      ents.add({
        polyline: {
          positions: C.Cartesian3.fromDegreesArray(ring),
          width: 2,
          material: css('#39e6c4', 0.95),
          clampToGround: true,
        },
      });
    }
  }

  markIncident(incident) {
    const ents = this.marks.entities;
    const t0 = Date.now();
    const pulse = () => 0.5 + 0.5 * Math.sin((Date.now() - t0) / 260);
    ents.add({
      position: C.Cartesian3.fromDegrees(incident.lon, incident.lat),
      point: {
        pixelSize: new C.CallbackProperty(() => 26 + pulse() * 8, false),
        color: css('#ffffff', 0),
        outlineColor: css('#ffffff', 0.95),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    for (const link of incident.related.slice(0, 25)) {
      ents.add({
        polyline: {
          positions: arc(incident, link.incident),
          width: 1.6,
          material: new C.PolylineDashMaterialProperty({ color: css(CATEGORIES[link.incident.category].color, 0.9), dashLength: 12 }),
          arcType: C.ArcType.NONE,
        },
      });
    }
  }
}
