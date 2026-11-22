# UbicaTec — Mapa del Tec de Monterrey

**UbicaTec** es el mapa interactivo del Campus Monterrey del Tec y un hub de
eventos para estudiantes: buscas un edificio, ves sus entradas, te traza la ruta
caminando y te enteras de lo que pasa en el campus. Esta versión es un remake con
el [T3 stack](https://create.t3.gg/) y todo el contenido vive en una base de
datos con Prisma.

## Stack

- **Next.js 15** (App Router) + **TypeScript**
- **tRPC 11** + React Query: `src/server/api/routers/campus.ts`
- **Prisma 6**: `prisma/schema.prisma`, con **SQLite** en local por ahora
- **Tailwind CSS v4**: `src/styles/globals.css`

## Requisitos

- [Node.js](https://nodejs.org/) **20 o más nuevo** (`node -v`)
- npm (viene con Node)
- Git

No necesitas instalar ninguna base de datos: en local se usa un archivo SQLite
que Prisma crea solo.

## Levantarlo en local

```bash
# 1. Clonar
git clone https://github.com/UbicaTEC/map.ubicatec.com.git
cd map.ubicatec.com

# 2. Instalar dependencias (también corre `prisma generate`)
npm install

# 3. Crear tu .env a partir del ejemplo
cp .env.example .env          # Windows (PowerShell): Copy-Item .env.example .env

# 4. Crear la base local (prisma/db.sqlite) con el schema
npm run db:push

# 5. Correr el proyecto
npm run dev                   # http://localhost:3000
```

### Variables de entorno

| Variable | Para qué | Valor en local |
| --- | --- | --- |
| `DATABASE_URL` | Conexión de Prisma | `file:./db.sqlite` (ya viene en `.env.example`) |

Si agregas una variable nueva, ponla en `.env.example` **y** en `src/env.js`.
Nunca subas tu `.env` (está en `.gitignore`).

### Datos de prueba (seed)

> ⚠️ Hoy `npm run db:seed` **falla** en un clon nuevo: `prisma/seed.mjs` lee
> `docs/research/ubicatec/*.json`, y esa carpeta no está en el repo. Sin seed la
> página carga, pero el mapa sale vacío. Falta apuntar el seed a
> `data/buildings.json` y `data/entrances.json`, los archivos que genera el
> script de OSM del issue #12 (`npm run osm:fetch`).

## Problemas comunes

| Síntoma | Solución |
| --- | --- |
| `npm ci` dice que `package.json` y `package-lock.json` no están sincronizados | Usa `npm install` |
| `Invalid environment variables` al arrancar | Te falta el `.env`; repite el paso 3 |
| Error de Prisma `The table ... does not exist` | Corre `npm run db:push` |
| Next avisa de *multiple lockfiles* | Tienes un `package-lock.json` en una carpeta padre (por ejemplo en tu usuario). Es solo un aviso, pero puedes borrar ese otro lockfile |

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo (Turbopack) |
| `npm run build` / `npm run start` | Build y servidor de producción |
| `npm run check` | Lint + typecheck. Córrelo antes de abrir un PR |
| `npm run db:push` | Aplica `prisma/schema.prisma` a la base local |
| `npm run db:seed` | Carga los datos de prueba (ver la nota de arriba) |
| `npm run db:studio` | Abre Prisma Studio para ver la base |
| `npm run format:write` | Formatea el código con Prettier |

## Estructura

```
prisma/
  schema.prisma        modelos: Building, Entrance, Event, Post, FoodPlace, …
  seed.mjs             carga los datos a la base
src/
  app/                 rutas (App Router): /, /mapa, /api/trpc
  app/_components/     map-app.tsx, el shell del mapa
  components/          mapa SVG, paneles, modal de edificio, UI
  lib/                 utilidades del campus, rutas a pie (Dijkstra), navegación
  server/api/          routers de tRPC
scripts/               herramientas de verificación y generación de datos
```

## Cómo contribuir

1. Toma un issue del [project board](https://github.com/orgs/UbicaTEC/projects/2) y asígnatelo.
2. Crea una rama desde `main`: `git switch main && git pull && git switch -c feature/nombre-corto`.
3. Haz commits chicos y corre `npm run check` antes de subir.
4. Abre **un PR por issue**. La plantilla te pide qué cambia, `Closes #numero` y cómo probarlo.
5. Otra persona revisa y aprueba antes del merge. `main` está protegida.

¿Nuevo en Git? Revisa el [git-crash-course](https://github.com/UbicaTEC/git-crash-course).
