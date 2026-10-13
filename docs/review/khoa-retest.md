# Chạy lại 30 case trên nhánh `khoa` (194f51d)

> Historical record: commands and source paths below describe the original checkout. Use the [current ReloHome location guide](../location/README.md) for operation.

So sánh với lần chạy trên `mvp` (74f778a) trong [mvp-architecture.md](mvp-architecture.md) mục 8.
Kết quả chi tiết từng case: [khoa-multiflow-test-results.json](khoa-multiflow-test-results.json)
(trường `mvp_result` là kết quả cũ để đối chiếu).

## Cách chạy

- Stack local khởi động từ một worktree tạm của `origin/khoa`; build lại Node (`Maps VN/LifeFlow`) để có
  `quality_flags`. Cùng PostGIS/OSRM, LLM thật, AhaMove staging (chỉ báo giá), SerpApi thật.
- Cùng 30 case và cùng tiêu chí như lần `mvp`; mỗi case một tài khoản mới; không gửi CONFIRM.
- 4 case lỗi (TC16, TC23, TC27, TC28) chạy lại lần 2: ra cùng kết quả.

## Kết quả: 24 đạt, 6 không đạt (mvp: 23 / 7)

| Case | Nội dung | mvp | khoa | |
|---|---|---|---|---|
| TC05 | Moving catalog | FAIL (UNSUPPORTED) | PASS (ANSWER) | tốt hơn |
| TC12 | Housing + Flight + Moving catalog song song | FAIL (CLARIFY) | PASS (ANSWER) | tốt hơn |
| TC22 | Gần Bách khoa → đổi sang quận Hà Đông | FAIL (CLARIFY) | PASS (ANSWER) | tốt hơn |
| TC23 | Map nearby → route | PASS (ANSWER) | FAIL (ERROR) | **hồi quy** |
| TC27 | Housing "ưu tiên phòng rộng nhất" | PASS (ANSWER) | FAIL (ERROR) | **hồi quy** |
| TC03 | Route Hồ Hoàn Kiếm → Lăng Bác | FAIL | FAIL | dữ liệu (BUG-04) |
| TC11 | Housing "TP.HCM" + Map Hà Nội | FAIL | FAIL | Map đã chạy; Housing vẫn hỏi lại viết tắt |
| TC16 | (Housing → Map) + Flight | FAIL | FAIL | lỗi mới K-01 |
| TC28 | 4 domain | FAIL | FAIL | lỗi mới K-01 |
| 21 case còn lại | | PASS | PASS | |

Song song vẫn đúng: TC09, TC10, TC12 các task bắt đầu cùng lúc; TC12 nay đủ 3 task DONE
(property, flight, relocation catalog).

## Các lỗi BUG-01…12 trên stack thật

| Lỗi | Trên `khoa` | Bằng chứng |
|---|---|---|
| BUG-01 bộ nhớ Map lẫn Housing | Không tái hiện được trong bộ case (mỗi case một tài khoản) | Sửa ở code, chưa có case riêng kiểm |
| BUG-02 Moving catalog | **Đã sửa** | TC05, TC12: `mode=catalog`, `list_service_areas`, 71 khu vực. Danh sách lẫn mục nhà cung cấp như "VNM", "NA" và tên tiếng Anh |
| BUG-03 viết tắt chặn cả lượt | **Sửa một phần** | TC11: Map DONE; Housing vẫn hỏi lại "thành phố Thủ Đức, TP.HCM" |
| BUG-04 thiếu địa danh | Chưa sửa (dữ liệu) | TC03, TC08, TC13. Gợi ý fuzzy yếu đã bị loại, nên TC08/TC13 giờ hỏi lại điểm mà **không có choice nào** (mvp có 3) |
| BUG-05 giá bất thường | **Đã sửa** | TC09: căn Samtower 520.000đ không còn đứng đầu; 1 tin bị gắn cờ, không vào ngân sách |
| BUG-06 Planner không thử lại | Không gặp lỗi LLM trong lần chạy này, chưa kiểm được nhánh thử lại | |
| BUG-07 đặt xe khi ghi tắt | **Đã sửa** | TC30: ANSWER có báo giá + câu "chưa bật đặt/huỷ/sửa", `unavailable_actions=[moving_booking]` |
| BUG-08 thông báo lỗi | **Đã sửa** | TC29: "chưa có dữ liệu hợp lệ hoặc chưa có quyền truy cập"; TC23/TC28 không còn lộ mã nội bộ |
| BUG-09 đổi sang quận | **Đã sửa** | TC22: `{city: Hà Nội, district: Hà Đông}`, 5 căn Hà Đông |
| BUG-10 Moving hỏi lại điểm | **Sửa một phần** | TC19: có 1 choice là vị trí căn đã chọn; TC20: sân bay có 2 choice exact; vẫn phải xác nhận điểm |
| BUG-11 Moving trace | **Đã sửa** | TC30: `resolve_move_route → list_moving_services → get_moving_service ×2 → estimate_move → finish` |
| BUG-12 near=selected:property | Đã gỡ marker, nhưng lỗi chuyển sang dạng mới K-01 | TC16, TC28 |

## Lỗi mới trên `khoa`

### K-01 — `map_near` nhận cụm tham chiếu thay vì phụ thuộc Housing (Cao)

- **Tầng:** `intake` (key mới `map_near`) → Planner → Map subagent.
- **Hiện tượng:** "tìm siêu thị/chợ gần **các phòng đó**": Intake ghi `map_near = "các phòng đó"` (TC16) hoặc
  `map_near = "housing_results"` (TC28, lần 2). Task Map vẫn `depends_on` Housing nhưng có `near` là cụm chữ đó nên
  hỏi lại "Mình chưa xác định được vị trí "các phòng đó""; lần 1 của TC28 thì Planner ra `PLAN_INVALID`.
- **Nguyên nhân:** prompt cấm, nhưng code chỉ chặn marker `selected:*` ở `near`; `map_near` không được kiểm.
  Grounding còn buộc task Map chép `map_near` thành `near`, nên giá trị sai lan xuống subagent.
- **Hướng sửa:** khi có domain Housing trong cùng lượt và câu nói tham chiếu kết quả nhà, không nhận `map_near`;
  hoặc kiểm `map_near` bằng Location trước (giống `near`), không resolve được thì để Map phụ thuộc Housing.

### K-02 — Đổi Map nearby sang route: `map_near` cũ làm Planner ra PLAN_INVALID (Cao, hồi quy)

- **Tầng:** `nodes/intake.py` (gộp facts qua lượt) + `planner_llm._grounding_errors`.
- **Hiện tượng:** TC23 lượt 2 "Giờ tính đường đi bộ từ Văn Miếu đến Nhà hát Lớn" → ERROR, 2 lần chạy như nhau.
  Facts lượt 2: `map_mode=route` nhưng vẫn còn `map_near` của lượt 1.
- **Nguyên nhân:** `map_near` không nằm trong các key bị thay khi đổi `map_mode` (`SCOPE_DEPENDENTS`). Trong
  grounding, nhánh `elif values.get("map_near")` áp cho cả task route khi không có `map_city`, đòi task route phải có
  `near` → "omitted user constraint map_near" ở cả 2 lần Planner sửa.
- **Hướng sửa:** chỉ áp mapping `map_near → near` cho task nearby; bỏ `map_near` khi chuyển sang route.

### K-03 — Intake trích `max_area_m2 = 0`, task Housing thất bại (Trung bình, hồi quy)

- **Hiện tượng:** TC27 "ưu tiên phòng rộng nhất lên đầu" → fact `max_area_m2: 0`, task Housing `failed`, câu trả lời
  "Mình chưa làm được (không có phương án khác)". Lặp lại ở 2 lần chạy; trên `mvp` câu này không sinh fact diện tích.
- **Nguyên nhân:** LLM hiểu "rộng nhất" thành ràng buộc diện tích; code chấp nhận số 0 cho trần diện tích (không
  kiểm giá trị dương). Câu trả lời cũng không nói vì sao thất bại.
- **Hướng sửa:** từ chối `max_area_m2`/`min_area_m2` ≤ 0 khi ground fact; "ưu tiên rộng nhất" là yêu cầu sắp xếp,
  không phải bộ lọc.

### K-04 — Chọn phương án xoá luôn lựa chọn vừa ghi khi task phụ thuộc cùng domain (Thấp)

- **Tầng:** `src/api/web_actions.py`: ghi `selected:<domain>` rồi xoá `selected:<domain của task phụ thuộc>`.
- **Bằng chứng:** test offline `Frontend/tests/test_actions.py::test_selection_is_grounded_owned_and_persisted_in_graph`
  (KeyError `selected:property`). Không gặp trong 30 case vì kế hoạch thực tế ít khi có 2 task cùng domain nối nhau.
- **Hướng sửa:** không xoá key của chính domain đang chọn.

## Ghi chú khác

- Bộ test offline trên `khoa`: 262 đạt, 29 lỗi (mvp: 22). 6 lỗi thêm là test cũ chưa cập nhật theo hành vi mới
  (`property.city|near|district`, gợi ý fuzzy yếu, bỏ luật viết tắt) và 1 là K-04.
- Cần build lại `Maps VN/LifeFlow` khi dùng `khoa`, nếu không `quality_flags` không có trong kết quả.
- Tài khoản xem lại hội thoại: `review-tcNN-k1@example.test` (lần 1), `review-tcNN-k2@example.test` (lần 2 của 4 case),
  mật khẩu `review-mvp-2026`. Dữ liệu web/checkpoint của lần chạy này nằm trong worktree tạm (thư mục scratchpad), không nằm
  trong `data/` của repo; chỉ xem được khi chạy stack từ worktree đó và sẽ mất nếu máy khởi động lại.
