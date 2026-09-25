ALTER TABLE geo.poi_staging
    ADD COLUMN IF NOT EXISTS osmium_feature_id text;
