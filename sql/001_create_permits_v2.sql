-- permits_v2: Target table for Floede Agent extraction
-- Run this in Supabase SQL Editor BEFORE running extraction pipeline
-- This table is SEPARATE from the legacy permits table.
-- NEVER modify the permits table from this system.

CREATE TABLE IF NOT EXISTS permits_v2 (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  municipality TEXT NOT NULL,
  case_number TEXT,
  address TEXT,
  permit_type TEXT CHECK (permit_type IN ('bygglov', 'marklov', 'rivningslov', 'forhandsbesked', 'strandskyddsdispens', 'anmalan')),
  status TEXT CHECK (status IN ('ansokt', 'beviljat', 'avslag', 'overklagat', 'startbesked', 'slutbesked')),
  date DATE,
  description TEXT,
  source_url TEXT,
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  extraction_model TEXT DEFAULT 'claude-haiku-4-5-20251001',
  extraction_cost_usd NUMERIC(10, 8),
  raw_html_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for comparison queries
CREATE INDEX IF NOT EXISTS idx_permits_v2_municipality ON permits_v2 (municipality);
CREATE INDEX IF NOT EXISTS idx_permits_v2_case_number ON permits_v2 (case_number);
CREATE INDEX IF NOT EXISTS idx_permits_v2_extracted_at ON permits_v2 (extracted_at);

-- Unique constraint to prevent duplicate extraction of same permit
CREATE UNIQUE INDEX IF NOT EXISTS idx_permits_v2_unique_case
  ON permits_v2 (municipality, case_number)
  WHERE case_number IS NOT NULL;

COMMENT ON TABLE permits_v2 IS 'Floede Agent extracted permits. Parallel to legacy permits table. Do not merge.';
