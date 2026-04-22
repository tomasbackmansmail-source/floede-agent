# floede-agent — Kontext för ny chatt

## Vad den här filen är
Läses vid sessionsstart av claude.ai-chattar. Innehåller allt en ny chatt behöver för att fortsätta utan manuell brief.

## Nuläge
Motorn är i drift och levererar data dagligen via Railway cron 04:00 UTC. Idag 22 april fixades bugg 1 (raw_html_hash propageras nu till permits_v2). Bugg 2 (accordion-expandering för 21 kommuner med NULL date/property/applicant) är inte löst. Föregående chatt fastnade i att cykla mellan lösningsförslag utan Fas 0-research. CEO behöver ta strategiskt beslut om riktning innan kod skrivs.

## Aktiva uppgifter
- Bugg 2 accordion: blockerad, väntar på CEO-beslut om Fas 0-research (kommunkartan.se och andra nationella aggregatorer) ska köras först
- 120 "misstänkt trasiga" kommuner systematisk rediscovery: ej påbörjad, prio 2 efter bugg 2
- Applicant via diariesystem-enrichment: ej påbörjad, prio 3
- Analyze-signals + group-signals flyttas till CI-repot: CTO CI kopierar imorgon torsdag, parallellkörning torsdag, borttagning från motorn fredag

## Pilotkundstatus
Ingen direkt pilotkundskontakt från motorsidan. Motorn betjänar ByggSignal (Chair6 via ByggSignal Dev), CI (Fredrik Johansson på Skanska via CTO CI) och S&C (Nordic Point via CTO S&C).

## Senaste 5 besluten (nyaste överst)
2026-04-22: Bugg 1 och bugg 2 ska fixas i separata commits med separata verifieringar, inte samma commit. Olika riskprofiler kräver olika hantering.
2026-04-22: Analyze-signals.js och group-signals.js flyttas från floede-agent till clientintelligence-repot. Match-properties.js stannar i motorn. Koordinerad flytt över tre dagar med parallellkörning.
2026-04-22: CEO-beslut väntas om strategisk riktning för bugg 2. Fas 0-research på kommunkartan.se och andra nationella aggregatorer ska köras innan click_all eller liknande kod-ändringar övervägs.
2026-04-21: Datakvalitet först, inte nya features. Systematisk rediscovery av 120 misstänkt trasiga kommuner är prio 2.
2026-04-14: analyze-signals.js skapad i floede-agent. Opus-driven AI-analys som korsar årsredovisningar, pressmeddelanden, TED och bygglov.

## Kända knepiga saker just nu
- GitHub auto-deploy till Railway är brutet sedan 5 april. Alla deploys sker via "railway up" CLI. Ej diagnostiserat. Samma risk på clientintelligence-projektet enligt CTO CI.
- Railway vs lokal divergens: samma kod, samma parametrar kan ge olika resultat pga SPA-rendering-timing. Upptäckt 22 april på Helsingborg (lokal får 93 tecken body, Railway får fullständig lista). Kan indikera att nuvarande fetch-logik är skör.
- Helsingborgs anslagstavla är inte en ren bygglovskälla. Blandar bygglov med skadeanmälningar, skolskjuts, andra kommunala anslag. Gäller sannolikt fler av de 21 drabbade kommunerna. Extraction klassificerar icke-bygglov som bygglov.
- Ny svensk lag från 1 december 2025: kommuner ska publicera bygglovskungörelser på digital anslagstavla. Systemleverantörer bygger RESTapp-integrationer just nu. Många kommuner publicerar manuellt övergångsvis. Ej utrett om standardformat eller API finns.
- interactWithPage() i src/utils/discovery.js är designad för "klicka dig fram" max 3 klick, inte för "expandera N listelement på en sida". Infrastrukturen för interaction_recipe finns men 0 av 292 godkända configs använder den.
- CTO CI förväntar sig ping från CTO Engine när CI:s backfill av 3 analys-signaler är verifierad idag. Det är CI:s leverans, bara vänta på deras ping.

## Nästa konkreta steg
Om Tomas inte säger något annat, börja med att fråga om CEO har tagit beslut om strategisk riktning för bugg 2. Föreslå inte lösningar, spekulera inte. Vänta på riktning.

Om CEO säger "kör Fas 0": sök på internet efter kommunkartan.se och andra nationella aggregatorer för svensk bygglovsdata. Verifiera vad de innehåller (fastighetsbeteckning? sökande? timing? täckning?). Rapportera fynd till Tomas innan kod skrivs.

Om CEO säger "kör per-kommun-fix": börja inte med click_all-spekulationen från föregående chatt. Gör egen diagnostik på Helsingborg och 2-3 andra drabbade kommuner först. Verifiera vad som faktiskt behövs innan du rör motorns kod.
