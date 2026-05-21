# Floede Engine — Arkitektursnapshot

> Faktabaserad kartläggning av motorn för att bedöma om/var Anthropics
> Managed Agents-plattform (memory, dreaming, outcomes, multi-agent
> orchestration) löser ett verkligt problem snarare än byter ut något
> som redan fungerar.
>
> Källa: kodläsning 2026-05-21 mot main @ eead191.

---

## 1. Agent-loopen och dataflödet

### Huvudloop — entrypoints

- **Railway cron** trigger via `railway.toml:6` (`cronSchedule = "0 4 * * *"`,
  04:00 UTC) startar `src/agent-runner.js`.
- `agent-runner.js:293 main()` är toppen av exekveringen. Den:
  1. Läser pending tasks från `agent_tasks`-tabellen
     (`agent-runner.js:26 fetchPendingTasks`).
  2. Om inga tasks finns: faller tillbaka till `runDefaultExtraction()`
     (`agent-runner.js:92`) som kör en hårdkodad sekvens via `execSync`:
     ```
     for VERTICAL in ['byggsignal', 'ci-pressroom']:
       node src/daily-run.js   (timeout 14 400 000 ms = 4h)
       node src/qc.js          (timeout 300 000 ms = 5 min)
     node src/match-properties.js
     node src/ted-sync.js
     node src/group-signals.js
     ```
     `DEFAULT_VERTICALS` står på `agent-runner.js:13`. CI-vertikalerna
     `ci-projectpage` och `ci-annualreport` saknas i listan — de körs
     bara via uttryckliga tasks i `agent_tasks` eller manuellt.
  3. Skickar Resend-mail med summering + 7-dagars täcknings-query
     (`agent-runner.js:211 sendSummary`).

- **Discovery (`discover.js`) ingår INTE i default-loopen.** Den körs
  endast när someone manuellt anropar `VERTICAL=… node src/discover.js`,
  eller indirekt via `qc.js:740 triggerRediscovery()` när en
  zero-streak detekteras.

### Det faktiska dataflödet — daily-run.js

1. **Läs godkända configs** — `daily-run.js:52 loadApprovedConfigs`,
   tabell `discovery_configs` (eller `ci_sources` för CI), filtrerar
   på `approved=true` och ev. `source_type`.
2. **Klassificera källor i fyra hinkar** — `daily-run.js:723-730`:
   - Ciceron-adapter (URL matchar `isCiceronUrl`)
   - MeetingPlus-adapter (`isMeetingPlusUrl`)
   - NetPublicator-adapter (`isNetPublicatorUrl`)
   - HTTP (default)
   - Playwright (`config.needs_browser === true`)
3. **Fas 0 — adapters** (`daily-run.js:748-933`) — strukturerad data
   via JSON-RPC/REST/JSONP. Ingen LLM, $0/källa.
4. **Fas 1 — HTTP** (`daily-run.js:935-1068`):
   - `fetchPageHttp(config)` (`:85`) hämtar listing-URL, detekterar
     PDF via Content-Type, hämtar subpages om `requires_subpages`
     med selektor-hint och keyword-filter.
   - Loopen körs `for (const config of httpConfigs)` — sekventiellt
     med 300 ms paus (`:1067`).
   - Varje källa kör en `Promise.race([inner, timeout])` med 180 s
     timeout (300 s för subpage-källor) — `:945-1054`.
     **Detta är race-buggen** dokumenterad i CONTEXT.md: ingen
     `AbortController` finns, inner promise fortsätter köra efter
     timeout.
5. **Per subpage**: `extractPermits` (`:316`) anropas en gång per URL
   med `subpage.url` som deterministisk `sourceUrl`.
6. **Auto-eskalering HTTP → Playwright** (`:1008-1020`): om HTTP
   returnerar `allPermits.length === 0` och källan inte redan är
   browser-flaggad, pushas en ny config till `browserConfigs` och den
   körs i Fas 2 inom samma run.
7. **Fas 2 — Playwright** (`:1070-1203`):
   - `chromium.launch({ headless: true })` startar en ENDA browser.
   - Sekventiell loop, browser-omstart var 30:e kommun (`:1080`).
   - `fetchPagePlaywright` (`:170`) kör interaction_recipe-steg,
     pagineringslogik, subpage-extrahering.
   - Samma race-mönster med timeout (60 s / 300 s).
8. **Per permit**: `insertToSupabase` (`:457`) mappar via
   `field_mapping`, kör `enrichment` (kommun → län), report-dedup
   (`:557`), parent-länkning (`:573 + 661`), upsert med `conflict_key`
   eller dedup-fält-fallback.
9. **Post-run** (`:1267-1349`):
   - Resend-alert vid `totalInserted === 0`.
   - GET mot `NOTIFY_URL` med `CRON_SECRET` (bevakningsmail för
     ByggSignal).
   - Per-vertikal `post_run_webhook` (X-Cron-Secret) — aktivt på CI.

### Deterministisk kod vs LLM-anrop

| Steg | Deterministisk | LLM | Modell |
|------|----------------|-----|--------|
| Cron-trigger, task-dispatch (`agent-runner.js`) | Allt | — | — |
| Adapter-fas 0 (`adapters/*.js`) | Allt | — | — |
| HTTP-fetch + subpage-filter + dedup (`daily-run.js:85-166`) | Allt | — | — |
| Playwright-navigation + interaction_recipe (`:170-310`) | Allt | — | — |
| `stripNonContent`, `htmlToText` (`utils/engine.js:103, 20`) | Allt | — | — |
| Empty-HTML-tröskel (500 bytes, `:319`) | Allt | — | — |
| Content-hash + skip (`:330-335`) | Allt | — | — |
| **`extractPermits` core** (`:355`) | — | LLM | Per vertikal: byggsignal=Haiku 4.5, ci-pressroom=Sonnet 4.6, ci-projectpage=Sonnet 4.6, ci-annualreport=Opus 4.7 |
| `classifySignal` titel-regler (`utils/classify.js`) | Allt | — | — |
| `validatePermits` enum/required-checks (`qc.js:69`) | Allt | — | — |
| `insertToSupabase` mappning + upsert (`:457`) | Allt | — | — |
| Report-dedup, parent-link (`utils/report-dedup.js`, `utils/parent-link.js`) | Allt | — | — |
| QC validering, baselines, zero-streak (`qc.js`) | Allt | — | — |
| Discovery cheap steps (`utils/discovery.js`) | Allt | — | — |
| Discovery Haiku-steg (`utils/discovery.js:379 haikuDiscovery`) | — | LLM | Haiku 4.5 |
| Discovery interaktiv (`:578 askHaikuForInteraction`) | — | LLM | Haiku 4.5 |
| Discovery Sonnet-fallback (`discover.js:110 sonnetDiscovery`) | — | LLM | Sonnet 4.6 + web_search-verktyg |
| Discovery verify-extraction (`utils/discovery.js:880`) | — | LLM | Vertikalens prod-modell |
| `sdk-runner.js` (research/debug-tasks) | — | LLM | Haiku eller Sonnet |

### Eskaleringskedjor — var i koden

**Discovery — billigt först:** `utils/discovery.js:769 discoverSource()`
kör i ordning, return så fort något träffar:
1. `tryUrlVariants` — platform-detection + URL-mönster, $0
2. `crawlHomepage` — extrahera + score `<a>`-länkar, $0
3. `checkSitemap` — `/sitemap.xml` + score URLs, $0
4. `haikuDiscovery` — Haiku väljer länk från homepage, ~$0.001
5. `interactWithPage` — Playwright + Haiku väljer interaktivt element, ~$0.002
6. `sonnetDiscovery` (`discover.js:110`) — endast om steg 1-5 ej hittade
   och anropas från `discover.js:423`, ~$0.15

**Daily-run HTTP → browser:** `daily-run.js:1008`. När HTTP returnerar
0 permits och `!config.needs_browser`, läggs `{...config, needs_browser: true}`
till `browserConfigs` och körs i Fas 2 senare i samma run.

**`verifyExtraction` → needs_browser-flagga:** `utils/discovery.js:958-968`.
Om 0 items extraheras men HTML innehåller keywords, sätts
`needs_browser: true`. Daily-run plockar upp det via `config.needs_browser`.

**LLM retry:** `utils/retry.js` — exponentiell backoff (30s, 60s, 120s)
på HTTP 429/502/503/529. Max 3 retries. Används för LLM-anrop
(`daily-run.js:355`) och DB-skrivningar (`:591, 633`).

---

## 2. Datakvalitet och tillförlitlighet

### Hur vet motorn att den hittat rätt data?

**Före LLM-anropet:**
- Empty-HTML-tröskel (500 bytes efter `stripNonContent`) — `daily-run.js:319`.
- Content-hash-skip när hash matchar och `config.verified === true` —
  `:332-335` och motsvarande för adapters (`:760, 822, 884`).

**LLM-anropet självt** (`daily-run.js:355 withRetry(client.messages.create)`):
- Prompt-injicerad GDPR-regel och fältdefinitioner. Ingen JSON-schema-
  validering — bara `JSON.parse` (`:387`), failure ger `permits = []`.
- Output använder fält som inte schema-verifieras i runtime. Felaktiga
  fältnamn från LLM tappas bort i `field_mapping`-loopen
  (`daily-run.js:521`).

**Mellan extraction och insert — det är vad som finns:**
1. `field_mapping` (`:521`) — fält som saknas i `record` → `null` i `row`.
2. `enrichment`-lookup mot referenstabell (kommun → län) — `:526`.
3. `normalizeMunicipalityLookup` (`:491`) — försök matcha kommun-namn
   mot canonical name. Förklarar varför `Region Gotland`/`Gotland`/`gotland`
   inte hanteras (canonical-listan är `municipalities`-tabellen).
4. `source_type` sätts från config, inte LLM (`:401`).
5. `signal_classifier_rules` — titel-baserad reklassificering (`:414`).
6. Report-dedup (`:557`) och parent-länkning (`:573`).
7. Upsert med `conflict_key` (`:594 onConflict: ignoreDuplicates`) eller
   dedup_fields-fallback (`:614`).

**Det här är allt.** `validatePermits()` (`qc.js:128`) anropas BARA i
qc.js efter att daily-run skrivit JSON till disk. Den kör mot filerna,
inte mot raderna som faktiskt landade i DB. Det finns ingen
DB-pre-insert-validering av required_fields, enums eller numeric_ranges
i daily-run-pipelinen.

### qc_runs.permits_inserted — var skrivs det, var läses det

**Skrivs:** `qc.js:232` — **hårdkodad literal `permits_inserted: 0`**:
```js
.upsert({
  ...
  permits_extracted: count,
  permits_inserted: 0,   // <-- bug
  ...
})
```
Detta är hela förklaringen till varför `permits_inserted=0` på 13 000+
körningar. Det är inte en datalänkningsbugg — fältet skickas aldrig
in från daily-run. `qc.js` läser bara filer från `data/extracted/`
(`:495-507`) och har ingen referens till hur många rader som faktiskt
hamnade i DB.

**Läses:** Ingen kod i repot läser `permits_inserted` (grep
bekräftar). Self-healing-loopen läser `permits_extracted` (`qc.js:301`).
Konsekvensen är att `permits_inserted` är värdelös som signal överallt
— det skulle inte påverkat motorn även om det varit korrekt skrivet,
för ingen lyssnar.

Self-healing-loopen är alltså inte *blind p.g.a.* `permits_inserted=0`.
Den är blind p.g.a. att den läser `permits_extracted` från filer på
disk, och dessa filer finns bara om daily-run faktiskt körde och
skrev dem. Om en daily-run kraschar eller en kommun timeout:ar
(race-buggen), så skrivs ingen fil → `qc.js` ser ingen rad alls för
den kommunen, och `checkZeroStreak` räknar "ingen körning" som en
nolldag (`qc.js:340-343`).

### Vad händer vid 0 data, fel data, partiell data?

| Fall | Var det fångas | Vad som händer |
|------|----------------|----------------|
| Källa returnerar 0 permits från HTTP | `daily-run.js:1008` | Auto-eskalering till Playwright i samma run |
| Playwright returnerar 0 permits | (inget) | Loggas, men ingen ytterligare eskalering |
| `totalInserted === 0` över hela vertikalen | `:1267` | Resend-alert till `verticalConfig.alert_email` |
| Källa 3+ dagar med 0 i `qc_runs.permits_extracted` | `qc.js:290 checkZeroStreak` | Resend-alert + auto-trigger re-discovery (`:740 triggerRediscovery`) |
| Aktiv kommun (≥5 permits/30d) med 0 idag, > 30 sådana | `qc.js:756-787` | Resend-alert (vardagar) |
| Partiell data (extraktion lyckas, insert kraschar) | (inget) | Tyst fel — räkneverk i daily-run-summering, men ingen alert |
| LLM JSON-parse fel | `:386-391` | `permits = []`, ingen alert, ingen retry |
| Konfig "verified=false" + verify_result_count=0 | (inget i motorn) | Stannar i `discovery_configs` tills någon kör om discover manuellt |

### Tysta fellägen (utöver race-buggen i `daily-run.js:945/1095`)

Som jag kunde verifiera från koden:

1. **`permits_inserted=0` i `qc_runs`** — hårdkodning i `qc.js:232`.
   Ingen larmar, ingen ser det, ingen kod läser fältet (`qc.js`-koden
   själv skulle inte reagera även om det vore rätt).

2. **`field_mapping` tar bort okända fält tyst** (`daily-run.js:521`).
   Om LLM returnerar `applicant_name` istället för `applicant` så blir
   `row.applicant = null` och raden går igenom utan att flaggas.

3. **`JSON.parse` failure → tom array** (`:387-391`). En LLM som
   returnerar markdown-omsluten JSON eller trunkerar mid-array
   detekteras inte som fel, bara som "noll permits". Det triggar
   ingen retry — bara den vanliga `withRetry` som bara reagerar på
   HTTP-statusar.

4. **`needs_browser` permanent när källan väl fixats** — om en
   källa flaggas `needs_browser` av `verifyExtraction:958` så
   körs den för alltid via Playwright även om källan senare blir
   HTTP-bar. Ingen "downgrade"-mekanism.

5. **Adapter-detektering är duck-typed på URL** (`daily-run.js:724-727`).
   Om en kommun byter från Ciceron till MeetingPlus men URL fortfarande
   matchar `isCiceronUrl`, går den genom fel adapter och returnerar
   tomma resultat utan tydligt fel.

6. **Subpage rate-limit `await sleep(500)`** (`daily-run.js:158`).
   Det är hårdkodat och respekterar inte t.ex. `Retry-After`-headers.
   Om en kommun-server skickar 429, har vi ingen back-off för
   subpage-fetcher (bara LLM-retry).

7. **`stripped.slice(0, 100000)`** (`daily-run.js:348`). HTML längre
   än 100k tecken trunkeras innan LLM ser den. Om relevanta permits
   ligger sist på en lång listing-sida missas de utan signal.

8. **Cost-beräkning räknar inte rabatt på cache-reads**
   (`daily-run.js:439-441`). `input_tokens` används rakt, men Anthropic
   tar 10% för `cache_read_input_tokens` och 125% för
   `cache_creation_input_tokens`. Konsekvens: rapporterad kostnad
   speglar inte faktisk faktura. Inte ett datafel — men ett blindspot
   för kostnadsstyrning.

---

## 3. Minne och lärande mellan körningar

### Vad är "config-driven Pattern Library" konkret?

Termen finns inte i koden. Det som finns är:

**Vertikalconfigs** i `src/config/verticals/*.json` (4 filer):
- `extraction_prompt` (LLM-instruktioner)
- `keywords`, `model`, `source_label`
- `db.field_mapping`, `db.conflict_key`, `db.dedup_fields`, `db.enrichment`
- `discovery.url_patterns`, `discovery.platform_templates` —
  Sitevision/Episerver/WordPress/Municipio specifika mönster
- `discovery.search_terms`, `discovery.search_prompt`,
  `discovery.haiku_prompt`, `discovery.analysis_prompt`
- `signal_classifier_rules` (titel-baserad reklassificering, CI)
- `parent_link`, `report_dedup` (CI)
- `qc.validation`, `qc.population` (ByggSignal)
- `feedback.zero_streak_threshold`, `max_rediscoveries_per_run`,
  `max_cost_per_run_usd`

**Per-källa-state** i `discovery_configs` (ByggSignal) /
`ci_sources` (CI) — Supabase-tabeller:
- `municipality`/`organization_name`
- `config` (JSONB) — innehåller `listing_url`, `platform_guess`,
  `discovery_method`, `confidence`, `requires_subpages`,
  `interaction_recipe`, `subpage_hashes`, `content_hash`,
  `source_type_override`, `signal_classifier_rules`, `default_source_type`
- `approved`, `verified`, `verified_at`, `verify_result_count`,
  `needs_browser`, `stale_rediscovery_count`

**Plattformsmönster** (utils/discovery.js:11-19) — hårdkodad lista
över CMS-signaturer (Sitevision, Episerver, WordPress, Municipio,
NetPublicator, MeetingsPlus). Inte config-driven, ligger i kod.

### Vad minns motorn mellan körningar — och hur

| Vad | Var | När den används |
|-----|-----|-----------------|
| Subpage-content-hashar | `discovery_configs.config.subpage_hashes` (objekt url→hash) | `daily-run.js:958, 1105`; om match: LLM skippas, $0 |
| Sidans content-hash (single-page) | `discovery_configs.config.content_hash` | `:332`; samma som ovan |
| `verified`-flagga | `discovery_configs.verified` | Hash-skip respekteras BARA om `verified===true` (`:332, 760, 822, 884`) — så overifierade configs körs alltid mot LLM |
| `listing_url` | `discovery_configs.config.listing_url` | Daily-run hämtar denna direkt; ingen omkörning av Discovery såvida inte qc triggar `triggerRediscovery` |
| `needs_browser` | både i `config` och som top-level | Routar till Fas 2 |
| `interaction_recipe` (selektorer + värden) | `config.interaction_recipe.steps` | Spelas upp i Playwright (`:178-195`) |
| `requires_subpages.link_selector_hint` | `config.requires_subpages` | Filtrerar `<a>`-länkar (`daily-run.js:112, 232`) |
| `stale_rediscovery_count` | `discovery_configs` | Räknar hur många gånger re-discovery hittat samma URL (`qc.js:407-416`). Vid 3 → loggas för manuell review (men ingen email) |
| `permits_v2`/`ci_signals` baselines | DB-aggregat i `qc.js:32 loadBaselines` | Anomaly + stale-detection |
| `raw_html_hash` per record | `permits_v2.raw_html_hash` | Audit-only, läses inte av motorn |

### Vad kostar en redan-löst källa att köra igen?

**Adapter-källa (Ciceron/MeetingPlus/NetPublicator):**
- Alltid $0 LLM-kostnad. Bara HTTP-tid (~5-15s).

**HTTP-källa med oförändrat innehåll, `verified=true`:**
- `fetchPageHttp` körs (HTTP-cost ≈ 0)
- Hash beräknas (`createHash("sha256")`)
- Vid match: `extractPermits` returnerar tidigt, ingen LLM (`:332`)
- Resultat: **$0 LLM-kostnad**

**HTTP-källa med oförändrat innehåll, `verified=false`:**
- Hash-skip respekteras INTE (`verified===true`-krav)
- LLM-anrop körs alltid → full Haiku/Sonnet/Opus-kostnad
- Detta är inte en bugg utan en explicit regel från
  CLAUDE.md koddisciplin ("annars kan tom HTML hashas och låsa
  källan permanent")

**HTTP-källa med subpage-listing:**
- Per-subpage hash-skip. Om N subpages → N hash-jämförelser.
- LLM körs bara på de subpages där hash ändrats.

**Prompt-caching** (`daily-run.js:368 cache_control: ephemeral`):
- Extraction-prompten cachas i 5 min. Sekventiell loop gör att
  efterföljande source som körs inom 5 min får cache-hit på prompten.
- ~90% rabatt på prompt-tokens vid hit.
- Cost-beräkningen (`:439-441`) räknar dock med full inputkostnad
  oavsett — vi ser inte besparingen i den interna räkningen.

### Mönster över källor — finns det?

**Nej.** Varje source löses isolerat. Det finns två mekanismer som
liknar cross-source-mönster:

1. **`platform_templates` i vertikalconfig** (`byggsignal.json:187-206`).
   Om `detectPlatform` ger "sitevision", testas Sitevision-specifika
   URL-mönster först. Detta är manuellt kurerad lista, inte lärd.

2. **Plattformsadaptrar** (`adapters/`). En kommun som identifieras
   som Ciceron körs deterministiskt via JSON-RPC. Men adapter-uppsatsen
   är hårdkodad — det finns ingen "vi har sett 5 nya MeetingPlus-kommuner,
   låt oss generalisera"-loop.

`signal_classifier_rules` (CI) är ett embryo: regex-mönster som lyfter
en "pressroom"-signal till `financial_report` baserat på titel. Men de
är inkluderade i vertikalconfig som JSON och kompileras vid varje
körning (`utils/classify.js`) — inget lärande-system.

Det finns alltså ingen kod som svarar på frågan "den här nya kommunen
ser ut som Norrtälje — testa Norrtäljes config först". Discovery startar
om från steg 1 för varje ny källa, även när motorn har 200+ liknande
fall.

---

## 4. Kostnad och modell-routing

### Modeller per anropsplats

Från `daily-run.js:36-40` och vertikalconfigs:

| Vertikal | Extraction-modell | Cost/M input | Cost/M output |
|----------|-------------------|--------------|---------------|
| ByggSignal | Haiku 4.5 | $0.80 | $4.00 |
| CI-pressroom | Sonnet 4.6 | $3.00 | $15.00 |
| CI-projectpage | Sonnet 4.6 | $3.00 | $15.00 |
| CI-annualreport | Opus 4.7 | $5.00 | $25.00 |

Discovery-anrop:
- Cheap steps (URL-varianter, crawl, sitemap): **$0**, deterministisk kod.
- `haikuDiscovery` (`utils/discovery.js:379`): Haiku 4.5, ~$0.001-0.005 per
  källa beroende på sidans linklist.
- `interactWithPage` (`:636`): Haiku 4.5, max 3 interaktioner per försök.
- `sonnetDiscovery` (`discover.js:110`): Sonnet 4.6 + `web_search`-verktyg,
  max 6 navigationer + max 4 analys-attempts. ~$0.10-0.30 per försök.
- `verifyExtraction` (`utils/discovery.js:880`): vertikalens prod-modell
  (alltså Haiku för ByggSignal, Sonnet/Opus för CI).

### Besparing från billigast-först-routing

Mätt mot "alltid Opus":
- ~70% av ByggSignal-källor (CLAUDE.md) går via HTTP + Haiku.
- ~25% av ByggSignal-källor går via plattformsadapter (Ciceron/
  MeetingPlus/NetPublicator), $0 LLM.
- Hash-skip varje dag på `verified=true` med oförändrat innehåll.

Konkreta nummer från koden:
- Haiku-extraction kostar ~0.16% av motsvarande Opus-anrop på 50k tokens
  input + 5k tokens output (Haiku ≈ $0.06, Opus ≈ $0.375). Skillnad
  ~6x.
- Discovery via cheap steps + Haiku: ~$0.001 vs Sonnet-fallback ~$0.15.
  Faktor ~150x.

### Var går pengarna idag?

Jag kan inte mäta detta från koden utan körningsloggar — det finns
ingen aggregerad kostnadsrapport per källa över tid i repot. Det jag
kan säga från koden:

- **Opus 4.7 på CI annualreport är den dyraste extraktionspunkten** —
  Sonnet × ~1.67 i pris, och varje PDF-rapport körs som full
  dokument-base64 (`:339-346`). En 50-sidors årsredovisning blir 5-10k
  input-tokens efter PDF-tolkning, ~$0.03-0.05 per rapport.
- **Sonnet på CI pressroom + projectpage** är hög-volym jämfört med
  ByggSignal. Varje subpage = ett LLM-anrop, ofta 100+ subpages per
  källa.
- **Sonnet discovery-fallback** (`sonnetDiscovery`) är ett medvetet
  kort steg — körs bara för källor där cheap + Haiku missat.
  Anropas inte i default daily-loop.

Sammanfattat utan loggar: variabel-kostnaden domineras nästan säkert av
**CI-vertikalerna**, inte ByggSignal. Det är intuitionen man får av att
läsa koden, men måste verifieras mot `data/costs/` eller Anthropic-fakturan.

---

## 5. Parallellitet och drift

### Hur körs flera källor

**Sekventiellt.** Allt. Det finns ingen `Promise.all` i daily-run för
källor — varje fas är en `for`-loop med en `await` per iteration:
- `daily-run.js:752` (Ciceron)
- `:815` (MeetingPlus)
- `:877` (NetPublicator)
- `:938` (HTTP)
- `:1079` (Playwright)

Pausen mellan källor: 300 ms (HTTP/adapters) eller 1000 ms (Playwright).

`agent-runner.js` kör vertikalerna sekventiellt (`for (const vertical of DEFAULT_VERTICALS)`,
`:96`). Inte parallellt.

### Cron-jobb

**Ett enda Railway cron-job** (`railway.toml:6`): `0 4 * * *`.
Startar `agent-runner.js`, som kör hela default-extraction-paketet
sekventiellt:

```
ByggSignal daily-run  (4h timeout)
ByggSignal qc.js      (5 min timeout)
CI-pressroom daily-run (4h timeout)
CI-pressroom qc.js
match-properties.js
ted-sync.js
group-signals.js
```

Inga separata cron-jobb för discovery, ingen scheduling per vertikal.
Inga in-tab task-queue-workers — bara `agent_tasks`-tabellen som
agent-runner pollar vid varje körning.

### Vad körs var

| Komponent | Var |
|-----------|-----|
| `agent-runner.js`, `daily-run.js`, `qc.js`, alla src/-scripts | Railway (floede-agent service, Hobby plan $5/mån) |
| Chromium (Playwright) | I samma Railway-container (`chromium.launch()` `:1074`) |
| LLM-anrop | Anthropic API (extern) |
| Databas + tabeller (`permits_v2`, `ci_signals`, `discovery_configs`, `ci_sources`, `agent_tasks`, `qc_runs`, `discovery_runs`) | Supabase (3 projekt, ett per vertikal) |
| Mail | Resend |
| Bevakningsmail-trigger | `NOTIFY_URL` (ByggSignal-frontend) + `CI_ENGINE_WEBHOOK_URL` (CI-frontend) |

Ingen kod i repot körs på Supabase-sidan utöver tabell-DDL — alla
LLM-anrop, alla HTTP-fetchar, all Playwright körs på Railway.

### Plattformsadaptrarna

`src/adapters/`:
- `ciceron.js` (179 rader) — JSON-RPC mot Ciceron-anslagstavlor.
- `meetingplus.js` (288 rader) — REST mot MeetingPlus DBB API.
- `netpublicator.js` (246 rader) — JSONP mot NetPublicator.

**Mönster:** varje adapter exporterar två funktioner:
- `isXxxUrl(url) -> boolean` — detektor för URL-pattern.
- `fetchXxxPermits(url, municipality) -> { permits, contentHash }`.

Det finns **inget gemensamt interface**. `daily-run.js:724-727` gör
fyra separata `if`-grenar för att gruppera configs i hinkar, och
varje hink har sin egen Fas 0a/0b/0c (`:748, 811, 873`). Tre nästan
identiska kodblock med 50+ rader var. Ingen abstrakt
`Adapter`-bas.

### Skalning till 10X källor — flaskhalsar

Givet sekventiella loopar och ett enda cron-jobb:

1. **Tidsflaskhals.** ByggSignal har ~290 godkända configs (siffran
   står inte i koden, men 4h-timeoutens existens säger att hela run
   förväntas ligga nära det). 10x = ~2900 källor. Vid genomsnitt 30 s
   per källa = 24h. Det ryms inte i ett dygnsfönster sekventiellt.

2. **Playwright-flaskhals.** En enda browser, restart var 30:e kommun
   (`:1080`). Browser-startup ~3s. Vid 1000 browser-källor: ~33 min
   bara på browser-restart. Vid 10x: dålig skalning.

3. **Kostnadsflaskhals.** Hash-skip på `verified=true` håller LLM-kostnad
   låg vid stabil drift, men nya källor och förändrad HTML drar LLM-cost
   linjärt. CI med Sonnet/Opus skalar dyrare än ByggSignal.

4. **Tillförlitlighetsflaskhals.** Race-buggen i timeout-mekaniken är
   redan dokumenterad. Vid 10x källor blir sannolikheten för minst en
   timeout per run hög — och en timeout påverkar idag loggning,
   datakonsistens och bokföring (CONTEXT.md, kritiska motorbuggar).

5. **QC-flaskhals.** `qc.js` läser hela `permits_v2`-tabellen för
   baselines (`loadBaselines:33-37`). Vid 10x rader blir det ett
   Supabase-API-call utan paginering. Skalar inte.

6. **Discovery-orkestrering.** `discover.js` itererar `targets` från
   `municipalities`/`ci_organizations` sekventiellt, en homepage-resolve
   per saknad URL. 10x = långsam första-körning.

---

## 6. Var brister motorn mot målet idag

Givet målet **tillförlitlig data, snabbt och billigt, hög kvalitet** —
de tre största svagheterna rangordnade:

### 1. Det finns ingen tillförlitlig signal för "fungerade datan idag?"

`qc_runs.permits_inserted` är hårdkodad till `0` (`qc.js:232`). Inget
i koden läser fältet ändå. Self-healing-loopen läser
`permits_extracted` från filer på disk, så ett kraschat daily-run
(eller en timeout-träff från race-buggen) ser ut som "kommunen tystnade"
— omöjlig att skilja från en verklig tom källa.

Konkreta symptom från CONTEXT.md som detta förklarar:
- 20 storkommuner "tysta" sedan 5 april — kan vara verkligt tysta,
  kan vara race/timeout-offer, kan vara dåligt fångade verified=false-
  configs. Vi vet inte utan manuell SQL.
- Self-healing-loopen är blind: den triggar på fel data, missar verkliga
  fel.

Det här är inte ett "Managed Agents kan lösa"-problem — det är en
hårdkodad bug och en mätlucka. Men det är roten till att alla andra
mätningar är opålitliga. Allt downstream som bygger på "vet motorn
om den lyckas?" är trasigt så länge detta är.

### 2. Inget cross-source-lärande — varje källa löses isolerat

Discovery-pipelinen kan ta 5 cheap steps + Sonnet på en ny kommun, även
när motorn redan har 200+ liknande Sitevision-konfigar som beskriver
samma sak. `platform_templates` är manuellt kurerade. `signal_classifier_rules`
är handskrivna regex. Adapter-detektion är duck-typing.

Konsekvens:
- Långsam onboarding av ny vertikal eller ny stor mängd källor.
- Discovery upprepar arbete som motorn redan vet svaret på.
- Inga "den här källan beter sig som X" eller "när X händer brukar Y
  hjälpa"-pattern.

Det här är där "memory" och "outcomes" från Managed Agents skulle ha
direkt tillämpning: lagra vilka steg som löst vilka källor, hur ofta,
och låta nästa källa börja från det mönstret istället för steg 1.

### 3. Sekventiell exekvering + tyst-fail-race-bug = ojämn tillförlitlighet och dålig skalbarhet

Ett enda cron, en enda loop, en enda Playwright-instans. När en källa
hänger, kan den blockera andra (race-buggen släpper igenom inner promise
men frigör cron-slotten — så ena halvan av problemet är att slotten är
"klar" innan inner är klar, andra halvan är att vi inte kan parallellisera
för att kompensera).

Konsekvens:
- 4h-timeout per vertikal är inte uppskalningsbar.
- En enda långsam källa stjäl kostnad och tid från andra.
- 10x källor passar inte i nuvarande arkitektur — inte främst för att
  motorn är långsam, utan för att den är seriell.

Detta är inte direkt löst av memory/outcomes/dreaming, men `orchestration`-
biten av Managed Agents (med riktig parallellism, isolation per task,
abort-signal) skulle ersätta ett betydligt sköraare egenbyggt
`Promise.race`-mönster.

---

## Osäkerheter — det jag inte kunde fastställa från koden

1. **Antal godkända configs per vertikal.** Står inte i kod. Kräver
   `SELECT count(*) FROM discovery_configs WHERE approved=true GROUP BY ...`.
   Mina skalningsresonemang antar 290 ByggSignal-källor från
   CONTEXT-omnämnanden — inte verifierat mot DB.

2. **Faktisk LLM-kostnad senaste 30 dagarna per vertikal.**
   `data/costs/` skrivs av varje run (`daily-run.js:1225-1240`), men
   katalogen är ej committad. Min påstående att CI dominerar kostnaden
   är härledd från Sonnet/Opus-priser och CI:s subpage-volym, inte
   uppmätt.

3. **Hur ofta racet faktiskt triggar i prod.** CONTEXT.md beskriver
   ett verifierat fall (2026-05-21 04:15 UTC, Akademiska Hus + SFV).
   Frekvensen över tid är inte mätbar från koden — bara från
   Railway-loggar och DB-spår.

4. **Om `qc.js` ens körs framgångsrikt på CI-vertikalerna.**
   `agent-runner.js:122` kör `node src/qc.js` med 5 min timeout, men
   QC-koden är skriven primärt mot ByggSignal-mönstret (baselines,
   population-flags). Hur den beter sig mot `ci_signals` har jag inte
   verifierat.

5. **`config.subpage_hashes` hit-rate i prod.** Skip-räknaren skrivs
   till summeringen (`:1257`), men ackumuleras inte i någon
   permanent metric jag kunde hitta. Kostnadsbesparingen är teoretiskt
   stor men ej uppmätt här.

6. **Om `sonnet 4.5` i `sdk-runner.js:9` är medvetet val eller
   driftavvikelse.** `MODEL_MAP.sonnet = 'claude-sonnet-4-5-20250929'`
   medan `daily-run.js` använder `claude-sonnet-4-6`. Repot blandar två
   Sonnet-versioner.

7. **Vilka tabeller som finns i Supabase utöver de kodbasen
   refererar.** `agent_tasks`, `qc_runs`, `discovery_runs`, `permits_v2`,
   `municipalities`, `discovery_configs`, `ci_signals`, `ci_sources`,
   `ci_organizations`, `ci_properties` — det jag kunde grep:a fram.
   Det kan finnas fler tabeller som motorn skriver/läser via webhooks
   eller andra vägar.

8. **Vad `NOTIFY_URL` och `CI_ENGINE_WEBHOOK_URL` faktiskt utlöser
   downstream.** Motorn POSTar till dem — vad mottagarna gör är utanför
   detta repo.
