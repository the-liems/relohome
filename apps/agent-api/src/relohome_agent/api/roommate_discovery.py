from fastapi import APIRouter
from relohome_agent.api.roommate_access import Context, TrustedActor, perform
from relohome_roommate.api_models import DiscoveryPage, SearchInput
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.discovery import DiscoveryService

router = APIRouter(prefix="/roommate", tags=["roommate"])


@router.post("/search", response_model=DiscoveryPage)
def search(body: SearchInput, actor: TrustedActor, ctx: Context):
    return perform(DiscoveryService(ctx).search, actor, body.criteria, offset=body.offset, limit=body.limit)


@router.get("/profiles/{identifier}")
def detail(identifier: str, actor: TrustedActor, ctx: Context):
    return perform(DiscoveryService(ctx).detail, actor, identifier)


@router.get("/areas/{city}")
def areas(city: str, actor: TrustedActor, ctx: Context):
    perform(AccessService(ctx).require, actor)
    return {
        "areas": [
            {"area_id": identifier, "city": value.value}
            for identifier, value in sorted(ctx.catalog.membership.items())
            if value.value == city
        ]
    }
