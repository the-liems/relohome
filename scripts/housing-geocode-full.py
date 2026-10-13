"""Whole-source geocoding, durable cache, building-aware export; no app logic edits."""

import argparse
import asyncio
import copy
import hashlib
import importlib.util
import json
import math
import os
import re
import time
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("housing_geocode", Path(__file__).with_name("housing-geocode.py"))
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)
RULE = "vietmap_housing_full_v1"
STREET_POLICY = "vietmap_street_approximate_v2"
UPDATE_DECISIONS = {"update_address_position", "update_street_position"}


def site_context(row):
    project = BASE.clean(row.get("unit", {}).get("attributes", {}).get("project"))
    towers = []
    text = (row.get("title") or "") + "\n" + (row.get("description") or "")
    for m in re.finditer(r"\b(?:tòa|toà|block|tháp)\s+([A-Za-z][A-Za-z0-9-]{0,8}|\d{1,3})(?!\w)", text, re.I):
        value = BASE.folded(m[1])
        if (
            value
            not in {
                "nha",
                "nhieu",
                "can",
                "chung",
                "dep",
                "moi",
                "van",
                "cao",
                "nam",
                "duoc",
                "co",
                "mat",
                "cho",
                "khong",
                "tai",
                "tong",
            }
            and value not in towers
        ):
            towers.append(value)
    floor = [m[1] for m in re.finditer(r"\btầng\s*(\d{1,3})(?!\d)", text, re.I)]
    return {
        "project": project or None,
        "towers": sorted(towers),
        "unit_code": row.get("unit", {}).get("unit_code"),
        "floor_hints": sorted(set(floor)),
        "multiple_tower_mentions": len(towers) > 1,
    }


def contexts(source):
    grouped = defaultdict(lambda: {"projects": set(), "towers": set(), "record_count": 0, "protected": 0})
    for row in BASE.read_jsonl(source):
        address, _, kind = BASE.normalize_address(row)
        if kind not in {"numbered", "street_only"}:
            continue
        item = grouped[BASE.task_key(address)]
        site = site_context(row)
        if site["project"]:
            item["projects"].add(BASE.folded(site["project"]))
        item["towers"].update(site["towers"])
        item["record_count"] += 1
        item["protected"] += int(row.get("verification", {}).get("status") in {"source_verified", "lifeflow_verified"})
    return {
        key: {
            **value,
            "projects": sorted(value["projects"]),
            "towers": sorted(value["towers"]),
            "building_conflict": len(value["projects"]) > 1 or len(value["towers"]) > 1,
        }
        for key, value in grouped.items()
    }


def rank_candidates(task, search):
    scored = []
    expected = BASE.component(task["address"].get("housenumber"), "housenumber")
    street = BASE.component(task["address"].get("street"), "street")
    for index, candidate in enumerate(search):
        if not isinstance(candidate, dict) or not candidate.get("ref_id"):
            continue
        name = BASE.folded(BASE.clean(candidate.get("name")))
        address = BASE.folded(BASE.clean(candidate.get("display")))
        house_match = bool(expected and re.search(r"(?<![\w/])" + re.escape(expected) + r"(?![\w/])", name))
        if "/" in expected:
            alley, _, house = expected.rpartition("/")
            house_match = house_match or bool(
                re.search(r"^" + re.escape(house) + r"\s+(?:ngo|hem|ngach)\s+" + re.escape(alley) + r"\b", name)
            )
        if task["kind"] == "numbered" and not house_match:
            continue
        score = (
            10 * house_match
            + 4 * (street in name)
            + 2 * (BASE.component(task["address"].get("ward"), "ward") in address)
        )
        if task["kind"] == "street_only":
            # A matching road, not one of the provider's numbered-house suggestions.
            if BASE.component(candidate.get("name"), "street") != street:
                continue
        scored.append((score, index, candidate))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [candidate for _, _, candidate in scored[:3]]


def evaluate_place(task, search, place):
    candidate = BASE.evaluate_candidate(task, search, place)
    # VIETMAP road entities put the road label in name and leave street blank.
    # Require the exact expected road name and no house number; preserve the
    # provider's raw response instead of inventing a street field in it.
    if task["kind"] == "street_only" and not BASE.clean(place.get("hs_num")) and not BASE.clean(place.get("street")):
        expected = BASE.component(task["address"].get("street"), "street")
        if expected and expected == BASE.component(place.get("name"), "street"):
            candidate["component_matches"]["street"] = True
            candidate["street_match_evidence"] = "place.name_exact_road"
    return candidate


def assess(task, candidates, site, search_count=None):
    if task["kind"] == "numbered":
        status = BASE.classify(task, candidates, len(candidates) if search_count is None else search_count)
        matches = [c for c in candidates if c["full_address_match"]]
    else:
        matches = []
        for candidate in candidates:
            place = candidate["place"]
            checks = candidate["component_matches"]
            ward_ok = checks["ward"] or not BASE.clean(place.get("ward"))
            if (
                candidate["in_expected_region"]
                and not BASE.clean(place.get("hs_num"))
                and ward_ok
                and all(checks[k] for k in ["street", "district", "city"])
            ):
                matches.append(candidate)
        distinct = {tuple(c["coordinates"]) for c in matches}
        status = (
            "matched_street_only"
            if len(distinct) == 1
            else "ambiguous_street"
            if len(distinct) > 1
            else "street_only_unresolved"
        )
    if site.get("building_conflict"):
        return {"decision": "preserve_building_conflict", "status": status, "candidate": None}
    if site.get("protected"):
        return {"decision": "preserve_verified", "status": status, "candidate": None}
    if task["kind"] == "street_only":
        # User accepts road-level approximation to separate different roads
        # sharing a bad source pin. Never claim a house/entrance position.
        if status == "matched_street_only" and matches:
            match = matches[0]
            displacement = match.get("displacement_max_m")
            if displacement is None or displacement > 5000:
                return {"decision": "preserve_large_displacement", "status": status, "candidate": match}
            return {"decision": "update_street_position", "status": status, "candidate": match}
        return {"decision": "preserve_street_unresolved", "status": status, "candidate": None}
    if status == "address_match_needs_verification" and matches:
        match = matches[0]
        # Far moves are retained for review; do not silently select a different city/neighborhood.
        displacement = match.get("displacement_max_m")
        if displacement is None or displacement > 1000:
            return {"decision": "preserve_large_displacement", "status": status, "candidate": match}
        return {"decision": "update_address_position", "status": status, "candidate": match}
    return {"decision": "preserve_unresolved", "status": status, "candidate": None}


class StopRunError(Exception):
    pass


# Retain the public exception used by existing tooling importing this script.
StopRun = StopRunError


class KeyPool:
    """Use configured accounts in order; persist quota failures without secrets."""

    def __init__(self, env, path):
        self.path = path
        self.day = datetime.now(timezone(timedelta(hours=7))).date().isoformat()
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        self.keys = []
        seen = set()
        names = sorted(
            (k for k in env if re.fullmatch(r"VIETMAP_API_KEY(?:_\d+)?", k)),
            key=lambda k: 0 if k == "VIETMAP_API_KEY" else int(k.rsplit("_", 1)[1]) + 1,
        )
        for name in names:
            secret = BASE.clean(env[name])
            if not secret or secret in seen:
                continue
            seen.add(secret)
            fingerprint = hashlib.sha256(secret.encode()).hexdigest()
            previous = saved.get("keys", {}).get(name, {})
            blocked = (
                previous.get("fingerprint") == fingerprint
                and previous.get("day") == self.day
                and previous.get("blocked", False)
            )
            self.keys.append(
                {
                    "name": name,
                    "secret": secret,
                    "fingerprint": fingerprint,
                    "blocked": bool(blocked),
                    "reason": previous.get("reason") if blocked else None,
                }
            )
        if not self.keys:
            raise ValueError("No configured VIETMAP API keys")

    def select(self):
        for key in self.keys:
            if not key["blocked"]:
                return key
        raise StopRun("all_configured_keys_unavailable")

    def block(self, key, status):
        key.update(blocked=True, reason="http_" + str(status))
        BASE.write_json(
            self.path,
            {
                "day": self.day,
                "keys": {
                    k["name"]: {
                        "fingerprint": k["fingerprint"],
                        "day": self.day,
                        "blocked": k["blocked"],
                        "reason": k["reason"],
                    }
                    for k in self.keys
                },
            },
        )

    def redact(self, value):
        text = json.dumps(value, ensure_ascii=False)
        for key in self.keys:
            text = text.replace(key["secret"], "[REDACTED]")
        return json.loads(text)

    def status(self):
        return {k["name"]: {"available": not k["blocked"], "reason": k["reason"]} for k in self.keys}


class Pace:
    def __init__(self, rpm):
        self.period = 60 / rpm
        self.next = 0.0
        self.lock = asyncio.Lock()

    async def wait(self):
        async with self.lock:
            await asyncio.sleep(max(0, self.next - time.monotonic()))
            self.next = time.monotonic() + self.period


def audit_shared_pins(source):
    """Distinguish conflicting addresses from units legitimately sharing a building."""
    groups = defaultdict(list)
    records = 0
    for row in BASE.read_jsonl(source):
        records += 1
        location = row.get("location") or {}
        lat, lng = location.get("latitude"), location.get("longitude")
        if (
            not isinstance(lat, (int, float))
            or not isinstance(lng, (int, float))
            or not math.isfinite(lat)
            or not math.isfinite(lng)
        ):
            continue
        address, _, kind = BASE.normalize_address(row)
        groups[(lat, lng)].append(
            {
                "identity": str(row["source_type"]) + ":" + str(row["source_listing_id"]),
                "address_key": BASE.task_key(address),
                "address": address,
                "kind": kind,
                "project": site_context(row)["project"],
                "towers": site_context(row)["towers"],
            }
        )
    counts = Counter()
    priorities = {}
    shared = []
    for coordinate, rows in groups.items():
        if len(rows) < 2:
            continue
        addresses = {r["address_key"] for r in rows}
        projects = {BASE.folded(r["project"]) for r in rows if r["project"]}
        towers = {t for r in rows for t in r["towers"]}
        if len(addresses) > 1:
            category = "different_addresses_same_pin"
        elif len(projects) > 1 or len(towers) > 1:
            category = "different_buildings_same_address_review"
        elif all(r["kind"] == "numbered" for r in rows):
            category = "same_numbered_address_possible_shared_building"
        else:
            category = "coarse_address_shared_pin_unresolved"
        counts[category + "_groups"] += 1
        counts[category + "_records"] += len(rows)
        shared.append(
            {
                "coordinates": list(coordinate),
                "category": category,
                "listing_count": len(rows),
                "distinct_address_count": len(addresses),
                "listings": rows,
            }
        )
        if category == "different_addresses_same_pin":
            counts["numbered_records_in_conflicting_groups"] += sum(r["kind"] == "numbered" for r in rows)
            counts["coarse_records_in_conflicting_groups"] += sum(r["kind"] != "numbered" for r in rows)
            for key in addresses:
                previous = priorities.get(key, (0, 0))
                priorities[key] = max(previous, (len(rows), len(addresses)))
    return {
        "source": str(source),
        "source_sha256": BASE.sha256(source),
        "records": records,
        "counts": dict(counts),
        "groups": shared,
        "priority_by_address": priorities,
        "meaning": "Shared pins are suspects, not proof of duplicate listings. Never jitter/delete units.",
    }


def prioritize_tasks(tasks, audit):
    priority = audit["priority_by_address"]
    return sorted(
        tasks,
        key=lambda t: (
            t["key"] not in priority,
            -priority.get(t["key"], (0, 0))[0],
            -priority.get(t["key"], (0, 0))[1],
            t["kind"] != "numbered",
            t["key"],
        ),
    )


def shared_pin_tasks(tasks, audit, include_streets=False):
    return [
        t
        for t in prioritize_tasks(tasks, audit)
        if t["kind"] in ({"numbered", "street_only"} if include_streets else {"numbered"})
        and t["key"] in audit["priority_by_address"]
    ]


def street_lookup_done(result):
    return bool(result and result.get("street_precision_policy") == STREET_POLICY)


def write_shared_pin_audit(output):
    inventory = json.loads((output / "inventory.json").read_text(encoding="utf-8"))
    source = Path(inventory["source"])
    if BASE.sha256(source) != inventory.get("live_source_sha256", inventory["source_sha256"]):
        raise ValueError("Canonical source changed; inspect live data before prioritizing")
    audit = audit_shared_pins(source)
    results_path = output / "full-candidates.jsonl"
    done = {r["key"]: r for r in BASE.read_jsonl(results_path)} if results_path.exists() else {}
    tasks = list(BASE.read_jsonl(output / "tasks.jsonl"))
    conflict_keys = {t["key"] for t in tasks if t["kind"] == "numbered" and t["key"] in audit["priority_by_address"]}
    audit["numbered_conflict_address_keys"] = len(conflict_keys)
    audit["numbered_conflict_address_keys_pending"] = sum(key not in done for key in conflict_keys)
    focused = shared_pin_tasks(tasks, audit, include_streets=True)
    pending = [
        t
        for t in focused
        if t["key"] not in done or (t["kind"] == "street_only" and not street_lookup_done(done[t["key"]]))
    ]
    queue_path = output / "shared-pin-queue.jsonl"
    with queue_path.open("w", encoding="utf-8") as stream:
        for task in pending:
            affected, distinct = audit["priority_by_address"][task["key"]]
            stream.write(
                json.dumps(
                    {
                        "key": task["key"],
                        "query": task["query"],
                        "address": task["address"],
                        "kind": task["kind"],
                        "listing_count": task["listing_count"],
                        "largest_conflicting_group_listings": affected,
                        "distinct_addresses_in_largest_group": distinct,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    audit["pending_queue"] = str(queue_path)
    audit["street_conflict_address_keys_pending"] = sum(t["kind"] == "street_only" for t in pending)
    audit["conflict_address_keys_pending_total"] = len(pending)
    audit["queue_order"] = "largest_conflicting_shared_pin_group_first"
    audit["updated_at"] = datetime.now(UTC).isoformat()
    BASE.write_json(output / "shared-pin-audit.json", audit)
    return audit


async def run(output, budget, rpm, workers, limit=None, include_streets=False, shared_pins_only=False):
    import httpx
    from dotenv import dotenv_values

    if not 1 <= rpm <= 180 or not 1 <= budget <= 45000 or not 1 <= workers <= 12:
        raise ValueError("Limits: <=180 total RPM, <=45000 counted requests, <=12 workers")
    inventory = json.loads((output / "inventory.json").read_text(encoding="utf-8"))
    source = BASE.prepared_source(inventory)
    if BASE.sha256(source) != inventory["source_sha256"]:
        raise ValueError("Source changed; regenerate inventory first")
    key_pool = KeyPool(dotenv_values(BASE.ROOT / ".env.local"), output / "api-key-state.json")
    task_list = list(BASE.read_jsonl(output / "tasks.jsonl"))
    # Resolve conflicting shared pins first, using the current runtime data.
    # Keep frozen original evidence and completed cache; no artificial pin spread.
    audit = write_shared_pin_audit(output)
    include_streets = include_streets or shared_pins_only
    task_list = (
        shared_pin_tasks(task_list, audit, include_streets) if shared_pins_only else prioritize_tasks(task_list, audit)
    )
    if limit is not None:
        task_list = task_list[:limit]
    site = contexts(source)
    BASE.write_json(output / "building-context.json", site)
    seed = (
        json.loads((output / "cache.json").read_text(encoding="utf-8"))
        if (output / "cache.json").exists()
        else {"request_count": 0, "requests": {}}
    )
    cache = seed["requests"]
    journal_path = output / "full-cache.jsonl"
    ledger_path = output / "full-requests.jsonl"
    if journal_path.exists():
        for entry in BASE.read_jsonl(journal_path):
            cache[entry["key"]] = entry["body"]
    previous = sum(1 for _ in BASE.read_jsonl(ledger_path)) if ledger_path.exists() else 0
    request_count = seed["request_count"] + previous
    # Keep attempted requests, including in-flight calls cancelled at shutdown.
    # Historical runs only counted response rows; their final state is a second
    # independent accounting source. Persist before sending every new request.
    counter_path = output / "full-request-count.json"
    for path in [output / "full-run.json", counter_path]:
        if path.exists():
            saved = json.loads(path.read_text(encoding="utf-8"))
            if saved.get("source_sha256") != inventory["source_sha256"]:
                raise ValueError("Request accounting belongs to a different source")
            request_count = max(
                request_count, saved.get("total_requests_including_pilot", saved.get("request_count", 0))
            )

    def persist_count():
        BASE.write_json(
            counter_path,
            {
                "source_sha256": inventory["source_sha256"],
                "request_count": request_count,
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )

    persist_count()
    requested, hits = 0, 0
    results_path = output / "full-candidates.jsonl"
    done = {r["key"]: r for r in BASE.read_jsonl(results_path)} if results_path.exists() else {}
    if include_streets:
        # Earlier offline preservation did not look up the road. Resume those
        # tasks rather than treating them as successfully geocoded.
        for task in task_list:
            if task["kind"] == "street_only" and not street_lookup_done(done.get(task["key"])):
                done.pop(task["key"], None)
    if not include_streets:
        # The whole source is processed. Missing house numbers cannot be made
        # precise by resolving a road centroid: preserve these pins explicitly.
        with results_path.open("a", encoding="utf-8") as stream:
            for task in task_list:
                if task["kind"] == "street_only" and task["key"] not in done:
                    context = site.get(task["key"], {})
                    result = {
                        "key": task["key"],
                        "kind": task["kind"],
                        "listing_count": task["listing_count"],
                        "query": task["query"],
                        "search_count": None,
                        "candidates": [],
                        "assessment": {
                            "decision": "preserve_street_only",
                            "status": "not_queried_missing_housenumber",
                            "candidate": None,
                        },
                        "site_context": context,
                        "independently_verified": False,
                        "applied": False,
                        "lookup": "offline_precision_check",
                    }
                    stream.write(json.dumps(result, ensure_ascii=False) + "\n")
                    done[task["key"]] = result
    # Trial consumers may enforce one shared key limit across Search and Place.
    # A shared pacer avoids spending 180 RPM on each endpoint simultaneously.
    shared_pace = Pace(rpm)
    paces = {name: shared_pace for name in ["search/v4", "place/v4"]}
    in_flight = {}
    queue = asyncio.Queue()
    for task in task_list:
        if task["key"] not in done:
            queue.put_nowait(task)
    started = time.monotonic()
    stopped = None

    def state(status):
        result = {
            "pid": os.getpid(),
            "status": status,
            "scope": "conflicting_shared_pins" if shared_pins_only else "whole_source",
            "street_approximation_enabled": include_streets,
            "street_tasks_pending": sum(t["kind"] == "street_only" and t["key"] not in done for t in task_list),
            "selected": len(task_list),
            "completed": sum(t["key"] in done for t in task_list),
            "requests_this_run": requested,
            "total_requests_including_pilot": request_count,
            "cache_hits_this_run": hits,
            "elapsed_seconds": round(time.monotonic() - started),
            "decisions": dict(Counter(r["assessment"]["decision"] for r in done.values())),
            "stopped_reason": stopped,
            "source_sha256": inventory["source_sha256"],
            "live_data_applied": inventory.get("live_source_sha256", inventory["source_sha256"])
            != inventory["source_sha256"],
            "api_keys": key_pool.status(),
            "updated_at": datetime.now(UTC).isoformat(),
        }
        BASE.write_json(output / "full-run.json", result)
        return result

    with (
        journal_path.open("a", encoding="utf-8") as journal,
        ledger_path.open("a", encoding="utf-8") as ledger,
        results_path.open("a", encoding="utf-8") as results_stream,
    ):
        async with httpx.AsyncClient(
            timeout=25,
            follow_redirects=False,
            limits=httpx.Limits(max_connections=workers, max_keepalive_connections=workers),
        ) as client:

            async def fetch(endpoint, params):
                nonlocal request_count, requested, hits
                import hashlib

                cache_key = hashlib.sha256(json.dumps([endpoint, params], sort_keys=True).encode()).hexdigest()
                if cache_key in cache:
                    hits += 1
                    return cache[cache_key]
                if cache_key in in_flight:
                    hits += 1
                    return await in_flight[cache_key]

                async def obtain():
                    nonlocal request_count, requested
                    transient_attempt = 0
                    for attempt in range(len(key_pool.keys) + 3):
                        await paces[endpoint].wait()
                        if (output / "STOP").exists():
                            raise StopRun("stop_file")
                        if request_count >= budget:
                            raise StopRun("request_budget_exhausted")
                        key = key_pool.select()
                        request_count += 1
                        requested += 1
                        persist_count()
                        stamp = time.monotonic()
                        entry = {
                            "time": datetime.now(UTC).isoformat(),
                            "endpoint": endpoint,
                            "cache_key": cache_key,
                            "attempt": attempt + 1,
                            "api_key_name": key["name"],
                        }
                        try:
                            response = await client.get(
                                "https://maps.vietmap.vn/api/" + endpoint, params={"apikey": key["secret"], **params}
                            )
                            entry["status"] = response.status_code
                            entry["elapsed_s"] = round(time.monotonic() - stamp, 3)
                            try:
                                body = key_pool.redact(response.json())
                            except ValueError:
                                body = {"error": "non_json_response"}
                            if response.status_code != 200:
                                entry["retry_after"] = response.headers.get("Retry-After")
                                entry["provider_error"] = {
                                    k: str(body[k])[:400]
                                    for k in ["code", "message", "error", "status", "msg"]
                                    if isinstance(body, dict) and k in body
                                }
                                entry["rate_headers"] = key_pool.redact(
                                    {
                                        k: v
                                        for k, v in response.headers.items()
                                        if k.lower().startswith(("x-ratelimit", "ratelimit"))
                                    }
                                )
                                BASE.write_json(output / "last-provider-error.json", entry)
                            ledger.write(json.dumps(entry) + "\n")
                            ledger.flush()
                            if response.status_code == 200:
                                cache[cache_key] = body
                                journal.write(json.dumps({"key": cache_key, "body": body}, ensure_ascii=False) + "\n")
                                journal.flush()
                                return body
                            if response.status_code in {429, 401, 403}:
                                key_pool.block(key, response.status_code)
                                key_pool.select()  # Stop promptly when every configured account is unavailable.
                                state("running")
                                continue
                            if response.status_code in {500, 502, 503, 504} and transient_attempt < 2:
                                transient_attempt += 1
                                await asyncio.sleep(3 * transient_attempt)
                                continue
                            raise StopRun("http_" + str(response.status_code))
                        except httpx.HTTPError as exc:
                            entry["error"] = type(exc).__name__
                            entry["elapsed_s"] = round(time.monotonic() - stamp, 3)
                            ledger.write(json.dumps(entry) + "\n")
                            ledger.flush()
                            if transient_attempt < 2:
                                transient_attempt += 1
                                await asyncio.sleep(2 * transient_attempt)
                                continue
                            raise StopRun(type(exc).__name__) from None
                    raise StopRun("request_attempts_exhausted")

                future = asyncio.create_task(obtain())
                in_flight[cache_key] = future
                try:
                    return await future
                finally:
                    in_flight.pop(cache_key, None)

            async def worker():
                while not queue.empty():
                    task = queue.get_nowait()
                    layers = "ADDRESS,STREET" if task["kind"] == "numbered" else "STREET"
                    params = {"text": task["query"], "display_type": 6, "layers": layers}
                    # Pilot responses may already contain a genuine road result.
                    fallback_params = {**params, "layers": "ADDRESS,STREET"}
                    fallback_digest = hashlib.sha256(
                        json.dumps(["search/v4", fallback_params], sort_keys=True).encode()
                    ).hexdigest()
                    if task["kind"] == "street_only" and fallback_digest in cache:
                        search = cache[fallback_digest]
                    else:
                        search = await fetch("search/v4", params)
                    if not isinstance(search, list):
                        raise StopRun("unexpected_search_shape")
                    candidates = []
                    selected = rank_candidates(task, search)
                    for candidate in selected:
                        place = await fetch("place/v4", {"refid": candidate["ref_id"]})
                        if not isinstance(place, dict) or "lat" not in place or "lng" not in place:
                            raise StopRun("unexpected_place_shape")
                        candidates.append(evaluate_place(task, candidate, place))
                    context = site.get(task["key"], {})
                    assessment = assess(task, candidates, context, len(search))
                    result = {
                        "key": task["key"],
                        "query": task["query"],
                        "kind": task["kind"],
                        "listing_count": task["listing_count"],
                        "search_count": len(search),
                        "candidates": candidates,
                        "assessment": assessment,
                        "site_context": context,
                        "independently_verified": False,
                        "applied": False,
                    }
                    if task["kind"] == "street_only":
                        result["street_precision_policy"] = STREET_POLICY
                    results_stream.write(json.dumps(result, ensure_ascii=False) + "\n")
                    results_stream.flush()
                    done[task["key"]] = result
                    queue.task_done()
                    if len(done) % 100 == 0:
                        print(json.dumps(state("running")), flush=True)

            running = [asyncio.create_task(worker()) for _ in range(workers)]
            try:
                print(json.dumps(state("running")), flush=True)
                await asyncio.gather(*running)
            except (Exception, asyncio.CancelledError) as exc:
                # Unexpected exceptions must not leak request URLs or leave workers active.
                stopped = (str(exc) or "cancelled") if isinstance(exc, StopRun) else type(exc).__name__
                for running_worker in running:
                    running_worker.cancel()
                await asyncio.gather(*running, return_exceptions=True)
                for future in list(in_flight.values()):
                    future.cancel()
                await asyncio.gather(*list(in_flight.values()), return_exceptions=True)
    status = "complete" if all(t["key"] in done for t in task_list) else "stopped"
    print(json.dumps(state(status)), flush=True)


def export(output, allow_partial=False):
    inventory = json.loads((output / "inventory.json").read_text(encoding="utf-8"))
    source = BASE.prepared_source(inventory)
    if BASE.sha256(source) != inventory["source_sha256"]:
        raise ValueError("Source changed; export halted")
    results = {r["key"]: r for r in BASE.read_jsonl(output / "full-candidates.jsonl")}
    live_source = Path(inventory["source"])
    live_hash = BASE.sha256(live_source)
    if live_hash != inventory.get("live_source_sha256", inventory["source_sha256"]):
        raise ValueError("Canonical source changed outside this geocoding batch")
    live_rows = {str(r["source_type"]) + ":" + str(r["source_listing_id"]): r for r in BASE.read_jsonl(live_source)}
    protection_path = output / "db-protected.json"
    protected = {}
    if protection_path.exists():
        protection = json.loads(protection_path.read_text(encoding="utf-8"))
        if protection["source_sha256"] != inventory["source_sha256"]:
            raise ValueError("Database protection checksum mismatch")
        protected = protection["identities"]
    expected = {t["key"] for t in BASE.read_jsonl(output / "tasks.jsonl")}
    if not expected.issubset(results) and not allow_partial:
        raise ValueError("Full queue is not finished; source will not be replaced")
    # Some geocoders assign different numbered addresses the same representative
    # pin. Preserve these cases rather than reproduce the source's shared-pin issue.
    provider_groups = defaultdict(set)
    for key, result in results.items():
        candidates = [c for c in result.get("candidates", []) if c and c.get("full_address_match")]
        if result["assessment"]["decision"] in UPDATE_DECISIONS:
            candidates.append(result["assessment"].get("candidate"))
        for candidate in candidates:
            if candidate and candidate.get("coordinates"):
                provider_groups[tuple(candidate["coordinates"])].add(key)
    collisions = {key for keys in provider_groups.values() if len(keys) > 1 for key in keys}
    destination = output / "housing-geocoded.jsonl"
    counts = Counter()
    patches = []
    with destination.with_suffix(".jsonl.tmp").open("w", encoding="utf-8") as stream:
        for original in BASE.read_jsonl(source):
            row = copy.deepcopy(original)
            address, evidence, kind = BASE.normalize_address(row)
            identity = str(row["source_type"]) + ":" + str(row["source_listing_id"])
            current = live_rows.get(identity)
            if current is None:
                raise ValueError("Canonical listing identity is missing")
            preserve_verified = original.get("verification", {}).get("status") in {
                "source_verified",
                "lifeflow_verified",
            }
            if identity in protected or preserve_verified:
                row = copy.deepcopy(current)
                address = copy.deepcopy(current.get("address_normalized") or {})
            if address != row.get("address_normalized"):
                row.setdefault("derived", {})["address_normalization"] = {
                    "rule": BASE.RULE,
                    "original": copy.deepcopy(row.get("address_normalized")),
                    "evidence": evidence,
                }
                row["address_normalized"] = address
                counts["address_normalized"] += 1
            result = results.get(BASE.task_key(address))
            decision = (
                result["assessment"]["decision"]
                if result
                else "pending_geocode_quota"
                if kind == "numbered"
                else "preserve_" + kind
            )
            if preserve_verified:
                decision = "preserve_verified"
            if identity in protected:
                decision = protected[identity]
            elif BASE.task_key(address) in collisions and decision in UPDATE_DECISIONS:
                decision = "preserve_provider_shared_pin"
            if decision not in UPDATE_DECISIONS:
                # An incremental preserve means retain the current applied pin,
                # not restore the frozen pre-geocode coordinates. New ambiguity
                # must not undo a previous reviewed batch.
                row["location"] = copy.deepcopy(current.get("location"))
            counts[decision] += 1
            metadata = {
                "rule": RULE,
                "decision": decision,
                "source_location": copy.deepcopy(original.get("location")),
                "source_address": copy.deepcopy(original.get("address_normalized")),
                "site_context": site_context(original),
                "provider": "VIETMAP",
                "independently_verified": False,
                "source_sha256": inventory["source_sha256"],
            }
            if decision not in UPDATE_DECISIONS and current.get("location") != original.get("location"):
                metadata["preserved_current_location"] = True
            if decision in UPDATE_DECISIONS:
                match = result["assessment"]["candidate"]
                coords = match["coordinates"]
                metadata["provider_address"] = match["place"]
                metadata["candidate_displacement_m"] = BASE.distance_m(
                    [row["location"]["latitude"], row["location"]["longitude"]], coords
                )
                row["location"] = {
                    **row["location"],
                    "latitude": coords[0],
                    "longitude": coords[1],
                    "method": "vietmap_street_v4" if decision == "update_street_position" else "vietmap_geocode_v4",
                    "accuracy": "approximate",
                }
                if decision == "update_street_position":
                    metadata["position_precision"] = "street"
                    metadata["house_position_known"] = False
            moved_from_original = BASE.distance_m(
                [original["location"]["latitude"], original["location"]["longitude"]],
                [row["location"]["latitude"], row["location"]["longitude"]],
            )
            counts["coordinate_changed"] += int(moved_from_original is not None and moved_from_original > 0.1)
            row.setdefault("derived", {})["housing_geocoding"] = metadata
            address_changed = address != current.get("address_normalized")
            location_changed = row["location"] != current.get("location")
            counts["address_changed_this_batch"] += int(address_changed)
            moved = BASE.distance_m(
                [current["location"]["latitude"], current["location"]["longitude"]],
                [row["location"]["latitude"], row["location"]["longitude"]],
            )
            counts["coordinates_changed_this_batch"] += int(moved is not None and moved > 0.1)
            if address_changed or location_changed:
                patches.append(
                    {
                        "identity": identity,
                        "old_location": current.get("location"),
                        "location": row["location"],
                        "address": {**address, "raw": row.get("address_raw")},
                        "metadata": metadata,
                    }
                )
            # Check every record before writing: only address/location/provenance may change.
            check = copy.deepcopy(row)
            for field in ["address_normalized", "location", "derived"]:
                check[field] = original.get(field)
            if check != original:
                raise ValueError("Unexpected listing/unit/price/media change")
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            counts["records"] += 1
    destination.with_suffix(".jsonl.tmp").replace(destination)
    with (output / "full-patch.jsonl").open("w", encoding="utf-8") as stream:
        for patch in patches:
            stream.write(json.dumps(patch, ensure_ascii=False) + "\n")
    summary = {
        "source_sha256": inventory["source_sha256"],
        "output_sha256": BASE.sha256(destination),
        "live_source_sha256_before": live_hash,
        "allow_partial": allow_partial,
        "queue_complete": expected.issubset(results),
        "pending_address_keys": len(expected - set(results)),
        "counts": dict(counts),
        "patch_records": len(patches),
        "source_unchanged": BASE.sha256(source) == inventory["source_sha256"],
        "provider_shared_pin_address_keys": len(collisions),
        "independently_verified": False,
        "live_applied": False,
        "output": str(destination.resolve()),
    }
    BASE.write_json(output / "full-export.json", summary)
    print(json.dumps(summary), flush=True)


def cached_only(output, include_streets=False, shared_pins_only=False):
    """Complete any address fully covered by prior responses without network calls."""
    import hashlib

    inventory = json.loads((output / "inventory.json").read_text(encoding="utf-8"))
    if BASE.sha256(BASE.prepared_source(inventory)) != inventory["source_sha256"]:
        raise ValueError("Source changed; do not mix cached evidence")
    cache = json.loads((output / "cache.json").read_text(encoding="utf-8"))["requests"]
    for entry in BASE.read_jsonl(output / "full-cache.jsonl"):
        cache[entry["key"]] = entry["body"]
    tasks = list(BASE.read_jsonl(output / "tasks.jsonl"))
    include_streets = include_streets or shared_pins_only
    if shared_pins_only:
        tasks = shared_pin_tasks(tasks, write_shared_pin_audit(output), include_streets)
    results_path = output / "full-candidates.jsonl"
    done = {r["key"]: r for r in BASE.read_jsonl(results_path)}
    site = json.loads((output / "building-context.json").read_text(encoding="utf-8"))

    def lookup(endpoint, params):
        digest = hashlib.sha256(json.dumps([endpoint, params], sort_keys=True).encode()).hexdigest()
        return cache.get(digest)

    completed = 0
    with results_path.open("a", encoding="utf-8") as stream:
        for task in tasks:
            if task["kind"] == "numbered" and task["key"] in done:
                continue
            if task["kind"] == "street_only" and (not include_streets or street_lookup_done(done.get(task["key"]))):
                continue
            if task["kind"] not in {"numbered", "street_only"}:
                continue
            layers = "ADDRESS,STREET" if task["kind"] == "numbered" else "STREET"
            search = lookup("search/v4", {"text": task["query"], "display_type": 6, "layers": layers})
            if task["kind"] == "street_only" and search is None:
                search = lookup("search/v4", {"text": task["query"], "display_type": 6, "layers": "ADDRESS,STREET"})
            if not isinstance(search, list):
                continue
            candidates = []
            for candidate in rank_candidates(task, search):
                place = lookup("place/v4", {"refid": candidate["ref_id"]})
                if not isinstance(place, dict) or "lat" not in place or "lng" not in place:
                    break
                candidates.append(evaluate_place(task, candidate, place))
            else:
                context = site.get(task["key"], {})
                result = {
                    "key": task["key"],
                    "query": task["query"],
                    "kind": task["kind"],
                    "listing_count": task["listing_count"],
                    "search_count": len(search),
                    "candidates": candidates,
                    "assessment": assess(task, candidates, context, len(search)),
                    "site_context": context,
                    "independently_verified": False,
                    "applied": False,
                    "lookup": "existing_response_cache",
                }
                if task["kind"] == "street_only":
                    result["street_precision_policy"] = STREET_POLICY
                stream.write(json.dumps(result, ensure_ascii=False) + "\n")
                stream.flush()
                done[task["key"]] = result
                completed += 1
    result = {
        "newly_completed": completed,
        "numbered_completed": sum(r["kind"] == "numbered" for r in done.values()),
        "numbered_total": inventory["unique_numbered_tasks"],
        "completed": len(done),
        "total": len(tasks),
        "decisions": dict(Counter(r["assessment"]["decision"] for r in done.values())),
        "new_requests": 0,
        "live_data_applied": inventory.get("live_source_sha256", inventory["source_sha256"])
        != inventory["source_sha256"],
        "source_sha256": inventory["source_sha256"],
        "updated_at": datetime.now(UTC).isoformat(),
    }
    BASE.write_json(output / "cache-review.json", result)
    print(json.dumps(result))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["run", "export", "cache-only", "audit-shared-pins"])
    parser.add_argument("--output", type=Path, default=BASE.DEFAULT_OUTPUT)
    parser.add_argument("--max-requests", type=int, default=45000)
    parser.add_argument(
        "--rpm",
        "--rpm-per-api",
        dest="rpm",
        type=int,
        default=150,
        help="Total shared Search+Place rate, not per-endpoint",
    )
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int)
    parser.add_argument(
        "--include-streets",
        action="store_true",
        help="Allow genuine road results to replace street-only pins with labeled street-level approximation",
    )
    parser.add_argument(
        "--shared-pins-only",
        action="store_true",
        help="Query numbered and street-only addresses in conflicting shared-pin groups; defer addresses outside those groups",
    )
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Explicitly export completed evidence and mark incomplete addresses as pending",
    )
    args = parser.parse_args()
    if args.mode == "run":
        asyncio.run(
            run(
                args.output,
                args.max_requests,
                args.rpm,
                args.workers,
                args.limit,
                args.include_streets,
                args.shared_pins_only,
            )
        )
    elif args.mode == "export":
        export(args.output, args.allow_partial)
    elif args.mode == "cache-only":
        cached_only(args.output, args.include_streets, args.shared_pins_only)
    else:
        audit = write_shared_pin_audit(args.output)
        print(
            json.dumps(
                {k: v for k, v in audit.items() if k not in {"groups", "priority_by_address"}}, ensure_ascii=True
            )
        )


if __name__ == "__main__":
    main()
