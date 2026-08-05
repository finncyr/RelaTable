#!/bin/sh
set -e

# Apply the schema to the persistent volume DB (idempotent) and ensure the
# reference relationship/event types exist. No demo data in production.
echo "RelaTable: DATABASE_URL=${DATABASE_URL} DATA_DIR=${DATA_DIR}"
ls -la "${DATA_DIR:-/data}" 2>/dev/null || echo "RelaTable: ${DATA_DIR:-/data} not readable yet"

echo "RelaTable: syncing database schema…"
npx prisma db push --skip-generate

echo "RelaTable: seeding reference data…"
SEED_DEMO=0 npx tsx prisma/seed.ts

echo "RelaTable: starting server…"
exec "$@"
