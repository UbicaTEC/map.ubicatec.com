#!/usr/bin/env node
// Precompute Campus Monterrey buildings + entrances from OpenStreetMap.
//
//   npm run osm:fetch
//
// Queries the Overpass API ONCE, at build/dev time, and writes:
//   data/buildings.json   every building inside the campus polygon (name, code, polygon)
//   data/entrances.json   building doors (`entrance=*`, linked to the building they sit on
//                         or within 25 m of) + campus gates (`barrier=gate|lift_gate|…`)
//
// Both files are committed. The web app reads them (via the seed) and never calls
// Overpass at runtime.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDatasets } from "./lib.mjs";

// Approximate centre of Campus Monterrey, used to locate the campus polygon.
const CENTER = { lat: 25.6515, lon: -100.2895 };
// OSM relation "Tecnológico de Monterrey" (alt_name "Campus Monterrey", amenity=university).
// Override with OSM_CAMPUS_RELATION=<id> if it ever gets re-mapped.
const CAMPUS_RELATION = Number(process.env.OSM_CAMPUS_RELATION ?? 21104322);

const ENDPOINTS = (
  process.env.OVERPASS_URL ??
  "https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter"
).split(",");

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outDir = path.join(root, "data");

const query = `
[out:json][timeout:120];
rel(${CAMPUS_RELATION});
map_to_area->.campus;
(
  way[building](area.campus);
  relation[building](area.campus);
)->.b;
.b out body geom;
(
  node[entrance](area.campus);
  node[barrier~"^(gate|lift_gate|entrance|turnstile)$"](area.campus);
);
out body;
`;

async function overpass(q) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        // overpass-api.de rejects requests without a User-Agent (HTTP 406).
        headers: {
          "User-Agent": "ubicatec-osm-precompute/1.0",
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(180_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      const wait = 5_000 * (attempt + 1);
      console.warn(
        `  Overpass ${url} falló (${err.message}). Reintento en ${wait / 1000}s…`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

console.log(
  `Consultando Overpass (relación ${CAMPUS_RELATION}, centro ${CENTER.lat}, ${CENTER.lon})…`,
);
const json = await overpass(query);

// Defensive dedupe by type/id (a node shared by two buildings is only output once anyway).
const seen = new Set();
const elements = json.elements.filter((e) => {
  const k = `${e.type}/${e.id}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const { buildings, entrances } = buildDatasets(elements);
if (!buildings.length)
  throw new Error(
    "Overpass no devolvió edificios; revisa la relación del campus.",
  );

const meta = {
  source: "OpenStreetMap contributors (ODbL) via Overpass API",
  osmTimestamp: json.osm3s?.timestamp_osm_base ?? null,
  campusRelation: CAMPUS_RELATION,
  center: [CENTER.lon, CENTER.lat],
  coordinateOrder: "[lon, lat] (GeoJSON)",
};

mkdirSync(outDir, { recursive: true });
const write = (file, key, items) =>
  writeFileSync(
    path.join(outDir, file),
    JSON.stringify({ ...meta, count: items.length, [key]: items }, null, 2) +
      "\n",
  );
write("buildings.json", "buildings", buildings);
write("entrances.json", "entrances", entrances);

const named = buildings.filter((b) => b.name).length;
const doors = entrances.filter((e) => e.kind === "building");
const linked = doors.filter((e) => e.buildingId).length;
console.log(
  `✔ data/buildings.json  ${buildings.length} edificios (${named} con nombre)`,
);
console.log(
  `✔ data/entrances.json  ${entrances.length} entradas: ${doors.length} de edificio (${linked} ligadas), ` +
    `${entrances.length - doors.length} accesos del campus`,
);
