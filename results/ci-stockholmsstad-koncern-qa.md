# QC-rapport: Stockholms stad i CI-vertikalen

## Verifiering av extraherade signaler

**Vertikal:** Client Intelligence (CI-Pressroom)
**Datum:** 2026-04-01
**Antal records testade:** 36
**Antal godkända:** 36
**Antal underkända:** 0

## Sammanfattning

Alla 36 signaler från Stockholms stad uppfyller kvalitetskraven. Ingen manuell justering krävs.

## Detaljerad verifiering

### Kritiska kontroller

#### organization_id (KRITISKT KRAV)
- **Status:** ✓ GODKÄND
- **Resultat:** 36/36 signaler har organization_id satt
- **Organization ID:** `32e2a288-5365-43a6-a03b-770ff5aba1a9` (konsistent för alla)
- **Notering:** organization_id är satt på alla signaler och är konsistent

#### Maturity-värden
- **Status:** ✓ GODKÄND
- **Förväntade värden:** rumor, planned, tender, awarded
- **Faktiska värden:**
  - planned: 26 signaler (72%)
  - tender: 7 signaler (19%)
  - awarded: 3 signaler (8%)
- **Validering:** Alla värden är i giltigt intervall

#### amount_sek (datakvalitet)
- **Status:** ✓ GODKÄND
- **Kontroll:** Fältet är integer eller null
- **Resultat:** 36/36 signaler är korrekta
- **Notering:** Alla belopp är null, vilket är korrekt då källorna inte publicerar konkreta belopp

#### organization_name (konsistens)
- **Status:** ✓ GODKÄND
- **Förväntad värde:** "Stockholms stad"
- **Faktisk värde:** "Stockholms stad" på alla 36 signaler
- **Validering:** 100% konsistens

### Datakällor (fördelning)

| Källa | Signaler | Maturity-fördelning | Status |
|-------|----------|-------------------|---------|
| Stockholmshem kommande upphandlingar | 23 | planned: 23 | ✓ Godkänd |
| Micasa Mynewsdesk pressrum | 5 | planned: 2, awarded: 3 | ✓ Godkänd |
| SISAB kommande upphandlingar | 8 | planned: 1, tender: 7 | ✓ Godkänd |

**Sammanfattning:** Alla tre källorna är korrekt mappade och uppfyller förväntningarna.

### Dublettkontroll
- **Status:** ✓ GODKÄND
- **Resultat:** Noll dubbletter identifierade
- **Metod:** Kontroll på kombinationen organization_name + title + source_date
- **Notering:** Ingen överlappning mellan de tre källorna

### Stickprov av extraherade signaler

#### Sample 1: Stockholmshem (planned)
- **Titel:** Måleri mm fönster – Akacian 1 (17430)
- **Maturity:** planned
- **Organization ID:** 32e2a288-5365-43a6-a03b-770ff5aba1a9
- **Amount SEK:** null
- **Source URL:** https://www.stockholmshem.se/om-oss/upphandling/kommande-upphandlingar/
- **Status:** ✓ Korrekt extraherad

#### Sample 2: SISAB (tender)
- **Titel:** Förvaltningsavtal utemiljö – tillsyn och skötsel
- **Maturity:** tender
- **Organization ID:** 32e2a288-5365-43a6-a03b-770ff5aba1a9
- **Amount SEK:** null
- **Source URL:** https://www.sisab.se/sv/leverantor/upphandlingar/Kommande-upphandlingar/
- **Status:** ✓ Korrekt extraherad

#### Sample 3: Micasa Mynewsdesk (awarded)
- **Titel:** Ombyggnation av Trossen 13 på Kungsholmen – upphandling klar
- **Maturity:** awarded
- **Organization ID:** 32e2a288-5365-43a6-a03b-770ff5aba1a9
- **Amount SEK:** null
- **Source URL:** https://www.mynewsdesk.com/se/micasa-fastigheter/pressreleases
- **Status:** ✓ Korrekt extraherad

## Validering mot källorna

### Stockholmshem
- **Förväntad maturity:** planned (kommande upphandlingar)
- **Faktisk maturity:** 23/23 = planned
- **Resultat:** ✓ Korrekt klassificering

### SISAB
- **Förväntad maturity:** tender + planned (kommande upphandlingar)
- **Faktisk maturity:** 7 tender, 1 planned
- **Resultat:** ✓ Korrekt klassificering

### Micasa Mynewsdesk pressrum
- **Förväntad maturity:** Mixed (planerade + genomförda)
- **Faktisk maturity:** 3 awarded, 2 planned
- **Resultat:** ✓ Korrekt klassificering

## Kontroller enligt QC-protokoll

### Obligatoriska fält
- organization_id: ✓ (36/36)
- organization_name: ✓ (36/36)
- title: ✓ (36/36)
- maturity: ✓ (36/36)
- source_url: ✓ (36/36)

### Datakvalitet
- Inga framtida datum: ✓
- Inga otroligt gamla datum: ✓
- Inga duplicerade records: ✓
- amount_sek är integer eller null: ✓ (36/36)

## Rekommendation

**GODKÄND**

Samtliga 36 signaler från Stockholms stad uppfyller alla kvalitetskrav. Data är redo för publicering och kan användas i CI-produkten utan reservationer.

### Nästa steg
- Data kan användas omedelbar
- Ingen konfigurativ uppdatering krävs
- Reguljär monitoring rekommenderas för att följa framtida extraktioner från källorna

---

*QC-verifiering genomförd: 2026-04-01*
*Verifikatör: Claude Code (QC-agent)*
