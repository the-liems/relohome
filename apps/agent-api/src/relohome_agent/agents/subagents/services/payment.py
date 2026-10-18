"""Owned payment reads. Identity comes from graph code, never model arguments."""

from contextvars import ContextVar

from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskResult, failed_result
from relohome_agent.agents.models import AgentUsage
from relohome_agent.agents.subagents.capabilities import PAYMENT
from relohome_agent.services.adapters.mcp import ToolCallError

ACTOR_ID: ContextVar[str | None] = ContextVar("trusted_graph_actor", default=None)


class PaymentSubagent:
    def __init__(self, client, db):
        self.client, self.db = client, db
        self.capability = PAYMENT.model_copy(deep=True)

    def authorized(self, req):
        owner = self.db.get("sandbox_payment_owners", req.inputs.get("payment_id", ""))
        return bool(owner and ACTOR_ID.get() and owner.get("owner") == ACTOR_ID.get())

    async def run(self, req):
        if req.budget.max_provider_calls < 1:
            return failed_result(req, "budget_exceeded", "Payment read budget exhausted.", False, "zalopay", "sandbox")
        if not self.authorized(req):
            return failed_result(
                req,
                "invalid_input",
                "Không tìm thấy thanh toán thuộc người dùng hiện tại.",
                False,
                "zalopay",
                "sandbox",
            )
        usage = AgentUsage(provider_calls=1)
        try:
            raw = await self.client.call("get_payment", {"payment_ref": req.inputs["payment_id"]})
            if raw.get("payment_id") != req.inputs["payment_id"] or raw.get("provider") != "zalopay":
                raise ValueError("Unexpected payment")
            payment = {k: raw.get(k) for k in ("payment_id", "provider", "status", "amount", "currency", "expires_at")}
            return AgentTaskResult(
                task_id=req.task_id,
                plan_version=req.plan_version,
                status="done",
                data={"payment": payment},
                source="zalopay",
                source_kind="sandbox",
                source_refs=[raw["payment_id"]],
                fetched_at=utcnow(),
                usage=usage,
            )
        except ToolCallError as exc:
            return failed_result(
                req,
                "provider_unavailable" if exc.retryable else "provider_rejected",
                "Không xác minh được trạng thái thanh toán; không kết luận đã trả tiền.",
                exc.retryable,
                "zalopay",
                "sandbox",
                usage,
            )
        except (ValueError, TypeError, AttributeError):
            return failed_result(
                req,
                "provider_unavailable",
                "Không xác minh được trạng thái thanh toán; không kết luận đã trả tiền.",
                False,
                "zalopay",
                "sandbox",
                usage,
            )
