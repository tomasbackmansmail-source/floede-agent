# Stockholms stad (kommunal koncern) — Kallanalys

**Datum:** 2026-04-01
**Vertikal:** ci-pressroom (Client Intelligence)
**Uppgift:** Hitta publika datakallor for projektsignaler for Stockholms stad
och sex kommunala fastighetsbolag. Alla kopplas till organization_name = 'Stockholms stad'.

---

## RANG 1 — Statisk HTML, direkt extraherbar

### Kandidat 1: Stockholmshem — Kommande upphandlingar
- **URL:** https://www.stockholmshem.se/om-oss/upphandling/kommande-upphandlingar/
- **Datatyp:** Planerade bygg- och renoveringsupphandlingar (13 ombyggnation + 7 nybyggnation)
- **Datapunkter:** projektnummer, beskrivning, adress, planerat kvartal for annonsering
- **Format:** Statisk HTML-lista, uppdateras var tredje manad
- **Extraherbarhet:** 1
- **Kommentar:** Direkta tender-signaler. Belopp saknas men projektnamn+adress racker.

### Kandidat 2: Micasa Fastigheter — Mynewsdesk pressrum
- **URL:** https://www.mynewsdesk.com/se/micasa-fastigheter/pressreleases
- **Datatyp:** Pressmeddelanden — nyproduktion, upphandlingsresultat, projekteringsstart
- **Datapunkter:** titel, datum, URL, brodtext (belopp, tidplan, adress, entreprenornamn)
- **Format:** Statisk HTML med JSON-LD. Bekraftad fungerande.
- **Extraherbarhet:** 1
- **Kommentar:** Hog precision — nastan allt ar byggprojektsignaler. Ca 4-8 pm/ar.
  Exempel: "Byggstart kvarteret Ann i Arsta", "Upphandlingen klar — projektering av Trossen 13".
  OBS: Micasas egen /pressrum ar JS-renderad — anvand mynewsdesk.com direkt.

### Kandidat 3: SISAB — Nyhetsarkiv
- **URL:** https://www.sisab.se/sv/om-sisab/nyheter/
- **Datatyp:** Nyheter — invigningar, energiprojekt, skolbyggnationer, renoveringar
- **Datapunkter:** titel, datum, URL, brodtext
- **Format:** Statisk HTML. Bekraftad.
- **Extraherbarhet:** 1
- **Kommentar:** Mattlig volym med hog relevans. Ca 1-2 nyheter/manad.

### Kandidat 4: SISAB — Kommande upphandlingar
- **URL:** https://www.sisab.se/sv/leverantor/upphandlingar/Kommande-upphandlingar/
- **Datatyp:** Kommande upphandlingar — byggnadsprojekt, ramavtal, ROT-arbeten
- **Datapunkter:** upphandlingstitel, kategori, preliminart annonseringskvartal
- **Format:** Statisk HTML. Bekraftad — 10 upphandlingar synliga.
- **Extraherbarhet:** 1
- **Kommentar:** Direkta tender-signaler. Exempel: "Lillholmsskolan Ombyggnad hus A Q2 2026".

### Kandidat 5: Stockholmshem — Nyproduktionsprojekt
- **URL:** https://www.stockholmshem.se/vi-bygger/vi-bygger-nytt/
- **Datatyp:** Pagaende och planerade nyproduktionsprojekt
- **Datapunkter:** projektnamn, stadsdel, antal lagenheter
- **Format:** Statisk HTML
- **Extraherbarhet:** 1
- **Kommentar:** planned/awarded-signaler med konkreta siffror (166 lgh Bromma, 99 lgh Solberga).

---

## RANG 2 — Statisk HTML med paginering eller SSL-verifiering

### Kandidat 6: Stockholmshem — Nyhetsarkiv
- **URL:** https://www.stockholmshem.se/om-oss/nyhetsarkiv/
- **Extraherbarhet:** 2 (paginering via ?p=N)
- **Kommentar:** Kompletterar upphandlingslistan med pressmeddelanden om beslutade projekt.

### Kandidat 7: SISAB — Byggprojektlista
- **URL:** https://www.sisab.se/sv/fastigheter/vara-byggprojekt/
- **Extraherbarhet:** 2 (4 sidor, 31 projekt)
- **Kommentar:** Detaljsidor med belopp (Blackebergsskolan: 130-136 Mkr).

### Kandidat 8: Stadsholmen — Nyhetsarkiv
- **URL:** https://www.stadsholmen.se/om-stadsholmen/nyheter/
- **Extraherbarhet:** 2 (WordPress, paginering)
- **Kommentar:** Lagfrekvent men relevant. "Grundforstärkning Puckeln", "Renovering Stadsgaardsliften".

### Kandidat 9: S:t Erik Markutveckling — Nyheter
- **URL:** https://sterikmark.se/aktuellt/
- **Extraherbarhet:** 2 (ej verifierad — SSL-problem vid test)
- **Kommentar:** Hog relevans per artikel. "Skanska far uppdrag Pripps bryggeri" (640 Mkr).

### Kandidat 10: Stockholms stad — Nyhetsarkiv
- **URL:** https://start.stockholm/aktuellt/nyheter/
- **Extraherbarhet:** 2 (SSL-problem vid test, Drupal)
- **Kommentar:** Stor volym, lag precision. Investeringsbeslut och detaljplaner.

---

## RANG 4 — Kraver Playwright

- **vaxer.stockholm/projekt/** — Helt JS-renderad (React). Hog datakvalitet.
- **kommersannons.se/stockholm** — Kraver Playwright + formularinteraktion.
- **via.tt.se Stockholms stad** — JS-renderad React-app.

---

## REKOMMENDATION

Borja med 2-3 rang 1-kallor:

1. **Stockholmshem — Kommande upphandlingar** — enklast, direkta tender-signaler
2. **Micasa — Mynewsdesk** — hog precision, bevisad fungerande
3. **SISAB — Kommande upphandlingar** — direkt tender-signal

Dessa tre tacker tre olika bolag och ger bade tender- och planned-signaler.
Lagg till fler rang 1-2 kallor iterativt.
