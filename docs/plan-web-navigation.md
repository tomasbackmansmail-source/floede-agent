# Plan: Webbnavigering i Discovery

> Skapad 2026-04-08. Syfte: discovery kan hantera interaktiva sidor
> (dropdowns, sökfält, filter) för att hitta filtrerade URL:er eller
> interaktionsrecept för bygglovsdata.

---

## PROBLEMET

33 kommuner saknar data. Många av dem har anslagstavlor som kräver
interaktion — dropdown-menyer, sökfält eller filter — för att visa
bygglov. Exempel:

- **Norrtälje** — MeetingsPlus-portal (forum.norrtalje.se) med dropdown
  "Kungörelse: Beviljade beslut enligt plan- och bygglagen". Filtrerad URL
  med query-parameter ger data direkt.
- **Liknande system**: NetPublicator, Ciceron, egenutvecklade React-appar.

Idag kan discovery inte:
1. Identifiera dropdowns, sökfält eller filter på en sida
2. Testa search_terms mot interaktiva element
3. Hitta filtrerade URL:er med query-parametrar

---

## LÖSNINGSDESIGN

### Nytt steg i discoverSource(): interactWithPage()

Placeras som **steg 5** i eskaleringskedjan, efter Haiku (steg 4) och
före Sonnet (steg 6). Motivering: steget kräver Playwright + LLM-anrop
och är dyrare än steg 1-4, men billigare än Sonnet web-search.

```
discoverSource() eskaleringsordning:
  1. URL-varianter ($0)
  2. Crawl homepage ($0)
  3. Sitemap ($0)
  4. Haiku link-analys (~$0.001)
  5. interactWithPage() — NY (~$0.005-0.02)  ← denna plan
  6. Sonnet web-search (~$0.15)
```

### Flödet i interactWithPage()

```
1. Playwright laddar listing_url (från steg 1-4, eller homepage)
2. Extrahera DOM-metadata:
   - <select>-element: alla <option> med text + value
   - <input type="text/search">: placeholder, name, id
   - <button>/<input type="submit">: text
   - <form>: action-URL, method
   - Synliga filter-knappar/tabs (role="tab", class*="filter")
3. Skicka DOM-metadata + search_terms till Haiku
4. Haiku returnerar interaktionsplan:
   a) SELECT: { selector, option_value, option_text }
   b) SEARCH: { selector, search_term }
   c) CLICK: { selector }
   d) NONE: (inga relevanta interaktiva element)
5. Playwright utför interaktionen
6. Vänta på response (networkidle eller DOM-mutation)
7. Analysera resultat:
   a) URL ändrades → query-parametrar tillagda → spara filtrerad URL
   b) URL oförändrad, DOM ändrad → spara interaktionsrecept
   c) Ingen förändring → misslyckat, returnera found: false
```

---

## FILER SOM ÄNDRAS

### 1. `src/utils/discovery.js` — ny funktion + integration

**Ny funktion: `interactWithPage(pageUrl, searchTerms, discoveryConfig)`**

Returnerar:
```javascript
{
  found: boolean,
  url: string | null,          // Filtrerad URL (om query-parametrar)
  interaction_recipe: object | null,  // Recept (om JS-interaktion)
  method: "interact_page",
  cost_usd: number,
  details: { ... }
}
```

**Ändring i `discoverSource()`** (rad 508-587):
Lägg till steg 5 mellan Haiku (rad 556) och return (rad 569):

```javascript
// Step 5: Interactive page exploration (Playwright + Haiku)
if (discoveryConfig.interact_page?.enabled !== false) {
  const interactResult = await interactWithPage(
    sourceUrl, searchTerms, discoveryConfig, browser
  );
  if (interactResult.found) {
    return {
      found: true,
      url: interactResult.url,
      method: 'interact_page',
      platform: urlResult.platform || 'unknown',
      confidence: 'medium',
      cost_usd: (haikuResult.cost_usd || 0) + interactResult.cost_usd,
      interaction_recipe: interactResult.interaction_recipe,
      details: interactResult,
    };
  }
}
```

**Ny funktion: `extractInteractiveElements(page)`**

Kör i Playwright-kontext, returnerar strukturerad DOM-metadata:

```javascript
async function extractInteractiveElements(page) {
  return await page.evaluate(() => {
    const elements = { selects: [], inputs: [], buttons: [], forms: [] };

    // Alla <select> med options
    document.querySelectorAll('select').forEach(sel => {
      const options = [...sel.options].map(o => ({
        value: o.value,
        text: o.textContent.trim(),
        selected: o.selected,
      }));
      elements.selects.push({
        id: sel.id, name: sel.name,
        label: document.querySelector(`label[for="${sel.id}"]`)?.textContent?.trim() || null,
        options,
      });
    });

    // Sökfält
    document.querySelectorAll('input[type="text"], input[type="search"], input[name*="search"], input[name*="sok"]').forEach(inp => {
      elements.inputs.push({
        id: inp.id, name: inp.name, type: inp.type,
        placeholder: inp.placeholder || null,
        label: document.querySelector(`label[for="${inp.id}"]`)?.textContent?.trim() || null,
      });
    });

    // Knappar och filter-tabs
    document.querySelectorAll('button, [role="tab"], .filter-btn, [class*="filter"]').forEach(btn => {
      elements.buttons.push({
        tag: btn.tagName, text: btn.textContent.trim().slice(0, 100),
        id: btn.id, classes: btn.className,
      });
    });

    // Formulärdefinitioner
    document.querySelectorAll('form').forEach(form => {
      elements.forms.push({
        action: form.action, method: form.method,
        id: form.id,
      });
    });

    return elements;
  });
}
```

**Ny funktion: `askHaikuForInteraction(elements, searchTerms, config)`**

Prompt till Haiku:

```
Du får en lista över interaktiva element (dropdowns, sökfält, knappar)
från en svensk kommuns webbsida. Vi söker efter bygglovsdata.

Söktermer: ${searchTerms.join(", ")}

Interaktiva element:
${JSON.stringify(elements, null, 2)}

Finns det någon dropdown, sökfält eller filter som kan visa
bygglovsärenden när man väljer rätt alternativ?

Svara ENBART med JSON:
{
  "action": "SELECT" | "SEARCH" | "CLICK" | "NONE",
  "selector": "CSS-selektor för elementet",
  "value": "värde att välja/skriva (eller null)",
  "reason": "kort motivering"
}
```

### 2. `src/config/verticals/byggsignal.json` — ny config-sektion

```json
"interact_page": {
  "enabled": true,
  "max_interactions": 3,
  "wait_after_interaction_ms": 3000,
  "haiku_model": "claude-haiku-4-5-20251001"
}
```

Läggs till under `discovery`-objektet.

### 3. `src/config/discovery-schema.js` — utökad config

Lägg till `interaction_recipe` i CONFIG_SCHEMA:

```javascript
interaction_recipe: {
  type: "object",
  description: "Steps to reproduce data view if URL alone is insufficient",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["select", "click", "type"] },
          selector: { type: "string" },
          value: { type: "string" }
        }
      }
    }
  }
}
```

### 4. `src/daily-run.js` — stöd för interaction_recipe

**Ändring i `fetchPagePlaywright()`** (rad 134-231):

Lägg till hantering av `config.interaction_recipe` efter `page.goto()`:

```javascript
// After initial page load (rad 139), before pagination handling:
if (config.interaction_recipe && config.interaction_recipe.steps) {
  for (const step of config.interaction_recipe.steps) {
    try {
      if (step.action === 'select') {
        await page.selectOption(step.selector, step.value);
      } else if (step.action === 'click') {
        await page.click(step.selector);
      } else if (step.action === 'type') {
        await page.fill(step.selector, step.value);
        // Tryck Enter efter sökning
        await page.press(step.selector, 'Enter');
      }
      await page.waitForTimeout(config.interaction_recipe.wait_ms || 3000);
    } catch (err) {
      console.log(`  [Browser] Interaction step failed: ${step.action} ${step.selector} — ${err.message}`);
    }
  }
}
```

### 5. `src/discover.js` — skicka browser till discoverSource

`discoverSource()` behöver nu en Playwright browser-instans för steg 5.
Ändring i main() (rad 381): skicka browser som fjärde argument.

```javascript
// Rad 381: Skapa browser tidigare (före loopen)
if (!browser) browser = await chromium.launch({ headless: true });

const cheapResult = await discoverSource(target.name, target.url, discoveryConfig, browser);
```

Alternativt: interactWithPage() startar/stoppar sin egen browser.
Enklare men långsammare. Rekommendation: dela browser från discover.js.

### 6. `test/discovery.test.js` — nya tester

```javascript
// Test: extractInteractiveElements returnerar selects, inputs, buttons
// Test: askHaikuForInteraction returnerar SELECT för MeetingsPlus-liknande DOM
// Test: interactWithPage returnerar filtrerad URL när query-params ändras
// Test: interactWithPage returnerar recipe när URL är oförändrad
// Test: interaction_recipe i fetchPagePlaywright kör steps korrekt
```

---

## TVÅ UTFALL: URL vs RECEPT

### Utfall A: Filtrerad URL (föredras)

När interaktionen ändrar URL:en (lägger till query-parametrar) sparar vi
den filtrerade URL:en direkt i `discovery_configs.config.listing_url`.

**Exempel — Norrtälje:**
```
Bas-URL: https://forum.norrtalje.se/digital-bulletin-board
Filtrerad: https://forum.norrtalje.se/digital-bulletin-board?announcementTypeId=b1ab667d-e381-4a65-aa01-40941d5ec558&manageableOnly=false&pageSize=100
```

Framtida körningar: HTTP fetch direkt, ingen interaktion, ingen extra kostnad.

### Utfall B: Interaktionsrecept (fallback)

När interaktionen ändrar DOM men inte URL:en sparar vi ett recept:

```json
{
  "interaction_recipe": {
    "steps": [
      { "action": "select", "selector": "#announcementType", "value": "bygglov-decisions" },
      { "action": "click", "selector": "button.search-btn" }
    ],
    "wait_ms": 3000
  }
}
```

Framtida körningar: `fetchPagePlaywright()` spelar upp receptet.
Dyrare (Playwright), men fungerande. Receptet kan bli inkorrekt om
sidan redesignas — daily-run loggar varningar, QC fångar zero-streak.

---

## KOSTNADSESTIMAT PER KÄLLA

| Komponent | Kostnad |
|-----------|---------|
| Playwright page load | $0 (lokal CPU) |
| extractInteractiveElements | $0 (ren JS i browser) |
| Haiku DOM-analys | ~$0.002-0.005 (500-1500 input tokens, ~100 output) |
| Haiku retry (om första interaktion misslyckas) | ~$0.002-0.005 |
| **Totalt per källa** | **~$0.005-0.02** |
| **33 kommuner** | **~$0.17-0.66** |

Jämförelse: Sonnet web-search kostar ~$0.15 per källa. interactWithPage
är 10-30x billigare.

### Token-uppskattning för DOM-analys

- Typisk extractInteractiveElements output: 500-2000 tokens
  (5-15 selects, 3-10 inputs, 10-30 knappar)
- search_terms: ~50 tokens
- Prompt-overhead: ~200 tokens
- Total input: ~750-2250 tokens
- Output: ~100 tokens (en JSON-rad)

---

## TESTFALL

### 1. Norrtälje (MeetingsPlus)

**System:** MeetingsPlus (forum.norrtalje.se/digital-bulletin-board)
**Interaktion:** Dropdown "Typ av kungörelse" → välja "Beviljade beslut
enligt plan- och bygglagen"
**Förväntan:** URL ändras med `announcementTypeId=...` query-parameter
**Utfall:** Filtrerad URL sparas i config → HTTP fetch i daily-run

Verifiering:
```bash
VERTICAL=byggsignal node -e "
import { interactWithPage } from './src/utils/discovery.js';
const result = await interactWithPage(
  'https://forum.norrtalje.se/digital-bulletin-board',
  ['bygglov', 'kungörelse', 'beviljat'],
  { interact_page: { enabled: true, haiku_model: 'claude-haiku-4-5-20251001' } }
);
console.log(result);
"
```

### 2. Ciceron-kommuner (JSON-RPC, 14 kommuner)

**System:** Ciceron (används av ~14 kommuner, t.ex. Borås, Eskilstuna)
**Interaktion:** Dessa använder ofta React med interna API-anrop.
extractInteractiveElements hittar troligen inga relevanta <select>.
Men: formuläret kan ha filter-knappar eller tabs.
**Förväntan:** interactWithPage returnerar NONE → eskalerar till Sonnet.
Alternativt: om ett filter-klick avslöjar XHR-anrop till JSON-RPC-endpoint,
kan vi spara API-URL:en direkt.
**Separat övervägande:** Ciceron-kommuner bör hanteras med dedikerad
API-integration (se stabiliseringsplan), inte via DOM-interaktion.

### 3. NetPublicator-kommuner

**System:** NetPublicator (t.ex. Lidingö, Mark)
**Interaktion:** Ofta en söklista med dropdown för "Dokumenttyp" eller
"Kategori". Valet "Bygglov" filtrerar listan.
**Förväntan:** URL ändras med query-parameter, eller DOM uppdateras.
**Testkommun:** Identifiera en specifik NetPublicator-kommun från de 33
som saknar data.

### 4. Egenbyggda React/SPA-sidor

**System:** Kommuner med egenutvecklade lösningar
**Interaktion:** Varierar. Kan vara tabs, sökfält, datumfilter.
**Förväntan:** Lägre hit-rate. Många kommer returnera NONE från Haiku.
**Fallback:** Sonnet (steg 6).

---

## RISKER OCH BEGRÄNSNINGAR

1. **Selektorer är bräckliga.** CSS-selektorer från Haiku kan sluta fungera
   vid redesign. Mitigation: QC fångar zero-streak, triggar rediscovery.
   interaction_recipe är inte manuellt underhållet — det återskapas.

2. **Shadow DOM / iframes.** Vissa CMS:er renderar interaktiva element
   i shadow DOM eller iframes. `page.evaluate()` ser inte in i dessa.
   Mitigation: om extractInteractiveElements returnerar tomt, logga
   "no interactive elements found" och eskalera till Sonnet.

3. **CAPTCHA / cookie-consent.** Popup-dialoger kan blockera interaktion.
   Mitigation: försök klicka bort cookie-consent före interaktion
   (redan ett känt mönster i daily-run Playwright-flöde).

4. **Multipla interaktioner krävs.** Vissa sidor kräver 2-3 steg
   (välja kategori → välja underkategori → klicka sök). Config-värdet
   `max_interactions: 3` begränsar detta. Haiku får returnera en
   sekvens av steg om första steget inte räcker.

5. **Haiku-hallucination.** Haiku kan föreslå selektorer som inte finns.
   Mitigation: Playwright validerar selektorn (page.$(selector)) före
   interaktion. Om null → logga + retry med korrigering.

---

## INTEGRATION MED BEFINTLIGT FLÖDE

### discoverSource() (discovery.js)

```
Steg 1: URL-varianter      → found? return
Steg 2: Crawl homepage     → found? return
Steg 3: Sitemap             → found? return
Steg 4: Haiku link-analys  → found? return
Steg 5: interactWithPage() → found? return  ← NY
   ↓ (alla misslyckades)
return { found: false, ... }
```

Sonnet (steg 6) körs bara från discover.js main(), inte från
discoverSource(). Det ändras inte.

### discover.js main()

Ändring: browser skapas före loopen (rad 411-413 idag), delas med
discoverSource via parameter. Om browser redan finns (för Sonnet)
återanvänds den.

### verifyExtraction()

Oförändrad. Kör efter interactWithPage som vanligt. Om filtrerad URL
returneras körs verify på den. Om recept returneras körs verify
med fetchPagePlaywright (som nu stöder recept).

### daily-run.js

`fetchPagePlaywright()` får ny gren för interaction_recipe (beskriven ovan).
Inga andra ändringar i daily-run.

### qc.js

Oförändrad. Zero-streak-detektion och feedback-loop fungerar som idag.
Om en interaction_recipe slutar fungera (sidan redesignas) → QC fångar
zero-streak → triggar rediscovery → interactWithPage kör igen med
uppdaterade selektorer.

---

## IMPLEMENTATION — ORDNING

```
1. extractInteractiveElements() — ren Playwright-funktion, testbar
2. askHaikuForInteraction() — Haiku-prompt, testbar med mock
3. interactWithPage() — orkestrator, integrerar 1+2
4. Integration i discoverSource() — steg 5
5. interaction_recipe-stöd i fetchPagePlaywright()
6. Config-ändring: interact_page i byggsignal.json
7. discovery-schema.js: interaction_recipe-fält
8. Tester
9. Manuell test: Norrtälje + 2 andra kommuner
```

Steg 1-3 kan kodas och testas utan att röra befintliga filer.
Steg 4-7 är integrationsändringarna.

---

## FÖRVÄNTADE RESULTAT

| Scenario | Uppskattning |
|----------|-------------|
| Kommuner med dropdown-filter (MeetingsPlus, NetPublicator) | 10-15 läggs till |
| Kommuner med sökfält | 3-5 läggs till |
| Kommuner med JS-tabs/knappar | 2-5 läggs till |
| Kommuner där interaktion inte räcker (CAPTCHA, login, PDF) | 5-10 oförändrade |
| **Total ny täckning från interactWithPage** | **~15-25 kommuner** |

Tillsammans med stabiliseringsplanens övriga steg (batch-verify, 404-rediscovery)
når vi 280+ kommuner.
