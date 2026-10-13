"""Local discovery only. Identity is supplied by trusted graph context."""

import asyncio

from pydantic import ValidationError
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskResult, failed_result, reject_unsupported
from relohome_agent.agents.subagents.capabilities import ROOMMATE
from relohome_agent.agents.subagents.services.payment import ACTOR_ID
from relohome_roommate.access import RoommateError
from relohome_roommate.models import RoommateSearchCriteria
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.discovery import DiscoveryService


class RoommateSubagent:
    def __init__(self, runtime, actor_provider=ACTOR_ID.get):
        self.runtime, self.actor_provider = runtime, actor_provider
        self.capability = ROOMMATE.model_copy(deep=True)

    def _read(self, actor_id, raw):
        if self.runtime is None:
            return "disabled", [], None
        try:
            actor = Actor(id=actor_id)
        except (ValidationError, TypeError):
            return "eligibility_required", [], None
        with self.runtime.context() as ctx:
            try:
                AccessService(ctx).require(actor)
            except RoommateError:
                return "eligibility_required", [], None
            if raw is None:
                return "criteria_required", [], None
            criteria = RoommateSearchCriteria.model_validate(raw)
            found = DiscoveryService(ctx).search(actor, criteria)
            # Rehydrate profiles through the private API; never checkpoint profile snapshots.
            refs = [{"profile_id": item["profile"]["profile_id"]} for item in found["items"]]
            return "ready", refs, criteria.model_dump(mode="json", exclude_none=True)

    async def run(self, req):
        unsupported = reject_unsupported(req, "roommate-store", "live")
        if unsupported:
            return unsupported
        if set(req.inputs) - {"roommate_criteria"}:
            return failed_result(req, "invalid_input", "Roommate chỉ hỗ trợ tìm kiếm.", False, "roommate-store", "live")
        try:
            availability, refs, criteria = await asyncio.to_thread(
                self._read, self.actor_provider(), req.inputs.get("roommate_criteria")
            )
        except (ValueError, TypeError, RoommateError):
            return failed_result(
                req, "invalid_input", "Tiêu chí Roommate chưa hợp lệ.", False, "roommate-store", "live"
            )
        return AgentTaskResult(
            task_id=req.task_id,
            plan_version=req.plan_version,
            status="done",
            data={"entry": "roommate", "availability": availability, "profile_refs": refs, "criteria": criteria},
            source="roommate-store",
            source_kind="live",
            source_refs=[ref["profile_id"] for ref in refs],
            fetched_at=utcnow(),
            summary="Mở dịch vụ tìm người ở cùng; bạn tự quyết định xem hồ sơ và liên hệ.",
        )
