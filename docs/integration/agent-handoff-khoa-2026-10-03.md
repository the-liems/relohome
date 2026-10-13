# Bàn giao agent và tối ưu ngữ cảnh — nhánh khoa, 03/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


> Bản này ghi nhận nền `khoa` tại `b7cd0c7`, trước các thay đổi POI/map/Moving
> ngày 04/10. Danh sách file và hướng dẫn nhận code + dữ liệu trên `QuangDung`:
> [bàn giao cập nhật](quangdung-changes-and-data-handoff-2026-10-04.md).
> Các câu “không sửa UI” bên dưới chỉ mô tả đợt agent 03/10.

## Đọc nhanh

Bản này giữ giao diện MVP của teammate, cải tiến backend trên cùng LangGraph:
Planner vẫn dùng LLM giao nhiệm vụ; domain agent dùng LLM chọn tool, đánh giá
kết quả và báo thiếu thông tin. Không thay Planner bằng keyword/rule router.
Code vẫn kiểm schema, phụ thuộc, nguồn, quyền, budget và xác nhận giao dịch.

Hướng mới có bằng chứng phối hợp Housing–Map tốt hơn và context gọn hơn.
Không tuyên bố mọi ca tốt hơn/rẻ hơn, không gọi ca provider từ chối là báo giá
thành công. Chưa deploy; nhánh nhận bàn giao là **`khoa`**.

## Nền code và phạm vi Git

- Nền: `mvp` tại `b18fb4b944e2a9cacc34a3e73cd8ade7b055fdf9`.
- Đã fetch kiểm tra `origin/mvp` và `origin/khoa` trước bàn giao.
- `origin/khoa` tại `194f51d` là tổ tiên của nền trên. Đưa vào `khoa` cả 4 commit
  MVP tiếp theo của teammate (`4348df6`, `a4bc464`, `4309dd5`, `b18fb4b`) và
  commit cải tiến này; không ghi đè lịch sử, không force-push.
- Không sửa source UI, `.env`, deployment hoặc đưa dữ liệu runtime vào Git.
- File riêng `docs/architecture/mvp-architecture.md` giữ nguyên trên máy,
  không đưa vào commit bàn giao.

## Luồng và trách nhiệm

```text
Người dùng / lựa chọn map đã được API xác minh
  → Intake LLM: ý định, tham chiếu, thay đổi nhiều lượt
  → Planner LLM: domain mission + hard inputs + dependencies
  → LangGraph scheduler: chạy task sẵn sàng, song song nếu độc lập
  → Domain LLM: chọn tool → đọc dữ kiện → bước tiếp / hỏi / assessment
  → Validator: kiểm contract, freshness, nguồn và feedback
  → Planner replan khi cần, hoặc phản hồi / luồng approval riêng
```

Scheduler/Executor không cần LLM để kiểm một dependency đã DONE. Điều đó không
có nghĩa nó chọn thay tool cho domain agent hay hardcode câu người dùng.
Không thêm một graph hoặc một agent Executor mới.

## Thay đổi đã giao

1. Contract 1.1 thêm `goal`, `user_request`; task truyền mục tiêu và ngữ cảnh
   xuống domain. Có mặc định cho client cùng major; JSON Schema đồng bộ.
2. Housing/Flight/Map/Payment bỏ việc bắt LLM gọi một `primary_tool()` cố định
   ở bước đầu. Có prompt chuyên môn và tool namespace riêng; model chọn trong
   những thao tác có prerequisite/ID/field hợp lệ.
3. Housing có resolve địa danh/địa giới, search, details, paging và assessment.
   Search composite tự chuẩn bị vị trí và batch tối đa 3 trang khi cần; không
   nới hard filters. `limit` từ yêu cầu người dùng được truyền qua Intake/Planner.
4. Phân biệt lọc Housing gần tiện ích (`nearby_*`) với khám phá Map
   (`map_categories`, `map_radius_m`, `map_near`). Map quanh căn đã chọn không
   tự chạy lại Housing hoặc dùng nhầm địa danh tìm nhà làm tâm.
5. Lựa chọn địa điểm bind canonical name + place ID cùng nhau. Pin Moving đã
   xác nhận được đưa vào Intake/Planner; giữ lịch, không hỏi lại tọa độ đã có.
   Không tự nâng tọa độ approximate thành điểm dừng xe chính xác.
6. Planner bỏ output schema khỏi prompt nhưng giữ input schemas/capabilities.
   Context LLM bỏ geometry, ảnh, UI data và trace không dùng cho quyết định;
   dữ kiện/nguồn/IDs/giá/expiry vẫn giữ. Dữ liệu đầy đủ còn ở backend cho UI.
7. Domain tool history dùng JSON gọn, chỉ thay snapshot search cũ đã bị snapshot
   mới supersede. Cache riêng invocation, không mutate client chung khi song song.
8. Assessment có nhãn model, không phải provider fact. Map optional từ lượt cũ
   không kéo câu trả lời Moving mới sang PARTIAL; request_replan bị giới hạn,
   không tạo vòng lặp tìm lại cùng điều kiện.
9. Moving giữ vòng tool thật; Payment kiểm ownership trước model/provider;
   không thêm giả lập đặt vé/thanh toán, không bỏ approval cho giao dịch.

Code trọng tâm: `src/agents/llm_context.py`,
`src/agents/subagents/services/domain_tools.py`, `read_llm.py`, `planner_llm.py`,
`intake_llm.py`, các node Intake/Validator/Respond và contract subagent.

Quyết định: [ADR-021](../adr/ADR-021-mission-driven-domain-tools.md).
Yêu cầu: [SPEC-014/AC-24–33](../specs/SPEC-014-domain-llm-agents.md).

## Bằng chứng và đánh đổi

Chi tiết, giữ cả các lần lỗi và giới hạn phương pháp:

- [Domain missions và tích hợp thật](domain-missions-2026-10-03.md).
- [Đánh giá vòng domain trước tối ưu](../../eval/domain-mission-quality-2026-10-03.md).
- [3 ca mới, tối ưu so với snapshot trung gian](../../eval/agent-context-efficiency-2026-10-03.md).
- [4 câu mới: so với toàn bộ MVP gốc](../../eval/original-mvp-followups-2026-10-03.md).

So sánh cuối chạy 4 câu trên mỗi phiên bản, cùng provider/model/config,
không mock hoặc giao dịch. Sửa có 4 kiểm tập trung PASS; gốc 2 PASS, 2 FAIL
(Map tự tìm lại Housing và hỏi chung chung sau refusal). Đây không phải
4 yêu cầu dịch vụ đều hoàn tất: Housing có giới hạn loại hình, Moving cần pin,
và staging từ chối lịch 12/10 nên chưa trả báo giá ở ca cuối.

Trong mẫu đó: tổng token **121.792 → 83.255**, tổng thời gian
**71,172 → 61,746 giây**. Một lượt vẫn tăng khoảng 6% token; bản sửa còn
11–23 giây/lượt. Không suy ra p95 hoặc phần trăm giảm chi phí tiền từ mẫu này.

Flight/Map thực thi độc lập đã có trace chồng thời gian trong đợt trước;
Payment ownership đã kiểm với provider thật/sandbox. Không chạy lại tất cả
chúng trong đợt so sánh cuối chỉ để tạo thêm bảng đẹp.

## Nhận code và chạy

Commit/push Git không chứa key, database, ZIP dữ liệu, checkpoint, log hoặc pii.key.
Teammate cần cấu hình `.env` và data riêng theo
[runbook MVP local](../runbooks/local-mvp.md); không copy credential qua chat/Git.
API đang chạy cần khởi động lại để nạp code mới. Giao diện không cần đổi contract
UI cho các thao tác lựa chọn hiện có.

Kiểm tra không trả phí:

```powershell
.venv/Scripts/python.exe -m ruff check src/agents tests/test_llm_agents/test_*live.py
.venv/Scripts/python.exe -m compileall -q src/agents
.venv/Scripts/python.exe -m pytest tests/test_llm_agents/test_original_mvp_followups_live.py -q
```

Lệnh pytest cuối mặc định **SKIP** live/replay vì chưa opt-in, không phải PASS.
Fixture live có guard trực tiếp dù được import vào module test khác: CI không
được gọi LLM/provider trả phí chỉ do collect test. Không chạy cả suite live nếu
chưa đồng ý ngân sách; các ca benchmark có lịch cố định không phải daily smoke test.

Replay không gọi model trên máy đang có checkpoint thật của đợt này:

```powershell
$env:RUN_FOLLOWUP_REPLAY='1'
$env:RUN_EFFICIENCY_RUNTIME=Join-Path (Get-Location) 'data/followups-current-20261003'
$env:RUN_EFFICIENCY_HOUSING_THREAD='th_bc2d96a57e034337b6594530d6e7ed75'
.venv/Scripts/python.exe -m pytest tests/test_llm_agents/test_original_mvp_followups_live.py -k recorded -q
Remove-Item Env:RUN_FOLLOWUP_REPLAY
Remove-Item Env:RUN_EFFICIENCY_RUNTIME
Remove-Item Env:RUN_EFFICIENCY_HOUSING_THREAD
```

Checkpoint không được bàn giao qua public Git. Máy khác thiếu checkpoint phải
chạy ca live mới có kiểm soát hoặc dùng hội thoại thực của máy đó, không tạo dữ
liệu giả để làm test xanh. Không đổi model/config sản phẩm chỉ để benchmark.

## Việc còn lại cần review

- Đo quality/latency/token theo nhiều mẫu, p50/p95 và ngân sách mỗi lượt.
  Không tuyên bố “agent hơn” tự động tốt hơn/rẻ hơn.
- Lưu rejection code/message đã scrub vào result để kiểm chứng lời giải thích
  provider; hiện một số refusal chỉ giữ câu hỏi và trace.
- Semantic replan qua Planner LLM chưa được phủ đầy đủ end-to-end; đã có
  kiểm policy/feedback bằng dữ liệu thật nhưng không thay cho mọi ca replan.
- Không suy diễn fare rules/hành lý hoặc xuất vé: Flight search thật không
  đồng nghĩa đã có provider booking/ticketing thật.
- Không retest booking/cancel/payment trong đợt này. Không xem các PASS read-only
  là xác nhận giao dịch production hay độ bền sau deploy.
- Housing/POI còn phụ thuộc coverage, loại hình và chất lượng tọa độ nguồn.
  Không thêm giới hạn cứng “chỉ trong một thành phố” hoặc tự nới hard filters.
- Giảm độ dài phản hồi/đánh giá quá thận trọng khi cần; vẫn giữ nguồn và giới
  hạn quan trọng. UI teammate giữ nguyên; browser interaction không được đánh
  đồng với kiểm API lựa chọn.

Đợt bàn giao chỉ commit/push và kiểm không LLM; không deploy, không chạy lại
paid benchmark. Các báo cáo cũ ghi “chưa push” là trạng thái tại thời điểm đo,
không phải chỉ dẫn cần chạy lại hoặc trạng thái release.
