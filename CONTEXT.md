# floede-agent — Kontext för ny chatt

## Nuläge
Lördag 24 maj 2026. Race-buggen i timeout-mekaniken FIXAD och deployad (commits b4a0f21 + 8354576) — se Kritiska motorbuggar. Återstår prod-verifiering att Akademiska Hus annual_report nu producerar rader.

Torsdag 21 maj 2026. CI financial_report-rullout deployad i 5 steg (1→3→5→2→4). Vasakronan + SFV levererar nu rapport-data i prod; Akademiska Hus var blockerad av den nu fixade race-buggen i timeout-mekaniken. Steg 4 stängt som DELVIS LEVERERAT — 3 av 4 pilot-orgs (Stockholms stad skippad enligt plan).

Managed Agents-utvärdering klar (se docs/MANAGED_AGENTS_DECISION.md). Beslut: adoptera inte, stjäl Dreaming-idén, fixa resten själva. Eget bygge prioriterat i 4-stegs arbetsplan, race-bugg först.

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

**Arbetsplan från Managed Agents-beslut (prioritetsordning):**
1. ~~Race-bugg-fix i daily-run.js~~ — KLAR 2026-05-24 (commits b4a0f21 + 8354576, deployad). AbortController per källa, signal genom fetch/SDK/supabase, allt-eller-inget med partial-state, taggade loggar, regressionstest. Återstår: prod-verifiering (Akademiska Hus 0 → rader).
2. permits_inserted-fix (qc.js:232 hårdkodad nolla → faktisk insert-count, koppla till checkZeroStreak). ~35-55 rader, två filer.
3. Avvikelse-övervakning i daily cron (sänk checkActiveZeroToday-tröskel, koppla till triggerRediscovery med kostnadstak + cooldown). ~50 rader.
4. Cross-source-lärande (discovered_patterns-tabell + skriv/läs i utils/discovery.js, Dreaming-inspirerat egenbygge). ~3-4 dagar.

**Övriga öppna spår:**
- Akademiska Hus project_page Playwright-timeout (akademiskahus.se svarar inte under 30s) — separat utredning behövs.
- Akademiska Hus annual_report: race-buggen som blockerade (0 rader) är fixad 2026-05-24. Verifiera att rader nu produceras efter nästa daily-run. Selector + keywords fungerar.
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
- 2026-05-21: Managed Agents-utvärdering klar. Beslut: bygg eget, stjäl Dreaming-idén, race-fix först. Tre svagheter kartlagda i docs/ENGINE_ARCHITECTURE_SNAPSHOT.md; två är triviala egna fixar utan Managed Agents-koppling (permits_inserted hårdkodad nolla, avvikelse-övervakning 70% redan byggt), tredje matchar Dreaming men egenbygge vinner pga kostnadsmodellkrock ($0.08/session-h vs vår HTTP/Haiku/hash-skip-ekonomi) och förlust av modell-routing. Outcomes avfärdat (vill ha deterministisk SQL-QC), multi-agent orchestration avfärdat (race-fix ger kontrollen istället). Beslutsdokument: docs/MANAGED_AGENTS_DECISION.md.
- 2026-05-21: CI financial_report-rullout deployad i 5 commits (3d0c0c7 → 37d0d67). Generic titel-klassificerare lyfter source_type från pressroom → financial_report (12 kinds). parent_signal_id-länkning forward + retro (95 befintliga annual_report-rader redo för retro-koppling när första financial_report skapas). Conditional validation: maturity tillåts vara null för financial_report. report_dedup på (org+date+document_kind). PDF-subpage-stöd via allow_pdf_subpages + filterByKeywords matchar nu text+href. Live LLM-test 3/3 grön $0.02. Prod-verifiering 21 maj: Vasakronan delårsrapport + 14 projekt-rader (5 forward-linked), SFV 103 annual_report-rader. Akademiska Hus blockerad av race-bugg.
- 2026-05-21: Race-bugg i daily-run.js:945-1054 + 1095 identifierad och bevisad. Promise.race utan abort-signal orsakar tyst dataförlust + falsk-positiva inserts + logg-cross-contamination. Markerad som KÄNT KRITISKT PROBLEM, fix tas i egen session.
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

## Kritiska motorbuggar (vertikal-agnostiska)

### Race-bugg i timeout-mekaniken (daily-run.js) — FIXAD 2026-05-24
**Status**: FIXAD i två commits (b4a0f21 utbrytning + 8354576 abort-mekanik), deployad. Återstår: prod-verifiering att Akademiska Hus annual_report nu producerar rader (Q1/Q2-baslinje, körs efter nästa daily-run).

**Rotorsak (historik)**: `Promise.race([innerWork, timeoutPromise])` saknade abort-signal. När timeout-promisen vann kastade JS error från race, men inner async-funktionen fortsatte köra i bakgrunden — JS stoppar inte oresolverade promises.

**Tre konsekvenser bevisade i prod (CI körning 2026-05-21 04:15 UTC)**:
1. Tyst dataförlust: Akademiska Hus extraherade 5 PDF:er via Opus (~$8), inner promise dog mitt under extractPermits-loop, `insertToSupabase` kördes aldrig, 0 rader.
2. Falsk-positiva inserts efter timeout: SFV markerades Failed men 103 rader hamnade ändå i DB ~11 min efter timeout (tidsstämplar 04:26:31-37).
3. Logg-cross-contamination: SFV:s "Permits: 114" / "DB: 103 inserted" loggades under `--- Akademiska Hus ---`.

**Vad fixet gör**:
- `runWithTimeout(timeoutMs, fn)` (exporterad): AbortController per källa, timern ABORTAR signalen istället för att race:a; timern clearas alltid.
- Signal genom kedjan: fetch (`requestSignal` = källsignal + per-request `AbortSignal.timeout` via `AbortSignal.any`, manuell fallback < Node 20.3), Anthropic SDK (`messages.create(params,{signal})`), Supabase (`.abortSignal`). `withRetry` har avbrytbar backoff (`abortableSleep`).
- Allt-eller-inget: checkpoint omedelbart före insert (enda DB-muterande steget) + checkpoint överst i insertToSupabase record-loopen. Abort mitt i insert → status `partial`, INGEN rollback — idempotent upsert/dedup kompletterar nästa körning.
- `processHttpSource`/`processBrowserSource` exporterade modulnivå-funktioner som returnerar resultatobjekt (ingen sen closure-mutation); `applyResult` i main() applicerar på synkron retur-väg.
- Loggtaggar per källa (`taggedLog` → `[muniName]`) genom fetch/extract/insert.
- Regressionstest: test/daily-run-timeout.test.js (5 tester, kärn-assertion: ingen insert efter abort). npm test 271/271.

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
