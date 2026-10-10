-- geo.normalize_search backs expression indexes on catalog.places. The map_points
-- sync functions (019/020) run with search_path=pg_catalog,pg_temp, and planning
-- their query loads those index expressions: an unqualified unaccent() then fails
-- on any connection that has not already loaded them. Qualify the function and
-- its dictionary with the extension's schema; the result is unchanged, so the
-- existing indexes stay valid.
DO $$
DECLARE extension_schema text;
BEGIN
    SELECT n.nspname INTO STRICT extension_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'unaccent';
    EXECUTE format($function$
        CREATE OR REPLACE FUNCTION geo.normalize_search(value text)
        RETURNS text
        LANGUAGE sql
        IMMUTABLE
        PARALLEL SAFE
        STRICT
        AS $body$
            SELECT lower(regexp_replace(%1$I.unaccent(%2$L::regdictionary, value), '\s+', ' ', 'g'));
        $body$
    $function$, extension_schema, format('%I.unaccent', extension_schema));
END;
$$;
