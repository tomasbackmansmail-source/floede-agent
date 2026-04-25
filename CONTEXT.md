# floede-agent — Kontext for ny chatt

## Nulage
Empty-HTML-incident 2026-04-25: 60 kommuner gav 0 arenden i 6 dagar pga tom HTML hashades och respekterades trots overifierad config. Fyra fixar deployade i commit 81393cb: 500-byte-troskel i extractPermits, hash-check kraver verified===true, hash-skip-raknare i rapport/mail, weekday active-muni-larm i QC. Vantar pa Tomas SQL-cleanup av gamla null-hashes (~42 rader) och Goteborg-manual-verifiering. Motorns subpage-refaktor fortsatt live sedan 2026-04-22. CI-leverans (source_excerpt + ai_summary) committad och deployad. ByggSignal bug 2 (21 kommuner med NULL-falt) oppen, Fas 0-research klar men bygg ej paborjad.

## Aktiva uppgifter
- ByggSignal source_url null for Stockholm + Norrtalje: 80+56 rader senaste veckan. Debug-loggning ej deployad. Vantar pa beslut om vidare diagnostik vs annan prio.
- ByggSignal bug 2 (21 kommuner med NULL date/property/applicant): oppen, riktningsbeslut ej taget. Fas 0 klar.
- 114 kommuner saknas i municipality_platforms. Klassificeringsscript finns i src/utils/discovery.js, ej kort an for dessa.
- HTTP HEAD-optimering for snabbare cron: identifierat som potentiell forbattring (62 min shell-tid for 291 kommuner med hashing aktivt). Inte prioriterat.

## Pilotkundstatus
- Chair6 (ByggSignal beta): live, inga kanda problem rapporterade. NULL-falt-buggen ar oppen men har inte triggat klagomal an.
- Fredrik Johansson (Skanska, CI pilot): vantar fortfarande pa motor + dashboard verifierade. CTO CI verifierar TYP A/B-utfall efter cron 25 apr 06:01.

## Senaste besluten (nyaste overst)
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
Om Tomas inte sager nagot annat: vanta pa CTO CI:s rapport efter cron 25 apr 06:01 (Stockholmshem + SISAB forsta skarpa test av TYP A/B). Om gront: hjalp CTO CI vidare med Opus-prompt for analyze-signals. Om tunt eller inkonsekvent: analysera output med CTO CI.

Parallellt oppet: ByggSignal source_url-bug for Stockholm + Norrtalje vantar pa beslut om diagnostik. Bug 2-riktningsbeslut vantar.

## Kontext-tips till Claude
- Klockan: anvand bash `date -u` + TZ-date. Antag aldrig.
- Tomas kor SQL i Supabase och klistrar resultat. Skriv kodboxar tydligt, en i taget.
- CC-prompter slutar alltid med git add -A && git commit -m "..." && git push
- En CC-instans per repo. CC far aldrig skriva kod till ett repo den inte ar briefad for.
