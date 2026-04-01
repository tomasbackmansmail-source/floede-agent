### QC-rapport: Akademiska Hus

**Vertikal:** ci
**Datum:** 2026-04-01
**Antal records testade:** 11
**Antal godkanda:** 9
**Antal underkanda:** 2

**Underkanda records:**

- Record [2832794f-9b3d-4646-9fdf-75a00114f88d]: Nara-dubblett av record [64ad0314-1a9c-4182-89d4-e7dafc8414c6]. Samma organization_name + source_date (2026-02-02), titlarna refererar till samma projekt ("Ny byggnad for Handelshogskolan i Goteborg" vs "Ny byggnad Handelshogskolan Goteborg -- stommen klar"). Dessutom har de olika maturity (planned vs awarded) for samma projekt vid samma datum, vilket ar inkonsekvent. Orsak: Tva olika kallor (gammal + ny) extraherade samma projekt med olika titlar och maturity-klassificering. Dedup-logiken fangar inte detta da titlarna skiljer sig.

- Record [2d02191f-931d-43fa-b293-06294e17a58b]: Nara-dubblett av record [5dfd45d2-c67c-4c06-924b-70840a1440bc]. Samma organization_name + source_date (2026-02-06), titlarna skiljer sig minimalt ("Investeringar om- till- och nybyggnation 2025" vs "Investeringar om- till- och nybyggnationer 2025" -- singular vs plural). Samma amount_sek (3000000000). Orsak: Tva olika kallor extraherade samma pressmeddelande med marginellt olika titlar. Dedup-logiken fangar inte detta.

**Alla records -- detaljvalidering:**

| # | ID (kort) | organization_name | maturity | amount_sek | source_url | source_date | organization_id | Status |
|---|-----------|-------------------|----------|------------|------------|-------------|-----------------|--------|
| 1 | 2d02191f | Akademiska Hus | planned | 3000000000 | null | 2026-02-06 | 02af1165... | NARA-DUBBLETT |
| 2 | 64ad0314 | Akademiska Hus | awarded | 529000000 | null | 2026-02-02 | 02af1165... | OK |
| 3 | 2832794f | Akademiska Hus | planned | 529000000 | null | 2026-02-02 | 02af1165... | NARA-DUBBLETT |
| 4 | 69322817 | Akademiska Hus | planned | null | null | 2026-03-30 | 02af1165... | OK |
| 5 | 9cd7b0b5 | Akademiska Hus | planned | null | null | 2026-03-11 | 02af1165... | OK |
| 6 | d13c219c | Akademiska Hus | planned | null | null | 2026-02-11 | 02af1165... | OK |
| 7 | 5dfd45d2 | Akademiska Hus | planned | 3000000000 | null | 2026-02-06 | 02af1165... | OK |
| 8 | a3a53f0c | Akademiska Hus | planned | 245000000 | null | 2025-12-11 | 02af1165... | OK |
| 9 | 07b0b616 | Akademiska Hus | planned | 500000000 | null | 2025-09-18 | 02af1165... | OK |
| 10 | 819c7e0b | Akademiska Hus | awarded | null | null | 2025-09-23 | 02af1165... | OK |
| 11 | 2d5dff80 | Akademiska Hus | awarded | null | null | 2025-10-01 | 02af1165... | OK |

**Faltvalidering (alla 11 records):**
- organization_name: GODKAND -- alla ar "Akademiska Hus"
- maturity: GODKAND -- alla ar planned (8 st) eller awarded (3 st), samtliga giltiga varden
- amount_sek: GODKAND -- integer (5 st) eller null (6 st), inga textvarden
- source_url: null pa alla 11 records (kant problem, se nedan)
- source_date: GODKAND -- alla har datum i YYYY-MM-DD-format, inga framtida datum
- organization_id: GODKAND -- alla har 02af1165-925d-4511-960c-488ddcef9cc2, matchar ci_organizations
- Exakta dubbletter (organization_name + title + source_date): INGA FUNNA

**Nara-dubbletter (semantiskt samma projekt, olika titlar):**
1. Handelshogskolan Goteborg: 3 records (64ad0314, 2832794f, d13c219c) -- alla refererar till samma byggprojekt fran olika pressmeddelanden/kallor
2. Investeringar 2025: 2 records (2d02191f, 5dfd45d2) -- samma pressmeddelande, marginellt olika titel

**Kanda problem:**
- ON CONFLICT bugg (dokumenterad i implementation) -- daily-run upsert kraschar for HTTP-only CI-kallor
- source_url = null (alla 11 records) -- workaround for ON CONFLICT-buggen, records insatta manuellt utan source_url
- QC-scriptet (qc.js) stodjer inte CI-vertikalen korrekt: anvander ByggSignal-schema (municipality-baserat) aven nar det kors mot CI-databasen. Ingen CI-specifik validering (maturity, amount_sek) exekveras
- qc_runs-tabellen saknas i CI:s Supabase-projekt

**Rekommendation:** godkand (med anmarkningar)

Data ar i huvudsak korrekt och anvandbar. De 2 nara-dubbletterna paverkar datakvaliteten marginellt men ar inte kritiska. For att forbattra:
1. Rensa nara-dubbletter manuellt (ta bort record 2d02191f och 2832794f)
2. Fixa ON CONFLICT-buggen sa dagliga korningar fungerar automatiskt
3. Bygg CI-specifik QC-validering i qc.js
