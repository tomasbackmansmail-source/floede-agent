# floede-agent — Kontext for ny chatt

## Nulage
Empty-HTML-incident 2026-04-25: 60 kommuner gav 0 arenden i 6 dagar pga tom HTML hashades och respekterades trots overifierad config. Fyra fixar deployade i commit 81393cb: 500-byte-troskel i extractPermits, hash-check kraver verified===true, hash-skip-raknare i rapport/mail, weekday active-muni-larm i QC. 42 ByggSignal + 2 CI configs rensade i Supabase. Forsta verifieringsfonster ar cron 26 apr 06:00 CEST.

Datakontrakt v0.1 etablerat 2026-04-25: Lager 1 (motorgarantier) i docs/data-contract-engine.md ags av CTO Engine. Lager 2 (produktkvalitet per vertikal) i respektive vertikal-repo. ByggSignal Lager 2 incheckad i byggsignal/docs/data-contract-byggsignal.md (commit d3b2567). CI Lager 2 = v0.2, S&C Lager 2 = v0.3.

Motorns subpage-refaktor fortsatt live sedan 2026-04-22. CI-leverans (source_excerpt + ai_summary) committad och deployad. ByggSignal bug 2 (21 kommuner med NULL-falt) oppen, Fas 0-research klar men bygg ej paborjad.

## Aktiva uppgifter
- source_quality_daily-tabellen ska byggas. Schema definieras nar trosklarna i Lager 2 ByggSignal sektion 2.2 ska tillampas. Inte paborjat.
- Hash-incident verifiering: cron 26 apr 06:00 CEST ar forsta test. Forvantat: ~42 kommuner producerar igen.
- Stockholm/Norrtalje source_url null: kvar ooppnat. Identifierad rotorsak (subpage-traversal failar pga filterByKeywords matchar inte lanktext). Fix planerad efter helgen.
- Bug 2 (21 kommuner NULL date/property/applicant): kvar ooppnat. Inte 21 specifika kommuner utan minst tre olika buggar enligt dagens matning.
- 5 totalt trasiga kommuner (Nassjo, Ystad, Mellerud, Dals-Ed, Vansbro): kvar ooppnat. Lag prio.

## Pilotkundstatus
- Chair6 (ByggSignal beta): live, inga klagomal. Hash-incident kan ha paverkat tackning for 42 kommuner i 6 dagar — inte rapporterat av Chair6 men teoretiskt mojligt.
- Fredrik Johansson (Skanska, CI pilot): vantar fortfarande. CI Lager 2 = v0.2 efter forankring med CTO CI.

## Senaste besluten (nyaste overst)
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

## Nasta konkreta steg
Om Tomas inte sager nagot annat: vanta pa cron 26 apr 06:00 CEST resultat. Om hash-incident-fixen fungerar: ~42 kommuner producerar igen. Pinga CTO ByggSignal. Sen borja diskussion om source_quality_daily-tabellen och timing for Stockholm/Norrtalje fix.

## Kontext-tips till Claude
- Klockan: anvand bash `date -u` + TZ-date. Antag aldrig.
- Tomas kor SQL i Supabase och klistrar resultat. Skriv kodboxar tydligt, en i taget.
- CC-prompter slutar alltid med git add -A && git commit -m "..." && git push
- En CC-instans per repo. CC far aldrig skriva kod till ett repo den inte ar briefad for.
