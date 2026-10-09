# Kiểm chứng 26 persona case và Moving form — 2026-10-05

## Kết luận

Đã chạy thật một vòng toàn bộ **26 case / 42 bước** trong
`docs/review/persona-test-cases.json`: **36 lượt chat + 6 lần chọn phương án**.
Đối chiếu đầy đủ tiêu chí nguồn: **24 PASS, 2 FAIL theo bộ tiêu chí cũ**.
Không biến hai ca này thành PASS bằng cách bỏ assertion.

Bản sửa báo giá của PR #53 đã được đưa vào **demo local chính**
[http://127.0.0.1:8503](http://127.0.0.1:8503); backend/UI đã được khởi động lại.
Điều này **không có nghĩa GitHub main đã merge**.

## Môi trường và giới hạn chứng cứ

- Code đo: checkout local `review/quangdung-post-mvp` tại `62f83b7`,
  cộng phần sửa PR #53 `6c89a60` và các thay đổi local giảm độ trễ đã có.
  Không gọi đây là phép đo độc lập chỉ riêng commit của PR #53.
- PostgreSQL: `lifeflow_quangdung_20261005`; DB cũ vẫn giữ nguyên.
- LLM: trace ghi `gpt-6-luna`; Location/Housing/Map dùng MCP và DB thật,
  Flight dùng SerpApi thật, Moving dùng AhaMove staging thật.
- Runner dùng FastAPI ASGI routes thật → LangGraph → MCP/providers thật,
  không thay thế client, không chèn kết quả giả, không dùng LLM judge.
  26 case này kiểm API và selection API; không phải 26 lần thao tác trên trình duyệt.
- Runtime/checkpoint/memory của bộ persona được tách khỏi hội thoại demo.
  Mỗi case có actor riêng; các lượt trong cùng case giữ cùng thread/actor.
- Writes và sandbox payment creation bị tắt. Không gọi approve, tạo đơn,
  thanh toán hay hủy đơn. P16 dùng mã sai do chính fixture cung cấp để kiểm tra
  không bịa trạng thái thanh toán; đó không phải kết quả provider giả.
- Các ngày đã quá hạn trong **positive fixtures** P08/P12/P15/P22/P24 được
  đổi sang 06/10/2026 và ghi cả đầu vào gốc/lúc chạy. P14 vẫn giữ 25/10/2026.
  Không đổi đồng hồ hệ thống hoặc sửa logic ngày giờ sản phẩm để khớp test.
- Chỉ lấy định nghĩa case/turn/expect từ file teammate. Không dùng các kết quả
  PASS lịch sử trong file làm chứng cứ cho lần chạy này.

## Kết quả từng case

| Case | Nội dung chính | Tiêu chí nguồn |
| --- | --- | --- |
| P01 | Phòng gần Bách khoa Hà Nội, dưới 2 triệu | PASS |
| P02 | Không dấu, Cầu Giấy, có chỗ xe máy | PASS |
| P03 | Gia đình, 2 phòng ngủ, gần trường | PASS |
| P04 | Thiếu khu vực/ngân sách | PASS |
| P05 | Yêu cầu ngoài phạm vi | PASS |
| P06 | Vé Sài Gòn → Hà Nội | PASS |
| P07 | Chuyển đồ thứ bảy, thiếu giờ | PASS |
| P08 | Chuyển đồ đủ ngày giờ, chưa xác nhận pin | PASS: CLARIFY được phép |
| P09 | Nhà Đà Nẵng + vé Hà Nội → Đà Nẵng | PASS; thực thi song song thật |
| P10 | Ba lượt: tìm nhà → giảm giá → gần chợ | PASS |
| P11 | Đổi Thanh Xuân → Hoàng Mai | PASS |
| P12 | Chọn nhà → chuyển tới “căn này” | PASS: giữ ID nhà và phụ thuộc |
| P13 | Chọn nhà → “từ căn đó” tính đường xe máy | PASS |
| P14 | Chuyển ngày xa, kỳ vọng hỏi move_date | FAIL: cần pin trước; xem bổ sung bên dưới |
| P15 | “Đặt xe rẻ nhất luôn” chưa đủ xác nhận | PASS: không đặt đơn |
| P16 | Tra mã thanh toán không thuộc actor | PASS: lỗi/quyền, không bịa PAID |
| P17 | AhaMove có phục vụ Cần Thơ không | PASS; nguồn catalog thật |
| P18 | Hiệu thuốc gần Hồ Gươm | FAIL theo tiêu chí cũ: Map nay có hỗ trợ |
| P19 | Viết tắt q3/hcm | PASS: CLARIFY được phép |
| P20 | Tiếng Anh + tiếng Việt, studio | PASS |
| P21 | Chuyển công tác: nhà + vé | PASS tiêu chí cũ, có cảnh báo chất lượng |
| P22 | Chọn nhà Đà Nẵng → bay “vào đó” | PASS |
| P23 | Bỏ tìm nhà, chỉ tìm vé | PASS; progress chỉ Flight |
| P24 | Chọn nhà và vé, tổng hai nhóm chi phí | PASS |
| P25 | Tính đường đi bộ | PASS |
| P26 | Chọn nhà → đổi 2 phòng ngủ, gần bệnh viện | PASS |

### Hai ca không đạt và một cảnh báo thực sự cần theo dõi

**P14:** chat hỏi xác nhận hai pin trước, chưa đến bước AhaMove kiểm lịch.
Không hardcode “tối đa 7 ngày” vì hạn nhận lịch phải do provider xác nhận.

Đã làm thêm một **kiểm tra thật không LLM**: operator xác nhận hai pin mà
Location thực sự trả về, chọn gói TRUCK thực sự có trong catalog, gửi form ngày
25/10/2026. AhaMove từ chối với **INVALID_FUTURE_ORDER_TIME**, response
CLARIFY, không quote giả/đơn/giao dịch; mất **1,552 giây**, **0 LLM**.
Pickup trong kiểm tra bổ sung là pin trạm xe buýt mang tên Văn Miếu từ dữ liệu,
không tuyên bố đó là cổng Văn Miếu. Kiểm tra này xác nhận xử lý từ chối của
provider, không chứng minh tự phân giải đúng cổng địa danh.

Trường câu hỏi form hiện là `moving_request` thay vì `move_date`, và thông báo
có tiền tố “AhaMove từ chối báo giá” lặp. Đây là điểm UX/error-field nên cải thiện,
không được ghi rằng assertion move_date đã qua.

**P18:** tiêu chí cũ bắt buộc không có Map vì trước đây chưa hỗ trợ hiệu thuốc.
Hiện Map nhận nhiệm vụ nearby pharmacy và hỏi người dùng chọn “Hồ Gươm” do tên
mơ hồ. Cần owner cập nhật tiêu chí cho capability mới; không xóa tính năng Map
chỉ để kéo bộ test về 26/26.

**P21:** câu “chuyển công tác” bị Intake hiểu thêm nhu cầu chuyển đồ, nên hỏi
`relocation.move_time` dù người dùng chỉ yêu cầu tìm nhà và vé.
Kết quả Housing/Flight vẫn được trả về, nên case cũ cho phép CLARIFY và vẫn PASS.
Nên tạo follow-up cho Intake: không suy diễn thêm nhu cầu dịch vụ chưa được yêu
cầu; kiểm lại trên ca chuyển công tác khác sau khi sửa, không vá bằng keyword
riêng của P21.

**Giới hạn PASS:** P08/P12/P15 dừng ở xác nhận pin, không chứng minh đã tạo quote.
P19 hỏi lại khi địa danh viết tắt chưa rõ, không phải trả ngay danh sách nhà.

## Độ trễ, token và tính song song

| Chỉ số | Kết quả đo |
| --- | --- |
| Lượt gọi LLM toàn bộ | 110 |
| Input token | 390.966 |
| Output token | 11.027 |
| Tổng token | **401.993** |
| Chat: trung vị | **8,968 giây/lượt** |
| Chat: nhỏ nhất / lớn nhất | 2,274 / 15,017 giây |
| 6 selection API | 11–32 ms |
| LLM do 6 selection phát sinh | **0** |

Token lấy từ usage ledger thật; không quy đổi sang tiền khi chưa có bảng giá
của tài khoản/provider. Các service token/call đã được cộng với Intake/Planner.

P09: Housing và Flight bắt đầu cùng `2026-10-05T15:28:24.371231+00:00`;
Housing kết thúc 28.364014, Flight kết thúc 28.600646. Hai khoảng thời gian
**chồng nhau**, không chỉ là hai ô “song song” trên UI.

P12/P13 giữ lựa chọn Housing; P12 có quan hệ sau Housing trong progress.
P10/P11/P22/P23/P26 giữ/sửa ngữ cảnh theo các lượt; P24 chốt lựa chọn có tổng
monthly và one-time > 0. Chốt lựa chọn không đồng nghĩa đã đặt/đã trả tiền.

## Kiểm tra Chrome trên demo chính

Hai ca `Frontend/tests/browser/moving-form.live.spec.ts` đều PASS, không
interception/mock, dùng Location và AhaMove staging thật:

- Fresh thread → chọn pin/gói TRUCK → quote: **2,525 giây** đến render báo giá.
- Ngày giờ bị backend 422 → sửa rồi quote: **1,491 giây**.
- Không mất/remount form trước khi có báo giá, không bật về chat, pin/thời gian/
  service vẫn giữ khi bị từ chối. Không gọi LLM/đặt đơn/thanh toán.

Đây là số đo trên máy local và hai tuyến được test, không bảo đảm mọi lần bấm
đạt cùng thời gian.

## Kiểm tra local và CI/merge

- `ruff check src/ tests/`: PASS.
- Compile Python các module thay đổi: PASS.
- Frontend `tsc -b && vite build`: PASS.
- Contract/policy + SQLite thật: **12 passed, 1 skipped**; không dùng fixture
  mock LLM/provider. Runtime LLM opt-in bị skip, không tính là đã kiểm.
- Moving live suite mặc định: **6 skipped**; không dùng số skip làm PASS.
  Chứng cứ live lần này là 26 persona, kiểm P14 bổ sung và 2 Chrome ở trên.
- Đã đổi ID phần bổ sung Moving thành **SPEC-004/AC-33–38**, không ghi đè
  AC-26–32 mà main đã có. ADR-022 vẫn Proposed, cần review của nhóm.

Tình trạng GitHub kiểm lúc chạy:

1. [PR #42](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/42)
   QuangDung → main vẫn open.
2. [PR #53](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/53)
   của Moving đang stacked trên QuangDung, chưa merge. CI của repo lọc PR vào
   main, nên không có check chạy cho head #53 hiện tại. “Không có check” không
   phải “CI xanh”.
3. [CI main](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/37306202473)
   tại commit 6ad3e74: lint-and-test thất bại ở Run tests; mcp-images và
   lifeflow-typescript thành công. Không gán lỗi có sẵn này cho PR #53.

Quy trình tiếp: push cập nhật riêng PR #53 → teammate review → #42 merge theo
quy trình của nhóm → cập nhật nhánh/đổi base #53 sang main và kiểm lại diff →
CI bắt buộc xanh trên đúng head/merge base → reviewer duyệt → maintainer merge.
Không tự merge #42/#53, không deploy và không push lẫn thay đổi local ngoài
phạm vi vào PR Moving.

Cảnh báo P21 và việc cập nhật tiêu chí P18 nên theo issue/PR riêng với owner
Intake/Map; không giấu trong PR tối ưu báo giá.

## Chứng cứ riêng tư và cách đối chiếu

- Raw run: `data/persona-live-20261005-222717/report.json`.
- P14 bổ sung: `data/persona-live-20261005-222717/p14-confirmed.json`.
- Usage/checkpoint: thư mục runtime cùng run, không commit.
- Runner tạm trong `data/`, không đưa fixture hoặc credential vào GitHub.
- Runner ban đầu đọc sai một số dạng assertion (string/list, progress_after,
  tên field qualified). Đã sửa checker rồi **đối chiếu lại các response đã lưu
  offline**, không gọi lại LLM/provider. Trạng thái/lỗi checker ban đầu được giữ
  trong raw report để audit; lỗi checker không bị gán thành lỗi sản phẩm.

Theo [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices):
đánh giá theo nhiệm vụ và trace thực tế, tách giới hạn kiểm thử khỏi chất lượng
sản phẩm; không coi label PASS lịch sử hoặc chỉ một response kind là đủ.
