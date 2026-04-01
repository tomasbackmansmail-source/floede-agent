# QC-rapport: Stockholms stad

**Vertikal:** CI-Pressroom (Client Intelligence)
**Datum:** 2026-04-01
**Kalla:** Stockholms stad (Stockholmshem nyhetsarkiv)

---

## Sammanfattning

**Status: GODKAND MED ANMARKNINGAR**

Extraction fungerar korrekt. 1 signal verifierad i databasen. Kallan producerar
0 signaler de flesta dagar (forvantat — operationella nyheter dominerar sida 1).
Mynewsdesk-dubbletten borttagen.

---

## Verifierad signal i databasen

| Falt | Varde | Status |
|------|-------|--------|
| title | Skyfallssakring av fastigheter – investering 30 mkr | OK |
| organization_name | Stockholmshem | OK |
| maturity | planned | OK |
| amount_sek | 30000000 | OK (konverterat fran "30 miljoner kronor") |
| source_date | 2025-04-22 | OK (ISO 8601) |
| source_url | https://www.stockholmshem.se/om-oss/nyhetsarkiv/?p=2 | OK |
| description | Stockholmshem investerar ca 30 mkr for skyfallssakring | OK |
| organization_id | null | ANMARKNING — se nedan |

---

## Konfiguration i ci_sources

- **id:** e2934fc7-587a-49d3-a329-2fcda4c18394
- **organization_name:** Stockholms stad
- **listing_url:** https://www.stockholmshem.se/om-oss/nyhetsarkiv/
- **approved:** true
- **needs_browser:** false

Mynewsdesk-dubblett (784725f0, skapad 2026-03-30) borttagen — producerade
0 signaler och kravde Playwright i onodan.

---

## Daglig korning

Extraction korde korrekt med 0 signaler (sida 1 inneholl bara operationella nyheter).
Kostnad: $0.0055 per korning.

Forvantat beteende: 0 signaler de flesta dagar, 1-3 signaler nar konstruktionsnyheter
publiceras (ca 3-5 ganger per ar baserat pa historik).

---

## Anmarkningar

### 1. organization_id = null
Enrichment-lookup soker "Stockholmshem" (fran LLM-extraction) i ci_organizations,
men tabellen har bara "Stockholms stad". Stockholmshem ar ett kommunalt bolag
agt av Stockholms stad men en separat entitet.

**Atgard:** Antingen lagg till "Stockholmshem" som alias i ci_organizations,
eller acceptera null och koppla via ci_sources.organization_id istallet.

### 2. QC saknar CI-specifik validering
qc.js har ingen CI-specifik validering (kant problem, dokumenterat i CLAUDE.md).
QC kordes mot hela vertikalen och blandade ByggSignal-data med CI.
`--source='Stockholms stad'` filtrerade inte korrekt.

### 3. Lag signal-yield
Kallan producerar fa signaler. Bor utokats med:
- Stockholmshem kommande upphandlingar (maturity=tender, ~20 projekt)
- insynsverige.se Exploateringsnamnden (markanvisningar, exploateringsavtal)

---

## Bedomning

Kallan fungerar tekniskt korrekt. Extraction, field mapping och dedup
ar verifierade. Signal-yield ar lag men forvantat for denna kalltyp.
Godkand for produktion med ovan anmarkningar.
