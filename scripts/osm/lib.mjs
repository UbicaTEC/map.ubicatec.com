// Pure helpers for scripts/osm/fetch-osm.mjs (kept separate so they can be unit-tested
// without touching the network).

/**
 * Pull a short building code out of OSM tags.
 * Priority: ref → short_name → trailing "(CODE)" in the name, e.g.
 * "Centro de Tecnología Avanzada para la Producción (CETEC)" → "CETEC".
 * @param {Record<string, string>} tags
 * @returns {string | null}
 */
export function extractCode(tags) {
  const direct = tags.ref ?? tags["building:ref"] ?? tags.short_name;
  if (direct?.trim()) return direct.trim();
  const m = /\(([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 .&-]{1,15})\)\s*$/.exec(
    tags.name ?? "",
  );
  return m ? m[1].trim() : null;
}

/**
 * Stitch an unordered list of open/closed ways (arrays of [lon, lat]) into closed rings.
 * Used to assemble the outer/inner rings of multipolygon relations.
 * @param {Array<Array<[number, number]>>} segments
 * @returns {Array<Array<[number, number]>>}
 */
export function stitchRings(segments) {
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const pending = segments.filter((s) => s.length > 1).map((s) => [...s]);
  const rings = [];
  while (pending.length) {
    let ring = pending.shift();
    let grew = true;
    while (!same(ring[0], ring.at(-1)) && grew) {
      grew = false;
      for (let i = 0; i < pending.length; i++) {
        const seg = pending[i];
        if (same(ring.at(-1), seg[0])) ring = ring.concat(seg.slice(1));
        else if (same(ring.at(-1), seg.at(-1)))
          ring = ring.concat([...seg].reverse().slice(1));
        else if (same(ring[0], seg.at(-1))) ring = seg.concat(ring.slice(1));
        else if (same(ring[0], seg[0]))
          ring = [...seg].reverse().concat(ring.slice(1));
        else continue;
        pending.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (same(ring[0], ring.at(-1)) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

const round = (n) => Math.round(n * 1e7) / 1e7;
const toCoord = (p) => [round(p.lon), round(p.lat)];

/**
 * Convert an Overpass element (way or relation, fetched with `out geom`) into a GeoJSON
 * Polygon / MultiPolygon geometry. Returns null when no closed ring can be built.
 * @param {any} el
 */
export function elementToGeometry(el) {
  if (el.type === "way") {
    const ring = (el.geometry ?? []).map(toCoord);
    if (ring.length < 4) return null;
    return { type: "Polygon", coordinates: [ring] };
  }
  if (el.type === "relation") {
    const ways = (role) =>
      (el.members ?? [])
        .filter(
          (m) => m.type === "way" && m.geometry && (m.role || "outer") === role,
        )
        .map((m) => m.geometry.map(toCoord));
    const outers = stitchRings(ways("outer"));
    const inners = stitchRings(ways("inner"));
    if (!outers.length) return null;
    if (outers.length === 1)
      return { type: "Polygon", coordinates: [outers[0], ...inners] };
    return { type: "MultiPolygon", coordinates: outers.map((o) => [o]) };
  }
  return null;
}

/**
 * Average of a polygon's outer-ring vertices (closing vertex excluded). Good enough
 * for a label/pin anchor on campus-sized buildings.
 * @param {{type: string, coordinates: any}} geometry
 * @returns {[number, number]}
 */
export function centroid(geometry) {
  const ring =
    geometry.type === "Polygon"
      ? geometry.coordinates[0]
      : geometry.coordinates[0][0];
  const pts = ring.slice(0, -1);
  const [x, y] = pts.reduce(
    ([sx, sy], [lon, lat]) => [sx + lon, sy + lat],
    [0, 0],
  );
  return [round(x / pts.length), round(y / pts.length)];
}

const GATE_BARRIERS = new Set(["gate", "lift_gate", "entrance", "turnstile"]);

/** Max distance (m) to attach a free-standing `entrance=*` node to a building outline. */
export const ENTRANCE_SNAP_METERS = 25;

/**
 * Approximate distance in metres from a point to a polygon (0 if inside). Uses an
 * equirectangular projection, which is accurate to well under 1% at campus scale.
 * @param {[number, number]} pt  [lon, lat]
 * @param {{type: string, coordinates: any}} geometry
 */
export function distanceToPolygon(pt, geometry) {
  const kx = 111_320 * Math.cos((pt[1] * Math.PI) / 180);
  const ky = 110_540;
  const xy = ([lon, lat]) => [(lon - pt[0]) * kx, (lat - pt[1]) * ky]; // point at origin
  const polys =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best = Infinity;
  for (const poly of polys) {
    const ring = poly[0].map(xy);
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi)
        inside = !inside;
      // distance from origin to segment (i, j)
      const dx = xj - xi;
      const dy = yj - yi;
      const len2 = dx * dx + dy * dy;
      const t = len2
        ? Math.max(0, Math.min(1, -(xi * dx + yi * dy) / len2))
        : 0;
      best = Math.min(best, Math.hypot(xi + t * dx, yi + t * dy));
    }
    if (inside) return 0;
  }
  return best;
}

/**
 * Turn raw Overpass elements into the two output datasets.
 * @param {any[]} elements  buildings (ways/relations with geom) + entrance/gate nodes
 */
export function buildDatasets(elements) {
  const buildingEls = elements.filter(
    (e) => (e.type === "way" || e.type === "relation") && e.tags?.building,
  );
  const entranceNodes = elements.filter(
    (e) =>
      e.type === "node" &&
      (e.tags?.entrance || GATE_BARRIERS.has(e.tags?.barrier)),
  );

  // node id → building id, so each entrance knows which building it belongs to.
  const owner = new Map();
  const buildings = [];
  for (const el of buildingEls) {
    const geometry = elementToGeometry(el);
    if (!geometry) continue;
    const id = `${el.type}/${el.id}`;
    const nodeIds = el.type === "way" ? (el.nodes ?? []) : [];
    // Relation members come back without node ids under `out geom`; those entrances
    // are matched by coordinate below.
    for (const n of nodeIds) owner.set(n, id);
    buildings.push({
      id,
      osmType: el.type,
      osmId: el.id,
      name: el.tags.name ?? null,
      code: extractCode(el.tags),
      building: el.tags.building,
      levels: el.tags["building:levels"]
        ? Number(el.tags["building:levels"])
        : null,
      center: centroid(geometry),
      geometry,
    });
  }

  // Fallback: match entrances on relation outlines by exact coordinate.
  const coordOwner = new Map();
  for (const b of buildings) {
    if (b.osmType !== "relation") continue;
    const rings =
      b.geometry.type === "Polygon"
        ? b.geometry.coordinates
        : b.geometry.coordinates.flat();
    for (const ring of rings)
      for (const c of ring) coordOwner.set(c.join(","), b.id);
  }

  const nearestBuilding = (coord) => {
    let best = null;
    for (const b of buildings) {
      const d = distanceToPolygon(coord, b.geometry);
      if (d <= ENTRANCE_SNAP_METERS && (!best || d < best.d))
        best = { id: b.id, d };
    }
    return best?.id ?? null;
  };

  const entrances = entranceNodes
    .map((n) => {
      const coord = toCoord(n);
      // "building": door of a building (entrance=*). "campus": gate in the campus fence.
      const kind = n.tags.entrance ? "building" : "campus";
      const buildingId =
        owner.get(n.id) ??
        coordOwner.get(coord.join(",")) ??
        (kind === "building" ? nearestBuilding(coord) : null);
      return {
        id: `node/${n.id}`,
        osmId: n.id,
        kind,
        buildingId,
        entrance: n.tags.entrance ?? null,
        barrier: n.tags.barrier ?? null,
        access: n.tags.access ?? null,
        name: n.tags.name ?? null,
        ref: n.tags.ref ?? null,
        wheelchair: n.tags.wheelchair ?? null,
        coordinates: coord,
      };
    })
    .sort((a, b) => a.osmId - b.osmId);

  buildings.sort(
    (a, b) =>
      (a.name ?? "￿").localeCompare(b.name ?? "￿", "es") || a.osmId - b.osmId,
  );
  return { buildings, entrances };
}
