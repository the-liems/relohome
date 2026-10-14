"""Recoverable ownership transfer under the existing thread lock and checkpoint API."""

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from relohome_agent.agents.graph import run_config
from relohome_agent.agents.memory import PREFILL_ANCHORS
from relohome_agent.agents.models import MemoryUpdate
from relohome_agent.checkout.models import ServiceTransaction
from relohome_agent.guest_access import is_guest


class GuestClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    thread_id: str = Field(min_length=1, max_length=128)
    target_user: str = Field(pattern=r"^[0-9a-f]{32}$")
    operation_key: str = Field(min_length=32, max_length=80)


async def claim(body, service, source):
    from relohome_agent.api.routes import _lock, _pending

    if not is_guest(source):
        raise HTTPException(403, "Only a gateway guest can transfer its current thread")
    async with _lock(service, body.thread_id):
        values, pending = await _pending(service, body.thread_id)
        if not values:
            return {"claimed": True}  # No chat yet: nothing in the Agent to transfer.
        journal = values.get("guest_claim") or {}
        target = body.target_user
        retry = (
            values.get("user_id") == target
            and journal.get("source") == source
            and journal.get("key") == body.operation_key
            and journal.get("target") == target
        )
        if values.get("user_id") != source and not retry:
            raise HTTPException(404, "Thread ownership does not match")
        if retry and journal.get("complete"):
            return {"claimed": True}
        if pending or values.get("committed") or values.get("pending_payment"):
            raise HTTPException(409, "A guest thread with pending or committed transactions cannot be transferred")
        store = getattr(service.viewing, "store", None) or getattr(service.checkout, "store", None)
        rows = (
            store.db.execute(
                "SELECT data FROM checkout_transactions WHERE user_id=? AND thread_id=?", (source, body.thread_id)
            ).fetchall()
            if store
            else []
        )
        drafts = [ServiceTransaction.model_validate_json(row[0]) for row in rows]
        if any(tx.status not in {"selected", "discarded"} or tx.details.get("viewing") for tx in drafts):
            raise HTTPException(409, "Only temporary selections can be transferred")
        if store:
            for tx in drafts:
                if store.attempts_for(tx.transaction_id) or store.job_for(tx.transaction_id):
                    raise HTTPException(409, "A transaction has payment state")
        config = run_config(body.thread_id, service.deps)
        journal = {"source": source, "target": target, "key": body.operation_key, "complete": False}
        if not retry:
            await service.graph.aupdate_state(config, {"user_id": target, "guest_claim": journal}, as_node="respond")
        if store:
            with store.transaction():
                for tx in drafts:
                    tx = tx.model_copy(update={"user_id": target})
                    store.db.execute(
                        "UPDATE checkout_transactions SET user_id=?,data=? WHERE transaction_id=? AND user_id=?",
                        (target, tx.model_dump_json(), tx.transaction_id, source),
                    )
        old_memory, account_memory = await service.deps.session.load(source), await service.deps.session.load(target)
        updates = [
            MemoryUpdate(group=group, key=key, value=value.value, evidence="guest_claim")
            for group in ("preferences", "traits", "hints")
            for key, value in getattr(old_memory, group).items()
            if value.source_thread == body.thread_id
            and key not in getattr(account_memory, group)
            and all(
                anchor not in account_memory.preferences
                or (
                    anchor in old_memory.preferences
                    and account_memory.preferences[anchor].value == old_memory.preferences[anchor].value
                )
                for anchor in PREFILL_ANCHORS.get(key, ())
            )
        ]
        await service.deps.session.save(target, body.thread_id, updates)
        await service.deps.session.forget(source)
        await service.graph.aupdate_state(config, {"guest_claim": {**journal, "complete": True}}, as_node="respond")
        return {"claimed": True}
