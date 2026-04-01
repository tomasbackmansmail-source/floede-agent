# QC-rapport: Vasakronan CI-signaler

**Vertikal:** Client Intelligence (CI)  
**Datum:** 2026-04-01  
**Antal records testade:** 12  
**Antal godkända:** 9  
**Antal underkända:** 3  

---

## Sammanfattning

Manuell verifiering av 12 Vasakronan-signaler från CI-databasen. Totalt 10 unika signaler efter deduplication; 2 signaler är direkta duplikat från tidigare extraktion.

**KRITISK KONTROLL:** Alla nya signaler (de 9 från 2026-04-01) har `organization_id` satt korrekt. Inget null-värde på denna kritiska kolumn.

---

## Detaljerade resultat

### 1. organization_id-validering

**Status:** ✓ GODKÄND

Alla 12 signaler har `organization_id = 8be2978d-e84e-481f-8baa-d51b88aa3c40` korrekt satt.

---

### 2. source_url-validering

**Status:** ✗ 3 UNDERKÄNDA

Tre signaler från 2026-03-30 saknar `source_url`:

- **Record a8e7964d-ca21-4e71-b9fa-7d1aaa425fc2**  
  Titel: Försäljning av bostadsbyggrätter i Södra city Uppsala till JM  
  Orsak: source_url är NULL. Detta är en duplikat från 2026-04-01 (ID: 9053a864-0105-43c0-86b4-8044d58a5b17) som HAR source_url.

- **Record 73a2f0b7-9e81-425b-8f93-2075ee8df834**  
  Titel: Nybyggnation av Hjärta – hotell och kontor i Uppsala Södra city  
  Orsak: source_url är NULL. Duplikat från 2026-04-01 (ID: c2e1630d-7ca8-48ad-80c8-952c12472831) som HAR source_url.

- **Record 73f09a64-3c70-47ce-b22e-5ce7c01d1ede**  
  Titel: Förvärv av fastigheten Tygeln 2 (Solna United) i Arenastaden  
  Orsak: source_url är NULL. Duplikat från 2026-04-01 (ID: 5e5443cb-4788-4e6e-9c13-f3c40deda65d) som HAR source_url.

---

### 3. maturity-validering

**Status:** ✓ GODKÄND

Alla 12 signaler har `maturity = planned`. Detta är ett giltigt värde enligt spec (rumor/planned/tender/awarded).

---

### 4. amount_sek-validering

**Status:** ✓ GODKÄND

Alla amount_sek-värden är antingen integer eller null. Testade värden:

- 925,000,000 SEK (Hjärta-projektet, flera signaler)
- 307,000,000 SEK (Nordstaden avyttring)
- 193,000,000 SEK (Kvarngärdet avyttring)
- 1,000,000,000 SEK (NIB-lån Kaj 16)
- 475,000,000 SEK (JM byggrätter)
- null (AFRY-hyresavtal, Tygeln 2 förvärv)

Alla är korrekt formaterade som integers, ingen text.

---

### 5. Source-verifiering (stickprov)

**Status:** ✓ GODKÄND (med notering)

Verifierade 3 signaler mot källor:

**Kvarngärdet avyttring (193M):**
- amount_sek 193 miljoner SEK bekräftad i källa (vasakronan.se REST API)
- ✓ Belopp matchar källan

**Nordstaden avyttring (307M):**
- amount_sek 307 miljoner SEK bekräftad i källa (vasakronan.se REST API)
- ✓ Belopp matchar källan

**Hjärta-projektet (925M från Cision):**
- Källan https://news.cision.com/se/vasakronan är ett RSS/feed-aggregat
- Belopp verifieras genom API-källorna istället
- ✓ Konsistent extrahering över både Cision och Vasakronans REST API

---

### 6. Datum-validering

**Status:** ✓ GODKÄND

Alla source_date-värden är rimliga:
- Senaste: 2026-02-18 (Nordstaden)
- Äldsta: 2025-05-23 (JM byggrätter)
- Alla är inom sista året och inte framtida

---

### 7. Duplikat-analys

**Status:** ⚠ 2 DUPLIKATPAR IDENTIFIERADE

Två unika signaler är extrahererade två gånger (gamla från 2026-03-30, nya från 2026-04-01):

**Duplikat 1: Försäljning av bostadsbyggrätter i Södra city Uppsala till JM**
- ✓ Nyare version (9053a864-0105-43c0-86b4-8044d58a5b17, 2026-04-01) har source_url
- ✗ Äldre version (a8e7964d-ca21-4e71-b9fa-7d1aaa425fc2, 2026-03-30) saknar source_url
- **Rekommendation:** Behålla ny, radera gammal

**Duplikat 2: Förvärv av fastigheten Tygeln 2 (Solna United) i Arenastaden**
- ✓ Nyare version (5e5443cb-4788-4e6e-9c13-f3c40deda65d, 2026-04-01) har source_url
- ✗ Äldre version (73f09a64-3c70-47ce-b22e-5ce7c01d1ede, 2026-03-30) saknar source_url
- **Rekommendation:** Behålla ny, radera gammal

**Duplikat 3 (TRIPPEL): Nybyggnation av Hjärta-projektet**
- Tre mycket likartade signaler med samma belopp (925M):
  - c2e1630d-7ca8-48ad-80c8-952c12472831 (2026-04-01): "Projektstart Hjärta, hotell och kontor"
  - 1fd1a86e-1c2d-41fb-9c66-ac23b2ec48bf (2026-04-01): "Byggstart projektfastigheten Hjärta"
  - 9fbf9c75-b575-4991-a082-255b79d891e6 (2026-04-01): "Projektstart fastigheten Hjärta"
  - 73a2f0b7-9e81-425b-8f93-2075ee8df834 (2026-03-30): "Nybyggnation av Hjärta" (NULL source_url)
- **Orsak:** Samma pressmeddelande tolkad olika av LLM under extraktion
- **Rekommendation:** Deduplica till EN signal (sätt conflict_key på (organization_id, source_date, amount_sek))

---

## Förväntat antal signaler

Kontext säger: 4 nya signaler + 3 äldre = 7 totalt.

**Faktiskt:** 12 signaler (10 unika efter titel-dedup).

**Förklaring:** 
- 4 nya från REST API Vasakronan (2026-04-01): ✓ matchar
- Ytterligare 5 nya från Cision + REST API (2026-04-01): ✗ FLER än förväntad
- 3 äldre från tidigare run (2026-03-30): ✓ matchar

**Hypotes:** Cision-källan och REST API-källan samlar samma pressmeddelanden med olika lagring/dedupliceringsstrategi. Daily-run bör ha en conflict_key som deduplicerar på (organization_id, source_date, title_tokens, amount_sek).

---

## Sammanfattande kvalitetsöversikt

| Kriterium | Status | Notering |
|-----------|--------|----------|
| organization_id != null (nyA signaler) | ✓ | Alla 9 nya signaler OK |
| source_url != null | ✗ | 3 gamla duplikat saknar source_url |
| maturity-värden giltiga | ✓ | Alla är "planned" |
| amount_sek som integer eller null | ✓ | Alla korrekt formaterade |
| Beloppsetikett matchar källa | ✓ | 3/3 verifierade matchar |
| Datum rimligt | ✓ | Alla inom [1 år tillbaka, idag] |
| Duplikathantering | ⚠ | 2 uppenbar duplikat, 1 trippel från samma PR |

---

## Rekommendation

**GODKÄND MED RESERVATIONER**

**Nya signaler (9 från 2026-04-01):**
- ✓ Alla obligatoriska fält ifyllda (organization_id, source_url)
- ✓ Rätt belopp och maturity
- ⚠ Risk för duplikatsamling från två källor (Cision + REST API)

**Åtgärder:**
1. Ta bort tre gamla duplikat (IDs: a8e7964d-ca21-4e71-b9fa-7d1aaa425fc2, 73a2f0b7-9e81-425b-8f93-2075ee8df834, 73f09a64-3c70-47ce-b22e-5ce7c01d1ede)
2. Deduplica Hjärta-trippel genom att använda conflict_key = (organization_id, source_date, amount_sek) — behål EN signal, radera två närliggande
3. Verifiera REST API-config använder rätt API-endpoint för att undvika framtida duplikat

**Nästa steg:** Uppdatera ci-pressroom.json config med explicit dedup_fields eller conflict_key för Vasakronan-källan.

---

*QC-verifiering slutförd: 2026-04-01*
