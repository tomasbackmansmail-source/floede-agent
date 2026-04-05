# CEO-beslut och research — senast uppdaterat 2026-04-04

## Aktiva beslut

### ByggSignal
- Motor prio 1 tills 250+ kommuner levererar data. Inget annat parallellt för CTO
- Villaägarnas verifierade URL:er (data/villaagarna-komplett.json) är korrekt Fas 0-seed — ersätter agentisk discovery
- Täckningsmått: "configs utan fail" inte "kommuner med ny data idag" — publiceringstakt varierar
- Stripe webhook + plan-fält klart före 30 april (ByggSignal Dev)
- Upphandlingsbevakning: redan researchad mars 2026, parkerad. Marknaden tätt (Mercell, Pabliq, Tendium, offentlig.ai). Direktupphandlingar under 700k publiceras inte

### CI (Client Intelligence)
- Fyra pilotorganisationer: SFV, Vasakronan, Akademiska Hus, Stockholms stad
- Pilotkund: Fredrik Johansson, Skanska PL, Stockholms län, kommersiella projekt
- Löfte till Fredrik: "Dagliga signaler om nyckelkunders byggaktivitet — pressmeddelanden, upphandlingar, bygglov — grupperade per projekt"
- Fredrik-kontakt väntar tills motor + dashboard verifierade
- Profilhantering: manuellt seedad (Alt B), UI byggs när det finns fler användare
- Projektgruppering: Alt B (fastighetsbeteckning exakt + LLM-match). Nattlig batch. Fredrik korrigerar manuellt i framtiden
- TED: filtreras på bygg-CPV i extraction. SFV och Akademiska Hus har volym. Stockholms stad och Vasakronan har inte
- Fastighetskoppling: Vasakronan (157) och Akademiska Hus (71) klara. SFV publicerar inte förteckning — parkerat
- Regionfiltrering/prismodell: diskuteras med Fredrik efter han sett dashboarden, inte före
- Kedja CEO → CTO → CI Dev. Aldrig CEO direkt till Dev

### S&C (Search & Compliance)
- Pausad tills Anders Tengelin (Nordic Point) svarar
- Prismodell beslutad: credits-baserad (10 kr = 1 credit)

## Research redan gjord (kör inte om)
- Upphandling: Mercell, Pabliq, Tendium, offentlig.ai, Procurdo — alla bevakar annonserade upphandlingar. offentlig.ai är aggregator. Direktupphandlingar under 700k ej tillgängliga. Parkerat
- Detaljplaner: Lantmäteriets NGP har 162/290 kommuner som GeoJSON, CC0. Combify enda kommersiella med full täckning. Intressant för CI (tidig signal) men parkerat
- Miljötillstånd: ingen samlad databas, fragmenterat över 21 länsstyrelser
- TED API: anonymt, gratis, strukturerad data. SFV 216 träffar, Akademiska Hus 294. Verifierat och implementerat
- CI signalhierarki: politiskt beslut/remiss (6-24 mån före) → detaljplan (12-18 mån) → pressmeddelande (3-12 mån) → bygglovsansökan (0-3 mån) → TED-upphandling (parallellt)

## Fas 0-princip (obligatorisk)
Sök alltid på internet efter befintliga register och aggregatorer INNAN agentisk discovery eller resonemang. "Ingen gör det här" kräver bevis. Villaägarna/kommunkartan-läxan: 2 sekunders Google slog 4 veckors agentisk discovery
