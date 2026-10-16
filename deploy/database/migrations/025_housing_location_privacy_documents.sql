-- Keep exact canonical geometry/address for spatial queries and private review.
-- A private per-property random seed makes the public area stable across listings,
-- services and reloads; its public center cannot be derived from public identifiers.
ALTER TABLE housing.properties ADD COLUMN location_privacy_seed uuid NOT NULL DEFAULT gen_random_uuid();

CREATE FUNCTION housing.public_location(property uuid) RETURNS geometry
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT public.ST_Project(cp.geom::public.geography,
   300 + (('x' || substr(md5(p.location_privacy_seed::text),1,8))::bit(32)::bigint % 151),
   (('x' || substr(md5(p.location_privacy_seed::text),9,8))::bit(32)::bigint % 360) * pi() / 180
 )::public.geometry
 FROM housing.properties p JOIN catalog.places cp ON cp.id=p.place_id WHERE p.id=property
$$;

CREATE FUNCTION housing.public_address(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object(
   'ward',nullif(value->>'ward',''), 'district',nullif(value->>'district',''), 'city',nullif(value->>'city',''),
   'full_address',coalesce(nullif(concat_ws(', ',nullif(value->>'ward',''),nullif(value->>'district',''),nullif(value->>'city','')),''),'Vị trí gần đúng')
 ))
$$;

CREATE TABLE housing.property_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 property_id uuid NOT NULL REFERENCES housing.properties(id) ON DELETE CASCADE,
 uploaded_by text NOT NULL,
 filename text NOT NULL CHECK(filename ~ '^[a-f0-9]{40}\.png$'),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 160),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(property_id,content_sha256), UNIQUE(filename)
);
CREATE INDEX property_documents_property_idx ON housing.property_documents(property_id,created_at);
CREATE INDEX unit_create_request_idx ON housing.units(property_id,(attributes->>'create_request_id'))
 WHERE attributes->>'create_request_id' IS NOT NULL;
