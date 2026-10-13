import json
from types import SimpleNamespace

import relohome_location_demo.agent as agent_module
from relohome_location_demo.agent import HousingMapSubAgent, extract_map_data


def test_extract_map_data_collects_locations_and_routes():
    payloads = [
        {
            "results": [
                {
                    "name": "Khách sạn mẫu",
                    "category": "hotel",
                    "location": {"lng": 106.7, "lat": 10.77},
                }
            ]
        },
        {
            "geometry": {
                "type": "LineString",
                "coordinates": [[106.7, 10.77], [106.72, 10.79]],
            }
        },
    ]

    points, paths = extract_map_data(payloads)

    assert any(point["label"] == "Khách sạn mẫu" for point in points)
    assert any(point["label"] == "A" for point in points)
    assert any(point["label"] == "B" for point in points)
    assert paths == [[[106.7, 10.77], [106.72, 10.79]]]


def test_extract_map_data_handles_empty_tool_results():
    assert extract_map_data([{"results": []}]) == ([], [])


def test_landmark_misclassified_as_area_falls_back_to_nearby_search():
    class FakeMcp:
        def call_tool(self, name, arguments):
            if name == "search_areas":
                return {"results": []}
            if name == "resolve_location":
                return {
                    "results": [
                        {"name": "Hồ Gươm", "location": {"lng": 105.852, "lat": 21.028}}
                    ]
                }
            assert name == "search_places"
            assert arguments["center"] == {"lng": 105.852, "lat": 21.028}
            assert arguments["radius_m"] == 2_000
            return {"results": [{"name": "Khách sạn mẫu"}]}

    sub_agent = HousingMapSubAgent(FakeMcp())
    result = sub_agent.execute(
        "find_places",
        {
            "area_text": "Hồ Gươm",
            "near_text": None,
            "place_text": None,
            "categories": ["hotel"],
            "radius_m": 2_000,
            "limit": 10,
        },
    )

    assert result["results"][0]["name"] == "Khách sạn mẫu"
    assert [trace["tool"] for trace in sub_agent.traces] == [
        "search_areas",
        "resolve_location",
        "search_places",
    ]


def test_housing_subagent_runs_area_search_workflow(monkeypatch):
    def tool_call(call_id, name, arguments):
        function = SimpleNamespace(name=name, arguments=json.dumps(arguments))
        return SimpleNamespace(id=call_id, function=function)

    class Message:
        def __init__(self, content=None, tool_calls=None):
            self.content = content
            self.tool_calls = tool_calls or []

    responses = iter(
        [
            Message(
                tool_calls=[
                    tool_call(
                        "1",
                        "find_places",
                        {
                            "area_text": "Gò Vấp",
                            "near_text": None,
                            "place_text": None,
                            "categories": ["hotel"],
                            "radius_m": 2000,
                            "limit": 10,
                        },
                    )
                ]
            ),
            Message(content="Tìm thấy khách sạn."),
        ]
    )
    requests = []

    class Completions:
        def create(self, **kwargs):
            requests.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=next(responses))])

    fake_openai = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    monkeypatch.setattr(agent_module, "OpenAI", lambda: fake_openai)

    class FakeMcp:
        def call_tool(self, name, arguments):
            if name == "search_areas":
                return {"results": [{"area_id": "area-1", "name": "Gò Vấp"}]}
            if arguments.get("administrative_area_ids"):
                return {"results": [{"name": "Khách sạn A", "location": {"lng": 106.68, "lat": 10.83}}]}
            return {"results": []}

    result = agent_module.run_housing_subagent("Tìm khách sạn ở Gò Vấp", [], FakeMcp())

    assert [trace["tool"] for trace in result.tool_calls] == [
        "housing_map_subagent",
        "search_areas",
        "search_places",
    ]
    assert requests[0]["tool_choice"] == "required"
    assert result.answer == "Tìm thấy khách sạn."
