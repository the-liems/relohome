import math

from relohome_roommate.models import ProfileFacts, RoommateSearchCriteria
from relohome_roommate.normalization import budget_overlap
from relohome_roommate.ports import ProfileRecord
from relohome_roommate.scoring import LIFESTYLE, Compatibility, compatibility
from relohome_roommate.views import DiscoveryItem, PublishedCompatibility, public_profile


def publish_score(
    criteria: RoommateSearchCriteria, facts: ProfileFacts, calculated: Compatibility
) -> PublishedCompatibility:
    known = [name for name, item in calculated.factors.items() if item.known]
    wanted_budget = criteria.preferences.budget.value if criteria.preferences.budget else criteria.self_facts.budget
    comparable = bool(facts.area_ids) and budget_overlap(wanted_budget, facts.budget) is not None
    enough = (
        calculated.raw is not None
        and comparable
        and len(known) >= 4
        and len(set(known) & LIFESTYLE) >= 2
        and calculated.coverage >= 0.8
    )
    return PublishedCompatibility(
        score=math.floor(calculated.raw + 0.5) if enough else None,
        label=("high" if calculated.raw >= 80 else "medium" if calculated.raw >= 60 else "differences")
        if enough
        else None,
        positives=tuple(name for name, item in calculated.factors.items() if item.known and item.value == 1),
        differences=tuple(name for name, item in calculated.factors.items() if item.known and item.value < 1),
        missing=tuple(name for name, item in calculated.factors.items() if not item.known),
    )


def ranked(criteria: RoommateSearchCriteria, records: list[ProfileRecord]) -> list[DiscoveryItem]:
    entries = []
    for record in records:
        calculated = compatibility(criteria.preferences, record.content.facts)
        published = publish_score(criteria, record.content.facts, calculated)
        partial = sum(
            item.value * item.weight
            for name, item in calculated.factors.items()
            if name in ("areas", "budget", "move_in") and item.known
        )
        key = (0, -calculated.raw, record.owner_id) if published.score is not None else (1, -partial, record.owner_id)
        entries.append((key, DiscoveryItem(profile=public_profile(record), compatibility=published)))
    return [item for _, item in sorted(entries, key=lambda entry: entry[0])]
