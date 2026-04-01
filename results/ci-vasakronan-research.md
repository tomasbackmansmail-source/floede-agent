# Vasakronan AB — Kallanalys

**Datum:** 2026-04-01
**Vertikal:** ci-pressroom (Client Intelligence)

---

## Kandidater

### Kandidat 1: Projektsida — Vara projekt (REKOMMENDERAD)
- **URL:** https://vasakronan.se/om-vasakronan/vi-utvecklar-stader/vara-projekt/
- **Datatyp:** Projektlista med pagaende och nyligen avslutade projekt
- **Datapunkter:** Projektnamn, ort, status, yta (kvm), byggstart, inflyttning, byggherre/arkitekt, certifiering, typ
- **Format:** Statisk HTML (WordPress med JSON-LD). 27 projekt i project-sitemap.xml.
- **Uppdatering:** Oregelbundet, 7 av 27 projekt uppdaterade Q4 2025/Q1 2026
- **Extraherbarhet:** 1
- **Kommentar:** Konsekvent struktur. Inga belopp men tidplaner, yta, status. Sitemap ger komplett URL-lista.

### Kandidat 2: Nyhetsflode — Aktuellt
- **URL:** https://vasakronan.se/aktuellt/
- **Datatyp:** Redaktionella nyhetsartiklar om projekt, stadsutveckling, forvärv
- **Datapunkter:** Titel, datum, kategori, ingress, projektnamn i brodtext
- **Format:** Statisk HTML, 12 artiklar pa listningssidan
- **Uppdatering:** Veckovis till manadsvis
- **Extraherbarhet:** 1
- **Kommentar:** Kategorin "Stadsutveckling" mest CI-relevant. Fangar forvärv och kontraktstecknanden som inte syns pa projektsidorna.

### Kandidat 3: Pressmeddelanden
- **URL:** https://vasakronan.se/pressmeddelande/[slug]/
- **Datatyp:** Officiella pressmeddelanden om forvärv, rapporter, investeringsbeslut
- **Format:** Individuella PM ar statisk HTML. Listningssidan kraver JavaScript.
- **Sitemap:** press-release-sitemap.xml (600+ PM fran 2001-2021, nyare saknas)
- **Extraherbarhet:** 2 (listning kraver JS, individuella sidor ar statiska)
- **Kommentar:** Losning: anvand sitemap som URL-lista. Mest varde vid forvarvsmeddelanden.

### Kandidat 4: Cision Newsroom
- **URL:** https://news.cision.com/vasakronan
- **Extraherbarhet:** 4 (JS-renderad, engelsk version av Kandidat 3)
- **Kommentar:** Inget mervarde. Undvik.

---

## Rekommendation

**Borja med Kandidat 2 (/aktuellt/)** — enklast att konfigurera som listing_url:
- 12 senaste artiklarna i statisk HTML pa en sida
- Fangar bade projektuppdateringar och forvärv/kontraktsnyheter
- Uppdateras regelbundet

**Komplettera med Kandidat 1 (projektsida)** som nasta steg — kraver subpage-navigation
via sitemap men ger strukturerade projektsignaler.

**Undvik Kandidat 4 (Cision)** — kraver Playwright, engelska, inget mervarde.
