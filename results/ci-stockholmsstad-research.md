# Stockholms stad — Kallanalys

**Datum:** 2026-04-01
**Vertikal:** ci-pressroom
**Uppgift:** Hitta publika datakallor med pressmeddelanden, nyheter om byggprojekt, stadsbyggnadsprojekt, exploateringsprojekt, upphandlingar och investeringsbeslut for Stockholms stads forvaltningar och bolag

---

## Kandidater

### Kandidat 1: Stockholmshem — Nyhetsarkiv (REKOMMENDERAD)
- **URL:** https://www.stockholmshem.se/om-oss/nyhetsarkiv/
- **Datatyp:** Nyheter om nybyggnation, renoveringar, ombyggnader, finansiella beslut
- **Datapunkter:** titel (h3), datum (YYYY-MM-DD som klartext), kortsammanfattning (p), URL till artikel
- **Format:** Statisk HTML, paginering via sidor 1-6 med ca 12-15 nyheter per sida
- **Uppdatering:** Veckovis till manadsvis
- **Extraherbarhet:** 1 (enkel)
- **Kommentar:** Tydlig HTML-struktur med `a > h3 + datum + p` per nyhet. Datum i YYYY-MM-DD-format. Paginering via ?page=N (server-side). Innehaller konkreta byggprojekt med adress, antal lagenheter och tidplan. Verifierade exempel: "960 nya hyresratter till stockholmarna", "Stockholmshem bygger 166 hyreslагenheter i Bromma". Inga inloggningskrav. Inga SSL-hinder.

### Kandidat 2: Stockholmshem — Kommande upphandlingar
- **URL:** https://www.stockholmshem.se/om-oss/upphandling/kommande-upphandlingar/
- **Datatyp:** Planerade upphandlingar av ombyggnation och nybyggnation med beraknad annonstidpunkt
- **Datapunkter:** projektnamn, adress/omrade, typ av arbete, antal lagenheter, beraknad annonstidpunkt (kvartal/ar)
- **Format:** Statisk HTML, ingen paginering, uppdateras "var tredje manad"
- **Uppdatering:** Kvartalsvis
- **Extraherbarhet:** 1 (enkel)
- **Kommentar:** Platt lista med ca 20 projekt i "Ombyggnation" och "Nybyggnation". Belopp anges inte. Alla projekt = maturity=tender. Stabil URL.

### Kandidat 3: Stockholmshem — Planer nyproduktion
- **URL:** https://www.stockholmshem.se/vi-bygger/vi-bygger-nytt/planer-nyproduktion/
- **Datatyp:** Planerade nybyggnadsprojekt med adress, antal lagenheter och stadsdel
- **Format:** Statisk HTML
- **Uppdatering:** Sallan
- **Extraherbarhet:** 1
- **Kommentar:** Lista med ~15 planerade projekt per stadsdel. Ingen tidplan eller belopp. maturity=planned/rumor.

### Kandidat 4: insynsverige.se — Exploateringsnamnden protokoll
- **URL:** https://insynsverige.se/stockholm-exploatering
- **Datatyp:** Namndbeslut om markanvisningar, exploateringsavtal, genomforandebeslut
- **Datapunkter:** motesdatum, arendetitel (h4), diarienummer, lank till PDF-bilagor
- **Format:** Statisk HTML for indexsida och protokollsidor
- **Uppdatering:** Ca 10 ganger per ar
- **Extraherbarhet:** 2 (tvastegnavigation)
- **Kommentar:** Belopp enbart i PDF-bilagor (amount_sek=null). Verifierade arenden fran 2026-03-26: "Markanvisning for forskola inom fastigheterna Ballsta 1:9 och Ballsta 1:34".

### Kandidat 5: via.tt.se — Svenska Bostader pressrum
- **URL:** https://via.tt.se/pressrum/svenska-bostader/r?publisherId=3236439
- **Extraherbarhet:** 4 (kraver Playwright, React-renderad)

### Kandidat 6: vaxer.stockholm — Nyheter och Projekt
- **URL:** https://vaxer.stockholm/nyheter/ och https://vaxer.stockholm/projekt/
- **Extraherbarhet:** 4 (SSL-certifikatfel blockerar HTTP fetch)
- **Kommentar:** Stockholms stads officiella stadsutvecklingsportal. Hog potential om SSL-hindret loses med Playwright.

### Kandidat 7: fastighetskontoret.stockholm — Nyheter
- **URL:** https://fastighetskontoret.stockholm/aktuellt/
- **Extraherbarhet:** 4 (SSL-certifikatfel)

### Kandidat 8: Stadsholmen — Nyheter
- **URL:** https://www.stadsholmen.se/om-stadsholmen/nyheter/
- **Extraherbarhet:** 1 (HTML), men lag relevans och sallan uppdaterad

---

## Rekommendation

Borja med **Kandidat 1 (Stockholmshem nyhetsarkiv)** som primar kalla:
- Statisk HTML med enkel, konsistent struktur
- Konkreta byggprojekt med adress, antal lagenheter och tidplan
- Uppdateras veckovis till manadsvis
- Inga SSL-hinder, ingen inloggning

Lagg till **Kandidat 2 (kommande upphandlingar)** direkt som komplement.

Prioritera **Kandidat 4 (Exploateringsnamnden)** i nasta steg.

Avvakta med Kandidat 5-7 (kraver Playwright).

## Risker och begransningar
- Alla `*.stockholm`-subdomaner ger SSL-certifikatfel vid HTTP fetch
- Stockholms stad saknar samlat pressrum — information distribuerad per bolag
- Exploateringsnamndens belopp enbart i PDF-bilagor
