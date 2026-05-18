# floede-agent — Kontext för ny chatt

## Nuläge
Måndag 18 maj 2026. CI-pressroom-diagnos klar och åtgärdad. Engine producerar 2026-05 = 0% NULL excerpt på alla pilot-orgs (bevisat). Trafikverket onboardad som femte pilot-org. Deploy-drift (23 dagar gammal image från 25 april) upptäckt och fixad via tredje deploy-försök (7eaa3c98).

Tre status-block:

1. **CI pressroom-feed redo för Fredrik-aktivering.** 4 av 5 pilotorgs producerar dagligen, Trafikverket onboardad idag med 77+ signaler från första körning. Forward-fix för source_excerpt verifierad. Filter mot uthyrning + kvartalsrapporter aktivt (Vasakronan-mönstret).

2. **ByggSignal stabiliseringsplan från 27 april kvarstår.** Hälsodashboard byggd. qc.js fortfarande trasigt sedan minst 29 mars. 20 storkommuner tysta sedan 5 april. Kommunnamn-mismatch (Region Gotland/Gotland/gotland) ej fixat. Self-healing-loopen blind tills qc.js är fixat.

3. **Datakontrakt §1.4 brytpunktsdatum är etablerat arbetssätt.** TED-fix 15 maj + pressroom-fix 18 maj båda forward-only utan backfill av legacy.

Cron 04:00 UTC = 06:00 CEST. Senaste deploy 7eaa3c98 aktiv. Tidigare deploys 7246397a + f9e97dd8 misslyckades — klassificerade som transient infrastructure issues.

## Nästa konkreta steg (morgon 28 april)
**Första uppgift: bygg src/rediscover-batch.js** — wrapper som tar lista av kommuner och kör discover på alla. 20 kommuner är för många för manuella anrop, och vi kommer behöva detta varje gång self-healing misslyckas tills qc.js är fixat.

Sedan: kör batch på de 20 tysta kommunerna. Verifiera resultat med Q3 i hälsodashboarden. Det validerar både fixet och dashboarden.

## CI-koordinering (status)
- Webhook + cron_events: inte påbörjat
- Stockholm KF-POC: inte påbörjat
- Nästa: bygg webhook först, KF-POC efter

## Aktiva uppgifter
- Akademiska Hus project_page Playwright-timeout (akademiskahus.se svarar inte under 30s) — separat utredning behövs.
- Trafikverket TED buyer-ID verifiera mot ted.europa.eu UI för att säkerställa täckning av alla TRV-upphandlingar.
- Regleringsbrev-PDF för Trafikverket (annual_report) onboardas — researchad, ej tillagd ännu.
- Subsidiary-bolag under Stockholms stad (Stockholmshem, SISAB): se docs/BACKLOG.md.
- Bygg src/rediscover-batch.js (wrapper för batch-discovery)
- Kör re-discovery på 20 tysta kommuner (lista i Senaste besluten 2026-04-27)
- Verifiera resultat med Q3 i docs/health-queries.md
- Fixa qc.js — permits_inserted skrivs inte korrekt. Rotorsak okänd. Tills detta är fixat är self-healing-loopen blind och manuell re-discovery krävs.
- Kommunnamn-normalisering: Region Gotland / Gotland / gotland → ett namn. Påverkar 203 rader i permits_v2 + 12 i qc_runs + alla framtida queries.
- Address-NULL för Region Gotland, Västerås, Gävle, Sundsvall (100% NULL): inte motorbug, källans natur. Kandidat för enrichment via property + Lantmäteriet.
- Source_url ~5/dag NULL från Sitevision/WordPress/Episerver. Diagnos ej påbörjad.
- Backfill 6916 null source_url-rader (16 mar - 22 apr, 232 kommuner). Separat projekt.
- 5 totalt trasiga kommuner (Nässjö, Ystad, Mellerud, Dals-Ed, Vansbro): kvar oöppnat.
- Ångebug i MeetingPlus: case_number=null på alla 6 permits. Parsing-regex träffar inte.
- Enrichment-pipeline för applicant/property/description: scopad i docs/enrichment-scope.md (8 april), $65 budget godkänd, ej påbörjad. Verklig flaskhals för datakvalitet.

## Pilotkundstatus
- Chair6 (ByggSignal beta): live, inga klagomål. 20 tysta storkommuner kan ha påverkat — verifiera vid nästa avstämning.
- Fredrik Johansson (Skanska, CI pilot): väntar fortfarande. CI Lager 2 = v0.2 efter förankring med CTO CI.

## Senaste besluten (nyaste överst)
- 2026-05-18: Pressroom-fix klar. ci-pressroom.json extraktion utökad med uthyrnings- + Q-rapport-filter (Vasakronan-mönster, dummy-test 3/3 grön). 195 legacy NULL_excerpt-rader får leva enligt §1.4 brytpunktsdatum. Backlog-rad om subsidiary-bolag (Stockholmshem/SISAB) skapad.
- 2026-05-18: ci-projectpage.json prompt-fix + backfill (16 UPDATE + 25 DELETE dubletter). Trafikverket onboardad (org-rad + 2 ci_sources). TED-fix deployad till prod efter 23 dagars deploy-drift. Engine produktionsklar för CI-pilot.
- 2026-04-27 (kväll): Hälsodashboard byggd. Q1-Q5 i docs/health-queries.md, bevisad mot live-data. Mäter mot permits_v2 (sanning), inte qc_runs (trasigt).
- 2026-04-27 (kväll): qc.js identifierat som trasigt sedan minst 29 mars. permits_inserted=0 på alla 13000+ körningar. Inte dagens fix.
- 2026-04-27 (kväll): 20 stora kommuner identifierade som tysta sedan 5 april-verifiering. Lista: Göteborg, Norrköping, Uppsala, Luleå, Jönköping, Linköping, Östersund, Karlstad, Karlskrona, Landskrona, Falun, Kalmar, Skellefteå, Sotenäs, Lidköping, Eskilstuna, Vellinge, Lysekil, Nacka, Lund. Configs har verified=false + verify_result_count=0. Manuell re-discovery krävs imorgon.
- 2026-04-27 (kväll): Kommunnamn-mismatch upptäckt: Region Gotland / Gotland / gotland samma kommun under tre namn. Ska normaliseras.
- 2026-04-27 (kväll): Address-NULL 30%→63% efter fix förklarad: kommun-mix, inte regression. Region Gotland, Västerås, Gävle, Sundsvall publicerar 100% utan adress.
- 2026-04-27: Property-bugg avfärdad. Färska rader efter 11 april har property korrekt. Lärdom: alltid tidsfiltrera vid bug-diagnos.
- 2026-04-27: applicant=NULL bekräftad som källans natur, inte bug. Diariesystem-enrichment är lösningen.
- 2026-04-27: Cron 06:00 CEST verifierad grön. 107 permits / 4 kommuner. Source_url-fix håller (107/107).
- 2026-04-25: Hash-incident löst. Empty-HTML-tröskel + verified-config-krav (commit 81393cb).
- 2026-04-25: Datakontrakt v0.1 läst. Tvålagermodell godkänd.
- 2026-04-25: MeetingPlus + NetPublicator-adaptrar fixade (commit 1e72d56).

## Kända knepiga saker just nu
- qc_runs är inte tillförlitlig signal. Använd permits_v2 direkt för all hälsoanalys. docs/health-queries.md gör detta.
- Kommunnamn-mismatch (Region Gotland/Gotland/gotland) påverkar alla queries baserade på municipality. Var medveten tills normalisering är gjord.
- Self-healing-loopen är blind tills qc.js är fixat. Manuell re-discovery krävs för tysta kommuner.
- Railway auto-deploy från GitHub är opålitlig. Alla deploys via railway up --service floede-agent.
- Deploy-fönster: undvik 03:00-05:00 UTC (cron kör 04:00 UTC = 06:00 CEST).
- CTO-chattar kan inte klona git repos. All kodläsning via filer Tomas klistrar in.

## Kontext-tips till Claude
- Klockan: använd bash `date -u` + TZ-date. Antag aldrig.
- Tomas kör SQL i Supabase och klistrar resultat. Skriv kodboxar tydligt, en i taget.
- CC-prompter slutar alltid med git add -A && git commit -m "..." && git push
- En CC-instans per repo. CC får aldrig skriva kod till ett repo den inte är briefad för.
