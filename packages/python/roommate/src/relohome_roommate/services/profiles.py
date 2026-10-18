import re
import unicodedata

from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.models import RoommateProfile
from relohome_roommate.policy import PROFILE_TTL, NeedKind, ProfileState
from relohome_roommate.ports import Actor, ProfileRecord
from relohome_roommate.profile_repository import VersionConflictError
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.lifecycle import (
    cancel_changed_hard_conditions,
    purge_connections,
    reconcile_profiles,
    redact_intros,
)


def validate_text(*values: str | None) -> None:
    text = unicodedata.normalize("NFKC", " ".join(value or "" for value in values))
    if re.search(
        r"(?:\d[\s().+-]*){8,}|https?://|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:zalo|telegram|whatsapp)\s*[:/@]",
        text,
        re.I,
    ):
        raise RoommateError("contact_in_public_text", status=422)


def validate_complete(content: RoommateProfile) -> None:
    facts = content.facts
    if (
        not content.display_name
        or not content.introduction
        or facts.self_traits.gender is None
        or not facts.city
        or not facts.area_ids
        or not facts.budget
        or facts.budget.fee_basis is None
        or facts.need is None
        or facts.move_in is None
        or (facts.need.kind is NeedKind.HAS_ROOM and facts.need.willing_to_move is None)
    ):
        raise RoommateError("intro_incomplete", status=422)
    validate_text(content.display_name, content.introduction)


class ProfileService:
    def __init__(self, context: RoommateContext):
        self.ctx = context
        self.access = AccessService(context)

    def save(self, actor: Actor, content: RoommateProfile, expected_version: int | None) -> ProfileRecord:
        self.ctx.catalog.validate_profile(content)
        validate_text(content.display_name, content.introduction)
        with self.ctx.transaction():
            self.access.require(actor)
            reconcile_profiles(self.ctx)
            existing = self.ctx.profiles.get(actor.id)
            if existing and existing.state is ProfileState.ACTIVE:
                validate_complete(content)
            record = ProfileRecord(
                owner_id=actor.id,
                version=existing.version + 1 if existing else 1,
                state=existing.state if existing and existing.state is not ProfileState.DELETED else ProfileState.DRAFT,
                content=content,
                updated_at=self.ctx.clock.now(),
                confirmed_at=existing.confirmed_at if existing else None,
                expires_at=existing.expires_at if existing else None,
                avatar_id=existing.avatar_id if existing else None,
            )
            self.ctx.profiles.save(record, expected_version)
            cancel_changed_hard_conditions(self.ctx, actor.id)
            return record

    def save_intro(self, actor: Actor, content: RoommateProfile) -> None:
        self.ctx.catalog.validate_profile(content)
        validate_text(content.display_name, content.introduction)
        with self.ctx.transaction():
            self.access.require(actor)
            self.ctx.profiles.save_intro(actor.id, content)
            cancel_changed_hard_conditions(self.ctx, actor.id)

    def transition(self, actor: Actor, action: str, expected_version: int, reviewed: bool = False) -> ProfileRecord:
        with self.ctx.transaction():
            self.access.require(actor)
            reconcile_profiles(self.ctx)
            record = self.ctx.profiles.get(actor.id)
            if not record:
                raise RoommateError("profile_not_found", status=404)
            if record.version != expected_version:
                raise VersionConflictError("Profile version changed")
            now = self.ctx.clock.now()
            updates = {"version": record.version + 1, "updated_at": now}
            if action in ("publish", "resume", "reconfirm"):
                if not reviewed:
                    raise RoommateError("review_required", status=422)
                if record.state in (ProfileState.RESTRICTED, ProfileState.DELETED):
                    raise RoommateError("profile_unavailable")
                validate_complete(record.content)
                updates.update(state=ProfileState.ACTIVE, confirmed_at=now, expires_at=now + PROFILE_TTL)
            elif action in ("pause", "resolve", "delete"):
                updates["state"] = {
                    "pause": ProfileState.PAUSED,
                    "resolve": ProfileState.RESOLVED,
                    "delete": ProfileState.DELETED,
                }[action]
                purge_connections(self.ctx, actor.id, incoming_only=action == "pause", revoke=action == "delete")
                if action == "delete":
                    redact_intros(self.ctx, actor.id)
                    updates.update(content=RoommateProfile(), avatar_id=None)
                    self.ctx.profiles.save_intro(actor.id, RoommateProfile())
                    self.ctx.storage.connection.execute(
                        "UPDATE contacts SET ciphertext=NULL,version=version+1 WHERE owner=?", (actor.id,)
                    )
                    self.ctx.storage.connection.execute("DELETE FROM media WHERE owner=?", (actor.id,))
            else:
                raise RoommateError("invalid_profile_action", status=422)
            changed = ProfileRecord.model_validate({**record.model_dump(), **updates})
            self.ctx.profiles.save(changed, record.version)
            return changed
