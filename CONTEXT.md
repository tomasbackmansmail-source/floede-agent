# floede-agent — Kontext for ny chatt

## Nulage
Motorns subpage-refaktor live i produktion sedan 2026-04-22. Deterministisk source_url per subpage verifierad mot Vasakronan Cision (0 bas-URL-signaler av 8, tidigare 6/6). CI-leverans (source_excerpt + ai_summary i ci-pressroom.json) committad och deployad. ByggSignal bug 2 (21 kommuner med NULL-falt) oppen, Fas 0-research klar men bygg ej paborjad.

## Aktiva uppgifter
- ByggSignal bug 2: 21 kommuner med NULL date/property/applicant. Fas 0 klar, bygg ej paborjad. Vantar pa riktningsbeslut.
- Applicant-enrichment via diariesystem: prio 3, $65 budget godkand.
- 120 kommuner med misstankt trasig data (Goteborg, Uppsala, Lulea m.fl.): prio 2 efter bugg 2.

## Pilotkundstatus
- Chair6 (ByggSignal beta): live, inga kanda problem.
- Fredrik Johansson (Skanska, CI pilot): vantar pa att motor + dashboard ar fullt verifierade innan kontakt.

## Senaste besluten (nyaste overst)
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
- Deploy-fonster: undvik 13:00-15:00 UTC.
- raw_html_hash-format andrat: gamla rader har aggregat-hash, nya har per-subpage-hash. Ingen kodvag laser faltet for jamforelse (bara skrivning), sa ingen regression. Men i framtida dedup-logik: vet att format skilde sig fore/efter 2026-04-22.
- Config.subpage_hashes ersatter config.content_hash. Forsta cron efter deploy blir dyrare (alla subpages bearbetas som om de var nya). Gammal content_hash ignoreras helt.
- CTO-chattar kan inte klona git repos — de hanger varje gang. All kodlasning sker via filer Tomas klistrar in eller laddar upp.

## Nasta konkreta steg
Om Tomas inte sager nagot annat, borja med att ga igenom ByggSignal bug 2. Fas 0 ar klar (se ovan). Naste steg ar att valja riktning: (a) utreda Sitevision/Soleil-RESTapp for standardiserad endpoint, (b) bygga per-kommun-recept for de 21, eller (c) bygga Cision-adapter forst (stor gemensam vinst for CI ocksa).

## Kontext-tips till Claude
- Klockan: anvand bash `date -u` + TZ-date. Antag aldrig.
- Tomas kor SQL i Supabase och klistrar resultat. Skriv kodboxar tydligt, en i taget.
- CC-prompter slutar alltid med git add -A && git commit -m "..." && git push
- En CC-instans per repo. CC far aldrig skriva kod till ett repo den inte ar briefad for.
