"""Chính sách bộ nhớ người dùng (agent-graph.md §6.0, §6.1 — chốt Q14). Chỉ hàm thuần.

Bộ nhớ chỉ chứa điều người dùng nói ra hoặc xác nhận; không lưu phòng, báo giá, ngày tháng hay dữ
liệu nhạy cảm. Mức 1 được tự điền (có thông báo) cho task `cheap`; mức 2 chỉ để gợi ý.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Literal

from relohome_agent.agents.housing_operations import is_housing_comparison
from relohome_agent.agents.models import (
    AgentName,
    CommitActionKind,
    MemoryUpdate,
    MemoryValue,
    PrefilledValue,
    SessionContext,
    TaskStatus,
)

Group = Literal["preferences", "traits", "hints"]

# Mức 1 (tự điền, có thông báo) và mức 2 (chỉ gợi ý). Field không có ở đây thuộc mức 3: không lưu.
MEMORY_TIERS: dict[str, tuple[int, Group]] = {
    "city": (1, "preferences"),
    "district": (1, "preferences"),
    "near": (1, "preferences"),
    "max_price_vnd": (1, "preferences"),
    "room_type": (1, "preferences"),
    "must_have": (1, "preferences"),
    "household_size": (1, "traits"),
    "has_pet": (1, "traits"),
    "has_motorbike": (1, "traits"),
    "origin": (2, "hints"),
    "from_address": (2, "hints"),
    "current_address": (2, "hints"),
    "volume": (2, "hints"),
}

# Field chỉ được tự điền khi mọi anchor của nó cũng lấy từ bộ nhớ (không bị đổi trong lượt này).
PREFILL_ANCHORS: dict[str, tuple[str, ...]] = {
    "max_price_vnd": ("city", "district", "near"),
    "district": ("city",),
    # A remembered place only narrows a search in the same city/district the user names now.
    "near": ("city", "district"),
}

# Lĩnh vực nào dùng field mức 1 nào; chỉ lĩnh vực `cheap` mới được tự điền (§6.1 bước 2).
PREFILL_FIELDS_BY_DOMAIN: dict[AgentName, tuple[str, ...]] = {
    AgentName.PROPERTY: (
        "city",
        "district",
        "near",
        "max_price_vnd",
        "room_type",
        "must_have",
        "household_size",
        "has_pet",
        "has_motorbike",
    ),
}

# Bộ lọc tự điền được nới khi cho 0 kết quả (`soft_filters`); field vị trí thì không nới.
SOFT_FILTER_KEYS = ("max_price_vnd", "room_type", "must_have")


def group_of(key: str) -> Group | None:
    tier = MEMORY_TIERS.get(key)
    return tier[1] if tier else None


def memory_value(session: SessionContext, key: str) -> MemoryValue | None:
    group = group_of(key)
    return getattr(session, group).get(key) if group else None


def prefill_from_memory(
    stated: dict[str, Any],
    session: SessionContext,
    domains: list[AgentName],
    cost_tiers: dict[AgentName, str],
    ttl: dict[str, timedelta],
    now: datetime,
    *,
    excluded_housing_fields: frozenset[str] = frozenset(),
) -> dict[str, PrefilledValue]:
    """Giá trị mức 1 được tự điền cho lượt này. Tin nhắn luôn thắng bộ nhớ."""
    candidates: dict[str, PrefilledValue] = {}
    # An explicitly scoped search is complete enough to run as stated. Past
    # searches are suggestions, not permission to narrow this one, even when
    # the city has not changed. Conversation refinements are carried by Intake
    # separately; this policy concerns cross-goal/session memory only.
    explicit_housing_scope = any(key in stated for key in ("city", "district", "near", "bounding_box"))
    remembered_search_filters = {"district", "near", "max_price_vnd", "room_type", "must_have"}
    for domain in domains:
        if cost_tiers.get(domain) != "cheap":
            continue
        for key in PREFILL_FIELDS_BY_DOMAIN.get(domain, ()):
            if domain == AgentName.PROPERTY and key in excluded_housing_fields:
                continue
            if domain == AgentName.PROPERTY and explicit_housing_scope and key in remembered_search_filters:
                continue
            tier = MEMORY_TIERS.get(key)
            memory = memory_value(session, key)
            if key in stated or key not in ttl or tier is None or tier[0] != 1:
                continue
            if memory is None or memory.stop_prefill or now - memory.last_confirmed_at > ttl[key]:
                continue
            candidates[key] = PrefilledValue(
                value=memory.value,
                source="trait" if tier[1] == "traits" else "preference",
                last_confirmed_at=memory.last_confirmed_at,
            )
    result = {}
    for key, value in candidates.items():
        anchors_ok = all(
            anchor not in stated
            or ((memory := memory_value(session, anchor)) is not None and memory.value == stated[anchor])
            for anchor in PREFILL_ANCHORS.get(key, ())
        )
        if anchors_ok:
            result[key] = value
    return result


def memory_updates(state: dict) -> list[MemoryUpdate]:
    """Cập nhật bộ nhớ cuối lượt (§6.0 "Ghi bộ nhớ"); `respond` gọi rồi `SessionPort.save`.

    - Chỉ lưu fact có evidence của người dùng, thuộc mức 1/2, và đã được dùng để làm tiếp (có task
      `DONE` dùng giá trị đó).
    - Giá trị tự điền được dùng tiếp mà không sửa: chỉ cập nhật `last_confirmed_at`.
    - Anchor đổi giá trị: ngừng tự điền field phụ thuộc, trừ khi người dùng cũng nói giá trị mới.
    - Đặt xe chuyển nhà thành công trong lượt này: ngừng tự điền khu vực, lưu gợi ý địa chỉ hiện tại.
    """
    intake = state.get("intake")
    plan = state.get("plan")
    session: SessionContext = state.get("session") or SessionContext()
    updates: list[MemoryUpdate] = []
    if intake is not None and plan is not None:
        statuses = state.get("task_status") or {}
        done_tasks = [
            t
            for t in plan.tasks
            if statuses.get(t.id) == TaskStatus.DONE and not is_housing_comparison(t.agent, t.inputs)
        ]

        def used(key: str, value: Any) -> bool:
            for task in done_tasks:
                # Housing preferences must not be learned from a one-off Map/Flight request.
                if key in PREFILL_FIELDS_BY_DOMAIN[AgentName.PROPERTY] and task.agent != AgentName.PROPERTY:
                    continue
                inputs = task.inputs
                soft = inputs.get("soft_filters") or {}
                if inputs.get(key) == value or (isinstance(soft, dict) and soft.get(key) == value):
                    return True
            return False

        stated: set[str] = set()
        for key, fact in intake.user_confirmed_facts.items():
            group = group_of(key)
            if group is None or not used(key, fact.value):
                continue
            stated.add(key)
            updates.append(
                MemoryUpdate(group=group, key=key, value=fact.value, evidence=fact.evidence, stop_prefill=False)
            )
        for key, pre in intake.prefilled.items():
            group = group_of(key)
            if group and key not in stated and used(key, pre.value):
                updates.append(MemoryUpdate(group=group, key=key, touch_only=True))
        for key, anchors in PREFILL_ANCHORS.items():
            group = group_of(key)
            if key in stated or group is None or memory_value(session, key) is None:
                continue
            for anchor in anchors:
                memory = memory_value(session, anchor)
                if (
                    anchor in stated
                    and memory is not None
                    and memory.value != intake.user_confirmed_facts[anchor].value
                ):
                    updates.append(MemoryUpdate(group=group, key=key, touch_only=True, stop_prefill=True))
                    break
    transaction = state.get("transaction")
    for receipt in transaction.receipts if transaction else []:
        if receipt.kind != CommitActionKind.MOVING_BOOKING:
            continue
        for key in ("city", "district", "near"):
            if memory_value(session, key) is not None:
                updates.append(MemoryUpdate(group="preferences", key=key, touch_only=True, stop_prefill=True))
        to_address = receipt.details.get("to_address")
        if to_address:
            updates.append(
                MemoryUpdate(group="hints", key="current_address", value=to_address, evidence="đơn chuyển nhà đã đặt")
            )
    return updates


def apply_updates(
    session: SessionContext, updates: list[MemoryUpdate], thread_id: str, now: datetime
) -> SessionContext:
    """Áp `MemoryUpdate` lên `SessionContext`. Upsert theo (group, key), chạy lại không sai."""
    data = session.model_copy(deep=True)
    for update in updates:
        bucket: dict[str, MemoryValue] = getattr(data, update.group)
        current = bucket.get(update.key)
        if update.touch_only:
            if current is not None:
                bucket[update.key] = current.model_copy(
                    update={
                        "last_confirmed_at": current.last_confirmed_at if update.stop_prefill else now,
                        "stop_prefill": current.stop_prefill if update.stop_prefill is None else update.stop_prefill,
                    }
                )
            continue
        if update.value is None:
            bucket.pop(update.key, None)
        elif current is not None and current.value == update.value:
            bucket[update.key] = current.model_copy(
                update={
                    "last_confirmed_at": now,
                    "stop_prefill": current.stop_prefill if update.stop_prefill is None else update.stop_prefill,
                }
            )
        else:
            bucket[update.key] = MemoryValue(
                value=update.value,
                stated_at=now,
                last_confirmed_at=now,
                source_thread=thread_id,
                stop_prefill=bool(update.stop_prefill),
            )
    return data


def forget_thread(session: SessionContext, thread_id: str) -> SessionContext:
    """Bỏ mọi giá trị được nêu lần đầu trong `thread_id` (người dùng xoá hội thoại đó)."""
    data = session.model_copy(deep=True)
    for group in ("preferences", "traits", "hints"):
        bucket: dict[str, MemoryValue] = getattr(data, group)
        for key in [k for k, v in bucket.items() if v.source_thread == thread_id]:
            del bucket[key]
    return data
