"""Real SQLite/checkpointer tests. No substituted models or service responses."""

import os
from datetime import timedelta

import pytest
from relohome_agent.agents.common import utcnow
from relohome_agent.services.adapters.sqlite_runtime import RuntimeDatabase, SqliteApprovalStore, SqlitePiiStore


@pytest.mark.asyncio
async def test_approval_and_encrypted_form_survive_restart(tmp_path):
    db = RuntimeDatabase(str(tmp_path))
    approval = await SqliteApprovalStore(db).create(
        user_id="storage-check",
        thread_id="storage-check",
        plan_version=1,
        payload_hash="storage-check",
        expires_at=utcnow() + timedelta(minutes=5),
    )
    form = {"storage_check": "encryption-round-trip"}
    ref = await SqlitePiiStore(db).put(form)
    assert "encryption-round-trip" not in str(db.get("pii", ref))
    assert await SqliteApprovalStore(db).mark_used(approval.approval_id, "first-use")
    db.close()
    db = RuntimeDatabase(str(tmp_path))
    try:
        assert await SqlitePiiStore(db).get(ref) == form
        assert (await SqliteApprovalStore(db).get(approval.approval_id)).user_id == "storage-check"
        assert await SqliteApprovalStore(db).mark_used(approval.approval_id, "first-use")
        assert not await SqliteApprovalStore(db).mark_used(approval.approval_id, "other-use")
    finally:
        db.close()


@pytest.mark.asyncio
@pytest.mark.skipif(os.getenv("RUN_LIVE_LLM") != "1", reason="Real LLM runtime opt-in")
async def test_real_runtime_checkpoint_survives_restart(tmp_path):
    from langchain_core.messages import HumanMessage
    from relohome_agent.agents.graph import run_config
    from relohome_agent.agents.wiring import AgentService
    from relohome_agent.config import Settings

    settings = Settings(
        agent_state_dir=str(tmp_path), location_mcp_url="", moving_mcp_url="", flight_mcp_url=""
    )
    service = await AgentService.open(settings)
    try:
        result = await service.graph.ainvoke(
            {
                "messages": [HumanMessage("Xin chào")],
                "user_id": "runtime-check",
                "thread_id": "runtime-check",
                "request_id": "runtime-check",
            },
            run_config("runtime-check", service.deps),
        )
        assert result.get("response") is not None
        assert (await service.deps.usage.counts("runtime-check")).llm_calls >= 1
    finally:
        await service.close()
    service = await AgentService.open(settings)
    try:
        snapshot = await service.graph.aget_state(run_config("runtime-check", service.deps))
        assert snapshot.values["user_id"] == "runtime-check"
        assert snapshot.values["response"].model_dump() == result["response"].model_dump()
    finally:
        await service.close()
