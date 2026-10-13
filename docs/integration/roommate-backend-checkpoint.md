# Roommate Discovery — Bàn giao backend/API/Agent

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


- Ngày: 2026-10-07, Asia/Saigon; branch local `QuangDung`.
- Phạm vi được xác nhận: hoàn tất backend, API và Agent trước; chưa làm frontend.
- Baseline: [product spec v1.0](../ideas/roommate-service.md), [plan](../../tasks/plan.md), [checklist](../../tasks/todo.md).
- **RM-01–31 hoàn tất**, có commit riêng cho từng increment. Chưa push/deploy/bật feature trên môi trường thật.

## Đã triển khai

| Lớp | Module và chức năng |
| --- | --- |
| Domain/storage | `src/roommate/`: typed models, clock UTC, SQLite riêng, migration nguyên tử, optimistic version, unordered pair, operation idempotency, quota/cooldown, contact vault. |
| Scoring | Normalization, hard filter hai chiều, factor matrix, missing-data coverage, ranking ổn định trước phân trang. Không dùng LLM/network cho candidate. |
| Services | Access 18+/terms, private intro, preview/publish/reconfirm/pause/resolve/delete, search/detail/criteria/bookmarks, request/inbox/expiry, consent/contact/revoke, block/report/moderation, ảnh riêng tư. |
| API | `src/api/roommate_*.py`: schema strict, trusted gateway identity, fresh authorization, private cache, safe error codes, bounded image upload. |
| Gateway | `Frontend/roommate_gateway.py`: dùng session/CSRF hiện có, allowlist routes, server tự gắn actor/token. Đây là Python gateway, không phải giao diện Roommate. |
| Agent | Capability read-only, namespace `roommate_criteria`, Intake/Planner/domain routing, subagent truy vấn local DB, response/progress, projection lịch sử và prompt chỉ giữ ID tham chiếu. |
| Composition | `src/config.py`, `src/main.py`, `src/agents/wiring.py`; feature off mặc định, đóng resources khi shutdown. |

Không sửa database Housing, tọa độ, cách tìm nhà, giá AhaMove, booking Flight/Payment hoặc authentication hiện có. Các thay đổi ở module Agent chung chỉ thêm domain Roommate. Các thay đổi frontend/housing đã có trước task được giữ nguyên và không stage vào các commit Roommate.

## Kiểm chứng

### Test riêng

**169 tests đạt**: `tests/test_roommate`, năm file `tests/test_agents/test_roommate_*.py`, hai file gateway/full-stack trong `Frontend/tests`.

- File SQLite thật; hai connection độc lập kiểm tra request chéo và accept cạnh tranh với block/đổi contact. Kết quả cuối không để grant mở sai quyền.
- Session gateway → router API thật → SQLite thật: đăng ký A/B/C, age/terms, publish, tìm, gửi/retry, accept, đọc contact, outsider denial, block, logout. Dùng ASGI transport, **chưa phải test browser**.
- Exact deadlines 30 ngày profile, 7 ngày pending/grant; cooldown theo hướng; quota/retry; profile soft/hard changes; phiên bản contact và quyền read-time.
- Rút khai báo đủ tuổi làm pause profile, cancel pending, revoke grant và redact lịch sử intro; chấp nhận lại không tự đăng/mở consent.
- Backup bằng SQLite backup API + copy vault key, restore vào thư mục mới, đọc liên hệ và retry operation; integrity/FK check đạt.
- App lifespan bật/tắt Roommate và validation không echo input riêng tư. Live provider startup được thay bằng graph dependency injection trong test này; không dùng bằng chứng đó để khẳng định kết nối LLM/provider thật.
- Agent runtime không chứa tên, intro, avatar, contact hoặc raw score trong kết quả/checkpoint Roommate. Fresh detail sau block không hydrate được profile cũ.
- Mutation review: đảo điều kiện ACTIVE grant làm test consent fail; đã khôi phục nguyên file và chạy lại suite. Test thực sự phát hiện lỗi quyền, không chỉ mirror implementation.
- Ruff check/format các module mới đạt; Python compileall đạt.

### Hồi quy toàn project

**503 passed / 29 failed / 80 skipped**. Danh sách 29 lỗi trùng baseline RM-01 (khi đó 387 passed / 29 failed / 80 skipped). Không xóa assertion, thêm skip hoặc sửa service legacy để làm xanh.

Các nhóm lỗi đang tồn tại: MCP subprocess Windows, assertions/mocks Map/Moving/Flight, test API thiếu lifespan, Payment payload expectation. Danh sách cụ thể được lưu bên dưới; gate phát hành toàn project **chưa đạt**.

Evidence local, bị gitignore: `logs/local/roommate-focused.xml`, `roommate-backend-regression.xml`, `roommate-backend-regression.txt`.

### Hiệu năng

Fixture SQLite trên máy Windows hiện tại, 10/100/1.000 active profiles; loại block cả hai hướng và restricted, sort trước page. Trước tối ưu: 23/203/2.003 SELECT. Sau tối ưu: **4 SELECT** ở cả ba kích thước; lần đo local lần lượt khoảng 4/7/139 ms. Timing là một lần chạy development, không phải SLA production hoặc chứng minh tải đồng thời. Scoring thuần code; subagent usage `llm_calls=provider_calls=0`.

## Mapping kiểm chứng sản phẩm

| Product AC | Evidence backend chính | Phần còn lại |
| --- | --- | --- |
| 01–04 | `test_access`, `test_discovery_api`, `test_profiles_api`, `test_normalization`, gateway tests | Guest/age/terms và form UX trên browser. |
| 05 | Agent capability/subagent/intake/graph tests; domain độc lập | Live NLU smoke + entry/card UI + legacy regression còn đỏ. |
| 06–11 | Models, normalization, eligibility, factors, ranking, discovery paging tests | Labels và giải thích trên UI. |
| 12 | Pure scoring, subagent usage, discovery-cost fixtures | Browser call-count integration ở RM-44. |
| 13–16 | Profile repository/lifecycle, expiry, safety, media, fresh Agent hydration | Editor/preview/publish và stale tabs UI. |
| 17–22 | Request lifecycle/repository, consent, contact revocation, expiry, service regression, operational-integrity race tests | Double-click/UI review/consent flow. |
| 23 | Operation idempotency/status và gateway timeout tests | UI polling/đối soát khi kết quả chưa rõ. |
| 24–27 | Consent, connections API, real session full-stack, contact revocation, safety/expiry | Unchecked consent, contact lease/focus/logout UI. |
| 28–30 | Safe projections, API/gateway privacy, media/manual review, safety/moderation/inbox | Có thể lách contact bằng văn bản/ảnh; cần vận hành moderation và UI. |
| 31 | Ngoài phạm vi backend | RM-32–41/43/46: VI/EN, theme, responsive, accessibility, browser. |

Mapping này không đánh dấu AC trải nghiệm đã hoàn tất khi chưa có frontend.

## Hạn chế và bước tiếp theo

1. G1–G6 đã có evidence backend. G7–G9 còn chờ frontend/full browser regression/release review; RM-42–47 chưa đánh dấu hoàn tất toàn phần.
2. Giữ feature off. Tiếp theo là RM-32 theo plan, sau khi chủ sản phẩm mở phạm vi frontend.
3. Chưa có snapshot vùng chi tiết; mặc định dùng toàn HCM/Hà Nội/Đà Nẵng. Cần export IDs canonical khi nối form khu vực.
4. Single-host SQLite; chưa chứng minh HA/multi-replica hoặc tải production lớn hơn fixture 1.000 profiles.
5. LLM Intake/Planner được kiểm thử offline với structured responses; chưa chạy live NLU/provider smoke. LLM không được cấp contact hoặc quyền publish/connect.
6. Regex free-text giảm contact leak thông thường, không bảo đảm chặn mã hóa/viết cách chữ hoặc contact trong ảnh. Ảnh cần moderator duyệt trước public; cần quy trình review/report trước bật hồ sơ thật.
7. State riêng có PII; không đưa vào zip data housing/public hoặc Git. Đọc [runbook](../runbooks/roommate.md) về khóa, quyền thư mục và backup.

## 29 baseline failures hiện còn

Danh sách testcase (không đưa error body/PII vào tài liệu):

- `tests.test_agents.test_flight_mcp::test_langchain_loads_flight_tools_over_stdio`.
- `tests.test_agents.test_live_flight_payment::test_book_flight_through_real_flight_and_payment_servers`.
- `tests.test_agents.test_map_workspace::test_planner_binds_chosen_place_only_to_the_same_endpoint_text`.
- `tests.test_agents.test_map_workspace::test_partial_ranking_keeps_every_observed_option`.
- `tests.test_agents.test_map_workspace::test_amenity_request_in_a_housing_goal_becomes_a_housing_filter`.
- `tests.test_agents.test_moving_feedback::test_confirmation_shows_consented_price_band_for_moving`.
- `tests.test_agents.test_moving_feedback::test_moving_asks_when_address_only_matches_a_district_or_time_missing`.
- `tests.test_agents.test_moving_form_options::test_quote_and_commit_preserve_every_selected_option_and_use_private_contacts`.
- `tests.test_agents.test_moving_form_options::test_invalid_addon_asks_before_any_estimate_or_write`.
- `tests.test_agents.test_moving_form_options::test_catalog_endpoint_validates_coordinates_and_drops_provider_private_fields`.
- `tests.test_agents.test_planning::test_relocation_waits_for_room_choice_s4`.
- `tests.test_agents.test_poi_moving_confirmation::test_one_exact_poi_requires_pin_confirmation_but_confirmed_coordinates_are_preserved`.
- `tests.test_agents.test_service_subagents::test_moving_quote_to_selected_room`.
- `tests.test_agents.test_service_subagents::test_flight_destination_from_room_city`.
- `tests.test_agents.test_service_subagents::test_first_call_transport_error_is_retryable_by_wrapper`.
- `tests.test_api.test_chat_flow::test_booking_flow_over_http`.
- `tests.test_api.test_chat_flow::test_status_lists_domains`.
- `tests.test_api.test_chat_flow::test_default_app_answers_unsupported`.
- `tests.test_api.test_chat_flow::test_simulated_payment_completes_booking`.
- `tests.test_api.test_chat_flow::test_simulated_expiry_releases_hold`.
- `tests.test_api.test_chat_flow::test_simulation_is_off_in_live_mode_by_default`.
- `tests.test_api.test_routes::test_chat_empty_message`.
- `tests.test_api.test_routes::test_agent_status`.
- `tests.test_mcp_flights.test_server::test_lists_tools_with_annotations`.
- `tests.test_mcp_flights.test_server::test_full_booking_flow`.
- `tests.test_mcp_flights.test_server::test_errors_are_returned_as_tool_errors`.
- `tests.test_mcp_flights.test_server::test_expired_offer_cannot_be_held`.
- `tests.test_mcp_flights.test_server::test_resources_and_prompt`.
- `tests.test_mcp_payments.test_privacy::test_zalopay_receives_only_allowlisted_anonymous_fields`.
