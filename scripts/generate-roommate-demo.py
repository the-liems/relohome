"""Generate labeled synthetic people anchored to existing Housing IDs, never real users.

Run after Location MCP is ready. No LLM, contacts, accounts, consent or connection writes.
Existing datasets are not overwritten. Runtime opt-in is required separately.
"""

import argparse
import asyncio
import json
import runpy
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build_dataset(anchors, now, *, count=100, valid_days=30):
    """Build repeatable profile variety without accounts, contacts, or LLM calls."""
    from relohome_roommate.demo import DemoDataset

    if not 30 <= count <= 100:
        raise ValueError("Demo dataset must contain 30 to 100 profiles")
    if not 1 <= valid_days <= 3650:
        raise ValueError("Demo validity must be between 1 and 3650 days")
    cities = ("hanoi", "hcm", "danang")
    male_names = (
        "Minh",
        "Khang",
        "Huy",
        "Nam",
        "Quân",
        "Đạt",
        "Phúc",
        "Long",
        "Tùng",
        "Duy",
        "Bình",
        "Kiên",
        "Sơn",
        "Thành",
        "Khải",
    )
    female_names = (
        "Linh",
        "Mai",
        "Lan",
        "Thảo",
        "Hà",
        "Ngọc",
        "An",
        "Trang",
        "Vy",
        "Hương",
        "Trâm",
        "Nhi",
        "Tâm",
        "Quỳnh",
        "My",
    )
    profiles = []
    for index in range(count):
        city = cities[index % len(cities)]
        has_room = index % 5 < 3
        gender = "male" if index % 2 == 0 else "female"
        name = (male_names if gender == "male" else female_names)[(index // 2) % 15]
        anchor = anchors[city][(index // 3) % len(anchors[city])]
        quiet = (("22:30", "06:30"), ("23:00", "07:00"), ("00:00", "08:00"))[index % 3]
        content = {
            "display_name": f"DEMO {name} {index + 1:03}",
            "introduction": (
                "Hồ sơ thử nghiệm, không phải người thật. "
                + ("Đang có phòng minh họa và muốn tìm bạn ở cùng. " if has_room else "Muốn tìm bạn cùng thuê phòng. ")
                + (
                    "Ưu tiên không gian yên tĩnh, giờ giấc ổn định."
                    if index % 2
                    else "Sinh hoạt linh hoạt, tôn trọng không gian riêng."
                )
            ),
            "facts": {
                "city": city,
                "area_ids": [f"city:{city}"],
                "budget": {
                    "min_vnd": 1_000_000 + index % 5 * 350_000,
                    "max_vnd": 3_000_000 + index % 5 * 450_000,
                    "fee_basis": "rent_only" if index % 3 else "including_fees",
                },
                "need": {"kind": "has_room", "willing_to_move": index % 2 == 0}
                if has_room
                else {"kind": "looking_together"},
                "move_in": {"kind": "flexible"},
                "self_traits": {
                    "gender": gender,
                    "smoking": "outdoors_only" if index % 6 == 0 else "non_smoker",
                    "has_pets": index % 7 == 0,
                    "quiet_hours": {"start": quiet[0], "end": quiet[1]},
                    "cleanliness": ("daily", "several_times_week", "weekly")[index % 3],
                    "sociability": ("mostly_private", "balanced", "often_shared")[index % 3],
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
                "expires_at": now + timedelta(days=valid_days),
            }
        )
    return DemoDataset.model_validate({"generated_at": now, "profiles": profiles})


async def generate(focus_areas=(), *, count=100, valid_days=30):
    import os

    from relohome_agent.agents.subagents.services.location import pick_city_area, pick_clear
    from relohome_agent.config import Settings
    from relohome_agent.services.adapters.registry import ServiceRegistry

    os.environ.update(runpy.run_path(str(ROOT / "scripts/local-integration.py"))["environment"]("api"))
    client = ServiceRegistry.from_settings(Settings()).location.read_client()
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
    return build_dataset(anchors, datetime.now(UTC), count=count, valid_days=valid_days)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "logs/private-roommate/demo-100.json")
    parser.add_argument("--count", type=int, default=100, choices=range(30, 101), metavar="30..100")
    parser.add_argument("--valid-days", type=int, default=30, choices=range(1, 3651), metavar="1..3650")
    parser.add_argument(
        "--area",
        action="append",
        default=[],
        metavar="CITY:AREA",
        help="Optional demo scope from real areas (e.g. hanoi:Cầu Giấy); not a production search rule",
    )
    args = parser.parse_args()
    output = args.output.resolve()
    if any(output.is_relative_to(ROOT / public) for public in ("Frontend", "apps/web")) or output.suffix != ".json":
        parser.error("Use a private .json dataset outside frontend assets")
    if output.exists():
        parser.error("Dataset already exists; choose a new filename rather than overwriting")
    from relohome_roommate.policy import City

    focus_areas = []
    for scope in args.area:
        code, separator, text = scope.partition(":")
        if not separator or not text.strip():
            parser.error("--area requires CITY:AREA")
        focus_areas.append((City(code).value, text.strip()))
    dataset = asyncio.run(generate(focus_areas, count=args.count, valid_days=args.valid_days))
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as target:
        target.write(dataset.model_dump_json(indent=2))
    print(
        json.dumps({"profiles": len(dataset.profiles), "source_kind": "demo", "path": str(output)}, ensure_ascii=False)
    )


if __name__ == "__main__":
    main()
