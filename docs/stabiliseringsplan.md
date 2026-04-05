# Stabiliseringsplan: 280+ kommuner med daglig data

> Skapad 2026-04-05. Mål: motorn producerar data för 280+ av 290 kommuner,
> feedback-loopen self-healar, och täckningsrapporten bevisar det.

---

## NULÄGE

| Mått | Värde |
|------|-------|
| Totalt i discovery_configs | 292 |
| Villaägarna seedade (apply-log) | 137 (98 HTTP, 39 needs_browser) |
| Villaägarna ej seedade (was_verified=true) | 57 (hoppades i apply, behöver manuell review) |
| Villaägarna-URL:er live (HTTP 200) | 263 av 290 |
| Live med bygglov-keywords | 199 |
| Live utan keywords (JS-renderade?) | 71 |
| URL:er 404/error | 27 (25 not_found + 2 error) |
| Ciceron-kommuner (JSON-RPC, inget LLM) | 14 |
| Mål: 280+ med data | ~148 idag → +132 att fixa |

### Tre kategorier av saknade kommuner

**Kategori A: 137 seedade men ej verifierade (~98 HTTP + 39 browser)**
Villaägarna-URL:er applicerade till discovery_configs med `verified: false`.
Dessa kommer inte köras av daily-run (kräver `approved: true`).
seed-apply satte `verified: false` men bevarade `approved` — de 137 som
var `approved: false` tidigare förblev det. De behöver verifieras och godkännas.

**Kategori B: 57 som hoppades (was_verified=true)**
Dessa hade redan en verifierad URL i DB men villaägarna hade en annan URL.
Exporterade till data/seed-verified-review.json. Dessa fungerar troligen
redan — behöver bara bekräftas.

**Kategori C: 71 "anslagstavla_annat_format" (needs_browser)**
Live URL:er men inga bygglov-keywords i HTTP-response. Troligen:
- JS-renderade anslagstavlor (MeetingsPlus, NetPublicator, React-appar)
- Generiska kommunsidor som behöver navigation till rätt undersida
- Kommuner som publicerar protokoll/kallelser istället för anslagstavla

---

## PLAN — 7 STEG

### Steg 1: Batch-verifiera och godkänn seedade configs

**Vad:** Kör `verifyExtraction()` på alla 137 seedade URL:er. Godkänn de
som producerar >0 items. Flagga `needs_browser` för de som har keywords
men ger 0. Markera failed för resten.

**Varför:** 137 configs sitter i DB med `verified: false`. Daily-run
ignorerar dem. Detta är den snabbaste vägen till +80-100 kommuner.

**Fil:** Nytt script `src/batch-verify-seeds.js`

**Logik:**
```
1. Ladda alla configs med verified=false från discovery_configs
2. För varje config:
   a. fetchPage(listing_url) — HTTP
   b. Om HTML innehåller keywords → kör verifyExtraction()
   c. Om result_count > 0 → uppdatera verified=true, approved=true
   d. Om result_count = 0 men keywords finns → sätt needs_browser=true, approved=true
   e. Om ingen data och inga keywords → logga som failed
3. Rapport: X verifierade, Y needs_browser, Z failed
```

**Budget:** ~$0.15 (137 × Haiku-anrop, men bara de med keywords ~100 st)

**Verifiering:**
- Kör scriptet, granska rapporten
- Kör `VERTICAL=byggsignal node src/daily-run.js --source="[3 nyligen godkända]"`
- Bekräfta att permits extraheras korrekt för minst 3 stickprov
- Jämför antal approved configs före/efter

---

### Steg 2: Fixa verifyExtraction — godkänn aldrig 0 items utan needs_browser

**Vad:** verifyExtraction (discovery.js:591) godkänner idag configs som
producerar 0 items om keywords hittas (sätter `needs_browser: true`).
triggerRediscovery (qc.js:314) auto-approvar `needs_browser` utan att
verifiera att Playwright faktiskt ger data.

**Problem:** En config kan bli approved med 0 verifierade items. Daily-run
eskalerar HTTP→Playwright, men om Playwright också ger 0 så fastnar
kommunen i en loop: QC flaggar → rediscovery → samma URL → approved → 0 → QC flaggar.

**Ändring i `src/utils/discovery.js`:**
```
verifyExtraction() — ny parameter: { requireMinItems: 1 } (default)
Om result_count < requireMinItems → verified: false, oavsett keywords.
needs_browser-flaggan sätts fortfarande (information), men verified=false.
```

**Ändring i `src/qc.js` triggerRediscovery():**
```
Rad 314: Ändra villkoret:
  FÖRE:  const shouldApprove = verifyResult.verified || verifyResult.needs_browser;
  EFTER: const shouldApprove = verifyResult.verified && verifyResult.result_count > 0;
         // needs_browser-flaggan sparas men auto-approve kräver faktisk data
```

**Varför:** Principen "godkänn aldrig en URL som ger 0 data" kräver att
verified=true bara sätts när extraction faktiskt producerade items.
needs_browser är en hint, inte ett bevis.

**Verifiering:**
- `npm test` — befintliga tester gröna
- Nytt test: verifyExtraction med 0 items + keywords → verified: false, needs_browser: true
- Nytt test: triggerRediscovery med needs_browser=true, result_count=0 → shouldApprove: false
- Manuellt: kör verifyExtraction på en känd JS-renderad kommun → bekräfta att den INTE auto-approvas

---

### Steg 3: Stärk feedback-loopen — QC → rediscovery → verify → approve

**Vad:** Tre bugfixar/förbättringar i QC feedback-loopen.

**3a. homepageMap-lookup missar ÅÄÖ-kommuner**

qc.js rad 596-604: homepageMap byggs med tre nyckelvarianter per kommun,
men `candidate.municipality` (rad 618) kan vara den normaliserade formen
medan nycklarna kräver exakt match. Om lookup misslyckas → `homepageUrl = null`
→ triggerRediscovery har ingen homepage att utgå ifrån → discovery misslyckas.

**Fix:** Lägg till normaliserade former av candidate.municipality i lookup:
```javascript
const homepageUrl = homepageMap[candidate.municipality]
  || homepageMap[normalizeToAscii(candidate.municipality)]
  || homepageMap[candidate.municipality.normalize('NFC').toLowerCase()]
  || null;
```

**3b. checkZeroStreak kräver exakt N dagar med QC-körningar**

checkZeroStreak (qc.js:228) letar efter N rader med `permits_extracted=0`
i qc_runs. Men om QC inte kördes en dag (deploy, timeout, Railway-problem)
finns ingen rad → streak bryts. En kommun som producerat 0 i 5 av 6 dagar
men missade dag 3 har max streak 2 (under threshold 3).

**Fix:** Räkna dagar-utan-data istället för dagar-med-nollrad:
```
1. Hämta alla qc_runs (inkl >0) inom lookback
2. Hitta dagar med data > 0 → senaste datum med data
3. Om (idag - senaste_datum_med_data) >= threshold → zero streak
```

**3c. Re-discovery hittar samma URL → fastnar**

triggerRediscovery (qc.js:298-304) skipppar om `result.url === currentUrl`.
Men discoverSource kör bara steg 1-4 (URL-varianter, crawl, sitemap, Haiku).
Om kommunens URL ändrats utanför dessa metoder hittar den bara den gamla.

**Fix:** Om samma URL hittas, lägg till en `stale_rediscovery_count` på
config-raden. Om count >= 3 → flagga för manuell review i daglig mail.

**Verifiering:**
- 3a: Kör QC med `--source="Ängelholm"` (ÅÄÖ-namn) → bekräfta att homepage hittas
- 3b: Lägg test-rad i qc_runs med lucka → bekräfta att streak ändå detekteras
- 3c: Kör rediscovery på en kommun med korrekt URL → bekräfta att count ökar
- `npm test` gröna

---

### Steg 4: Playwright-verifiering för needs_browser-kommuner

**Vad:** 71 kommuner klassificerade som "anslagstavla_annat_format" behöver
Playwright. Idag eskalerar daily-run HTTP→Playwright per körning, men
det finns inget batch-verifieringsflöde för needs_browser-configs.

**Fil:** Nytt script `src/batch-verify-browser.js`

**Logik:**
```
1. Ladda configs med needs_browser=true, approved=true
2. Starta Playwright
3. För varje config:
   a. Navigera till listing_url
   b. Vänta 5s på JS-rendering
   c. Extrahera HTML
   d. Kör extraction prompt
   e. Om items > 0 → logga OK, uppdatera verified=true
   f. Om items = 0 → logga FAIL, flagga needs_manual_review
4. Stäng Playwright efter 30 st (minnesläckor)
5. Rapport
```

**Budget:** ~$0.10 (71 × Haiku), plus Playwright CPU-tid.

**Varför:** De 71 kommunerna är den näst största poolen efter steg 1.
Utan Playwright-verifiering vet vi inte vilka som faktiskt kan leverera data.

**Verifiering:**
- Kör scriptet, granska rapport
- Stickprov: kör daily-run med `--source="Stockholm"` (känd JS-sajt) → permits > 0
- Jämför totalt antal verified+approved configs före/efter

---

### Steg 5: Hantera 27 saknade URL:er (404/error)

**Vad:** 25 kommuner returnerar 404 och 2 ger error i villaägarna-validation.
Dessa URL:er är felaktiga och behöver ny discovery.

**Metod:** Kör discoverSource() med kommunens homepage som input.

**Fil:** Nytt script `src/batch-rediscover-failed.js`

**Logik:**
```
1. Läs villaagarna-validation.json
2. Filtrera: classification == 'not_found' || classification == 'error'
3. För varje kommun:
   a. Hämta homepage från municipalities-tabellen (eller villaagarna hemsida-fält)
   b. Kör discoverSource(name, homepage, discoveryConfig)
   c. Om found → kör verifyExtraction()
   d. Om verified → uppdatera discovery_configs (approved: true)
   e. Om ej found → logga för manuell hantering
4. Rapport
```

**Budget:** ~$0.50 (27 kommuner, varav ~10 kräver Haiku-steg)

**Verifiering:**
- Kör scriptet, granska rapport
- Manuellt öppna 5 av de nyhittade URL:erna i webbläsare → bekräfta att det är anslagstavlor
- Kör daily-run med `--source="[nyfunnen kommun]"` → permits > 0

---

### Steg 6: Täckningsrapport i daglig mail

**Nuläge:** agent-runner.js (rad 237-268) beräknar täckning som
"kommuner med data senaste 7 dagarna / godkända configs". Rapporten
visar ett enda tal.

**Ändring i `src/agent-runner.js` sendSummary():**

```
Utöka täckningsavsnittet med:
1. Täckning: X/Y kommuner med data senaste 7 dagarna (Z%)
2. Trend: +N / -M sedan förra veckan
3. Noll-streak: lista kommuner med ≥3 dagar utan data (max 20)
4. Nyligen self-healade: kommuner där rediscovery lyckades senaste 24h
5. Needs attention: kommuner flaggade needs_manual_review
```

**Datakällor:**
- permits_v2 (senaste 7 dagar) → aktiva kommuner
- discovery_configs (approved=true) → total
- qc_runs (senaste 7 dagar) → zero streaks
- discovery_runs (senaste 24h, success=true) → self-healing-bevis
- discovery_configs (needs_manual_review=true) → manuella åtgärder

**Varför:** Tomas behöver se trenden utan att öppna Supabase. Rapporten
bevisar (eller avslöjar) att motorn self-healar.

**Verifiering:**
- Kör agent-runner lokalt (eller bara sendSummary med mockdata)
- Granska mail: alla sektioner finns, siffror rimliga
- Bekräfta att noll-streak-listan matchar QC-körningens output

---

### Steg 7: Bevisa self-healing — en automatisk rediscovery

**Vad:** Bevisa hela kedjan: QC detekterar zero-streak → triggar
discoverSource → verifyExtraction → auto-approve → nästa daily-run
extraherar data med ny URL.

**Metod:**
1. Välj en kommun som just fått en ny verifierad URL (steg 1 eller 5)
2. Manuellt sätt `approved: false` i discovery_configs
3. Kör daily-run → kommunen hoppar (ej approved)
4. Kör QC → zero-streak detekteras
5. QC triggar triggerRediscovery → hittar ny URL → verify → approve
6. Kör daily-run igen → kommunen extraherar data
7. Dokumentera hela kedjan med logg-output

**Alternativt (naturligt test):**
- Vänta 3 dagar efter steg 1-5 deployats
- Minst en kommun bör naturligt ha en URL-ändring
- QC bör detektera och self-heala
- Kontrollera discovery_runs-tabellen

**Verifiering:**
- discovery_runs har en rad med success=true, triggered_by=qc_zero_streak
- permits_v2 har nya rader för kommunen efter self-healing
- Daglig mail visar kommunen under "Nyligen self-healade"

---

## ORDNING OCH BEROENDEN

```
Steg 1 (batch-verify seeds)
  ↓
Steg 2 (fixa verifyExtraction) ← kan göras parallellt med 1
  ↓
Steg 3 (feedback-loop fixar) ← beror på steg 2
  ↓
Steg 4 (Playwright-verify) ← beror på steg 1 (vet vilka som missade HTTP)
  ↓
Steg 5 (rediscover 404:or) ← oberoende, kan köras parallellt med 4
  ↓
Steg 6 (täckningsrapport) ← oberoende, kan göras när som helst
  ↓
Steg 7 (bevisa self-healing) ← beror på steg 2+3
```

**Kritisk väg:** 1 → 2 → 3 → 7
**Parallella spår:** 4+5 (efter 1), 6 (oberoende)

---

## FILER SOM ÄNDRAS

| Fil | Ändring | Steg |
|-----|---------|------|
| `src/batch-verify-seeds.js` | NY — batch-verifierar seedade configs | 1 |
| `src/utils/discovery.js` | verifyExtraction: kräv result_count > 0 för verified=true | 2 |
| `src/qc.js` | triggerRediscovery: auto-approve bara vid verified + items > 0 | 2 |
| `src/qc.js` | homepageMap: förbättrad ÅÄÖ-lookup | 3a |
| `src/qc.js` | checkZeroStreak: räkna dagar-utan-data istf nollrader | 3b |
| `src/qc.js` | stale_rediscovery_count vid samma-URL-resultat | 3c |
| `src/batch-verify-browser.js` | NY — Playwright-batch-verifiering | 4 |
| `src/batch-rediscover-failed.js` | NY — rediscover 404-kommuner | 5 |
| `src/agent-runner.js` | sendSummary: utökad täckningsrapport | 6 |
| `tests/qc.test.js` | Nya tester för steg 2, 3a, 3b | 2-3 |
| `tests/discovery.test.js` | Nytt test: verifyExtraction med 0 items | 2 |

---

## BUDGET

| Steg | Uppskattad kostnad |
|------|--------------------|
| 1. Batch-verify seeds | ~$0.15 |
| 2. Kodändring | $0 |
| 3. Kodändring | $0 |
| 4. Playwright-verify | ~$0.10 |
| 5. Rediscover 404:or | ~$0.50 |
| 6. Kodändring | $0 |
| 7. Self-healing test | ~$0.01 |
| **Totalt** | **~$0.76** |

---

## FÖRVÄNTADE RESULTAT

| Steg | Förväntad ökning |
|------|------------------|
| Start | ~148 kommuner med data |
| Efter steg 1 | +80-100 (HTTP-seedade som verifieras) |
| Efter steg 4 | +20-40 (Playwright-kommuner) |
| Efter steg 5 | +10-15 (404:or som rediscoveras) |
| **Mål** | **258-303 kommuner med data** |

De kommuner som troligen inte nås:
- ~5-10 kommuner utan digital anslagstavla överhuvudtaget
- ~3-5 kommuner med unika system (login, PDF-only, etc.)
- 280+ realistiskt om steg 1+4+5 alla levererar

---

## RISKER

1. **Villaägarna-URL:er kan vara inaktuella** — de validerades vid ett tillfälle
   men kommuner byter URL-struktur regelbundet. Mitigation: verifyExtraction
   före godkännande (steg 1).

2. **Playwright-minnesläckor** — 71 kommuner i en batch kan krascha.
   Mitigation: browser-restart var 30:e källa (redan implementerat).

3. **QC-historik saknas** — om steg 1 godkänner 100 configs direkt,
   har de 0 dagar i qc_runs. checkZeroStreak triggar inte förrän
   efter threshold+1 dagar. Mitigation: förväntat beteende, inte en risk.

4. **Content hashing — första körningen dyr** — alla nya configs saknar
   content_hash, så LLM körs på alla. Budget ~$0.50 för 100 nya Haiku-anrop.
   Mitigation: förväntat, hashar byggs upp efter första körningen.
