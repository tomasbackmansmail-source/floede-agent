-- 004: qc_runs — gör permits_inserted tri-state och ge upserten en verklig unik-backning.
--
-- Bakgrund:
--  * permits_inserted var NOT NULL DEFAULT 0 och hårdkodades till 0 av qc.js (dött fält).
--    Vi behöver tri-state: N (körde, sparade N), 0 (körde, sparade inget), NULL (körde inte
--    idag / okänt). Därför DROP DEFAULT + DROP NOT NULL.
--  * qc.js upsertar med onConflict (vertical, municipality, run_date) men pg_constraint visar
--    bara qc_runs_pkey. ON CONFLICT (kolumnlista) kräver dock ett unikt index — och eftersom
--    rader faktiskt skrivs varje dygn MÅSTE ett bart unikt index finnas (skapat via Supabase-UI,
--    syns ej i pg_constraint). En blind ADD CONSTRAINT UNIQUE skulle då dubblera indexet.
--    DO-blocket nedan promotar ett befintligt unikt index till en namngiven constraint om det
--    finns, annars skapar det ett nytt. Idempotent — kan köras om utan effekt.
--
-- Verifierat före körning: 0 dubbletter på (vertical, municipality, run_date) i prod.
-- Kör i Supabase SQL editor (ByggSignal abnlmxkgdkyyvbagewgf). Verifiera efteråt (nederst).

-- (1) Tri-state på permits_inserted
ALTER TABLE qc_runs ALTER COLUMN permits_inserted DROP DEFAULT;
ALTER TABLE qc_runs ALTER COLUMN permits_inserted DROP NOT NULL;

-- (2) Verklig UNIQUE-backning för upserten
DO $$
DECLARE
  v_idx text;
  v_has_constraint boolean;
BEGIN
  -- Finns redan en matchande UNIQUE-constraint? Klart.
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'qc_runs'::regclass
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname ORDER BY a.attname)
        FROM unnest(c.conkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      ) = ARRAY['municipality', 'run_date', 'vertical']
  ) INTO v_has_constraint;

  IF v_has_constraint THEN
    RAISE NOTICE 'qc_runs har redan UNIQUE-constraint på (vertical, municipality, run_date) — hoppar över';
    RETURN;
  END IF;

  -- Finns ett bart unikt index på samma kolumnuppsättning? Promota det (inget dubblett-index).
  SELECT i.relname INTO v_idx
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  WHERE x.indrelid = 'qc_runs'::regclass
    AND x.indisunique
    AND x.indnatts = 3
    AND (
      SELECT array_agg(a.attname ORDER BY a.attname)
      FROM unnest(x.indkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
    ) = ARRAY['municipality', 'run_date', 'vertical']
  LIMIT 1;

  IF v_idx IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE qc_runs ADD CONSTRAINT qc_runs_vertical_municipality_run_date_key UNIQUE USING INDEX %I',
      v_idx
    );
    RAISE NOTICE 'Promoterade befintligt unikt index % till namngiven constraint', v_idx;
  ELSE
    ALTER TABLE qc_runs
      ADD CONSTRAINT qc_runs_vertical_municipality_run_date_key
      UNIQUE (vertical, municipality, run_date);
    RAISE NOTICE 'Skapade ny UNIQUE-constraint på (vertical, municipality, run_date)';
  END IF;
END $$;

-- Verifiera efteråt:
--   SELECT column_name, is_nullable, column_default FROM information_schema.columns
--   WHERE table_name = 'qc_runs' AND column_name = 'permits_inserted';
--   -- förväntat: is_nullable = YES, column_default = NULL
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'qc_runs'::regclass AND contype IN ('p','u');
--   -- förväntat: qc_runs_pkey + qc_runs_vertical_municipality_run_date_key UNIQUE (vertical, municipality, run_date)
