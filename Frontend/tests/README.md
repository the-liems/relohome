# Kiểm thử frontend SIU AI

Cập nhật **04/10/2026**. Hướng dẫn này dùng cho giao diện chat, panel kế hoạch bên phải, lịch sử và tài khoản hiện tại. Xem [README ứng dụng](../README.md) để chạy hệ thống.

## Các bộ kiểm tra

| Bộ | File | Phạm vi |
| --- | --- | --- |
| Trình duyệt | [browser/app.spec.ts](browser/app.spec.ts) | Điều hướng, tương tác, dữ liệu gửi đi, trạng thái UI và desktop/mobile |
| Picker POI | [browser/poi-candidates.spec.ts](browser/poi-candidates.spec.ts) | Loại ID/alias lặp, giữ pin cũ và các nhà/trạm khác ID |
| Camera / OSRM | [browser/map-scope.spec.ts](browser/map-scope.spec.ts) | Camera MapLibre thật trong khung Việt Nam, fit điểm khác thành phố, hình học tuyến và coverage OSRM |
| Gateway | [test_gateway.py](test_gateway.py) | API web, session, quyền truy cập và hành vi gateway |
| Hợp đồng UI | [test_ui_contracts.py](test_ui_contracts.py) | Dữ liệu dịch vụ, chi phí, trạng thái và hợp đồng trình bày |
| Action/graph | [test_actions.py](test_actions.py) | Chọn phương án và hành vi graph/API liên quan |

Fixture nằm trong test, không được dùng để thay kết quả dịch vụ trong ứng dụng.

Nhóm POI/Moving ngày 04/10: **10/10 đạt** trên desktop/mobile. Bao gồm tìm lại
địa điểm, nhãn loại/thành phố, giữ ngày giờ, xác nhận pin và kiểm tra React key.
Chạy bằng `npx playwright test --grep 'POI candidate|POI picker|a moving question opens'`.

## Chạy Playwright

Yêu cầu: đã cài dependencies bằng `npm ci` trong `Frontend/`, có Chrome trên máy. [playwright.config.ts](../playwright.config.ts) sử dụng `channel: "chrome"` và tự khởi động Vite tại **127.0.0.1:5174**. Dừng dev server đang dùng cổng này trước khi chạy; cấu hình không tái sử dụng server có sẵn.

Từ `Frontend/`:

```powershell
npm run test:e2e -- --workers=1
```

Hai kích thước kiểm tra:

- Desktop: **1440 × 960**.
- Mobile: **390 × 844**, bật touch và chế độ mobile.

Chỉ chạy một nhóm hoặc một kích thước:

```powershell
npx playwright test --project=mobile --workers=1
npx playwright test --grep 'right panel contains only' --workers=1
npx playwright test --grep 'account profile|saved map home' --workers=1
```

Trên máy không có Chrome, dùng Chromium của Playwright (`npx playwright install chromium`) với config cục bộ bỏ `channel: "chrome"`; config được commit hiện vẫn dùng Chrome.

Test intercept `/web/api`, style map và glyph, dùng hợp đồng API giả lập. Không cần gateway/agent/provider đang chạy cho các ca trình duyệt hiện có; chúng không gửi truy vấn LLM, tạo đơn hay thanh toán thật.

## 20 tình huống trong app.spec.ts

Mỗi tình huống chạy trên cả hai kích thước: **40 ca**. Ngoài ra có 3 tình huống
POI và 2 tình huống camera/OSRM, tổng toàn bộ thư mục browser hiện có **50 ca**.
Con số này là danh sách test, không phải kết quả một lượt chạy toàn bộ mới nhất.

| Nhóm | Tình huống |
| --- | --- |
| Map / dữ liệu | Cảnh báo provider có cấu trúc, POI gần đúng |
| AhaMove | Phí báo giá, số tiền đơn và tracking dùng trường provider |
| Phê duyệt | Gửi PII riêng, ngăn gửi hai lần, hiện biên nhận |
| Hết hạn / thanh toán | Chặn phê duyệt hết hạn, kiểm tra thanh toán không tự nhận là đã trả |
| Lỗi dịch vụ | Giữ lại nội dung form khi yêu cầu lỗi |
| Đăng nhập / responsive | Đăng nhập, màn hình chào, khung chat toàn chiều rộng, tài khoản và panel |
| Nhà / khôi phục | Chi tiết, chọn, lưu nhà, URL kế hoạch cũ, tải lại |
| Nhà → chuyển đồ | Căn đã chọn điền sẵn điểm đến; chưa xác nhận thì chưa gửi |
| Form chuyển đồ | Câu hỏi mở form; đổi địa chỉ cần xác nhận lại pin |
| Picker Moving | ID/alias không lặp; giữ ngày/giờ khi tìm trực tiếp trong ô A |
| Tìm A/B | Cả hai ô tự tìm gợi ý, điền địa chỉ đã chọn và gửi đúng hai tọa độ; không có ô/nút tìm riêng |
| Workspace nhà | Danh sách theo viewport, bộ lọc, sort và `map_view` từ chat |
| Map → chat | Mặc định chỉ hiện nút Chat với SIU; mở thanh nhập nhỏ, bỏ Xem đầy đủ, giữ bản nháp khi thu gọn/mở lại; chọn căn trở lại chat |
| Chuyến bay | Workspace, sắp xếp và chọn chuyến |
| Báo giá chuyển đồ | Workspace, hai điểm A/B và phí chi tiết |
| Lịch sử / xóa | Xóa hội thoại, làm mới tất cả với hộp xác nhận |
| Panel kế hoạch | Ba tab hiện tại, tiến trình/chi phí/phản hồi, đóng/mở và URL cũ |
| Lịch sử tài khoản | Đọc yêu cầu/phản hồi, tìm kiếm, lọc trạng thái, mở lại đúng chat |
| Hồ sơ / session | Lưu tên và sở thích, giữ sau reload, mở chat từ Lịch sử, đăng xuất |
| Nhà lưu từ map | Mở lại chi tiết dù căn không nằm trong kết quả chat ban đầu, reload và đóng dialog |

## Kết quả kiểm tra ngày 03/10/2026

- Trọn bộ ban đầu: **32/32 ca qua** (16 tình huống × 2).
- Bổ sung 2 tình huống: hồ sơ/session qua; nhà đã lưu từ map phát hiện lỗi không mở dialog trên cả desktop/mobile.
- Sau sửa frontend, ca nhà lưu từ map qua trên cả hai kích thước; luồng nhà và panel được kiểm tra lại.
- Một assertion vị trí panel từng đọc tọa độ trong lúc hiệu ứng mở đang chạy. Test đã chuyển sang chờ vị trí ổn định; ca panel desktop/mobile chạy lại đều qua.
- Tổng cộng **36 ca hiện có đã được kiểm chứng qua các lượt chạy**; không ghi là một lượt chạy trọn bộ 36 ca.
- `npm run build` qua. Bộ Python và các test provider thật chưa chạy lại trong đợt chỉnh giao diện này; bằng chứng cũ nằm trong [SERVICE_AUDIT.md](../SERVICE_AUDIT.md).
- Sau khi bỏ khối phản hồi/Xem đầy đủ và thu gọn chat workspace: chạy lại 6 tình huống map, form chuyển đồ, chuyến bay và báo giá chuyển đồ trên desktop/mobile, **12/12 ca qua**. Ca chat kiểm tra cả giữ bản nháp và gửi `map_view` đúng.

## Chạy kiểm tra Python

Từ gốc repo với `.venv` và dependencies Python đã cài:

```powershell
.venv/Scripts/python.exe -m pytest Frontend/tests -q
```

Các test này có mock/provider fixture và graph/checkpoint. Không dùng kết quả để kết luận đã thực hiện giao dịch với provider thật. Kết quả của suite rộng trong audit là bằng chứng theo ngày, không phải trạng thái mới nhất của nhánh đang chạy.

## Đọc lỗi và giới hạn

Cập nhật 04/10 cho map/Moving: `map-scope.spec.ts` dùng camera MapLibre thật để
kiểm tra kéo/thu nhỏ/resize đến 4K trong khung Việt Nam, fit đồng thời Hà Nội và
TP.HCM, focus điểm ngoài ba vùng routing và không thêm nút đổi khu vực.
Ca Moving kiểm tra request route đúng tọa độ, nhãn OSRM, action chọn báo giá cũ
và hai ô A/B tìm trực tiếp, giữ ngày/giờ, bỏ pin khi đổi địa chỉ.
**14/14 ca qua**, sau đó bổ sung ca tìm cả A/B: **2/2 desktop/mobile qua**.
Sau chỉnh trạng thái khi hủy tìm, chạy lại 6 ca form/POI/A-B: **6/6 qua**.
Đây là 16 ca qua các lượt kiểm tra có mục tiêu, không phải chạy lại toàn bộ suite.

```powershell
npx playwright test tests/browser/map-scope.spec.ts tests/browser/app.spec.ts --grep 'nationwide|moving preview|chosen home prefills|a moving question opens|POI picker|housing answer opens|moving quotes open|moving A and B search inline' --workers=2
```

Tuyến gateway → Platform → 3 OSRM local được kiểm tra riêng bằng API đọc; 53/72/105
điểm geometry khớp Docker. Xem [báo cáo hiện hành](../../docs/integration/vietnam-map-moving-update-2026-10-04.md).

- Playwright trả số ca passed/failed và vị trí assertion. Screenshot khi lỗi cùng `error-context.md` nằm trong `Frontend/test-results/`.
- Đối chiếu request body, route và contract trước khi sửa; test phải kiểm tra tác động người dùng hoặc dữ liệu gửi đi, không chỉ sự tồn tại của component.
- Với layout có animation, chờ điều kiện cuối cùng trước khi đo vị trí.
- HTTP 200/health hoặc danh sách domain chỉ xác minh trạng thái tại thời điểm đọc, không xác minh mọi provider đang hoạt động.
- Chất lượng LLM, hội thoại đa dịch vụ thật, đặt/sửa/hủy AhaMove staging và thanh toán provider cần đợt kiểm tra tích hợp riêng.

Các đợt chỉnh giao diện trước chỉ sửa frontend/đường mở lại nhà đã lưu và test;
gateway và `.env` được giữ nguyên. Đợt 04/10 còn chuẩn hóa studio ở dữ liệu theo
yêu cầu riêng; xem báo cáo cập nhật để phân biệt phạm vi và số liệu từng đợt.
