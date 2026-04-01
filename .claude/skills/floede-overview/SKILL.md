# Floede AB — Oversikt

Floede AB omvandlar fragmenterad offentlig data till strukturerade dataströmmar och säljer dem som nischade dataprodukter.

## Tre lager

**Lager 1 — Floede Engine (IP:t).** Autonom motor: Discovery, Extraction, Normalization, QC, Scheduler, Feedback-loop. En kodbas, noll vertikal-specifik logik. Ny vertikal = ny config-fil, inte ny motor. Repo: floede-agent.

**Lager 2 — Enrichment.** Officiell statistik, register, öppna dataset. Kopplas på när det höjer kundvärdet. Första implementation: diariesystem-lookup för att hitta sökande via diarienummer.

**Lager 3 — Vertikala produkter.** Nischade dataprodukter byggda ovanpå motorn. Separata repos, separata Supabase-projekt.

## Bolagsstruktur

Floede AB äger motorn. Varje vertikal kan vara eget bolag eller produktlinje under Floede. IP:t i motorn ligger alltid i Floede.

## Vertikaler

- **ByggSignal** (byggsignal.se) — Svensk bygglovsdata som lead-intelligens och anbudshjälp för byggfirmor. Beta, ej lanserad.
- **Search & Compliance / S&C** (searchandcompliance.com) — Regulatorisk compliance för livsmedel/kosttillskott. Nordic Point (Danmark) är potentiell första kund/kanal. Under utveckling.
- **Client Intelligence / CI** — Bevakningsdashboard för byggentreprenörer (Skanska-segment). Signaler sorterade efter mognad, inte tid. Tidig prototyp.

## Status (mars 2026)

Motor godkänd: bred täckning av svenska kommuner, daily-run stabil, feedback-loop bevisad, 177 tester, config-driven. CI bevisad som andra vertikal — motorn körde CI-extraction utan motorkodändring. Agent-runner.js live i produktion på Railway (shell-jobb + QC). Stack konsoliderad: GitHub, Railway, Supabase, Stripe, Resend, Cloudflare DNS. Vercel helt avvecklat.

## Arbetsflöde

Tre lager av exekvering:
1. **Chattar (claude.ai)** — CEO, CTO, UX. Strategi, beslut, formulerar uppgifter. Tomas alltid aktiv.
2. **CC med subagenter (terminalen)** — Tomas startar, subagenter gör jobbet. Aktiv tid: starta + granska.
3. **Agent SDK (agent-runner.js)** — Körs utan Tomas. Rapport i mailen. Aktiv tid: 0.

Progressionen: nya uppgiftstyper börjar i lager 2. När mönstret fungerar pålitligt flyttas de till lager 3.

## Detaljer

Läs reference/ för positionering, kunder, priser, roadmap och lärdomar.
