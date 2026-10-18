"""Unit regressions for scope identity; fixtures are not live catalog evidence."""

import pytest
from relohome_agent.agents.models import AgentName
from relohome_agent.agents.subagents.conformance import sample_request
from relohome_agent.agents.subagents.services.domain_tools import DomainToolSession
from relohome_agent.agents.subagents.services.location import LocationSubagent, pick_named_area

from tests.test_agents.test_service_subagents import FakeToolClient, listing


@pytest.mark.parametrize(
    "query,name,accepted",
    [
        ("Cầu Giấy", "Phường Cầu Giấy", True),
        ("Phường Cầu Giấy", "Phường Cầu Giấy", True),
        ("Quận Cầu Giấy", "Phường Cầu Giấy", False),
        ("Quận 5", "Phường 5", False),
        ("Quận 5", "Quận 5", True),
        ("5", "Phường 15", False),
        ("Phường 5", "Phường 15", False),
        ("Hoàng Mai", "Phường Hoàng Mai Đông", False),
        ("Hoàng Mai", "Phường Hoàng Mai", True),
    ],
)
def test_admin_name_is_a_whole_name_not_a_similarity_score(query, name, accepted):
    item = {"area_id": "area", "name": name, "match_type": "contains", "match_score": 0.99}
    assert (pick_named_area([item], query) is item) is accepted


def test_same_name_in_another_city_cannot_supply_a_polygon():
    city = {"west": 100, "south": 20, "east": 110, "north": 22}
    here = {
        "area_id": "here",
        "name": "Phường Hoàng Mai",
        "match_type": "contains",
        "bounding_box": {"west": 105, "south": 21, "east": 106, "north": 21.1},
    }
    elsewhere = {**here, "area_id": "elsewhere", "bounding_box": {"west": 105, "south": 18, "east": 106, "north": 19}}
    assert pick_named_area([elsewhere, here], "Hoàng Mai", city) == here
    assert (
        pick_named_area(
            [here, {**here, "area_id": "other", "bounding_box": {**here["bounding_box"], "east": 107}}],
            "Hoàng Mai",
            city,
        )
        is None
    )


@pytest.mark.asyncio
async def test_unavailable_legacy_district_keeps_text_filter_without_wrong_polygon():
    city_box = {"west": 106, "south": 10, "east": 107, "north": 11}

    def areas(args):
        if args["text"] == "Hồ Chí Minh":
            return {
                "results": [
                    {
                        "area_id": "city",
                        "name": "Thành phố Hồ Chí Minh",
                        "match_type": "exact",
                        "bounding_box": city_box,
                    }
                ]
            }
        return {"results": [{"area_id": "wrong", "name": "Phường 5", "match_type": "contains", "match_score": 0.99}]}

    client = FakeToolClient({"search_areas": areas, "search_housing": {"results": [listing(1, 4_000_000)]}})
    result = await LocationSubagent(client, AgentName.PROPERTY).run(
        sample_request(AgentName.PROPERTY, {"city": "hcm", "district": "Quận 5"})
    )
    assert result.status == "done"
    request = result.data["search_request"]
    assert request["administrative_area_ids"] == ["city"]
    assert request["district"] == "Quận 5"
    scope = result.data["map_context"]["search_scope"]
    assert scope["boundary_unavailable"] is True
    assert scope["geometry"] is None and scope["area_id"] is None


@pytest.mark.parametrize("prepare", [False, True])
@pytest.mark.asyncio
async def test_city_scope_is_sent_before_candidate_limit_in_adapter_and_domain_preparation(prepare):
    city = {
        "area_id": "hcm",
        "name": "Thành phố Hồ Chí Minh",
        "match_type": "exact",
        "bounding_box": {"west": 105, "south": 8, "east": 109, "north": 12},
    }
    wrong = {
        "area_id": "tay-ninh",
        "name": "Xã Bình Thành",
        "match_type": "contains",
        "bounding_box": {"west": 106.1, "south": 10.7, "east": 106.2, "north": 10.8},
    }
    right = {
        **wrong,
        "area_id": "binh-thanh-hcm",
        "name": "Phường Bình Thạnh",
        "bounding_box": {"west": 106.7, "south": 10.8, "east": 106.71, "north": 10.82},
    }

    def areas(args):
        if args["text"] == "Hồ Chí Minh":
            return {"results": [city]}
        # An unscoped top-five response omits the real HCM ward, matching the reported failure.
        return {"results": [right] if args.get("within_area_id") == "hcm" else [wrong]}

    client = FakeToolClient({"search_areas": areas, "search_housing": {"results": [listing(1, 4_000_000)]}})
    req = sample_request(AgentName.PROPERTY, {"city": "hcm", "district": "Bình Thạnh"})
    adapter = LocationSubagent(client, AgentName.PROPERTY)
    if prepare:
        session = DomainToolSession(req, adapter)
        await session.prepare("search_areas", "district")
        assert session.anchors["district"]["area_id"] == right["area_id"]
    else:
        result = await adapter.run(req)
        assert result.data["search_request"]["administrative_area_ids"] == [right["area_id"]]
    district_reads = [args for name, args in client.calls if name == "search_areas" and args["text"] == "Bình Thạnh"]
    assert district_reads and all(args.get("within_area_id") == "hcm" for args in district_reads)


def test_explicit_vietnamese_name_cannot_silently_select_a_different_accented_name():
    wrong = {"area_id": "wrong", "name": "Xã Bình Thành", "match_type": "contains", "match_score": 0.9}
    right = {**wrong, "area_id": "right", "name": "Phường Bình Thạnh"}
    assert pick_named_area([wrong], "Bình Thạnh") is None
    assert pick_named_area([wrong, right], "Bình Thạnh") == right
    assert pick_named_area([wrong, right], "binh thanh") is None
