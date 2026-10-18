"""Address-cleaning regressions: do not guess units, road dates, wards or coordinates."""

import asyncio
import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "housing_geocode", Path(__file__).resolve().parents[1] / "scripts/housing-geocode.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
FULL_SPEC = importlib.util.spec_from_file_location(
    "housing_full", Path(__file__).resolve().parents[1] / "scripts/housing-geocode-full.py"
)
FULL = importlib.util.module_from_spec(FULL_SPEC)
FULL_SPEC.loader.exec_module(FULL)
APPLY_SPEC = importlib.util.spec_from_file_location(
    "housing_apply", Path(__file__).resolve().parents[1] / "scripts/housing-geocode-apply.py"
)
APPLY = importlib.util.module_from_spec(APPLY_SPEC)
APPLY_SPEC.loader.exec_module(APPLY)


def record(house=None, street="Bạch Đằng", raw=None):
    return {
        "source_type": "test",
        "source_listing_id": "1",
        "address_raw": raw or ", ".join(filter(None, [house, street, "Phường 15"])),
        "address_normalized": {
            "housenumber": house,
            "street": street,
            "ward": "Phường 15",
            "district": "Quận Bình Thạnh",
            "city": "Hồ Chí Minh",
            "country": "VN",
        },
        "location": {"latitude": 10.800452, "longitude": 106.70504, "accuracy": "approximate", "method": "source_map"},
        "unit": {"bedrooms": 1},
        "offer": {"price_amount": 5000000},
        "title": "Phòng cho thuê",
        "derived": {},
    }


class AddressTests(unittest.TestCase):
    def test_third_account_is_only_selected_after_the_first_two_are_blocked(self):
        with tempfile.TemporaryDirectory() as directory:
            pool = FULL.KeyPool(
                {
                    "VIETMAP_API_KEY_2": "test-third",
                    "VIETMAP_API_KEY_1": "test-second",
                    "VIETMAP_API_KEY": "test-first",
                },
                Path(directory) / "state.json",
            )
            self.assertEqual(pool.select()["name"], "VIETMAP_API_KEY")
            pool.block(pool.select(), 429)
            self.assertEqual(pool.select()["name"], "VIETMAP_API_KEY_1")
            pool.block(pool.select(), 429)
            self.assertEqual(pool.select()["name"], "VIETMAP_API_KEY_2")

    def test_provider_road_name_with_empty_street_is_matched_without_altering_raw_place(self):
        task = {
            "address": record(None)["address_normalized"],
            "kind": "street_only",
            "city": "ho chi minh",
            "source_coordinates": [[10.800452, 106.70504]],
        }
        place = {
            "name": "Đường Bạch Đằng",
            "street": "",
            "hs_num": "",
            "ward": "Phường 15",
            "district": "Quận Bình Thạnh",
            "city": "Hồ Chí Minh",
            "lat": 10.802,
            "lng": 106.706,
        }
        original = copy.deepcopy(place)
        candidate = FULL.evaluate_place(task, {}, place)
        self.assertEqual(FULL.assess(task, [candidate], {})["decision"], "update_street_position")
        self.assertEqual(candidate["street_match_evidence"], "place.name_exact_road")
        self.assertEqual(place, original)
        wrong = FULL.evaluate_place(task, {}, dict(place, name="Đường Điện Biên Phủ"))
        self.assertEqual(FULL.assess(task, [wrong], {})["decision"], "preserve_street_unresolved")
        house = FULL.evaluate_place(task, {}, dict(place, hs_num="10"))
        self.assertFalse(house["component_matches"]["street"])
        self.assertFalse(FULL.street_lookup_done({"street_precision_policy": "vietmap_street_approximate_v1"}))

    def test_road_match_is_approximate_and_not_a_numbered_house_candidate(self):
        task = {
            "address": record(None)["address_normalized"],
            "kind": "street_only",
            "city": "ho chi minh",
            "source_coordinates": [[10.800452, 106.70504]],
        }
        road = {
            "hs_num": "",
            "street": "Bạch Đằng",
            "ward": "Phường 15",
            "district": "Quận Bình Thạnh",
            "city": "Hồ Chí Minh",
            "lat": 10.802,
            "lng": 106.706,
        }
        match = MODULE.evaluate_candidate(task, {"name": "Bạch Đằng"}, road)
        self.assertEqual(FULL.assess(task, [match], {})["decision"], "update_street_position")
        self.assertEqual(FULL.assess(task, [match], {"protected": 1})["decision"], "preserve_verified")
        self.assertEqual(
            FULL.assess(task, [match], {"building_conflict": True})["decision"], "preserve_building_conflict"
        )
        numbered = MODULE.evaluate_candidate(task, {}, dict(road, hs_num="10"))
        self.assertEqual(FULL.assess(task, [numbered], {})["decision"], "preserve_street_unresolved")
        wrong_ward = MODULE.evaluate_candidate(task, {}, dict(road, ward="Phường 2"))
        self.assertEqual(FULL.assess(task, [wrong_ward], {})["decision"], "preserve_street_unresolved")
        road_without_ward = MODULE.evaluate_candidate(task, {}, dict(road, ward=""))
        self.assertEqual(FULL.assess(task, [road_without_ward], {})["decision"], "update_street_position")
        second = MODULE.evaluate_candidate(task, {}, dict(road, lat=10.803))
        self.assertEqual(FULL.assess(task, [match, second], {})["status"], "ambiguous_street")
        search = [{"name": "10 Bạch Đằng", "ref_id": "house"}, {"name": "Bạch Đằng", "ref_id": "road"}]
        self.assertEqual([r["ref_id"] for r in FULL.rank_candidates(task, search)], ["road"])

    def test_cached_road_lookup_replaces_offline_skip_and_exports_labeled_approximation(self):
        import hashlib

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.jsonl"
            out = base / "out"
            rows = [record(None), record("12")]
            rows[1]["source_listing_id"] = "2"
            source.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
            MODULE.prepare(source, out, 10)
            task = next(t for t in MODULE.read_jsonl(out / "tasks.jsonl") if t["kind"] == "street_only")
            initial = {
                "key": task["key"],
                "kind": "street_only",
                "assessment": {"decision": "preserve_street_only", "status": "not_queried_missing_housenumber"},
            }
            (out / "full-candidates.jsonl").write_text(json.dumps(initial) + "\n", encoding="utf-8")
            road = {
                "hs_num": "",
                "street": "Bạch Đằng",
                "ward": "Phường 15",
                "district": "Quận Bình Thạnh",
                "city": "Hồ Chí Minh",
                "lat": 10.802,
                "lng": 106.706,
            }
            params = {"text": task["query"], "display_type": 6, "layers": "STREET"}

            def digest(endpoint, parameters):
                return hashlib.sha256(json.dumps([endpoint, parameters], sort_keys=True).encode()).hexdigest()

            cache = {
                digest("search/v4", params): [{"name": "Bạch Đằng", "ref_id": "road"}],
                digest("place/v4", {"refid": "road"}): road,
            }
            MODULE.write_json(out / "cache.json", {"request_count": 2, "requests": cache})
            (out / "full-cache.jsonl").write_text("", encoding="utf-8")
            MODULE.write_json(out / "building-context.json", FULL.contexts(source))
            FULL.cached_only(out, shared_pins_only=True)
            entries = list(MODULE.read_jsonl(out / "full-candidates.jsonl"))
            self.assertEqual(entries[-1]["assessment"]["decision"], "update_street_position")
            self.assertTrue(FULL.street_lookup_done(entries[-1]))
            FULL.export(out, allow_partial=True)
            after = list(MODULE.read_jsonl(out / "housing-geocoded.jsonl"))
            self.assertEqual(after[0]["location"]["latitude"], 10.802)
            self.assertEqual(after[0]["location"]["method"], "vietmap_street_v4")
            self.assertEqual(after[0]["location"]["accuracy"], "approximate")
            self.assertEqual(after[0]["derived"]["housing_geocoding"]["position_precision"], "street")
            self.assertFalse(after[0]["derived"]["housing_geocoding"]["house_position_known"])
            self.assertEqual(after[1]["location"], rows[1]["location"])
            self.assertEqual(APPLY.validate_export(source, out / "housing-geocoded.jsonl"), 2)
            FULL.cached_only(out, shared_pins_only=True)
            self.assertEqual(len(list(MODULE.read_jsonl(out / "full-candidates.jsonl"))), 2)

    def test_same_provider_pin_for_different_roads_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.jsonl"
            out = base / "out"
            rows = [record(None), record(None, "Điện Biên Phủ")]
            rows[1]["source_listing_id"] = "2"
            source.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
            MODULE.prepare(source, out, 10)
            results = []
            for task in MODULE.read_jsonl(out / "tasks.jsonl"):
                road = {
                    "hs_num": "",
                    "street": task["address"]["street"],
                    "ward": "Phường 15",
                    "district": "Quận Bình Thạnh",
                    "city": "Hồ Chí Minh",
                    "lat": 10.802,
                    "lng": 106.706,
                }
                candidate = MODULE.evaluate_candidate(task, {}, road)
                results.append({"key": task["key"], "assessment": FULL.assess(task, [candidate], {})})
            (out / "full-candidates.jsonl").write_text(
                "\n".join(json.dumps(r) for r in results) + "\n", encoding="utf-8"
            )
            FULL.export(out)
            after = list(MODULE.read_jsonl(out / "housing-geocoded.jsonl"))
            for old, new in zip(rows, after, strict=True):
                self.assertEqual(old["location"], new["location"])
                self.assertEqual(new["derived"]["housing_geocoding"]["decision"], "preserve_provider_shared_pin")

    def test_road_export_ignores_invalid_alternative_candidates(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.jsonl"
            out = base / "out"
            source.write_text(json.dumps(record(None), ensure_ascii=False) + "\n", encoding="utf-8")
            MODULE.prepare(source, out, 10)
            task = next(MODULE.read_jsonl(out / "tasks.jsonl"))
            road = {
                "hs_num": "",
                "street": "Bạch Đằng",
                "ward": "Phường 15",
                "district": "Quận Bình Thạnh",
                "city": "Hồ Chí Minh",
                "lat": 10.802,
                "lng": 106.706,
            }
            matched = MODULE.evaluate_candidate(task, {}, road)
            invalid = MODULE.evaluate_candidate(task, {}, dict(road, lat=None))
            result = {
                "key": task["key"],
                "assessment": FULL.assess(task, [matched, invalid], {}),
                "candidates": [matched, invalid],
            }
            (out / "full-candidates.jsonl").write_text(json.dumps(result) + "\n", encoding="utf-8")
            FULL.export(out)
            row = next(MODULE.read_jsonl(out / "housing-geocoded.jsonl"))
            self.assertEqual(row["location"]["latitude"], 10.802)
            self.assertEqual(row["location"]["method"], "vietmap_street_v4")

    def test_shared_pins_distinguish_conflicting_addresses_from_building_units(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rows.jsonl"
            rows = [record("10"), record("12"), record("14"), record("14"), record(None), record(None)]
            for i, row in enumerate(rows):
                row["source_listing_id"] = str(i)
                row["unit"]["unit_code"] = "room " + str(i)
            for row in rows[2:4]:
                row["location"]["latitude"] = 10.801
            for row in rows[4:]:
                row["location"]["latitude"] = 10.802
            path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
            audit = FULL.audit_shared_pins(path)
            self.assertEqual(audit["counts"]["different_addresses_same_pin_records"], 2)
            self.assertEqual(audit["counts"]["same_numbered_address_possible_shared_building_records"], 2)
            self.assertEqual(audit["counts"]["coarse_address_shared_pin_unresolved_records"], 2)
            tasks = [
                {
                    "key": MODULE.task_key(r["address_normalized"]),
                    "kind": "numbered" if r["address_normalized"]["housenumber"] else "street_only",
                }
                for r in [rows[2], rows[0], rows[4]]
            ]
            ordered = FULL.prioritize_tasks(tasks, audit)
            self.assertEqual(ordered[0]["key"], tasks[1]["key"])
            self.assertEqual(ordered[-1]["kind"], "street_only")
            focused = FULL.shared_pin_tasks(tasks, audit)
            self.assertEqual([t["key"] for t in focused], [tasks[1]["key"]])
            self.assertEqual(sum(g["listing_count"] for g in audit["groups"]), 6)

    def test_shared_pin_queue_preserves_completed_cache_and_defers_other_addresses(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.jsonl"
            out = base / "out"
            rows = [record("10"), record("12"), record("14")]
            for i, row in enumerate(rows):
                row["source_listing_id"] = str(i)
            rows[2]["location"]["latitude"] = 10.801
            source.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
            MODULE.prepare(source, out, 10)
            completed_key = MODULE.task_key(rows[0]["address_normalized"])
            entry = {"key": completed_key, "kind": "numbered", "assessment": {"decision": "preserve_unresolved"}}
            original_cache = json.dumps(entry) + "\n"
            (out / "full-candidates.jsonl").write_text(original_cache, encoding="utf-8")
            before = MODULE.sha256(source)
            audit = FULL.write_shared_pin_audit(out)
            queued = list(MODULE.read_jsonl(out / "shared-pin-queue.jsonl"))
            self.assertEqual(len(queued), 1)
            self.assertEqual(queued[0]["address"]["housenumber"], "12")
            self.assertEqual(audit["numbered_conflict_address_keys"], 2)
            self.assertEqual(audit["numbered_conflict_address_keys_pending"], 1)
            self.assertEqual(MODULE.sha256(source), before)
            self.assertEqual((out / "full-candidates.jsonl").read_text(encoding="utf-8"), original_cache)

    def test_progress_write_retries_windows_file_lock_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "progress.json"
            path.write_text('{"request_count":10}', encoding="utf-8")
            replace = Path.replace
            attempts = []

            def briefly_locked(temporary, target):
                attempts.append(True)
                if len(attempts) < 3:
                    self.assertEqual(json.loads(target.read_text())["request_count"], 10)
                    raise PermissionError("simulated sharing violation")
                return replace(temporary, target)

            with patch.object(Path, "replace", briefly_locked), patch.object(MODULE.time, "sleep"):
                MODULE.write_json(path, {"request_count": 11})
            self.assertEqual(json.loads(path.read_text())["request_count"], 11)
            self.assertEqual(len(attempts), 3)
            self.assertFalse(path.with_suffix(path.suffix + ".tmp").exists())

    def test_persistent_progress_lock_does_not_overwrite_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "progress.json"
            path.write_text('{"request_count":10}', encoding="utf-8")
            with (
                patch.object(Path, "replace", side_effect=PermissionError("persistent lock")) as replace,
                patch.object(MODULE.time, "sleep"),
            ):
                with self.assertRaises(PermissionError):
                    MODULE.write_json(path, {"request_count": 11})
            self.assertEqual(json.loads(path.read_text())["request_count"], 10)
            self.assertEqual(replace.call_count, 10)

    def test_account_rotation_persists_and_new_secret_can_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "key-state.json"
            env = {"VIETMAP_API_KEY": "old-test-secret", "VIETMAP_API_KEY_1": "new-test-secret"}
            pool = FULL.KeyPool(env, path)
            old = pool.select()
            pool.block(old, 429)
            self.assertEqual(pool.select()["name"], "VIETMAP_API_KEY_1")
            self.assertNotIn("old-test-secret", path.read_text())
            self.assertNotIn("new-test-secret", path.read_text())
            restarted = FULL.KeyPool(env, path)
            self.assertEqual(restarted.select()["name"], "VIETMAP_API_KEY_1")
            restarted.block(restarted.select(), 429)
            with self.assertRaises(FULL.StopRun):
                restarted.select()
            env["VIETMAP_API_KEY_1"] = "replacement-secret"
            self.assertEqual(FULL.KeyPool(env, path).select()["secret"], "replacement-secret")

    def test_live_worker_rotation_uses_cache_and_redacts_secrets(self):
        import httpx

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.jsonl"
            out = base / "out"
            row = record("10")
            source.write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")
            MODULE.prepare(source, out, 10)
            env = {"VIETMAP_API_KEY": "old-test-secret", "VIETMAP_API_KEY_1": "new-test-secret"}
            calls = []

            async def get(client, url, params):
                calls.append((url.rsplit("/", 2)[-2], params["apikey"]))
                if params["apikey"] == "old-test-secret":
                    return httpx.Response(429, json={"message": "limited old-test-secret new-test-secret"})
                if "search" in url:
                    return httpx.Response(200, json=[{"ref_id": "test-place", "name": "10 Bạch Đằng"}])
                return httpx.Response(
                    200,
                    json={
                        "hs_num": "10",
                        "street": "Bạch Đằng",
                        "ward": "Phường 15",
                        "district": "Quận Bình Thạnh",
                        "city": "Hồ Chí Minh",
                        "lat": 10.8006,
                        "lng": 106.7052,
                    },
                )

            async def no_wait(pacer):
                pass

            with (
                patch("dotenv.dotenv_values", return_value=env),
                patch.object(httpx.AsyncClient, "get", get),
                patch.object(FULL.Pace, "wait", no_wait),
            ):
                asyncio.run(FULL.run(out, 100, 120, 1))
                self.assertEqual(len(calls), 3)
                self.assertEqual(calls[0][1], "old-test-secret")
                self.assertEqual([c[1] for c in calls[1:]], ["new-test-secret"] * 2)
                self.assertEqual(json.loads((out / "full-request-count.json").read_text())["request_count"], 3)
                self.assertEqual(json.loads((out / "full-run.json").read_text())["status"], "complete")
                for path in out.glob("*"):
                    if path.is_file():
                        text = path.read_text(encoding="utf-8")
                        self.assertNotIn("old-test-secret", text)
                        self.assertNotIn("new-test-secret", text)
                # An interrupted task can be rebuilt from responses without HTTP or extra quota.
                (out / "full-candidates.jsonl").write_text("", encoding="utf-8")
                asyncio.run(FULL.run(out, 100, 120, 1))
                self.assertEqual(len(calls), 3)
                self.assertEqual(json.loads((out / "full-run.json").read_text())["status"], "complete")

    def test_live_worker_stops_when_both_accounts_are_limited(self):
        import httpx

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.jsonl"
            out = base / "out"
            source.write_text(json.dumps(record("10"), ensure_ascii=False) + "\n", encoding="utf-8")
            MODULE.prepare(source, out, 10)
            calls = []

            async def get(client, url, params):
                calls.append(params["apikey"])
                return httpx.Response(429, json={"error": "rate limit"})

            async def no_wait(pacer):
                pass

            env = {"VIETMAP_API_KEY": "test-first", "VIETMAP_API_KEY_1": "test-second"}
            with (
                patch("dotenv.dotenv_values", return_value=env),
                patch.object(httpx.AsyncClient, "get", get),
                patch.object(FULL.Pace, "wait", no_wait),
            ):
                asyncio.run(FULL.run(out, 100, 120, 1))
                self.assertEqual(calls, ["test-first", "test-second"])
                state = json.loads((out / "full-run.json").read_text())
                self.assertEqual(state["stopped_reason"], "all_configured_keys_unavailable")
                asyncio.run(FULL.run(out, 100, 120, 1))
                self.assertEqual(len(calls), 2)

    def test_explicit_alley_does_not_destroy_house_suffix(self):
        before = record("50A", "Hẻm 277 Đường Xô Viết Nghệ Tĩnh")
        original = copy.deepcopy(before)
        a, e, k = MODULE.normalize_address(before)
        self.assertEqual(a["housenumber"], "277/50A")
        self.assertEqual(a["street"], "Xô Viết Nghệ Tĩnh")
        self.assertEqual(a["ward"], "Phường 15")
        self.assertEqual(before, original)

    def test_named_alley_is_not_repeated(self):
        a, _, _ = MODULE.normalize_address(record("29 Ngõ Hàng Cháo", "Hàng Cháo"))
        self.assertEqual(a["housenumber"], "29")
        self.assertEqual(a["street"], "Ngõ Hàng Cháo")
        self.assertNotIn("Hàng Cháo Hàng Cháo", MODULE.address_text(a))

    def test_already_canonical_slash_address_is_not_doubled(self):
        a, _, _ = MODULE.normalize_address(record("277/50", "Hẻm 277 Đường Xô Viết Nghệ Tĩnh"))
        self.assertEqual(a["housenumber"], "277/50")
        a2, _, _ = MODULE.normalize_address({"address_normalized": a})
        self.assertEqual(a2, a)

    def test_date_road_names_remain_streets(self):
        for road in ["3 Tháng 2", "30 Tháng 4", "2 Tháng 9", "Đường 3/2", "Đường 30/4"]:
            a, _, kind = MODULE.normalize_address(record(None, road, road + ", Hồ Chí Minh"))
            self.assertFalse(a["housenumber"])
            self.assertEqual(kind, "street_only")

    def test_extract_inline_number_requires_raw_evidence(self):
        a, _, kind = MODULE.normalize_address(record(None, "325/29A Bạch Đằng", "325/29A Bạch Đằng, Phường 15"))
        self.assertEqual(a["housenumber"], "325/29A")
        self.assertEqual(kind, "numbered")
        a, _, kind = MODULE.normalize_address(record(None, "325/29A Bạch Đằng", "Đường Bạch Đằng, Phường 15"))
        self.assertFalse(a["housenumber"])
        self.assertEqual(kind, "street_only")

    def test_alley_without_house_number_is_coarse(self):
        a, _, kind = MODULE.normalize_address(record(None, "Hẻm 207 Đường Bạch Đằng"))
        self.assertEqual(kind, "street_only")
        self.assertFalse(a["housenumber"])

    def test_description_nearby_address_is_not_used(self):
        row = record(None)
        row["description"] = "Gần số 123 Xô Viết Nghệ Tĩnh; liên hệ 0901234567"
        a, _, kind = MODULE.normalize_address(row)
        self.assertFalse(a["housenumber"])
        self.assertEqual(kind, "street_only")

    def test_explicit_address_line_recovers_house_but_not_conflicts(self):
        row = record(None)
        row["description"] = "Phòng tầng 2\nĐịa chỉ: 325/29A Bạch Đằng, Phường 15, Bình Thạnh"
        a, e, k = MODULE.normalize_address(row)
        self.assertEqual(a["housenumber"], "325/29A")
        self.assertEqual(k, "numbered")
        row["description"] += "\nĐịa chỉ: 123 Bạch Đằng, Phường 15"
        self.assertFalse(MODULE.normalize_address(row)[0].get("housenumber"))
        row["description"] = "Địa chỉ: 325/29A Bạch Đằng, Phường 2"
        self.assertFalse(MODULE.normalize_address(row)[0].get("housenumber"))

    def test_house_recovered_from_raw_not_phone(self):
        a, _, _ = MODULE.normalize_address(record(None, raw="Số 325/29A Bạch Đằng, Phường 15"))
        self.assertEqual(a["housenumber"], "325/29A")
        row = record(None)
        row["description"] = "Địa chỉ: 0901234567 Bạch Đằng, Phường 15"
        self.assertFalse(MODULE.normalize_address(row)[0].get("housenumber"))

    def test_buildings_preserved_and_floors_not_collapsed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rows.jsonl"
            rows = [record("10"), record("10")]
            rows[0]["description"] = "Phòng tầng 2"
            rows[1]["description"] = "Phòng tầng 3"
            path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")
            self.assertFalse(next(iter(FULL.contexts(path).values()))["building_conflict"])
            rows[0]["description"] = "Tòa A, tầng 2"
            rows[1]["description"] = "Tòa B, tầng 3"
            path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")
            self.assertTrue(next(iter(FULL.contexts(path).values()))["building_conflict"])

    def test_candidate_number_boundaries_and_large_move_guard(self):
        task = {"address": record("12")["address_normalized"], "kind": "numbered"}
        search = [{"name": "123 Bạch Đằng", "ref_id": "a"}, {"name": "12 Bạch Đằng", "ref_id": "b"}]
        self.assertEqual([r["ref_id"] for r in FULL.rank_candidates(task, search)], ["b"])
        matched = {
            "full_address_match": True,
            "coordinates": [10.8, 106.7],
            "displacement_max_m": 1200,
            "place": {"hs_num": "12", "street": "Bạch Đằng"},
        }
        self.assertEqual(FULL.assess(task, [matched], {})["decision"], "preserve_large_displacement")
        matched["displacement_max_m"] = 100
        self.assertEqual(
            FULL.assess(task, [matched], {"building_conflict": True})["decision"], "preserve_building_conflict"
        )
        self.assertEqual(FULL.assess(task, [matched], {})["decision"], "update_address_position")

    def test_ward_mismatch_is_review(self):
        task = {
            "address": record("325/29A")["address_normalized"],
            "kind": "numbered",
            "city": "ho chi minh",
            "source_coordinates": [[10.800452, 106.70504]],
        }
        place = {
            "hs_num": "325/29A",
            "street": "Bạch Đằng",
            "ward": "Phường 2",
            "district": "Quận Bình Thạnh",
            "city": "Thành phố Hồ Chí Minh",
            "lat": 10.802045817,
            "lng": 106.704833945,
        }
        candidate = MODULE.evaluate_candidate(task, {}, place)
        self.assertFalse(candidate["full_address_match"])
        self.assertEqual(MODULE.classify(task, [candidate], 1), "ward_mismatch_review")
        place["ward"] = "Phường 15"
        candidate = MODULE.evaluate_candidate(task, {}, place)
        self.assertTrue(candidate["full_address_match"])
        self.assertFalse(candidate["precision_verified"])

    def test_far_and_invalid_coordinates_are_not_full_matches(self):
        task = {
            "address": record("10")["address_normalized"],
            "kind": "numbered",
            "city": "ho chi minh",
            "source_coordinates": [[10.8, 106.7]],
        }
        place = {
            "hs_num": "10",
            "street": "Bạch Đằng",
            "ward": "Phường 15",
            "district": "Quận Bình Thạnh",
            "city": "Hồ Chí Minh",
            "lat": 21.0,
            "lng": 105.8,
        }
        self.assertFalse(MODULE.evaluate_candidate(task, {}, place)["full_address_match"])
        place["lat"] = float("nan")
        self.assertIsNone(MODULE.evaluate_candidate(task, {}, place)["coordinates"])

    def test_two_coordinate_candidates_for_same_address_are_ambiguous(self):
        task = {"kind": "numbered"}
        common = {"full_address_match": True, "place": {"hs_num": "10", "street": "Bạch Đằng"}}
        a = {**common, "coordinates": [10.8, 106.7]}
        b = {**common, "coordinates": [10.801, 106.701]}
        self.assertEqual(MODULE.classify(task, [a, b], 2), "ambiguous_full_matches")

    def test_export_retains_listings_units_and_original_address(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.jsonl"
            first = record("50", "Hẻm 277 Đường Xô Viết Nghệ Tĩnh")
            second = copy.deepcopy(first)
            second["source_listing_id"] = "2"
            second["unit"]["unit_code"] = "tầng 2"
            before = [first, second]
            source.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in before) + "\n", encoding="utf-8")
            checksum = MODULE.sha256(source)
            MODULE.prepare(source, base / "output", 10)
            after = list(MODULE.read_jsonl(base / "output/housing-address-normalized.jsonl"))
            self.assertEqual(len(after), 2)
            for old, new in zip(before, after, strict=True):
                self.assertEqual(old["location"], new["location"])
                self.assertEqual(old["offer"], new["offer"])
                self.assertEqual(old["unit"], new["unit"])
                self.assertEqual(old["source_listing_id"], new["source_listing_id"])
                self.assertEqual(new["derived"]["address_normalization"]["original"], old["address_normalized"])
            tasks = list(MODULE.read_jsonl(base / "output/tasks.jsonl"))
            self.assertEqual(len(tasks), 1)
            self.assertEqual(tasks[0]["listing_count"], 2)
            self.assertEqual(MODULE.sha256(source), checksum)

    def test_full_export_moves_shared_building_without_merging_units(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.jsonl"
            rows = [record("10"), record("10")]
            for index, row in enumerate(rows):
                row["source_listing_id"] = str(index)
                row["unit"]["unit_code"] = "phòng " + str(index + 1)
                row["description"] = "Phòng tầng " + str(index + 1)
            source.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
            out = base / "out"
            MODULE.prepare(source, out, 10)
            task = next(MODULE.read_jsonl(out / "tasks.jsonl"))
            place = {
                "hs_num": "10",
                "street": "Bạch Đằng",
                "ward": "Phường 15",
                "district": "Quận Bình Thạnh",
                "city": "Hồ Chí Minh",
                "lat": 10.8006,
                "lng": 106.7052,
            }
            candidate = MODULE.evaluate_candidate(task, {}, place)
            assessment = FULL.assess(task, [candidate], FULL.contexts(source)[task["key"]])
            self.assertEqual(assessment["decision"], "update_address_position")
            (out / "full-candidates.jsonl").write_text(
                json.dumps({"key": task["key"], "assessment": assessment}) + "\n", encoding="utf-8"
            )
            FULL.export(out)
            after = list(MODULE.read_jsonl(out / "housing-geocoded.jsonl"))
            self.assertEqual(APPLY.validate_export(source, out / "housing-geocoded.jsonl"), 2)
            self.assertEqual([r["unit"] for r in after], [r["unit"] for r in rows])
            self.assertEqual([r["source_listing_id"] for r in after], ["0", "1"])
            for row in after:
                self.assertEqual(row["location"]["latitude"], 10.8006)
                self.assertEqual(row["location"]["accuracy"], "approximate")
                self.assertFalse(row["derived"]["housing_geocoding"]["independently_verified"])

    def test_database_protection_preserves_entire_original_position_and_address(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.jsonl"
            row = record("50", "Hẻm 277 Đường Xô Viết Nghệ Tĩnh")
            source.write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")
            out = base / "out"
            MODULE.prepare(source, out, 10)
            task = next(MODULE.read_jsonl(out / "tasks.jsonl"))
            (out / "full-candidates.jsonl").write_text(
                json.dumps(
                    {
                        "key": task["key"],
                        "assessment": {
                            "decision": "update_address_position",
                            "candidate": {"coordinates": [10.8006, 106.7052]},
                        },
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            MODULE.write_json(
                out / "db-protected.json",
                {"source_sha256": MODULE.sha256(source), "identities": {"test:1": "preserve_database_verified"}},
            )
            FULL.export(out)
            after = next(MODULE.read_jsonl(out / "housing-geocoded.jsonl"))
            self.assertEqual(after["address_normalized"], row["address_normalized"])
            self.assertEqual(after["location"], row["location"])
            self.assertEqual(list(MODULE.read_jsonl(out / "full-patch.jsonl")), [])

    def test_validation_rejects_price_change_and_copy_empty_stream(self):
        with tempfile.TemporaryDirectory() as directory:
            a = Path(directory) / "a.jsonl"
            b = Path(directory) / "b.jsonl"
            row = record("10")
            a.write_text(json.dumps(row) + "\n", encoding="utf-8")
            row["offer"]["price_amount"] = 1
            b.write_text(json.dumps(row) + "\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                APPLY.validate_export(a, b)
        self.assertNotIn("STDIN;\n\n", APPLY.payload_sql([]))

    def test_provider_shared_pin_for_different_houses_is_not_applied(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.jsonl"
            out = base / "out"
            rows = [record("10"), record("12")]
            rows[1]["source_listing_id"] = "2"
            source.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
            MODULE.prepare(source, out, 10)
            entries = []
            for task in MODULE.read_jsonl(out / "tasks.jsonl"):
                match = {"coordinates": [10.8006, 106.7052], "place": {"hs_num": task["address"]["housenumber"]}}
                entries.append(
                    {"key": task["key"], "assessment": {"decision": "update_address_position", "candidate": match}}
                )
            (out / "full-candidates.jsonl").write_text(
                "\n".join(json.dumps(e) for e in entries) + "\n", encoding="utf-8"
            )
            FULL.export(out)
            after = list(MODULE.read_jsonl(out / "housing-geocoded.jsonl"))
            for old, new in zip(rows, after, strict=True):
                self.assertEqual(old["location"], new["location"])
                self.assertEqual(new["derived"]["housing_geocoding"]["decision"], "preserve_provider_shared_pin")

    def test_incremental_export_keeps_previous_pin_when_new_evidence_is_unresolved_or_collides(self):
        for collision in (False, True):
            with self.subTest(collision=collision), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                source, out = base / "source.jsonl", base / "out"
                rows = [record("10"), record("12")]
                rows[1]["source_listing_id"] = "2"
                text = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n"
                source.write_text(text, encoding="utf-8")
                MODULE.prepare(source, out, 10)
                frozen = out / "housing-original.jsonl"
                frozen.write_text(text, encoding="utf-8")
                current = copy.deepcopy(rows)
                current[0]["location"].update(latitude=10.801, longitude=106.706, method="vietmap_geocode_v4")
                source.write_text("\n".join(json.dumps(r) for r in current) + "\n", encoding="utf-8")
                inventory = json.loads((out / "inventory.json").read_text(encoding="utf-8"))
                inventory.update(frozen_source=str(frozen), live_source_sha256=MODULE.sha256(source))
                MODULE.write_json(out / "inventory.json", inventory)
                entries = []
                for task in MODULE.read_jsonl(out / "tasks.jsonl"):
                    candidate = {"coordinates": [10.802, 106.707], "place": {"hs_num": task["address"]["housenumber"]}}
                    entries.append({"key": task["key"], "assessment": {
                        "decision": "update_address_position" if collision else "preserve_unresolved",
                        "candidate": candidate if collision else None,
                    }})
                (out / "full-candidates.jsonl").write_text("\n".join(json.dumps(r) for r in entries) + "\n", encoding="utf-8")
                FULL.export(out)
                after = list(MODULE.read_jsonl(out / "housing-geocoded.jsonl"))
                self.assertEqual(after[0]["location"], current[0]["location"])
                self.assertEqual(after[1]["location"], current[1]["location"])
                self.assertTrue(after[0]["derived"]["housing_geocoding"]["preserved_current_location"])
                self.assertEqual(APPLY.validate_export(frozen, out / "housing-geocoded.jsonl"), 2)
                exported = json.loads((out / "full-export.json").read_text(encoding="utf-8"))
                self.assertEqual(exported["counts"]["coordinate_changed"], 1)
                self.assertEqual(exported["counts"]["coordinates_changed_this_batch"], 0)

    def test_partial_export_retains_pending_and_can_continue_from_frozen_source(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.jsonl"
            out = base / "out"
            rows = [record("10"), record("12")]
            rows[1]["source_listing_id"] = "2"
            text = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n"
            source.write_text(text, encoding="utf-8")
            MODULE.prepare(source, out, 10)
            tasks = list(MODULE.read_jsonl(out / "tasks.jsonl"))
            chosen = next(t for t in tasks if t["address"]["housenumber"] == "10")
            place = {
                "hs_num": "10",
                "street": "Bạch Đằng",
                "ward": "Phường 15",
                "district": "Quận Bình Thạnh",
                "city": "Hồ Chí Minh",
                "lat": 10.8006,
                "lng": 106.7052,
            }
            candidate = MODULE.evaluate_candidate(chosen, {}, place)
            (out / "full-candidates.jsonl").write_text(
                json.dumps({"key": chosen["key"], "assessment": FULL.assess(chosen, [candidate], {})}) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                FULL.export(out)
            FULL.export(out, allow_partial=True)
            after = list(MODULE.read_jsonl(out / "housing-geocoded.jsonl"))
            self.assertEqual(after[1]["location"], rows[1]["location"])
            self.assertEqual(after[1]["derived"]["housing_geocoding"]["decision"], "pending_geocode_quota")
            frozen = out / "housing-original.jsonl"
            frozen.write_text(text, encoding="utf-8")
            source.write_bytes((out / "housing-geocoded.jsonl").read_bytes())
            inventory = json.loads((out / "inventory.json").read_text(encoding="utf-8"))
            inventory.update(frozen_source=str(frozen), live_source_sha256=MODULE.sha256(source))
            MODULE.write_json(out / "inventory.json", inventory)
            FULL.export(out, allow_partial=True)
            self.assertEqual(list(MODULE.read_jsonl(out / "full-patch.jsonl")), [])
            self.assertEqual(MODULE.sha256(out / "housing-geocoded.jsonl"), MODULE.sha256(source))


if __name__ == "__main__":
    unittest.main()
