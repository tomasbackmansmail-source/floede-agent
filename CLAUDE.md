# FLOEDE ENGINE — CLAUDE.md

> Denna fil är kunskapsbasen för alla som arbetar i detta repo:
> Claude Code-instanser, Agent SDK-agenter, och CTO-chattar.
> Uppdateras efter varje session. Läs HELA filen innan du skriver kod.

## VAD ÄR FLOEDE

Floede AB gör offentlig data användbar. Myndigheter, kommuner och institutioner
publicerar data fragmenterat, i olika format, på tusentals webbplatser utan API:er.
Floede har byggt en autonom motor som hittar, extraherar och underhåller dataströmmar
utan manuellt arbete per källa. Varje källa som löses gör motorn smartare.

Tre lager:
- Lager 1: Motorn (detta repo) — autonom discovery, extraction, QC, feedback-loop
- Lager 2: Enrichment — officiell statistik, register, öppna dataset
- Lager 3: Vertikala produkter — där kunden betalar

Tre vertikaler idag:
- ByggSignal (live) — bygglovsdata från 290 svenska kommuner
- Client Intelligence / CI (pilot) — enterprise account intelligence för bygg-KAMs
- Search & Compliance / S&C (MVP) — regulatorisk compliance för kosttillskott

Vertikalerna kan bli egna bolag. De säljer data till varandra. CI är första interna
kund till ByggSignal — "har Vasakronan sökt bygglov?" är ByggSignal-data använd av CI.

## REPO-STRUKTUR

```
src/
  daily-run.js        — Daglig extraction. Railway cron kör denna via agent-runner.js
  discover.js         — Discovery av nya datakällor
  qc.js               — Kvalitetskontroll + feedback-loop
  agent-runner.js      — Orchestrator. Läser tasks från Supabase, kör jobb
  sdk-runner.js        — Exekverar research/debug-tasks via Anthropic Messages API
  utils/
    discovery.js       — Discovery-utilities (verify, haiku discovery, resolve homepage)
    engine.js          — HTML-utilities (htmlToText, extractLinks, filterByKeywords)
    retry.js           — Retry-wrapper med exponential backoff
  config/
    verticals/
      byggsignal.json  — ByggSignal vertikalconfig
      ci-pressroom.json — CI vertikalconfig
```

## ARKITEKTUR — SÅ HÄR FUNGERAR MOTORN

### Config-driven
Motorn vet inte vilken vertikal den kör. Allt kommer från en JSON-config:
- extraction_prompt, keywords, model, source_label
- supabase_url, supabase_key_env (per-vertikal credentials)
- discovery.* (config_table, source_table, search_terms)
- db.* (table, field_mapping, conflict_key, enrichment, dedup_fields)
- qc.* (stale_frequency_days, anomaly thresholds)
- feedback.* (zero_streak_threshold, max_rediscoveries_per_run)

Ny vertikal = ny JSON-fil + Supabase-tabell + VERTICAL env-variabel. Ingen kodändring.

### Daily-run pipeline
1. Läs godkända configs från Supabase (config_table i vertikalconfig)
2. Fas 1: HTTP fetch (snabbt, ~70% av källor)
3. Fas 2: Playwright fetch (JS-renderade sidor, ~30%)
4. LLM-extraction (Haiku för ByggSignal, Sonnet för CI)
5. Insert till Supabase med field_mapping och enrichment-lookup
6. Dedup via conflict_key eller dedup_fields
7. Alert om 0 records inserted (via Resend)
8. Trigger notify endpoint (bevakningsmail)

### Discovery pipeline
Eskalerar bara när billigt misslyckas:
1. URL-varianter ($0) — testa {kommun}.se/bygglov etc
2. Crawl ($0) — hämta startsida, scora länkar
3. Sitemap ($0) — parsa sitemap.xml
4. Haiku ($0.001) — AI letar URL:er i HTML
5. Sonnet ($0.15) — fallback, bara vid behov

### Feedback-loop (självläkande)
QC detekterar zero-streak (3+ dagar med 0 ärenden) →
triggar discoverSource() automatiskt →
verify extraction →
auto-approve om verified eller needs_browser →
nästa daily-run använder ny config

Bevisat end-to-end med Aneby kommun.

### Agent-runner (orkestrering)
Railway cron triggar agent-runner.js kl 13:00 UTC (15:00 CET).
- Läser pending tasks från agent_tasks i Supabase
- Shell-tasks: kör via execSync (daily-run, QC, discovery)
- Research/debug-tasks: exekveras via sdk-runner.js (Anthropic Messages API + web_search)
- Fallback: om inga tasks → kör daily-run + QC för alla vertikaler i DEFAULT_VERTICALS
- Budget-kontroll: per task (max_cost_usd) + per körning (AGENT_MAX_COST_PER_RUN_USD)
- Sammanfattning via Resend efter varje körning till tomasbackman@mac.com

### agent_tasks (Supabase-tabell)
Task-kö för orkestratorn. Chattar och vertikaler kan skapa tasks.
- job_type: shell (kör kommando direkt), research (Messages API), debug (Messages API)
- requested_by: cron, ceo, ci-vertical, sc-vertical, qc-feedback, byggsignal-enrichment
- priority: 1=akut, 5=normal, 9=bakgrund
- max_cost_usd: per-task budgetgräns (default 0.50)
- syfte: fritextbeskrivning för research/debug-tasks
- model: haiku (default) eller sonnet

### sdk-runner.js (research/debug-exekvering)
Använder Anthropic Messages API direkt (inte Agent SDK-paketet) med web_search server-side tool.
- Haiku ($1/MTok in, $5/MTok out) för rutinresearch
- Sonnet ($3/MTok in, $15/MTok out) för komplex analys
- Budget-kontroll: avbryter vid 80% av max_cost_usd
- Returnerar: { status, result, cost_usd, turns_used }

## SUPABASE-PROJEKT

- ByggSignal + motortabeller: abnlmxkgdkyyvbagewgf
  - permits_v2 (bygglovsdata)
  - municipalities (referenstabell, 290 kommuner)
  - profiles (ByggSignal-användare)
  - discovery_configs (motorns source-configs)
  - discovery_runs (loggar re-discovery-försök)
  - qc_runs (QC-resultat)
  - agent_tasks (task runner-kö)
- Client Intelligence: qvmthuylldpzcoyzryqe
  - ci_signals (projektsignaler)
  - ci_organizations (bevakade organisationer)
  - ci_sources (pressrum-configs)
- Search & Compliance: ebtfvaalsguniuyywjrb

OBS: Motortabeller (discovery_configs, qc_runs, agent_tasks) bör separeras till
eget Floede Supabase-projekt. Parkerat — görs om 2-3 veckor.

## ENV-VARIABLER

Railway (produktion):
- ANTHROPIC_API_KEY
- SUPABASE_URL (pekar på ByggSignal-projektet)
- SUPABASE_SERVICE_KEY (ByggSignal)
- CI_SUPABASE_SERVICE_KEY (CI-projektet, roterad 2026-03-30)
- RESEND_API_KEY
- CRON_SECRET
- NOTIFY_URL
- AGENT_MAX_COST_PER_RUN_USD (default 10.00)

Lokal .env måste ha samma variabler.

## KRITISKA REGLER

### Kod
- Node.js ESM (import, inte require)
- Motorns kod ska ALDRIG vara vertikal-specifik
- Produktens kod ska ALDRIG försöka vara generell
- HTTP-fetch före Playwright. Haiku före Sonnet
- Fält som inte kan extraheras = null. Aldrig gissning
- Alla å, ä, ö korrekta i data och UI. Inga emojis

### GDPR
- applicant-fältet i permits_v2 får BARA innehålla organisationer
  (AB, BRF, HB, KB, kommun, region, stiftelse, förening)
- Privatperson = null, alltid. Dubbelfilter: prompt + kod

### Deploy
- CC-promptar avslutas med: git add -A && git commit -m "..." && git push
- Deploya ALDRIG mellan 13:00-15:00 UTC (cron kör kl 13:00)
- En CC-instans per repo. CC startas med: cd /Users/tomasbackman/floede-agent && claude
- Stripe Payment Links skapas manuellt av Tomas — aldrig via API

### Verifiering
- Verifiera innan du påstår. Kolla faktiska siffror, läs loggar till slutet
- Citera aldrig något som inte syns i aktuell konversation
- Säg "jag vet inte, låt mig kolla" istället för att gissa
- Aldrig anta konfigurationsvärden — alla mailadresser, domäner, API-endpoints,
  priser, databasnamn måste vara verifierade eller fråga Tomas först

### Kontaktuppgifter
- Tomas mail: tomasbackman@mac.com
- ByggSignal Resend from: hej@byggsignal.se
- Agent-runner Resend from: Floede Agent <hej@byggsignal.se>
- Floede äger INTE domänen floede.se. Använd aldrig tomas@floede.se

## KÄNDA PROBLEM OCH BESLUT

### ÅÄÖ-bugg i discovery_configs (ROTORSAK EJ FIXAD)
resolveHomepage() i discovery.js normaliserar kommunnamn för DNS-lookup
(Älvdalen → alvdalen.se). Det normaliserade namnet läcker in som municipality-namn
i discovery_configs. Symtom: feedback-loopen misslyckas för kommuner med å/ä/ö
för att re-discovery söker med fel namn.

Datafixen gjord (dubbletter borttagna, 7 namn korrigerade).
Rotorsak i kod ej fixad — resolveHomepage måste returnera det URSPRUNGLIGA
kommunnamnet, inte det normaliserade.

### QC-validering för icke-ByggSignal-vertikaler
VALID_PERMIT_TYPES och VALID_STATUSES läses från vertikalconfig.
CI har inte dessa fält → guard tillagd (kontrollerar att de finns innan .includes()).
CI bör ha egen validering (maturity: rumor/planned/tender/awarded).

### Kostnadsberäkning
MODEL_COSTS-objekt ersatte hårdkodade Haiku-konstanter.
Sonnet: $3/M input, $15/M output. Haiku: $0.80/M input, $4/M output.
Kostnaden läses baserat på verticalConfig.model.

### Municipality-normalisering
normalizeMunicipality() i insertToSupabase strippar "kommun"/"stad"-suffix.
Villkorad på SOURCE_LABEL === "Kommun" — körs inte för CI.

### Stripe webhook-signering + plan-fält
constructEvent() utkommenterad i ByggSignal. Vem som helst kan skicka falska
webhook-anrop. plan-fältet uppdateras inte vid betalning. Dolt av beta-override
(alla Pro till 30 april). MÅSTE FIXAS FÖRE 30 APRIL.

## LÄRDOMAR

### Discovery
- search_terms MÅSTE innehålla enskilda ord ("bygglov", "anslagstavla")
  utöver flerordiga fraser. string.includes() matchar aldrig flerordiga fraser
  i reell HTML. Denna fix lyfte hit rate från 0.6% till 92.5%.
- ~95% av kommuner fungerar med HTTP fetch. Bara ~5-10% behöver Playwright.
  verify extraction ska flagga needs_browser, inte försöka JS-rendering.
- Steg 0 i ny pipeline: kolla om en aggregator redan existerar innan du bygger.

### Enrichment (research mars 2026)
- Anslagstavlor publicerar INTE sökande/byggherre (testat Kävlinge, Örebro)
- PoIT (Post- och Inrikes Tidningar) har alla bygglov 2011-nov 2025 men UTAN sökande
- Geoplan har bygglovsdata alla kommuner, oklart om sökande finns
- Diariesystem (väg A) är enda vägen till sökande-data
- Från dec 2025: nya bygglov kungörs på kommunens anslagstavla istället för PoIT
  (ny PBL). PoIT har fortfarande historisk data.
- Lantmäteriets Belägenhetsadress Direkt API (gratis, CC BY 4.0) ger adress +
  koordinater från fastighetsbeteckning
- Lantmäteriets Fastighetsregister har ägare (kräver juridisk prövning)
- Tre separata frågor: vem äger fastigheten (Lantmäteriet), vem sökte bygglovet
  (diariesystem), vem bygger (Byggfakta/diarie)

### ByggSignal produkt
- Permit signal: Beviljat = primärt säljfönster. Startbesked = för sent.
- Täckning måste preceda försäljning — visa aldrig produkt innan motorn levererar.
- Lead alert service — levererar targeting data, inte outreach.

### CI
- Core demo: visa data kunden känner igen (deras egna projekt), sedan visa
  projekt de inte kände till.
- Signal hierarchy: Ryktas (högst) → Planeras → Upphandlas → Tilldelat (lägst)
- Fas 0: organisationer kommunicerar redan sina planer öppet via pressrum.

## INFRASTRUKTUR

- GitHub: tomasbackmansmail-source/floede-agent (privat)
- Railway: floede-agent service, cron 13:00 UTC, Hobby plan ($5/mån)
- Resend: mail-integration
- Cloudflare: DNS för byggsignal.se och searchandcompliance.com
- ByggSignal frontend: byggsignal-web på Railway (Express + static)
- S&C frontend: searchandcompliance på Railway
- Vercel: avvecklat

## TESTER

177 tester (48 discovery + resten). Alla gröna.
Kör alltid: npm test före push.

## SENAST UPPDATERAD

2026-03-31 — Agent-runner.js live i produktion (Railway cron).
sdk-runner.js tillagd för research/debug-tasks via Anthropic Messages API.
CLAUDE.md skapad med full kontext om Floede, vertikaler och arkitektur.
