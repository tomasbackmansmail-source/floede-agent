# FLOEDE ENGINE — CLAUDE.md

> Teknisk onboarding för alla som arbetar i detta repo: Claude Code-instanser,
> subagenter, Agent SDK, CTO-chattar. Läs HELA filen innan du skriver kod.
> För nuläge, aktiva uppgifter och beslut: se `CONTEXT.md`.

## VARFÖR DETTA REPO FINNS

Floede Engine — autonom motor som hittar, extraherar, QC:ar och underhåller
dataströmmar från offentliga källor (kommuner, myndigheter, institutioner).
Motorn vet inte vilken vertikal den kör. Allt styrs av config-filer. Ny vertikal
= ny JSON-fil + Supabase-tabell + VERTICAL env-variabel. Ingen kodändring.
Motorn är Floedes IP. Vertikala produkter byggs ovanpå den i separata repos.

## VERTIKALER

| Vertikal | Config-fil | Supabase | Vad den gör |
|----------|-----------|----------|-------------|
| ByggSignal | byggsignal.json | abnlmxkgdkyyvbagewgf | Bygglovsdata från svenska kommuner |
| Client Intelligence | ci-pressroom.json | qvmthuylldpzcoyzryqe | Projektsignaler från organisationers pressrum |
| Search & Compliance | (under utveckling) | ebtfvaalsguniuyywjrb | Regulatorisk compliance för kosttillskott |

Vertikalerna kan sälja data till varandra. CI är intern kund till ByggSignal.

## ARKITEKTUR

### Config-driven pipeline

Varje vertikal är en JSON-fil i `src/config/verticals/` med fälten:
`extraction_prompt`, `keywords`, `model`, `source_label`, `supabase_url`,
`supabase_key_env`, `db.*` (tabell, field_mapping, conflict_key, enrichment,
dedup), `discovery.*`, `qc.*`, `feedback.*`.

### Daily-run (daglig extraction)

1. Läs godkända configs (config_table i vertikalconfig).
2. Fas 0: adapters (Ciceron / MeetingPlus / NetPublicator) — strukturerad data, ingen LLM.
3. Fas 1: HTTP fetch (~70 % HTML). Fas 2: Playwright (JS-renderade, ~30 %).
4. `fetchPageHttp` och `fetchPagePlaywright` returnerar `{subpages: [{url, content, isPdf}]}`.
   Listing utan `requires_subpages` = ett element med listing_url.
5. Subpage-URL:er dedupliceras på href (Set) innan extraction-loopen.
6. Main-loopen itererar per subpage och anropar `extractPermits` en gång per enhet
   med `subpage.url` som deterministisk `sourceUrl`. Ingen SUBPAGE-marker-concat.
7. Per-subpage content hash: `config.subpage_hashes = {url: hash}`. Hash-match skippar LLM.
8. Varje permit tagg:as med `_raw_html_hash` från sin subpage innan insert.
9. Insert via field_mapping + enrichment-lookup. Dedup via `conflict_key` / `dedup_fields`.
10. Alert vid 0 records (Resend). Trigger notify endpoint (bevakningsmail).

### Discovery (hitta nya datakällor)
Eskalerar bara när billigt misslyckas: URL-varianter ($0) → crawl ($0) →
sitemap ($0) → Haiku (~$0.001) → Sonnet (~$0.15).

### Feedback-loop (självläkande)
QC detekterar zero-streak → `discoverSource()` → verify extraction →
auto-approve om verified/needs_browser → nästa daily-run använder ny config.

### Agent-runner
Railway cron triggar `agent-runner.js`. Läser pending tasks från `agent_tasks`.
Fallback: inga tasks → kör daily-run + QC för alla vertikaler.
Budget per task (`max_cost_usd`) och per körning (`AGENT_MAX_COST_PER_RUN_USD`).

## DATABASSCHEMA

### permits_v2 (ByggSignal)
Unique constraints:
- `permits_v2_pkey`: PRIMARY KEY (id)
- `permits_v2_municipality_case_number_key`: UNIQUE (municipality, case_number)
- `idx_permits_v2_dedup_fallback`: UNIQUE (municipality, address, date)

`raw_html_hash TEXT` — sätts per-record från den subpage permitet extraherades
från, inte som aggregat per källa. Audit-trail, läses inte av motorn.

### ci_signals (CI)
Schema ägs av clientintelligence-repot. `raw_html_hash` finns och sätts
per-record på samma sätt som permits_v2.

## REPO-STRUKTUR

```
src/
  daily-run.js        — Daglig extraction (körs via agent-runner.js)
  discover.js         — Discovery av nya datakällor
  qc.js               — Kvalitetskontroll + feedback-loop
  agent-runner.js     — Orkestrator: läser tasks, kör jobb, rapporterar
  sdk-runner.js       — Research/debug via Anthropic Messages API
  utils/              — discovery, engine (html), retry, normalize
  config/verticals/   — Vertikal-configs (JSON)
  adapters/           — Ciceron, MeetingPlus, NetPublicator (strukturerad data)

.claude/
  skills/floede-overview/   — Affärskontext (CEO-ägd)
  agents/                   — Subagent-definitioner
```

## SÅ HÄR KÖR DU SAKER

```bash
VERTICAL=byggsignal node src/daily-run.js
VERTICAL=ci-pressroom node src/daily-run.js --source="Statens fastighetsverk"
VERTICAL=byggsignal node src/discover.js --source="Aneby"
VERTICAL=byggsignal node src/qc.js
npm test                                         # kör ALLTID innan push
```

### Deploy
```bash
git add -A && git commit -m "..." && git push
railway up --service floede-agent --detach       # manuell deploy — GitHub-triggern skör
```
**Deploya ALDRIG mellan 03:00–05:00 UTC** (cron kör 04:00 UTC = 06:00 CEST).

## ENV-VARIABLER

| Variabel | Syfte |
|----------|-------|
| ANTHROPIC_API_KEY | LLM-anrop |
| SUPABASE_URL | ByggSignal + motortabeller |
| SUPABASE_SERVICE_KEY | ByggSignal |
| CI_SUPABASE_SERVICE_KEY | CI-projektet |
| RESEND_API_KEY | Mailutskick |
| CRON_SECRET | Skyddar cron-endpoint |
| NOTIFY_URL | Trigger bevakningsmail efter daily-run |
| AGENT_MAX_COST_PER_RUN_USD | Budget per agent-körning (default 10.00) |

## REGLER

### Kod
- Node.js ESM (import, inte require).
- **Motorns kod ska ALDRIG vara vertikal-specifik; produkten ska aldrig vara generell.**
- HTTP-fetch före Playwright. Haiku före Sonnet.
- Fält som inte kan extraheras = null. Aldrig gissning.
- Alla å, ä, ö korrekta. Inga emojis.
- Ett repo = en CC-instans. Aldrig flera parallella CC på samma repo.
- Datakontrakt: alla schemaändringar och nya invarianter måste matcha `docs/data-contract-engine.md`. Ändringar kräver versionsbump och CEO-godkännande. Brytpunktsdatum framför backfill.

### Cron-tider
- Alltid UTC med svensk tid som kommentar:
  `cron = '0 5 * * *'  # 05:00 UTC = 07:00 CEST / 06:00 CET`
- Källa till sanning: `railway.toml` eller Railway-dashboarden.

### GDPR
- `applicant`-fältet i permits_v2 får BARA innehålla organisationer
  (AB, BRF, HB, KB, kommun, region, stiftelse, förening).
- Privatperson = null, alltid. Dubbelfilter: prompt + kod.
- Innan varje CC-prompt som rör persondata: "kan detta fånga privatpersoners namn?"

### Verifiering
- Verifiera innan du påstår. Läs loggar till slutet. Citera aldrig sådant som inte
  syns i aktuell konversation. "Jag vet inte, låt mig kolla" > gissning.
- Aldrig anta konfigurationsvärden (mailadresser, domäner, priser, databasnamn).

### Kontakt
- Tomas: tomasbackman@mac.com. ByggSignal Resend from: hej@byggsignal.se (BARA ByggSignal).
- Floede äger INTE `floede.se` — använd aldrig @floede.se.
- Stripe Payment Links skapas manuellt av Tomas — aldrig via API.

## ARBETSFLÖDE

Tre lager av exekvering:
- **Lager 1: Chattar (claude.ai)** — CEO, CTO, UX. Strategi, beslut, formulering.
- **Lager 2: CC med subagenter (terminalen)** — `.claude/agents/`:
  source-researcher, config-builder, qa-verifier.
- **Lager 3: Agent SDK (agent-runner.js)** — Railway cron. Rapport via Resend.
  Uppgiftstyper flyttas hit när de fungerat pålitligt i lager 2.

`.claude/skills/floede-overview/` innehåller affärskontext (vision, kunder,
priser, roadmap, lärdomar). Ägs av CEO. Ändra aldrig utan Tomas godkännande.

## KODDISCIPLIN

- **search_terms** måste innehålla enskilda ord ("bygglov", "pressrum"),
  inte flerordiga fraser. `string.includes()` matchar aldrig fraser i HTML.
- **~95 % av källor fungerar med HTTP fetch.** Verify extraction flaggar
  `needs_browser` istället för att försöka JS-rendering.
- **Steg 0 vid ny pipeline:** sök om en aggregator redan finns.
- **`normalizeMunicipality()`** strippar "kommun"/"stad"-suffix. Körs bara
  när `SOURCE_LABEL === "Kommun"` — inte för CI.
- **Kostnadsberäkning** via `MODEL_COSTS`-objekt, inte hårdkodade konstanter.
- **Innehåll < 500 bytes efter `stripNonContent` får aldrig hashas.**
  Returnera `content_too_small`-fel från `extractPermits`.
- **Daily-run respekterar `subpage_hashes` / `content_hash` bara om
  `config.verified === true`.** Overifierade configs körs alltid utan
  hash-skip — annars kan tom HTML hashas och låsa källan permanent.

## INFRASTRUKTUR

| Tjänst | Vad | Detaljer |
|--------|-----|---------|
| GitHub | Repo | tomasbackmansmail-source/floede-agent (privat) |
| Railway | Motor + cron | floede-agent, Hobby ($5/mån) |
| Railway | ByggSignal frontend | byggsignal-web, live på byggsignal.se |
| Railway | S&C frontend | searchandcompliance, live på searchandcompliance.com |
| Supabase | Databas | Tre projekt (ByggSignal, CI, S&C) |
| Stripe | Betalning | ByggSignal |
| Resend | Mail | Bevakningsmail + agent-rapporter |
| Cloudflare | DNS | byggsignal.se, searchandcompliance.com |

Vercel är helt avvecklat.

## Senast uppdaterat 2026-04-25
- Empty-HTML-tröskel (500 bytes) i `extractPermits` — returnerar `content_too_small`, hash + LLM skippas.
- Daily-run hash-check kräver nu `config.verified === true` (subpage- och adapter-grenarna).
- Hash-skip-räknare i daily-run-rapporten + Resend-mail (`Hash-skipped: X/Y källor`).
- QC: aktiva kommuner (≥5 permits/30d) med 0 ärenden mån-fre triggar direktlarm via Resend om antalet > 30 (parallellt med 3-dagarsregeln).
- `loadApprovedConfigs` + `parseConfigRows` exponerar `verified` på config-objektet.
- Cron-tid korrigerad i kod och docs: 04:00 UTC, inte 13:00.
- Datakontrakt v0.1 etablerat: Lager 1 i `docs/data-contract-engine.md`, Lager 2 ByggSignal i byggsignal-repot. Tvålagermodell godkänd av CEO.
- MeetingPlus + NetPublicator-adaptrarna sätter nu source_url per record (var null, orsakade 6916 null-rader sedan 16 mar och blockerade Ånge inserts via unique constraint). Commit 1e72d56.

## Senast uppdaterat 2026-04-24
- Motorn satter source_type fran config (verticalConfig.default_source_type eller sourceConfig.source_type_override), inte LLM. extractPermits rad 361-367.
- ci-pressroom.json har default_source_type = "pressroom" pa top-level.
- ci-pressroom extraction_prompt hanterar TYP A + TYP B i samma prompt med stramad delprojekt-regel.

## Senast uppdaterat 2026-04-22
- fetchPage-funktionerna returnerar `{subpages: [...]}` (commit 4f4baff)
- Subpage-URL dedup innan extraction (commit 1512e8e)
- raw_html_hash per-record från subpage-hash
- ci-pressroom.json utökad med source_excerpt + ai_summary

Äldre poster: se `docs/changelog.md` (notera: 2026-04-22-posten ska flyttas dit nasta gang den ar 2-3 veckor gammal).
