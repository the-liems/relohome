# Bản MVP gốc và bản sửa: hội thoại liên kết 4 lượt — 03/10/2026

## Kết luận

Bản sửa có giá trị thực trong phân biệt nhiệm vụ khám phá Map với lọc Housing,
đánh giá giới hạn dữ liệu và hỏi đúng thông tin cần thay sau provider từ chối.
Không phải bản gốc không có agent/LLM hay không có multiturn: bản gốc cũng hiểu
“căn đó”, giữ ngày và đổi giờ đúng trong hội thoại này.

Chấp nhận hướng sửa cho MVP, **không** kết luận toàn hệ thống đã tốt hơn mọi mặt.
Token vẫn lớn, phản hồi dài và có lượt hơn 20 giây. Chưa chứng minh việc suy luận
domain nhiều bước sẽ đáng chi phí cho mọi truy vấn đơn giản.

## Baseline và phương pháp

- Baseline **toàn bộ `src/` nguyên gốc** từ commit
  `b18fb4b944e2a9cacc34a3e73cd8ade7b055fdf9`, không phải snapshot trung gian
  `mission-efficiency-before-20261003` của đợt tối ưu trước.
- Git archive vào `data/original-mvp-b18fb4b-20261003`; chạy hai API riêng từ hai
  source root, cùng Location/PostGIS, Moving staging, cấu hình model/key thật.
  Không checkout/reset/pull làm thay đổi worktree.
- Cùng 4 câu, cùng luật đánh giá; actor/thread/runtime riêng. Cùng giới hạn
  `AGENT_MAX_ATTEMPTS=2` **chỉ ở API benchmark** để tránh repair kéo dài.
  Trần domain vẫn theo từng implementation. Cấu hình sản phẩm/.env không đổi.
- Chọn nhà qua endpoint UI action bằng listing ID thực; pin lấy từ listing và
  pin giao từ `/map/search` thực. Hai bên chọn cùng listing ID đầu tiên.
  Đây là kiểm backend nhận thao tác map/UI, không phải kiểm click trên browser.
- Không mock, không đơn/đặt vé/thu tiền. Không rerun những ca Flight/Payment đã
  đạt trước đây. Flight/Payment không nằm trong 4 câu mới này.
- Chỉ **8 POST /chat trả phí**: 4 câu mỗi phiên bản. Lỗi encoding stdout của
  harness sau câu đầu được sửa bằng ASCII JSON; resume checkpoint thật, không
  gọi lại câu đầu. GET map/persisted replay không gọi LLM.
- Theo [OpenAI Docs: Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals),
  kiểm trace, tool/handoff, nguồn và ràng buộc; không dùng chỉ nhãn ANSWER để
  chấm chất lượng. Đây là đánh giá thủ công + assertions, không thuê LLM judge.

Test: [test_original_mvp_followups_live.py](../tests/test_llm_agents/test_original_mvp_followups_live.py).
Liên quan: SPEC-014/AC-24–33, SPEC-003 planning, SPEC-001 multi-turn understanding.

## 4 câu mới và kết quả

### 1. Tìm nhà ở Cầu Giấy

> Tìm tối đa 6 căn nhà cho thuê ở quận Cầu Giấy, Hà Nội, giá không quá 7 triệu
> mỗi tháng. Chỉ xem thông tin, chưa đặt dịch vụ.

- Gốc: 5 tin, đúng phạm vi ngân sách, không lưu count 6, ANSWER.
- Sửa: 6 tin, `limit=6`, đúng ngân sách, PARTIAL. Agent nhận ra các tin trả về
  là phòng/ở ghép/homestay, chưa có bằng chứng nhà nguyên căn; nguồn chưa xác minh,
  có tin cảnh báo giá thấp. Không tự biến loại hình này thành nhà nguyên căn.
- Cả hai đạt kiểm giá/count tối đa. Chưa bên nào chứng minh đã tìm được nhà nguyên
  căn; không gọi kết quả PARTIAL của bản sửa là “hoàn tất mọi yêu cầu”.
- “Tối đa 6” không bắt buộc phải có 6, nên 5 tin của gốc không tự động là FAIL.
  Sửa có khả năng biểu diễn count và đánh giá điều chưa xác minh rõ hơn.

### 2. Chọn căn thực rồi khám phá tiện ích

> Quanh căn vừa chọn có nhà thuốc nào trong 800 mét? Giữ nguyên ngân sách tìm
> nhà, không tìm nhà lại.

- Gốc: chạy Housing mới, thêm điều kiện pharmacy vào tìm nhà; không tạo Map task.
  Có trả khoảng cách tiện ích cho căn, nhưng đã làm trái yêu cầu “không tìm nhà lại”.
- Sửa: Map nhận đúng selected listing, `categories=[pharmacy]`, radius 800 m,
  `find_nearby_places → finish`, không gọi Housing mới. Có nhà thuốc khoảng 25 m
  đường thẳng; vị trí nhà gần đúng và coverage gần nhất theo loại được công bố.
- **Gốc FAIL, sửa PASS** tiêu chí Map độc lập và không tìm lại Housing.

### 3. Moving tham chiếu căn đã chọn

> Nếu chuyển đồ từ căn đó đến Ga Hà Nội ngày 12/10/2026 lúc 14 giờ thì khoảng
> bao nhiêu tiền? Tôi chỉ hỏi giá, chưa đặt xe.

- Cả hai hiểu `from_address=selected:property`, giữ selected ID, ngày 12/10,
  giờ 14:00 và điểm giao Ga Hà Nội. Không hỏi lại ngày/giờ.
- Cả hai CLARIFY điểm lấy/giao trước báo giá. Nhà có tọa độ approximate, nên
  không tự coi marker nhà là điểm dừng xe chính xác. **Cả hai PASS** kiểm tham
  chiếu/giữ lịch và hỏi thông tin còn thiếu; chưa có quote ở lượt này.

### 4. Xác nhận pin và đổi giờ, gặp từ chối thật

> Đổi sang 16 giờ 15 cùng ngày nhé. Tôi xác nhận hai điểm trên bản đồ; giữ
> tuyến đó, chỉ báo giá, không đặt xe và không thanh toán.

- Hai pin gửi kèm lấy từ dữ liệu thật. Cả hai giữ ngày 12/10, đổi giờ 16:15,
  nhận hai tọa độ và tới bước `estimate_move`.
- Staging không trả quote cho lịch đó. Gốc tiếp theo hỏi `moving_request` với
  câu chung “làm rõ yêu cầu chuyển đồ hoặc mã đơn”.
- Sửa hỏi `move_date`, giải thích provider từ chối lịch vượt một tuần và xin
  phép đổi ngày; **không tự đổi ngày/giờ, không bịa giá**.
- Gate Moving chỉ mở `ask_user` sau rejection khi đã tới estimate; trace
  `estimate_move → ask_user` xác nhận nhánh từ chối. Tuy nhiên raw code/message
  của rejection chưa lưu trong canonical result: giải thích “một tuần” là lời
  agent dựa trên phản hồi tool, chưa phải policy nhà cung cấp đã độc lập kiểm
  chứng cho mọi service. Nên bổ sung rejection metadata đã scrub trong đợt sửa sau.
- **Gốc FAIL, sửa PASS** tiêu chí hỏi đúng field cần thay. **Cả hai chưa có báo
  giá thành công** cho tuyến/lịch này.

Harness đầu tiên kỳ vọng quote sau pin nên FAIL ở cả hai. Kỳ vọng đó không đúng
với lịch bị provider từ chối. Sau khi phân loại lại thành ca negative recovery,
chỉ replay checkpoint: sửa **4 PASS** kiểm tập trung; gốc **2 PASS, 2 FAIL**
(Map và recovery field). Không chạy lại LLM, không sửa sản phẩm/hardcode policy
một tuần để ép ca qua. Đây không phải 4/4 yêu cầu dịch vụ đã được hoàn tất.

## Độ trễ và token thực đo

Token = input + output, tính toàn lượt gồm Intake/Planner/domain và repair.

| Lượt | Gốc: giây | Sửa: giây | Gốc: token | Sửa: token | Gốc / sửa LLM calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tìm nhà | 16,143 | 14,029 | 18.344 | 14.543 | 5 / 4 |
| Nhà thuốc quanh căn chọn | 14,489 | 13,905 | 24.447 | 22.803 | 5 / 5 |
| Chuyển đồ “từ căn đó” | 12,802 | 10,996 | 14.138 | 15.024 | 3 / 3 |
| Đổi giờ, xác nhận pin, xử lý refusal | 27,738 | 22,816 | 64.863 | 30.885 | 8 / 7 |
| Tổng 4 lượt | 71,172 | 61,746 | 121.792 | 83.255 | 21 / 19 |

- Trong **mẫu này**: tổng token giảm khoảng **31,6%**, tổng thời gian chờ giảm
  khoảng **13,2%**. Không phải benchmark trung bình/p95, không bảo đảm lần sau
  nhanh hơn: mỗi phiên bản chỉ chạy một lần, provider/model/caching biến động.
- Có lượt Moving tham chiếu **tăng 6,3% token**, dù nhanh hơn lần đo này. Không
  khẳng định mọi câu vừa rẻ vừa tốt hơn.
- Bản sửa input 80.402, output 2.853; gốc input 119.949, output 1.843.
  Output sửa tăng khoảng 54,8%, chủ yếu để giải thích hạn chế/phục hồi. Đây là
  đánh đổi: rõ hơn nhưng dài hơn, không nên mặc định kể mọi đánh giá cho user.
- Sửa 9 provider calls, gốc 12 được usage meter ghi. Riêng GET map picker
  ngoài graph không nằm trong provider count này. Calls lỗi có thể không được
  usage counter của domain cộng đủ; count không thay raw network billing log.
- Tổng **đợt này**: 40 LLM calls, **200.351 input + 4.696 output = 205.047
  token**, đã gồm baseline và tất cả POST, không đếm lại replay. Không phải
  205k cho một người dùng hỏi một câu, cũng không phải USD/credit vì chưa đối
  chiếu giá/cache thực của gateway. Độc lập với 486.913 token đợt trước.

Runtime thật, gitignored:

- `data/followups-current-20261003`, thread `th_bc2d96a57e034337b6594530d6e7ed75`.
- `data/followups-original-20261003`, thread `th_854a60e14aea459ebbb929247f6318dd`.
- Log `data/followups-{current,original}-20261003{,-resume}.log`.

## Hơn / thua và mức chấp nhận

| Khía cạnh | MVP gốc | Bản sửa / đánh đổi |
| --- | --- | --- |
| Agent | Có LLM Intake, Planner, domain; domain tool đầu cố định | Giao mission + constraints, domain chọn tool có grounding, assessment/replan; tool surface lớn hơn nên có thêm cách chọn sai |
| Multiturn | Đã có selected refs và đổi lịch | Vẫn giữ được; không nhận công xây mới toàn bộ memory; thêm binding typed choice/pin rõ ràng |
| Housing ↔ Map | Khám phá nearby bị ánh xạ sang housing filter | Phân biệt “lọc nhà gần tiện ích” và “xem tiện ích quanh căn”; đã có bằng chứng ca mới |
| Context | Planner nhận cả schema đầu ra và data/UI đầy đủ | Bỏ output schema khỏi prompt, bỏ map geometry/trace/image khỏi model view, vẫn giữ facts/IDs/nguồn ở backend và model decision view |
| Recovery | Có vòng tool nhưng nhánh hỏi có thể chung chung | Hỏi đúng ngày khi refusal; chưa bảo đảm mọi loại provider error đều được hỏi đúng |
| Độ phức tạp | Ít tool/policy và dễ theo dõi hơn | Nhiều code cho tool session, cache, paging, grounding và assessment; tăng gánh review/regression |
| Trải nghiệm | Phản hồi ngắn, nhưng đôi khi coi kết quả thiếu là đủ | Thận trọng, giải thích tốt hơn; dễ dài/dùng PARTIAL quá nhiều nếu goal hiểu quá chặt |

Khuyến nghị giữ thay đổi có bằng chứng về liên kết Map, grounding/pin và context.
Giữ Planner LLM + domain LLM cho hiểu mục tiêu/quyết định; các search resolve/batch
cơ học vẫn là composite tool, không chia nhỏ chỉ để tăng số call. Không bỏ các
guard/schema/approval để tăng “tự chủ”.

MVP tư vấn nhiều dịch vụ có thể chấp nhận khoảng 10–23 giây của mẫu này, **nhưng
không coi là đủ tốt cho mọi câu chat đơn giản**. Cần tiếp tục đo p50/p95, đặt
ngưỡng token/turn và quality/latency theo nhóm tác vụ với nhóm; không bật tự động
nới ngân sách/địa điểm/ngày để tăng tỷ lệ ANSWER. Cũng không cần thêm một LLM
classifier để đoán “khi nào gọi LLM”.

## Verification và phạm vi bàn giao

- Replay checkpoint thực: sửa 4 passed; gốc 2 passed, 2 failed đúng khác biệt.
- Ruff hai test files: PASS. `git diff --check`: PASS (chỉ cảnh báo LF/CRLF).
- Không đổi `.env`, model, UI, code sản phẩm; chỉ bổ sung harness/evidence trong
  đợt này. Không push/deploy. Thay đổi sản phẩm từ các đợt trước vẫn ở worktree.
- Không kết luận Flight/Payment, transaction, semantic replan LLM hoặc p95 đã
  cải thiện chỉ từ hội thoại này; đó là phần cần benchmark riêng, không chạy lại
  tất cả ca đã qua khi không có regression liên quan.
