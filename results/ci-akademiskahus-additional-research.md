# Akademiska Hus — Ytterligare kallor

**Datum:** 2026-04-01
**Vertikal:** ci-pressroom (Client Intelligence)
**Befintlig kalla:** Mynewsdesk (mynewsdesk.com/se/akademiska_hus_ab/pressreleases, 10 signaler)

---

## Kandidater

### Kandidat 1: Nyhetsartiklar — akademiskahus.se (REKOMMENDERAD)
- **URL:** https://www.akademiskahus.se/om-oss/aktuellt/Nyheter/2026/mars/
- **Datatyp:** Projektbeslut, investeringsannonser, partnerskap, hallbarhetsinvesteringar
- **Format:** Statisk HTML. Manadslistsidor + individuella artiklar, alla statisk HTML.
- **Datapunkter:** titel, datum, belopp, ort/campus, projektnamn, tidplan, partner/entreprenor
- **Uppdatering:** 5-10 artiklar per manad
- **Extraherbarhet:** 1-2 (statisk HTML, kraver subpage-navigation)
- **Mervarde:** Publicerar artiklar som INTE alltid finns pa Mynewsdesk. Belopp och tidplan
  i brodtext. Verifierade exempel: Mira-projektet (500 mkr), Zoologen (245 mkr).

### Kandidat 2: Projektsidor — campusutveckling
- **URL:** https://www.akademiskahus.se/campusutveckling/projekt-for-framtidens-campus/projekt/
- **Extraherbarhet:** 3 (listningssidan ger 404 vid HTTP fetch, individuella sidor statiska)
- **Mervarde:** Rika projektdetaljer (yta, tidplan, status). Kraver Playwright for lista.

### Kandidat 3: Mercell upphandlingslista
- **URL:** https://www.mercell.com/sv-se/upphandling/509040/akademiska-hus-aktiebolag-upphandlingar.aspx
- **Extraherbarhet:** 3 (HTML-tabell men AJAX-paginering)
- **Mervarde:** Unika tender-signaler (30+ aktiva upphandlingar). Ej i pressrum.

### Kandidat 4: Finansiell oversikt
- **URL:** https://www.akademiskahus.se/om-oss/finansiell-information/en-finansiell-oversikt/
- **Extraherbarhet:** 2 (statisk HTML, aggregerade siffror)
- **Mervarde:** Investeringsvolym per ar (2,5 mdr 2024). Engangsenrichment, inte lopande.

---

## Rekommendation

Implementera **Kandidat 1 (nyhetsartiklar)** — statisk HTML, unika signaler med belopp,
separat fran Mynewsdesk. Anvand manadslistsida som listing_url med subpage-navigation
till individuella artiklar.

Avvakta Kandidat 2-3 (kraver Playwright). Kandidat 4 ar enrichment, inte lopande kalla.
