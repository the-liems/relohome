#!/usr/bin/env python3
"""Verify the checked-in city boundary catalog; never rewrite source data."""

import argparse
import hashlib
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path

DEFAULT_CATALOG = Path(__file__).resolve().parents[1] / "Maps VN/Cities/catalog.json"
# Repository budgets, not GeoJSON or hosting limits.
MAX_BOUNDARY_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 20 * 1024 * 1024
LEGACY_IDS = {"danang", "hanoi", "hcm"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def geometry_points(geometry):
    """Check polygon structure, finite lon/lat positions, and closed rings."""
    kind = geometry["type"]
    require(kind in ("Polygon", "MultiPolygon"), "expected Polygon or MultiPolygon")
    polygons = geometry["coordinates"]
    if kind == "Polygon":
        polygons = [polygons]
    require(bool(polygons), "empty geometry")
    for polygon in polygons:
        require(bool(polygon), "empty polygon")
        for ring in polygon:
            require(len(ring) >= 4 and ring[0] == ring[-1], "unclosed or short ring")
            for point in ring:
                require(len(point) == 2, "expected longitude/latitude pairs")
                require(
                    all(type(v) in (int, float) and math.isfinite(v) for v in point),
                    "non-finite or non-numeric coordinates",
                )
                require(
                    -180 <= point[0] <= 180 and -90 <= point[1] <= 90, "coordinates outside longitude/latitude range"
                )
                yield point


def verify(catalog_path):
    root = catalog_path.resolve().parent
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    require(catalog["schema_version"] == 1, "unsupported catalog schema")
    require(bool(catalog["cities"]), "empty city catalog")
    ids, paths, total = set(), set(), 0
    for city in catalog["cities"]:
        city_id = city["id"]
        require(re.fullmatch(r"[a-z][a-z0-9-]*", city_id), "invalid city ID")
        require(city_id not in ids, f"duplicate city ID: {city_id}")
        ids.add(city_id)
        require(
            bool(city["name"]) and re.fullmatch(r"[A-Z]{2}", city["country"]),
            f"{city_id}: missing name or invalid country",
        )
        asset = city["boundary"]
        expected_path = f"boundaries/{city_id}.geojson"
        require(asset["path"] == expected_path, f"{city_id}: filename must match stable ID")
        path = root / expected_path
        require(path.resolve().parent == root / "boundaries", "boundary escapes directory")
        paths.add(path)
        size = path.stat().st_size
        require(0 < size <= MAX_BOUNDARY_BYTES, f"{city_id}: exceeds Git boundary budget")
        require(size == asset["bytes"], f"{city_id}: byte count mismatch")
        total += size
        raw = path.read_bytes()
        require(
            hashlib.sha256(raw).hexdigest() == asset["sha256"],
            f"{city_id}: SHA-256 mismatch; review data and catalog together",
        )
        require(asset["crs"] == "OGC:CRS84", f"{city_id}: expected longitude/latitude CRS")
        source = asset["source"]
        for field in ("provider", "license", "license_url", "attribution", "notes"):
            require(
                isinstance(source[field], str) and bool(source[field].strip()), f"{city_id}: missing source {field}"
            )
        status = source["provenance_status"]
        require(status in ("documented", "legacy-incomplete"), "unknown provenance status")
        if status == "legacy-incomplete":
            require(city_id in LEGACY_IDS, "new cities require documented provenance")
            for field in ("url", "snapshot_at", "retrieved_at", "recipe"):
                require(field in source, f"{city_id}: record unknown {field} explicitly")
        else:
            for field in ("url", "snapshot_at", "retrieved_at", "recipe"):
                require(
                    isinstance(source[field], str) and bool(source[field].strip()), f"{city_id}: missing source {field}"
                )
            for field in ("snapshot_at", "retrieved_at"):
                require(
                    datetime.fromisoformat(source[field]).tzinfo is not None,
                    f"{city_id}: {field} requires an ISO timestamp with timezone",
                )
            recipe = (root / source["recipe"]).resolve()
            require(
                recipe.is_relative_to(root) and recipe.is_file(),
                f"{city_id}: recipe must exist within the catalog directory",
            )
        data = json.loads(raw)
        require(data["type"] == "FeatureCollection", f"{city_id}: expected FeatureCollection")
        features = data["features"]
        require(len(features) > 0 and len(features) == asset["feature_count"], f"{city_id}: feature count mismatch")
        points = []
        for feature in features:
            require(feature["type"] == "Feature", f"{city_id}: expected Feature")
            points.extend(geometry_points(feature["geometry"]))
        bbox = [
            min(p[0] for p in points),
            min(p[1] for p in points),
            max(p[0] for p in points),
            max(p[1] for p in points),
        ]
        require(bbox == asset["bbox"], f"{city_id}: bounding box mismatch")
    require(total <= MAX_TOTAL_BYTES, "catalog exceeds total Git boundary budget")
    actual = {p for p in (root / "boundaries").rglob("*") if p.is_file() and p.suffix.lower() == ".geojson"}
    require(actual == paths, "boundary directory and catalog differ; register every boundary")
    return len(ids), total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    args = parser.parse_args()
    try:
        count, size = verify(args.catalog)
    except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
        print(f"Map data validation failed: {error}", file=sys.stderr)
        return 1
    print(f"Verified {count} city boundaries ({size:,} bytes); source files unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
