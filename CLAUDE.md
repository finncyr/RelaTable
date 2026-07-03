# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # dev server on :5173
npm run build        # production build (adapter-node)
npm start            # run production build
npm run check        # svelte-check type checking
npm test             # Vitest unit tests (domain layer only, ~25 tests)
npm run e2e          # build + Playwright E2E against isolated data/e2e.db
npm run db:push      # apply schema changes to SQLite (no migration files)
npm run db:seed      # seed reference data + demo owner (password: Demo-Passwort-12345!)
npm run db:reset     # wipe + re-seed (SEED_DEMO=0 for clean first-run)
npm run db:studio    # Prisma Studio GUI
```

Single test: `npx vitest run src/lib/server/relationships.test.ts`

## Architecture

**Stack:** SvelteKit (Svelte 5) + TypeScript · Prisma + SQLite · Cytoscape.js · Leaflet · Tailwind · Vitest + Playwright

**Single-owner app.** The first `AppUser` is the owner. Setup is locked once an owner exists. Auth via Argon2id + HttpOnly cookie sessions (`src/lib/server/auth.ts`). Route guard lives entirely in `src/hooks.server.ts`; `/api/mcp` is exempt (Bearer-Token auth instead).

**Layer structure:**

| Layer | Path | Role |
|---|---|---|
| Domain logic | `src/lib/domain/` | Pure functions, no DB. Relationship rules (V-1…V-8), imprecise dates, password policy. Unit-tested. |
| Server services | `src/lib/server/` | DB access via Prisma. `relationshipService.ts` enforces domain rules on every write. `mcp.ts` exposes 14 MCP tools. |
| Routes | `src/routes/(app)/` | SvelteKit load functions + form actions. Views: graph, personen, karte, pair, ereignisse, einstellungen. |
| MCP server | `POST /api/mcp` | Streamable HTTP, stateless, Bearer-Token via `RELATABLE_MCP_TOKEN`. Runs inside the same process as the app. |

**Connection canonicalization:** Connections are stored with `personLowId < personHighId` always. Use `canonicalPair()` from `src/lib/domain/relationships.ts` before any DB lookup on connections — never assume direction.

**Relationship rules** are enforced in `relationshipService.ts` (not at the route level). The domain functions in `src/lib/domain/relationships.ts` return `{ok, error}` — check `ok` before writing.

**Imprecise dates:** Dates can be exact, month-only, year-only, or unknown. The `ParsedImprecise` type from `src/lib/server/impreciseTime.ts` carries `kind`, `date`, and `text`. DB stores `validFromKind`/`validFrom`/`validFromText` triples — never store just a Date for user-entered times.

**Data directory:** `./data/` holds `relatable.db` and uploaded profile images. E2E tests use `data/e2e.db` (never `relatable.db`).

**Map provider:** Defaults to OpenStreetMap/Leaflet. `PUBLIC_MAP_PROVIDER=google` + `PUBLIC_GOOGLE_MAPS_API_KEY` switches to Google Maps (abstraction already in place).
