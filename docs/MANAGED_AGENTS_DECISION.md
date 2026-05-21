# Beslut: Managed Agents för Floede Engine (2026-05-21)

## Fråga
Ska delar av Discovery Pipeline ersättas av eller inspireras av
Anthropics Managed Agents (memory, dreaming, outcomes, multi-agent
orchestration)?

## Beslutskriterium
Tillförlitlig data, snabbt och billigt, hög kvalitet. Inget annat.

## BESLUT: Adoptera inte produkten. Stjäl en idé. Fixa resten själva.

Av motorns tre största svagheter (se ENGINE_ARCHITECTURE_SNAPSHOT.md)
är två triviala egna fixar utan koppling till Managed Agents. Den
tredje matchar Dreaming men egenbygget vinner ändå.

### Svaghet 1 — Blind självläkning
Roten är inte arkitektonisk: permits_inserted är hårdkodad nolla på
qc.js:232, och inget läser fältet. Fix: skriv faktisk insert-count,
läs i checkZeroStreak. ~35-55 rader, två filer. Managed Agents
tillför inget.

### Svaghet 2 — Ingen avvikelse-övervakning
70% redan byggt. checkActiveZeroToday gör nästan rätt kontroll,
triggerRediscovery finns. Fix: sänk tröskel, koppla till rediscovery,
lägg discovery i daily cron med kostnadstak + cooldown. ~50 rader.
Managed Agents tillför inget.

### Svaghet 3 — Inget cross-source-lärande
Enda äkta matchet mot Dreaming. Varje ny källa börjar från steg 1.
Egenbygge: discovered_patterns-tabell i Supabase + skriv/läs-vägar
i utils/discovery.js, ~250-400 rader, eftermiddag schema + 2-3 dagar
+ ~vecka prod-trim. Löser ~80% av värdet.

### Varför egenbygge vinner på svaghet 3
- Kostnadsmodellen krockar: Managed Agents är Claude-only +
  $0.08/session-timme. Motorns ekonomi bygger på motsatsen
  (HTTP före Playwright, Haiku före Sonnet, $0 på hash-skip).
  Managed Agents abstraherar bort modell-routingen (ByggSignal=Haiku,
  CI-pressroom=Sonnet, annualreport=Opus).
- Du äger redan infra (Supabase, hashing, adapter-config). Dreaming
  kräver att flytta hela loopen till deras sandbox.

### Vad vi gör med Dreaming
Stjäl arkitekturidén (schemalagd process som läser körningar, slår
ihop dubbletter, lyfter mönster, skriver granskningsbar store). Bygg
som eget schemalagt Railway-jobb mot discovered_patterns. 80% av
värdet, behåller loop-kontroll och modell-routing, $0 container-tid.

### Outcomes och multi-agent orchestration — avfärdade
- Outcomes: vår QC ska förbli deterministisk SQL-verifiering, inte
  LLM-grader. För precisionsdriven datatjänst är deterministisk
  verifiering bättre.
- Multi-agent orchestration: skulle lösa parallellitet men priset är
  att flytta loopen till deras infra. Race-fixen ger oss kontrollen
  istället.

## Arbetsplan (prioritetsordning)
1. Race-bugg-fix (egen session, plan mode) — HÖGST
2. Svaghet 1 (permits_inserted, ~35-55 rader)
3. Svaghet 2 (avvikelse-övervakning i cron, ~50 rader)
4. Svaghet 3 (cross-source-lärande, Dreaming-inspirerat egenbygge,
   ~3-4 dagar)

Steg 1-3 < en arbetsvecka, löser de två svagheter som blöder data
idag. Steg 4 gör motorn smartare över tid — bygge, inte köp.
