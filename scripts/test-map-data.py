"""Exercise integrity failures without changing the repository's boundary data."""

import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("map_data", Path(__file__).with_name("verify-map-data.py"))
MAP_DATA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MAP_DATA)


class MapDataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "Cities"
        shutil.copytree(MAP_DATA.DEFAULT_CATALOG.parent, self.root)
        self.catalog_path = self.root / "catalog.json"
        self.catalog = json.loads(self.catalog_path.read_text(encoding="utf-8"))

    def save(self):
        self.catalog_path.write_text(json.dumps(self.catalog), encoding="utf-8")

    def test_current_boundaries(self):
        count, size = MAP_DATA.verify(self.catalog_path)
        self.assertGreaterEqual(count, 3)
        self.assertGreater(size, 0)

    def test_changed_data_rejected(self):
        path = self.root / "boundaries/hanoi.geojson"
        # A same-length valid JSON change must still fail integrity validation.
        path.write_bytes(path.read_bytes().replace(b'"FeatureCollection"', b'"featureCollection"'))
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            MAP_DATA.verify(self.catalog_path)

    def test_unregistered_file_rejected(self):
        shutil.copyfile(self.root / "boundaries/hanoi.geojson", self.root / "boundaries/copy.geojson")
        with self.assertRaisesRegex(ValueError, "directory and catalog differ"):
            MAP_DATA.verify(self.catalog_path)

    def test_duplicate_id_rejected(self):
        self.catalog["cities"].append(self.catalog["cities"][0])
        self.save()
        with self.assertRaisesRegex(ValueError, "duplicate city ID"):
            MAP_DATA.verify(self.catalog_path)

    def test_traversal_path_rejected(self):
        self.catalog["cities"][0]["boundary"]["path"] = "../outside.geojson"
        self.save()
        with self.assertRaisesRegex(ValueError, "filename must match"):
            MAP_DATA.verify(self.catalog_path)

    def test_bbox_mismatch_rejected(self):
        self.catalog["cities"][0]["boundary"]["bbox"][0] = 0
        self.save()
        with self.assertRaisesRegex(ValueError, "bounding box mismatch"):
            MAP_DATA.verify(self.catalog_path)

    def test_new_city_requires_provenance(self):
        city = self.catalog["cities"][0]
        old_path = self.root / city["boundary"]["path"]
        city["id"] = "vn-test"
        city["boundary"]["path"] = "boundaries/vn-test.geojson"
        old_path.rename(self.root / city["boundary"]["path"])
        self.save()
        with self.assertRaisesRegex(ValueError, "new cities require documented provenance"):
            MAP_DATA.verify(self.catalog_path)

    def test_bad_polygon_rejected(self):
        for coordinates in (
            [[[0, 0], [1, 0], [1, 1], [2, 2]]],
            [[[181, 0], [1, 0], [1, 1], [181, 0]]],
            [[[float("nan"), 0], [1, 0], [1, 1], [0, 0]]],
        ):
            with self.subTest(coordinates=coordinates), self.assertRaises(ValueError):
                list(MAP_DATA.geometry_points({"type": "Polygon", "coordinates": coordinates}))

    def test_documented_city_with_recipe(self):
        city = self.catalog["cities"][0]
        old_path = self.root / city["boundary"]["path"]
        city["id"] = "vn-test"
        city["boundary"]["path"] = "boundaries/vn-test.geojson"
        old_path.rename(self.root / city["boundary"]["path"])
        source = city["boundary"]["source"]
        source.update(
            {
                "provenance_status": "documented",
                "url": "https://example.org/test-source",
                "snapshot_at": "2026-01-01T00:00:00Z",
                "retrieved_at": "2026-01-02T00:00:00Z",
                "recipe": "test-recipe.md",
            }
        )
        (self.root / "test-recipe.md").write_text("Synthetic test fixture; not a real extraction.")
        self.save()
        MAP_DATA.verify(self.catalog_path)
        source["recipe"] = "missing.md"
        self.save()
        with self.assertRaisesRegex(ValueError, "recipe must exist"):
            MAP_DATA.verify(self.catalog_path)


if __name__ == "__main__":
    unittest.main()
