"""Offline address normalization and resumable, bounded VIETMAP housing review.

Writes a separate dataset and candidate reports. Never updates the live source,
DB, verified status, prices, bedrooms, or listing identities. Candidates require
independent review before coordinates may be applied.
"""

import argparse
import copy
import hashlib
import json
import math
import random
import re
import time
import unicodedata
from collections import Counter
from datetime import UTC, datetime
from itertools import zip_longest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RULE = "housing_address_v1"
DEFAULT_SOURCE = ROOT / "Maps VN/Data/housing_clean_2026-09-26.jsonl"
DEFAULT_OUTPUT = ROOT / "data/housing-geocode"
CITIES = {"ho chi minh", "ha noi", "da nang"}


def folded(value):
    text = unicodedata.normalize("NFD", str(value or "").casefold().replace("đ", "d"))
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


def clean(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def component(value, kind):
    text = folded(clean(value))
    prefixes = {
        "street": r"^(?:duong|d\.)\s*",
        "ward": r"^(?:phuong|p\.)\s*",
        "district": r"^(?:quan|q\.)\s*",
        "city": r"^(?:thanh pho|tp\.?|tinh)\s*",
    }
    if kind in prefixes:
        text = re.sub(prefixes[kind], "", text).strip()
    if kind == "city" and text in {"hcm", "tphcm", "tp.hcm", "sai gon"}:
        return "ho chi minh"
    return text


def normalize_address(record):
    """Transform explicit address evidence only; no nearby-landmark or LLM guessing."""
    original = copy.deepcopy(record.get("address_normalized") or {})
    result = copy.deepcopy(original)
    evidence = []
    for key in ["housenumber", "street", "ward", "district", "city", "country"]:
        if result.get(key) is not None:
            value = clean(result[key])
            if value != result[key]:
                result[key] = value
                evidence.append({"field": key, "rule": "trim_whitespace", "source": "address_normalized." + key})
    house, street = clean(result.get("housenumber")), clean(result.get("street"))
    # Example: house="29 Ngõ Hàng Cháo", street="Hàng Cháo".
    named = re.fullmatch(r"(\d+[A-Za-z]?)\s+((?:Ngõ|Hẻm|Ngách)\s+.+)", house, re.I)
    if named and component(re.sub(r"^(Ngõ|Hẻm|Ngách)\s+", "", named[2], flags=re.I), "street") == component(
        street, "street"
    ):
        house, street = named[1], named[2]
        evidence.append({"rule": "named_alley_in_house_field", "source": "address_normalized.housenumber"})
    # Example: house="50", street="Hẻm 277 Đường Xô Viết Nghệ Tĩnh".
    alley = re.fullmatch(r"(?:Ngõ|Hẻm)\s+(\d+[A-Za-z]?(?:/\d+[A-Za-z]?)*)\s+(?:Đường\s+)?(.+)", street, re.I)
    if alley and re.fullmatch(r"\d+[A-Za-z]?(?:/\d+[A-Za-z]?)*", house):
        house, street = (
            (house if folded(house).startswith(folded(alley[1]) + "/") else alley[1] + "/" + house),
            alley[2],
        )
        evidence.append(
            {"rule": "explicit_alley_and_house_to_slash", "source": "address_normalized.street+housenumber"}
        )
    # Do not interpret street names such as "3 Tháng 2" as house numbers.
    lead = re.fullmatch(r"(\d+[A-Za-z]?(?:/\d+[A-Za-z]?)*)\s+(.+)", street)
    is_date_road = bool(re.match(r"^\d+\s+thang\s+\d+\b", folded(street)))
    if not house and lead and not is_date_road and not re.match(r"^(thang|duong|ngay)\b", folded(lead[2])):
        # Only accept if the raw address explicitly repeats the same initial text.
        raw_first = clean(record.get("address_raw")).split(",")[0]
        if component(raw_first, "street") == component(street, "street"):
            house, street = lead[1], lead[2]
            evidence.append(
                {
                    "rule": "number_embedded_in_street_confirmed_by_raw",
                    "source": "address_normalized.street+address_raw",
                }
            )
    if not house and street:
        raw_first = clean(record.get("address_raw")).split(",")[0]
        raw_number = re.fullmatch(
            r"(?:Số\s+)?(\d{1,5}[A-Za-z]?(?:/\d{1,5}[A-Za-z]?){0,5})\s+(?:Đường\s+)?(.+)", raw_first, re.I
        )
        if raw_number and component(raw_number[2], "street") == component(street, "street"):
            house = raw_number[1]
            evidence.append({"rule": "explicit_number_in_raw_address", "source": "address_raw"})
    if not house and street:
        # Only an explicit address line, exactly the known street; never a nearby landmark/phone.
        hints = []
        for match in re.finditer(
            r"(?:^|\n)\s*(?:Địa chỉ|Đ/c|ĐC)\s*[:\-]\s*(?:Số\s+)?(\d{1,5}[A-Za-z]?(?:/\d{1,5}[A-Za-z]?){0,5})\s+(?:Đường\s+)?([^\n]{3,180})",
            record.get("description") or "",
            re.I,
        ):
            stated_street = clean(match[2].split(",")[0].split(";")[0])
            stated_ward = re.search(r"\bPhường\s+(\d+)\b", match[2], re.I)
            ward_conflict = (
                stated_ward
                and component(result.get("ward"), "ward").isdigit()
                and component(result.get("ward"), "ward") != stated_ward[1]
            )
            if component(stated_street, "street") == component(street, "street") and not ward_conflict:
                hints.append(match)
        if len({m[1].casefold() for m in hints}) == 1:
            house = hints[0][1]
            evidence.append(
                {"rule": "explicit_description_address_same_street", "source": "description", "excerpt": hints[0][0]}
            )
    if house != clean(result.get("housenumber")):
        result["housenumber"] = house or None
    if street != clean(result.get("street")):
        result["street"] = street or None
    city = component(result.get("city"), "city")
    if city not in CITIES:
        kind = "outside_scope"
    elif house and street:
        kind = "numbered"
    elif street:
        kind = "street_only"
    else:
        kind = "missing_address"
    return result, evidence, kind


def task_key(address):
    values = [component(address.get(k), k) for k in ["country", "city", "district", "ward", "street", "housenumber"]]
    return hashlib.sha256(json.dumps(values, ensure_ascii=False).encode()).hexdigest()


def address_text(address):
    first = clean(" ".join(clean(address.get(k)) for k in ["housenumber", "street"]))
    return ", ".join([first] + [clean(address[k]) for k in ["ward", "district", "city"] if address.get(k)])


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepared_source(inventory):
    """Use the immutable input after applying an incremental live data batch."""
    return Path(inventory.get("frozen_source") or inventory["source"])


def read_jsonl(path):
    with path.open(encoding="utf-8-sig") as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def write_json(path, data):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Windows readers/editors can briefly deny replacement even though the
    # directory is writable. Retry that sharing window without sending another
    # API request or replacing atomic writes with a partially written JSON file.
    for attempt in range(10):
        try:
            temporary.replace(path)
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(min(0.02 * (2**attempt), 0.25))


def prepare(source, output, per_city=100):
    output.mkdir(parents=True, exist_ok=True)
    source_hash = sha256(source)
    tasks = {}
    counts, changes, categories = Counter(), Counter(), Counter()
    normalized_path = output / "housing-address-normalized.jsonl"
    if source.resolve() == normalized_path.resolve():
        raise ValueError("Output must be separate from the source")
    temporary = normalized_path.with_suffix(".jsonl.tmp")
    with temporary.open("w", encoding="utf-8") as target:
        for row in read_jsonl(source):
            counts["records"] += 1
            address, evidence, kind = normalize_address(row)
            categories[kind] += 1
            changed = address != (row.get("address_normalized") or {})
            if changed:
                original_address = copy.deepcopy(row.get("address_normalized") or {})
                row = copy.deepcopy(row)
                row["address_normalized"] = address
                row.setdefault("derived", {})["address_normalization"] = {
                    "rule": RULE,
                    "original": copy.deepcopy(
                        row.get("derived", {}).get("address_normalization", {}).get("original") or original_address
                    ),
                    "evidence": evidence,
                }
                counts["normalized_records"] += 1
                changes.update(e["rule"] for e in evidence)
            target.write(json.dumps(row, ensure_ascii=False) + "\n")
            if kind not in {"numbered", "street_only"}:
                continue
            key = task_key(address)
            loc = row.get("location") or {}
            if key not in tasks:
                tasks[key] = {
                    "key": key,
                    "address": address,
                    "query": address_text(address),
                    "kind": kind,
                    "city": component(address.get("city"), "city"),
                    "listing_count": 0,
                    "recovered_records": 0,
                    "normalization_evidence": evidence,
                    "listings": [],
                    "source_coordinates": [],
                    "protected_records": 0,
                }
            item = tasks[key]
            item["listing_count"] += 1
            item["recovered_records"] += int(any(e["rule"] != "trim_whitespace" for e in evidence))
            item["listings"].append(str(row["source_type"]) + ":" + str(row["source_listing_id"]))
            coords = [loc.get("latitude"), loc.get("longitude")]
            if coords not in item["source_coordinates"]:
                item["source_coordinates"].append(coords)
            item["protected_records"] += int(row.get("verification", {}).get("status") == "lifeflow_verified")
    if sha256(source) != source_hash:
        raise RuntimeError("Source changed during prepare; do not use output")
    temporary.replace(normalized_path)
    ordered = sorted(tasks.values(), key=lambda t: t["key"])
    with (output / "tasks.jsonl").open("w", encoding="utf-8") as stream:
        for task in ordered:
            stream.write(json.dumps(task, ensure_ascii=False) + "\n")
    # A reproducible random ordering per stratum; uniform address keys, not listing rows.
    sample, strata = [], {}
    for city in sorted(CITIES):
        for kind, wanted in [("numbered", per_city - per_city // 10), ("street_only", per_city // 10)]:
            group = [t for t in ordered if t["city"] == city and t["kind"] == kind]
            group.sort(key=lambda t: hashlib.sha256(("pilot-v1:" + t["key"]).encode()).hexdigest())
            chosen = group[:wanted]
            sample.extend(t["key"] for t in chosen)
            strata[city + ":" + kind] = {
                "population_keys": len(group),
                "population_listings": sum(t["listing_count"] for t in group),
                "sample_keys": len(chosen),
            }
    inventory = {
        "rule": RULE,
        "source": str(source.resolve()),
        "source_sha256": source_hash,
        "normalized_sha256": sha256(normalized_path),
        "counts": dict(counts),
        "categories": dict(categories),
        "changes": dict(changes),
        "unique_tasks": len(tasks),
        "unique_numbered_tasks": sum(t["kind"] == "numbered" for t in ordered),
        "strata": strata,
        "sample_size": len(sample),
        "sample_design": "Uniform address-key sample within city/kind; listing-weighted population estimator",
        "free_quota_remaining": "not verified from account console",
        "live_source_unchanged": True,
    }
    write_json(output / "inventory.json", inventory)
    write_json(output / "sample.json", {"source_sha256": source_hash, "keys": sample})
    print(json.dumps(inventory, ensure_ascii=True))


def distance_m(old, new):
    if any(v is None for v in old + new):
        return None
    p1, p2 = math.radians(float(old[0])), math.radians(float(new[0]))
    value = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(math.radians(float(new[1]) - float(old[1])) / 2) ** 2
    )
    return round(6371000 * 2 * math.asin(min(1, math.sqrt(value))), 1)


def evaluate_candidate(task, candidate, place):
    address = task["address"]
    checks = {
        k: bool(address.get(k)) and component(address.get(k), k) == component(place.get(p), k)
        for k, p in [
            ("housenumber", "hs_num"),
            ("street", "street"),
            ("ward", "ward"),
            ("district", "district"),
            ("city", "city"),
        ]
    }
    lat, lng = place.get("lat"), place.get("lng")
    coordinates = None
    if (
        isinstance(lat, (int, float))
        and not isinstance(lat, bool)
        and isinstance(lng, (int, float))
        and not isinstance(lng, bool)
        and math.isfinite(lat)
        and math.isfinite(lng)
    ):
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            coordinates = [lat, lng]
    expected_bbox = {
        "ho chi minh": (10.3, 106.1, 11.3, 107.2),
        "ha noi": (20.5, 105.1, 21.5, 106.3),
        "da nang": (15.6, 107.8, 16.5, 108.5),
    }
    bounds = expected_bbox.get(task["city"])
    in_region = bool(coordinates and bounds and bounds[0] <= lat <= bounds[2] and bounds[1] <= lng <= bounds[3])
    shifts = [distance_m(old, coordinates) for old in task["source_coordinates"]] if coordinates else []
    shifts = [s for s in shifts if s is not None]
    return {
        "search": candidate,
        "place": place,
        "coordinates": coordinates,
        "component_matches": checks,
        "full_address_match": all(checks.values()) and in_region,
        "in_expected_region": in_region,
        "displacement_min_m": min(shifts) if shifts else None,
        "displacement_max_m": max(shifts) if shifts else None,
        "precision_verified": False,
    }


def classify(task, candidates, search_count):
    if task["kind"] == "street_only":
        return "street_only"
    matches = [c for c in candidates if c["full_address_match"]]
    unique = {(tuple(c["coordinates"]), c["place"].get("hs_num"), c["place"].get("street")) for c in matches}
    if len(unique) > 1:
        return "ambiguous_full_matches"
    if matches:
        return "address_match_needs_verification"
    if not search_count:
        return "no_results"
    partial = [
        c
        for c in candidates
        if c["in_expected_region"]
        and all(c["component_matches"][k] for k in ["housenumber", "street", "district", "city"])
    ]
    return "ward_mismatch_review" if partial else "unmatched_review"


def geocode(output, max_requests, rpm, selection="sample", limit=None):
    import httpx
    from dotenv import dotenv_values

    if not 1 <= rpm <= 150 or not 1 <= max_requests <= 60000:
        raise ValueError("Use 1..150 total RPM and an explicit request budget <=60000")
    inventory = json.loads((output / "inventory.json").read_text(encoding="utf-8"))
    if sha256(prepared_source(inventory)) != inventory["source_sha256"]:
        raise ValueError("Source changed; prepare a fresh inventory first")
    all_tasks = {t["key"]: t for t in read_jsonl(output / "tasks.jsonl")}
    if selection == "sample":
        keys = json.loads((output / "sample.json").read_text(encoding="utf-8"))["keys"]
    else:
        keys = [k for k, t in all_tasks.items() if t["kind"] == "numbered"]
    if limit is not None:
        keys = keys[:limit]
    key = clean(dotenv_values(ROOT / ".env.local").get("VIETMAP_API_KEY"))
    if not key:
        raise ValueError("VIETMAP_API_KEY missing")
    cache_path = output / "cache.json"
    cache = (
        json.loads(cache_path.read_text(encoding="utf-8"))
        if cache_path.exists()
        else {"requests": {}, "request_count": 0}
    )
    results_path = output / "candidates.jsonl"
    completed = {r["key"]: r for r in read_jsonl(results_path)} if results_path.exists() else {}
    requested, cache_hits, last_started = 0, 0, 0.0
    stopped = None
    ledger_path = output / "requests.jsonl"

    class StopError(Exception):
        pass

    with (
        httpx.Client(timeout=25, follow_redirects=False) as client,
        ledger_path.open("a", encoding="utf-8") as ledger,
        results_path.open("a", encoding="utf-8") as results_stream,
    ):

        def call(endpoint, params):
            nonlocal requested, cache_hits, last_started
            cache_key = hashlib.sha256(json.dumps([endpoint, params], sort_keys=True).encode()).hexdigest()
            if cache_key in cache["requests"]:
                cache_hits += 1
                return cache["requests"][cache_key]
            for attempt in range(3):
                if cache["request_count"] >= max_requests:
                    raise StopError("request_budget_exhausted")
                time.sleep(max(0, 60 / rpm - (time.monotonic() - last_started)))
                last_started = time.monotonic()
                requested += 1
                cache["request_count"] += 1
                started = time.monotonic()
                log = {
                    "time": datetime.now(UTC).isoformat(),
                    "endpoint": endpoint,
                    "attempt": attempt + 1,
                    "cache_key": cache_key,
                }
                try:
                    response = client.get("https://maps.vietmap.vn/api/" + endpoint, params={"apikey": key, **params})
                    log["status"] = response.status_code
                    log["elapsed_s"] = round(time.monotonic() - started, 3)
                    ledger.write(json.dumps(log) + "\n")
                    ledger.flush()
                    try:
                        body = json.loads(json.dumps(response.json(), ensure_ascii=False).replace(key, "[REDACTED]"))
                    except ValueError:
                        body = {"error": "non_json_response"}
                    if response.status_code == 200:
                        cache["requests"][cache_key] = body
                        write_json(cache_path, cache)
                        return body
                    write_json(cache_path, cache)
                    if response.status_code in {429, 500, 502, 503, 504} and attempt < 2:
                        try:
                            delay = float(response.headers.get("retry-after", "5"))
                        except ValueError:
                            delay = 5
                        if delay > 60:
                            raise StopError("long_retry_after_resume_later")
                        time.sleep(max(1, min(60, delay * (attempt + 1))))
                        continue
                    raise StopError("http_" + str(response.status_code))
                except httpx.HTTPError as exc:
                    log["error"] = type(exc).__name__
                    log["elapsed_s"] = round(time.monotonic() - started, 3)
                    ledger.write(json.dumps(log) + "\n")
                    ledger.flush()
                    write_json(cache_path, cache)
                    if attempt < 2:
                        time.sleep(2 * (attempt + 1))
                        continue
                    raise StopError(type(exc).__name__) from None

        try:
            for task_key_value in keys:
                if task_key_value in completed:
                    continue
                task = all_tasks[task_key_value]
                # No old-coordinate focus: test ability to find the address independently of the existing pin.
                search = call("search/v4", {"text": task["query"], "display_type": 6, "layers": "ADDRESS,STREET"})
                if not isinstance(search, list):
                    raise StopError("unexpected_search_shape")
                candidates = []
                if task["kind"] == "numbered":
                    for candidate in search[:3]:
                        if not isinstance(candidate, dict) or not candidate.get("ref_id"):
                            continue
                        place = call("place/v4", {"refid": candidate["ref_id"]})
                        if not isinstance(place, dict) or "lat" not in place or "lng" not in place:
                            raise StopError("unexpected_place_shape")
                        candidates.append(evaluate_candidate(task, candidate, place))
                result = {
                    "key": task_key_value,
                    "query": task["query"],
                    "city": task["city"],
                    "kind": task["kind"],
                    "listing_count": task["listing_count"],
                    "search_count": len(search),
                    "search_response": search,
                    "candidates": candidates,
                    "status": classify(task, candidates, len(search)),
                    "independently_verified": False,
                    "applied": False,
                }
                results_stream.write(json.dumps(result, ensure_ascii=False) + "\n")
                results_stream.flush()
                completed[task_key_value] = result
                if len(completed) % 10 == 0:
                    print(
                        json.dumps(
                            {
                                "completed": len(completed),
                                "selected": len(keys),
                                "requests_this_run": requested,
                                "statuses": dict(Counter(r["status"] for r in completed.values())),
                            }
                        ),
                        flush=True,
                    )
        except StopError as exc:
            stopped = str(exc)
        finally:
            write_json(cache_path, cache)
            run = {
                "selected": len(keys),
                "completed_selected": sum(k in completed for k in keys),
                "requests_this_run": requested,
                "total_recorded_requests": cache["request_count"],
                "cache_hits_this_run": cache_hits,
                "stopped_reason": stopped,
                "source_unchanged": sha256(Path(inventory["source"])) == inventory["source_sha256"],
                "live_data_applied": False,
            }
            write_json(output / "last-run.json", run)
            print(json.dumps(run), flush=True)


def report(output):
    inventory = json.loads((output / "inventory.json").read_text(encoding="utf-8"))
    tasks = {t["key"]: t for t in read_jsonl(output / "tasks.jsonl")}
    sample = json.loads((output / "sample.json").read_text(encoding="utf-8"))["keys"]
    results = (
        {r["key"]: r for r in read_jsonl(output / "candidates.jsonl")} if (output / "candidates.jsonl").exists() else {}
    )
    sample_results = [results[k] for k in sample if k in results]
    summary = {
        "records": inventory["counts"]["records"],
        "numbered_records": inventory["categories"].get("numbered", 0),
        "numbered_record_percent": round(
            100 * inventory["categories"].get("numbered", 0) / inventory["counts"]["records"], 2
        ),
        "unique_numbered_tasks": inventory["unique_numbered_tasks"],
        "normalized_records": inventory["counts"].get("normalized_records", 0),
        "sample_selected": len(sample),
        "sample_completed": len(sample_results),
        "statuses": dict(Counter(r["status"] for r in sample_results)),
        "independently_verified": 0,
        "applied_coordinate_updates": 0,
        "source_unchanged": sha256(Path(inventory["source"])) == inventory["source_sha256"],
        "strata": {},
        "estimate_is_address_component_match_not_position_accuracy": True,
    }
    expected = 0.0
    samples_by_stratum = {}
    for name, info in inventory["strata"].items():
        city, kind = name.split(":")
        subset = [r for r in sample_results if r["city"] == city and r["kind"] == kind]
        full = sum(r["status"] == "address_match_needs_verification" for r in subset)
        summary["strata"][name] = {**info, "completed": len(subset), "full_address_matches": full}
        if kind == "numbered" and subset:
            # Horvitz-Thompson estimator: sampled address keys selected uniformly within stratum.
            weighted = (
                info["population_keys"]
                / len(subset)
                * sum(
                    tasks[r["key"]]["listing_count"]
                    for r in subset
                    if r["status"] == "address_match_needs_verification"
                )
            )
            expected += weighted
            summary["strata"][name]["estimated_matching_listings"] = round(weighted)
            samples_by_stratum[name] = subset
    if summary["sample_completed"] == summary["sample_selected"] and samples_by_stratum:
        expected = min(summary["numbered_records"], expected)
        summary["estimated_component_matching_records"] = round(expected)
        summary["estimated_component_matching_percent_all_source"] = round(100 * expected / summary["records"], 2)
        rng = random.Random(20261005)
        bootstrap = []
        for _ in range(1000):
            total = 0
            for name, subset in samples_by_stratum.items():
                drawn = rng.choices(subset, k=len(subset))
                total += (
                    inventory["strata"][name]["population_keys"]
                    / len(subset)
                    * sum(
                        tasks[r["key"]]["listing_count"]
                        for r in drawn
                        if r["status"] == "address_match_needs_verification"
                    )
                )
            bootstrap.append(100 * min(summary["numbered_records"], total) / summary["records"])
        bootstrap.sort()
        summary["bootstrap_95_percent_interval_all_source"] = [round(bootstrap[24], 2), round(bootstrap[974], 2)]
    write_json(output / "summary.json", summary)
    patch_path = output / "coordinate-candidates.jsonl"
    with patch_path.open("w", encoding="utf-8") as stream:
        for key, result in results.items():
            if result["status"] != "address_match_needs_verification":
                continue
            match = next(c for c in result["candidates"] if c["full_address_match"])
            task = tasks[key]
            patch = {
                "key": key,
                "listings": task["listings"],
                "source_sha256": inventory["source_sha256"],
                "old_coordinates": task["source_coordinates"],
                "candidate_coordinates": match["coordinates"],
                "source_address": task["address"],
                "provider_address": match["place"],
                "displacement_max_m": match["displacement_max_m"],
                "protected_records": task["protected_records"],
                "status": "needs_independent_review",
                "applied": False,
                "precision_verified": False,
            }
            stream.write(json.dumps(patch, ensure_ascii=False) + "\n")
    rows = []
    for name, info in summary["strata"].items():
        rows.append(
            f"| {name} | {info['population_listings']} | {info['completed']}/{info['sample_keys']} | {info['full_address_matches']} |"
        )
    text = (
        f"""# Housing geocode — kết quả chạy

- Source: {summary["records"]:,} tin. Không đồng nghĩa số tin active trong DB.
- Chuẩn hóa cấu trúc địa chỉ: {summary["normalized_records"]:,} tin; giữ địa chỉ gốc trong metadata.
- Tin trong 3 thành phố có số nhà + đường: {summary["numbered_records"]:,} ({summary["numbered_record_percent"]}%).
- Địa chỉ có số nhà duy nhất sau chuẩn hóa: {summary["unique_numbered_tasks"]:,}.
- Mẫu hoàn tất: {summary["sample_completed"]}/{summary["sample_selected"]} địa chỉ.
- Trạng thái: `{json.dumps(summary["statuses"], ensure_ascii=False)}`.
- Source không đổi: {summary["source_unchanged"]}; cập nhật tọa độ live: 0.

| Thành phố/nhóm | Tổng tin trong nhóm | Mẫu hoàn tất | Khớp đủ thành phần |
|---|---:|---:|---:|
"""
        + "\n".join(rows)
        + "\n"
    )
    if "estimated_component_matching_percent_all_source" in summary:
        text += f"\nƯớc lượng số tin có candidate khớp đủ địa chỉ: **{summary['estimated_component_matching_records']:,} ({summary['estimated_component_matching_percent_all_source']}% toàn source)**. Khoảng bootstrap 95%: {summary['bootstrap_95_percent_interval_all_source']}. Đây là dự báo khớp thành phần địa chỉ, KHÔNG phải tỷ lệ tọa độ đã đúng hoặc đã cải thiện. Mẫu chọn đều khóa địa chỉ theo thành phố/nhóm, ước lượng có trọng số số tin mỗi khóa.\n"
    text += """
## Đầu ra

- `housing-address-normalized.jsonl`: bản nguồn riêng, chỉ thay cấu trúc địa chỉ có bằng chứng; chưa đổi tọa độ.
- `coordinate-candidates.jsonl`: đề xuất tọa độ khớp đủ thành phần, chưa apply. Review ca khác tọa độ trong cùng địa chỉ, dịch chuyển xa và bảo vệ tin đã verified.
- `candidates.jsonl`: mọi kết quả, kể cả khác phường, không khớp và chỉ có tên đường.
- `cache.json`, `requests.jsonl`: tiếp tục không gọi lại các request thành công. Quota là tổng request đã ghi trong công cụ, không phải số dư miễn phí trên tài khoản.
- Không xóa/gộp tin, không rải pin giả, không nâng kết quả lên rooftop. Không có bước tự ghi DB.

Các tỷ lệ là khả năng tìm candidate. Chưa có tập tham chiếu GPS/cổng nhà để chứng minh độ chính xác, chưa xác nhận quyền lưu/export lâu dài của provider.
"""
    (output / "README.md").write_text(text, encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=True))


def verify(output):
    inventory = json.loads((output / "inventory.json").read_text(encoding="utf-8"))
    source = prepared_source(inventory)
    if sha256(source) != inventory["source_sha256"]:
        raise ValueError("Source checksum changed")
    normalized = output / "housing-address-normalized.jsonl"
    if sha256(normalized) != inventory["normalized_sha256"]:
        raise ValueError("Normalized file checksum changed")
    count, changed = 0, 0
    missing = object()
    for before, after in zip_longest(read_jsonl(source), read_jsonl(normalized), fillvalue=missing):
        if before is missing or after is missing:
            raise ValueError("Record count changed")
        count += 1
        if before.get("address_normalized") != after.get("address_normalized"):
            changed += 1
            provenance = after.get("derived", {}).get("address_normalization", {})
            if provenance.get("original") != before.get("derived", {}).get("address_normalization", {}).get(
                "original", before.get("address_normalized")
            ):
                raise ValueError("Original address provenance is missing")
        recovered = copy.deepcopy(after)
        recovered["address_normalized"] = before.get("address_normalized")
        recovered_derived = copy.deepcopy(after.get("derived", {}))
        if "address_normalization" in before.get("derived", {}):
            recovered_derived["address_normalization"] = before["derived"]["address_normalization"]
        else:
            recovered_derived.pop("address_normalization", None)
        recovered["derived"] = recovered_derived
        if recovered != before:
            raise ValueError("Non-address content changed")
    result = {
        "records_preserved": count,
        "normalized_records": changed,
        "coordinates_price_units_ids_media_all_unchanged": True,
        "source_unchanged": True,
        "normalized_checksum_valid": True,
    }
    write_json(output / "verification.json", result)
    print(json.dumps(result))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["prepare", "geocode", "report", "verify"])
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--per-city", type=int, default=100)
    parser.add_argument("--max-requests", type=int, default=1200)
    parser.add_argument("--rpm", type=int, default=120)
    parser.add_argument("--selection", choices=["sample", "numbered"], default="sample")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    if args.mode == "prepare":
        if args.per_city < 10:
            parser.error("--per-city must be >=10")
        prepare(args.source, args.output, args.per_city)
    elif args.mode == "geocode":
        geocode(args.output, args.max_requests, args.rpm, args.selection, args.limit)
    elif args.mode == "verify":
        verify(args.output)
    else:
        report(args.output)


if __name__ == "__main__":
    main()
