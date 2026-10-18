"""Node `respond` — Response (agent-graph.md §6.10). Giai đoạn khung dùng template, không LLM.

Quy tắc chung: ghi chú rõ kết quả không phải `live`; nêu giá trị tự điền và mời sửa; `CLARIFY` do
validator phải kèm kết quả đã có; `summary` của subagent chỉ là thông tin tham khảo.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from typing import Any

from langchain_core.messages import AIMessage
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.memory import memory_updates
from relohome_agent.agents.models import (
    AgentName,
    AgentResponse,
    OutcomeCode,
    Question,
    SessionContext,
    TaskStatus,
    error_record,
)
from relohome_agent.agents.progress import record_goal, record_selections
from relohome_agent.agents.state import WorkflowState
from relohome_agent.agents.suggestions import next_step_suggestions

logger = logging.getLogger(__name__)


def conflict_question(text: str, domains: list[AgentName]) -> Question:
    # The next short user answer must be tied to the field we actually asked
    # about, including invalid dates/times that could not become typed facts.
    field = "conflict"
    if AgentName.RELOCATION in domains:
        if re.search(r"\bgiờ\b|move_time", text, re.IGNORECASE):
            field = "move_time"
        elif re.search(r"\bngày\b|move_date", text, re.IGNORECASE):
            field = "move_date"
    return Question(field=field, text=text)


QUESTION_TEXT = {
    "payment.payment_id": "Bạn muốn tra trạng thái mã thanh toán ZaloPay nào? Không gửi số tài khoản hay thông tin thẻ.",
    "map.route_from": "Bạn muốn đi từ địa điểm nào?",
    "map.route_to": "Bạn muốn đi tới địa điểm nào?",
    "map.city": "Bạn muốn tra đường tại thành phố nào?",
    "map.selected:property": "Bạn muốn tính đường cho căn nhà nào? Hãy chọn một căn trước.",
    "property.city|near": "Bạn muốn tìm phòng ở khu vực nào?",
    "property.city|near|district": "Bạn muốn tìm phòng ở thành phố, quận/huyện hoặc gần địa điểm nào?",
    "property.listing_ids": "Bạn muốn so sánh những căn đã xem nào, hay tìm danh sách mới đúng khu vực và mức giá này trước?",
    "relocation.from_address": "Bạn chuyển đồ từ địa chỉ nào?",
    "relocation.to_address": "Bạn chuyển đồ tới địa chỉ nào?",
    "relocation.move_date": "Bạn muốn chuyển đồ ngày nào?",
    "relocation.move_time": "Bạn muốn xe đến lúc mấy giờ?",
    "relocation.selected:property": "Bạn chọn phòng nào để mình báo giá chuyển đồ tới đó?",
    "flight.origin": "Bạn bay từ thành phố nào?",
    "flight.destination": "Bạn bay tới đâu?",
    "flight.flight_date": "Bạn muốn bay ngày nào?",
    "flight.return_date": "Bạn muốn bay về ngày nào?",
    "map.near": "Bạn muốn xem tiện ích quanh địa điểm nào?",
}
HINT_FOR = {"flight.origin": "origin", "relocation.from_address": "current_address"}
PREFILL_LABEL = {
    "city": "khu vực",
    "district": "quận/phường",
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


# Câu trả lời có kiểu cho câu hỏi địa chỉ đến của chuyển đồ khi chưa chốt nhà (housing-viewing-design §7).
# Giao diện gọi endpoint riêng cho từng lựa chọn; chữ hiển thị nằm ở đây và file ngôn ngữ.
# Thứ tự là hợp đồng với giao diện: lựa chọn cuối luôn là "báo giá ngay"; có hai lựa chọn thì đầu là "chờ chốt".
MOVING_WAIT_FOR_HOME = "Chờ tôi xem nhà và chốt căn rồi báo giá"
MOVING_ADDRESS_NOW = "Báo giá ngay tới một địa chỉ"


def moving_destination_question(question: Question, state: WorkflowState) -> Question:
    """Chưa chốt nhà: chuyển đồ chờ chốt (tuần tự, mặc định) hoặc báo giá tới địa chỉ người dùng xác nhận."""
    if question.field != "relocation.selected:property":
        return question
    plan = state.get("plan")
    searches = [
        t
        for t in (plan.tasks if plan else [])
        if t.agent == AgentName.PROPERTY and t.inputs.get("housing_mode") != "compare"
    ]
    results = state.get("task_results") or {}
    statuses = state.get("task_status") or {}
    if (
        searches
        and not any(
            statuses.get(t.id) == TaskStatus.DONE
            and results.get(t.id) is not None
            and results[t.id].data.get("candidates")
            for t in searches
        )
        and not state.get("housing_selection")
    ):
        return Question(
            field=question.field,
            text="Tìm nhà chưa có kết quả để chọn. Mình giữ yêu cầu chuyển đồ và sẽ báo giá sau khi bạn chốt căn.",
            blocking=False,
        )
    if state.get("moving_destination_mode") == "wait_for_home":
        return Question(
            field=question.field,
            text="Chuyển đồ sẽ báo giá sau khi bạn gặp chủ nhà và chốt căn.",
            options=[MOVING_ADDRESS_NOW],
            blocking=False,
        )
    viewing = len(state.get("housing_selection") or [])
    lead = f"Bạn đang xem {viewing} căn, chưa chốt căn nào." if viewing else "Bạn chưa chốt căn nhà nào."
    return Question(
        field=question.field,
        text=f"{lead} Chuyển đồ nên chờ bạn chốt căn, hay báo giá ngay tới một địa chỉ bạn xác nhận?",
        options=[MOVING_WAIT_FOR_HOME, MOVING_ADDRESS_NOW],
    )


def unique_questions(questions: list[Question]) -> list[Question]:
    """Planner and validators may use provider aliases for the same field."""
    aliases = {"flight.date": "flight.flight_date"}
    unique: dict[str, Question] = {}
    for question in questions:
        field = aliases.get(question.field, question.field)
        normalized = question.model_copy(update={"field": field})
        existing = unique.get(field)
        if (
            existing is None
            or (normalized.choices and not existing.choices)
            or (normalized.reason and not existing.reason and not existing.choices)
        ):
            unique[field] = normalized
    return list(unique.values())


def _folded(text: str) -> str:
    """Accent/space-insensitive form, so a Vietnamese city name matches a provider's ASCII name."""
    plain = unicodedata.normalize("NFKD", text.replace("đ", "d").replace("Đ", "D"))
    return "".join(ch for ch in plain if ch.isalnum() and not unicodedata.combining(ch)).casefold()


def describe_result(
    agent: AgentName,
    data: dict,
    titles: dict[str, str] | None = None,
    asked_city: str | None = None,
    *,
    selected_property: bool = False,
) -> list[str]:
    lines = []
    if agent == AgentName.ROOMMATE:
        availability = data.get("availability")
        if availability == "eligibility_required":
            return [
                "Để tìm người ở cùng, hãy đăng nhập, xác nhận bạn từ 18 tuổi và đồng ý điều khoản dịch vụ trong form."
            ]
        if availability == "criteria_required":
            return [
                "Hãy chọn thành phố và tiêu chí trong dịch vụ Tìm người ở cùng. Bạn tự quyết định xem hồ sơ và liên hệ."
            ]
        if availability == "disabled":
            return ["Dịch vụ Tìm người ở cùng chưa được bật."]
        count = len(data.get("profile_refs") or [])
        if not count:
            return ["Chưa có hồ sơ phù hợp trong trang này. Bạn thử đổi tiêu chí tìm nhé."]
        return [f"Có {count} hồ sơ trong trang này. Bạn mở Ghép trọ để xem và tự chọn người muốn kết nối nhé."]
    if agent == AgentName.PAYMENT:
        payment = data.get("payment") or {}
        lines.append(
            f"Thanh toán sandbox {payment.get('payment_id')}: {payment.get('status')} — {vnd(payment.get('amount'))}. Trạng thái do ZaloPay trả về, không đồng nghĩa dịch vụ đã được đặt."
        )
    if agent == AgentName.PROPERTY:
        if comparison := data.get("comparison"):
            return [
                (
                    f"Đã tìm {len(comparison.get('rows', []))} căn trong khu vực mới để so sánh"
                    + (" (còn trang kết quả khác)." if comparison.get("has_more") else ".")
                    if comparison.get("scope") == "new_search_results_only"
                    else f"Đã đọc lại {len(comparison.get('rows', []))} căn để so sánh."
                )
                + " Bảng dữ kiện bên dưới không coi phí chưa biết là 0."
            ]
        candidates = data.get("candidates") or []
        if selected_property and candidates:
            chosen = candidates[0]
            lines.append(
                f"Căn bạn đã chọn: {chosen.get('title') or chosen.get('id')} — {vnd(chosen.get('price_vnd'))}/tháng."
            )
        elif candidates:
            # The map receives the complete candidates via results_view. Chat
            # describes this page, not a duplicated catalogue or market total.
            lines.append(f"Mình tìm được {len(candidates)} căn trong lượt này. Bạn mở bản đồ xem thử nhé.")
        else:
            lines.append("Chưa có căn phù hợp trong lượt này. Bạn thử đổi khu vực hoặc tiêu chí nhé.")
        if data.get("search_radius_m") and not selected_property:
            lines.append(
                f"Bán kính tìm: {data['search_radius_m']} m đường thẳng"
                + (" (mặc định, có thể đổi)." if data.get("radius_is_default") else ".")
            )
        if any(c.get("price_unverified") for c in candidates):
            lines.append("Giá chưa xác minh chưa tính vào ngân sách; mình đã đánh dấu trên từng tin.")
    elif agent == AgentName.MAP:
        routing = data.get("routing") or {}
        if route := routing.get("route"):
            profile = {"driving": "ô tô", "motorcycle": "xe máy", "walking": "đi bộ"}.get(
                str(routing.get("profile")), "phương tiện đã chọn"
            )
            lines.append(
                f"Tuyến {profile}: khoảng {route['distance_meters'] / 1000:.2f} km, "
                f"{route['duration_seconds'] / 60:.0f} phút. Đây là ước tính, chưa tính giao thông thực tế."
            )
            if routing.get("warnings"):
                lines.append("Vị trí đầu hoặc cuối tuyến chỉ gần đúng/chưa rõ độ chính xác; tuyến đường là ước tính.")
        for key, pois in (data.get("nearby") or {}).items():
            names = ", ".join(
                f"{p.get('name') or p.get('category')} ({int(p.get('distance_m', 0))}m đường thẳng)" for p in pois[:3]
            )
            lines.append(f"Quanh {(titles or {}).get(key, key)}: {names or 'chưa có dữ liệu'}")
    elif agent == AgentName.FLIGHT:
        # Full offers stay in the workspace payload, not a second catalogue in chat.
        if "offers" in data:
            count = len(data.get("offers") or [])
            if not count:
                lines.append("Chưa có chuyến bay phù hợp trong lượt này. Bạn thử đổi ngày hoặc hành trình nhé.")
            elif data.get("trip_type") == "round_trip":
                return_day = f", về ngày {data['return_date']}" if data.get("return_date") else ""
                lines.append(f"Mình có {count} chuyến đi cho hành trình khứ hồi{return_day}.")
                lines.append("Bạn chọn chuyến đi để xem chiều về và giá cả hành trình nhé; giá hiện tại là tham khảo.")
            else:
                lines.append(f"Mình có {count} chuyến bay trong lượt này. Bạn mở danh sách để xem giờ bay và giá nhé.")
        if data.get("booking"):
            booking = data["booking"]
            lines.append(f"Đặt chỗ {booking.get('pnr') or booking.get('booking_id')}: {booking.get('status')}")
    elif agent == AgentName.RELOCATION:
        if data.get("cities"):
            names = [c.get("local_name") or c.get("city_name") or c["city_id"] for c in data["cities"]]
            if asked_city:
                # Answer the user's question first, from the provider's own list.
                match = next((n for n in names if _folded(asked_city) and _folded(asked_city) in _folded(n)), None)
                lines.append(
                    f"AhaMove có phục vụ {asked_city} ({match})."
                    if match
                    else f"Danh sách khu vực AhaMove trả về không có {asked_city}."
                )
            lines.append(
                "Phạm vi AhaMove trả về: " + ", ".join(names) + ". Khả dụng cho tuyến cụ thể vẫn cần kiểm tra báo giá."
            )
        for service in data.get("services", []):
            lines.append(service.get("service_name") or service.get("name") or service["service_id"])
        if "quotes" in data:
            count = len(data.get("quotes") or [])
            lines.append(
                f"Mình có {count} báo giá chuyển đồ. Bạn xem các gói xe để chọn nhé; chưa đặt đơn."
                if count
                else "Chưa lấy được báo giá cho tuyến này. Bạn kiểm tra lại điểm giao nhận và thời gian nhé."
            )
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


def data_notes(data: dict, agent: AgentName | None = None) -> list[str]:
    labels = DATA_NOTES
    if agent == AgentName.PROPERTY:
        labels = {
            **DATA_NOTES,
            "approximate_origins": "Có vị trí gần đúng; khoảng cách tới tiện ích là ước lượng.",
        }
    # Pagination/market scope is shown in the housing workspace. The chat count
    # explicitly describes this turn, never the market or all matching listings.
    keys = ("approximate_origins",) if agent == AgentName.PROPERTY else ("has_more", "approximate_origins")
    notes = [labels[k] for k in keys if data.get(k)]
    notes += [
        labels[w]
        for w in data.get("warnings") or []
        if w in labels and not (agent == AgentName.PROPERTY and w == "has_more")
    ]
    return list(dict.fromkeys(notes))


def results_view(state: WorkflowState) -> tuple[list[str], dict, set[str], list[str]]:
    plan = state.get("plan")
    statuses = state.get("task_status") or {}
    results = state.get("task_results") or {}
    lines: list[str] = []
    earlier: list[str] = []  # results kept from previous turns: in `view`, not repeated in the text
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
        fresh = (result.data.get("execution") or {}).get("request_id") == state.get("request_id")
        intake = state.get("intake")
        if result.data.get("comparison") and intake and intake.needs_clarification and not fresh:
            continue  # Asking which homes is not a fresh comparison of old rows.
        view[task.id] = {
            "agent": task.agent.value,
            "data": result.data,
            "source": result.source,
            "source_kind": result.source_kind,
            "source_refs": result.source_refs,
            "fetched_at": result.fetched_at.isoformat(),
            "missing_fields": result.missing_fields,
            "summary": result.summary,
            "usage": result.usage.model_dump(mode="json"),
        }
        target = lines if fresh else earlier
        display_data = result.data
        selected_property = False
        intake = state.get("intake")
        selected = intake.user_confirmed_facts.get(f"selected:{task.agent.value}") if intake else None
        if selected and task.agent == AgentName.PROPERTY and not result.data.get("comparison"):
            chosen = [c for c in result.data.get("candidates", []) if c.get("id") == selected.value]
            if chosen:
                display_data = {**result.data, "candidates": chosen}
                selected_property = True
                # Keep the full result for workflow dependencies, but expose which
                # options actually appeared to support the next ordinal reference.
                view[task.id]["displayed_option_ids"] = [c["id"] for c in chosen]
        asked_city = intake.constraints.values.get("city") if intake and task.agent == AgentName.RELOCATION else None
        target.extend(
            describe_result(task.agent, display_data, titles, asked_city, selected_property=selected_property)
        )
        if fresh:
            notes.extend(data_notes(display_data, task.agent))
        if fresh:
            if result.source_kind != "live":
                kinds.add(result.source_kind)
            relaxed.extend(result.data.get("relaxed_filters") or [])
    if not lines:
        kinds = {item["source_kind"] for item in view.values() if item["source_kind"] != "live"}
        relaxed = [f for item in view.values() for f in item["data"].get("relaxed_filters", [])]
    # A turn that only reuses earlier results (nothing new ran) still shows them once.
    return [*(lines or earlier), *dict.fromkeys(notes)], view, kinds, relaxed


def compose(state: WorkflowState, deps: GraphDeps) -> AgentResponse:
    outcome = state.get("outcome")
    code = outcome.code if outcome else OutcomeCode.ERROR
    planner_questions = state.get("planner_questions") or []
    if code == OutcomeCode.ANSWER and planner_questions:
        code = OutcomeCode.ASK_USER  # có kết quả cho phần đã lập, còn domain cần người dùng bổ sung
    intake = state.get("intake")
    session = state.get("session")
    lines, view, kinds, relaxed = results_view(state)
    has_results = bool(view)
    data: dict[str, Any] = {"results": view}
    fresh_view = [
        item for item in view.values() if item["data"].get("execution", {}).get("request_id") == state.get("request_id")
    ]
    current_view = fresh_view or list(view.values())
    if state.get("housing_selection_changed") and not fresh_view:
        # Lượt chỉ thêm/bỏ căn đang xem: xác nhận ngắn thay vì lặp lại danh sách kết quả cũ.
        selection = state.get("housing_selection") or []
        names = ", ".join(h.get("label") or h.get("listing_id") for h in selection)
        lines = [
            f"Các căn bạn đang chọn để đi xem ({len(selection)}): {names}."
            if selection
            else "Bạn chưa chọn căn nào để đi xem.",
            "Đây chưa phải căn đã chốt. Hẹn lịch trong Kế hoạch → Xem nhà; gặp chủ nhà xong mới chốt.",
        ]
    comparison_only = bool(current_view) and all(item["data"].get("comparison") for item in current_view)
    known_summary = ""
    if intake and AgentName.RELOCATION in intake.domains and code in {OutcomeCode.CLARIFY, OutcomeCode.ASK_USER}:
        values = intake.constraints.values
        known = {k: values[k] for k in ("move_date", "move_time", "from_address", "to_address") if values.get(k)}
        data["known_request"] = known
        if known:
            labels = {"move_date": "ngày", "move_time": "giờ", "from_address": "lấy tại", "to_address": "giao tới"}
            known_summary = (
                "Mình đã ghi nhận: "
                + "; ".join(
                    f"{labels[k]} {'căn nhà bạn đã chọn' if v == 'selected:property' else v}" for k, v in known.items()
                )
                + ". Bạn không cần nhập lại các thông tin này."
            )
            lines.insert(0, known_summary)
    plan = state.get("plan")
    results = state.get("task_results") or {}
    if plan:
        data["plan_version"] = plan.version
    notes: list[str] = []
    if intake and intake.unavailable_commit_requested:
        data["unavailable_actions"] = [action.value for action in intake.unavailable_commit_requested]
        notes.append(
            'Để đặt và thanh toán, bấm "Thanh toán" trên vé hoặc báo giá chuyển đồ đã chọn (qua ReloHome, '
            "ZaloPay sandbox; vé là mô phỏng). Mình không tự đặt hay trả tiền qua chat."
            if deps.settings.app_payment
            else "Chức năng đặt/huỷ/sửa dịch vụ bạn yêu cầu chưa được bật trong phiên này; "
            "mình chỉ tra cứu thông tin/báo giá, chưa thực hiện giao dịch nào."
        )
    # Remembered constraints still affect an attempted search when retrieval fails.
    # Disclose their provenance instead of making an unstated budget look user-supplied.
    if intake and intake.prefilled:
        parts = ", ".join(f"{PREFILL_LABEL.get(k, k)} {v.value}" for k, v in intake.prefilled.items())
        if not comparison_only:
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
            else " ".join(
                p
                for p in (
                    intake.unsupported_reason if intake else None,
                    "Mình hỗ trợ tìm nhà (kèm điều kiện gần tiện ích), khám phá tiện ích/đường đi, chuyển đồ, tìm chuyến bay và tra"
                    " thanh toán đã có; chưa hỗ trợ xuất vé, thu hay hoàn tiền qua chat.",
                )
                if p
            )
        )
    elif code == OutcomeCode.CLARIFY:
        kind = "CLARIFY"
        questions = [question_for(f, session) for f in intake.blocking_missing]
        questions += [conflict_question(c, intake.domains) for c in intake.conflicts]
        if intake.constraints.values.get("housing_mode") == "compare" and intake.blocking_missing == [
            "property.listing_ids"
        ]:
            # One actionable clarification, not the same missing-ID question
            # twice (code + model) plus an irrelevant search-filter tutorial.
            data["comparison_clarification_details"] = list(intake.conflicts)
            questions = [question_for("property.listing_ids", session)]
        head = "Mình cần thêm một chút thông tin:"
        if (
            any(f.startswith("property.") for f in intake.blocking_missing)
            and intake.constraints.values.get("housing_mode") != "compare"
        ):
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
        questions += [q for q in planner_questions if q.field not in {x.field for x in questions}]
        head = (
            "Đây là kết quả mình tìm được. Để làm tiếp, bạn cho mình biết thêm:"
            if has_results
            else "Để làm tiếp, bạn cho mình biết thêm:"
        )
    elif code == OutcomeCode.ANSWER:
        kind = "ANSWER"
        # The result/empty-state sentence already introduces the answer. Avoid a
        # generic success heading, especially when the provider returned no matches.
        head = ""
        failed = [
            {"agent": t.agent.value, "task_id": t.id}
            for t in (plan.tasks if plan else [])
            if (state.get("task_status") or {}).get(t.id) in {TaskStatus.FAILED, TaskStatus.SKIPPED}
        ]
        if failed:
            kind = "PARTIAL" if has_results else "ERROR"
            head = (
                "Mình mới hoàn thành được một phần yêu cầu."
                if has_results
                else "Mình chưa lấy được kết quả từ dịch vụ. Bạn thử lại sau nhé."
            )
            data["failed_tasks"] = failed
            if any(
                (results.get(t["task_id"]).error_code if results.get(t["task_id"]) else None) == "invalid_input"
                for t in failed
            ):
                head = "Một phần yêu cầu chưa có dữ liệu hợp lệ hoặc bạn chưa có quyền truy cập. Hãy kiểm tra mã và thông tin đã cung cấp."
        limited = {}
        # A carried optional task is context, not unfinished work in this turn.
        # Required reused results still matter; when no task ran, show limitations
        # of reused results rather than incorrectly claiming a fresh completion.
        fresh_ids = {
            task.id
            for task in (plan.tasks if plan else [])
            if results.get(task.id) is not None
            and (results[task.id].data.get("execution") or {}).get("request_id") == state.get("request_id")
        }
        for task in plan.tasks if plan else []:
            if fresh_ids and not task.required and task.id not in fresh_ids:
                continue
            result = results.get(task.id)
            assessment = result.data.get("agent_assessment", {}) if result and result.status == "done" else {}
            # Comparison facts and the full domain assessment are already in
            # the table payload; do not repeat the table as a long chat essay.
            if (
                assessment.get("kind") == "model_assessment_not_provider_fact"
                and assessment.get("satisfaction") == "limited"
            ):
                limited[task.id] = assessment
                explanation = str(assessment.get("reason", ""))[:400]
                next_step = str(assessment.get("next_step", ""))[:300]
                if task.agent == AgentName.PROPERTY and not result.data.get("comparison"):
                    # Keep the full model rationale in the structured result;
                    # it must not turn a short search reply back into an essay.
                    notes.append("AI chưa xác minh đủ tiêu chí bạn cần; đây chưa phải xác nhận từ bên cho thuê.")
                elif not result.data.get("comparison"):
                    notes.append(
                        f"Agent {task.agent.value} đánh giá còn hạn chế (không phải xác nhận từ nhà cung cấp): "
                        + " ".join(p for p in (explanation, next_step) if p)
                    )
        if limited:
            data["limited_tasks"] = limited
            if kind == "ANSWER":
                kind = "PARTIAL"
                head = (
                    ""
                    if all(t.agent == AgentName.PROPERTY for t in (plan.tasks if plan else []))
                    else "Mình có kết quả, nhưng còn tiêu chí chưa xác minh:"
                )
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
        head = "Hệ thống chưa xử lý được yêu cầu trong lượt này. Không có giao dịch nào được thực hiện; bạn có thể thử lại."
        if outcome:
            data["error"] = {"node": outcome.node, "code": code.value}
    if kind == "CLARIFY" and code == OutcomeCode.CLARIFY:
        lines = [known_summary] if known_summary else []
    if comparison_only and code in {OutcomeCode.ANSWER, OutcomeCode.ASK_USER} and not data.get("failed_tasks"):
        count = sum(len(item["data"]["comparison"].get("rows", [])) for item in current_view)
        head = f"Đã so sánh {count} căn trong bảng dưới. Nhà bạn đã chọn không thay đổi."
        lines = []
        if data.get("limited_tasks"):
            lines.append("Một số tiêu chí chưa được xác minh; xem nhận xét dưới bảng.")
        if any(item["data"]["comparison"].get("price_outside_requested_range_ids") for item in current_view):
            lines.append("Có căn nằm ngoài khoảng giá yêu cầu; xem cảnh báo trong bảng.")
            if kind == "ANSWER":
                kind = "PARTIAL"
    questions = unique_questions(questions)
    if deps is not None and deps.settings.housing_viewing:
        questions = [moving_destination_question(q, state) for q in questions]
        if any(q.field == "relocation.selected:property" for q in questions):
            # Câu hỏi chờ chốt / địa chỉ cụ thể đã bao gồm điểm giao; không hỏi điểm giao lần nữa.
            questions = [q for q in questions if q.field != "relocation.to_address"]
    body = [head, *lines, *(q.text for q in questions), *notes]
    return AgentResponse(kind=kind, text="\n".join(p for p in body if p), data=data, questions=questions)


def make_respond(deps: GraphDeps):
    async def respond(state: WorkflowState) -> dict:
        """Soạn AgentResponse, gợi ý bước tiếp theo (S9) và ghi bộ nhớ cuối lượt."""
        response = compose(state, deps)
        from relohome_agent.guest_access import READ_AGENTS, is_guest

        if is_guest(state.get("user_id")):
            blocked = set(state.get("auth_required") or [])
            intake = state.get("intake")
            blocked.update(name.value for name in (intake.domains if intake else []) if name.value not in READ_AGENTS)
            if blocked:
                response.data["authentication_required"] = sorted(blocked)
                response.text += (
                    "\nĐăng nhập để tiếp tục dịch vụ cần tài khoản. Hội thoại và lựa chọn của bạn được giữ lại."
                )
        response.suggestions = next_step_suggestions(state, deps.agents, deps.settings.max_suggestions, response.kind)
        update: dict = {
            "response": response,
            "messages": [AIMessage(response.text)],
            "goal_tasks": record_goal(state),
            "goal_selections": record_selections(state),
        }
        for result in (state.get("task_results") or {}).values():
            if result.agent == AgentName.PROPERTY and result.status == "done" and not result.data.get("comparison"):
                if (result.data.get("execution") or {}).get("request_id") == state.get("request_id"):
                    update["last_housing_search_options"] = [
                        {"option_id": c["id"], "label": c.get("title") or "Tin nhà"}
                        for c in result.data.get("candidates", [])
                    ][:20]
        try:
            updates = memory_updates(state)
            if updates:
                await deps.session.save(state.get("user_id") or "anonymous", state.get("thread_id", ""), updates)
        except Exception as exc:
            logger.warning("memory save failed: %s", type(exc).__name__, exc_info=True)
            update["errors"] = [error_record("respond", "không lưu được bộ nhớ người dùng", deps.clock())]
        return update

    return respond
