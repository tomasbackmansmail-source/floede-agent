### Akademiska Hus -- Kallanalys

**Datum:** 2026-04-01
**Vertikal:** ci
**Uppgift:** Hitta publika datakallor med pressmeddelanden, nyheter, projektlistor, byggprojekt och investeringsbeslut

---

**Kandidat 1: Mynewsdesk -- Pressmeddelanden**
- URL: https://www.mynewsdesk.com/se/akademiska_hus_ab/pressreleases
- Datatyp: Pressmeddelanden om byggprojekt, investeringsbeslut, finansiella rapporter, organisationsforandringar
- Datapunkter: titel, publiceringsdatum (datetime-attribut), brödtext, kontaktpersoner (namn, titel, e-post), taggar (byggprojekt, studentbostader, hallbarhet, campusutveckling)
- Format: Statisk HTML med semantiska element (h2.panel__heading, time.panel__date, a.panel__link)
- Uppdatering: Flera ganger per manad (senaste: 2026-03-30, 2026-03-23, 2026-03-11)
- Extraherbarhet: **1**
- Kommentar: Utmarkt kalla. All data finns i initial HTML. Strukturerad med `<time datetime="...">` och `<h2 class="panel__heading">`. Pagination via `?page=N` fungerar server-side. Taggar tillgangliga for filtrering (t.ex. `/pressreleases/tag/byggprojekt`). Individuella pressmeddelanden innehaller full brödtext, kontaktuppgifter och bilder i statisk HTML. Ingen inloggning kravs. RSS-feed finns ej.

**Kandidat 2: Mynewsdesk -- Byggprojekt-tagg**
- URL: https://www.mynewsdesk.com/se/akademiska_hus_ab/pressreleases/tag/byggprojekt
- Datatyp: Pressmeddelanden specifikt om byggprojekt (byggstarter, milstolpar, investeringsbeslut)
- Datapunkter: titel, datum, lank till fulltext
- Format: Statisk HTML, samma struktur som ovriga pressmeddelanden
- Uppdatering: Vid nya byggprojektrelaterade pressmeddelanden (ca manatligen)
- Extraherbarhet: **1**
- Kommentar: Filtrerad vy av kandidat 1. Ger direkt tillgang till de mest relevanta pressmeddelandena. Exempel: "Mangmiljardsatsning -- Framtidens campus Lulea", "Byggstart for miljardsatsningen Konstnarliga". Server-renderad paginering.

**Kandidat 3: Akademiska Hus -- Nyheter**
- URL: https://www.akademiskahus.se/om-oss/aktuellt/Nyheter/
- Datatyp: Nyheter om byggprojekt, campus-utveckling, hallbarhet, finansiella rapporter
- Datapunkter: titel (m-contentCard__title), lank till artikel, kategorietiketter (a-pill__label)
- Format: Statisk HTML for forsta sidan (15 artiklar); paginering ar JS-driven (query-param `?page=N` ignoreras server-side, alltid samma 15 artiklar i HTML)
- Uppdatering: Flera ganger per manad (senaste fran mars 2026)
- Extraherbarhet: **3**
- Kommentar: Forsta sidan med 15 nyheter finns i statisk HTML. Det finns 216 nyheter totalt over 15 sidor men paginering kraver JavaScript (Stimulus-controller `ListingPage#onPageChange`). Filter (kategori) finns men ar ocksa JS-drivna. Individuella artiklar ar dack fullt server-renderade med `article:published_time` meta-tag, h1-rubrik, datum, och ingress.

**Kandidat 4: Akademiska Hus -- Individuella nyhetsartiklar**
- URL: https://www.akademiskahus.se/om-oss/aktuellt/Nyheter/{ar}/{manad}/{slug}/
- Exempel: https://www.akademiskahus.se/om-oss/aktuellt/Nyheter/2026/mars/mangmiljardsatsning--nu-borjar-forverkligandet-av-framtidens-campus-lulea/
- Datatyp: Fullstandiga nyhetsartiklar med projektdetaljer, investeringsbelopp, tidplaner
- Datapunkter: `<meta property="article:published_time">`, `<h1>` rubrik, `<span class="m-articleHero__date">`, `<p class="l-article__preamble">`, `<time class="m-articleMeta__published">`, brödtext
- Format: Statisk HTML, fullt server-renderad
- Uppdatering: N/A (enskilda artiklar)
- Extraherbarhet: **1**
- Kommentar: Om man har artikel-URL:er (fran Mynewsdesk-listningen eller RSS) ar varje artikel fullt scrapebar med rik data i DOM. Forutsager tillgang till URL-listan fran kandidat 1 eller 3.

**Kandidat 5: Akademiska Hus -- Projektlista**
- URL: https://www.akademiskahus.se/utveckling/projekt-for-framtidens-campus/projekt/
- Datatyp: Aktiva och framtida byggprojekt med filtreringsmojligheter
- Datapunkter: projektnamn (m-contentCard__title), lank till projektdetalj, kategorietiketter (a-pill__label: Nybyggnad, Ombyggnad, Utemiljo, Studentbostader, Larandemiljoer, Arkitektur, Campusutveckling)
- Format: Statisk HTML for alla 14 aktuella projekt (ingen paginering behovs)
- Filter-metadata i HTML: stad (Stockholm 5, Göteborg 3, Lulea 2, m.fl.), campus, projekttyp (Ombyggnad 9, Nybyggnad 3, Utemiljo 1), projektstatus (Pagaende 11, Framtida 3)
- Uppdatering: Nar projekt tillkommer/avslutas (sannolikt manatligen till kvartalsvis)
- Extraherbarhet: **1**
- Kommentar: Alla 14 projekt visas pa en sida i statisk HTML utan paginering. Filteralternativ finns inbaddade som `<option>`-element. Varje projekt lankar till en detaljsida.

**Kandidat 6: Akademiska Hus -- Projektdetaljsidor**
- URL: https://www.akademiskahus.se/utveckling/projekt-for-framtidens-campus/projekt/aktuella/{slug}/
- Exempel: https://www.akademiskahus.se/utveckling/projekt-for-framtidens-campus/projekt/aktuella/Handelshogskolans-nya-byggnad/
- Datatyp: Detaljerad projektinformation
- Datapunkter: projektnamn, byggstart ("Byggstart: 2021"), bruttoarea ("Bruttoarea: 10 800 kvm"), beskrivning, bilder
- Format: Statisk HTML
- Uppdatering: Nar projektet uppdateras
- Extraherbarhet: **1**
- Kommentar: Strukturerad data i statisk HTML. Faktarutor med byggstart och area. Kombineras med kandidat 5 for komplett projektdata.

**Kandidat 7: Akademiska Hus -- Finansiella rapporter (PDF)**
- URL: https://www.akademiskahus.se/om-oss/finansiell-information/rapporter/
- Datatyp: Arsredovisningar, delarsrapporter, bokslutskommunikeer
- Datapunkter: PDF-lankar med forutsagbar namngivning (`arsredovisning-{ar}.pdf`), gar tillbaka till 2006
- Format: Statisk HTML-sida med PDF-lankar
- Uppdatering: Kvartalsvis (delarsrapporter) + arligen (arsredovisning)
- Extraherbarhet: **2**
- Kommentar: Listningssidan ar statisk HTML med direktlankar till PDF-filer. PDF:erna innehaller detaljerad information om investeringar, projektportfolj och finansiella nyckeltal, men kraver PDF-parsning for dataextraktion. Senaste: Arsredovisning 2025.

**Kandidat 8: Opic/Mercell -- Upphandlingar**
- URL: https://www.opic.com/org/akademiska_hus_aktiebolag/
- Datatyp: Publicerade upphandlingar (bygg, drift, tjanster)
- Datapunkter: Ej verifierbart -- sidan ar helt JS-renderad
- Format: Helt JS-renderad SPA (React/Angular). curl returnerar bara `<div id="root"></div>`.
- Uppdatering: Lopande vid nya upphandlingar
- Extraherbarhet: **4**
- Kommentar: Opic har migerat till Mercell-plattformen som ar en fullstandig SPA. Kraver Playwright eller likvardig for att fa data. Alternativt kan TED (ted.europa.eu) anvandas for EU-upphandlingar over troskelvarden.

**Kandidat 9: Leverantorsportalen**
- URL: https://annons.akademiskahus.se/
- Datatyp: Upphandlingsannonser, avtal, ordrar
- Datapunkter: Upphandlingsnotiser finns pa /Notice/NoticeList.aspx
- Format: ASP.NET WebForms (Telerik/Primona) -- kraver ViewState och eventuellt inloggning
- Uppdatering: Lopande
- Extraherbarhet: **5**
- Kommentar: Portalen ar byggd pa aldre ASP.NET WebForms med Telerik-komponenter. Startsidan visar inloggningsformular och information om leverantorslicenser. Notislistan ar sannolikt tillganglig utan inloggning men kraver komplex session-hantering (ViewState, EventValidation). Opraktisk for automatiserad datainsamling.

---

**Rekommendation:**

Borja med **Kandidat 1 (Mynewsdesk pressmeddelanden)** som primar kalla. Den ar den basta kombinationen av datakvalitet och extraherbarhet:
- Helt statisk HTML med semantiska element (`time[datetime]`, `h2.panel__heading`, `a.panel__link`)
- Paginering fungerar server-side via `?page=N`
- Taggar mojliggor filtrering direkt (`/tag/byggprojekt` for byggprojekt-specifika nyheter)
- Individuella pressmeddelanden innehaller fulltext, investeringsbelopp, kontaktuppgifter
- Uppdateras regelbundet (2-4 ganger per manad)

Som komplement, lagg till **Kandidat 5+6 (Projektlista + detaljer)**:
- Alla 14 aktuella projekt i en statisk HTML-sida
- Detaljsidor med byggstart, area och beskrivning
- Ger strukturerad projektdata som kompletterar pressmeddelandenas narrativ

For finansiell information, anvand **Kandidat 7 (Rapporter)** for att hamta PDF-lankar programmatiskt.

Undvik kandidat 8-9 (Mercell/leverantorsportalen) -- de kraver Playwright respektive komplex session-hantering for minimal mervarde jamfort med ovriga kallor.
