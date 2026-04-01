# Floede — Kunder och validering

OBS: Ingen vertikal har betalande kunder. Alla tre vertikaler är under utveckling. Feedbacken nedan är från pilotsamtal och beta-testning, inte från betalande kunder. Produkter, funktioner och priser kan ändras.

## ByggSignal

### Kundsegment
Primärt: små till medelstora byggfirmor, solinstallatörer, kök/badrumskedjor, säkerhetsföretag, trädgårdsanläggare. Sekundärt: mid-size construction firms. Gemensamt: de har en egen säljkanal men saknar lead-data.

### Mårten (Chair6) — första beta-användare
Mårtens firma: 3 anställda, Stockholms län. Tomas kompis. Testade produkten 20 mars 2026.

**Vad han sa:**
- Privata bygglov (villor) ger honom inget utan fysiskt utskick (flyer). Han kan inte ringa en villaägare och säga "jag såg att du fick bygglov." Flyers är parkerade (fas 3).
- Kommersiella bygglov (företag, BRF) ger värde OM han får kontaktuppgifter till byggherren. Utan kontaktuppgift är det bara information, inte en lead.
- Upphandlingar — det är där pengarna är. Men han har ALDRIG lämnat anbud. "Det känns krångligt, vet inte hur det går till."
- Han säger att alla små byggfirmor känner likadant om upphandlingar.

**Insikt:** Anbudsprofilen ("Du är 80% redo. Saknas: försäkringsbevis.") kan vara hela produktens kärna, inte en premium-feature. Att ta Mårten från noll anbud till ett anbud i månaden förändrar hans intäktsmöjligheter konkret.

**Kontaktdata-problemet:** Applicant-fältet är extremt glest i permits_v2. Kommunernas anslagstavlor publicerar sällan sökandens namn. Lösning under bygge: enrichment via diariesystem (diarienummer -> sökande, offentlig handling).

### Kundbehov vs antaganden
Floede antog att bygglov som lead-signal var produkten. Mårten visade att det stämmer för kommersiella bygglov med kontaktuppgifter, men att upphandlingar med anbudshjälp är det verkliga värdet för hans segment.

## Client Intelligence

### Fredrik (Skanska)
Projektledare på Skanska, ansvarig för Operan-renoveringen. Personlig kontakt med Tomas.

**Vad han sa ordagrant:** "Det här är fan bra. Att scanna öppna källor hos kund. LOU upphandlingar hos TendSign mm. Jag tror detta skulle passa oss på Skanska."

**Insikt:** "Oss på Skanska" — inte "mig." Det är enterprise. 20-30 användare per kundföretag, 3-7 bevakade organisationer per användare.

### Segment
Projektledare och KAM:ar på Skanska, JM, Peab, NCC, Veidekke. Problemet: kunden har publicerat något offentligt (pressrelease, upphandling, regeringsbeslut) och PL:n vet inte om det. Han framstår som oförberedd. CI löser det.

### Köpsignal
Fredrik bad Tomas personligen om en dashboard. Pilot med Skanska utan betalning i första fasen.

## Search & Compliance

### Anders Tengelin — Nordic Point Distribution
Nordic Point (Kolding, Danmark) driver DaaS-modell (Distribution as a Service) för internationella FMCG-varumärken som vill in i nordisk dagligvaruhandel. Jobbar med Normal, Coop, Netto, Føtex, Dagrofa. N!CK'S som referenskund. Anders bakgrund: ex-P&G, Urtekram, Weleda. Compliance-officer: Lise Larsen.

**Köpsignal:** Anders såg en skiss av S&C-tjänsten och frågade "Jaha, vad ska du ha för det här då?" — direkt köpfråga utan att Tomas pitchade pris.

**Vad Nordic Point behöver:**
1. Förpacknings-compliance (OCR + regler) — högst risk, högst värde. Fel kostar nytryck + återkallelse.
2. Sajt-text-compliance (prototyp klar) — input: produkttext, output: flaggor + optimerad text per marknad.
3. Tredjepartsövervakning — scrapa retailsajter (normal.dk, coop.dk), jämför mot godkänd text, flagga avvikelser.

**Affärsmodell:** White-label. Nordic Points verktyg, Floedes motor bakom. Nordic Points kunder ser aldrig Floede. Floede tar betalt av Nordic Point per check eller per månad.

### Köpsignal 2
Anders vill starta ett AB och fokusera S&C mot retail. Det är starkare än att bara vilja köpa en tjänst — han vill bygga ett bolag runt den.

## Sammanfattning av valideringar
Tre vertikaler, tre oberoende valideringar:
- Mårten vill vara med och driva ByggSignal.
- Fredrik bad personligen om en dashboard och sa att det passar Skanska.
- Anders vill starta bolag kring S&C.

Kundvalideringen är gjord. Blockeraren är teknik, inte marknad.
