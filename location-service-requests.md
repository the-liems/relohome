# Location service ↔ agent graph: yêu cầu tích hợp cho MVP

> Historical record: commands and source paths below describe the original checkout. Use the [current ReloHome location guide](docs/location/README.md) for operation.

- Gửi: Dũng (chủ service Location: housing, place, route — `Maps VN/LifeFlow`)
- Từ: Doan (agent graph / AI service)
- Ngày: 2026-09-29
- Nhánh: `integration/langgraph-services` (không đụng `main`). Nhánh `QuangDung` đã được ghép đủ tới
  commit `86d12f9`.
- Phản hồi: tạo file `docs/integration/location-service-response.md` theo mẫu ở §9.

## 1. Bối cảnh

MVP là **chat thật với chatbot**, không có kịch bản dựng sẵn: người dùng hỏi tự do, chatbot tìm phòng,
xem tiện ích xung quanh, tìm / đặt vé, báo giá / đặt xe chuyển đồ và thanh toán (mock). Demo chỉ trong
**một thành phố** (chuyển đồ liên tỉnh chưa có trong MVP). Thành phố demo chốt chung với Khoa: phải
vừa có dữ liệu tin nhà của bạn, vừa được AhaMove staging phục vụ.

Chatbot là một graph LangGraph ([agent-graph.md](../architecture/agent-graph.md),
[src/agents/README.md](../../src/agents/README.md)). Graph gọi MCP server của bạn qua **Streamable HTTP +
Bearer** bằng một subagent nền do mình viết
([`src/agents/subagents/services/location.py`](../../src/agents/subagents/services/location.py)).
MVP **có** subagent riêng của service Location (§6), làm sau khi dữ liệu và tool ổn định. Trong lúc chờ,
graph dùng subagent nền nên phần tìm phòng vẫn chạy được; khi subagent của bạn qua bộ kiểm tuân thủ thì
chỉ cần đổi cấu hình, graph không sửa (D13).

### Graph đang dùng tool nào

| Tool | Dùng cho | Cách gọi hiện tại |
|---|---|---|
| `resolve_location` | Tìm phòng gần địa danh ("gần BV Chợ Rẫy"); lấy toạ độ địa chỉ chuyển đồ | `{text, limit: 3}`, lấy kết quả đầu |
| `search_areas` | Tìm phòng theo thành phố / quận | `{text, limit: 1}` → `administrative_area_ids` |
| `search_housing` | Tìm phòng thuê | `listing_type: "rent"`, `center + radius_m (3000)` hoặc `administrative_area_ids`, `max_price {VND, month}`, `property_type`, `amenities`, `pagination.limit ≤ 25` |
| `find_nearby_places` | Tiện ích quanh tối đa 3 phòng đầu | `{origin, constraints: [{category, max_distance_m}]}` |

`get_housing`, `search_places`, `get_place`, `calculate_route` chưa dùng; frontend có thể dùng
`get_housing` để hiện chi tiết.

Graph tự xếp hạng (đã xác minh trước, ít field chưa biết, giá thấp) và **bỏ tin không có giá thuê
theo tháng (VND) hoặc không có địa chỉ**.

## 2. Dữ liệu tin nhà (việc chặn số 1)

**Hiện trạng mình đọc được trên nhánh:** đã có importer `db:import:housing` cho file
`housing_clean_*.jsonl` (nguồn Chợ Tốt, `docs/HOUSING-DATA-IMPORT.md`), nhưng README vẫn ghi "chưa có
nguồn tin đăng nhà ở thật" và `search_housing` trả rỗng trên DB mới. Graph nối vào sẽ luôn trả "chưa có
phòng phù hợp".

**Cần cho MVP:**

| # | Cần | Lý do |
|---|---|---|
| D1 | Dữ liệu tin **cho thuê** (`listing_type = rent`) đã import và publish cho **một thành phố demo**; đủ nhiều để lọc theo giá / quận vẫn còn kết quả (gợi ý ≥ 300 tin, trải nhiều quận) | Chat thật, câu hỏi không đoán trước |
| D2 | `price.currency = VND`, `price.period = month` cho tin thuê | Graph chỉ so sánh được giá tháng |
| D3 | `address` có địa chỉ đọc được; cho mình biết các khoá của `address_normalized` (ví dụ `street`, `ward`, `district`, `province`, `raw`) | Graph ghép địa chỉ để hiển thị và làm điểm giao đồ khi chuyển nhà |
| D4 | Toạ độ tin nhà và độ chính xác. `location_accuracy` đang chỉ có ở marker bản đồ, **chưa có** trong kết quả `search_housing` / `get_housing`: đề nghị thêm | Toạ độ gần đúng (tâm phường) mà dùng làm điểm giao đồ thì báo giá chuyển đồ sai |
| D5 | Danh sách **amenities chuẩn hoá** (slug) mà `units.amenities` thực sự chứa | `search_housing` lọc bằng `amenities @> [...]` (khớp chính xác); graph phải map lời người dùng ("có máy lạnh") sang đúng slug, lệch là ra 0 kết quả |
| D6 | Nếu nguồn có **tiền cọc**, đưa vào kết quả (ví dụ `deposit: Money \| null`) | Người dùng hay hỏi; hiện graph luôn ghi "chưa có thông tin" |
| D7 | Cách cập nhật dữ liệu định kỳ và hạn dùng (tin cũ bao lâu thì ẩn) | Không trình bày phòng đã cho thuê như còn trống |

Không cần commit file dữ liệu vào Git (đúng như importer đang làm); chỉ cần DB demo có dữ liệu và
hướng dẫn nạp lại.

## 3. Tìm toạ độ theo địa chỉ (việc chặn số 2)

**Cần gì:** khi người dùng nói "chuyển đồ từ 25 Nguyễn Trãi, Quận 5 tới phòng này", graph cần toạ độ
của "25 Nguyễn Trãi, Quận 5" để AhaMove báo giá.

**Hiện trạng (theo code `packages/housing-query/src/location-service.ts`):** `resolve_location` chỉ
tìm khu hành chính và địa điểm (POI) theo tên, hoặc theo chuỗi `address` của POI; loại trừ
`housing_anchor`. Không có dữ liệu số nhà / tên đường, nên địa chỉ nhà riêng gần như không tìm được.
**Nghĩa là chưa làm.**

**Đề xuất làm:** thêm MCP tool chỉ đọc `geocode_address`.

```text
vào:  { text: string, city?: "hcm" | "hanoi" | "danang", bounding_box?: BoundingBox, limit?: number }
ra:   { query, results: [{
          location: {lat, lng},
          precision: "rooftop" | "street" | "ward" | "district",
          matched_text: string,            // địa chỉ đã khớp, để người dùng xác nhận
          components: {house_number?, street?, ward?, district?, province?},
          source: {type, source_id}
        }] }
```

Cách làm tuỳ bạn chọn và ghi lại trong phản hồi:

| Cách | Ưu | Nhược |
|---|---|---|
| A. Import địa chỉ OSM (`addr:housenumber`, `addr:street` trên node / building) + đường có tên (`highway` + `name`) bằng osmium vào PostGIS; khớp số nhà, không có thì trả tâm đoạn đường với `precision = street` | Nằm trong hệ thống, không phụ thuộc bên ngoài, cùng cách làm với POI | Dữ liệu số nhà OSM ở Việt Nam thưa; phải chuẩn hoá tên đường có / không dấu |
| B. Dùng thêm toạ độ `housing_anchor` (địa chỉ tin nhà đã import) | Có sẵn | Chỉ phủ địa chỉ có tin đăng |
| C. Gọi geocoder ngoài (VietMap, Goong, Google…) sau adapter của service Location | Chính xác | Cần key, có phí, phải ghi rõ nguồn và điều khoản |

MVP chấp nhận `precision = street` (tài xế đi theo địa chỉ chữ). Graph sẽ hỏi lại người dùng khi chỉ
khớp tới phường / quận. Tool nằm ở service Location là đúng ranh giới R5 (tiện ích dùng chung, Q16).

## 4. Các điểm khác để chạy trơn

| # | Vấn đề | Đề nghị |
|---|---|---|
| L1 | `resolve_location` với cách viết tắt / không dấu: "Q10", "q.10", "BV Chợ Rẫy", "ĐH Bách Khoa", "Sài Gòn", "HCM" | Xác nhận `normalize_search` và alias đã phủ; nếu chưa thì thêm alias cho thành phố demo |
| L2 | Tên trùng giữa thành phố ("Quận 1", "Bách Khoa") | Graph sẽ truyền `bounding_box` của thành phố demo (lấy từ `search_areas`); xác nhận tool lọc đúng theo bbox |
| L3 | Category cho `find_nearby_places` | Graph dùng các slug đã có trong migration 006: `hospital`, `clinic`, `pharmacy`, `school`, `university`, `marketplace`, `supermarket`, `convenience_store`, `gym`, `park`, `bus_stop`, `bus_station`. Xác nhận thành phố demo có dữ liệu cho các loại này |
| L4 | Kết nối từ AI service | Chạy Streamable HTTP, đặt `MCP_AUTH_TOKEN`; thêm tên container của AI service vào `MCP_ALLOWED_HOSTS` (mặc định chỉ có `lifeflow-location-mcp`, localhost). Graph đọc `LOCATION_MCP_URL`, `LOCATION_MCP_AUTH_TOKEN` |
| L5 | Tốc độ | Graph gọi 2–4 tool nối tiếp mỗi lượt, timeout 20 s cho cả subagent. Cho mình biết thời gian điển hình của `search_housing` (có / không `commute`, `nearby`) trên dữ liệu thật |
| L6 | Lỗi | Lỗi tool nên có mã ổn định ở đầu message (`CODE: message`) hoặc JSON `{code, message}`; lỗi tạm thời ghi rõ (`UNAVAILABLE`, `TIMEOUT`) để graph biết được thử lại |
| L7 | `demo/agent.py` (agent LLM tự gọi MCP) | Có thể làm điểm xuất phát cho subagent ở §6 (đã có logic chọn tool). Chatbot MVP đi qua graph; câu trả lời cho người dùng do graph soạn, subagent chỉ trả dữ liệu có cấu trúc |

## 5. Xung đột tài liệu và code cần xử lý

| # | Xung đột | Đề nghị |
|---|---|---|
| X1 | ADR-007 (hai workspace, nguồn ADR-001 của nhánh bạn) trùng chủ đề ADR-001 của nhánh `khoa` (Polyglot LifeFlow workspace) | Đã đánh dấu ADR-007 `Superseded by ADR-001` trên nhánh tích hợp; bạn xác nhận hoặc bổ sung phần còn thiếu vào ADR-001 |
| X2 | ADR-011 / SPEC-012 ghi "AhaMove chưa có adapter báo giá, `amount_vnd = null`". Nhánh `khoa` đã có Moving MCP báo giá AhaMove thật (ADR-004, ADR-005) và graph dùng nó cho chuyển đồ | ADR-011 đã có mục cập nhật (áp dụng cho Location; báo giá AhaMove thuộc service Moving). Bạn sửa SPEC-012 tương ứng; `/v1/mobility/*` giữ cho vùng phục vụ / giá nội bộ nếu còn cần |
| X3 | SPEC-012 dẫn tới `packages/contracts/src/mobility.ts` và `packages/housing-query/src/mobility-service.ts` nhưng hai file này không có trên nhánh (chỉ có migration 009) | Thêm lại file hoặc sửa SPEC |
| X4 | `packages/contracts` dùng chung với Khoa (Khoa thêm `moving.ts`); `package.json` gốc, `package-lock.json`, CI job `lifeflow-typescript` cũng dùng chung | Chốt chủ sở hữu: `moving.ts` là của Khoa, phần còn lại của bạn; sửa `common.ts` cần cả hai review |
| X5 | Nhánh `QuangDung` và `khoa` tách nhau từ commit cũ, lần ghép vừa rồi có xung đột ở `Maps VN/LifeFlow/README.md`, `package.json` | Việc mới liên quan tích hợp thì làm trên (hoặc merge thường xuyên từ) `integration/langgraph-services` |
| X6 | ADR của nhánh bạn đã được đánh số lại 001–005 → 007–011 **trong nhánh tích hợp** (nhánh `QuangDung` giữ nguyên) | Xác nhận đồng ý; khi làm tiếp trên nhánh tích hợp thì dùng số mới |

## 6. Subagent của service Location (trong MVP, làm sau)

Một subagent phục vụ **hai lĩnh vực** `property` (tìm phòng) và `map` (tiện ích xung quanh). Contract:
[agent-graph.md](../architecture/agent-graph.md) §6.3 (quy tắc R1–R12), §6.3.8 (input / output tối thiểu);
JSON Schema: [docs/api/agent-contract/](../api/agent-contract/). Capability tối thiểu mà graph đang dùng:
[`capabilities.py`](../../src/agents/subagents/capabilities.py) (`PROPERTY`, `MAP`); subagent được thêm
field, không được bớt.

| # | Yêu cầu | Ghi chú |
|---|---|---|
| A1 | Expose trên MCP server hai tool `get_manifest` (trả `AgentManifest`) và `run_task` (vào `{"request": AgentTaskRequest}`, ra `AgentTaskResult`) | Viết bằng TypeScript cạnh 8 tool hiện có; schema lấy từ JSON Schema ở trên |
| A2 | `property`: tự chọn tool (`resolve_location` / `search_areas` / `geocode_address` → `search_housing`), **xếp hạng** kết quả, nới `soft_filters` khi 0 kết quả và ghi `relaxed_filters` | Hiện subagent nền của graph làm việc này bằng luật đơn giản; bạn làm tốt hơn nhờ hiểu dữ liệu |
| A3 | `map`: tiện ích quanh các phòng trong `upstream` (kết quả task `property`) hoặc quanh `near` | |
| A4 | Không bịa: field không có thì `null` và ghi vào `missing_fields`; mỗi item có id nằm trong `source_refs`; ghi `source_kind` | R2 |
| A5 | Không hỏi người dùng trực tiếp: thiếu thông tin (địa danh mơ hồ, không tìm thấy khu vực) thì trả `needs_input` kèm `questions` | R4 |
| A6 | Tôn trọng `budget` (`max_provider_calls`, `max_llm_calls`, `deadline_at`) và báo `usage` trung thực | R6, R11. Được dùng LLM bên trong (OpenAI, Q20) nếu cần |
| A7 | Chỉ đọc, không lưu dữ liệu người dùng, không gọi service lĩnh vực khác | R3, R5, R8 |
| A8 | Qua `check_conformance` ([conformance.py](../../src/agents/subagents/conformance.py)) với các request mẫu của bạn | Điều kiện để đăng ký thay subagent nền |

Phía graph sẽ chuẩn bị: cấu hình chọn subagent theo lĩnh vực (`nền` / `remote`), tự quay về subagent
nền nếu subagent của bạn không gọi được (`FallbackAgent`), nên bạn thay dần được mà không làm hỏng demo.

## 7. Phía graph sẽ làm (để bạn biết, không cần bạn làm)

- Truyền `bounding_box` thành phố demo khi `resolve_location` / `geocode_address`.
- Map `must_have` sang slug amenities theo danh sách D5; `nearby_categories` theo L3.
- Dùng `location_accuracy` (D4) và `precision` (§3) để hỏi lại khi toạ độ không đủ chính xác.
- Ưu tiên `address.raw` khi hiển thị nếu các khoá chuẩn hoá thiếu.
- Giữ phiên MCP giữa các lần gọi trong một lượt để giảm độ trễ.

## 8. Thứ tự đề xuất

1. D1–D3 (dữ liệu thành phố demo) và L4 (chạy HTTP + token) → graph chạy thật được phần tìm phòng.
2. D5, L3 (từ vựng amenities / category) → lọc đúng.
3. §3 `geocode_address` → báo giá chuyển đồ từ địa chỉ tự do.
4. D4, D6, L1, L2 → chất lượng.
5. §6 subagent Location (A1–A8) → đăng ký thay subagent nền.
6. X1–X6 → dọn tài liệu.

## 9. Mẫu phản hồi (`docs/integration/location-service-response.md`)

```markdown
# Phản hồi Location service
- Người trả lời: Dũng — Ngày:
- Commit / nhánh tương ứng:

## Thành phố demo và dữ liệu
- Thành phố:            Số tin thuê đã publish:        Ngày dữ liệu:
- Cách nạp lại dữ liệu (lệnh, file, checksum):
- Khoá address_normalized:
- Danh sách amenities (slug → ý nghĩa):
- location_accuracy / deposit trong search_housing: có / chưa (dự kiến ngày):

## Tìm toạ độ theo địa chỉ
- Chọn cách: A / B / C / khác — lý do:
- Tên tool, input / output (nếu khác đề xuất ở §3):
- Độ phủ dự kiến cho thành phố demo:

## Chạy và kết nối
- URL / cổng, cách cấp MCP_AUTH_TOKEN, MCP_ALLOWED_HOSTS:
- Thời gian điển hình của search_housing:

## Subagent (§6)
- Viết bằng: TypeScript trong MCP server / khác:        Có dùng LLM không:
- Ngày dự kiến có get_manifest + run_task:

## Từng mục (D1–D7, L1–L7, A1–A8, X1–X6)
| Mục | Đồng ý / Không / Khác | Ghi chú, ngày dự kiến |
|---|---|---|

## Việc bạn cần graph làm thêm
```
