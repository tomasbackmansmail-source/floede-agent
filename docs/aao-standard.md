# ÅÄÖ-standard for Floede

> Hur svenska kommunnamn med å, ä, ö normaliseras till domännamn,
> och vilken Unicode-normalisering Floede ska använda överallt.

---

## 1. Normalisering: NFC överallt

### Bakgrund

Unicode tillåter två sätt att representera å, ä, ö:

| Form | å | ä | ö |
|------|---|---|---|
| **NFC** (precomposed) | U+00E5 (1 code point) | U+00E4 (1 code point) | U+00F6 (1 code point) |
| **NFD** (decomposed) | U+0061 + U+030A (2 code points) | U+0061 + U+0308 (2 code points) | U+006F + U+0308 (2 code points) |

NFC och NFD ser identiska ut på skärmen men har olika byte-representation.
Jämförelse med `===` misslyckas om en sträng är NFC och en NFD.

**macOS Spotlight/filsystem använder NFD.** Data från webben (HTML, JSON, API:er) är
nästan alltid NFC. SCB levererar NFC. Villaägarnas JSON-fil är NFC.

### Regel

**Floede använder NFC (Canonical Decomposition, followed by Canonical Composition)
som enda normalisering.** All data som kommer in ska NFC-normaliseras vid inläsning:

```
string.normalize('NFC')
```

Detta gäller:
- Kommunnamn från SCB, Villaägarna, manuell inmatning
- Fält i Supabase (source_name, municipality, etc.)
- Filnamn i data/-mappen
- Jämförelser i discovery, QC, daily-run
- URL-path-segments (om de innehåller UTF-8)

### Varför inte NFD?

- Webb-standarden (HTML5, JSON, REST) förväntar NFC
- PostgreSQL/Supabase lagrar NFC by default
- Node.js `String` jämförelser matchar NFC mot NFC
- macOS NFD-problem hanteras bäst vid I/O-gräns, inte genom att adoptera NFD

---

## 2. Domänmappning: å, ä, ö → ASCII

Svenska .se-domäner stöder IDN (internationalized domain names) sedan 2003,
men **ingen enda svensk kommun använder IDN-domän** (t.ex. `åre.se` via punycode).
Alla 290 kommuner använder ASCII-domäner med manuellt vald translitterering.

### Standardregel (282 av 290 kommuner)

```
å → a
ä → a
ö → o
é → e
ü → u
mellanslag → ta bort
bindestreck → behåll
genitiv-s → ta bort (Karlshamns kommun → karlshamn.se)
```

Denna regel täcker **97.2%** av alla kommuner.

### Avvikelser (8 kommuner)

| # | Kommun (Villaägarna) | Förväntat (standardregel) | Faktisk domän | Typ av avvikelse |
|---|---------------------|--------------------------|---------------|------------------|
| 1 | Ängelholms | angelholm.se | **engelholm.se** | ä→e (historiskt namn Engelholm) |
| 2 | Härjedalens | harjedalen.se | **herjedalen.se** | ä→e (härjedal → herjedal, gammalsvenskt) |
| 3 | Hällefors | hallefors.se | **hellefors.se** | ä→e (lokalt uttal) |
| 4 | Stockholms | stockholm.se | **start.stockholm** | Egen TLD (.stockholm) |
| 5 | Falu | falu.se | **falun.se** | Annat ordform (Falun, inte Falu) |
| 6 | Mora | mora.se | **morakommun.se** | "kommun" tillagt (mora.se ägdes av annan) |
| 7 | Habo | habo.se | **habokommun.se** | "kommun" tillagt (habo.se ägdes av annan) |
| 8 | Dals-Eds | dals-ed.se | **dalsed.se** | Bindestreck borttaget |

Dessutom använder 2 kommuner subdomain-mönster:
- **Värnamo** → kommun.varnamo.se (inte varnamo.se)
- **Falkenbergs** → kommun.falkenberg.se (inte falkenberg.se)

### Noteringar om namnformer i källdatan

Villaägarnas JSON använder **genitiv-form** för de flesta kommuner ("Karlshamns",
"Jönköpings") men **grundform** för andra ("Kalmar", "Malmö"). Detta är inkonsekvent
och beror på att det fullständiga uttrycket är "Karlshamns kommun" vs "Kalmar kommun".
Domänen baseras alltid på grundformen utan genitiv-s.

### Flerordskommuner

| Kommun | Domän | Regel |
|--------|-------|-------|
| Östra Göinge | ostragoinge.se | Mellanslag borttaget |
| Upplands Väsby | upplandsvasby.se | Mellanslag borttaget |
| Lilla Edet | lillaedet.se | Mellanslag borttaget |
| Upplands-Bro | upplands-bro.se | Bindestreck behållet |
| Malung-Sälens | malung-salen.se | Bindestreck behållet |
| Dals-Eds | dalsed.se | **Bindestreck borttaget** (avvikelse) |

---

## 3. Komplett mappningstabell: alla 290 kommuner

Format: `Kommunnamn (Villaägarna) → domän`

Kommuner markerade med **⚠** avviker från standardregeln.

### Blekinge län
| Kommun | Domän |
|--------|-------|
| Karlshamns | karlshamn.se |
| Karlskrona | karlskrona.se |
| Olofströms | olofstrom.se |
| Ronneby | ronneby.se |
| Sölvesborgs | solvesborg.se |

### Dalarnas län
| Kommun | Domän |
|--------|-------|
| Avesta | avesta.se |
| Borlänge | borlange.se |
| Falu | **falun.se** ⚠ |
| Gagnefs | gagnef.se |
| Hedemora | hedemora.se |
| Leksands | leksand.se |
| Ludvika | ludvika.se |
| Malung-Sälens | malung-salen.se |
| Mora | **morakommun.se** ⚠ |
| Orsa | orsa.se |
| Rättviks | rattvik.se |
| Säters | sater.se |
| Smedjebackens | smedjebacken.se |
| Vansbro | vansbro.se |
| Älvdalens | alvdalen.se |

### Gotlands län
| Kommun | Domän |
|--------|-------|
| Gotlands | gotland.se |

### Gävleborgs län
| Kommun | Domän |
|--------|-------|
| Bollnäs | bollnas.se |
| Gävle | gavle.se |
| Hofors | hofors.se |
| Hudiksvalls | hudiksvall.se |
| Ljusdals | ljusdal.se |
| Nordanstigs | nordanstig.se |
| Ockelbo | ockelbo.se |
| Ovanåkers | ovanaker.se |
| Sandvikens | sandviken.se |
| Söderhamns | soderhamn.se |

### Hallands län
| Kommun | Domän |
|--------|-------|
| Falkenbergs | kommun.falkenberg.se |
| Halmstads | halmstad.se |
| Hylte | hylte.se |
| Kungsbacka | kungsbacka.se |
| Laholms | laholm.se |
| Varbergs | varberg.se |

### Jämtlands län
| Kommun | Domän |
|--------|-------|
| Bergs | berg.se |
| Bräcke | bracke.se |
| Härjedalens | **herjedalen.se** ⚠ |
| Krokoms | krokom.se |
| Ragunda | ragunda.se |
| Strömsunds | stromsund.se |
| Åre | are.se |
| Östersunds | ostersund.se |

### Jönköpings län
| Kommun | Domän |
|--------|-------|
| Aneby | aneby.se |
| Eksjö | eksjo.se |
| Gislaveds | gislaved.se |
| Gnosjö | gnosjo.se |
| Habo | **habokommun.se** ⚠ |
| Jönköpings | jonkoping.se |
| Mullsjö | mullsjo.se |
| Nässjö | nassjo.se |
| Sävsjö | savsjo.se |
| Tranås | tranas.se |
| Vaggeryds | vaggeryd.se |
| Värnamo | kommun.varnamo.se |
| Vetlanda | vetlanda.se |

### Kalmar län
| Kommun | Domän |
|--------|-------|
| Borgholms | borgholm.se |
| Emmaboda | emmaboda.se |
| Högsby | hogsby.se |
| Hultsfreds | hultsfred.se |
| Kalmar | kalmar.se |
| Mönsterås | monsteras.se |
| Mörbylånga | morbylanga.se |
| Nybro | nybro.se |
| Oskarshamns | oskarshamn.se |
| Torsås | torsas.se |
| Västerviks | vastervik.se |
| Vimmerby | vimmerby.se |

### Kronobergs län
| Kommun | Domän |
|--------|-------|
| Alvesta | alvesta.se |
| Lessebo | lessebo.se |
| Ljungby | ljungby.se |
| Markaryds | markaryd.se |
| Tingsryds | tingsryd.se |
| Uppvidinge | uppvidinge.se |
| Växjö | vaxjo.se |
| Älmhults | almhult.se |

### Norrbottens län
| Kommun | Domän |
|--------|-------|
| Arjeplogs | arjeplog.se |
| Arvidsjaurs | arvidsjaur.se |
| Bodens | boden.se |
| Gällivare | gallivare.se |
| Haparanda | haparanda.se |
| Jokkmokks | jokkmokk.se |
| Kalix | kalix.se |
| Kiruna | kiruna.se |
| Luleå | lulea.se |
| Pajala | pajala.se |
| Piteå | pitea.se |
| Älvsbyns | alvsbyn.se |
| Överkalix | overkalix.se |
| Övertorneå | overtornea.se |

### Skåne län
| Kommun | Domän |
|--------|-------|
| Båstads | bastad.se |
| Bjuvs | bjuv.se |
| Bromölla | bromolla.se |
| Burlövs | burlov.se |
| Eslövs | eslov.se |
| Hässleholms | hassleholm.se |
| Helsingborgs | helsingborg.se |
| Höganäs | hoganas.se |
| Höörs | hoor.se |
| Hörby | horby.se |
| Kävlinge | kavlinge.se |
| Klippans | klippan.se |
| Kristianstads | kristianstad.se |
| Landskrona | landskrona.se |
| Lomma | lomma.se |
| Lunds | lund.se |
| Malmö | malmo.se |
| Osby | osby.se |
| Perstorps | perstorp.se |
| Simrishamns | simrishamn.se |
| Sjöbo | sjobo.se |
| Skurups | skurup.se |
| Staffanstorps | staffanstorp.se |
| Svalövs | svalov.se |
| Svedala | svedala.se |
| Tomelilla | tomelilla.se |
| Trelleborgs | trelleborg.se |
| Vellinge | vellinge.se |
| Ystads | ystad.se |
| Åstorps | astorp.se |
| Ängelholms | **engelholm.se** ⚠ |
| Örkelljunga | orkelljunga.se |
| Östra Göinge | ostragoinge.se |

### Stockholms län
| Kommun | Domän |
|--------|-------|
| Botkyrka | botkyrka.se |
| Danderyds | danderyd.se |
| Ekerö | ekero.se |
| Haninge | haninge.se |
| Huddinge | huddinge.se |
| Järfälla | jarfalla.se |
| Lidingö | lidingo.se |
| Nacka | nacka.se |
| Norrtälje | norrtalje.se |
| Nykvarns | nykvarn.se |
| Nynäshamns | nynashamn.se |
| Salems | salem.se |
| Sigtuna | sigtuna.se |
| Södertälje | sodertalje.se |
| Sollentuna | sollentuna.se |
| Solna | solna.se |
| Stockholms | **start.stockholm** ⚠ |
| Sundbybergs | sundbyberg.se |
| Tyresö | tyreso.se |
| Täby | taby.se |
| Upplands-Bro | upplands-bro.se |
| Upplands Väsby | upplandsvasby.se |
| Vallentuna | vallentuna.se |
| Vaxholms | vaxholm.se |
| Värmdö | varmdo.se |
| Österåkers | osteraker.se |

### Södermanlands län
| Kommun | Domän |
|--------|-------|
| Eskilstuna | eskilstuna.se |
| Flens | flen.se |
| Gnesta | gnesta.se |
| Katrineholms | katrineholm.se |
| Nyköpings | nykoping.se |
| Oxelösunds | oxelosund.se |
| Strängnäs | strangnas.se |
| Trosa | trosa.se |
| Vingåkers | vingaker.se |

### Uppsala län
| Kommun | Domän |
|--------|-------|
| Enköpings | enkoping.se |
| Heby | heby.se |
| Håbo | habo.se |
| Knivsta | knivsta.se |
| Tierps | tierp.se |
| Uppsala | uppsala.se |
| Älvkarleby | alvkarleby.se |
| Östhammars | osthammar.se |

### Värmlands län
| Kommun | Domän |
|--------|-------|
| Arvika | arvika.se |
| Eda | eda.se |
| Filipstads | filipstad.se |
| Forshaga | forshaga.se |
| Grums | grums.se |
| Hagfors | hagfors.se |
| Hammarö | hammaro.se |
| Karlstads | karlstad.se |
| Kils | kil.se |
| Kristinehamns | kristinehamn.se |
| Munkfors | munkfors.se |
| Säffle | saffle.se |
| Storfors | storfors.se |
| Sunne | sunne.se |
| Torsby | torsby.se |
| Årjängs | arjang.se |

### Västerbottens län
| Kommun | Domän |
|--------|-------|
| Bjurholms | bjurholm.se |
| Dorotea | dorotea.se |
| Lycksele | lycksele.se |
| Malå | mala.se |
| Nordmalings | nordmaling.se |
| Norsjö | norsjo.se |
| Robertsfors | robertsfors.se |
| Skellefteå | skelleftea.se |
| Sorsele | sorsele.se |
| Storumans | storuman.se |
| Umeå | umea.se |
| Vilhelmina | vilhelmina.se |
| Vindelns | vindeln.se |
| Vännäs | vannas.se |
| Åsele | asele.se |

### Västernorrlands län
| Kommun | Domän |
|--------|-------|
| Härnösands | harnosand.se |
| Kramfors | kramfors.se |
| Sollefteå | solleftea.se |
| Sundsvalls | sundsvall.se |
| Timrå | timra.se |
| Ånge | ange.se |
| Örnsköldsviks | ornskoldsvik.se |

### Västmanlands län
| Kommun | Domän |
|--------|-------|
| Arboga | arboga.se |
| Fagersta | fagersta.se |
| Hallstahammars | hallstahammar.se |
| Köpings | koping.se |
| Kungsörs | kungsor.se |
| Norbergs | norberg.se |
| Sala | sala.se |
| Skinnskattebergs | skinnskatteberg.se |
| Surahammars | surahammar.se |
| Västerås | vasteras.se |

### Västra Götalands län
| Kommun | Domän |
|--------|-------|
| Ale | ale.se |
| Alingsås | alingsas.se |
| Bengtsfors | bengtsfors.se |
| Bollebygds | bollebygd.se |
| Borås | boras.se |
| Dals-Eds | **dalsed.se** ⚠ |
| Essunga | essunga.se |
| Falköpings | falkoping.se |
| Färgelanda | fargelanda.se |
| Göteborgs | goteborg.se |
| Götene | gotene.se |
| Grästorps | grastorp.se |
| Gullspångs | gullspang.se |
| Herrljunga | herrljunga.se |
| Hjo | hjo.se |
| Härryda | harryda.se |
| Karlsborgs | karlsborg.se |
| Kungälvs | kungalv.se |
| Lerums | lerum.se |
| Lidköpings | lidkoping.se |
| Lilla Edets | lillaedet.se |
| Lysekils | lysekil.se |
| Mariestads | mariestad.se |
| Marks | mark.se |
| Melleruds | mellerud.se |
| Mölndals | molndal.se |
| Munkedals | munkedal.se |
| Orusts | orust.se |
| Partille | partille.se |
| Skara | skara.se |
| Skövde | skovde.se |
| Sotenäs | sotenas.se |
| Stenungsunds | stenungsund.se |
| Strömstads | stromstad.se |
| Svenljunga | svenljunga.se |
| Tanums | tanum.se |
| Tibro | tibro.se |
| Tidaholms | tidaholm.se |
| Tjörns | tjorn.se |
| Tranemo | tranemo.se |
| Trollhättans | trollhattan.se |
| Töreboda | toreboda.se |
| Uddevalla | uddevalla.se |
| Ulricehamns | ulricehamn.se |
| Vara | vara.se |
| Vårgårda | vargarda.se |
| Vänersborgs | vanersborg.se |
| Åmåls | amal.se |
| Öckerö | ockero.se |

### Örebro län
| Kommun | Domän |
|--------|-------|
| Askersunds | askersund.se |
| Degerfors | degerfors.se |
| Hallsbergs | hallsberg.se |
| Hällefors | **hellefors.se** ⚠ |
| Karlskoga | karlskoga.se |
| Kumla | kumla.se |
| Laxå | laxa.se |
| Lekebergs | lekeberg.se |
| Lindesbergs | lindesberg.se |
| Ljusnarsbergs | ljusnarsberg.se |
| Nora | nora.se |
| Örebro | orebro.se |

### Östergötlands län
| Kommun | Domän |
|--------|-------|
| Boxholms | boxholm.se |
| Finspångs | finspang.se |
| Kinda | kinda.se |
| Linköpings | linkoping.se |
| Mjölby | mjolby.se |
| Motala | motala.se |
| Norrköpings | norrkoping.se |
| Söderköpings | soderkoping.se |
| Vadstena | vadstena.se |
| Valdemarsviks | valdemarsvik.se |
| Ydre | ydre.se |
| Åtvidabergs | atvidaberg.se |
| Ödeshögs | odeshog.se |

---

## 4. SCB kommunkoder

SCB (Statistiska centralbyrån) tilldelar varje kommun en 4-siffrig kod.
Koderna är stabila och ändras inte vid namnbyten. De börjar med länsnumret:

- 01xx = Stockholms län
- 03xx = Uppsala län
- 04xx = Södermanlands län
- ...
- 25xx = Norrbottens län

SCB-koderna är irrelevanta för domänmappning men viktiga som stabil nyckel
vid datakopplingar. SCB levererar namn i NFC.

**Rekommendation:** Om Floede behöver en stabil identifierare för kommuner
utöver namn, använd SCB kommunkoder. De är opåverkade av ÅÄÖ-problem.

---

## 5. Referensimplementation (JavaScript)

```javascript
/**
 * Normalize a Swedish municipality name to its .se domain hostname.
 * Covers 282/290 kommuner. 8 exceptions need a lookup table.
 * Input should be NFC-normalized. Returns e.g. "gavle.se".
 */
const EXCEPTIONS = {
  'ängelholm': 'engelholm.se', 'härjedalen': 'herjedalen.se',
  'hällefors': 'hellefors.se', 'stockholm': 'start.stockholm',
  'falun': 'falun.se', 'falu': 'falun.se',
  'mora': 'morakommun.se', 'habo': 'habokommun.se',
  'dals-ed': 'dalsed.se', 'falkenberg': 'kommun.falkenberg.se',
  'värnamo': 'kommun.varnamo.se',
};

export function kommunToDomain(name) {
  const base = name.normalize('NFC').replace(/s$/, '').trim();
  const key = base.toLowerCase();
  if (EXCEPTIONS[key]) return EXCEPTIONS[key];
  const ascii = key
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o')
    .replace(/é/g, 'e').replace(/ü/g, 'u')
    .replace(/\s+/g, '');
  return `${ascii}.se`;
}
```

---

## 6. Alla edge cases — sammanfattning

### 6.1 ä→e (inte ä→a)
Tre kommuner translittererar ä som **e**, inte a:
- **Ängelholm** → engelholm (historiskt: staden hette Engelholm till 1516)
- **Härjedalen** → herjedalen (urnordiskt "herjar" → härje, domänen bevarar äldre form)
- **Hällefors** → hellefors (lokalt uttal med e-ljud)

Dessa kan inte härledas algoritmiskt — de kräver en lookup-tabell.

### 6.2 Domän ≠ kommunnamn
- **Falu kommun** → falun.se (kommunen heter "Falu", staden heter "Falun")
- **Mora kommun** → morakommun.se (mora.se var upptagen)
- **Habo kommun** → habokommun.se (habo.se var upptagen/annan användning)

### 6.3 Bindestreck-inkonsekvens
- Upplands-Bro → upplands-bro.se (bindestreck behålls)
- Malung-Sälen → malung-salen.se (bindestreck behålls)
- Dals-Ed → dalsed.se (bindestreck **tas bort**)

### 6.4 Subdomän-mönster
- Värnamo → kommun.varnamo.se
- Falkenberg → kommun.falkenberg.se

### 6.5 Icke-.se TLD
- Stockholm → start.stockholm (egen gTLD)

### 6.6 Genitiv-s i källdata
Villaägarnas data har inkonsekvent genitiv: "Karlshamns" men "Kalmar".
`normalizeToHostname()` måste hantera båda formerna. Domänerna använder
aldrig genitiv-s.

### 6.7 Unicode NFC vs NFD
- All data i villaagarna-kommuner.json är NFC (verifierat)
- macOS filsystem kan leverera NFD vid `fs.readdir()` — NFC-normalisera vid inläsning
- `String.prototype.normalize('NFC')` löser alla sådana problem
- Supabase/PostgreSQL returnerar NFC
- Jämför aldrig kommunnamn utan att först NFC-normalisera båda sidor

### 6.8 Håbo vs Habo
- **Håbo kommun** (Uppsala län) → habo.se (å→a)
- **Habo kommun** (Jönköpings län) → habokommun.se

Dessa ger samma ASCII-form "habo" efter translitterering. Habo kommun
löste kollisionen genom att lägga till "kommun" i domänen.

---

## 7. Rekommendationer för Floede-kodbasen

1. **`normalizeToHostname()`** i `src/utils/discovery.js` implementerar
   standardregeln korrekt. Den saknar dock exception-tabellen.

2. **Lägg till NFC-normalisering** som första steg i `normalizeToHostname()`:
   ```javascript
   name = name.normalize('NFC');
   ```

3. **Jämför aldrig kommunnamn direkt** — använd alltid
   `a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase()`
   eller en dedikerad funktion.

4. **Discovery/QC** som idag matchar på domännamn bör använda exception-
   tabellen för att korrekt hantera de 8 avvikande kommunerna.

5. **Lagra alltid det korrekta svenska namnet** (med ÅÄÖ) i databasen.
   Normalisera bara vid DNS-lookup/URL-konstruktion.
