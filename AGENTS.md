# FLOEDE ENGINE — AGENTS.md

> Maskinoptimerad dokumentation för subagenter och Agent SDK.
> Komplement till CLAUDE.md. Läs CLAUDE.md först.

---

## SUBAGENTER

Tre subagenter i `.claude/agents/`:

| Agent | Syfte | Modell | Får ändra kod? |
|-------|-------|--------|---------------|
| source-researcher | Hitta och utvärdera datakällor | Sonnet | Nej |
| config-builder | Bygga och testa configs | Sonnet | Bara config |
| qa-verifier | Verifiera datakvalitet | Haiku | Nej |

### Typiskt flöde

1. source-researcher hittar kandidat-URL:er → skriver rapport till results/
2. config-builder läser rapporten, skapar config, kör extraction, itererar
3. qa-verifier kör QC mot extraherad data, rapporterar kvalitet

### Resultatfiler

Alla subagenter skriver till `results/`. Mappen kan rensas mellan körningar.

---

## CONFIG-FORMAT

### ByggSignal (byggsignal.json)

Extraction producerar records med dessa fält:
- municipality (string) — kommunnamn
- description (string) — ärendebeskrivning
- permit_type (string) — bygglov/marklov/rivningslov/förhandsbesked/strandskyddsdispens/anmälan
- status (string) — ansökt/beviljat/avslag/överklagat/startbesked/slutbesked
- decision_date (string, YYYY-MM-DD) — beslutsdatum
- applicant (string eller null) — BARA organisationer, aldrig privatpersoner
- address (string eller null)
- property_designation (string eller null) — fastighetsbeteckning
- case_number (string eller null) — diarienummer
- source_url (string) — sätts av motorn, inte av extraction

Config-tabeller i Supabase:
- discovery_configs — en rad per kommun med approved URL
- municipalities — referenstabell

Source label: "Kommun"
Model: Haiku (default)

### Client Intelligence (ci-pressroom.json)

Extraction producerar records med dessa fält:
- organization_name (string) — organisationens namn
- title (string) — kort projektnamn, max 80 tecken
- maturity (string) — rumor/planned/tender/awarded
- amount_sek (integer eller null) — belopp i SEK
- timeline (string eller null) — tidsram som fritext
- description (string) — 1-2 meningar
- source_url (string) — sätts av motorn
- source_date (string, YYYY-MM-DD eller null)

Enrichment: organization_name slås upp mot ci_organizations.name → organization_id
Dedup: organization_name + title + source_date

Config-tabeller i Supabase:
- ci_sources — en rad per källa (pressrum-URL) med organization_name och approved
- ci_organizations — organisationer med namn och website

Source label: "Organisation"
Model: Sonnet

### Ny vertikal

För att lägga till en ny vertikal:
1. Skapa JSON-config i src/config/verticals/
2. Skapa Supabase-tabeller (data + config)
3. Lägg till env-variabel för Supabase service key
4. Sätt VERTICAL=[namn] vid körning
5. Ingen kodändring i motorn

---

## KOMMANDON

### Extraction

```bash
# Hela vertikalen
VERTICAL=byggsignal node src/daily-run.js

# En specifik källa
VERTICAL=ci-pressroomnode src/daily-run.js --source="Akademiska Hus"
```

### Discovery

```bash
# Hitta URL för en källa
VERTICAL=byggsignal node src/discover.js --source="Aneby"
```

Discovery kräver att källan finns i source_table (municipalities för ByggSignal,
ci_organizations för CI) men INTE i config_table (discovery_configs / ci_sources).

### QC

```bash
# Hela vertikalen
VERTICAL=byggsignal node src/qc.js

# En specifik källa
VERTICAL=ci-pressroomnode src/qc.js --source="Statens fastighetsverk"
```

### Tester

```bash
npm test
```

---

## ENV-VARIABLER FÖR LOKAL KÖRNING

Subagenter kör i terminalen och behöver env vars.
CC har tillgång till `.env` i repot. Sätt VERTICAL explicit:

```bash
# ByggSignal
VERTICAL=byggsignal node src/daily-run.js --source="Aneby"

# CI
VERTICAL=ci-pressroomnode src/daily-run.js --source="Akademiska Hus"
```

Övriga env vars (ANTHROPIC_API_KEY, SUPABASE_URL, etc.) läses från .env.

---

## BUDGET

| Modell | Input | Output | Typisk kostnad per källa |
|--------|-------|--------|------------------------|
| Haiku | $0.80/MTok | $4/MTok | ~$0.001 |
| Sonnet | $3/MTok | $15/MTok | ~$0.01-0.05 |

Agent-runner budget: AGENT_MAX_COST_PER_RUN_USD (default $10).
Per-task budget: max_cost_usd i agent_tasks (default $0.50).

Subagent-körningar har ingen automatisk budget-guard —
config-builder bör uppskatta och rapportera kostnad.

---

## FELSÖKNING

**0 records efter extraction:**
1. Hämta HTML med curl — finns datan i källkoden?
2. Om inte: sidan kräver JavaScript → flagga needs_browser
3. Om ja: kontrollera att extraction_prompt matchar HTML-strukturen
4. Kontrollera field_mapping — stämmer fältnamnen?
5. Kontrollera att källan finns i config-tabellen med approved = true

**QC kraschar:**
1. Kontrollera att VERTICAL är satt
2. Kontrollera att --source= matchar exakt namn i databasen (skiftlägeskänsligt)
3. Läs felmeddelandet — saknas env vars?

**Discovery hittar ingen URL:**
1. Kontrollera att organisationen finns i source_table
2. Kontrollera att search_terms i vertikalconfig är relevanta
3. Kör manuell sökning — finns organisationen överhuvudtaget online?

---

## GENOMFÖRDA TESTER

### 2026-04-01 — Akademiska Hus (CI)

**Källa:** Mynewsdesk pressmeddelanden (https://www.mynewsdesk.com/se/akademiska_hus_ab/pressreleases)
**Signaler extraherade:** 8 (6 planned, 2 awarded), varav 3 med belopp
**Kostnad:** $0.03 (en Sonnet-extraction)
**QC-resultat:** Godkänd med anmärkningar

**Identifierade problem:**
1. ON CONFLICT-bugg: ci_signals saknar unique constraint på (organization_id, source_url, title).
   daily-run.js upsert misslyckas för HTTP-only CI-källor. Workaround: manuell insert.
   Behöver fixas i DB eller kod för att dagliga körningar ska fungera.
2. source_url = null på alla records (relaterat till punkt 1)
3. 2 nära-dubbletter mot äldre data (olika titelvarianter, samma projekt)
4. qc.js har ingen CI-specifik validering (använder ByggSignal-schema)

### 2026-04-01 — Stockholms stad, koncern (CI)

**Koncernperspektiv:** Stockholms stad bevakas som EN kund inklusive alla kommunala
bolag. Alla källor har organization_name = 'Stockholms stad' i ci_sources.

**Källor (3 st):**
1. Stockholmshem — Kommande upphandlingar (https://www.stockholmshem.se/om-oss/upphandling/kommande-upphandlingar/)
2. Micasa Fastigheter — Mynewsdesk pressrum (https://www.mynewsdesk.com/se/micasa-fastigheter/pressreleases)
3. SISAB — Kommande upphandlingar (https://www.sisab.se/sv/leverantor/upphandlingar/Kommande-upphandlingar/)

**Signaler extraherade:** 36 (26 planned, 7 tender, 3 awarded)
**Kostnad:** ~$0.23 (2 Sonnet-iterationer x 3 källor)
**QC-resultat:** Godkänd — 36/36 med organization_id, inga dubbletter

**Extraction_prompt-ändring:** organization_name-regeln uppdaterad så att LLM
använder organisationsnamnet från kontexten (ci_sources), inte bolagsnamnet i HTML.
Löser organization_id = null-problemet för alla koncernkällor.

**Nästa steg:**
- Lägg till Stockholmshem nyproduktion (rang 1, planned-signaler)
- Lägg till SISAB nyhetsarkiv (rang 1, mixed maturity)
- Lägg till S:t Erik Markutveckling (rang 2, stora exploateringsprojekt)

### 2026-04-01 — Vasakronan (CI)

**Källa:** Vasakronan pressmeddelanden via WordPress REST API
(https://vasakronan.se/wp-json/archive/v2/object/?post_type=press-release&page_id=12363)
**Signaler extraherade:** 4 (planned), varav 3 med belopp (193M, 307M, 1000M SEK)
**Kostnad:** ~$0.10 (4 iterationer inkl. felsökning)
**QC-resultat:** Godkänd — 4/4 med organization_id, korrekta belopp och datum

**Lärdom — WordPress React-sajter:**
Vasakronans webb laddar artiklar/pressmeddelanden via WordPress REST API i en
React-komponent. HTML-sidan innehåller bara `<article>` med href men ingen länktext,
vilket gör att motorns `filterByKeywords()` returnerar 0 och faller tillbaka till
listningssidan utan innehåll. Lösning: använd API-endpointen direkt som listing_url.
`htmlToText()` på JSON-svar lämnar JSON intakt, som LLM tolkar korrekt.

**Lärdom — /aktuellt/ vs /pressmeddelanden/:**
Vasakronans /aktuellt/ är en redaktionell magasinsida med feature-artiklar (lågt
CI-värde). /pressmeddelanden/ innehåller officiella pressmeddelanden om transaktioner
och förvärv (högt CI-värde). Välj pressmeddelanden-API för CI-ändamål.

**Parallellkörning:** Befintlig Cision-källa (needs_browser: true) körs parallellt
och fångar kompletterande data. Båda källor är aktiva i ci_sources.
