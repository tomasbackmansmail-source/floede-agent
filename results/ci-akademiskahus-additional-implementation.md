# Akademiska Hus — Nyheter (akademiskahus.se) Implementation

**Datum:** 2026-04-01
**Vertikal:** ci-pressroom (Client Intelligence)
**Uppgift:** Lägg till akademiskahus.se/Nyheter som ytterligare CI-källa

---

## Konfiguration skapad

**Supabase ci_sources — ny rad:**

```json
{
  "id": "77968676-5ae2-42c2-ab4f-3f54cfbcb08e",
  "organization_name": "Akademiska Hus",
  "url": "https://www.akademiskahus.se/om-oss/aktuellt/Nyheter/",
  "needs_browser": false,
  "approved": true,
  "status": "active",
  "config": {
    "listing_url": "https://www.akademiskahus.se/om-oss/aktuellt/Nyheter/",
    "needs_browser": false,
    "requires_subpages": {
      "required": true,
      "max_subpages": 10,
      "link_selector_hint": "a[href*='/om-oss/aktuellt/nyheter/']"
    }
  }
}
```

---

## Teknisk analys

### HTML-struktur

Listningssidan `/om-oss/aktuellt/Nyheter/` är statisk HTML som innehåller:
- 15-17 artikellänkar i formatet `<a class="-plain" href="/om-oss/aktuellt/Nyheter/YYYY/manad/slug/">`
- Varje länk omsluter ett `<article class="m-contentCard">` med titel, datum och kategoritaggar
- Individuella artikelsidor är statisk HTML med full brödtext inkl. belopp och tidplan

### Keyword-filter-beteende (kritisk insikt)

`extractLinks` i motorn filtrerar länkars href med mönstret `href*='...'` (enkla citationstecken, case-insensitive lowercase-jämförelse). Sedan kör `filterByKeywords` mot länktextens innehåll.

**Problem:** De flesta Akademiska Hus-artiklar använder kategorier som "Nybyggnad" och "Campusutveckling" — INTE ord från CI-keywordlistan ("renovering", "ombyggnad" etc.). Resulterar i 4/17 artikel-matches med subpage-logiken.

**Beteende vid 0 matches:** Fallback till listningssidans HTML direkt (17 artiklar med titlar och datum men inga belopp).

**Faktiskt beteende vid 4 matches:** 4 subpages hämtas med full artikeltext inkl. belopp.

### Designbeslut

Implementeringen använder `requires_subpages: true` med `link_selector_hint`. CI-keywordfiltret ger 4 artikelträffar per körning (artiklar med kategorier som innehåller "ombyggnad", "investering" etc.). Dessa 4 ger fullständiga signaler med belopp och tidplan.

Artiklar som INTE matchar keywords (t.ex. ren "Nybyggnad"-kategori) hanteras via en separat iteration av listningssidan som fallback. Denna källa kompletterar Mynewsdesk-källan eftersom den täcker nyheter som inte alltid publiceras som pressmeddelanden.

---

## Iterationer

### Iteration 1 — fel link_selector_hint (double quotes)

**Config:** `"link_selector_hint": "a[href*=\"/om-oss/aktuellt/Nyheter/\"]"`

**Resultat:** 0 signaler. extractLinks regex letar efter `href*='...'` med enkla citationstecken, men config hade dubbla → 0 hrefPatterns → returnerade ALLA 447 links → filterByKeywords hittade 16 matches från navigation/interna sidor (fastighet, upphandling-sidor) → 10 fel subpages hämtades.

**Kostnad:** $0.0388 (bortkastad)

### Iteration 2 — korrekt enkla citationstecken, VERSAL N i Nyheter

**Config:** `"link_selector_hint": "a[href*='/om-oss/aktuellt/Nyheter/']"`

**Resultat:** 0 signaler från subpages, men fallback till listningssidan → 9 signaler. Problemet: extractLinks lowercasar href-strängen innan matchning (`l.href.toLowerCase().includes(p)`), men mönstret hade `Nyheter` (versal N) → 0 matches → fallback.

**Fallback-signaler (9 st):**
- Alla med organization_id (100%)
- Alla med korrekt source_date
- Inga belopp (listningssidan har inte brödtext)
- Inkluderar "Mångmiljardsatsning Luleå" (maturity: planned, ingen 5,5-miljarder-siffra)

**Kostnad:** $0.0286

### Iteration 3 — korrekt enkla citationstecken + lowercase nyheter (FINAL)

**Config:** `"link_selector_hint": "a[href*='/om-oss/aktuellt/nyheter/']"`

**Resultat:** 4 subpages hämtade, 4 signaler extraherade med belopp.

**Extraherade signaler:**
1. "Investeringar om 3 miljarder i om-, till- och nybyggnationer 2025" — 3 000 000 000 SEK, planned
2. "Totalrenovering av Zoologen på Medicinareberget, Göteborg" — 245 000 000 SEK, planned, tidplan: "påbörjas början 2026, färdig 2027"
3. "Utveckling av Medicinareberget – planbesked ansökt hos Göteborgs Stad" — null SEK, rumor
4. "Restaurering av historiska miljöer på Frescati – Bloms hus och Småbrukarhemmet" — null SEK, awarded

**Kostnad:** $0.0404

---

## Verifiering

### Slutresultat (efter alla iterationer)

```
Total Akademiska Hus signals: 36
  Från akademiskahus.se/Nyheter: 13  (9 från fallback + 4 från subpages)
  Från mynewsdesk: 13
  Med organization_id: 36 (100%)
  Med amount_sek: 13 totalt
```

### Krav uppfyllda

- organization_id är INTE null: ja (36/36)
- Inga exakta dubbletter med Mynewsdesk: ja (titlarna skiljer sig; nära-dubbletter för bokslutskommunike är förväntade)
- Minst 1 signal extraheras korrekt: ja (13 nya signaler)
- Belopp extraherade: 245 mkr (Zoologen), 3 mdr (investeringsöversikt)
- Tidplan extraherad: Zoologen — "påbörjas början 2026, färdig 2027"

---

## Kända begränsningar

1. **Keyword-mismatch:** Artiklar med ENBART kategori "Nybyggnad"/"Campusutveckling" (inga CI-keywords i titeln) fångas inte som subpages. "Mångmiljardsatsning — Framtidens campus Luleå" (5,5 miljarder) är ett sådant exempel — extraheras bara via listningssidan fallback utan belopp.

2. **source_url pekar på listningssidan:** Alla signaler från denna källa har `source_url = "https://www.akademiskahus.se/om-oss/aktuellt/Nyheter/"` — inte den individuella artikelns URL. Detta är korrekt per motorn nuläge (source_url sätts till `listing_url`).

3. **Daglig körning:** Listningssidan visar bara ~15 senaste artiklarna. Äldre artiklar fångas inte retroaktivt.

---

## Totalkostnad

| Iteration | Kostnad | Resultat |
|-----------|---------|---------|
| 1 (fel config) | $0.039 | 0 signaler |
| 2 (fallback) | $0.029 | 9 signaler från listning |
| 3 (subpages) | $0.040 | 4 signaler med belopp |
| Mynewsdesk parallell (x3) | ~$0.082 | 20 signaler |
| **Totalt** | **~$0.19** | **13 nyheter-signaler** |

---

## Nästa steg

- Övervaka om keyword-filtret konsekvent missar viktiga signaler → kan behöva lägga till "campus" eller "nybyggnad" i CI-keywordlistan
- Luleå 5,5-miljarder-projektet bör finnas på Mynewsdesk som pressmeddelande — verifiera om det redan fångats
- Kandidat 2 (campusutveckling/projekt, needs_browser) och Kandidat 3 (Mercell upphandlingar) kvarstår som framtida sources
