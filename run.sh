#!/usr/bin/env bash
# Local Postgres in Docker. Data persists in the named volume `ubicatec_pgdata`.
# Usage: ./run.sh          start DB, sync schema, seed on first run
#        ./run.sh dev      same, then start `npm run dev`
#        ./run.sh stop     stop the DB (data is kept)
#        ./run.sh reset    stop and DELETE all data
set -euo pipefail
cd "$(dirname "$0")"

NAME=ubicatec-postgres
VOLUME=ubicatec_pgdata
PORT=5433 # not 5432, to avoid clashing with a local Postgres
URL="postgresql://postgres:postgres@localhost:$PORT/ubicatec"

case "${1:-}" in
  stop)  docker stop "$NAME"; exit ;;
  reset) docker rm -f "$NAME" 2>/dev/null || true; docker volume rm "$VOLUME"; exit ;;
esac

FRESH=0
if ! docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --name "$NAME" -p "$PORT:5432" -v "$VOLUME:/var/lib/postgresql/data" \
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ubicatec postgres:16 >/dev/null
  FRESH=1
else
  docker start "$NAME" >/dev/null
fi

until docker exec "$NAME" pg_isready -U postgres -d ubicatec >/dev/null 2>&1; do sleep 1; done

# Point the app at the container (npm run dev reads .env).
touch .env
if grep -q '^DATABASE_URL=' .env; then
  URL="$URL" perl -i -pe 's/^DATABASE_URL=.*/DATABASE_URL="$ENV{URL}"/' .env
else
  printf 'DATABASE_URL="%s"\n' "$URL" >> .env
fi
export DATABASE_URL="$URL"

npx prisma db push
[ "$FRESH" = 1 ] && npm run db:seed

echo "Postgres ready at $URL"
[ "${1:-}" = dev ] && exec npm run dev
exit 0
