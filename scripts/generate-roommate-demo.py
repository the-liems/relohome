"""Generate 100 labeled synthetic people anchored to REAL Housing IDs, never real users.

Run after Location MCP is ready. No LLM, contacts, accounts, consent or connection writes.
Existing datasets are not overwritten. Runtime opt-in is required separately.
"""

import argparse
import asyncio
import json
import runpy
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


async def generate(focus_areas=()):
    import os

    from src.agents.subagents.services.location import pick_city_area, pick_clear
    from src.roommate.demo import DemoDataset
    from src.services.adapters.registry import ServiceRegistry, ServiceSettings

    os.environ.update(runpy.run_path(str(ROOT / "scripts/local-integration.py"))["environment"]("api"))
    client = ServiceRegistry.from_settings(ServiceSettings()).location.read_client()
    if client is None:
        raise RuntimeError("Location MCP must be configured")
    cities = (("hanoi", "Hà Nội"), ("hcm", "Thành phố Hồ Chí Minh"), ("danang", "Đà Nẵng"))
    anchors = {}
    for code, name in cities:
        areas = await client.call("search_areas", {"text": name, "limit": 5})
        area = pick_city_area(areas.get("results") or [])
        if area is None:
            raise RuntimeError(f"Resolve the canonical city before generating: {code}")
        query = {
            "administrative_area_ids": [area["area_id"]],
            "listing_type": "rent",
            "property_type": "room",
            "max_price": {"amount": 6_000_000, "currency": "VND", "period": "month"},
            "pagination": {"limit": 100},
        }
        local_focus = [text for city, text in focus_areas if city == code]
        if len(local_focus) > 1:
            raise ValueError("Choose at most one explicit demo focus area per city")
        if local_focus:
            found = await client.call(
                "search_areas", {"text": local_focus[0], "bounding_box": area["bounding_box"], "limit": 5}
            )
            subarea = pick_clear([a for a in found["results"] if a["match_type"] != "fuzzy"])
            if subarea is None:
                raise ValueError("Demo focus area must resolve uniquely within its city")
            query["administrative_area_ids"] = [subarea["area_id"]]
        page = await client.call(
            "search_housing",
            query,
        )
        rows = [r for r in page.get("results", []) if (r.get("location") or {}).get("lat") is not None]
        if not rows:
            raise RuntimeError(f"No real geolocated Housing anchors for {code}")
        anchors[code] = rows
    now = datetime.now(UTC)
    profiles = []
    for index in range(100):
        city = cities[index % len(cities)][0]
        has_room = index % 5 < 3
        anchor = anchors[city][(index // 3) % len(anchors[city])]
        content = {
            "display_name": f"DEMO Người thử {index + 1:03}",
            "introduction": "Hồ sơ giả để trải nghiệm ghép trọ. Không phải người thật, không nhận kết nối.",
            "facts": {
                "city": city,
                "area_ids": [f"city:{city}"],
                "budget": {
                    "min_vnd": 1_000_000 + index % 4 * 500_000,
                    "max_vnd": 3_000_000 + index % 4 * 500_000,
                    "fee_basis": "rent_only",
                },
                "need": {"kind": "has_room", "willing_to_move": index % 2 == 0}
                if has_room
                else {"kind": "looking_together"},
                "move_in": {"kind": "flexible"},
                "self_traits": {
                    "smoking": "outdoors_only" if index % 5 == 0 else "non_smoker",
                    "has_pets": index % 7 == 0,
                    "cleanliness": "daily" if index % 2 else "several_times_week",
                    "sociability": "mostly_private" if index % 3 else "balanced",
                },
            },
            "preferences": {"smoking": {"value": "outdoors_only", "strength": "soft"}},
            "room": {"listing_id": anchor["listing_id"], "public_location_consent": True} if has_room else None,
        }
        profiles.append(
            {
                "owner_id": f"demo_person_{index + 1:03}",
                "version": 1,
                "state": "active",
                "content": content,
                "updated_at": now,
                "confirmed_at": now,
                "expires_at": now + timedelta(days=30),
            }
        )
    return DemoDataset.model_validate({"generated_at": now, "profiles": profiles})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "logs/private-roommate/demo-100.json")
    parser.add_argument(
        "--area",
        action="append",
        default=[],
        metavar="CITY:AREA",
        help="Optional demo scope from real areas (e.g. hanoi:Cầu Giấy); not a production search rule",
    )
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(ROOT / "Frontend") or output.suffix != ".json":
        parser.error("Use a private .json dataset outside frontend assets")
    if output.exists():
        parser.error("Dataset already exists; choose a new filename rather than overwriting")
    from src.roommate.policy import City

    focus_areas = []
    for scope in args.area:
        code, separator, text = scope.partition(":")
        if not separator or not text.strip():
            parser.error("--area requires CITY:AREA")
        focus_areas.append((City(code).value, text.strip()))
    dataset = asyncio.run(generate(focus_areas))
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as target:
        target.write(dataset.model_dump_json(indent=2))
    print(
        json.dumps({"profiles": len(dataset.profiles), "source_kind": "demo", "path": str(output)}, ensure_ascii=False)
    )


if __name__ == "__main__":
    main()
