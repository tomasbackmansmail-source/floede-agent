-- Migration 002: Fix åäö in CHECK constraints and existing data
-- Changes ASCII values to proper Swedish: ansökt, överklagat, förhandsbesked, anmälan

-- Step 1: Drop old CHECK constraints
ALTER TABLE permits_v2 DROP CONSTRAINT IF EXISTS permits_v2_permit_type_check;
ALTER TABLE permits_v2 DROP CONSTRAINT IF EXISTS permits_v2_status_check;

-- Step 2: Migrate existing data
UPDATE permits_v2 SET status = 'ansökt' WHERE status = 'ansokt';
UPDATE permits_v2 SET status = 'överklagat' WHERE status = 'overklagat';
UPDATE permits_v2 SET permit_type = 'förhandsbesked' WHERE permit_type = 'forhandsbesked';
UPDATE permits_v2 SET permit_type = 'anmälan' WHERE permit_type = 'anmalan';

-- Step 3: Add new CHECK constraints with Swedish characters
ALTER TABLE permits_v2 ADD CONSTRAINT permits_v2_permit_type_check
  CHECK (permit_type IN ('bygglov', 'marklov', 'rivningslov', 'förhandsbesked', 'strandskyddsdispens', 'anmälan'));

ALTER TABLE permits_v2 ADD CONSTRAINT permits_v2_status_check
  CHECK (status IN ('ansökt', 'beviljat', 'avslag', 'överklagat', 'startbesked', 'slutbesked'));
