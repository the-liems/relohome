# Kiểm tra dịch vụ và giao diện từ phía người dùng — 05/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## 1. Phạm vi và kết luận

Nền kiểm tra: nhánh **QuangDung**, commit **1c22ab6**. Kiểm tra các luồng hiện có
bằng thao tác trình duyệt desktop/mobile, source hợp đồng API và một số tool đọc
thật. Không gọi LLM; không tạo đơn, tạo thanh toán, xuất vé hoặc sửa dữ liệu.

Các luồng UI được kiểm tra hoạt động với fixture, chuỗi Housing/Location và tìm
Flight hoạt động với dịch vụ thật. Chưa thể coi mọi dịch vụ sẵn sàng giao dịch:
local tắt writes/booking/payment, hội thoại LLM nhiều dịch vụ chưa chạy lại.

## 2. Các lỗi người dùng đã được sửa

| Vấn đề | Cách tái hiện và nguyên nhân | Thay đổi frontend |
| --- | --- | --- |
| Chi tiết chuyến bay thiếu mã sân bay | Offer thật có segment `origin/destination`; workspace đọc `departure_airport/arrival_airport` | Đọc đúng trường provider, giữ fallback của hợp đồng cũ |
| Kết quả hành trình cũ xuất hiện sau khi chọn chuyến mới | Mở A rồi B; A phản hồi muộn ghi đè B. Đóng panel lúc đang tải cũng có thể bị mở lại | Đánh dấu lượt yêu cầu, chỉ cập nhật lượt mới nhất; đóng/unmount vô hiệu response đang chờ. Áp dụng cả workspace và dialog trong chat |
| Chọn phương án lỗi nhưng người dùng không thấy lý do | Chat nhỏ đang thu gọn, API chọn trả 409; error chỉ được render trong chat đang ẩn | Có lỗi mới thì mở chat nhỏ; giữ workspace để người dùng xem và thử lại |

Không thay payload chọn phương án, đường dẫn API hoặc logic dịch vụ.

## 3. Rà soát từng luồng

| Luồng | Những gì đã kiểm tra | Giới hạn còn lại |
| --- | --- | --- |
| Đăng nhập / tài khoản | Đăng nhập, đăng xuất, tên và sở thích giữ sau reload; lịch sử lọc/tìm/mở đúng cuộc trò chuyện | UI dùng fixture; chưa có đổi/khôi phục mật khẩu, xác minh email hoặc SSO |
| Nhà / Location / Map | Tìm, chi tiết, chọn, lưu, mở nhà đã lưu từ map dù không nằm trong chat; bộ lọc/viewport/pin; alias không lặp; gợi ý địa điểm | Một chuỗi live Bách khoa Hà Nội → phòng dưới 5 triệu trong 2 km đã qua. Chưa kiểm tra lại toàn bộ dữ liệu các thành phố hoặc suy luận LLM |
| Nhà → Moving | Căn đã chọn điền sẵn điểm đến; chưa xác nhận thì chưa gửi; gõ lại địa chỉ cần xác nhận pin | Hai ô A/B và ngày/giờ qua browser fixture; không gọi lại AhaMove báo giá thật |
| Moving / OSRM | Workspace, phí, chọn phương án, receipt/tracking bằng fixture; camera/geometry/coverage có test | Moving API/MCP ready 200; route OSRM và danh mục AhaMove thật có bằng chứng ngày 04/10. Chưa tạo/sửa/hủy đơn thật trong đợt này |
| Flight | Sắp xếp, chi tiết, chọn; lỗi provider, response chậm/đóng panel; một lần SerpApi HAN → DAD ngày 19/10/2026 trả 3 offer và đọc chi tiết thành công | MCP chỉ có `search_airports`, `search_flights`, `get_offer`. Không xuất vé thật; form hiện thiên về chuyến một chiều |
| Phê duyệt | PII gửi riêng; ngăn submit hai lần; chặn phê duyệt hết hạn và hiển thị receipt | Test fixture; `writes_enabled=false` trên runtime đang chạy |
| Payment | UI chờ/hết hạn/kiểm tra không tự nhận đã trả; đọc metadata MCP create/get/cancel/refund | `sandbox_payments_enabled=false`; chưa tạo payment/đọc trạng thái từ ZaloPay thật hoặc thử callback |
| Kế hoạch / chi phí | Ba tab tiến trình, chi phí, cần phản hồi dùng cùng hội thoại; phụ thuộc giữa task; URL cũ/reload; không có danh sách kế hoạch trùng lịch sử | Tổng chi phí phương án đã chọn không phải số đã thanh toán |
| Chat / lỗi / lịch sử | Giữ bản nháp khi lỗi, ẩn/mở chat nhỏ, chọn phương án trở lại chat, xóa từng/toàn bộ hội thoại có xác nhận | Chưa kiểm chứng các lượt LLM thực tế hoặc chất lượng phối hợp đa dịch vụ |

## 4. Kiểm tra giao diện

- Desktop **1440×960**, mobile **390×844**. Các ca camera còn có resize đến 4K.
- Đã xem ảnh chi tiết chuyến bay trên hai kích thước, panel kế hoạch và tài khoản.
  Các màn hình đã thử không tràn ngang; mobile panel có nút đóng và cuộn nội dung.
- Khi panel chi tiết che nút của card trên mobile, người dùng đóng panel rồi mở
  chuyến khác. Test mô phỏng đúng thao tác này, không ép click xuyên panel.
- Các lỗi HTTP, giữ bản nháp, expiry, chọn/lưu, reload và điều hướng đều có assertion.
- Test browser intercept API/style map. Không dùng chúng để kết luận tile map công
  cộng luôn tải được; việc tải tile qua mạng vẫn là kiểm tra riêng.

## 5. Bằng chứng kiểm tra

| Bộ kiểm tra | Kết quả |
| --- | --- |
| `npx playwright test --workers=2` trước thêm test | **50 passed** |
| 5 tình huống liên quan sau sửa × desktop/mobile | **10 passed**, gồm 4 ca mới |
| 3 tình huống kế hoạch/tài khoản/Moving để chụp ảnh × 2 | **6 passed** |
| `Frontend/tests` với temp trong workspace | **7 passed** |
| Python Flight/Payment | **86 passed, 6 failed** |
| `test_domain_missions_live.py -k grounded_tools_with_real_location_and_no_llm` | **1 passed, 3 deselected** |
| Flight tool thật | SerpApi **3 offer**, chi tiết có segment đúng; **1 truy vấn provider**, **0 LLM** |
| Payment MCP | Metadata thành công, không có tool giả lập kết quả thanh toán trong cấu hình thật |
| `npm run build` | TypeScript + Vite thành công |
| Runtime sau build | 8503 `/ai`, 8000 `/health`, 4100 `/health`, 4200 và 4400 `/ready` đều **200**; Agent `/api/v1/status` **200** với token và `X-User-Id` |
| Bản UI phục vụ | Nội dung byte `/ai` bằng `Frontend/dist/index.html`, dùng asset `index-CmgomaV0.js` |

Hiện browser có **22 tình huống app + 3 POI + 2 camera**, nhân hai kích thước =
**54 ca**. 54 ca đã qua qua các lượt trên, không ghi là một lượt full suite 54 ca.

Các lần đầu Python gặp lỗi quyền thư mục temp đã chạy lại với temp riêng; không
sửa source để xử lý quyền. 6 lỗi Flight/Payment vẫn được ghi là lỗi còn mở:

1. Năm test `tests/test_mcp_flights/test_server.py` kỳ vọng 7 tool và luồng booking
   mô phỏng. `create_server` hiện lấy `simulation_enabled=false` mặc định, chỉ công
   bố 3 tool đọc. Các fixture cần yêu cầu simulation rõ ràng và thêm test mặc định
   chỉ đọc; không bật booking giả trong runtime để làm test qua.
2. `test_zalopay_receives_only_allowlisted_anonymous_fields` kỳ vọng tập trường cũ,
   trong khi gateway hiện gửi thêm `expire_duration_seconds`. Cần rà hợp đồng và
   cập nhật kiểm tra allowlist/thời hạn; không tự bỏ assertion bảo vệ dữ liệu cá nhân.

Artifact local không commit: `data/user-flow-audit-20261005/`, gồm báo cáo tool
`read-services.json`, SQLite flight riêng, temp pytest và ảnh browser.

## 6. File thay đổi trong đợt này

- `Frontend/src/components/ServiceWorkspaces.tsx`: mã sân bay và response chi tiết.
- `Frontend/src/components/Results.tsx`: response chi tiết trong dialog chat.
- `Frontend/src/components/WorkspaceChat.tsx`: mở chat nhỏ khi có lỗi.
- `Frontend/tests/browser/app.spec.ts`: hai tình huống mới trên hai kích thước.
- `Frontend/README.md`, `Frontend/tests/README.md`, `Frontend/SERVICE_AUDIT.md`:
  cập nhật hiện trạng và phân biệt bằng chứng ngày 05/10 với lịch sử.
- Báo cáo này.

Backend/agent/gateway, `.env`, dữ liệu housing/POI và ZIP bàn giao không thay đổi.
Không cần gửi lại bộ data chỉ vì đợt sửa UI này. Đây là thay đổi sau commit bàn
giao 04/10, chưa push trong đợt kiểm tra này.

## 7. Việc còn cần kiểm chứng để dùng đầy đủ

1. Đồng bộ 6 test Flight/Payment với capability và hợp đồng payload hiện tại.
2. Chạy hội thoại LLM nhiều lượt bằng ngân sách kiểm thử riêng: hỏi bổ sung địa
   điểm, giữ khu vực/ngân sách, sửa một dịch vụ mà không làm mất lựa chọn khác.
3. Nếu cần giao dịch thật: kiểm chứng cấu hình/capability và luồng provider đặt
   đơn, callback/thanh toán; Flight cần nguồn booking/xuất vé riêng. Không suy từ
   UI hoạt động hoặc có key ra giao dịch đã hoạt động.

Frontend mới đã build tại **http://127.0.0.1:8503**. Dùng **Ctrl + F5** để thử lại.
