-- Migration 003: Complete schema for permits_v2
-- This migration brings a fresh database to match the production schema.
-- Run after 001 + 002, or standalone on a new environment.
-- Idempotent: safe to run multiple times.

-- Add columns that were added manually in production but missing from migrations
ALTER TABLE permits_v2 ADD COLUMN IF NOT EXISTS applicant TEXT;
ALTER TABLE permits_v2 ADD COLUMN IF NOT EXISTS lan TEXT;

-- Add index on lan for county-level queries
CREATE INDEX IF NOT EXISTS idx_permits_v2_lan ON permits_v2 (lan);

-- Add index on date for time-range queries
CREATE INDEX IF NOT EXISTS idx_permits_v2_date ON permits_v2 (date);

-- Add index on permit_type and status for filtered queries
CREATE INDEX IF NOT EXISTS idx_permits_v2_permit_type ON permits_v2 (permit_type);
CREATE INDEX IF NOT EXISTS idx_permits_v2_status ON permits_v2 (status);

-- Verify CHECK constraints match Swedish characters (from migration 002)
-- These are no-ops if 002 has already been applied, but ensure correctness on fresh installs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'permits_v2_permit_type_check'
  ) THEN
    ALTER TABLE permits_v2 ADD CONSTRAINT permits_v2_permit_type_check
      CHECK (permit_type IN ('bygglov', 'marklov', 'rivningslov', 'förhandsbesked', 'strandskyddsdispens', 'anmälan'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'permits_v2_status_check'
  ) THEN
    ALTER TABLE permits_v2 ADD CONSTRAINT permits_v2_status_check
      CHECK (status IN ('ansökt', 'beviljat', 'avslag', 'överklagat', 'startbesked', 'slutbesked'));
  END IF;
END
$$;

COMMENT ON COLUMN permits_v2.applicant IS 'Organization name only (AB, BRF, HB, KB, kommun, etc). Private individuals = null (GDPR).';
COMMENT ON COLUMN permits_v2.lan IS 'County name, populated from municipalities lookup table.';
