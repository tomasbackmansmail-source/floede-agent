# floede-agent — Kontext för ny chatt

## Nuläge
Måndag 25 maj 2026. Två motorfixar KLARA OCH BEVISADE I PROD idag:
- **Steg 1 (race-bugg):** Akademiska Hus extraherar nu via browser och avbryter rent (0 inserted / 2 skipped, inga falsk-positiva, ingen tyst förlust). 21 maj gav samma källa tyst 0. Commits b4a0f21/8354576/ccf10df, 271/271 test.
- **Steg 2 (permits_inserted):** migration sql/004 applicerad (permits_inserted nullable + UNIQUE-constraint på vertical,municipality,run_date promotad från befintligt index), ärlig count bevisad. Manuell körning: Stockholm 217 extraherade→8 inserted, Malmö 16→2, Göteborg 0→0 i qc_runs.permits_inserted (tidigare hårdkodad 0 på 14194 rader). Tri-state verifierad: Göteborg ärligt 0, inte NULL. Commits 096cca6/3a89522/0baf2b5/7c155c1, 276/276 test.

Tre nya buggar upptäckta idag (prioriterade i Aktiva uppgifter + Kritiska motorbuggar): PRIO 1 notify-trigger failar på BÅDE CI och ByggSignal (kund-påverkande, Chair6-bevakningsmail kan vara trasigt), PRIO 2 steg 3 avvikelse-övervakning (har nu ärlig signal), PRIO 3 Stockholm subsidiary-källor kraschar på undefined URL.

Torsdag 21 maj 2026. CI financial_report-rullout deployad i 5 steg (1→3→5→2→4). Vasakronan + SFV levererar nu rapport-data i prod; Akademiska Hus var blockerad av den nu fixade race-buggen. Steg 4 stängt som DELVIS LEVERERAT — 3 av 4 pilot-orgs (Stockholms stad skippad enligt plan).

Managed Agents-utvärdering klar (se docs/MANAGED_AGENTS_DECISION.md). Beslut: adoptera inte, stjäl Dreaming-idén, fixa resten själva. Eget bygge prioriterat i 4-stegs arbetsplan, race-bugg först.

Tre status-block:

1. **CI pressroom-feed redo för Fredrik-aktivering.** 4 av 5 pilotorgs producerar dagligen, Trafikverket onboardad idag med 77+ signaler från första körning. Forward-fix för source_excerpt verifierad. Filter mot uthyrning + kvartalsrapporter aktivt (Vasakronan-mönstret).

2. **ByggSignal stabiliseringsplan från 27 april kvarstår.** Hälsodashboard byggd. qc.js permits_inserted nu fixad + verifierad (25 maj) — counten är ärlig, men rediscovery-wiringen från signalen är steg 3 (ej gjord). 20 storkommuner tysta sedan 5 april. Kommunnamn-mismatch (Region Gotland/Gotland/gotland) ej fixat.

3. **Datakontrakt §1.4 brytpunktsdatum är etablerat arbetssätt.** TED-fix 15 maj + pressroom-fix 18 maj båda forward-only utan backfill av legacy.

Cron 04:00 UTC = 06:00 CEST. Senaste deploy 7eaa3c98 aktiv. Tidigare deploys 7246397a + f9e97dd8 misslyckades — klassificerade som transient infrastructure issues.

## Nästa konkreta steg
**PRIO 1 — notify-trigger-fix i egen Engine-session.** Notify-triggern failar på BÅDE CI och ByggSignal: `Notify trigger failed (non-fatal): Unexpected token '<', <!DOCTYPE...` — endpointen svarar HTML istället för JSON. Kund-påverkande: ByggSignals bevakningsmail till Chair6 (betalande beta) kan vara trasigt. Första uppgift: verifiera om mail faktiskt går ut, hitta varför endpointen ger HTML (fel URL / route / auth-redirect), åtgärda. Högst prio just för kundpåverkan.

## CI-koordinering (status)
- Webhook + cron_events: inte påbörjat
- Stockholm KF-POC: inte påbörjat
- Nästa: bygg webhook först, KF-POC efter

## Aktiva uppgifter

**Arbetsplan från Managed Agents-beslut (prioritetsordning):**
1. ~~Race-bugg-fix i daily-run.js~~ — KLAR + VERIFIERAD I PROD 2026-05-25 (commits b4a0f21/8354576/ccf10df). Akademiska Hus extraherar via browser och avbryter rent (0 inserted/2 skipped, inga falsk-positiva). 271/271 test.
2. ~~permits_inserted-fix~~ — KLAR + VERIFIERAD I PROD 2026-05-25 (commits 096cca6/3a89522/0baf2b5/7c155c1). sql/004 applicerad (nullable + UNIQUE promotad). Stockholm 217→8, Malmö 16→2, Göteborg ärligt 0 (ej NULL) i qc_runs.permits_inserted. 276/276 test.
3. **Avvikelse-övervakning (NÄST PÅ TUR — har nu ärlig signal från steg 2).** Sänk checkActiveZeroToday-tröskel, koppla till triggerRediscovery med kostnadstak + cooldown. ~50 rader. Konkret testfall: Göteborg (0 bytes via browser, tyst sedan mars) — rediscovery är mekanismen för just sådana.
4. Cross-source-lärande (discovered_patterns-tabell + skriv/läs i utils/discovery.js, Dreaming-inspirerat egenbygge). ~3-4 dagar.

**Nya buggar upptäckta 2026-05-25 (prioritetsordning, ej åtgärdade):**
1. PRIO 1 — Notify-trigger failar på BÅDE CI och ByggSignal: `Unexpected token '<', <!DOCTYPE...` (endpoint svarar HTML, inte JSON). Risk: Chair6-bevakningsmail (betalande beta) kan vara trasigt. Verifiera om mail går ut. Kund-påverkande = högst prio. Egen Engine-session (se Nästa konkreta steg).
2. PRIO 2 — Steg 3 avvikelse-övervakning (se arbetsplan ovan).
3. PRIO 3 — Stockholms stad: tre subsidiary-källor (SISAB/Stockholmshem/Micasa) kraschar `page.goto: url: expected string, got undefined` — configs har undefined URL. Blockerar inte pilot men förlorar data.

**Parkerat spår (eget, efter prio 1-3):**
- Subagent-utvärdering: source-researcher/config-builder/qa-verifier i .claude/agents är 6 veckor gamla — oklart om de fungerar mot dagens motorarkitektur. floede-incident-diagnosis-skill är manuell = invokas inte. Förslag: code-reviewer-subagent med GDPR/å-ä-ö/schema-verifiering inkodat (hade fångat migrations-typfelen som nådde prod idag — name[]=text[] + unnest(int2vector)). Utvärdera och testa innan något byggs.

**Övriga öppna spår:**
- Akademiska Hus project_page Playwright-timeout (akademiskahus.se svarar inte under 30s) — separat utredning behövs.
- Akademiska Hus annual_report: race-buggen som blockerade (0 rader) är fixad 2026-05-24. Verifiera att rader nu produceras efter nästa daily-run. Selector + keywords fungerar.
- Trafikverket TED buyer-ID verifiera mot ted.europa.eu UI för att säkerställa täckning av alla TRV-upphandlingar.
- Regleringsbrev-PDF för Trafikverket (annual_report) onboardas — researchad, ej tillagd ännu.
- Subsidiary-bolag under Stockholms stad (Stockholmshem, SISAB): se docs/BACKLOG.md.
- Bygg src/rediscover-batch.js (wrapper för batch-discovery)
- Kör re-discovery på 20 tysta kommuner (lista i Senaste besluten 2026-04-27)
- Verifiera resultat med Q3 i docs/health-queries.md
- ~~Fixa qc.js permits_inserted~~ — KLAR 2026-05-25 (rotorsak: hårdkodad 0; nu läses run-loggen). Full self-healing väntar dock på steg 3-wiring (avvikelse → rediscovery); tills dess krävs manuell re-discovery för tysta kommuner.
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
- 2026-05-25: Steg 1 race-bugg verifierad i prod. Akademiska Hus extraherar via browser, avbryter rent (0 inserted/2 skipped, inga falsk-positiva, ingen tyst förlust). 21 maj gav tyst 0. Commits b4a0f21/8354576/ccf10df, 271/271 test.
- 2026-05-25: Steg 2 permits_inserted verifierad i prod. Migration sql/004 applicerad (permits_inserted nullable + UNIQUE-constraint på vertical,municipality,run_date promotad från befintligt index — inget dubblett-index). Manuell körning: Stockholm 217→8, Malmö 16→2, Göteborg 0→0. Tri-state bevisad: Göteborg ärligt 0, inte NULL. qc.js läser run-loggen för ärlig count. Commits 096cca6/3a89522/0baf2b5/7c155c1, 276/276 test.
- 2026-05-25: Tre nya buggar prioriterade. PRIO 1 notify-trigger ger HTML ej JSON på CI+ByggSignal (kund-påverkande, Chair6-mail). PRIO 2 steg 3 avvikelse-övervakning (näst på tur). PRIO 3 Stockholm subsidiary undefined URL. Parkerat: subagent-utvärdering + ev. code-reviewer-subagent med GDPR/å-ä-ö/schema-checks.
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

### Notify-trigger failar (CI + ByggSignal) — PRIO 1, upptäckt 2026-05-25
**Status**: känd, ej fixad. Kund-påverkande.
**Symptom**: `Notify trigger failed (non-fatal): Unexpected token '<', <!DOCTYPE...` på BÅDE CI och ByggSignal. Endpointen (NOTIFY_URL / motsv.) svarar HTML istället för JSON — sannolikt fel URL, route eller auth-redirect till en inloggningssida.
**Risk**: ByggSignals bevakningsmail till Chair6 (betalande beta) kan vara trasigt. Felet är fångat som non-fatal i daily-run, så batchen påverkas inte — men notifieringen kan tyst utebli.
**Nästa steg**: verifiera om mail faktiskt går ut, spåra varför endpointen ger HTML, åtgärda. Egen Engine-session.

### Stockholms stad subsidiary-källor kraschar på undefined URL — PRIO 3, upptäckt 2026-05-25
**Status**: känd, ej fixad. Blockerar inte pilot, men förlorar data.
**Symptom**: tre subsidiary-källor (SISAB/Stockholmshem/Micasa) kraschar `page.goto: url: expected string, got undefined` — configrader har undefined listing_url. Relaterat till backlog-raden om subsidiary-bolag (docs/BACKLOG.md).

### Race-bugg i timeout-mekaniken (daily-run.js) — FIXAD + VERIFIERAD I PROD 2026-05-25
**Status**: FIXAD (commits b4a0f21 utbrytning + 8354576 abort-mekanik + ccf10df docs), deployad. Verifierad i prod 2026-05-25: Akademiska Hus extraherar via browser och avbryter rent (0 inserted / 2 skipped, inga falsk-positiva inserts, ingen tyst förlust). 21 maj gav samma källa tyst 0.

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
- qc.js permits_inserted är ärlig sedan 25 maj, men self-healing-loopen agerar inte automatiskt förrän steg 3 (avvikelse → rediscovery) är wirat. Manuell re-discovery krävs för tysta kommuner tills dess.
- Railway auto-deploy från GitHub är opålitlig. Alla deploys via railway up --service floede-agent.
- Deploy-fönster: undvik 03:00-05:00 UTC (cron kör 04:00 UTC = 06:00 CEST).
- CTO-chattar kan inte klona git repos. All kodläsning via filer Tomas klistrar in.

## Kontext-tips till Claude
- Klockan: använd bash `date -u` + TZ-date. Antag aldrig.
- Tomas kör SQL i Supabase och klistrar resultat. Skriv kodboxar tydligt, en i taget.
- CC-prompter slutar alltid med git add -A && git commit -m "..." && git push
- En CC-instans per repo. CC får aldrig skriva kod till ett repo den inte är briefad för.
