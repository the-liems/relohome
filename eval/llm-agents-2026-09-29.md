# Live verification: LLM agent components — 2026-09-29

Phạm vi: component trên `khoa`, base integration `d5c438e`, chưa chạy graph end-to-end.
Không mock model/provider, không seed listing hoặc quote giả. Các câu user trong tests là
input thử; response LLM, MCP, AhaMove và persistence đều chạy thật.

## Kết quả đã quan sát

| Kiểm tra | Kết quả |
|---|---|
| Intake + LLM Planner | 9 passed, lần kiểm lại 43.29 s, `gpt-4.1-mini` |
| HTTP/MCP Moving + AhaMove staging + PostgreSQL thật | 9 passed, lần hoàn tất 3.02 s |
| Moving LLM qua HTTP MCP thật | 4 passed, 19.81 s, `gpt-4.1-mini` |
| TypeScript Moving build | `npm run build:moving` passed |
| CLI Intake qua stdin | Gọi OpenAI thật thành công; trích Quận 10 và 5.000.000 VND có evidence |
| Kiểm tra tĩnh Python | Ruff check/format, compileall và git diff --check passed |

Intake/Planner: housing, flight, quote, hỏi thiếu, ngoài phạm vi, ý định đặt (plan-only),
đổi ý, usage đồng thời, phủ định đặt, multi-domain thiếu một phần, prompt injection quyền ghi.
Moving: danh mục/vùng phục vụ, contract version sai, ngân sách bằng 0, quote thật.
Test MCP hiện có còn kiểm auth/host/origin, read/write scope, approval bất biến, readiness/audit.

Các lần thử trước đã phát hiện:

1. `gpt-4o-mini` trả evidence sai ký tự hoặc bỏ ý định trên một số ca. Sửa schema/prompt,
   thêm validation/repair và dùng mặc định `gpt-4.1-mini` cho component mới. Không nới
   assertions để chấp nhận output sai. Đây là bộ thử nhỏ, không chứng minh mọi prompt đều đúng.
2. Mapper estimate cũ đọc giá phẳng, trong khi response staging thật là
   `[{service_id, data: {total_price, distance, ...}, error: null}]`.
   Đã sửa parser tương thích nested/flat, giữ nguyên ID thật, không dùng `unknown` làm ID,
   không lưu quote thành công nếu một option báo lỗi hoặc thiếu giá/ID.
3. Một lần staging timeout ở list cities gây hai assertions HTTP test thất bại;
   lần chạy lại qua. Không có thay provider bằng mock hoặc bỏ assertion.

## Tuyến được phép thử

Chủ task cho phép tự cấu hình contact/tuyến cho báo giá staging, không đặt đơn.
Dùng liên hệ partner có sẵn trong `.env`; không commit hoặc ghi số liên hệ vào báo cáo.

- Chợ Bến Thành: `(10.7725301, 106.6980365)`,
  [OpenStreetMap way 39514795](https://www.openstreetmap.org/way/39514795).
- Bưu điện Trung tâm Sài Gòn: `(10.7799557, 106.6999921)`,
  [OpenStreetMap way 39514793](https://www.openstreetmap.org/way/39514793).

Tọa độ được lấy qua Nominatim thật, không do LLM đoán. © OpenStreetMap contributors, ODbL.
Đây là vị trí landmark dùng kiểm API, **không xác nhận cổng xe tải vào được hoặc địa chỉ
đón hàng vận hành thực tế**. Muốn đặt thật phải xác nhận điểm lấy/giao tiếp cận được.

Trong lần chẩn đoán response trực tiếp, provider trả quãng đường 1.38 km và các giá
119.000 / 121.000 / 138.000 VND cho ba dịch vụ đã truy vấn. Đây là snapshot staging,
không phải bảng giá cố định hay báo giá còn hiệu lực cho người dùng.

## Chưa được chứng minh bởi bộ thử này

- Graph UI/chat, resume, node budgets, approval/transaction end-to-end.
- Tạo/sửa/hủy đơn thật hoặc phí hủy thực tế: không thực hiện thao tác đó.
- Geocode tự do qua Location/Housing và chọn option trong hội thoại nhiều lượt end-to-end.
- Mọi tuyến liên tỉnh, mọi catalog/service hay yêu cầu bốc xếp.
- Docker image/runtime mới, deploy staging nhiều replica, durability sau restart.
- Load test, tỷ lệ đúng toàn bộ tập tiếng Việt, adversarial evaluation đầy đủ.

Chạy lại theo [handoff](../docs/integration/llm-agents-handoff.md). Live tests có chi phí,
phụ thuộc provider; thiếu key/route thì opt-in/skip minh bạch, không fallback dữ liệu giả.
