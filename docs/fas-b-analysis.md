PUNKT 2 — NOLL-KOMMUNER
========================

Tre kommuner har 0 ärenden i permits_v2 (inte fem som antagits):

Linköping: 0 ärenden — CONFIG-BUGG: AngularJS SPA
  URL: https://ciceron-anslagstavlan.linkoping.se/#!/billboard/
  Sidan kräver JavaScript (AngularJS) för att rendera innehåll.
  Playwright borde kunna rendera JS, men hashbang-URL (#!/) plus
  lazy-loaded API-anrop (ciceron API per item) gör att fetchPage()
  bara får en tom shell. Haiku ser ingen data → 0 permits.
  FIX: Behöver custom scraping — anropa Ciceron API direkt istället
  för att scrapa HTML. Alternativt: vänta på att AngularJS renderat,
  sedan scrapa DOM efter att data laddats.

Tibro: 0 ärenden — TROLIGEN KORREKT NOLLA (med reservation)
  URL: https://tibro.se/kommun-och-politik/sa-styrs-tibro-kommun/anslagstavla2/
  Befolkning: ~11 000. Config confidence: "low".
  Huvudsidan är en översikt utan listade ärenden — man måste klicka
  vidare till undersidor. link_selector_hint (a[href*='anslagstavla'])
  matchar troligen navigeringslänkar, inte ärendelänkar.
  Sidan har sektioner för "Bygglov och detaljplaner" men WebFetch
  visar 0 items direkt på sidan.
  BEDÖMNING: Liten kommun, kan vara korrekt att inget är anslaget
  just nu. Men config behöver verifieras manuellt — low confidence.

Gotland: 0 ärenden — CONFIG-BUGG: Subpage-länkar filtreras bort
  URL: https://gotland.se/region-och-politik/diarium-allmanna-handlingar-och-arkiv/anslagstavla
  Befolkning: ~60 000. Borde definitivt ha ärenden.
  WebFetch visar 26 aktiva poster: 5 underrättelser + 8 beslut = 13 bygglov.
  Sidan laddas som statisk HTML — inga JS-beroenden.
  ROTORSAK: daily-run.js rad 106-108 filtrerar subpage-länkar med
  `.filter((href) => href && href.startsWith("http"))`.
  Gotlands länkar är relativa (t.ex. /region-och-politik/.../anslagstavla/...).
  Relativa URL:er filtreras bort → 0 subpages besöks → 0 permits.
  FIX: Ändra filter till att inkludera relativa URL:er, eller
  konvertera till absoluta med `new URL(href, page.url()).href`.

Övriga kommuner i permits_v2 (ej noll):
  Höör:        1 ärende   (~17k inv, liten kommun — rimligt)
  Uppsala:     3 ärenden  (~230k inv — lågt, men anslagstavla visar bara aktuella)
  Norrköping:  3 ärenden  (~140k inv — lågt, legacy har 153)
  Örebro:      3 ärenden  (~155k inv — lågt)
  Malmö:       4 ärenden  (~350k inv — lågt men Netpublicator visar begränsat)
  Kiruna:      4 ärenden  (~23k inv — rimligt, AngularJS fixad dag 3)
  Helsingborg: 5 ärenden  (~150k inv — lågt)
  Nacka:       6 ärenden  (~105k inv — lågt)
  Trosa:       8 ärenden  (~13k inv — bra)
  Mölndal:     9 ärenden  (~65k inv — ok)
  Sundsvall:  10 ärenden  (~100k inv — ok)
  Jönköping:  11 ärenden  (~140k inv — ok)
  Umeå:       12 ärenden  (~130k inv — ok)
  Halmstad:   14 ärenden  (~105k inv — ok)
  Karlstad:   35 ärenden  (~95k inv — bra)
  Västerås:   43 ärenden  (~155k inv — bra)
  Lund:       71 ärenden  (~125k inv — bra)


PUNKT 3 — STATUS-BREAKDOWN
============================

Status-fördelning (permits_v2, 242 rader totalt):
  beviljat:   161 (66.5%)
  ansokt:      74 (30.6%)
  null:         7  (2.9%)

Ansökningar FINNS — 30.6% av alla ärenden har status "ansokt".
Ingen manuell kontroll av anslagstavlor behövs.

Permit-type-fördelning:
  bygglov:          206
  null:              23
  rivningslov:        8
  marklov:            4
  forhandsbesked:     1
  strandskyddsdispens: 0
  anmalan:            0

NOTERING: 23 ärenden saknar permit_type (null). Dessa bör undersökas —
troligen ärenden där Haiku inte kunde identifiera typ.
Saknar strandskyddsdispens och anmälan helt — kan vara korrekt
(inte alla kommuners anslagstavlor visar dessa typer).


PUNKT 4 — QC-AGENT
====================

Senaste körning: 2026-03-16T21:48:20 (lokal körning)
Railway-deploy: INTE AKTIV ÄN — railway.toml pushad men ingen deploy gjord.
QC har körts 3 gånger lokalt (2026-03-16), ej dagligt via cron.

Senaste QC-rapport (qc_report_2026-03-16_1773697700396.json):
  Permits extraherade: 237
  Kommuner:            22
  Flaggade permits:    4 (alla future dates i Lund)
  Stale sources:       0
  Anomalier:           0
  Extraction-kostnad:  $0.6028
  Kostnad/permit:      $0.0028

Fångar Norrköping-gap: NEJ
  Norrköping: 3 permits i DB. Legacy-systemet har 153.
  QC rapporterar 0 anomalier — baseline är null för alla kommuner
  (för få körningar för att beräkna snitt).
  Även med baseline: QC jämför mot agentens egna historiska data,
  inte mot legacy. Den har ingen referens för att veta att
  Norrköping BORDE ha ~153 ärenden.

FÖRBÄTTRINGSFÖRSLAG FÖR QC:

1. Populationsbaserad förväntning:
   Kommun > 50k inv → borde ha > 5 ärenden/månad
   Kommun > 100k inv → borde ha > 10 ärenden/månad
   Kommun > 200k inv → borde ha > 20 ärenden/månad
   Flagga kommuner som ligger under 50% av förväntat.

2. Cross-referens mot legacy:
   Lägg till en legacy_baseline-tabell med kända volymer per kommun.
   QC jämför agentens output mot legacy-volymer.

3. Noll-detektion:
   Flagga omedelbart om en kommun > 30k inv returnerar 0 permits
   (fångar Linköping + Gotland direkt).

EXTRA: QC-BUG — FILNAMN STRIPPAR SVENSKA TECKEN
  Municipality-ID i QC använder filnamn som strippar ÅÄÖ:
  "Jönköping" → "jnkping", "Norrköping" → "norrkping", "Malmö" → "malm"
  Detta skapar dubbla rader: "malm" (4 permits) och "malmo" (17 permits).
  FIX: Använd .replace(/[åä]/g,'a').replace(/ö/g,'o').replace(/é/g,'e')
  istället för .replace(/[^a-z]/g, "").
