-- Places created for owner-managed properties are housing anchors, like imported housing places:
-- they must not appear as POIs in the map layer or place search. Additive backfill only.
UPDATE catalog.places p
SET attributes = p.attributes || '{"entity_role":"housing_anchor"}'::jsonb
WHERE p.category_id = (SELECT id FROM catalog.place_categories WHERE slug = 'housing-self-service')
  AND COALESCE(p.attributes->>'entity_role', '') <> 'housing_anchor';
