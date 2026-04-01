# Stockholms stad (koncern) — Implementation

**Datum:** 2026-04-01
**Vertikal:** ci-pressroom (Client Intelligence)
**Uppgift:** Implementera tre rang-1-kallor for Stockholms stad koncern

---

## Sammanfattning

Tre kallor implementerade och verifierade. 36 signaler extraherades och
insererades korrekt med organization_id != null.

---

## Installerade kallor

### 1. Stockholmshem — Kommande upphandlingar
- **URL:** https://www.stockholmshem.se/om-oss/upphandling/kommande-upphandlingar/
- **organization_name:** Stockholms stad
- **ci_sources id:** 12ed6556-1a2a-4476-a19f-daff11b93411
- **Signaler extraherade:** 23
- **Maturity:** planned (23 — nybyggnation + ombyggnadsprojekt)
- **needs_browser:** false
- **HTML-typ:** Statisk HTML, lista med <ul><li>-struktur

### 2. Micasa Fastigheter — Mynewsdesk pressrum
- **URL:** https://www.mynewsdesk.com/se/micasa-fastigheter/pressreleases
- **organization_name:** Stockholms stad
- **ci_sources id:** 863f82cc-885f-4831-8848-94ac60ca5cd3
- **Signaler extraherade:** 5
- **Maturity:** awarded (3), planned (2)
- **needs_browser:** false
- **HTML-typ:** Statisk HTML med panel-lista och JSON-LD

### 3. SISAB — Kommande upphandlingar
- **URL:** https://www.sisab.se/sv/leverantor/upphandlingar/Kommande-upphandlingar/
- **organization_name:** Stockholms stad
- **ci_sources id:** f0289a83-a752-46a1-97f8-127adb2b1d4f
- **Signaler extraherade:** 8
- **Maturity:** tender (7), planned (1)
- **needs_browser:** false
- **HTML-typ:** Statisk HTML, Vue/React-renderat men fullt synligt i HTTP-respons

---

## Identifierat problem och losning

### Problem: organization_id = null pa alla records (iteration 1)

**Rotorsak:** Extraction_prompt instruerade LLM att extrahera
"Organisationens namn" vilket LLM tolkade som bolagsnamnet synligt i HTML
(Stockholmshem, Micasa Fastigheter, Skolfastigheter i Stockholm AB).
Enrichment-lookup matchade dessa mot ci_organizations.name = 'Stockholms stad'
och hittade inga matchningar => organization_id = null.

**Losning:** Uppdaterade extraction_prompt-regeln for organization_name fran:
```
organization_name: Organisationens namn (string)
```
till:
```
organization_name: Anvand EXAKT det organisationsnamn som anges i kontexten
ovanfor ("Organisation: [namn]"). Andras aldrig till dotterbolagets eller
subsidiaries namn, aven om ett annat bolagsnamn syns i HTML-texten. (string)
```

Kontexten "Organisation: Stockholms stad" passas redan till LLM via
daily-run.js (rad 252): `${SOURCE_LABEL}: ${municipalityName}\n\nHTML:...`
Promtandringen instruerar LLM att anvanda detta kontextvarde, inte HTML-texten.

**Varfor det loser problemet:** LLM far nu explicit instruktion att anvanda
det organizationsnamn som injiceras per kalla (fran ci_sources.organization_name),
vilket ar det namn som finns registrerat i ci_organizations och som enrichment
kan sla upp.

---

## Iterationer

| Iteration | Atgard | Resultat |
|-----------|--------|---------|
| 1 | Initial insertion av tre kallor, forsta extraction | 36 signaler, 0 med organization_id |
| 2 | Uppdaterad extraction_prompt, ny extraction | 36 signaler, 40 med organization_id (inkl 4 gamla) |

Totalt 2 iterationer.

---

## Verifiering

Kontrollpunkter klarade:

- organization_id != null: 100% (40/40 records)
- organization_name = 'Stockholms stad': 100%
- Korrekt maturity per kalltyp:
  - Stockholmshem upphandlingar: planned (nybyggnation annonseringsdag)
  - Micasa pressrum: awarded/planned (projektbeslut/kontraktsignering)
  - SISAB upphandlingar: tender (aktiva upphandlingar)
- Inga dubbletter mellan kallor (verifierat via dedup_fields)
- Alla tre HTTP-fetch, inga krav pa Playwright
- npm test: 177 tester, 0 fel

---

## Kostnadsuppskattning

| Iteration | Modell | Kostnad |
|-----------|--------|---------|
| 1 | Sonnet | $0.1143 |
| 2 | Sonnet | $0.1124 |
| **Totalt** | | **$0.2267** |

---

## Config-andringar

**Fil:** /Users/tomasbackman/floede-agent/src/config/verticals/ci-pressroom.json

Andring i extraction_prompt: organization_name-regeln (beskriven ovan).
Andringen paverkar alla CI-kallor, inte bara Stockholms stad. Effekten for
befintliga kallor (t.ex. Akademiska Hus) ar neutral — de har organization_name
= 'Akademiska Hus' i ci_sources, och LLM anvander nu alltid detta varde.

**Databas:** tre nya rader i ci_sources (ci-projektet, qvmthuylldpzcoyzryqe)

---

## Nasta steg (rekommendationer)

1. Lagg till Stockholmshem nyproduktionsprojekt (rang 1, planned-signaler)
   URL: https://www.stockholmshem.se/vi-bygger/vi-bygger-nytt/
2. Lagg till SISAB nyhetsarkiv (rang 1, mixed maturity)
   URL: https://www.sisab.se/sv/om-sisab/nyheter/
3. Overvakning: SISAB upphandlingssidan uppdateras kvartalsvis (Q2/Q3/Q4)
4. Overvakning: Stockholmshem upphandlingslista uppdateras var tredje manad
