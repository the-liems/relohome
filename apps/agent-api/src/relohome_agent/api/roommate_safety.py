from typing import Literal

from fastapi import APIRouter, Query
from relohome_agent.api.roommate_access import Context, TrustedActor, perform
from relohome_roommate.api_models import BlockInput, ModerationInput, ReportInput
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.moderation import ModerationService
from relohome_roommate.services.safety import SafetyService

router = APIRouter(prefix="/roommate", tags=["roommate"])


@router.put("/blocks/{identifier}")
def block(identifier: str, body: BlockInput, actor: TrustedActor, ctx: Context):
    return perform(SafetyService(ctx).block, actor, identifier, body.selected, body.operation_key)


@router.get("/me/blocks")
def blocks(actor: TrustedActor, ctx: Context):
    perform(AccessService(ctx).require, actor)
    return {
        "items": [
            {"profile_id": row[0]}
            for row in ctx.storage.connection.execute(
                "SELECT target FROM blocks WHERE actor=? ORDER BY target", (actor.id,)
            )
        ]
    }


@router.post("/reports")
def report(body: ReportInput, actor: TrustedActor, ctx: Context):
    return perform(SafetyService(ctx).report, actor, body.profile_id, body.reason, body.operation_key)


@router.get("/moderation/reports")
def reports(
    actor: TrustedActor,
    ctx: Context,
    offset: int | None = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=50),
    status: str | None = None,
):
    if offset is None and status is None:
        return {"items": perform(ModerationService(ctx).reports, actor)}
    return perform(ModerationService(ctx).queue, actor, "reports", status=status, offset=offset or 0, limit=limit)


@router.get("/moderation/summary")
def moderation_summary(actor: TrustedActor, ctx: Context):
    return perform(ModerationService(ctx).summary, actor)


@router.get("/moderation/profiles")
def moderation_profiles(
    actor: TrustedActor,
    ctx: Context,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=50),
    status: Literal["active", "paused", "resolved", "expired", "restricted"] | None = None,
    q: str = Query("", max_length=100),
    city: Literal["hcm", "hanoi", "danang"] | None = None,
    need: Literal["has_room", "looking_together"] | None = None,
    min_budget: int | None = Query(None, ge=0, le=1000000000),
    max_budget: int | None = Query(None, ge=0, le=1000000000),
    sort: Literal["updated_desc", "updated_asc", "budget_asc", "budget_desc"] = "updated_desc",
):
    return perform(
        ModerationService(ctx).queue,
        actor,
        "profiles",
        status=status,
        offset=offset,
        limit=limit,
        q=q,
        city=city,
        need=need,
        min_budget=min_budget,
        max_budget=max_budget,
        sort=sort,
    )


@router.get("/moderation/profiles/{identifier}")
def moderation_detail(identifier: str, actor: TrustedActor, ctx: Context):
    return perform(ModerationService(ctx).detail, actor, identifier)


@router.get("/moderation/profiles/{identifier}/history")
def moderation_history(
    identifier: str,
    actor: TrustedActor,
    ctx: Context,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=50),
):
    return perform(ModerationService(ctx).history, actor, identifier, offset=offset, limit=limit)


@router.post("/moderation/profiles/{identifier}")
def moderate(identifier: str, body: ModerationInput, actor: TrustedActor, ctx: Context):
    return perform(
        ModerationService(ctx).restrict,
        actor,
        identifier,
        body.selected,
        body.reason,
        body.operation_key,
        expected_version=body.expected_version,
    )


@router.post("/moderation/reports/{identifier}/resolve")
def resolve(identifier: str, actor: TrustedActor, ctx: Context):
    return perform(ModerationService(ctx).resolve_report, actor, identifier)
