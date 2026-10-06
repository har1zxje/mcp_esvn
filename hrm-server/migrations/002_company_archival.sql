ALTER TABLE companies ADD COLUMN archived_at TIMESTAMPTZ;
CREATE INDEX companies_active_idx ON companies (id) WHERE archived_at IS NULL;
