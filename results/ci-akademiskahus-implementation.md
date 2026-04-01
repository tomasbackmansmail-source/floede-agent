## Akademiska Hus -- Implementation

**Datum:** 2026-04-01
**Vertikal:** CI (ci-pressroom)
**Kalla:** Mynewsdesk pressmeddelanden

---

### Sammanfattning

Akademiska Hus har lagts till som kalla i CI med Mynewsdesk-pressmeddelanden som datakalla. 8 signaler extraherades och infogades i ci_signals.

### Steg genomforda

**1. Kalla tillagd i ci_sources**
- ID: `b5977647-e834-4e3f-8d62-b02e4e5a6477`
- URL: https://www.mynewsdesk.com/se/akademiska_hus_ab/pressreleases
- organization_id: `02af1165-925d-4511-960c-488ddcef9cc2` (redan existerande i ci_organizations)
- config: `{"listing_url": "https://www.mynewsdesk.com/se/akademiska_hus_ab/pressreleases", "needs_browser": false}`
- approved: true, needs_browser: false

En aldre kalla (id `36be10f7-...`, URL utan /pressreleases, needs_browser: true) inaktiverades (approved: false) for att undvika dubbletter.

**2. Extraction kord**
- Kommando: `VERTICAL=ci-pressroom node src/daily-run.js --source="Akademiska Hus"`
- Resultat: 8 signaler extraherade via HTTP fetch (ingen browser behovs)
- Modell: claude-sonnet-4-6
- Kostnad: $0.0315

**3. DB-insert**
Automatisk insert via daily-run misslyckades med: `there is no unique or exclusion constraint matching the ON CONFLICT specification`

Orsak: ci_signals-tabellen saknar unique constraint pa `(organization_id, source_url, title)` som ci-pressroom.json anger som conflict_key. Befintliga CI-kallor anvander browser-mode med subpages dar source_url forblir null, vilket gor att de tar dedup-vagen (inte upsert). HTTP-only kallor utan subpages far listing-URL som source_url och tar upsert-vagen, som kraschar.

Workaround: Records infogades manuellt via Supabase REST API med source_url=null (matchande befintligt monster).

**OBS: Denna bugg paverkar alla HTTP-only CI-kallor.** For att fixa permanent behovs antingen:
- En unique constraint pa ci_signals: `CREATE UNIQUE INDEX ON ci_signals (organization_id, source_url, title)` -- men notera att source_url ar null for nastan alla records
- Eller: andring i daily-run.js sa att CI-kallor utan subpages anvander dedup-vagen istallet for upsert

**4. Verifiering**
11 records totalt for Akademiska Hus i ci_signals (3 fran aldre kalla + 8 nya).

### Extraherade signaler

| Titel | Maturity | Belopp (SEK) | Datum |
|-------|----------|-------------|-------|
| Aterbruk av betongstomme vid campus Albano -- Teknikhojden | planned | - | 2026-03-30 |
| Framtidens campus Lulea -- tre nya byggnader vid LTU | planned | - | 2026-03-11 |
| Ny byggnad for Handelshogskolan vid Goteborgs universitet | planned | - | 2026-02-11 |
| Investeringar om- till- och nybyggnationer 2025 | planned | 3 000 000 000 | 2026-02-06 |
| Totalrenovering av Zoologen pa Medicinareberget, Goteborg | planned | 245 000 000 | 2025-12-11 |
| Nya studentbostader vid Gibraltarvallen, Campus Johanneberg | planned | 500 000 000 | 2025-09-18 |
| Omvandling av undervisningsbyggnad till studentbostader i Frescati | awarded | - | 2025-09-23 |
| Solcellsinstallation pa Arrheniuslaboratoriet, Stockholms universitet | awarded | - | 2025-10-01 |

### Datakvalitet

- **organization_name**: Korrekt ("Akademiska Hus") pa alla records
- **title**: Bra, korta, beskrivande (alla under 80 tecken)
- **maturity**: 6 planned, 2 awarded -- rimligt givet kallmaterialet
- **amount_sek**: 3 av 8 har belopp (3 mdr, 500 mkr, 245 mkr) -- korrekt extraherade fran pressmeddelanden
- **timeline**: 5 av 8 har tidsram -- bra
- **description**: 1-2 meningar, relevanta
- **source_date**: Alla har datum, rimliga
- **source_url**: Satt till null (se DB-insert-problem ovan)
- **organization_id**: Korrekt lankat till ci_organizations

### Nara-dubbletter med aldre data

3 records fran den aldre kallan overlappar delvis:
- "Investeringar om- till- och nybyggnation 2025" vs "Investeringar om- till- och nybyggnationer 2025"
- "Ny byggnad for Handelshogskolan i Goteborg" / "Ny byggnad Handelshogskolan Goteborg -- stommen klar" vs "Ny byggnad for Handelshogskolan vid Goteborgs universitet"

Dessa ar inte exakta dubbletter (titlarna skiljer sig) men refererar till samma projekt. Dedup-logiken fangar inte dessa. Acceptabelt for nu.

### Kostnad

- LLM extraction: $0.0315 (Sonnet, en kall-korning)
- Supabase API: $0 (inom free tier)
- Uppskattad lopande kostnad per daglig korning: ~$0.03

### Kanda problem

1. **ON CONFLICT bugg**: daily-run.js upsert misslyckas for HTTP-only CI-kallor (saknad unique constraint). Behovs fixas i databasen eller koden for att framtida dagliga korningar ska fungera automatiskt.
2. **Nara-dubbletter**: Dedup baserat pa exakt titel fangar inte semantiska dubbletter.
3. **Gammal kalla**: Den inaktiverade kallan (id `36be10f7-...`) kan tas bort helt om den inte behovs.
