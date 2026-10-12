from fastapi import APIRouter
from relohome_agent.api.roommate_access import Context, TrustedActor, perform
from relohome_roommate.api_models import AcceptInput, ContactLeaseView, ContactUpdate, OperationInput, SendInput
from relohome_roommate.services.consent import ConsentService
from relohome_roommate.services.contacts import ContactService
from relohome_roommate.services.inbox import InboxService
from relohome_roommate.services.requests import RequestService

router = APIRouter(prefix="/roommate", tags=["roommate"])


@router.get("/me/contacts")
def contacts(actor: TrustedActor, ctx: Context):
    return {"channels": perform(ContactService(ctx).own, actor)}


@router.put("/me/contacts")
def update_contact(body: ContactUpdate, actor: TrustedActor, ctx: Context):
    return perform(ContactService(ctx).save, actor, body.kind, body.value, body.expected_version, body.operation_key)


@router.post("/requests")
def send(body: SendInput, actor: TrustedActor, ctx: Context):
    return perform(
        RequestService(ctx).send, actor, body.recipient_id, body.intro, body.contact, body.consent, body.operation_key
    )


@router.get("/me/requests")
def inbox(actor: TrustedActor, ctx: Context):
    return perform(InboxService(ctx).list, actor)


@router.get("/requests/{identifier}")
def detail(identifier: str, actor: TrustedActor, ctx: Context):
    return perform(InboxService(ctx).detail, actor, identifier)


@router.post("/requests/{identifier}/accept")
def accept(identifier: str, body: AcceptInput, actor: TrustedActor, ctx: Context):
    return perform(ConsentService(ctx).accept, actor, identifier, body.contact, body.consent, body.operation_key)


@router.post("/requests/{identifier}/withdraw")
def withdraw(identifier: str, body: OperationInput, actor: TrustedActor, ctx: Context):
    return perform(RequestService(ctx).close, actor, identifier, "withdraw", body.operation_key)


@router.post("/requests/{identifier}/reject")
def reject(identifier: str, body: OperationInput, actor: TrustedActor, ctx: Context):
    return perform(RequestService(ctx).close, actor, identifier, "reject", body.operation_key)


@router.get("/requests/{identifier}/contact", response_model=ContactLeaseView)
def contact(identifier: str, actor: TrustedActor, ctx: Context):
    return perform(ConsentService(ctx).read, actor, identifier)


@router.post("/requests/{identifier}/revoke")
def revoke(identifier: str, body: OperationInput, actor: TrustedActor, ctx: Context):
    return perform(ConsentService(ctx).revoke, actor, identifier, body.operation_key)


@router.get("/operations/{key}")
def operation(key: str, actor: TrustedActor, ctx: Context):
    return perform(RequestService(ctx).operation, actor, key)
