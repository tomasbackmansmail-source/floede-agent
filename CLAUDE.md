# FLOEDE ENGINE — CLAUDE.md

> Kunskapsbas för alla som arbetar i detta repo: Claude Code-instanser,
> subagenter, Agent SDK, och CTO-chattar.
> Läs HELA filen innan du skriver kod.

---

## VARFÖR DETTA REPO FINNS

Myndigheter, kommuner och institutioner publicerar enorma mängder data —
fragmenterat, i olika format, på tusentals webbplatser utan API:er. Ingen
samlar in det systematiskt. Floede gör det.

Detta repo (floede-agent) är Floede Engine — en autonom motor som hittar,
extraherar, kvalitetskontrollerar och underhåller dataströmmar från offentliga
källor. Motorn vet inte vilken vertikal den kör. Allt styrs av config-filer.
Ny vertikal = ny JSON-fil + Supabase-tabell + VERTICAL env-variabel. Ingen
kodändring.

Motorn är Floedes IP. Vertikala produkter byggs ovanpå den i separata repos.

## VERTIKALER

Motorn betjänar tre vertikaler idag:

| Vertikal | Config-fil | Supabase | Vad den gör |
|----------|-----------|----------|-------------|
| ByggSignal | byggsignal.json | abnlmxkgdkyyvbagewgf | Bygglovsdata från svenska kommuner |
| Client Intelligence | ci-pressroom.json | qvmthuylldpzcoyzryqe | Projektsignaler från organisationers pressrum |
| Search & Compliance | (under utveckling) | ebtfvaalsguniuyywjrb | Regulatorisk compliance för kosttillskott |

Vertikalerna kan sälja data till varandra. CI är intern kund till ByggSignal —
"har Vasakronan sökt bygglov?" är ByggSignal-data använd av CI.

---

## ARKITEKTUR

### Config-driven pipeline

Varje vertikal är en JSON-fil i `src/config/verticals/`. Filen innehåller:

- **extraction_prompt** — LLM-prompt som extraherar data ur HTML
- **keywords** — sökord för discovery
- **model** — vilken LLM som kör extraction
- **source_label** — vad en källa kallas ("Kommun" för ByggSignal, "Organisation" för CI)
- **supabase_url + supabase_key_env** — per-vertikal databasuppkoppling
- **db.*** — tabell, field_mapping, conflict_key, enrichment, dedup
- **discovery.*** — config_table, source_table, search_terms
- **qc.*** — trösklar för stale data och anomalier
- **feedback.*** — zero-streak-hantering

### Daily-run (daglig extraction)

1. Läs godkända configs från Supabase (config_table i vertikalconfig)
2. Fas 1: HTTP fetch (~70% av källor)
3. Fas 2: Playwright fetch (JS-renderade sidor, ~30%)
4. LLM-extraction (modell från config)
5. Insert till Supabase med field_mapping och enrichment-lookup
6. Dedup via conflict_key eller dedup_fields
7. Alert vid 0 records (Resend)
8. Trigger notify endpoint (bevakningsmail)

### Discovery (hitta nya datakällor)

Eskalerar bara när billigt misslyckas:

1. URL-varianter ($0) — testa {källa}.se/nyheter etc.
2. Crawl ($0) — hämta startsida, scora länkar
3. Sitemap ($0) — parsa sitemap.xml
4. Haiku (~$0.001) — AI letar URL:er i HTML
5. Sonnet (~$0.15) — fallback vid behov

### Feedback-loop (självläkande)

QC detekterar zero-streak (konfigurerat antal dagar med 0 records) →
triggar discoverSource() automatiskt → verify extraction →
auto-approve om verified eller needs_browser →
nästa daily-run använder ny config.

### Agent-runner (orkestrering)

Railway cron triggar agent-runner.js kl 13:00 UTC.

- Läser pending tasks från agent_tasks i Supabase
- Shell-tasks: kör via execSync (daily-run, QC, discovery)
- Research/debug-tasks: exekveras via sdk-runner.js (Anthropic Messages API)
- Fallback: om inga tasks → kör daily-run + QC för alla vertikaler
- Budget-kontroll: per task (max_cost_usd) + per körning (AGENT_MAX_COST_PER_RUN_USD)
- Sammanfattning via Resend efter varje körning

---

## REPO-STRUKTUR

```
src/
  daily-run.js        — Daglig extraction (körs via agent-runner.js)
  discover.js         — Discovery av nya datakällor
  qc.js               — Kvalitetskontroll + feedback-loop
  agent-runner.js     — Orkestrator: läser tasks, kör jobb, rapporterar
  sdk-runner.js       — Research/debug via Anthropic Messages API
  utils/
    discovery.js      — Discovery-utilities (verify, haiku, resolve homepage)
    engine.js         — HTML-utilities (htmlToText, extractLinks, filterByKeywords)
    retry.js          — Retry med exponential backoff
  config/
    verticals/
      byggsignal.json     — ByggSignal vertikalconfig
      ci-pressroom.json   — CI vertikalconfig

.claude/
  skills/
    floede-overview/      — Affärskontext (vision, kunder, priser, roadmap, lärdomar)
  agents/                 — Subagent-definitioner (source-researcher, config-builder, qa-verifier)
```

---

## SÅ HÄR KÖR DU SAKER

### Daily-run (en vertikal)
```bash
VERTICAL=byggsignal node src/daily-run.js
```

### Daily-run (en specifik källa)
```bash
VERTICAL=ci-pressroomnode src/daily-run.js --source="Statens fastighetsverk"
```

### Discovery (en specifik källa)
```bash
VERTICAL=byggsignal node src/discover.js --source="Aneby"
```

### QC (hela vertikalen)
```bash
VERTICAL=byggsignal node src/qc.js
```

### QC (en specifik källa)
```bash
VERTICAL=ci-pressroomnode src/qc.js --source="Statens fastighetsverk"
```

### Tester
```bash
npm test
```

Kör ALLTID `npm test` innan push.

### Deploy
CC-promptar avslutas med:
```bash
git add -A && git commit -m "..." && git push
```
Railway auto-deployar från GitHub.

**Deploya ALDRIG mellan 13:00-15:00 UTC** (cron kör kl 13:00).

---

## ENV-VARIABLER

Krävs i Railway och lokal .env:

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

---

## REGLER

### Kod

- Node.js ESM (import, inte require)
- **Motorns kod ska ALDRIG vara vertikal-specifik**
- **Produktens kod ska ALDRIG försöka vara generell**
- HTTP-fetch före Playwright. Haiku före Sonnet
- Fält som inte kan extraheras = null. Aldrig gissning
- Alla å, ä, ö korrekta. Inga emojis
- Ett repo = en CC-instans. Aldrig flera parallella CC på samma repo

### GDPR

- applicant-fältet i permits_v2 får BARA innehålla organisationer
  (AB, BRF, HB, KB, kommun, region, stiftelse, förening)
- Privatperson = null, alltid. Dubbelfilter: prompt + kod
- Innan varje CC-prompt som rör persondata: "kan detta fånga privatpersoners namn?"

### Verifiering

- Verifiera innan du påstår. Kolla faktiska siffror, läs loggar till slutet
- Citera aldrig något som inte syns i aktuell konversation
- Säg "jag vet inte, låt mig kolla" istället för att gissa
- Aldrig anta konfigurationsvärden (mailadresser, domäner, priser, databasnamn)

### Kontakt

- Tomas mail: tomasbackman@mac.com
- ByggSignal Resend from: hej@byggsignal.se (BARA för ByggSignal)
- Floede äger INTE domänen floede.se — använd aldrig @floede.se
- Stripe Payment Links skapas manuellt av Tomas — aldrig via API

---

## ARBETSFLÖDE

Tre lager av exekvering:

**Lager 1: Chattar (claude.ai)** — CEO, CTO, UX. Strategi, beslut,
formulerar uppgifter. Tomas alltid aktiv.

**Lager 2: CC med subagenter (terminalen)** — Tomas startar CC,
subagenter i .claude/agents/ gör jobbet i egna kontextfönster.
Tre roller: source-researcher (hitta/utvärdera källor),
config-builder (bygga/testa configs), qa-verifier (verifiera datakvalitet).
Tomas aktiv tid: starta + granska resultat.

**Lager 3: Agent SDK (agent-runner.js)** — Körs utan Tomas via
Railway cron. Rapport via Resend. Uppgiftstyper flyttas hit
när de fungerat pålitligt i lager 2.

### Affärskontext

Läs `.claude/skills/floede-overview/` för:
- Vision och positionering
- Kunder och validering
- Priser
- Roadmap och status
- Lärdomar och principer

Skill-filerna ägs av CEO. Ändra dem aldrig utan Tomas godkännande.

---

## KÄNDA PROBLEM

### ÅÄÖ i discovery_configs (rotorsak ej fixad)
resolveHomepage() normaliserar kommunnamn för DNS-lookup (Älvdalen → alvdalen.se).
Det normaliserade namnet läcker in i discovery_configs. Feedback-loopen misslyckas
för kommuner med å/ä/ö. Datafixen gjord (dubbletter borttagna, namn korrigerade).
Kodfixen kvarstår: resolveHomepage måste returnera det ursprungliga namnet.

### Stripe webhook + plan-fält (akut, före 30 april)
constructEvent() utkommenterad i ByggSignal. plan-fältet uppdateras inte vid
betalning. Dolt av beta-override (alla Pro till 30 april). Ägs av ByggSignal Dev.

### QC för CI
CI har inte VALID_PERMIT_TYPES/VALID_STATUSES. Guard tillagd. CI bör ha
egen validering för maturity (rumor/planned/tender/awarded).

---

## KODDISCIPLIN (lärdomar som förhindrar upprepade misstag)

- **search_terms i configs** måste innehålla enskilda ord ("bygglov",
  "pressrum"), inte bara flerordiga fraser. string.includes() matchar aldrig
  flerordiga fraser i reell HTML. Denna fix lyfte discovery hit rate från
  0.6% till 92.5%.

- **~95% av källor fungerar med HTTP fetch.** Bara ~5% behöver Playwright.
  verify extraction flaggar needs_browser istället för att försöka JS-rendering.

- **Steg 0 vid ny pipeline:** sök om en aggregator redan finns innan du bygger
  individuella scrapers.

- **normalizeMunicipality()** strippar "kommun"/"stad"-suffix. Villkorad på
  SOURCE_LABEL === "Kommun" — körs inte för CI.

- **Kostnadsberäkning** baseras på MODEL_COSTS-objekt, inte hårdkodade konstanter.

---

## INFRASTRUKTUR

| Tjänst | Vad | Detaljer |
|--------|-----|---------|
| GitHub | Repo | tomasbackmansmail-source/floede-agent (privat) |
| Railway | Motor + cron | floede-agent, cron 13:00 UTC, Hobby ($5/mån) |
| Railway | ByggSignal frontend | byggsignal-web, live på byggsignal.se |
| Railway | S&C frontend | searchandcompliance, live på searchandcompliance.com |
| Supabase | Databas | Tre projekt (ByggSignal, CI, S&C) |
| Stripe | Betalning | ByggSignal |
| Resend | Mail | Bevakningsmail + agent-rapporter |
| Cloudflare | DNS | byggsignal.se, searchandcompliance.com |

Vercel är helt avvecklat. Inga Vercel-deploys, inga vercel.json, inga api/-mappar.

---

## TESTER

Kör `npm test` före varje push. Alla tester ska vara gröna.

---

## Senast uppdaterat 2026-04-21

### Infrastruktur
- Railway-deploy av SHA 34e1cf3 aktiv sedan 20:49 UTC 21 april (PDF-stöd, source_type_filter, ci-annualreport, ci-projectpage, match-properties-fixar, ted-sync NUTS, ci-pressroom source_url nu i produktion)
- GitHub auto-deploy till Railway brutet sedan 5 april, ej diagnostiserat — alla deploys via `railway up` CLI. Samma risk i clientintelligence-repot

### Motorbuggar identifierade (ej fixade)
- `src/daily-run.js:448`: `row.raw_html_hash = null` hårdkodat i insertToSupabase. 0 av 10 031 rader i permits_v2 har hash. Content hashing inaktivt, LLM körs varje dag på oförändrad HTML
- `src/daily-run.js:256–259`: accordion-expandering i fetchPagePlaywright täcker bara `<details>` och `[aria-expanded='false']`. Missar generiska klickbara element med hidden content
- 21 kommuner drabbade av accordion-buggen (~249 permits): 100% NULL date, ~100% NULL property, 100% NULL applicant. Titlar fylls i (alltid synliga). Helsingborg 51, Tjörn 46, Örnsköldsvik 27, Tyresö 22, Ängelholm 13, Söderköping 12, Bollnäs 12, Vansbro 11, Kiruna 9, Tibro 9, Svalöv 9, Båstad 8, Åmål 6, Hörby 5, Haparanda 5, Herrljunga 2, Torsås 2, Växjö 1, Årjäng 1, Lessebo 1

### Prioriteringsordning (bekräftad av Tomas, ej förhandlingsbar)
1. Fixa accordion-expandering + raw_html_hash i samma commit i daily-run.js
2. Systematisk rediscovery av 120 misstänkt trasiga kommuner, stora först (Göteborg 32d, Uppsala 25d, Luleå 25d, Jönköping 25d, Sotenäs, Lidköping, Kungsbacka, Skellefteå, Karlstad, Täby, Härryda). 141 kommuner har 0 permits senaste 3+ dagar. Diagnostisera först via `feedback.zero_streak_threshold`, `max_rediscoveries_per_run` och `discovery_runs`-tabellen
3. Applicant via diariesystem-enrichment: 56% har case_number, mål >20% applicant. Kedja: case_number → Public 360/Platina/Ciceron Webb → GDPR-filter. Separat enrichment-steg, inte daily-run

### Unique constraints på permits_v2
- `permits_v2_pkey`: PRIMARY KEY (id)
- `permits_v2_municipality_case_number_key`: UNIQUE (municipality, case_number)
- `idx_permits_v2_dedup_fallback`: UNIQUE (municipality, address, date)
- pg_constraint-query missar index-baserade constraints — kolla `pg_indexes` också

### Städningar i permits_v2 (Supabase SQL, inte motorkod)
- 39 rader DELETE `municipality='Malung Salen'` (dubletter av "Malung Sälen")
- 5 rader UPDATE `'Falkoping'` → `'Falköping'`
- 5 rader DELETE `'Grastorp'` (address+date-dubletter av "Grästorp", sämre data)
- Total: 10 075 → 10 031 permits

### CI (ci_signals i qvmthuylldpzcoyzryqe)
- Migration: 6 nya nullable-kolumner (source_excerpt TEXT, ai_summary TEXT, structured_meta JSONB, ai_conclusion TEXT, source_quotes JSONB, match_reasons JSONB). Extraction_prompt + analyze-signals skrivs av CTO Engine
- 39 rader DELETE i ci_signals: `title LIKE 'Bygglov —%' AND source_type='pressroom' AND source_url IS NULL` (skräp från gammal match-properties). Ny kod skriver `source_type='permit'`, `source_url='permit://case/{case_number}'`

### Kvarstående (ägs av CTO Engine)
- 249 ofullständiga accordion-permits: beslut krävs om radering, markering pending re-extraction, eller tvångsomextraktion efter accordion-fix
- ci-projectpage: 9 rader 17 april fick `source_url=bas-URL` och `organization_name=null`. LLM följde inte prompt. Fix specad (post-extraction kod-validering + config-driven enrichment), ej implementerad
- Railway GitHub auto-deploy — rotorsak för 5 april-brottet ej diagnostiserad

## Senast uppdaterat 2026-04-22

- src/daily-run.js: insertToSupabase() tar rawHtmlHash som fjärde parameter, fem callsites uppdaterade (Ciceron, MeetingPlus, NetPublicator, HTTP, Browser)
- Adaptrarna (Ciceron/MeetingPlus/NetPublicator) beräknar redan SHA-256 16-tecken hex, samma format som extractPermits()
- Verifierat i produktion: ny Stockholm-permit 2026-04-22 har raw_html_hash satt (tidigare 0 av 10031 rader hade hash)
- Deployad via railway up
- npm test: 224/224 gröna
- Bugg 2 accordion-expandering ej fixad, Fas 0-research på nationella aggregatorer (kommunkartan.se m.fl.) ej körd, väntar på CEO-beslut om strategisk riktning

Äldre poster (2026-04-02 till 2026-04-13): se `docs/changelog.md`.
