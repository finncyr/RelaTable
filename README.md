# RelaTable

Private, self-hosted relationship graph for **one** owner. Manage people, their
connections (with historized relationship periods), shared events, and explore
the network as a **graph**, a **map**, and per-pair detail views.

Built to the specs in [`docs/`](docs/) (Reviews 1–3). Stack per DEC-019:
**SvelteKit + TypeScript · Prisma + SQLite · Cytoscape.js · Leaflet/OSM ·
Tailwind · Argon2id · Vitest + Playwright.**

---

## Quick start (local, no Docker)

```bash
# 1. Install dependencies (also runs `prisma generate`)
npm install

# 2. Create local env + database
cp .env.example .env
npm run db:push        # create the SQLite schema in ./data/relatable.db
npm run db:seed        # reference data + a demo owner & sample network

# 3. Run
npm run dev            # http://localhost:5173
```

The seed creates a **demo owner** so you can explore immediately:

> Login password: `Demo-Passwort-12345!`

To experience the **first-run setup** instead (no account yet), seed reference
data only:

```bash
npm run db:reset       # wipes & recreates with demo data
# …or for a clean first-run:
SEED_DEMO=0 npm run db:reset
```

The database (`relatable.db`) and uploaded profile images both live under
`./data/`, which is the single directory you back up or mount as a volume.

---

## What's implemented

| Area | Screens | Status |
| --- | --- | --- |
| Shell: icon rail (hover-expand, pin) + mobile tab bar | SCR-001…004 | ✅ |
| First-run setup, login, sessions, route guards | SCR-001/002 | ✅ |
| Personen: list (search/filter/sort), create/edit, profile, delete | SCR-010…013 | ✅ |
| Graph (Cytoscape): node panel, focus (depth 1, animated), edge → pair, long-press | SCR-020…022 | ✅ |
| Connections: create a pair + relationship type (imprecise start) | SCR-040 | ✅ |
| Pair actions (rule-enforced): set Nähegrad, start/end Romantik + follow-status, Freundschaft Plus, context type, end period, journal | SCR-041…046 | ✅ |
| Pair details: history, common events, journal | SCR-030/031 | ✅ |
| Ereignisse: list (search/filter/sensitive), create/edit/delete, participants ≥1, imprecise date | SCR-050/051 | ✅ |
| Karte (Leaflet/OSM): layers, clustering, missing-location list | SCR-060/061 | ✅ |
| Einstellungen: types, exclusion rules, event types, theme, sensitive, backup | SCR-081/082 | ✅ |
| Notion import | — | programmatic one-time script (no UI) |
| MCP-Server (Remote) | `/api/mcp` | ✅ Streamable HTTP, 14 Tools, Bearer-Token |
| Timeline / Finder | SCR-052/08 | not in V1 |

**Navigation rail** shows Graph · Personen · Karte · Einstellungen. Ereignisse,
Timeline and Finder are out of this build.

The **relationship rules** (closeness exclusivity, romance blocks/ends, period
historization, V-1…V-8) live as a pure, unit-tested domain service in
[`src/lib/domain/relationships.ts`](src/lib/domain/relationships.ts) and are
enforced on every write through
[`src/lib/server/relationshipService.ts`](src/lib/server/relationshipService.ts).
The pair **Aktion** menu drives them from the UI (e.g. a Nähegrad is refused
during an active romance). The polished step-by-step dialog screens of Block 5
are not reproduced 1:1, but their logic and outcomes are.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server (Vite) on :5173 |
| `npm run build` / `npm start` | Production build (adapter-node) / run it |
| `npm run check` | Type-check (`svelte-check`) |
| `npm test` | Vitest domain unit tests |
| `npm run e2e` | Build + Playwright E2E (isolated test DB) |
| `npm run e2e:install` | Install the Playwright Chromium browser (one-off) |
| `npm run db:push` / `db:seed` / `db:reset` / `db:studio` | Prisma helpers |
| `npm run import:notion` | One-time Notion import (see below) |

### Tests

```bash
npm test               # 25 domain unit tests (password policy, imprecise time,
                       # relationship rules, canonical pairs)
npm run e2e:install    # once
npm run e2e            # 15 end-to-end tests across the critical flows
```

E2E runs the production build against an isolated `data/e2e.db`; it never
touches your dev database.

---

## MCP-Server (Remote, Streamable HTTP)

Ein MCP-Server läuft **mit der App** unter `POST /api/mcp` (Streamable HTTP,
zustandslos). Damit kann ein LLM-Client (ChatGPT, Telegram-Bot, Claude) das
Netzwerk lesen und schreiben — z. B. eine Sprach-zu-Text-Nachricht über ein
Treffen zwischen Louis und Conny parsen, vorab Personen/Typen nachschlagen,
Rückfragen stellen und schließlich Beziehungen/Ereignisse/Personen anlegen
oder aktualisieren.

**Auth:** Bearer-Token via `RELATABLE_MCP_TOKEN` (Env). Fail-closed: ist der
Wert leer, antwortet der Server mit 503. Token im Client als
`Authorization: Bearer <token>` mitsenden. Über HTTPS exponieren.

**Tools** ([`src/lib/server/mcp.ts`](src/lib/server/mcp.ts)) — 13 Stück:

| Tool | Zweck |
| --- | --- |
| `search_persons` | Namen/Stadt/Notiz case-insensitiv suchen (leer = alle) |
| `get_person` | Person + Verbindungen (mit connectionId, Historie) + Ereignisse |
| `get_event` | Ereignis + Teilnehmer/Typ/Ort/Notiz |
| `list_relationship_types` | Valide Beziehungstypen (Kategorie, Rang, aktiv) |
| `list_event_types` | Valide Ereignistypen (Sensitivität, aktiv) |
| `get_import_schema` | Schema-Referenz `docs/import/json-schema.md` |
| `preview_import` | Import-JSON validieren (transaktional, kein Schreiben) |
| `apply_import` | Import-JSON endgültig anwenden (Create-only: Personen/Verbindungen/Ereignisse/Zeiträume/Journal) |
| `update_person` | Person patchen (Geburtstag, Notiz, Stadt, …) |
| `update_event` | Ereignis patchen (Name, Typ, Datum, Teilnehmer, …) |
| `start_relationship` | Beziehungstyp starten/wechseln (regelerzwungen via `relationshipService`) |
| `end_relationship` | Aktiven Beziehungszeitraum beenden (nicht Romantik) |
| `end_romance` | Romantik beenden mit Folge-Status (V-5) — LLM muss User vorher fragen |
| `add_journal` | Tagebuch-Eintrag zu einer Verbindung hinzufügen |

Owner = erster `AppUser` (Single-Owner-App). Ein `npm run dev`/`npm start`
startet den MCP-Server mit; kein separater Prozess nötig.

**Workflow-Beispiel (Voicemail → RelaTable):**
1. Client postet Transkript → LLM ruft `search_persons` ("Louis", "Conny")
2. `get_person` liefert connectionIds + Bestand → neu oder ergänzen?
3. `list_relationship_types` + `list_event_types` für valide Werte
4. Rückfragen an User (Datum, wer noch dabei?) via Chat/Telegram
5. `start_relationship` (regelerzwungen) + `apply_import` (Event anlegen)
   oder `update_person` (Geburtstag nachtragen)
6. `add_journal` für die Notiz zum Treffen

### MCP testen

**Automatisiert** (ohne DB): `npm test` — prüft Tool-Registrierung, `tools/list`
über Streamable HTTP, Bearer-Token-Guard (401/503/200).

**Mit Claude Code** (lokal):

```bash
# 1. Token erzeugen und in .env eintragen
echo "RELATABLE_MCP_TOKEN=$(openssl rand -hex 32)" >> .env

# 2. App starten
npm run dev   # http://localhost:5173

# 3. MCP-Server in Claude Code registrieren (in anderem Terminal)
claude mcp add --transport http relatable \
  http://localhost:5173/api/mcp \
  -H "Authorization: Bearer $(grep RELATABLE_MCP_TOKEN .env | cut -d= -f2 | tr -d '\"')"

# 4. In Claude Code testen
claude
> liste alle Personen in meiner RelaTable
> suche nach "Conny"
> beende die Romantik zwischen Louis und Conny (frag mich nach dem Folge-Status)
```

Alternativ manuell in `.mcp.json` (Projekt-Root) oder `~/.claude.json`:

```json
{
  "mcpServers": {
    "relatable": {
      "type": "http",
      "url": "http://localhost:5173/api/mcp",
      "headers": { "Authorization": "Bearer <dein-token>" }
    }
  }
}
```

**Mit curl** (Schnelltest ohne Client):

```bash
TOKEN="<dein-token>"

# Tools listen
curl -s http://localhost:5173/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Person suchen
curl -s http://localhost:5173/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_persons","arguments":{"query":"Conny"}}}'
```

---

## Notion import (one-time, programmatic)

There is no import wizard — the import runs once from the CLI (DEC-003/024):

```bash
# Configure NOTION_TOKEN and NOTION_DB_* ids in .env, then preview:
npm run import:notion
# Apply for real:
npm run import:notion -- --apply
```

It is idempotent (`ExternalImportMap` prevents duplicates), skips relations with
more than two people, and prints a created/skipped/conflict/error report. Adapt
the `MAPPING` block in [`scripts/import-notion.ts`](scripts/import-notion.ts) to
your Notion property names.

---

## Deployment (VPS, Docker)

```bash
docker compose up -d --build
```

- One container, one persistent volume at `/data` (SQLite + uploads).
- Set `ORIGIN` to your public HTTPS URL (needed for form/CSRF protection).
- Put a TLS-terminating reverse proxy (Caddy/Traefik/nginx) in front.
- Backup = download the package from **Einstellungen → Backup** (a
  `tar.gz` of `/data`), or snapshot the volume.
- **`.env` for Docker:** the Dockerfile already sets `DATABASE_URL="file:/data/relatable.db"`
  and `DATA_DIR="/data"` for the container. Do **not** copy `.env.example`'s
  `DATABASE_URL="file:../data/relatable.db"` into the `.env` used by
  `docker-compose.yml` — that path is relative to `prisma/schema.prisma` and is
  only correct for local (non-Docker) dev; inside the container it would
  resolve outside the `/data` volume. Leave `DATABASE_URL`/`DATA_DIR` unset in
  the Docker `.env` and let the image defaults apply.

The map uses keyless **OpenStreetMap/Leaflet** by default. To switch to Google
Maps later, set `PUBLIC_MAP_PROVIDER=google` and `PUBLIC_GOOGLE_MAPS_API_KEY`
(provider abstraction is in place; DEC-025).

---

## Security notes

- Single owner account, Argon2id password hashing, HttpOnly cookie sessions.
- All app + API routes require auth (`src/hooks.server.ts`); uploads are
  served only to the authenticated owner.
- Password policy (DEC-032): ≥ 16 chars, upper + lower, digit, special.
- Sensitive event types (e.g. `Sex`) are hidden by default behind a toggle.
- Production cookies are `Secure`; serve over HTTPS.
