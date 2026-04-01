# CI — Stockholms stad (Stockholmshem nyhetsarkiv) — Implementationsrapport

**Datum:** 2026-04-01
**Vertikal:** ci-pressroom
**Källa:** Stockholmshem nyhetsarkiv
**Utförd av:** config-builder subagent

---

## Sammanfattning

Stockholmshem nyhetsarkiv (https://www.stockholmshem.se/om-oss/nyhetsarkiv/) har lagts till som en godkänd källa under organisationen "Stockholms stad" i ci_sources. Extraction fungerar och producerar korrekta CI-signaler med rätt fält.

**Resultat:** 1 signal extraherad och verifierad, 1 inserterad i ci_signals.

**Total kostnad:** ~$0.013 (3 Sonnet-körningar under iteration)

---

## Konfiguration skapad

### Supabase-rad i ci_sources

- **id:** e2934fc7-587a-49d3-a329-2fcda4c18394
- **organization_id:** 32e2a288-5365-43a6-a03b-770ff5aba1a9 (Stockholms stad)
- **organization_name:** Stockholms stad
- **url:** https://www.stockholmshem.se/om-oss/nyhetsarkiv/
- **source_type:** pressroom
- **approved:** true
- **needs_browser:** false
- **config.listing_url:** https://www.stockholmshem.se/om-oss/nyhetsarkiv/
- **config.needs_browser:** false

Ingen subpages-konfiguration — motorn fetchar listningssidan direkt och låter LLM:en filtrera relevanta signaler ur artikelsammanfattningarna.

---

## Iterationer

### Iteration 1 — Bas-config utan subpages

**Config:** `listing_url = https://www.stockholmshem.se/om-oss/nyhetsarkiv/`, `needs_browser = false`

**Resultat:** 0 signaler, kostnad $0.0055

**Analys:** LLM körde korrekt men hittade inga konstruktionssignaler. Sidan visade bara de 10 senaste nyheterna (2025-2026), som var operationella nyheter (parkeringsmoms, öppettider, tvättbokning). Korrekt beteende — inga falska positiver.

### Iteration 2 — Test med subpages

**Config:** `requires_subpages.required = true`, `link_selector_hint = "a[href*='/om-oss/nyhetsarkiv/']"`

**Resultat:** 0 signaler — länkfiltrering via CI-nyckelord sållade bort alla artiklar på sida 1 eftersom inga titlar innehöll konstruktionsnyckelord.

**Analys:** Subpages-konfigurationen fungerar tekniskt men hjälper inte när listningssidans senaste artiklar saknar konstruktionsinnehåll. Återgick till enklare config.

### Iteration 3 — Tillfällig test med ?p=2

**Config:** `listing_url = https://www.stockholmshem.se/om-oss/nyhetsarkiv/?p=2` (sida 2 innehåller "Stockholmshem skyfallssäkrar fastigheter" från 2025-04-22)

**Resultat:** 1 signal extraherad och inserterad korrekt

**Verifierad signal:**
```json
{
  "title": "Skyfallssäkring av fastigheter – investering 30 mkr",
  "organization_name": "Stockholmshem",
  "maturity": "planned",
  "amount_sek": 30000000,
  "source_date": "2025-04-22",
  "source_url": "https://www.stockholmshem.se/om-oss/nyhetsarkiv/?p=2",
  "description": "Stockholmshem investerar cirka 30 miljoner kronor för att skyfallssäkra fastigheter mot översvämningar till följd av kraftiga skyfall."
}
```

**Återställt till produktion:** `listing_url = https://www.stockholmshem.se/om-oss/nyhetsarkiv/` (sida 1)

---

## Verifiering

Alla förväntade fält är korrekt ifyllda:
- title: korrekt, max 80 tecken
- organization_name: "Stockholmshem" (LLM extraherade korrekt utgivaren)
- maturity: "planned" (korrekt — projekt beslutat, arbete pågår)
- amount_sek: 30000000 (korrekt konverterat från "30 miljoner kronor")
- source_date: "2025-04-22" (korrekt ISO 8601)
- source_url: satt av motorn till listing_url

**Notering:** organization_id = null i ci_signals eftersom enrichment-lookup inte hittar "Stockholmshem" i ci_organizations (som bara innehåller "Stockholms stad"). Detta är korrekt beteende — Stockholmshem är ett bolag ägt av Stockholms stad men en separat entitet. Om organization_id ska fyllas i behöver antingen:
1. "Stockholmshem" läggas till som separat organisation i ci_organizations, eller
2. ci_sources-raden kopplas direkt via source_id (stöds inte ännu av motorn)

---

## Källkarakteristik

| Egenskap | Värde |
|----------|-------|
| URL | https://www.stockholmshem.se/om-oss/nyhetsarkiv/ |
| Format | Statisk HTML |
| Nyckelord i artiklar | Konstruktionssignaler förekommer men inte i varje uppdatering |
| Uppdateringsfrekvens | Veckovis till månadsvis |
| Konstruktionsnyheter | Historiskt ca 3-5 per år |
| SSL-problem | Inga |
| JavaScript krävs | Nej |

---

## Beteende vid daglig körning

- **Normalt**: 0 signaler per körning (operationella nyheter dominerar)
- **Vid ny konstruktionsnyhet**: 1-3 signaler
- **Dedup**: Fungerar via organization_name + title + source_date
- **Alert vid 0 inserts**: Skickas men är förväntat beteende

### Observandum

Nyhetsarkivets sida 1 innehåller de 10 senaste nyheterna. Konstruktionsnyheter publiceras sporadiskt. Motorn kör korrekt — 0 resultat är normalt för denna källa de flesta dagar. Källa bör utvärderas efter 30 dagars drift för att bedöma signalyield.

---

## Alternativa källor att lägga till

Från research-rapporten, som nästa steg:

1. **Stockholmshem kommande upphandlingar** (https://www.stockholmshem.se/om-oss/upphandling/kommande-upphandlingar/) — statisk HTML, ~20 projekt, alla maturity=tender
2. **insynsverige.se Exploateringsnämnden** (https://insynsverige.se/stockholm-exploatering) — nämndbeslut om markanvisningar och exploateringsavtal

---

## Kända begränsningar

- Stockholms stads officiella *.stockholm-subdomäner ger SSL-certifikatfel vid HTTP fetch
- Via.tt.se (Svenska Bostäder) kräver Playwright
- Mynewsdesk Stockholms stad (befintlig källa) kräver Playwright och producerar 0 signaler
