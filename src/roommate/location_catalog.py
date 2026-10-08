"""Canonical area membership supplied by the existing Location service, never guessed by an LLM."""

from src.roommate.models import RoommateProfile, RoommateSearchCriteria
from src.roommate.policy import City


class AreaCatalog:
    def __init__(self, membership: dict[str, str] | None = None):
        self.membership = {f"city:{city.value}": city for city in City}
        self.membership.update({key: City(value) for key, value in (membership or {}).items()})

    def validate(self, city: City | str, areas: tuple[str, ...]) -> None:
        city = City(city)
        if any(self.membership.get(identifier) != city for identifier in areas):
            raise ValueError("Area not in the canonical catalog for the selected city")

    def validate_profile(self, content: RoommateProfile) -> None:
        if content.facts.city:
            self.validate(content.facts.city, content.facts.area_ids)
            if content.preferences.areas:
                self.validate(content.facts.city, content.preferences.areas.value.area_ids)

    def validate_criteria(self, criteria: RoommateSearchCriteria) -> None:
        self.validate(criteria.city, criteria.self_facts.area_ids)
        if criteria.preferences.areas:
            self.validate(criteria.city, criteria.preferences.areas.value.area_ids)
