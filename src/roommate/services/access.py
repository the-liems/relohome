from src.roommate.access import RoommateContext, RoommateError
from src.roommate.policy import TERMS_VERSION
from src.roommate.ports import Actor


class AccessService:
    def __init__(self, context: RoommateContext):
        self.ctx = context

    def require(self, actor: Actor) -> None:
        if self.ctx.safety.restricted(actor.id):
            raise RoommateError("service_restricted", status=403)
        record = self.ctx.profiles.access(actor.id)
        if not record or record["terms"] != TERMS_VERSION:
            raise RoommateError("service_terms_required", status=403)
        if not record["adult"]:
            raise RoommateError("adult_required", status=403)

    def require_moderator(self, actor: Actor) -> None:
        if actor.id not in self.ctx.moderators:
            raise RoommateError("moderator_required", status=403)

    def accept(self, actor: Actor, adult: bool, terms: str) -> dict:
        if terms != TERMS_VERSION:
            raise RoommateError("terms_version_changed")
        with self.ctx.transaction():
            self.ctx.profiles.set_access(actor.id, adult, terms, self.ctx.clock.now())
        return self.status(actor)

    def status(self, actor: Actor) -> dict:
        try:
            self.require(actor)
        except RoommateError as error:
            return {
                "eligible": False,
                "reason": error.code,
                "terms_version": TERMS_VERSION,
                "moderator": actor.id in self.ctx.moderators,
            }
        return {"eligible": True, "terms_version": TERMS_VERSION, "moderator": actor.id in self.ctx.moderators}
