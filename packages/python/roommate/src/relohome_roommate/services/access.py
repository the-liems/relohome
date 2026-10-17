from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.policy import TERMS_VERSION, ProfileState
from relohome_roommate.ports import Actor


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

    def require_operation_owner(self, actor: Actor) -> None:
        """Allow admins to reconcile their own actions without a personal discovery profile.

        Callers must still scope every query to actor.id. This grants no access to
        other people's drafts or permission to execute consumer actions.
        """
        if actor.id not in self.ctx.moderators:
            self.require(actor)

    def accept(self, actor: Actor, adult: bool, terms: str) -> dict:
        if terms != TERMS_VERSION:
            raise RoommateError("terms_version_changed")
        with self.ctx.transaction():
            self.ctx.profiles.set_access(actor.id, adult, terms, self.ctx.clock.now())
            if not adult:
                from relohome_roommate.services.lifecycle import purge_connections, redact_intros

                purge_connections(self.ctx, actor.id, revoke=True)
                redact_intros(self.ctx, actor.id)
                record = self.ctx.profiles.get(actor.id)
                if record and record.state is ProfileState.ACTIVE:
                    self.ctx.profiles.save(
                        record.model_copy(update={"state": ProfileState.PAUSED, "version": record.version + 1}),
                        record.version,
                    )
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
