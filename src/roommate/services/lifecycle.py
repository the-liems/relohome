from src.roommate.access import RoommateContext
from src.roommate.connections import IntroSnapshot
from src.roommate.eligibility import mutual_failures
from src.roommate.models import ProfileFacts
from src.roommate.policy import GrantState, ProfileState, RequestState


def purge_connections(
    context: RoommateContext, actor: str, *, incoming_only: bool = False, revoke: bool = False
) -> None:
    now = context.clock.now()
    for request in context.connections.for_actor(actor):
        if request.state is RequestState.PENDING and (not incoming_only or request.recipient_id == actor):
            context.connections.close(request, RequestState.CANCELLED, now)
        if revoke:
            grant = context.connections.grant(request.id)
            if grant and grant.state is GrantState.ACTIVE:
                context.connections.save_grant(grant.model_copy(update={"state": GrantState.REVOKED}))


def request_failures(context: RoommateContext, request) -> tuple[str, ...]:
    sender = context.profiles.intro(request.sender_id)
    recipient = context.profiles.get(request.recipient_id)
    if (
        sender is None
        or recipient is None
        or recipient.state is not ProfileState.ACTIVE
        or recipient.expires_at is None
        or context.clock.now() >= recipient.expires_at
        or context.safety.blocked(request.sender_id, request.recipient_id)
        or context.safety.restricted(request.sender_id)
        or context.safety.restricted(request.recipient_id)
    ):
        return ("unavailable",)
    return mutual_failures(
        request.intro.facts, sender.preferences, recipient.content.facts, recipient.content.preferences
    )


def cancel_changed_hard_conditions(context: RoommateContext, actor: str) -> None:
    for request in context.connections.for_actor(actor):
        if request.state is RequestState.PENDING and request_failures(context, request):
            context.connections.close(request, RequestState.CANCELLED, context.clock.now())


def reconcile_profiles(context: RoommateContext) -> None:
    now = context.clock.now()
    for record in context.profiles.all():
        if record.state is ProfileState.ACTIVE and record.expires_at and now >= record.expires_at:
            context.profiles.save(
                record.model_copy(update={"state": ProfileState.EXPIRED, "version": record.version + 1}), record.version
            )
            purge_connections(context, record.owner_id, incoming_only=True)


def redact_intros(context: RoommateContext, owner: str) -> None:
    # Permanent erasure from historical snapshots; repost/restore never rehydrates them.
    for record in context.connections.for_actor(owner):
        if record.sender_id == owner:
            context.connections.save(
                record.model_copy(
                    update={
                        "intro": IntroSnapshot(
                            display_name="Unavailable", facts=ProfileFacts(), reviewed_at=context.clock.now()
                        )
                    }
                )
            )
