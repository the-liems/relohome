from relohome_agent.agents.llm_context import decision_data
from relohome_agent.agents.subagents.services.location import to_candidate


def test_agent_keeps_only_aggregate_review_facts_in_housing_details():
    raw = {
        'listing_id': 'review-house', 'title': 'Phòng thử nghiệm',
        'management': {'host_rating': 4.6, 'host_review_count': 12,
                       'author_user_id': 'private-tenant', 'reviews': [{'body': 'Unverified accusation'}]},
    }
    candidate, _ = to_candidate(raw, [])
    projected = decision_data(candidate)
    assert projected['host_rating'] == 4.6
    assert projected['host_review_count'] == 12
    assert 'private-tenant' not in str(projected)
    assert 'Unverified accusation' not in str(projected)


def test_imported_listing_without_review_metadata_does_not_invent_a_rating():
    candidate, _ = to_candidate({'listing_id': 'imported'}, [])
    assert 'host_rating' not in candidate
