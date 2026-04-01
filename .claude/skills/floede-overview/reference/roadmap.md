# Floede — Roadmap och status

OBS: Ingen vertikal är lanserad med betalande kunder. Alla features, planer och funktionsindelningar nedan är under utveckling och kan ändras. Behandla som nuläge och riktning, inte som specifikation.

## Motor (floede-agent)

### Klart
- Config-driven pipeline: Discovery, Extraction, QC, Feedback-loop
- Bred täckning av svenska kommuner, daily-run stabil
- Cheap steps (URL-varianter, crawl, sitemap) löser majoriteten av kommuner, Haiku och Sonnet eskaleras vid behov
- Verify extraction: bekräftar att config producerar data innan approve
- Feedback-loop: QC detekterar zero-streak och triggar re-discovery automatiskt
- Homepage auto-resolve för kommuner utan homepage i DB
- 177 tester, alla gröna
- Daily extraction: Railway cron 14:00 CET, driftkostnad ~$2/dag
- Config-separation: extraction-prompt, QC-trösklar, keywords, enums — allt i vertikal-config
- Vertikalagnostisk bevisad: CI körde utan motorkodändring
- Per-vertikal Supabase-credentials (supabase_url + supabase_key_env i config)
- CLI-flagga --source= (bakåtkompatibelt med --municipality=)
- Generiska loggmeddelanden (sources/records istället för municipalities/permits)
- source_url sätts på alla extraherade records
- Agent-runner.js live i produktion: shell-jobb + QC, Railway cron 13:00 UTC, Resend-sammanfattning
- Kodstädning: gamla ByggSignal-specifika scripts borttagna

### Under bygge
- Enrichment-pipeline via diariesystem (diarienummer -> sökande). Budget godkänd: $65. Nattlig batch 01:00 CET.
- Agent SDK steg 2: AI-resonemang för research/debug-tasks i agent-runner.js
- Subagent-arbetsflöde: source-researcher, config-builder, qa-verifier som CC-subagenter. Beprövning innan Agent SDK-migrering.

### Parkerat
- Pattern Library som körbar kod — designad men ej implementerad
- Batch API för Sonnet — onödigt efter keyword-fix
- Europaexpansion — december 2026
- Motortabeller (agent_tasks, discovery_configs, qc_runs) till eget Supabase-projekt

## ByggSignal

### Klart
- Sajt live på byggsignal.se (Railway + Cloudflare DNS)
- Magic link auth, onboarding (bransch + kommun)
- Tre datatyper: bygglov, upphandlingar, insikter
- Bevakningsmail dagligen via Resend
- Offertförfrågan-knapp på kommersiella kort
- Sparade leads, kontosida, CSV-export
- Beta öppen: alla inloggade = Pro t.o.m. 30 april
- Analyssida med grafer och län-filter
- Täckningssida med kommunlista

### Akut (före 30 april)
- Stripe webhook-signering (constructEvent utkommenterad)
- plan-fältet uppdateras inte vid betalning (dolt av beta-override)

### Under bygge
- Anbudsprofil: profilformulär halvvägs. Saknas: F-skatt, försäkring, certifieringar, utgångsdatum, beredskapsgrad.
- Kontaktuppgifter: enrichment via diariesystem under bygge (motorprojekt).
- Kommersiell flaggning: identifiera industri/flerbostadshus/kontor/hotell-ärenden i UI.
- ÅÄÖ-rotorsak: resolveHomepage läcker normaliserade namn till discovery_configs

### Parkerat
- Flyers (fas 3) — kräver fysiskt utskick, inte prioriterat
- Enrichment via Lantmäteriet ägardata — kräver licensansökan och juridisk prövning
- Upphandlingsdata från KommersAnnons/e-Avrop — frysta pga Antirio punkt 3.3

## S&C / Nordic Point

### Klart
- Sajt live på searchandcompliance.com (Railway)
- EFSA-data importerad (2 357 claims)
- Compliance-prompt verifierad 18/18 mot riktiga produkter
- White-label-demo visad för Anders
- Supabase-projekt separat

### Under bygge
- Testa datakällor: EFSA, Livsmedelsverket, Fødevarestyrelsen, BfR
- Credits-system (Stripe-koppling)
- Väntar på Anders feedback: dokumenttyper, marknader, outputformat

### Parkerat
- Tredjepartsövervakning (scrapa retailsajter) — fas 3
- Förpacknings-OCR — fas 2

## Client Intelligence

### Klart
- Supabase-schema: ci_organizations, ci_sources, ci_signals, ci_user_watchlists, ci_starred, profiles
- Produktspec v1 med mognadstrappan (RYKTAS/PLANERAS/UPPHANDLAS/TILLDELAT)
- Motor bevisad: VERTICAL=ci körde utan motorkodändring
- Pilotorganisationer seedade i Supabase
- CI Supabase service key roterad

### Under bygge
- Frontend-dashboard (clientintelligence repo, ej skapat än)
- QC-validering för CI (maturity-fält)
- Fler källor per organisation

### Parkerat
- Regeringen.se, TED EU, TendSign — fas 2-4
- ByggSignal-korsreferens via fastighetsägarkoppling — kräver Lantmäteriet-data
- ci_projects-tabell (signal-sammankoppling) — fas 2

## Arbetsflöde — tre lager

**Lager 1: Chattar (claude.ai).** CEO, CTO, UX — strategi, beslut, formulerar uppgifter. Tomas alltid aktiv.

**Lager 2: CC med subagenter (terminalen).** Tomas startar CC, subagenter (.claude/agents/) gör jobbet i egna kontextfönster. Tre roller: source-researcher (hitta/utvärdera källor), config-builder (bygga/testa configs), qa-verifier (verifiera datakvalitet). Tomas aktiv tid: starta + granska resultat.

**Lager 3: Agent SDK (agent-runner.js).** Körs utan Tomas via Railway cron. Rapport via Resend. Idag: shell-jobb (daily-run, QC). Nästa steg: AI-resonemang för research/debug-tasks. Uppgiftstyper flyttas hit när de fungerat pålitligt i lager 2.

## Beroenden mellan vertikaler

- Alla tre vertikaler delar motorn (floede-agent). En motorförbättring gynnar alla.
- CI och ByggSignal kan korsreferera via fastighetsägare (Lantmäteriet) — framtida feature.
- S&C:s datainsamling kör genom motorn med egen config.
- S&C:s compliance-analys (LLM-pipeline) sitter i produktlagret, inte i motorn.

## Tidshorisonter

- Mars 2026: Motor godkänd, CI bevisad, S&C validerad, stack konsoliderad
- April 2026: Beta-testare ByggSignal, enrichment-pipeline, anbudsprofil, Stripe-fix
- Q2 2026: Första betalande kunder (alla tre vertikaler)
- December 2026: Europaexpansion (Norge, Finland, Tyskland som mål)
