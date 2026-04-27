# Hälsodashboard — Floede Engine

> Varje session som CTO Engine börjar här. Kör Q1-Q5 i Supabase SQL Editor
> mot ByggSignal-projektet. Tolka resultaten innan du resonerar om buggar.
> Q1-Q5 mäter motorns produktion mot permits_v2 (sanning), inte qc_runs
> (trasigt sedan minst 29 mars — permits_inserted=0 på alla körningar).

## Var queries körs
Supabase SQL Editor, ByggSignal-projektet:
https://supabase.com/dashboard/project/abnlmxkgdkyyvbagewgf/sql/new

## Q1 — Producerar motorn idag?

Senaste 24h vs samma veckodag senaste 4 veckorna. Exkluderar
hash-incident-fönstret 22-25 april för ren baseline.

```sql
WITH today AS (
  SELECT 
    COUNT(*) AS permits_24h,
    COUNT(DISTINCT municipality) AS kommuner_24h
  FROM permits_v2
  WHERE created_at > NOW() - INTERVAL '24 hours'
),
baseline AS (
  SELECT 
    DATE(created_at) AS dag,
    COUNT(*) AS permits,
    COUNT(DISTINCT municipality) AS kommuner
  FROM permits_v2
  WHERE created_at > NOW() - INTERVAL '35 days'
    AND created_at < NOW() - INTERVAL '24 hours'
    AND DATE(created_at) NOT BETWEEN '2026-04-22' AND '2026-04-25'
    AND EXTRACT(DOW FROM created_at) = EXTRACT(DOW FROM NOW())
  GROUP BY DATE(created_at)
)
SELECT 
  (SELECT permits_24h FROM today) AS permits_idag,
  (SELECT kommuner_24h FROM today) AS kommuner_idag,
  ROUND(AVG(permits)::numeric, 1) AS permits_baseline_samma_veckodag,
  ROUND(AVG(kommuner)::numeric, 1) AS kommuner_baseline_samma_veckodag,
  COUNT(*) AS antal_jamforelsedagar,
  CASE 
    WHEN COUNT(*) = 0 THEN 'INGEN BASELINE'
    WHEN (SELECT permits_24h FROM today) >= AVG(permits) * 0.5 THEN 'GRON'
    WHEN (SELECT permits_24h FROM today) >= AVG(permits) * 0.2 THEN 'GUL'
    ELSE 'ROD'
  END AS status
FROM baseline;
```

Tolkning: GRÖN = motorn producerar normalt. RÖD = mindre än 20% av baseline.
Notera att hög produktion idag inte fångar tysta kommuner — använd Q3 för det.

## Q2 — Datakvalitet i färska rader

NULL-andelar i rader skapade efter 2026-04-25 (hash-incident-fix +
adapter-fix). Bevisar att aktuell extraktion fungerar.

```sql
SELECT 
  COUNT(*) AS total_rader,
  ROUND(100.0 * COUNT(*) FILTER (WHERE source_url IS NULL) / COUNT(*), 1) AS pct_null_source_url,
  ROUND(100.0 * COUNT(*) FILTER (WHERE case_number IS NULL) / COUNT(*), 1) AS pct_null_case_number,
  ROUND(100.0 * COUNT(*) FILTER (WHERE address IS NULL) / COUNT(*), 1) AS pct_null_address,
  ROUND(100.0 * COUNT(*) FILTER (WHERE applicant IS NULL) / COUNT(*), 1) AS pct_null_applicant,
  ROUND(100.0 * COUNT(*) FILTER (WHERE property IS NULL) / COUNT(*), 1) AS pct_null_property,
  ROUND(100.0 * COUNT(*) FILTER (WHERE description IS NULL) / COUNT(*), 1) AS pct_null_description,
  ROUND(100.0 * COUNT(*) FILTER (WHERE permit_type IS NULL) / COUNT(*), 1) AS pct_null_permit_type,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status IS NULL) / COUNT(*), 1) AS pct_null_status,
  ROUND(100.0 * COUNT(*) FILTER (WHERE date IS NULL) / COUNT(*), 1) AS pct_null_date
FROM permits_v2
WHERE created_at > '2026-04-25';
```

Förväntade nivåer:
- applicant ~99% NULL (källans natur, GDPR)
- case_number 40-50% NULL (många kommuner publicerar utan diarienummer)
- source_url <10% NULL (bör vara nära 0 — ~5/dag läcker från Sitevision/WordPress/Episerver)
- address varierar med kommun-mix (vissa kommuner publicerar 100% utan adress)
- description, permit_type, property, date <15% NULL

## Q3 — Aktiva extraktionsbuggar (tysta kommuner)

Kommuner som producerade historiskt men har tappat produktion.
Listar de som producerar mindre än 50% av historiskt snitt senaste 7 dagarna.

```sql
WITH historisk AS (
  SELECT 
    municipality,
    COUNT(*) / 8.0 AS snitt_per_vecka_innan
  FROM permits_v2
  WHERE created_at BETWEEN NOW() - INTERVAL '90 days' AND NOW() - INTERVAL '30 days'
    AND DATE(created_at) NOT BETWEEN '2026-04-22' AND '2026-04-25'
  GROUP BY municipality
  HAVING COUNT(*) >= 10
),
senaste_7d AS (
  SELECT 
    municipality,
    COUNT(*) AS permits_7d
  FROM permits_v2
  WHERE created_at > NOW() - INTERVAL '7 days'
  GROUP BY municipality
)
SELECT 
  h.municipality,
  ROUND(h.snitt_per_vecka_innan::numeric, 1) AS historiskt_snitt_vecka,
  COALESCE(s.permits_7d, 0) AS senaste_7d,
  ROUND(100.0 * COALESCE(s.permits_7d, 0) / h.snitt_per_vecka_innan, 0) AS pct_av_normalt
FROM historisk h
LEFT JOIN senaste_7d s ON h.municipality = s.municipality
WHERE COALESCE(s.permits_7d, 0) < h.snitt_per_vecka_innan * 0.5
ORDER BY h.snitt_per_vecka_innan DESC
LIMIT 20;
```

Tolkning: Innan du resonerar om buggar, kolla discovery_configs för dessa
kommuner. verified=false + verify_result_count=0 = config behöver re-discovery,
inte kodfix. Self-healing-loopen är beroende av qc.js som är trasigt — manuell
re-discovery krävs tills qc.js är fixat.

## Q4 — Historisk skada vs aktivt fel

Jämför NULL-andelar före vs efter 2026-04-25. Bevisar att gamla rader
har skador som är fixade i nya rader.

```sql
SELECT 
  CASE 
    WHEN created_at <= '2026-04-25' THEN '1_fore_fix'
    ELSE '2_efter_fix'
  END AS period,
  COUNT(*) AS rader,
  ROUND(100.0 * COUNT(*) FILTER (WHERE source_url IS NULL) / COUNT(*), 1) AS pct_null_source_url,
  ROUND(100.0 * COUNT(*) FILTER (WHERE address IS NULL) / COUNT(*), 1) AS pct_null_address,
  ROUND(100.0 * COUNT(*) FILTER (WHERE property IS NULL) / COUNT(*), 1) AS pct_null_property,
  ROUND(100.0 * COUNT(*) FILTER (WHERE applicant IS NULL) / COUNT(*), 1) AS pct_null_applicant,
  ROUND(100.0 * COUNT(*) FILTER (WHERE case_number IS NULL) / COUNT(*), 1) AS pct_null_case_number,
  ROUND(100.0 * COUNT(*) FILTER (WHERE date IS NULL) / COUNT(*), 1) AS pct_null_date
FROM permits_v2
WHERE created_at > NOW() - INTERVAL '60 days'
GROUP BY period
ORDER BY period;
```

Tolkning: Försämring efter fix kan bero på (a) ny regression eller (b) skifte
i vilka kommuner som producerar. Kontrollera per kommun innan slutsats.

## Q5 — Kommunnamn-konsistens

Hittar kommuner som finns under flera namnvarianter (Region Gotland/Gotland-mönster).

```sql
WITH normaliserat AS (
  SELECT 
    municipality,
    LOWER(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(municipality, '^Region\s+', '', 'i'),
          '\s+kommun$', '', 'i'
        ),
        '\s+stad$', '', 'i'
      )
    ) AS normaliserad,
    COUNT(*) AS rader
  FROM permits_v2
  GROUP BY municipality
)
SELECT 
  normaliserad,
  STRING_AGG(municipality, ' | ' ORDER BY rader DESC) AS namnvarianter,
  COUNT(*) AS antal_varianter,
  SUM(rader) AS totalt_antal_rader
FROM normaliserat
GROUP BY normaliserad
HAVING COUNT(*) > 1
ORDER BY totalt_antal_rader DESC
LIMIT 20;
```

Tolkning: Antal_varianter > 1 betyder samma kommun under olika namn.
Påverkar Q3 och alla framtida queries baserade på municipality-fältet.

## Diagnos-disciplin (från CLAUDE.md)

1. Kör Q1-Q5 INNAN du resonerar om buggar
2. Tidsfiltrera all bug-diagnos (created_at > [senaste fix-datum])
3. Stanna mellan SQL-resultat och slutsats — fakta, möjliga förklaringar, vad krävs för att avgöra
4. Sök chatthistorik före resonemang
5. Aldrig gissa konfigurationsvärden eller schema
