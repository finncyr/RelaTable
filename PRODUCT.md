# RelaTable

## Register

Product. RelaTable is a personal relationship-management tool, not a marketing surface. Every screen (Graph, Karte, Personen, Ereignisse, Einstellungen) is a working view the owner uses to record and review their own social network. Design serves the task; it doesn't sell anything.

## Users & Purpose

Single-owner app — one person (the account owner) tracks people they know: relationships, connection history, events, locations, and now personal details (interests, food/allergies, gift ideas). The owner uses it privately, likely in short sessions (adding a note after meeting someone, checking a birthday before an event). The primary job on any given screen is fast, low-friction data entry and quick lookup — not exploration or discovery.

## Brand Personality

Ruhig & zurückhaltend (calm, restrained). Reflected in the existing token system: near-monochrome neutrals (ink/mut/line/bg/card/rail), a single grayscale accent, and two semantic colors (warn = amber/orange, ok = green) reserved for meaning, not decoration. The data itself (people, relationships, private notes) is sensitive — the UI should feel quiet and trustworthy, not showy.

## Anti-References

No CRM/SaaS look. Avoid the Linear/Notion/Salesforce dashboard register — no heavy card grids, no gradient accents, no dense enterprise chrome. This is a private tool for one person, not a B2B product being sold to a team.

## Accessibility

Standard WCAG body-text contrast (≥4.5:1) against both the light and dark token sets already defined in `src/app.css`. No stated additional requirements beyond that.

## Existing Design System

Tailwind, tokens in `src/app.css` (`--c-ink`, `--c-mut`, `--c-line`, `--c-bg`, `--c-card`, `--c-rail`, `--c-accent`, `--c-warn`, `--c-ok`, light + `.dark` variant). Component classes: `.btn`, `.btn-primary`, `.btn-warn`, `.btn-sm`, `.inp`, `.card`, `.chip`, `.label`, `.avatar`. Reuse these; don't introduce a parallel system.
