from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.eligibility import eligible
from relohome_roommate.models import RoommateSearchCriteria
from relohome_roommate.policy import ProfileState
from relohome_roommate.ports import Actor
from relohome_roommate.ranking import ranked
from relohome_roommate.services.access import AccessService
from relohome_roommate.views import owner_profile, public_profile, unavailable_profile


class DiscoveryService:
    def __init__(self, context: RoommateContext):
        self.ctx = context
        self.access = AccessService(context)

    def search(self, actor: Actor, criteria: RoommateSearchCriteria, *, offset: int = 0, limit: int = 20) -> dict:
        if offset < 0 or not 1 <= limit <= 50:
            raise RoommateError("invalid_pagination", status=422)
        self.ctx.catalog.validate_criteria(criteria)
        with self.ctx.read_transaction():
            self.access.require(actor)
            now = self.ctx.clock.now()
            excluded = self.ctx.safety.discovery_exclusions(actor.id)
            records = [
                record
                for record in self.ctx.profiles.active(criteria.city.value, now)
                if record.owner_id not in excluded
                and eligible(
                    actor.id,
                    criteria,
                    record,
                    now,
                ).passed
            ]
            ordered = ranked(criteria, records)
            return {
                "items": [item.model_dump(mode="json") for item in ordered[offset : offset + limit]],
                "total": len(ordered),
                "offset": offset,
                "limit": limit,
            }

    def _detail(self, actor: Actor, identifier: str) -> dict:
        record = self.ctx.profiles.get(identifier)
        unavailable = unavailable_profile(identifier).model_dump(mode="json")
        if record is None:
            return unavailable
        if identifier == actor.id:
            return {"profile_id": identifier, "owner": owner_profile(record, actor).model_dump(mode="json")}
        if (
            self.ctx.safety.blocked(actor.id, identifier)
            or self.ctx.safety.restricted(identifier)
            or record.state is not ProfileState.ACTIVE
            or record.expires_at is None
            or self.ctx.clock.now() >= record.expires_at
        ):
            return unavailable
        return {"available": True, "profile": public_profile(record).model_dump(mode="json")}

    def detail(self, actor: Actor, identifier: str) -> dict:
        with self.ctx.read_transaction():
            self.access.require(actor)
            return self._detail(actor, identifier)

    def bookmark(self, actor: Actor, identifier: str, selected: bool) -> dict:
        with self.ctx.transaction():
            self.access.require(actor)
            if selected and (identifier == actor.id or not self._detail(actor, identifier).get("available")):
                raise RoommateError("profile_unavailable", status=404)
            self.ctx.profiles.bookmark(actor.id, identifier, selected)
        return {"saved": selected, "profile_id": identifier}

    def saved(self, actor: Actor) -> list[dict]:
        with self.ctx.read_transaction():
            self.access.require(actor)
            return [self._detail(actor, identifier) for identifier in self.ctx.profiles.bookmarks(actor.id)]

    def save_criteria(self, actor: Actor, criteria: RoommateSearchCriteria) -> None:
        self.ctx.catalog.validate_criteria(criteria)
        with self.ctx.transaction():
            self.access.require(actor)
            self.ctx.profiles.save_criteria(actor.id, criteria)
