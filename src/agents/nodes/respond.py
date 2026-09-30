"""Node `respond` — Response (agent-graph.md §6.10). Giai đoạn khung dùng template, không LLM.

Quy tắc chung: ghi chú rõ kết quả không phải `live`; nêu giá trị tự điền và mời sửa; `CLARIFY` do
validator phải kèm kết quả đã có; `summary` của subagent chỉ là thông tin tham khảo.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import AIMessage

from src.agents.deps import GraphDeps
from src.agents.memory import memory_updates
from src.agents.models import (
    AgentName,
    AgentResponse,
    OutcomeCode,
    Question,
    SessionContext,
    TaskStatus,
    error_record,
)
from src.agents.state import WorkflowState
from src.agents.suggestions import next_step_suggestions

logger = logging.getLogger(__name__)

QUESTION_TEXT = {
    "payment.payment_id": "Bạn muốn tra trạng thái mã thanh toán ZaloPay nào? Không gửi số tài khoản hay thông tin thẻ.",
    "map.route_from": "Bạn muốn đi từ địa điểm nào?",
    "map.route_to": "Bạn muốn đi tới địa điểm nào?",
    "map.city": "Bạn muốn tra đường tại thành phố nào?",
    "map.selected:property": "Bạn muốn tính đường cho căn nhà nào? Hãy chọn một căn trước.",
    "property.city|near": "Bạn muốn tìm phòng ở khu vực nào (ví dụ: gần ĐH Bách Khoa, Quận 10 TP.HCM)?",
    "relocation.from_address": "Bạn chuyển đồ từ địa chỉ nào?",
    "relocation.to_address": "Bạn chuyển đồ tới địa chỉ nào?",
    "relocation.move_date": "Bạn muốn chuyển đồ ngày nào?",
    "relocation.move_time": "Bạn muốn xe đến lúc mấy giờ?",
    "relocation.selected:property": "Bạn chọn phòng nào để mình báo giá chuyển đồ tới đó?",
    "flight.origin": "Bạn bay từ thành phố nào?",
    "flight.destination": "Bạn bay tới đâu?",
    "flight.flight_date": "Bạn muốn bay ngày nào?",
    "map.near": "Bạn muốn xem tiện ích quanh địa điểm nào?",
}
HINT_FOR = {"flight.origin": "origin", "relocation.from_address": "current_address"}
PREFILL_LABEL = {
    "city": "khu vực",
    "near": "gần",
    "max_price_vnd": "ngân sách",
    "room_type": "loại phòng",
    "must_have": "tiện ích",
    "household_size": "số người ở",
    "has_pet": "thú cưng",
    "has_motorbike": "xe máy",
}
SOURCE_NOTE = {
    "sandbox": "dữ liệu môi trường thử nghiệm (sandbox)",
    "demo": "dữ liệu giả lập (demo)",
    "fake": "dữ liệu mẫu, không phải dữ liệu thật",
}


def vnd(amount: Any) -> str:
    return f"{int(amount):,}".replace(",", ".") + "đ" if isinstance(amount, int | float) else "chưa có giá"


def question_for(field: str, session: SessionContext | None) -> Question:
    text = QUESTION_TEXT.get(field, f"Bạn cho mình biết thêm: {field}?")
    hint_key = HINT_FOR.get(field)
    hint = session.hints.get(hint_key) if (session and hint_key) else None
    if hint is not None and not hint.stop_prefill:  # mức 2: chỉ gợi ý để người dùng xác nhận
        text += f" (Như lần trước: {hint.value}?)"
    return Question(field=field, text=text, blocking=True)


def describe_result(agent: AgentName, data: dict, titles: dict[str, str] | None = None) -> list[str]:
    lines = []
    if agent == AgentName.PAYMENT:
        payment = data.get("payment") or {}
        lines.append(
            f"Thanh toán sandbox {payment.get('payment_id')}: {payment.get('status')} — {vnd(payment.get('amount'))}. Trạng thái do ZaloPay trả về, không đồng nghĩa dịch vụ đã được đặt."
        )
    if agent == AgentName.PROPERTY:
        for i, c in enumerate(data.get("candidates", [])[:5], 1):
            lines.append(
                f"{i}. {c.get('title')} — {vnd(c.get('price_vnd'))}/tháng — {c.get('address') or 'chưa có địa chỉ'}"
                + (f" — {c['bedrooms']} phòng ngủ" if c.get("bedrooms") is not None else "")
            )
        if not lines:
            lines.append("Chưa tìm thấy phòng phù hợp.")
    elif agent == AgentName.MAP:
        routing = data.get("routing") or {}
        if route := routing.get("route"):
            lines.append(
                f"Đường đi ({routing.get('profile')}): {route['distance_meters'] / 1000:.2f} km, khoảng {route['duration_seconds'] / 60:.0f} phút. Thời gian OSRM ước tính, không gồm giao thông trực tiếp."
            )
            if routing.get("warnings"):
                lines.append("Vị trí đầu hoặc cuối tuyến chỉ gần đúng/chưa rõ độ chính xác; tuyến đường là ước tính.")
        for key, pois in (data.get("nearby") or {}).items():
            names = ", ".join(
                f"{p.get('name') or p.get('category')} ({int(p.get('distance_m', 0))}m đường thẳng)" for p in pois[:3]
            )
            lines.append(f"Quanh {(titles or {}).get(key, key)}: {names or 'chưa có dữ liệu'}")
    elif agent == AgentName.FLIGHT:
        for offer in data.get("offers", [])[:5]:
            lines.append(f"{offer.get('carrier')} {offer.get('depart_at')} — {vnd(offer.get('fare_vnd'))}")
        if data.get("booking"):
            booking = data["booking"]
            lines.append(f"Đặt chỗ {booking.get('pnr') or booking.get('booking_id')}: {booking.get('status')}")
    elif agent == AgentName.RELOCATION:
        for quote in data.get("quotes", [])[:5]:
            lines.append(f"{quote.get('vehicle') or quote.get('provider')}: {vnd(quote.get('price_vnd'))}")
        if data.get("order"):
            order = data["order"]
            lines.append(
                f"Đơn {order.get('order_id')}: {order.get('status')}"
                + (f" — theo dõi: {order['shared_link']}" if order.get("shared_link") else "")
            )
    return lines


def receipt_line(receipt) -> str:
    details = receipt.details or {}
    if receipt.kind.value == "cancel_order":
        fee = vnd(receipt.amount_vnd) if details.get("cancel_fee_known") else "chưa rõ"
        return f"- Đã huỷ {receipt.receipt_id} ({receipt.status}); phí huỷ: {fee}"
    price = vnd(receipt.amount_vnd)
    estimated = details.get("estimated_vnd")
    if isinstance(estimated, int) and estimated != receipt.amount_vnd:
        price += f" (ước tính trước đó {vnd(estimated)}, trong khoảng bạn đã đồng ý)"
    return f"- {receipt.kind.value}: mã {receipt.receipt_id}, {price} ({receipt.status})"


DATA_NOTES = {
    "has_more": "Đây là một phần các tin phù hợp, chưa phải toàn bộ thị trường. Bạn có thể bổ sung bộ lọc để thu hẹp kết quả.",
    "approximate_origins": "Vị trí một số phòng chỉ gần đúng, nên khoảng cách tới tiện ích là ước lượng.",
    "destination_location_approximate": "Vị trí phòng chỉ gần đúng; giá chuyển đồ có thể thay đổi khi đặt.",
}


def data_notes(data: dict) -> list[str]:
    notes = [DATA_NOTES[k] for k in ("has_more", "approximate_origins") if data.get(k)]
    notes += [DATA_NOTES[w] for w in data.get("warnings") or [] if w in DATA_NOTES]
    return notes


def results_view(state: WorkflowState) -> tuple[list[str], dict, set[str], list[str]]:
    plan = state.get("plan")
    statuses = state.get("task_status") or {}
    results = state.get("task_results") or {}
    lines: list[str] = []
    view: dict = {}
    kinds: set[str] = set()
    relaxed: list[str] = []
    notes: list[str] = []
    titles = {
        c.get("id"): c.get("title")
        for r in results.values()
        if r.agent == AgentName.PROPERTY
        for c in r.data.get("candidates", [])
    }
    for task in plan.tasks if plan else []:
        result = results.get(task.id)
        if statuses.get(task.id) != TaskStatus.DONE or result is None:
            continue
        view[task.id] = {
            "agent": task.agent.value,
            "data": result.data,
            "source": result.source,
            "source_kind": result.source_kind,
            "fetched_at": result.fetched_at.isoformat(),
            "missing_fields": result.missing_fields,
            "summary": result.summary,
            "usage": result.usage.model_dump(mode="json"),
        }
        display_data = result.data
        intake = state.get("intake")
        selected = intake.user_confirmed_facts.get(f"selected:{task.agent.value}") if intake else None
        if selected and task.agent == AgentName.PROPERTY:
            chosen = [c for c in result.data.get("candidates", []) if c.get("id") == selected.value]
            if chosen:
                display_data = {**result.data, "candidates": chosen}
                lines.append("Căn bạn đã chọn:")
                # Keep the full result for workflow dependencies, but expose which
                # options actually appeared to support the next ordinal reference.
                view[task.id]["displayed_option_ids"] = [c["id"] for c in chosen]
        lines.extend(describe_result(task.agent, display_data, titles))
        notes.extend(data_notes(result.data))
        if result.source_kind != "live":
            kinds.add(result.source_kind)
        relaxed.extend(result.data.get("relaxed_filters") or [])
    return [*lines, *dict.fromkeys(notes)], view, kinds, relaxed


def compose(state: WorkflowState, deps: GraphDeps) -> AgentResponse:
    outcome = state.get("outcome")
    code = outcome.code if outcome else OutcomeCode.ERROR
    intake = state.get("intake")
    session = state.get("session")
    lines, view, kinds, relaxed = results_view(state)
    has_results = bool(view)
    data: dict[str, Any] = {"results": view}
    known_summary = ""
    if intake and AgentName.RELOCATION in intake.domains and code in {OutcomeCode.CLARIFY, OutcomeCode.ASK_USER}:
        values = intake.constraints.values
        known = {k: values[k] for k in ("move_date", "move_time", "from_address", "to_address") if values.get(k)}
        data["known_request"] = known
        if known:
            labels = {"move_date": "ngày", "move_time": "giờ", "from_address": "lấy tại", "to_address": "giao tới"}
            known_summary = (
                "Mình đã ghi nhận: "
                + "; ".join(f"{labels[k]} {v}" for k, v in known.items())
                + ". Bạn không cần nhập lại các thông tin này."
            )
            lines.insert(0, known_summary)
    plan = state.get("plan")
    if plan:
        data["plan_version"] = plan.version
    notes: list[str] = []
    if intake and intake.prefilled and has_results:
        parts = ", ".join(f"{PREFILL_LABEL.get(k, k)} {v.value}" for k, v in intake.prefilled.items())
        notes.append(f"Mình dùng {parts} như lần trước nhé. Muốn đổi thì bạn cứ nói.")
        data["prefilled"] = {k: v.value for k, v in intake.prefilled.items()}
    if relaxed:
        notes.append(
            "Không có kết quả với bộ lọc như lần trước ("
            + ", ".join(PREFILL_LABEL.get(r, r) for r in relaxed)
            + "); mình đã nới bộ lọc đó."
        )
    if code != OutcomeCode.COMMITTED:
        for kind in sorted(kinds):
            notes.append(f"Lưu ý: kết quả có {SOURCE_NOTE.get(kind, kind)}.")

    questions: list[Question] = []
    kind = "ERROR"
    head = ""
    if code in (OutcomeCode.UNSUPPORTED, OutcomeCode.PLAN_EMPTY):
        kind = "UNSUPPORTED"
        head = (
            (
                "Mình chưa hiểu được yêu cầu này (bộ phận hiểu yêu cầu chưa sẵn sàng)."
                if not intake or not intake.domains
                else "Chức năng lập kế hoạch cho yêu cầu này chưa sẵn sàng."
            )
            if code == OutcomeCode.PLAN_EMPTY
            else "Mình hỗ trợ tìm phòng, bản đồ, chuyển đồ, tìm chuyến bay và tra thanh toán đã có. Tạo thanh toán sandbox cần dùng form có xác nhận; chưa hỗ trợ xuất vé hay hoàn tiền qua chat."
        )
    elif code == OutcomeCode.CLARIFY:
        kind = "CLARIFY"
        questions = [question_for(f, session) for f in intake.blocking_missing]
        questions += [Question(field="conflict", text=c) for c in intake.conflicts]
        head = "Mình cần thêm một chút thông tin:"
        if any(f.startswith("property.") for f in intake.blocking_missing):
            notes.append(
                "Nếu có ngân sách hay yêu cầu như Wi-Fi, máy lạnh, chỗ để xe thì nói luôn để mình lọc sát hơn."
            )
    elif code == OutcomeCode.CHANGE_BLOCKED:
        kind = "CLARIFY"
        head = f"Phần bạn muốn đổi đã được đặt ({outcome.detail}). Bạn có muốn huỷ đơn đã đặt không?"
        questions = [Question(field="cancel_booked", text=head, options=["Có", "Không"])]
    elif code == OutcomeCode.ASK_USER:
        kind = "CLARIFY"
        validation = state.get("validation")
        asked = {q.field for q in validation.questions} if validation else set()
        questions = list(validation.questions) if validation else []
        questions += [
            question_for(f, session) for f in (validation.ask_user_fields if validation else []) if f not in asked
        ]
        questions += [
            Question(field="conflict", text=i.message)
            for i in (validation.issues if validation else [])
            if i.code == "V5"
        ]
        head = (
            "Đây là kết quả mình tìm được. Để làm tiếp, bạn cho mình biết thêm:"
            if has_results
            else "Để làm tiếp, bạn cho mình biết thêm:"
        )
    elif code == OutcomeCode.ANSWER:
        kind = "ANSWER"
        head = "Đây là kết quả mình tìm được:"
        summary = state.get("cost_summary")
        if summary:
            data["cost_summary"] = summary.model_dump(mode="json")
    elif code in (OutcomeCode.GIVE_UP, OutcomeCode.BUDGET):
        kind = "PARTIAL" if has_results else "ERROR"
        validation = state.get("validation")
        issues = [i.message for i in validation.issues] if validation else []
        reason = (
            "đã chạm giới hạn chi phí cho lượt này"
            if code == OutcomeCode.BUDGET
            or any("budget_exceeded" in (r.error or "") for r in (state.get("task_results") or {}).values())
            else (outcome.detail or "; ".join(issues[:3]) or "không lấy đủ dữ liệu")
        )
        head = f"Mình chỉ làm được một phần ({reason})." if has_results else f"Mình chưa làm được ({reason})."
    elif code == OutcomeCode.CANCELLED:
        kind = "CANCELLED"
        head = "Đã huỷ, mình không đặt gì cả."
    elif code in (OutcomeCode.COMMITTED, OutcomeCode.PARTIAL_COMMIT):
        tx = state.get("transaction")
        receipts = tx.receipts if tx else []
        data["receipts"] = [r.model_dump(mode="json") for r in receipts]
        lines = [receipt_line(r) for r in receipts]
        for kind_ in sorted({r.source_kind for r in receipts if r.source_kind != "live"}):
            notes.append(f"Lưu ý: giao dịch dùng {SOURCE_NOTE.get(kind_, kind_)}; không có tiền hay vé thật.")
        if any(r.kind.value == "moving_booking" for r in receipts):
            notes.append("Chuyển đồ trả tiền mặt cho tài xế.")
        if code == OutcomeCode.COMMITTED:
            kind, head = "COMMITTED", "Đã đặt xong:"
        else:
            # Không tự huỷ phần đã đặt: báo rõ từng phần rồi để người dùng quyết định (phản hồi Moving, M10).
            kind, head = "PARTIAL", "Mình mới đặt được một phần:"
            data["failed_action_ids"] = tx.failed_action_ids
            data["skipped_action_ids"] = tx.skipped_action_ids
            lines += [f"- Chưa đặt được {a}: {outcome.detail}" for a in tx.failed_action_ids]
            lines += [f"- Chưa thực hiện {a} (dừng sau thao tác lỗi)" for a in tx.skipped_action_ids]
            text = "Bạn có muốn huỷ phần đã đặt không? Phí huỷ (nếu có) theo chính sách nhà cung cấp."
            questions = [Question(field="cancel_booked", text=text, options=["Có, huỷ", "Không, giữ lại"])]
    elif code == OutcomeCode.PAYMENT_NOT_COMPLETED:
        kind = "CANCELLED"
        head = f"Chưa đặt được vì {outcome.detail}. Mình đã huỷ phần giữ chỗ; bạn có thể đặt lại."
    elif code == OutcomeCode.PENDING_VERIFICATION:
        kind = "ERROR"
        tx = state.get("transaction")
        if tx and tx.receipts:
            data["receipts"] = [r.model_dump(mode="json") for r in tx.receipts]
            lines = [receipt_line(r) for r in tx.receipts]
        head = f"Chưa rõ kết quả đặt chỗ ({outcome.detail}). Mình sẽ không tự đặt lại; vui lòng kiểm tra lại sau."
    else:
        kind = "ERROR"
        head = f"Có lỗi khi xử lý yêu cầu{': ' + outcome.detail if outcome and outcome.detail else ''}."
    if kind == "CLARIFY" and code == OutcomeCode.CLARIFY:
        lines = [known_summary] if known_summary else []
    body = [head, *lines, *(q.text for q in questions), *notes]
    return AgentResponse(kind=kind, text="\n".join(p for p in body if p), data=data, questions=questions)


def make_respond(deps: GraphDeps):
    async def respond(state: WorkflowState) -> dict:
        """Soạn AgentResponse, gợi ý bước tiếp theo (S9) và ghi bộ nhớ cuối lượt."""
        response = compose(state, deps)
        response.suggestions = next_step_suggestions(state, deps.agents, deps.settings.max_suggestions, response.kind)
        update: dict = {"response": response, "messages": [AIMessage(response.text)]}
        try:
            updates = memory_updates(state)
            if updates:
                await deps.session.save(state.get("user_id") or "anonymous", state.get("thread_id", ""), updates)
        except Exception as exc:
            logger.warning("memory save failed: %s", type(exc).__name__)
            update["errors"] = [error_record("respond", "không lưu được bộ nhớ người dùng", deps.clock())]
        return update

    return respond
