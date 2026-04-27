# floede-agent — Kontext for ny chatt

## Nuläge
Söndag 26 april 2026. ci-projectpage source_excerpt + ai_summary fixade (42eca91, 7af38a6). Verifieringskörning gav 12 inserts men avslöjade ny bug: 12/12 organization_name=NULL. Pause på alla nya motorändringar — kartläggning av 19 öppna motor-trådar visade flera parkerade buggar sedan 18 mars. ByggSignal-cron 26 april gav 11 permits/7 kommuner (söndag = låg volym, förväntat). Måndag 27 april = första riktiga test efter hash-incident-fix (commit 81393cb).

Datakontrakt v0.1: Lager 1 (motorgarantier) i floede-agent/docs/data-contract-engine.md, ägs av CTO Engine. Lager 2 (produktkvalitet per vertikal) i respektive vertikal-repo. ByggSignal Lager 2 incheckad i byggsignal/docs/data-contract-byggsignal.md (commit d3b2567). CI Lager 2 = v0.2 (CTO CI informerad). S&C Lager 2 = v0.3 (CTO S&C informerad).

Princip etablerad: motorn reflekterar källans faktiska rytm. Brytpunktsdatum framför backfill. Tröskelvärden är affärsbeslut (Lager 2), inte tekniska invarianter (Lager 1).

## Aktiva uppgifter
- Enrichment-design för organization_name på project_page (CTO CI väntar). Inte kodändring förrän design är klar och avstämd med CTO CI som äger ci_sources-schemat.
- 19 öppna motor-trådar kartlagda 26 april. Lista i nästa CTO Engine-chatt.
- Verifiera ByggSignal-cron 27 april 06:00 CEST. Första riktiga test efter hash-incident-fix (commit 81393cb 25 april).
- source_quality_daily-tabellen ska byggas. Schema designas mot Lager 2 ByggSignal sektion 2.2 trösklar. CTO ByggSignal pingar när första 7 dagars data finns. Inte påbörjat.
- Hash-incident verifiering: cron 26 apr 06:00 CEST ar forsta test. Forvantat: ~42 kommuner producerar igen.
- Stockholm/Norrtalje source_url null: rotorsak var MeetingPlus-adaptern (inte filterByKeywords som tidigare antogs). Fixad i 1e72d56, deployad. Nya rader fran cron 26 apr ska ha source_url satt — verifiera 07:30.
- Hälsodashboard ej byggd. Första uppgift för nästa Engine CTO. 3-4 SQL-frågor i docs/health-queries.md som varje session börjar med. Bevisar motorns aktuella hälsa innan vi pratar buggar.
- Enrichment-pipeline för applicant/property/description ej byggd. Scopad i docs/enrichment-scope.md (8 april), $65 budget godkänd. Verklig flaskhals för datakvalitet.
- 5 totalt trasiga kommuner (Nassjo, Ystad, Mellerud, Dals-Ed, Vansbro): kvar ooppnat. Lag prio.
- BACKFILL 6916 null source_url-rader (16 mar - 22 apr, 232 kommuner). Separat projekt. Kraver per-kommun strategi: kommuner med case_number kan matchas mot kalla, kommuner utan kraver omhamtning. Inte paborjat. Ska prioriteras innan volymtrafik.
- HTTP/Playwright source_url-lacka kvar (~5 rader/dag). Sitevision (Tranas, Ange), WordPress (Staffanstorp), Episerver (Danderyd). Rotorsak okand — sourceUrl-argument kommer in null till extractPermits fran fetchPageHttp/fetchPagePlaywright. Diagnos ej paborjad.
- Angebug i MeetingPlus: case_number=null pa alla 6 permits trots att Beslut om bygglov-typen har Description med "Diarienummer:". Parsing-regex traffar inte. Lag prio, separat fix.

## Pilotkundstatus
- Chair6 (ByggSignal beta): live, inga klagomål rapporterade. Hash-incident kan ha påverkat täckning för 42 kommuner i 6 dagar (22-25 april) — inte rapporterat av Chair6. Verifiera vid nästa avstämning.
- Fredrik Johansson (Skanska, CI pilot): vantar fortfarande. CI Lager 2 = v0.2 efter forankring med CTO CI.

## Senaste besluten (nyaste overst)
- 2026-04-27: Property-bugg avfärdad. Stickprov mot Kävlinge visade att 82 NULL-property-rader är historisk skada från 29 mars-händelse, inte aktiv bug. Färska rader efter 11 april har property korrekt. Lärdom: SQL som aggregerar 30 dagar blandar historisk skada med aktuellt beteende. Alltid tidsfiltrera vid bug-diagnos.
- 2026-04-27: applicant=NULL bekräftad som källans natur, inte bug. Verifierat via Lerum + tidigare research mars-april. Diariesystem-enrichment är lösningen, inte motorfix.
- 2026-04-27: Sju misstag identifierade i dagens session — alla samma rotorsak: valde tempo över noggrannhet. Disciplin skriven in i CLAUDE.md som permanent regel.
- 2026-04-27: Cron 06:00 CEST verifierad grön. 107 permits / 4 kommuner (måndag morgon, normal volym jämfört med 13 apr 10/5 och 20 apr 3/2). Source_url-fix håller (107/107). Hash-incident-fix verifierad.
- 2026-04-26: ci-projectpage source_excerpt + ai_summary fixade i field_mapping (42eca91) och extraction_prompt (7af38a6). max_subpages höjt 15→100 för 4 project_page-källor i ci_sources. Akademiska Hus rad 2 (78e2d1a6) fullkonfigurerad. Verifieringskörning gav 12 inserts, 12/12 source_excerpt populerat, 3/12 ai_summary, men 12/12 organization_name=NULL (ny bug).
- 2026-04-26: Pause på alla nya motorändringar. Sökning i historiken visade att flera buggar parkerats utan fix sedan 18 mars-24 april. Behov av enrichment-design för organization_name (CTO CI flaggade detta 18 april — parkerades). Kartläggning av öppna trådar pågår.
- 2026-04-25: MeetingPlus + NetPublicator-adaptrar fixade. Bada satte explicit source_url=null. Commit 1e72d56 deployad pa Railway, verifierad live (Ange: source_url byggs som baseUrl/digital-bulletin-board/announcements/{id}). Tacker ~88% av nya null-rader efter 22 apr.
- 2026-04-25: Datakontrakt v0.1 last. Tvalagermodell: Lager 1 motorgarantier (CTO Engine), Lager 2 produktkvalitet per vertikal (CEO + vertikal-CTO). Princip: motorn reflekterar kallans faktiska rytm, brytpunktsdatum framfor backfill.
- 2026-04-25: Hash-incident lost. 60 kommuner med 0 arenden i 6 dagar pga (a) tom HTML hashades och laste kalla, (b) daily-run respekterade hash aven for overifierade configs. Fix i commit 81393cb. 42 ByggSignal + 2 CI configs rensade i Supabase.
- 2026-04-25: Cron-tid korrigerad i kod och docs. Tidigare felaktigt "13:00 UTC" i CLAUDE.md och "14:00 CET" i daily-run.js — verklig tid ar 04:00 UTC = 06:00 CEST / 05:00 CET. Commit abbf76f.
- 2026-04-25: Empty-HTML-troskel 500 bytes i extractPermits — returnerar content_too_small, ingen hash, ingen LLM. Forhindrar att tom HTML hashas och las kallan permanent. (commit 81393cb)
- 2026-04-25: Daily-run respekterar hash bara om config.verified === true. Overifierade configs kors alltid. Galler subpage- och adapter-grenarna (Ciceron, MeetingPlus, NetPublicator). (commit 81393cb)
- 2026-04-25: Hash-skip-raknare i daily-run-rapport och Resend-mail. Synlighet for hur manga kallor som skippades via hash. (commit 81393cb)
- 2026-04-25: QC vardagslarm — om mon-fre och fler an 30 aktiva kommuner (>=5 permits senaste 30d) har 0 idag, skickas direktlarm via Resend. Behaller 3-dagarsregeln parallellt. (commit 81393cb)
- 2026-04-24: Motorn satter source_type fran config, inte LLM. Default via verticalConfig.default_source_type. Override per kalla via discovery_configs.config.source_type_override. Ci-pressroom default = "pressroom". (commit d58e937)
- 2026-04-24: ci-pressroom extraction_prompt hanterar TYP A (artikel/pressmeddelande) och TYP B (lista/upphandling/arenden) i samma prompt. Stramad delprojekt-regel: separat signal endast om eget namn + egen plats + minst ett eget varde. (commit d58e937)
- 2026-04-24: GitHub auto-deploy triggade inte for d58e937. Manuell railway up kravdes. Bekraftar att auto-deploy ar opalitlig.
- 2026-04-22: En LLM-anrop per subpage istallet for konkatenering. Deterministisk source_url, per-record raw_html_hash. Commit 4f4baff.
- 2026-04-22: Dedup av subpage-URL:er innan extraction. Cision listar artiklar tva ganger (bild + rubrik). Commit 1512e8e.
- 2026-04-22: ci-pressroom.json utokad med source_excerpt (full artikeltext, max 10000 tecken) och ai_summary (3-5 meningar, analytisk ton, max 500 tecken). Ingen retroaktiv backfill av gamla signaler.
- 2026-04-22: analyze-signals.js ligger redan i clientintelligence-repot sedan 14 april. Ingen flytt fran motorn behovs.
- 2026-04-22: Cron-tidsregel: alltid UTC med svensk tid som kommentar, CEST/CET explicit.

## Fas 0-research ByggSignal bug 2
- Geoplan.se (Inquisit AB): direkt konkurrent, 60-70k bygglov/ar, partneravtal Lantmateriet, B2B-forsaljning, samma malgrupp.
- Ny PBL 1 dec 2025: alla kommuner publicerar bygglovskungorelser pa digital anslagstavla (ej PoIT).
- Soleil (Sitevision Platinum Partner): RESTapp for Sitevision-kungorelser — potentiell adapter-kalla.
- Cision Web Solutions: publikt JSON/XML-feed — Cision-adapter skulle ge $0 LLM for SFV, Vasakronan, Trafikverket m.fl.
- Kommunkartan.se: sparrar oss vid scraping, bekraftat.

## Kanda knepiga saker just nu
- Railway auto-deploy fran GitHub ar opalitlig. Alla deploys sker via railway up --service floede-agent.
- Deploy-fonster: undvik 03:00-05:00 UTC (cron kor 04:00 UTC = 06:00 CEST).
- raw_html_hash-format andrat: gamla rader har aggregat-hash, nya har per-subpage-hash. Ingen kodvag laser faltet for jamforelse (bara skrivning), sa ingen regression. Men i framtida dedup-logik: vet att format skilde sig fore/efter 2026-04-22.
- Config.subpage_hashes ersatter config.content_hash. Forsta cron efter deploy blir dyrare (alla subpages bearbetas som om de var nya). Gammal content_hash ignoreras helt.
- CTO-chattar kan inte klona git repos — de hanger varje gang. All kodlasning sker via filer Tomas klistrar in eller laddar upp.
- Tidigare CONTEXT.md havdade Stockholm/Norrtalje source_url null = "filterByKeywords matchar inte lanktext". Det var fel diagnos. Verklig orsak var MeetingPlus-adaptern som returnerade source_url=null. Nu fixad.
- Söndagar och röda dagar = låg publiceringsvolym i kommuner. 11 permits/7 kommuner på söndag är förväntat, inte motorbug. Måndag är första riktiga test efter helgen.
- ASCII-svenska i alla vertikalconfigs (byggsignal.json, ci-pressroom.json, ci-projectpage.json) bryter mot CLAUDE.md regel om åäö. Bekräftat 26 april. Separat städprojekt, inte akut.

## Nästa konkreta steg
1. Bygg hälsodashboard. 3-4 SQL-frågor som svarar på: producerar motorn idag, är aktuell datakvalitet ok, finns aktiva extraktionsbuggar, vad är historisk skada vs aktivt fel.
2. Kör hälsodashboard. Då vet vi vad som faktiskt behöver fixas.
3. Om dashboard visar att motorn är stabil: starta enrichment-design.
4. Om dashboard hittar aktiva buggar: prioritera dessa.

## Kontext-tips till Claude
- Klockan: anvand bash `date -u` + TZ-date. Antag aldrig.
- Tomas kor SQL i Supabase och klistrar resultat. Skriv kodboxar tydligt, en i taget.
- CC-prompter slutar alltid med git add -A && git commit -m "..." && git push
- En CC-instans per repo. CC far aldrig skriva kod till ett repo den inte ar briefad for.
