from fastapi import APIRouter
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
def reports(actor: TrustedActor, ctx: Context):
    return {"items": perform(ModerationService(ctx).reports, actor)}


@router.post("/moderation/profiles/{identifier}")
def moderate(identifier: str, body: ModerationInput, actor: TrustedActor, ctx: Context):
    return perform(ModerationService(ctx).restrict, actor, identifier, body.selected, body.reason, body.operation_key)


@router.post("/moderation/reports/{identifier}/resolve")
def resolve(identifier: str, actor: TrustedActor, ctx: Context):
    return perform(ModerationService(ctx).resolve_report, actor, identifier)
