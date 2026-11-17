import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDatasets, centroid, distanceToPolygon, elementToGeometry, extractCode, stitchRings } from "./lib.mjs";

test("extractCode: ref, short_name y código entre paréntesis", () => {
  assert.equal(extractCode({ ref: "A1", name: "Aulas I" }), "A1");
  assert.equal(extractCode({ short_name: "CIAP" }), "CIAP");
  assert.equal(extractCode({ name: "Centro de Tecnología Avanzada para la Producción (CETEC)" }), "CETEC");
  assert.equal(extractCode({ name: "Auditorio Luis Elizondo (ALE)" }), "ALE");
  assert.equal(extractCode({ name: "Oficinas Administrativas (Campus Norte)" }), null);
  assert.equal(extractCode({ name: "BiblioTEC" }), null);
  assert.equal(extractCode({}), null);
});

test("stitchRings une segmentos desordenados e invertidos en un anillo cerrado", () => {
  const rings = stitchRings([
    [[1, 0], [1, 1]],
    [[0, 0], [1, 0]],
    [[0, 0], [0, 1], [1, 1]], // invertido respecto al recorrido
  ]);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0][0], rings[0].at(-1));
  assert.equal(rings[0].length, 5);
});

test("stitchRings descarta anillos que no cierran", () => {
  assert.deepEqual(stitchRings([[[0, 0], [1, 0], [1, 1]]]), []);
});

const square = (x, y) => [
  { lat: y, lon: x },
  { lat: y, lon: x + 1 },
  { lat: y + 1, lon: x + 1 },
  { lat: y + 1, lon: x },
  { lat: y, lon: x },
];

test("elementToGeometry: way → Polygon, relation con 2 outers → MultiPolygon", () => {
  const way = elementToGeometry({ type: "way", geometry: square(0, 0) });
  assert.equal(way.type, "Polygon");
  assert.equal(way.coordinates[0].length, 5);

  const rel = elementToGeometry({
    type: "relation",
    members: [
      { type: "way", role: "outer", geometry: square(0, 0) },
      { type: "way", role: "outer", geometry: square(5, 5) },
    ],
  });
  assert.equal(rel.type, "MultiPolygon");
  assert.equal(rel.coordinates.length, 2);

  assert.equal(elementToGeometry({ type: "way", geometry: square(0, 0).slice(0, 2) }), null);
});

test("centroid promedia los vértices sin repetir el de cierre", () => {
  assert.deepEqual(centroid(elementToGeometry({ type: "way", geometry: square(0, 0) })), [0.5, 0.5]);
});

test("buildDatasets liga entradas a su edificio (way por nodo, relation por coordenada)", () => {
  const { buildings, entrances } = buildDatasets([
    { type: "way", id: 10, nodes: [1, 2, 3, 4, 1], tags: { building: "university", name: "Aulas I" }, geometry: square(0, 0) },
    {
      type: "relation",
      id: 20,
      tags: { building: "yes", name: "Aulas IV" },
      members: [{ type: "way", role: "outer", geometry: square(5, 5) }],
    },
    { type: "way", id: 30, nodes: [], tags: { building: "yes" }, geometry: square(9, 9) },
    { type: "node", id: 2, lat: 0, lon: 1, tags: { entrance: "main" } },
    { type: "node", id: 99, lat: 5, lon: 6, tags: { entrance: "yes" } },
    { type: "node", id: 100, lat: 50, lon: 50, tags: { entrance: "yes" } },
    { type: "node", id: 101, lat: 9.5, lon: 9.5, tags: { barrier: "gate" } },
    { type: "node", id: 102, lat: 9.5, lon: 9.5, tags: { barrier: "fence" } },
  ]);
  assert.equal(buildings.length, 3);
  assert.deepEqual(
    buildings.map((b) => b.name),
    ["Aulas I", "Aulas IV", null], // ordenados por nombre, sin nombre al final
  );
  assert.deepEqual(
    entrances.map((e) => [e.id, e.kind, e.buildingId]),
    [
      ["node/2", "building", "way/10"],
      ["node/99", "building", "relation/20"],
      ["node/100", "building", null],
      // las rejas del campus no se ligan a edificios aunque estén dentro de uno
      ["node/101", "campus", null],
    ],
  );
});

test("distanceToPolygon: 0 dentro, metros reales afuera", () => {
  // cuadrado de ~11 m en Campus Monterrey
  const g = {
    type: "Polygon",
    coordinates: [[[-100.29, 25.65], [-100.2899, 25.65], [-100.2899, 25.6501], [-100.29, 25.6501], [-100.29, 25.65]]],
  };
  assert.equal(distanceToPolygon([-100.28995, 25.65005], g), 0);
  const d = distanceToPolygon([-100.2897, 25.65005], g); // 0.0002° al este del borde
  assert.ok(d > 19 && d < 21, `esperaba ~20 m, salió ${d}`);
});

test("buildDatasets liga una puerta suelta al edificio más cercano dentro de 25 m", () => {
  const near = { type: "node", id: 7, lat: 25.65005, lon: -100.28985, tags: { entrance: "main" } }; // ~5 m
  const far = { type: "node", id: 8, lat: 25.65005, lon: -100.2895, tags: { entrance: "yes" } }; // ~40 m
  const b = {
    type: "way",
    id: 1,
    nodes: [],
    tags: { building: "yes" },
    geometry: [
      { lat: 25.65, lon: -100.29 },
      { lat: 25.65, lon: -100.2899 },
      { lat: 25.6501, lon: -100.2899 },
      { lat: 25.6501, lon: -100.29 },
      { lat: 25.65, lon: -100.29 },
    ],
  };
  const { entrances } = buildDatasets([b, near, far]);
  assert.deepEqual(
    entrances.map((e) => e.buildingId),
    ["way/1", null],
  );
});
