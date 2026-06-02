# Fas 0-research: Ask 1 — fas-taggade strukturerade CI-källor

> Skapad 2026-06-02 av CTO Engine. RESEARCH, inte bygge. Ingen kod skriven,
> inga DB-skrivningar, ingen motor-körning. All inhämtning via curl mot publika
> sidor. Syfte: ge CTO Engine + Tomas underlag att designa configs och
> onboarding-ordning för Ask 1 (projekt/fas/status/datum — inga personfält).

## Sammanfattning (TL;DR)

| # | Källa | Nåbar | $0-strukturväg | Fas/status deterministiskt | HTTP/Playwright | Volym |
|---|-------|-------|----------------|----------------------------|-----------------|-------|
| 1 | vaxer.stockholm/projekt | Ja (200) | Ja — inbäddad GeoJSON i HTML | Nej (fritext i `content`) | HTTP | ~921 |
| 2 | Trafikverket inköpstidplan | Ja (200) | Ja — XLSX-fil (kräver ny adapter) | Ja (kolumner) | HTTP-nedladdning | 927 rader |
| 3 | Trafikverket Våra projekt | Ja (200) | Nej (bara realtids-API + intern sök) | Delvis (efter render) | Playwright | hundratals |
| 4 | Akademiska Hus projekt | Ja (200) | Nej (rena HTML-kort) | Ja (URL-split aktuella/framtida) | HTTP (ingen timeout!) | ~15 |

Två oväntade fynd som behöver CTO Engine-beslut:
1. **Källa 2 är guld men binär.** Inköpstidplanen är en komplett XLSX med 927
   rader och 19 kolumner inkl. planerat annonseringsdatum, bedömd kostnad och
   status. Men motorn har ingen XLSX-väg — LLM-grenen kan inte läsa binärfil.
   Kräver ny adapter (i klass med Ciceron/MeetingPlus). URL:en bär
   publiceringsdatum i filnamnet och byts varje publicering (nästa 8 juli 2026)
   → måste upptäckas från HTML-sidan vid varje körning, inte hårdkodas.
2. **Akademiska Hus timeoutar INTE.** CONTEXT dokumenterar Playwright-timeout
   (>30s) för akademiskahus.se project_page. Den reproducerar inte på de
   verifierade projekt-URL:erna nedan — alla svarar 200 på ~0,19s över ren
   HTTP. Antingen pekar den befintliga ci_sources-raden på fel URL, eller så var
   timeouten ett symtom på den nu fixade race-buggen (2026-05-24). CTO Engine
   bör läsa den faktiska listing_url i ci_sources för Akademiska Hus innan något
   byggs.

---

## Källa 1 — vaxer.stockholm/projekt (Stockholms stads projektportal)

### (a) Verifierad URL
- `https://vaxer.stockholm/projekt/` → **HTTP 200**, 699 927 bytes, `text/html`.
- Samma inbäddade dataset returneras även på enskilda projekt-/detaljsidor
  (t.ex. `https://vaxer.stockholm/projekt/akalla/bostader-i-akalla-centrum/` →
  200, 698 390 bytes). Kartdatat är inbakat i varje sidladdning.

### (b) $0-strukturväg — JA (inbäddad GeoJSON, ingen separat endpoint)
Sidan innehåller en GeoJSON `FeatureCollection` inline i den råa HTTP-HTML:en
(syns direkt i curl, ingen JS-rendering krävs). Struktur per feature:

```json
{"geometry":{"type":"Point","coordinates":[144995.75,6588920.60]},
 "properties":{"type":"Feature",
   "name":"Bostäder i Akalla centrum",
   "content":"Förslaget innebär rivning ... cirka 100 bostäder ... Detaljplan: Mariehamn 1 och del av Akalla 4:1 (Diarienummer: 2019-00670).",
   "url":"/projekt/akalla/bostader-i-akalla-centrum/",
   "poiType":1,
   "image":"/siteassets/.../vy-07-torgvy-bostad..."}}
```

- **Ingen dedikerad ren JSON-endpoint hittad** — datat är server-renderat in i
  sidan (kartan läser från det inbäddade blocket, inte från ett separat
  `/geojson`-anrop). Det är ändå en $0-väg: hämta HTML en gång, klipp ut
  `"features":[...]`-arrayen, parsa deterministiskt utan LLM.
- `coordinates` är i projicerat koordinatsystem (SWEREF99, ej WGS84) — bärs som
  metadata, behövs inte för Ask 1.

### (c) Fas/status — NEJ, inte ett eget fält
GeoJSON-objekten saknar status/fas/skede-fält. De enda fälten är `name`,
`content`, `url`, `poiType`, `image`, `coordinates`.
- `poiType` är ett **kategori-värde** (1–8), inte fas. Fördelning i datat:
  poiType 1=405 st, 4=167, 7=140, 8=68, 6=56, 2=42, 5=29, 3=14. poiType 1
  korrelerar med bostadsprojekt (utifrån slug-mönstret). Kräver en
  legend-lookup för att översättas till etikett (commercial/residential/...).
- **Fas finns bara som fritext** inuti `content` och i detaljsidans
  brödtext — t.ex. "Byggstart skedde i december 2024", "byggstartar i maj
  2026", "Detaljplan har fått laga kraft". → maturity måste **LLM-härledas**,
  den kan inte mappas deterministiskt.

Slutsats: name/description/url/koordinater/kategori-kod är deterministiska;
maturity kräver LLM-inferens från `content`/detaljsida.

### (d) HTTP vs Playwright
**HTTP.** Hela datasetet ligger i den råa curl-responsen. Ingen Playwright.

### (e) Volym
~921 projektpunkter totalt (871 under `/projekt/...`, ~50 under
`/omraden/stadsutvecklingsomraden/...`). Tung men hanterbar — hela datat i
ett HTTP-svar.

### (f) GDPR
`content`-texten bär organisations- och diarienummer (t.ex. "Diarienummer:
2019-00670"), inte projektledarnamn. Ingen person-i-roll i GeoJSON.
Låg risk — standard prompt-/kod-guard räcker. Privatperson = null alltid.

### (g) Föreslagen field_mapping (kandidat, ej implementerad)
source_type: `project_page` (eller eget `municipal_project`).
| ci_signals-fält | källa |
|---|---|
| organization_name | "Stockholms stad" (config-satt) |
| title | properties.name |
| description | properties.content |
| source_url | `https://vaxer.stockholm` + properties.url |
| region | stadsdel ur url-slug (`/projekt/<stadsdel>/...`) |
| category | poiType via legend-lookup |
| maturity | LLM ur `content` (byggstart/detaljplan/laga kraft → planned/tender/awarded) |
| property_designation | regex ur `content` ("Detaljplan: ...") om mönster matchar |
| source_excerpt | properties.content |
| amount_sek | null (sällan i `content`) |

---

## Källa 2 — Trafikverket inköpstidplan

### (a) Verifierad URL
- HTML-sida: `https://bransch.trafikverket.se/for-dig-i-branschen/upphandling/Planerade-upphandlingar/`
  → **HTTP 200**, 92 076 bytes. Sidan bär INGEN tabell (0 `<table>`/`<tr>`).
- Strukturerad data: **XLSX-fil** länkad från sidan:
  `https://bransch.trafikverket.se/contentassets/ed80734abecc4d819894d2cdb6e42676/inkopstidsplan-260601.xlsx`
  → **HTTP 200**, 179 287 bytes, `application/vnd.openxmlformats...spreadsheetml.sheet`.

### (b) $0-strukturväg — JA, men binär XLSX (kräver ny adapter)
Excel-filen parsad lokalt: **930 rader (927 datarader), 19 kolumner.** Helt
deterministisk, ingen LLM. MEN:
- Motorn har ingen XLSX-väg. HTTP+LLM-grenen får binärinnehåll den inte kan
  läsa. Behöver **ny adapter** i samma klass som Ciceron/MeetingPlus/
  NetPublicator (strukturerad data, ingen LLM).
- **URL:en är inte stabil.** Filnamnet bär publiceringsdatum (`-260601` =
  2026-06-01) och byts varje publicering. Sidan säger: "Nästa publicering av
  inköpstidplanen planeras att ske den 8 juli 2026." Adaptern måste därför
  först hämta HTML-sidan, plocka ut den aktuella `.xlsx`-länken
  (regex `href=".*inkopstidsplan-\d+\.xlsx"`) och sedan ladda filen.
- Det finns även en kompletterande "Kartvy" (filtrerbar karta) för delmängd —
  ej nödvändig, Excel är komplett.

### (c) Fas/status/datum — JA, deterministiskt i kolumner
19 kolumner (verifierade ur filen):

```
0  JournalID
1  Verksamhet                       (Stora projekt / Investering)
2  Benämning upphandling            (titel)
3  Beskrivning upphandling
4  CPV kod
5  Upphandlingsområde               (Tjänst / Entreprenad)
6  Upphandlingstyp/Avtalstyp
7  Trafikslag                       (Järnväg / Väg)
8  Inköpskategori
9  Geografiskt område               (region, t.ex. "Mellersta Regionen")
10 Planerad annonseringsstart       (PLANERAT UPPHANDLINGSDATUM)
11 Planerad sista anbudsdag
12 Planerad avtalsstart
13 (tom)
14 Status på uppgifter, planering   (Säker / relativt säker / osäker)
15 Bedömd kostnad, miljoner SEK
16 Bedömd Kontraktstid, år
17 Kontaktperson                    (PERSONFÄLT — se GDPR)
18 Information                       (Nytt / Uppdaterad / Försenad / Utgått)
```

Exempelrad: `Benämning="OKB Gävle Kringlan dubbelspår, bygghandling",
Trafikslag=Järnväg, Geografiskt område="Mellersta Regionen",
Planerad annonseringsstart=2026-05-01, Planerad sista anbudsdag=2026-11-01,
Planerad avtalsstart=2027-01-01`. Datumcellerna är Excel-serienummer (46143 =
2026-05-01) — adaptern måste konvertera serienummer → ISO-datum.

"Status på uppgifter, planering" = datum**säkerheten** (Säker/osäker), inte
projektfas. Eftersom raderna är planerade upphandlingar är maturity i praktiken
deterministiskt **tender** (kommande upphandling) för hela källan; "Information"-
kolumnen (Försenad/Utgått) ger förfining.

### (d) HTTP vs Playwright
**HTTP** (filnedladdning). Ingen Playwright. Men ny adapter krävs (se b).

### (e) Volym
927 datarader.

### (f) GDPR — VIKTIGT
Kolumn 17 "Kontaktperson" innehåller namngiven upphandlingskontakt = person.
**Lämna fältet (mappa inte).** Person-i-roll hör till Ask 3, designas separat.
Privatperson = null alltid. Övriga kolumner är projekt-/upphandlingsdata.

### (g) Föreslagen field_mapping (kandidat)
source_type: `procurement_plan` (nytt) eller `tender`.
| ci_signals-fält | källa |
|---|---|
| organization_name | "Trafikverket" (config-satt) |
| title | Benämning upphandling |
| description | Beskrivning upphandling |
| maturity | "tender" (statiskt; "Utgått" → skippa) |
| amount_sek | Bedömd kostnad, miljoner SEK ×1 000 000 |
| region | Geografiskt område |
| category | "infrastructure" (statiskt) eller via Trafikslag |
| timeline | Planerad annonseringsstart / avtalsstart (se kontrakt-frågor) |
| contract_end_date | Planerad avtalsstart + Bedömd kontraktstid (kan beräknas) |
| source_date | publiceringsdatum ur filnamn/sida |
| source_url | HTML-sidans URL (rader saknar egen URL — se kontrakt-frågor) |
| **(saknas)** | Planerad annonseringsstart, Planerad sista anbudsdag, JournalID |
| (lämnas) | Kontaktperson (GDPR) |

---

## Källa 3 — Trafikverket "Våra projekt"

### (a) Verifierad URL
`https://www.trafikverket.se/vara-projekt/` → **HTTP 200**, 35 039 bytes.
Detta är rätt URL (bekräftad rubrik "Våra projekt — Här hittar du alla våra
pågående och planerade byggprojekt").

### (b) $0-strukturväg — NEJ
- HTML innehåller **0 projektlänkar** under `/vara-projekt/` — sidan är ett
  JS-drivet sök/filter-gränssnitt ("Script är inte aktiverat i din
  webbläsare..."). Projektlistan laddas via JS.
- Endpoints i sidkällan: bara `https://api.trafikinfo.trafikverket.se/v2/data.json`
  (realtids-trafik-API — **explicit utesluten** per uppgiften, täcker inte
  projekt) och `/quicksearch` (sajt-sökningens autocomplete, inte ett
  projekt-data-API). Ingen användbar öppen projekt-feed.

### (c) Fas/status
Portalen annonserar "pågående och planerade" projekt med filter på län och typ
(väg/järnväg/gång-cykel/sjöfart). Status/fas finns per projekt men exponeras
först efter JS-render eller på detaljsidorna — inte deterministiskt i ett fält i
HTTP-svaret.

### (d) HTTP vs Playwright
**Playwright krävs.** Ren HTTP ger tomt skal. (Notera: detta är den enda av de
fyra källorna som faktiskt kräver browser.)

### (e) Volym
Okänt exakt antal — hundratals projekt fördelade över länen (filtrerbart). Kräver
render + paginering/filter-iteration för full täckning.

### (f) GDPR
Projektdetaljsidor kan namnge projektledare. Lämna personfält (null), Ask 3.

### (g) Föreslagen field_mapping (kandidat)
source_type: `project_page`. Standard project_page-extraktion via LLM **efter**
Playwright-render. Samma fältuppsättning som ci-projectpage.json. Lägre prioritet
pga browser-beroendet och oklar render-stabilitet.

---

## Källa 4 — Akademiska Hus projektlista

### (a) Verifierad URL
- `https://www.akademiskahus.se/vara-projekt/` → **HTTP 404** (felaktig gissning).
- Korrekt landningssida: `https://www.akademiskahus.se/om-oss/utveckling/projekt/`
  → **HTTP 200**, 187 213 bytes, **0,19 s**. Den delas i:
  - `.../projekt/aktuella/` → 200, 183 486 bytes, 0,19 s (pågående projekt)
  - `.../projekt/framtida/` → 200, 173 472 bytes, 0,27 s (planerade projekt)
- Startsidan `https://www.akademiskahus.se/` svarar också 200 på 0,20 s.

### (b) $0-strukturväg — NEJ
Inget inbäddat JSON-dataset (projekten är rena HTML-kort med `<a href>`-länkar
per projekt). Men HTML:en är komplett och ren i HTTP-svaret.

### (c) Fas/status — JA, via URL-struktur
Fas bärs deterministiskt av URL-splitten:
- `/projekt/aktuella/...` = pågående → maturity **awarded** (eller ongoing).
- `/projekt/framtida/...` = planerade → maturity **planned**.

Listkorten bär dessutom **kategori** ("Nybyggnad"/"Ombyggnad") och **region**
inline. Rensat utdrag ur `/aktuella/`:
`"Nybyggnad Campusutveckling Stockholm Allhuset Lantis Ombyggnad Luleå Pussen ...
Göteborg Handelshögskolans nya byggnad ... Nybyggnad Arkitektur Stockholm Här
skapas labb och kontor på Campus Solna"`. Sidan har även facett-räknare
("Ombyggnad (10)").

### (d) HTTP vs Playwright — HTTP, ingen timeout
Alla URL:er svarar 200 på ~0,19–0,27 s över ren curl. **Den dokumenterade
Playwright-timeouten reproducerar inte.** Se TL;DR-fynd 2: kontrollera vilken
listing_url ci_sources faktiskt har för Akademiska Hus innan något byggs —
sannolikt fel URL eller den nu fixade race-buggen.

### (e) Volym
~12 aktuella + 3 framtida = ~15 projekt. Låg volym.

### (f) GDPR
Detaljsidor kan namnge kontaktpersoner. Lämna personfält (null), Ask 3.

### (g) Föreslagen field_mapping (kandidat)
source_type: `project_page`. Två alternativ:
1. Två ci_sources-rader (aktuella → maturity awarded, framtida → planned),
   maturity sätts deterministiskt per källa.
2. En config, maturity härledd ur source_url-segmentet.
Standard project_page-LLM-extraktion över HTTP. category ur kort-etiketten
(Nybyggnad/Ombyggnad → residential/commercial/public efter behov).

---

## KONTRAKT-FRÅGOR TILL CTO CI

Jag känner inte ci_signals fullständiga schema. Utifrån ci-projectpage.json
field_mapping och TED-tillägget (counterparties jsonb, contract_end_date date)
vet jag att dessa kolumner finns: organization_name, title, maturity, amount_sek,
timeline, description, source_url, source_date, region, category, source_type,
property_designation, source_excerpt, ai_summary, counterparties, contract_end_date.
Följande behöver configsen ovan kunna skriva — avgör tillsammans med CTO Engine
om de mappas in i befintliga kolumner eller kräver nya:

1. **Planerat upphandlingsdatum (källa 2, "Planerad annonseringsstart").**
   Finns ingen dedikerad typad datumkolumn. `source_date` är källans
   publiceringsdatum, inte ett framåtblickande planerat datum. Ska planerat
   annonseringsdatum in i en ny `planned_tender_date date`-kolumn, eller
   packas i fritext-`timeline`? För filtrering/sortering i CI-appen talar det
   för en typad kolumn. **Beslut behövs.**

2. **Ytterligare planerade datum (källa 2): "Planerad sista anbudsdag",
   "Planerad avtalsstart".** Vill CI bära dessa (egna kolumner) eller räcker
   ett (annonseringsstart)? `contract_end_date` finns redan och kan bära
   avtalsstart + bedömd kontraktstid om vi får beräkna.

3. **Stabil extern rad-identitet (källa 2).** Inköpstidplanens rader har ingen
   egen URL. Befintlig `conflict_key = organization_id,source_url,title` faller
   därför ihop (source_url blir samma/null för alla rader). XLSX-raderna har en
   stabil `JournalID`. Behövs en `external_source_id`-kolumn (eller dedup på
   organization_id+JournalID+title) för att undvika kollisioner och möjliggöra
   uppdatering när en rad ändrar status ("Uppdaterad"/"Försenad")? **Beslut
   behövs** — annars kan adaptern inte deduplicera korrekt.

4. **Status/datum-säkerhet (källa 2, "Status på uppgifter, planering" =
   Säker/osäker; "Information" = Nytt/Uppdaterad/Försenad/Utgått).** Vill CI
   lagra dessa som signal om hur tillförlitligt det planerade datumet är? Ingen
   kolumn idag. Kandidat: läggs i source_excerpt, eller egen
   `data_confidence`/`change_status`-kolumn.

5. **maturity-enum-täckning.** ci-projectpage.json tillåter
   maturity ∈ {planned, tender, awarded}. Källorna mappar in i dessa (källa 2 →
   tender, källa 4 aktuella → awarded / framtida → planned). Bekräfta att inget
   nytt enum-värde (t.ex. "ongoing" för pågående bygge) behövs — annars håller
   vi oss till awarded för pågående.

6. **Kategori-kod-mappning (källa 1, poiType 1–8).** Vill CI ha den råa
   poiType-koden bevarad någonstans, eller räcker att den översätts till
   befintlig `category`-enum (commercial/residential/infrastructure/public/
   mixed)? Legenden måste i så fall kartläggas (separat liten research).

Inga personfält ingår i Ask 1-payloaden. "Kontaktperson" (källa 2) och
ev. projektledare (källa 3/4) lämnas null och tas upp i Ask 3.

## REKOMMENDERAD ONBOARDING-ORDNING

Rangordnad efter värde × lätthet. $0-strukturkällor och rena HTTP-källor först,
browser-källa sist.

**1. Akademiska Hus (`/om-oss/utveckling/projekt/aktuella/` + `/framtida/`)
— FÖRST.**
Högst värde × lätthet. Ren HTTP, snabb (0,19 s), fas deterministisk via
URL-split, låg volym (~15) = billig LLM-körning, befintlig project_page-config
återanvänds nästan rakt av. Dessutom: löser/ersätter den befintliga trasiga
Akademiska Hus-källan och ger CTO Engine anledning att kontrollera fel
listing_url i ci_sources. Lägst risk, snabbast i mål.

**2. vaxer.stockholm/projekt — ANDRA.**
Hög volym (~921) och $0-strukturväg (inbäddad GeoJSON, ingen LLM för
name/url/kategori/koordinater). Lätthet något lägre än Akademiska Hus eftersom
(a) maturity ändå kräver LLM ur fritext och (b) en liten parser för att klippa ut
och tolka `features`-arrayen ur en 700 KB-sida + en poiType-legend-lookup behöver
byggas. Men ingen browser, all data i ett HTTP-svar → mycket hög
signal-per-krona. Strategiskt central (Stockholm).

**3. Trafikverket inköpstidplan (XLSX) — TREDJE.**
Högsta datavärdet av alla fyra (927 rader med planerat datum + kostnad + status),
men lägst lätthet: kräver en **ny XLSX-adapter** (motoringenjörsarbete, inte
config), dynamisk länkupptäckt per publicering, Excel-datumkonvertering, och
löser ut kontrakt-frågorna 1–4 (planerat datum, dedup-id, status). Bör onboardas
först när adaptern och kontraktet är beslutade med CTO CI. Hör hemma i samma
adapterfamilj som Ciceron/MeetingPlus/NetPublicator.

**4. Trafikverket "Våra projekt" — SIST.**
Lägst värde × lätthet i nuläget: enda källan som kräver Playwright, ingen öppen
projekt-feed (realtids-API:t är uteslutet), oklar render-/paginerings-stabilitet,
och stor överlappning med inköpstidplanen för just Trafikverkets projekt. Onboarda
bara om CI efter källa 1–3 fortfarande saknar projekt-/statustäckning som bara
denna portal ger.
