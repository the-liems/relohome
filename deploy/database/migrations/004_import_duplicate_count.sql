ALTER TABLE geo.import_runs
    ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 0;
