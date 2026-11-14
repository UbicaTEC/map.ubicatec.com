import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../generated/prisma/client.js";

const prisma = new PrismaClient();

const readJson = (file: string) =>
  JSON.parse(readFileSync(path.join(process.cwd(), "data", file), "utf8"));

const norm = (s: unknown) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/* eslint-disable @typescript-eslint/no-explicit-any */
function resolveBuilding(query: string, buildings: any[]) {
  const n = norm(query);
  if (!n) return undefined;
  return (
    buildings.find((b) => b.id === query) ??
    buildings.find((b) => (b.aliases ?? []).some((a: string) => norm(a) === n)) ??
    buildings.find((b) => norm(b.name) === n)
  );
}

const json = (v: unknown) => (v == null ? null : JSON.stringify(v));

async function main() {
  const buildings: any[] = readJson("buildings.json");
  const entrances: any[] = readJson("entrances.json");

  for (const [order, b] of buildings.entries()) {
    const data = {
      name: b.name,
      mapLabel: b.mapLabel ?? null,
      code: b.code ?? null,
      category: b.category,
      levels: b.levels ?? 1,
      area: b.area ?? 0,
      isDirectory: !!(b.isDirectoryEntry ?? b.isDirectory),
      osmId: b.osmId ?? null,
      aliases: JSON.stringify(b.aliases ?? []),
      description: b.description ?? null,
      posX: b.pos?.x ?? b.posX,
      posZ: b.pos?.z ?? b.posZ,
      footprint: JSON.stringify(b.footprint ?? []),
      holes: json(b.holes),
      parts: json(b.parts),
      pinX: b.pinOffset?.x ?? b.pinX ?? null,
      pinZ: b.pinOffset?.z ?? b.pinZ ?? null,
      labelX: b.labelOffset?.x ?? b.labelX ?? b.pinOffset?.x ?? null,
      labelZ: b.labelOffset?.z ?? b.labelZ ?? b.pinOffset?.z ?? null,
      order: b.order ?? order,
    };
    await prisma.building.upsert({
      where: { id: b.id },
      update: data,
      create: { id: b.id, ...data },
    });
  }

  let skipped = 0;
  for (const e of entrances) {
    const b = resolveBuilding(e.buildingId, buildings);
    if (!b) {
      console.warn(`  ! entrada ${e.id}: no existe el edificio ${e.buildingId}`);
      skipped++;
      continue;
    }
    await prisma.entrance.upsert({
      where: { id: e.id },
      update: { buildingId: b.id, x: e.x, z: e.z },
      create: { id: e.id, buildingId: b.id, x: e.x, z: e.z },
    });
  }

  console.log("Seed listo:", {
    buildingsEnBD: await prisma.building.count(),
    entrancesEnBD: await prisma.entrance.count(),
    entradasOmitidas: skipped,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());