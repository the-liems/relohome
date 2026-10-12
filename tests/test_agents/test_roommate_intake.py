import pytest
from langchain_core.messages import HumanMessage
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.intake import IntakeInput, ground_facts
from relohome_agent.agents.intake_llm import DraftFact, IntakeDraft, LlmIntake, valid_value
from relohome_agent.agents.models import AgentName, ConfirmedFact, RequestKind, SessionContext


@pytest.mark.parametrize("text", ["Tôi muốn tìm người ở cùng", "Tôi muốn ghép trọ", "Có ai đang tìm roommate không?"])
def test_roommate_intent_opens_entry_without_inventing_criteria(text):
    draft = IntakeDraft(
        kind="new_goal",
        normalized_goal=text,
        intent_name="roommate",
        domains=[AgentName.ROOMMATE],
        facts=[],
        requested_actions=[],
        unsupported_reason=None,
        drops_previous_goal=False,
        map_origin="none",
        conflicts=[],
        change_request=None,
        target_task_ids=[],
        declined_suggestions=[],
    )
    inp = IntakeInput(messages=[HumanMessage(text)], session=SessionContext(), supported_domains=[AgentName.ROOMMATE])
    result, rejected = LlmIntake(None)._convert(draft, inp, text)
    assert result.domains == [AgentName.ROOMMATE] and not rejected
    assert result.constraints.values == {} and result.commit_requested == []


def test_scoped_criteria_are_structured_and_cannot_contain_identity_or_contact():
    criteria = {
        "city": "hcm",
        "preferences": {
            "budget": {"value": {"min_vnd": 0, "max_vnd": 5000000, "fee_basis": "rent_only"}, "strength": "hard"}
        },
    }
    assert valid_value("roommate_criteria", criteria)
    fact = DraftFact(key="roommate_criteria", value=criteria, evidence="ở HCM dưới 5 triệu", suggestion_key=None)
    assert fact.value.city.value == "hcm"
    assert not valid_value("roommate_criteria", {**criteria, "contact": "hidden"})
    assert not valid_value("roommate_criteria", {"city": "hcm", "self_facts": {"age": 20}})
    previous = {"city": ConfirmedFact(value="Hà Nội", evidence="Hà Nội", stated_at=utcnow())}
    new = {"roommate_criteria": ConfirmedFact(value=criteria, evidence="ở HCM dưới 5 triệu", stated_at=utcnow())}
    grounded = ground_facts(new, previous, RequestKind.CHANGE, ["ở HCM dưới 5 triệu"], [])
    assert grounded.facts["city"].value == "Hà Nội"
    assert grounded.facts["roommate_criteria"].value == criteria
