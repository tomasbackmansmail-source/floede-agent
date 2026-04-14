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

## Senast uppdaterat 2026-04-13

### Motor
- PDF-stod i daily-run: content-type detection, base64 document-typ till Messages API
- source_type_filter i loadApprovedConfigs: vertical config kan filtrera ci_sources pa source_type
- HTTP timeout okad till 180s for PDF och stora kallor
- Config-driven QC validation: required_fields, allowed_values, numeric_ranges i vertical config
- loadBaselines() config-driven: source_field och date_field fran qc.validation

### CI
- ci-annualreport.json: ny vertical config for PDF-extraktion av arsredovisningar
- ci-pressroom extraction_prompt: source_url extraheras fran link-falt, source_type satts till "pressroom"
- Forsta PDF-extraktion lyckad: Akademiska Hus Q1 2025, 11 projekt, $0.16

## Senast uppdaterat 2026-04-08

### Motor
- 272/290 kommuner med verifierad data i permits_v2
- Pipeline grön 4 dagar i rad
- interactWithPage() live i discovery — Playwright + LLM navigerar dropdowns och sökfält
- Adaptrar live: Ciceron (14), MeetingPlus (7), NetPublicator (10) — $0 LLM per kommun
- Feedback-loop live: QC 0 ärenden 3 dagar → discoverSource automatiskt
- Namnormalisering: strippar "kommun", "stad", genitiv-s automatiskt
- Content hashing: full LLM vid första körning, $0 vid oförändrat innehåll
- Discovery följer nu externa länkar (NetPublicator, MeetingPlus etc.)
- docs/motor-insikter-april-2026.md: 10 dokumenterade lärdomar från stabiliseringsarbetet

### CI
- 320+ signaler, 228 ci_properties, 13 bygglov-matchningar
- Alla 7 pipeline-steg körs grönt på Railway
- CI kör autonomt för första gången (miljövariabler fixade 2026-04-05)
- Timeout 4h (var 60 min)
- Resend from-adress fixad

### Principer
- Adaptrar före scraping — kolla alltid om plattformen har API
- Fas 0: sök befintliga register/aggregatorer innan agentisk discovery
- Plan Mode obligatoriskt för alla motorändringar: claude --permission-mode plan
- Mät med SQL, inte antaganden
- Läs loggar, inte statusikoner

## Senast uppdaterat 2026-04-05

- Miljövariabler: varje vertikal i agent-runner kräver verifierade env vars i Railway INNAN den anses live. CI saknade credentials i månader utan att någon märkte.
- Railway "succeeded" = process.exit(0), inte att alla steg lyckades. agent-runner fångar fel och exiterar OK. Läs loggarna, inte statusikonen.
- Content hashing sparas bara vid lyckad extraction. Första körningen med nya configs triggar alltid full LLM på alla — förväntat men dyrt. Hashar byggs upp successivt.
- execSync timeout i agent-runner är den enda tidsgränsen — Railway har ingen max-körtid för cron. Satt till 4h (14_400_000 ms) efter att 60 min inte räckte för 292 configs.
- Railway cron: om en körning fortfarande är aktiv när nästa scheduled körning ska starta, skippas den nya. Processen måste avsluta sig själv.
- Railway-körning triggas manuellt via railway.com-dashboarden eller railway run — INTE från CC-session. CC-körning dör när locket stängs.
- Arbetsflödesprincip: Railway = autonomt serverside (motor, cron, nattjobb). CC = interaktivt lokalt (kod, config, felsökning). Blanda inte.

## Senast uppdaterat 2026-04-04

- data/villaagarna-komplett.json: 290 kommuner med verifierade anslagstavle-URL:er, redo att seedas i discovery_configs
- data/villaagarna-fixade-urls.json: 29 kommuner med korrigerade URL:er
- data/villaagarna-validation.json: HTTP health check resultat alla 290 URL:er
- docs/aao-standard.md: ÅÄÖ-normaliseringsstandard, NFC överallt, normalize-funktion 18 rader JS, 290 kommun-domän-mappningar
- docs/fas0-vertikaler.md: research detaljplaner (NGP 162/290, Combify) och miljötillstånd (fragmenterat, ingen aggregator)
- src/validate-villaagarna-urls.js: HTTP health check script, återanvändbart
- Fas 0 formaliserad: sök alltid efter befintliga register/aggregatorer INNAN agentisk discovery
- ByggSignal motorstatus: 148 kommuner med data, 128 failed. Villaägarna-seedning planerad söndag 6 april
- Motorförbättringar live: eskalering vid >20% zero-streak, max_rediscoveries 50/dag, täckningsrapport i daglig mail
- Playwright browser restart var 30:e källa (inte 80)
- Auto-eskalering HTTP→Playwright på zero-permit verified sources
- CI: 320+ signaler, 228 ci_properties, 13 bygglov-matchningar, TED live, projektgruppering live
- CI cron-ordning: daily-run → QC → match-properties → ted-sync → group-signals
- CI cron 06:00 CEST
- ci_user_profiles med Fredriks filter seedad manuellt
- Akademiska Hus fastighetsförteckning 2025 extraherad till ci_properties (71 fastigheter)
- TED API: anonymt, gratis. SFV 216 träffar, Akademiska Hus 294 träffar. Stockholms stad 3, Vasakronan 0
- Parallella CC-sessioner: starta alltid med cd ~/floede-agent i prompten

## Senast uppdaterat 2026-04-03

- Homepage-lookup i QC fixad: case-insensitive + ÅÄÖ-normalisering i homepageMap
- 23 ÅÄÖ-dubbletter raderade från discovery_configs (303 → 282 configs)
- 141 kommuner re-discovered med nya URL:er via tre QC-batchar ($3.09)
- Auto-eskalering HTTP → Playwright i daily-run vid 0 permits från verifierad källa
- Verify extraction kräver >0 items för auto-approve, flaggar needs_browser vid keyword-match
- Discovery-prompt förbättrad: letar efter listade ärenden, inte informationssidor
- QC-alerts visar korrekta ÅÄÖ-namn via displayNameMap
- Playwright browser-restart var 30:e source (var 80:e)
- 7 nya tester för ÅÄÖ-hantering
- Akademiska Hus: 71 fastigheter importerade till ci_properties
- match-properties.js: 13 bygglov-matchningar (228 properties totalt)
- Cron: 04:00 UTC (06:00 CEST) live efter railway up

## Senast uppdaterat 2026-04-02

- Per-källa model override i extractPermits: sourceConfig.model overridar verticalConfig.model
- match-properties.js: matchar ci_properties mot permits_v2, skapar ci_signals, integrerad i agent-runner
- ted-sync.js: hämtar upphandlingar från TED Search API för SFV och Akademiska Hus, integrerad i agent-runner
- ci_projects-tabell skapad, group-signals.js grupperar signaler automatiskt via fastighetsbeteckning + Haiku
- group-signals.js integrerad i agent-runner efter ted-sync
- Daglig körordning: daily-run → QC → match-properties → ted-sync → group-signals
- region i extraction_prompt: "Nationellt" istället för null för nationella signaler
- CI dashboard live med projektgruppering, tidslinjer, source_type-badges
- source_type-fält i ci_signals: pressroom/permit/ted
- region-fält i ci-pressroom.json extraction
- category-fält i ci-pressroom.json: commercial/residential/infrastructure/public/mixed
- ci_user_profiles-tabell skapad, Fredrik Johansson seedad med Stockholms län + exkluderar residential
- extraction_prompt: organization_name hämtas från kontext, inte HTML (koncernfix)
- ci_signals unique constraint: (organization_id, source_url, title)
- ci-pressroom.json: alert_email fixad från @floede.se till tomasbackman@mac.com
- agent-runner.js: from-adress fixad, match-properties + ted-sync tillagda i fallback
- cron ändrad från 13:00 UTC till 04:00 UTC (06:00 CEST)
- VERTICAL-namn i docs: ci -> ci-pressroom
- .claude/agents/: source-researcher, config-builder, qa-verifier
- AGENTS.md skapad
- .claude/skills/floede-overview/: 6 CEO knowledge-filer
- Lokal körning: node --env-file=.env
