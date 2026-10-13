"""Pure completeness guard; no mocked model/provider responses."""

from relohome_agent.agents.intake_llm import exact_bedroom_count


def test_exact_bedrooms_and_ranges():
    assert exact_bedroom_count("Tìm nhà có 2 phòng ngủ dưới 10 triệu và tìm chuyến bay cho 2 người") == 2
    for text in (
        "không tìm nhà có 2 phòng ngủ",
        "nhà có ít nhất 2 phòng ngủ",
        "nhà có 2 phòng ngủ trở lên",
        "nhà có 2 phòng ngủ hoặc 3 phòng ngủ",
    ):
        assert exact_bedroom_count(text) is None
