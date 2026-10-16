# Local: tìm nhà lỗi do giới hạn SSE của MCP SDK

Ngày: 16/10/2026. Baseline: `main` tại `49ab46a`. Bản sửa đang ở working tree local, chưa commit/push.

## Triệu chứng và nguyên nhân

- UI form tìm nhà Gò Vấp dưới 7 triệu trả lỗi chung dù cả 8 service health 200.
- Checkpoint hội thoại báo Housing `provider_unavailable`, `location unreachable: ExceptionGroup`.
- Chạy đúng adapter Housing, không qua LLM, lộ exception gốc: `SSE stream failed: Server-sent event exceeded the 1048576 byte limit.`
- Luồng `_property` gọi `search_areas` với `include_geometry=True`. MCP SDK Python 2.3 mặc định giới hạn mỗi SSE event 1 MiB. Health/list-tools không tải geometry nên không phát hiện lỗi.
- Đo payload kết quả có geometry: TP.HCM khoảng 2.41 MB; Đà Nẵng khoảng 1.34 MB; Hà Nội khoảng 0.69 MB. Đây là kích thước JSON kết quả đo được, không phải tổng lưu lượng của toàn lượt chat.

Local đã đồng bộ dependencies lên requirements của main trong lần khởi động. Chưa kiểm tra image/version dependency/runtime của staging, nên chưa xác nhận chính xác staging khác phiên bản, transport hoặc dữ liệu nào. Việc staging chạy được không phủ định lỗi đã tái hiện trên local.

## Bản sửa

- `McpEndpoint` có giới hạn `max_sse_event_size` hữu hạn; mặc định 1 MiB.
- Registry Location đặt 16 MiB để đọc ranh giới hành chính từ service tin cậy.
- Client truyền giới hạn vào `streamable_http_client` của SDK 2.3.
- Moving/Flight/Payment giữ giới hạn 1 MiB. Không tắt giới hạn bằng `None`.
- Không đổi bộ lọc/ranh giới/thứ tự tìm nhà, API công khai, database hoặc CI.
- Đã restart đúng Agent API cổng 8000; các service khác giữ hoạt động.

## Kiểm chứng

1. Thêm test với MCP server HTTP thật trả SSE lớn hơn 1 MiB: thất bại trước bản sửa với đúng lỗi người dùng.
2. Sau bản sửa, Location đọc được payload; endpoint thông thường vẫn từ chối payload vượt 1 MiB. Test không cần provider/LLM thật.
3. Nhóm transport/auth/service-subagent/crash-usage: **41 passed**. Ruff lint/format và `git diff --check` đạt.
4. MCP handshake/list-tools local thành công: Location 9 tool, Moving 9, Flight 4, Payment 4. Đây không phải kiểm chứng giao dịch thật.
5. Chạy form thật bằng Chrome: TP.HCM → Gò Vấp → dưới 7 triệu. Housing agent trả kết quả; map tải xong **292 lựa chọn**, 10 card trong lượt hiển thị, 1 canvas MapLibre, không API error được ghi nhận trong lượt đó. Artifact: `.tmp/housing-sse-fixed-loaded.png`.

Một lượt probe browser trước đó chờ sai CSS selector nên timeout; probe cuối dùng `.ws-card` và xác nhận dữ liệu đã tải. Không dùng việc chỉ mount khung loading để kết luận map hoạt động.

## Hướng tiếp theo

16 MiB là giới hạn transport hữu hạn để khôi phục tương thích với dữ liệu hiện tại. Nếu dữ liệu ranh giới tăng thêm, cần đo lại và xem xét giảm payload/độ chi tiết cho hiển thị map với kiểm chứng riêng; không âm thầm đơn giản hóa geometry đang dùng lọc không gian.

Trước khi đưa bản sửa lên staging, đối chiếu đúng image SHA, MCP SDK và bộ dữ liệu đang chạy ở đó. Chưa deploy hoặc thay cấu hình staging trong đợt này.
