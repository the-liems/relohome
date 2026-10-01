# SIU AI — Frontend React

Ứng dụng React + TypeScript + Vite, triển khai trong chính thư mục `Frontend/`. Gateway FastAPI giữ session và token dịch vụ phía máy chủ. Lệnh `local-integration.py ui` nay chạy frontend này thay cho Streamlit.

## Tiến độ sau rà soát 01/10/2026

Đã đối chiếu **34 tool** và các trang/tương tác: xem [bảng audit từng tool, giới hạn và kết quả kiểm tra](SERVICE_AUDIT.md).

| Phần | Trạng thái |
| --- | --- |
| Nhà, bản đồ, địa điểm, tuyến đường | 9 tool Location đã gọi thật thành công; database nhà hiện có và 9 OSRM endpoint hoạt động |
| Chat, kế hoạch, tài khoản, form và phê duyệt | Có UI desktop/mobile; xử lý yêu cầu bằng ngôn ngữ vẫn cần LLM |
| AhaMove | Có form/pin, báo giá, phí chi tiết, approval và biên nhận/tracking; thiếu credentials/liên hệ báo giá để thử provider thật |
| Tính tiền | Tách tháng/một lần, không cộng trùng khoản đã đặt; có kiểm tra expiry và biên độ khi được cấu hình |
| Thanh toán | Có trạng thái/link/QR workflow và kiểm tra provider; chưa có form ZaloPay demo độc lập/refund |
| Flight | Có tìm/chọn/xem offer; thiếu key SerpApi; không bật xuất vé giả lập |
| Kiểm thử | Build đạt; 16 test UI desktop/mobile và 36 test backend liên quan. Bộ Python rộng còn 17 lỗi fixture/hợp đồng cũ đã liệt kê trong audit |

**Chưa phải tất cả tính năng đều chỉ chờ LLM:** AhaMove, SerpApi, ZaloPay cần cấu hình riêng. Các tool nhiều đơn, callback timeline, rating và refund chưa có flow UI đầy đủ. Không có dữ liệu demo thay thế provider trong app.

## Chạy ứng dụng

Tại gốc repo, dùng môi trường Python và cấu hình backend theo [runbook local](../docs/runbooks/local-mvp.md). Cài Node 22.12+ và build frontend:

```powershell
cd Frontend
npm ci
npm run build
cd ..
.venv/Scripts/python.exe scripts/local-integration.py ui
```

Mở **http://127.0.0.1:8503**, tạo tài khoản rồi đăng nhập. API agent cần chạy ở cổng 8000; Housing/Map/Moving cần các service tương ứng trong runbook. Không phải chạy Streamlit.

Để sửa UI có hot reload, giữ gateway ở 8503 rồi chạy `npm run dev` trong `Frontend/`; mở **http://127.0.0.1:5174**. Vite chuyển `/web/api` tới gateway. Có thể cấu hình `SIU_GATEWAY_URL` nếu đổi cổng gateway.

## Phần đã triển khai

- Ba mục điều hướng: Hệ thống AI, Kế hoạch, Tài khoản; desktop và mobile.
- Chat nhiều hội thoại, lịch sử và lựa chọn lưu trên máy chủ; trạng thái xử lý/lỗi và khôi phục sau tải lại.
- Form tìm nhà/chuyến bay/chuyển đồ/bản đồ; nhà dạng card, so sánh tối đa ba căn, chi tiết, lưu yêu thích.
- MapLibre: nhà, cụm, điểm tiện ích, tuyến đường, mở rộng; khám phá khu vực giữ bộ lọc được API hỗ trợ. Bộ lọc commute hoặc bán kính chỉ dùng map của kết quả, không âm thầm bỏ điều kiện.
- Chọn phương án gửi action có kiểm tra quyền sở hữu, phiên bản và nguồn kết quả; kế hoạch đọc trạng thái graph, chi phí tháng/một lần tách riêng.
- Form phê duyệt và thông tin liên hệ gửi riêng, khóa theo capability/expiry; kiểm tra thanh toán theo trạng thái workflow.
- Đăng ký/đăng nhập session HttpOnly, sở thích được áp dụng khi người dùng chọn, nhà đã lưu theo tài khoản.

Không tạo dữ liệu kết quả giả khi dịch vụ lỗi. Ghép trọ/cẩm nang, xuất vé máy bay và các thao tác chưa có capability chưa được bật. ZaloPay sandbox độc lập vẫn có API backend nhưng chưa có form demo riêng trong UI này. Không có streaming token; frontend hiển thị trạng thái chờ khi API xử lý một lượt.

## Cấu trúc và cấu hình

| Đường dẫn | Vai trò |
| --- | --- |
| `src/` | React, component dịch vụ, CSS, API client |
| `server.py`, `store.py` | Gateway cùng origin; SQLite cho user/session/history/saved |
| `scripts/prepare-map.mjs` | Sao chép MapLibre worker/module đúng phiên bản khi install/dev/build |
| `tests/` | Kiểm thử gateway/graph và Playwright desktop/mobile |
| Các ảnh PNG bên dưới | Ảnh tham chiếu thiết kế được giữ nguyên |

Gateway dùng `AGENT_API_TOKEN` từ môi trường máy chủ; không có biến `VITE_*` chứa token. `LIFEFLOW_API_BASE_URL` mặc định `http://127.0.0.1:8000/api/v1`, `SIU_PLATFORM_API_URL` mặc định `http://127.0.0.1:4100/v1`. Khởi động thêm `scripts/local-integration.py platform` để dùng map khám phá khu vực.

`SIU_WEB_DB` mặc định `data/siu-web.sqlite3`, cần giữ cùng dữ liệu checkpoint của agent để bảo toàn lịch sử. Chạy một worker gateway. `SIU_ALLOW_REGISTRATION=false` tắt đăng ký mới; `SIU_SECURE_COOKIE=true` dùng khi phục vụ qua HTTPS. Đây là đăng nhập local, chưa có xác minh email/khôi phục mật khẩu hay SSO.

## Kiểm tra

```powershell
# Từ Frontend/ — Playwright dùng Chrome đã cài trên máy
npm run build
npm run test:e2e

# Từ gốc repo
.venv/Scripts/python.exe -m pytest Frontend/tests -q
```

Playwright dùng fixture API được khai báo trong test; pytest dùng provider mock và checkpoint graph thật. Các kiểm tra này không chứng minh đã đặt đơn/thanh toán với provider thật. Khi upstream timeout, giao diện yêu cầu kiểm tra trạng thái; giao dịch bất định vẫn cần đối chiếu backend/provider, không tự gửi lại.

## Hướng thiết kế

- Chat là giao diện chính; sidebar gồm **Hệ thống AI – Kế hoạch – Tài khoản**.
- Theo yêu cầu của người dùng, hiển thị card nhà, bản đồ, tiện ích, tuyến đường, hồ sơ ghép trọ, vé, checklist và nút phê duyệt ngay trong hội thoại.
- Người dùng tiếp tục tương tác qua chat hoặc component theo ngữ cảnh.

## Tài liệu để triển khai

- [Kế hoạch tích hợp và yêu cầu backend/frontend](../docs/integration/siu-ai-agent-first-frontend-plan.md).
- [Thiết kế các trang, màn hình và tương tác](../docs/integration/siu-ai-frontend-screen-design.md).
- [Backend Map đã bổ sung và giới hạn hiện tại](../docs/integration/map-backend-update-2026-09-30.md).

Ảnh thể hiện định hướng hình ảnh; trạng thái tính năng và API cần đối chiếu tài liệu trên.

## Bộ ảnh demo

### Demo 1

![Demo 1](ChatGPT%20Image%20Sep%2030,%202026,%2011_48_57%20AM-1.png)

### Demo 2

![Demo 2](ChatGPT%20Image%20Sep%2030,%202026,%2011_52_23%20AM-2.png)

### Demo 3

![Demo 3](ChatGPT%20Image%20Sep%2030,%202026,%2011_52_34%20AM-3.png)

### Demo 4

![Demo 4](ChatGPT%20Image%20Sep%2030,%202026,%2011_52_39%20AM-4.png)

### Demo 5

![Demo 5](ChatGPT%20Image%20Sep%2030,%202026,%2011_52_39%20AM-5.png)
