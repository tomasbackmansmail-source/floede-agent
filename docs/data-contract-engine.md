# Floede Engine — Datakontrakt Lager 1: Motorgarantier

> Detta dokument definierar vad motorn (floede-agent) tekniskt garanterar
> oavsett vertikal. Det är invarianter som gäller alltid, för alla källor,
> för alla poster motorn extraherar och sparar.
>
> Tröskelvärden, NULL-procent och produktkvalitet per vertikal hör inte
> hemma här — de finns i Lager 2-dokument per vertikal.
>
> **Ägare:** CTO Engine
> **Version:** 0.1.0 (godkänd av CEO 2026-04-25)
> **Senast uppdaterad:** 2026-04-25

---

## 1. Grundprinciper

### 1.1 Motorn äger struktur, vertikalen äger semantik

Motorn ansvarar för att:
- Hämta HTML/PDF från konfigurerade källor
- Skicka innehåll till LLM med vertikalens extraction_prompt
- Validera resultatet mot vertikalens schema-definition
- Spara godkända poster till vertikalens tabell

Motorn ansvarar inte för att:
- Tolka domän-specifik betydelse ("är detta bygglov eller marklov?")
- Definiera affärslogik utöver schemavalidering
- Sätta produktkvalitetströsklar (det är Lager 2)

### 1.2 Ren data > mer data, inom motorns kontrollsfär

Motorn droppar inte poster för att källan saknar information. Om en
sida säger "Nybyggnad" utan att specificera typ → fältet sätts till
null, posten sparas. Att tappa data motorn faktiskt fångat är värre
än att ha null på ett semantiskt fält.

Motorn droppar däremot poster som bryter tekniska invarianter (sektion 2)
— det är poster motorn inte kunnat producera korrekt.

### 1.3 Motorn reflekterar källans faktiska rytm

Verkligheten är att källor publicerar olika ofta. Stockholm dagligen,
Pajala månadsvis. Olika kommuner publicerar olika fält. Innehåll
ändrar sig (systembyten, lagändringar).

Motorn försöker inte "lösa" detta tekniskt. Den reflekterar verkligheten.
Stale-tröskelvärden konfigureras per källa, inte globalt. En källa som
ger 0 poster en dag är inte nödvändigtvis trasig — det måste utvärderas
mot källans normalrytm.

### 1.4 Brytpunktsdatum framför backfill

När motorn inför nya invarianter (nya obligatoriska fält, nya format)
sätts ett explicit "från och med"-datum. Befintliga poster märks
`legacy` och migreras inte. Det är ärligare än backfill som producerar
data som ser modern ut men inte har samma audit-trail.

Detta mönster gäller alla framtida kontraktändringar.

---

## 2. Tekniska invarianter

Motorn garanterar att varje post som sparas till vertikalens tabell
uppfyller följande:

### 2.1 Obligatoriska tekniska fält

Dessa är *fysiskt nödvändiga* för att posten ska vara identifierbar och
spårbar. Om något saknas → posten droppas, inte sparas.

a. **Vertikalens identifierande nyckelfält** (definieras per vertikal i
   `qc.validation.identifying_fields` — typiskt `municipality` eller
   `organization_name`).

b. **`source_url`** — länk tillbaka till exakt den (sub)sida posten
   extraherades från. Aldrig listsidan när posten kommer från subpage.

c. **`raw_html_hash`** är obligatoriskt för poster skapade från och
   med 2026-04-22. Poster med `created_at < 2026-04-22` är legacy
   och garanterar inte fältet. Detta mönster — explicit
   brytpunktsdatum för nya invarianter — gäller framåt vid framtida
   kontraktändringar.

### 2.2 Schemavalidering vid insert

Innan insert kör motorn `validateRecord()` per post:

a. **Enum-fält** — om värdet inte finns i `qc.validation.allowed_values`
   sätts fältet till null. Posten sparas ändå om enum-fältet inte är
   tekniskt obligatoriskt.

b. **Numeriska fält** — värden utanför `qc.validation.numeric_ranges`
   sätts till null. Samma regel som enum.

c. **GDPR-filter** — vertikal-specifika regler. ByggSignal: `applicant`
   får BARA innehålla organisationer (AB, BRF, kommun, region, stiftelse,
   förening osv). Privatperson → null. CI: inga privatpersoners namn
   någonstans.

### 2.3 Hash- och innehållsregler

a. **Aldrig hasha innehåll under tröskel.** Innehåll < 500 bytes efter
   `stripNonContent` hashas inte. Returneras som `content_too_small`-fel.

b. **Aldrig respektera hash om `config.verified !== true`.** Daily-run
   skippar hash-check för overifierade configs och kör alltid extraktion.

c. **Per-record hash från subpage.** `raw_html_hash` sätts från subpagen
   posten extraherades från, inte aggregat per källa.

### 2.4 Källverifiering före godkännande

Discovery skapar inte godkända configs utan att `verifyExtraction` har
lyckats med >0 resultat. En config med `verified = false` får inte
markeras `approved = true` automatiskt.

### 2.5 Run-nivå loggning

Varje daily-run loggar:
- Antal hash-skippade källor
- Antal extraherade poster per källa
- Antal droppade poster + anledningar
- Total kostnad
- Cron-tidsstämpel i UTC

---

## 3. Vad motorn INTE garanterar

### 3.1 Inte 100% täckning

Vissa källor publicerar månadsvis. Vissa veckor blir tomma. En källa
som ger 0 poster en dag är inte nödvändigtvis trasig.

### 3.2 Inte fält som inte finns på källans sida

Om en kommunal anslagstavla inte publicerar fastighetsbeteckning →
`property` blir null. Det är inte en motor-bug. Det är ett källproblem
som löses i Lager 2 (acceptera null för den kommunen, eller byt källa).

### 3.3 Inte tolkningar

Motorn extraherar vad som står på sidan. Gissar aldrig. Om typ inte
specificeras → null.

### 3.4 Inte privatpersoner

Om en datapunkt skulle kräva att en privatpersons namn sparas → fältet
sätts till null. Vertikalen hanterar UI för sådana poster.

---

## 4. Källkvalitetsmätning (data, inte regler)

Motorn skriver per (vertikal, source, datum) till tabellen
`source_quality_daily`:

- Antal extraherade poster
- NULL-procent per fält
- Antal droppade poster + droppanledningar
- Senaste kända publiceringsfrekvens (rolling 30d median)

Tabellen är råmaterial. **Motorn larmar inte själv på tröskelvärden** —
det är Lager 2:s ansvar att definiera vad som är acceptabelt och vilka
larm som ska skickas till vem.

Motorn larmar bara på sina egna tekniska invarianter:
- 0 poster totalt på en run → zero-records-mail
- Aktiv-zero-larm enligt vertikalens `qc.active_zero_threshold` (mån-fre)
- 1 dag noll efter måndag-fredag → flagga om vertikalen säger så

---

## 5. Versionering och brytpunkter

### 5.1 Aktuella brytpunkter

| Datum | Invariant infördes | Kommentar |
|-------|-------------------|-----------|
| 2026-04-22 | `raw_html_hash` per-record | Tidigare aggregat-hash per källa |
| 2026-04-22 | `subpage_hashes` ersätter `content_hash` | Migration utan backfill |
| 2026-04-25 | 500-byte-tröskel före hashing | Bug-fix efter hash-incident |
| 2026-04-25 | Hash respekteras bara om `verified === true` | Bug-fix efter hash-incident |

### 5.2 Framtida ändringar

Nya invarianter införs alltid med explicit datum. Inget backfill av
historisk data. Lager 1-ändringar kräver:

1. PR till `docs/data-contract-engine.md`
2. Godkänd av CEO
3. Versionsbump (semantic): MAJOR vid breaking change, MINOR vid
   utökning, PATCH vid förtydligande.

---

## 6. Beslut och pågående arbete

### 6.1 Implementation av source_quality_daily

Tabellen byggs efter att Lager 2 ByggSignal är godkänd. Schemat kan inte
designas innan Lager 2 definierar exakt vad som mäts och larmas.

### 6.2 Källproblem vs motorbug — diagnostik

När Lager 2 flaggar en källa som `degraded`: CTO Engine eller CEO öppnar
sidan manuellt (5 minuter) och avgör om det är källa eller motor.
Resultat dokumenteras i `docs/source-diagnostics.md` per kommun så vi
inte granskar samma kommun flera gånger.

### 6.3 Brytpunktsmarkering

Ingen explicit `legacy`-flagga i schemat. Datum i kontraktet räcker.
Frågan "är denna post legacy?" besvaras alltid med
`created_at < '2026-04-22'` (eller motsvarande för framtida brytpunkter).
