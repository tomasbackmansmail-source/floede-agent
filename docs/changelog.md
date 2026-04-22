# CLAUDE.md changelog

Äldre "Senast uppdaterat"-poster flyttade från CLAUDE.md för att hålla den under 200 rader.

---

## Senast uppdaterat 2026-04-13

### Motor
- PDF-stod i daily-run: content-type detection, base64 document-typ till Messages API
- source_type_filter i loadApprovedConfigs: vertical config kan filtrera ci_sources pa source_type
- HTTP timeout okad till 180s for PDF och stora kallor
- Config-driven QC validation: required_fields, allowed_values, numeric_ranges i vertical config
- loadBaselines() config-driven: source_field och date_field fran qc.validation

### CI
- ci-annualreport.json: ny vertical config for PDF-extraktion av arsredovisningar
- ci-pressroom extraction_prompt: source_url extraheras fran link-falt, source_type satts till "pressroom"
- Forsta PDF-extraktion lyckad: Akademiska Hus Q1 2025, 11 projekt, $0.16

## Senast uppdaterat 2026-04-08

### Motor
- 272/290 kommuner med verifierad data i permits_v2
- Pipeline grön 4 dagar i rad
- interactWithPage() live i discovery — Playwright + LLM navigerar dropdowns och sökfält
- Adaptrar live: Ciceron (14), MeetingPlus (7), NetPublicator (10) — $0 LLM per kommun
- Feedback-loop live: QC 0 ärenden 3 dagar → discoverSource automatiskt
- Namnormalisering: strippar "kommun", "stad", genitiv-s automatiskt
- Content hashing: full LLM vid första körning, $0 vid oförändrat innehåll
- Discovery följer nu externa länkar (NetPublicator, MeetingPlus etc.)
- docs/motor-insikter-april-2026.md: 10 dokumenterade lärdomar från stabiliseringsarbetet

### CI
- 320+ signaler, 228 ci_properties, 13 bygglov-matchningar
- Alla 7 pipeline-steg körs grönt på Railway
- CI kör autonomt för första gången (miljövariabler fixade 2026-04-05)
- Timeout 4h (var 60 min)
- Resend from-adress fixad

### Principer
- Adaptrar före scraping — kolla alltid om plattformen har API
- Fas 0: sök befintliga register/aggregatorer innan agentisk discovery
- Plan Mode obligatoriskt för alla motorändringar: claude --permission-mode plan
- Mät med SQL, inte antaganden
- Läs loggar, inte statusikoner

## Senast uppdaterat 2026-04-05

- Miljövariabler: varje vertikal i agent-runner kräver verifierade env vars i Railway INNAN den anses live. CI saknade credentials i månader utan att någon märkte.
- Railway "succeeded" = process.exit(0), inte att alla steg lyckades. agent-runner fångar fel och exiterar OK. Läs loggarna, inte statusikonen.
- Content hashing sparas bara vid lyckad extraction. Första körningen med nya configs triggar alltid full LLM på alla — förväntat men dyrt. Hashar byggs upp successivt.
- execSync timeout i agent-runner är den enda tidsgränsen — Railway har ingen max-körtid för cron. Satt till 4h (14_400_000 ms) efter att 60 min inte räckte för 292 configs.
- Railway cron: om en körning fortfarande är aktiv när nästa scheduled körning ska starta, skippas den nya. Processen måste avsluta sig själv.
- Railway-körning triggas manuellt via railway.com-dashboarden eller railway run — INTE från CC-session. CC-körning dör när locket stängs.
- Arbetsflödesprincip: Railway = autonomt serverside (motor, cron, nattjobb). CC = interaktivt lokalt (kod, config, felsökning). Blanda inte.

## Senast uppdaterat 2026-04-04

- data/villaagarna-komplett.json: 290 kommuner med verifierade anslagstavle-URL:er, redo att seedas i discovery_configs
- data/villaagarna-fixade-urls.json: 29 kommuner med korrigerade URL:er
- data/villaagarna-validation.json: HTTP health check resultat alla 290 URL:er
- docs/aao-standard.md: ÅÄÖ-normaliseringsstandard, NFC överallt, normalize-funktion 18 rader JS, 290 kommun-domän-mappningar
- docs/fas0-vertikaler.md: research detaljplaner (NGP 162/290, Combify) och miljötillstånd (fragmenterat, ingen aggregator)
- src/validate-villaagarna-urls.js: HTTP health check script, återanvändbart
- Fas 0 formaliserad: sök alltid efter befintliga register/aggregatorer INNAN agentisk discovery
- ByggSignal motorstatus: 148 kommuner med data, 128 failed. Villaägarna-seedning planerad söndag 6 april
- Motorförbättringar live: eskalering vid >20% zero-streak, max_rediscoveries 50/dag, täckningsrapport i daglig mail
- Playwright browser restart var 30:e källa (inte 80)
- Auto-eskalering HTTP→Playwright på zero-permit verified sources
- CI: 320+ signaler, 228 ci_properties, 13 bygglov-matchningar, TED live, projektgruppering live
- CI cron-ordning: daily-run → QC → match-properties → ted-sync → group-signals
- CI cron 06:00 CEST
- ci_user_profiles med Fredriks filter seedad manuellt
- Akademiska Hus fastighetsförteckning 2025 extraherad till ci_properties (71 fastigheter)
- TED API: anonymt, gratis. SFV 216 träffar, Akademiska Hus 294 träffar. Stockholms stad 3, Vasakronan 0
- Parallella CC-sessioner: starta alltid med cd ~/floede-agent i prompten

## Senast uppdaterat 2026-04-03

- Homepage-lookup i QC fixad: case-insensitive + ÅÄÖ-normalisering i homepageMap
- 23 ÅÄÖ-dubbletter raderade från discovery_configs (303 → 282 configs)
- 141 kommuner re-discovered med nya URL:er via tre QC-batchar ($3.09)
- Auto-eskalering HTTP → Playwright i daily-run vid 0 permits från verifierad källa
- Verify extraction kräver >0 items för auto-approve, flaggar needs_browser vid keyword-match
- Discovery-prompt förbättrad: letar efter listade ärenden, inte informationssidor
- QC-alerts visar korrekta ÅÄÖ-namn via displayNameMap
- Playwright browser-restart var 30:e source (var 80:e)
- 7 nya tester för ÅÄÖ-hantering
- Akademiska Hus: 71 fastigheter importerade till ci_properties
- match-properties.js: 13 bygglov-matchningar (228 properties totalt)
- Cron: 04:00 UTC (06:00 CEST) live efter railway up

## Senast uppdaterat 2026-04-02

- Per-källa model override i extractPermits: sourceConfig.model overridar verticalConfig.model
- match-properties.js: matchar ci_properties mot permits_v2, skapar ci_signals, integrerad i agent-runner
- ted-sync.js: hämtar upphandlingar från TED Search API för SFV och Akademiska Hus, integrerad i agent-runner
- ci_projects-tabell skapad, group-signals.js grupperar signaler automatiskt via fastighetsbeteckning + Haiku
- group-signals.js integrerad i agent-runner efter ted-sync
- Daglig körordning: daily-run → QC → match-properties → ted-sync → group-signals
- region i extraction_prompt: "Nationellt" istället för null för nationella signaler
- CI dashboard live med projektgruppering, tidslinjer, source_type-badges
- source_type-fält i ci_signals: pressroom/permit/ted
- region-fält i ci-pressroom.json extraction
- category-fält i ci-pressroom.json: commercial/residential/infrastructure/public/mixed
- ci_user_profiles-tabell skapad, Fredrik Johansson seedad med Stockholms län + exkluderar residential
- extraction_prompt: organization_name hämtas från kontext, inte HTML (koncernfix)
- ci_signals unique constraint: (organization_id, source_url, title)
- ci-pressroom.json: alert_email fixad från @floede.se till tomasbackman@mac.com
- agent-runner.js: from-adress fixad, match-properties + ted-sync tillagda i fallback
- cron ändrad från 13:00 UTC till 04:00 UTC (06:00 CEST)
- VERTICAL-namn i docs: ci -> ci-pressroom
- .claude/agents/: source-researcher, config-builder, qa-verifier
- AGENTS.md skapad
- .claude/skills/floede-overview/: 6 CEO knowledge-filer
- Lokal körning: node --env-file=.env
