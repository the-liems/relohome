from fastapi import APIRouter, Query
from relohome_agent.api.roommate_access import Context, TrustedActor, perform
from relohome_roommate.api_models import ChatInviteInput, ChatMessageInput, ChatReadInput, OperationInput
from relohome_roommate.services.chat import ChatService

router = APIRouter()


@router.post("/chat/requests")
def invite(body: ChatInviteInput, actor: TrustedActor, ctx: Context):
    return perform(ChatService(ctx).invite, actor, body.recipient_id, body.intro, body.operation_key)


@router.post("/chat/requests/{identifier}/accept")
def accept(identifier: str, body: OperationInput, actor: TrustedActor, ctx: Context):
    return perform(ChatService(ctx).accept, actor, identifier, body.operation_key)


@router.get("/chat/conversations")
def conversations(actor: TrustedActor, ctx: Context, offset: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=50)):
    return perform(ChatService(ctx).conversations, actor, offset=offset, limit=limit)


@router.get("/chat/conversations/{identifier}/messages")
def messages(
    identifier: str,
    actor: TrustedActor,
    ctx: Context,
    before: str | None = Query(None, max_length=128),
    limit: int = Query(30, ge=1, le=50),
):
    return perform(ChatService(ctx).messages, actor, identifier, before=before, limit=limit)


@router.post("/chat/conversations/{identifier}/messages")
def send(identifier: str, body: ChatMessageInput, actor: TrustedActor, ctx: Context):
    return perform(ChatService(ctx).send, actor, identifier, body.body, body.client_message_id)


@router.post("/chat/conversations/{identifier}/read")
def read(identifier: str, body: ChatReadInput, actor: TrustedActor, ctx: Context):
    return perform(ChatService(ctx).mark_read, actor, identifier, body.message_id)


@router.post("/chat/conversations/{identifier}/close")
def close(identifier: str, body: OperationInput, actor: TrustedActor, ctx: Context):
    return perform(ChatService(ctx).close, actor, identifier, body.operation_key)
