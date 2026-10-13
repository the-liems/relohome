# Kiểm tra hệ thống sau thay đổi frontend — 07/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## Hệ thống đang chạy

Mở **http://127.0.0.1:8503** để kiểm tra. Chạy bằng launcher hiện có, không
thêm `--sandbox-writes`, không init/import/restore/migrate data.

| Thành phần | Cổng / kiểm tra | Kết quả |
| --- | --- | --- |
| Gateway + bản build React | 8503 `/ai` | 200, asset mới |
| Agent API | 8000 `/health`, gateway `/status` | 200, 5 domain |
| Platform API | 4100 `/health` | 200 |
| Location MCP | 4300 `/readyz` | 200, DB kết nối |
| Moving API | 4200 `/ready` | 200 |
| Moving MCP | 4400 `/ready` | 200, staging |
| PostGIS | Container hiện có, 5433 | Healthy |
| OSRM | 9 container: 3 phương tiện × 3 thành phố | 9/9 route 200/Ok |

Các route ô tô/đi bộ/xe máy tại HCM, Hà Nội, Đà Nẵng có hình học **41–151
điểm**, không phải đoạn thẳng hai điểm. Các container ngoài dự án không bật.

## Rà từng nhóm chức năng

| Nhóm | Kiểm tra thực tế | Hồi quy frontend |
| --- | --- | --- |
| Đăng ký/đăng nhập/đăng xuất | Tài khoản QA riêng, cookie/session/gateway hoạt động | Qua |
| Chat và nháp | Composer, đổi theme/locale giữ nháp; không gửi model request | Gửi/nhận, lỗi, reload và giữ nháp qua fixture |
| Housing | Form mở; API tìm thật trả 3 tin; GET chi tiết cùng listing ID trả 200 | Lọc, chi tiết, chọn, lưu, so sánh, chọn nhà → B qua |
| Map/tiện ích | Địa điểm thật trả 200, 3.229 POI trong bbox thử; basemap thật tải, đổi tối giữ pin | Camera/phân nhóm/lọc/chọn/thu chat qua |
| Moving | Tìm/chọn A/B bằng Location thật; catalog 29 gói ở HCM, select có thêm lựa chọn SIU; UI giữ pin qua đổi theme/locale | Typed payload quote PR #53, addon/kiện/COD, lỗi/giá hết hạn/phê duyệt qua |
| Flight | Form thực tế mở đúng | Validation, lọc/sắp xếp, chi tiết, giá hết hạn và chọn qua fixture |
| Kế hoạch | Mở/đóng panel thực tế | Tiến trình/chi phí/cần phản hồi, đúng hội thoại qua |
| Tài khoản/lịch sử | Profile, bảo mật, lịch sử và quay về chat hoạt động | Lưu profile/preferences, saved, lọc/mở lại, xóa/reset qua fixture |
| Thanh toán/phê duyệt | Giữ write flags tắt | Ownership, QR, chờ/hết hạn, chặn gửi lặp, PII riêng qua fixture/contract |
| Sáng/tối, VI/EN, mobile | Kiểm tra build thật, không tràn ngang, không lỗi JavaScript trong lượt QA | 8 ca appearance và các luồng hiện có qua |

**96/96 browser qua** trên desktop/mobile; suite có 100 ca với **4 live
opt-in skip**. **8/8 Python frontend/gateway contract qua**. Build qua.
Browser trên build thật: **13/13 bước kiểm tra qua**, không pageerror.
Không suy rộng fixture thành bằng chứng tìm Flight, suy luận LLM, báo giá,
đặt/hủy đơn hoặc thanh toán thật: các tác vụ đó chưa được chạy thêm ở lượt này.

## Chỉnh sửa giới hạn ở hiển thị

- Tiêu đề/tooltip một số form chưa đổi sang EN: chỉ bổ sung nhãn/từ điển,
  giữ form values, điều kiện kiểm tra và request body. Kiểm tra lỗi giá
  min/max bằng EN vẫn chặn gửi request theo logic cũ.
- Map có thể còn màu sáng khi tiles/glyphs chưa tải xong: áp theme từ
  `style.load`, giữ `load` xử lý dữ liệu hiện có. Chỉ repaint; giữ instance,
  camera, nguồn data, pin và OSRM. Đã xem basemap thật ở dark mode.
- Lượt automation đầu dùng sai tên dialog, đợi option native ở trạng thái
  visible thay vì attached và gửi max_price sai MoneySchema. Đã sửa helper
  kiểm tra; không sửa product API/logic để hợp thức hóa request thử.

## Vấn đề dữ liệu/tìm kiếm còn thấy

Location trả gợi ý gần đúng cho **“Bưu điện Trung tâm Sài Gòn”**: trong kết
quả đầu có **“Trung tâm mua sắm Sài Gòn Garden”**, không phải bưu điện yêu
cầu. Tên Chợ Bến Thành cũng có các loại POI/thành phố khác nhau. UI hiển
thị tên/loại/khu vực để người dùng chọn; không coi mọi gợi ý là khớp chính
xác. Đây là response từ Location đang có, không phải do theme hay bản dịch.
Đã ghi nhận và **không sửa logic tìm kiếm hoặc data** ở lượt này.

## Xác nhận phạm vi

- Git diff `src/`, `Maps VN/`, `Frontend/server.py` trống.
- Hash `.env`, `data/integration.env`, housing JSONL bằng trước khi khởi động.
- Không đổi graph, tool/service, schema, write flags hay luồng xác nhận.
- Chỉ tài khoản QA local riêng được dùng khi kiểm tra trực tiếp; không
  sửa profile, gửi chat hoặc xóa lịch sử tài khoản người dùng.
- Bằng chứng local ở `logs/local/product-runtime-20261007/`: `health.json`,
  `osrm.json`, `read-services.json`, `live-ui.json`, ảnh và log startup.
  Không gửi credential/cookie vào README hoặc Git.
