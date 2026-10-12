from fastapi import APIRouter, Query

from src.api.roommate_access import Context, TrustedActor, perform
from src.roommate.api_models import BlockInput, ModerationInput, ReportInput
from src.roommate.services.access import AccessService
from src.roommate.services.moderation import ModerationService
from src.roommate.services.safety import SafetyService

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
    status: str | None = None,
):
    return perform(ModerationService(ctx).queue, actor, "profiles", status=status, offset=offset, limit=limit)


@router.post("/moderation/profiles/{identifier}")
def moderate(identifier: str, body: ModerationInput, actor: TrustedActor, ctx: Context):
    return perform(ModerationService(ctx).restrict, actor, identifier, body.selected, body.reason, body.operation_key)


@router.post("/moderation/reports/{identifier}/resolve")
def resolve(identifier: str, actor: TrustedActor, ctx: Context):
    return perform(ModerationService(ctx).resolve_report, actor, identifier)
