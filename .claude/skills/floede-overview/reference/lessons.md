# Floede — Lärdomar

## Strategiska beslut och varför

### Täckning före försäljning
Tomas Backman beslutade tidigt att motorn ska ha bred täckning innan ByggSignal säljs. Att visa en produkt med luckor förstör förtroendet permanent. En kund i Göteborg som ser 0 ärenden kommer aldrig tillbaka.

### Motorn före vertikaler
Mars 2026: tre vertikaler ville byggas parallellt. Tomas korrigerade: "Jag vägrar visa en produkt för en kund som jag inte är 100% säker på kan uppfylla vårt löfte." Alla tre vertikaler bygger på samma motor. Om motorn inte levererar faller allt.

### Antirio/KommersAnnons (beslut dag 20)
KommersAnnons användarvillkor punkt 3.3 förbjuder vidareförsäljning utan godkännande. ByggSignal är en betaltjänst = vidareförsäljning. Beslut: aldrig scrapa Antirios plattformar utan godkännande. Upphandlingsdata frysta. Möjlig partnerskapsväg undersöks.

### Combify är inte konkurrenten
Combify säljer historisk fastighetsdata med CRM-skal till fastighetsbolag för ~2 500 kr/mån. ByggSignal säljer dagliga lead-signaler till hantverkare för 195-750 kr/mån. 21 dagars fördröjning vs daglig. Saknar statusfält. Olika kund, olika produkt, olika pris.

## Misstag

### Kommunkartan.se (dag 15)
15 dagar spenderade på att bygga individuella scrapers när Kommunkartan.se redan aggregerade alla kommuners bygglov 3 år tillbaka. Lärdom: "Steg 0" — innan du bygger en pipeline, sök om en aggregator redan finns.

### Backfill-uppskattning
CTO uppskattade 6-10% hit rate för applicant-extraction ur gamla beskrivningar. Verkligt: 0.17%. Borde ha stoppat efter 50-testet som gav 0 träffar. Lärdom: testa i liten skala innan storskalig körning.

### GDPR-miss
Applicant-extraction saknade privatpersonsfilter. Regeln fanns i specen men missades vid CC-promptskrivning. Fångat av Tomas, fixat samma dag. Permanent checklista: innan varje CC-prompt som rör persondata, fråga "kan detta fånga privatpersoners namn?"

### Tre CTO:er på samma fil
Tre CC-instanser ändrade daily-run.js oberoende av varandra. Sajten var nere 10+ timmar. Lärdom: ett repo = en CC. Motorkod ägs av CTO Engine. Vertikaler rör den aldrig.

### Keyword-buggen (dag 28)
search_terms innehöll bara flerordiga fraser. Cheap-steps hit rate: 0.6%. En config-ändring (enskilda sökord) lyfte till 92.5%. Tre CTO-instanser hade tre separata symptom av samma rotorsak. Lärdom: dokumentera hur saker fungerar, inte bara vad de gör.

### Sifferavvikelser
Tre olika siffror för samma sak i tre olika vyer. Grundorsak: queries läste från legacy-tabell istället för aktuell. Lärdom: alla kundsynliga siffror ska komma från samma databasquery.

## Principer som vuxit fram ur erfarenhet

- **Läs koden innan du ändrar den.** Inte skumma — läs. Förstå alla anropsställen och sidoeffekter.
- **Testa i incognito efter varje push.** Railway auto-deployar. Verifiera att allt renderas.
- **Fält som inte kan extraheras = null.** Aldrig gissning. Hellre saknad data än felaktig.
- **Fixa rotorsaker, inte symptom.** Tre separata buggar med samma rotorsak kräver en fix, inte tre.
- **Verifiera siffror innan du citerar dem.**
- **Inga emojis i UI eller kod.** Ingen undantag.
- **Alla åäö korrekta.** I databas, i UI, i kod, i kommunikation.
- **beslutsdatum som datumkälla.** Aldrig scraped_at. Undantag: "Ny i ByggSignal idag" som visar när Floede hittade ärendet.
- **Ett repo = en CC.** Aldrig låta flera Claude Code-instanser ändra samma repo utan koordination.

## Insikter om bygglovsprocessen

**Signalvärde per status:**
- Ansökt: arkitekter och KA vill ha tidig signal. Inte actionable för byggfirmor.
- **Beviljat: primärt säljfönster.** Budget låst, byggherren skickar RFQ:er nu.
- Startbesked: för sent. Kontrakt redan signerat.

Produkten ska optimeras kring beviljat.

## GDPR-beslut

Applicant-fältet i permits_v2 får BARA innehålla organisationer: AB, BRF, HB, KB, kommun, region, stiftelse, förening. Privatperson = null, alltid. Dubbelfilter: prompt-instruktion + kodfilter med bolagsmarkörer. Aldrig visa privatpersoners namn i UI, API eller export.

## Saker som provats och inte fungerade

- **Google-scraping för discovery:** Google blockerade. Ersatt av Anthropic web search tool.
- **Playwright som default för extraction:** 12x långsammare än HTTP-fetch. Bytte till HTTP-default med Playwright som fallback.
- **Batch API för daglig extraction:** Kräver asynkron arkitektur, försenar data. Parkerat — daglig kostnad redan låg nog.
- **Applicant-backfill:** 0.17% hit rate. Enrichment via diariesystem är rätt väg.
