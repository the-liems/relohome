# Kiểm thử frontend ReloHome

Cập nhật **07/10/2026**. Hướng dẫn này dùng cho trang giới thiệu, chat, panel kế hoạch bên phải, lịch sử và tài khoản hiện tại. Xem [README ứng dụng](../README.md) để chạy hệ thống.

## Kết quả mới nhất

**Production UI 07/10: 124 ca browser, 120 pass + 4 live opt-in skip trong
lượt full; 8/8 Python contract qua, build qua.** Sau chỉnh nhãn navigation
cuối, nhóm layout chạy lại 4/4 qua. Các số 110/106
bên dưới là lượt trước khi thêm ca production.

Bổ sung @axe-core/playwright (dev-only): axe WCAG 2/2.1 A/AA ở màn đại
diện, keyboard modal/tab/Flight, menu Escape, scope/readonly request và
responsive 320/768/1024/1440. Existing contract assertions giữ nguyên;
locator account dùng role tab và hãng bay exact để tránh trùng tên với
button mở chi tiết native mới. Không tắt rule axe để cho test qua.

Bổ sung nhóm layout regression: đo vị trí chữ/icon ở Moving/chat/history,
timeline Flight không chồng nhau; các mục Moving và căn chọn ở B vẫn dùng
được, chọn điểm A tải catalog cũ, chuyển mục giữ dữ liệu và không gửi lượt
Agent. Kiểm tra 320/768/1024/1440/1920 tùy màn, API giả lập, không đặt thật.

Chạy nhóm UI audit riêng (từ repo root):

```powershell
npm.cmd exec --prefix apps/web -- playwright test --config apps/web/playwright.config.ts --workers 2 --grep production
npm.cmd exec --prefix apps/web -- playwright test --config apps/web/playwright.config.ts --workers 2 --grep 'layout regression'
```

Kết quả/giới hạn chi tiết ở [audit](../PRODUCTION_UI_AUDIT.md).

Browser hiện có **110 ca**: full ngày 07/10 **105 pass**, **4 live opt-in skip**,
**1 ca lỗi Chrome `ERR_NETWORK_IO_SUSPENDED` khi goto**. Chạy lại đúng ca
bằng `--last-failed`: **1/1 pass**, tổng **106 ca đã xác minh qua**; không
sửa test/app để bỏ qua lỗi. Gateway/UI contracts **8/8 pass ở lượt trước**,
build TypeScript/Vite qua.
Các con số thấp hơn bên dưới mô tả những đợt trước khi bổ sung ca mới.

Ca mới kiểm tra landing guest/auth, CTA dùng login hiện có, asset ảnh koi,
menu mobile, trạng thái Cẩm nang/Ghép trọ, sáng/tối và VI/EN. Picker Moving
kiểm tra icon xe máy, guide hover/touch/focus, chọn trực tiếp gói/cỡ xe trên
thẻ, không có bộ lọc tải trọng/Gói khác, ECO/POOL/mua hộ phân loại đúng,
không đổi service_id/pin/payload, clear addon/COD khi đổi gói, giữ lựa chọn
khi tải lại catalog. Mở hướng dẫn loại đang chọn không xóa dữ liệu; chế độ
ReloHome gợi ý chỉ gửi khi xác nhận. Test không gửi theme/locale/nhóm UI vào Agent payload.

Ca Van mới xác nhận: chuyển từ tải sang Van chỉ có Van 500/750/1000,
radio không lớn hơn 18 px và thẻ chưa chọn không quá 65 px; gói 1000kg vẫn
hiện đúng mô tả nguồn 850kg. Hover/focus xe khác không đổi loại đang chọn;
refresh bỏ đúng gói đã ngừng hỗ trợ, giữ ID hợp lệ và gửi đúng gói khi bấm
báo giá. **20/20 ca Moving có mục tiêu qua** trong lượt kiểm tra này.

Từ repo root:

```powershell
npm.cmd exec --prefix apps/web -- playwright test --config apps/web/playwright.config.ts --workers 4
.venv/Scripts/python.exe -m pytest apps/browser-gateway/tests -q --basetemp logs/local/pytest-frontend
npm.cmd run build --prefix apps/web
```

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

Yêu cầu: đã cài dependencies bằng `npm ci` tại gốc repository, có Chrome trên máy. [playwright.config.ts](../playwright.config.ts) sử dụng `channel: "chrome"` và tự khởi động Vite tại **127.0.0.1:5174**. Dừng dev server đang dùng cổng này trước khi chạy; cấu hình không tái sử dụng server có sẵn.

Từ `apps/web/`:

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

## 39 tình huống trong app.spec.ts

Mỗi tình huống chạy trên cả hai kích thước: **78 ca**. Ngoài ra có 3 tình huống
POI và 2 tình huống camera/OSRM, tổng toàn bộ thư mục browser hiện có **88 ca**.
Lượt toàn bộ trước bổ sung hồi quy expiry thẻ chat đạt **78/78**. Sau bổ sung
hai tình huống thẻ chat, nhóm expiry/Moving/Flight đạt **16/16**; sau chỉnh
header Flight, **2/2** ca bố cục qua. Hồi quy căn chọn trên map → B Moving
đạt **10/10** (ba tình huống mới và hai tình huống liên quan, mỗi tình huống
desktop/mobile). Chưa chạy lại toàn bộ 88 ca trong một lượt.

Ba tình huống mới: đọc căn theo ID ngoài kết quả chat/snapshot, tải chậm và
reload; không ghi đè B đang nhập; lỗi đọc chi tiết vẫn nhập B được. Ô căn đã
chọn luôn hiện để chọn lại, không tự gửi chat hay xác nhận pin gần đúng.

```powershell
npm run test:e2e -- --grep 'map-only selected home|late selected-home|missing selected-home|chosen home prefills|moving question opens' --workers=2
```

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
| Form Moving mở rộng | Gửi đúng add-on/số lượng/mức dịch vụ, kiện/kg/cm, COD/khai giá/ghi chú/mã giảm giá/POD cùng hai pin xác nhận |
| Giới hạn Moving | Chặn thiếu mức dịch vụ, option không khả dụng, kiện thiếu kg và COD quá giới hạn; đổi xe bỏ tùy chọn cũ |
| Map và mobile Moving | Đổi A vô hiệu danh mục đã chọn; thu gọn/mở form, không tràn ngang |
| Ghim B trên map | Không nhầm pin thủ công thành căn đã chọn khi không có căn; khi có căn, giữ địa chỉ B mới do user nhập và gửi đầy đủ địa chỉ/tọa độ |
| Dữ liệu Moving trống | Nhập rồi xóa mô tả kiện hoặc chỉ có khoảng trắng: bỏ trường tùy chọn, vẫn gửi kg hợp lệ |
| Lỗi báo giá Moving | Giữ A/B, lịch, kiện hàng, add-on và ghi chú khi API 502; lần thử lại gửi nguyên lựa chọn |
| Danh mục Moving rỗng | Thông báo rõ, tải lại danh mục; không tự gửi chat/báo giá |
| Giá hết hạn khi đang xem | Moving/Flight tự khóa nút trong workspace, thẻ chat và chi tiết, không gửi action khi hết hạn |
| Form Flight | Chặn nơi đi/đến trống hoặc giống nhau; giữ dữ kiện khi API lỗi |
| Lỗi danh mục Moving | Tải lại danh mục, giữ tuyến và giờ; không âm thầm gọi Agent |
| Picker Moving | ID/alias không lặp; giữ ngày/giờ khi tìm trực tiếp trong ô A |
| Tìm A/B | Cả hai ô tự tìm gợi ý, điền địa chỉ đã chọn và gửi đúng hai tọa độ; không có ô/nút tìm riêng |
| Workspace nhà | Danh sách theo viewport, bộ lọc, sort và `map_view` từ chat |
| Map → chat | Mặc định chỉ hiện nút Chat với ReloHome; mở thanh nhập nhỏ, bỏ Xem đầy đủ, giữ bản nháp khi thu gọn/mở lại; chọn căn trở lại chat |
| Chuyến bay | Workspace, sắp xếp và chọn chuyến |
| Chi tiết chuyến bay | Hiển thị `origin/destination` thật của provider; giữ kết quả mới nhất khi response cũ về chậm, không mở lại panel đã đóng |
| Lỗi chọn phương án | Chat workspace tự mở hiển thị lỗi, giữ workspace để người dùng thử lại |
| Báo giá chuyển đồ | Workspace, hai điểm A/B và phí chi tiết |
| Lịch sử / xóa | Xóa hội thoại, làm mới tất cả với hộp xác nhận |
| Panel kế hoạch | Ba tab hiện tại, tiến trình/chi phí/phản hồi, đóng/mở và URL cũ |
| Lịch sử tài khoản | Đọc yêu cầu/phản hồi, tìm kiếm, lọc trạng thái, mở lại đúng chat |
| Hồ sơ / session | Lưu tên và sở thích, giữ sau reload, mở chat từ Lịch sử, đăng xuất |
| Nhà lưu từ map | Mở lại chi tiết dù căn không nằm trong kết quả chat ban đầu, reload và đóng dialog |

## Kết quả kiểm tra ngày 05/10/2026

### Rà frontend theo yêu cầu, không sửa backend

- Trọn bộ browser tại thời điểm 78 ca: **78 passed**.
- Sau bổ sung expiry ở thẻ chat và dialog: **16/16** ca liên quan qua; chỉnh
  header Flight mobile: **2/2** ca bố cục qua.
- **6/6** Python `test_gateway.py` + `test_ui_contracts.py` qua. Lần đầu bị
  quyền ghi TEMP Windows; chạy lại với `--basetemp` mới trong `logs/local/`
  giải quyết được, không sửa test hay code backend để vượt lỗi môi trường.
- JSON thật browser gửi trong hai tình huống Moving × hai viewport được kiểm
  bằng `ChatRequest.model_validate`: **4/4 hợp lệ**, không gọi LLM.
- Bản build cuối được phục vụ tại 8503; đã xem ảnh desktop/mobile, không tràn
  ngang/page error ở các màn khảo sát. Visual smoke dùng fixture API và basemap
  OpenFreeMap thật; helper và ảnh ở `logs/local/`, không vào data bàn giao.
- OSRM ô tô thật 5000/5001/5002 với `radiuses=100;100`: HCM 47 điểm tuyến,
  Hà Nội 120, Đà Nẵng 41; không sửa cấu hình hoặc dữ liệu routing.
- Không test booking/payment/SerpApi/LLM thật trong đợt frontend này.

### Hồi quy lỗi ghim B và kiểm tra Moving/Flight

- Tái hiện lỗi trước sửa: cả **4/4** ca ghim B sai (hai tình huống × desktop/mobile).
- Sau sửa: **4/4** ca mới qua. Nhóm `moving|flight|AhaMove|approval sends`
  đạt **32/32**, bao gồm ghim A/B, danh mục, form tùy chọn, chọn căn, phê duyệt,
  tuyến OSRM, sắp xếp chuyến và xử lý response chi tiết chuyến về chậm.
- TypeScript/Vite build qua; không thay đổi Agent để tối ưu tốc độ trong lượt
  kiểm tra này. Không gọi thêm LLM, tìm chuyến SerpApi hay báo giá AhaMove thật.
- Phân tích thời gian thực từ log và đo MCP Flight local: xem phần cuối
  [báo cáo Moving](../../../docs/integration/moving-service-workspace-update-2026-10-05.md).

### Đợt Moving mở rộng

- `npm run test:e2e -- --workers=2`: **62 passed** (một lượt toàn bộ).
- Sau bổ sung kiểm tra nút sao chép liên hệ: **2/2** ca phê duyệt qua. Hai ca
  form Moving được chụp/xem ảnh desktop/mobile và chạy lại **2/2 qua**.
- Python nhóm form/commit/POI-confirmation/intake/gateway: **50 passed**. Test
  mới nằm tại `tests/test_agents/test_moving_form_options.py`; kiểm tra cả đường
  LLM execution với quyết định giả lập và adapter nền, không gọi LLM thật.
- Ruff toàn bộ Python đã sửa và TypeScript/Vite build qua.
- Hai báo giá staging thật: **162.000đ → 237.000đ**, phụ phí bốc xếp **75.000đ**;
  không gọi tool tạo đơn, thanh toán hoặc LLM.
- Kiểm tra rộng Python lúc đầu: **179 passed, 19 failed**. Bản HEAD trước sửa
  chạy cùng nhóm, bỏ hai ca stdio/live phụ thuộc môi trường: **157 passed,
  17 failed**; tập 17 tên lỗi trùng hoàn toàn. Không ghi suite rộng là sạch.
- Bằng chứng và giới hạn: [báo cáo Moving](../../../docs/integration/moving-service-workspace-update-2026-10-05.md).

```powershell
.venv/Scripts/python.exe -m pytest tests/test_agents/test_moving_form_options.py tests/test_agents/test_commit_adapter.py tests/test_agents/test_poi_moving_confirmation.py tests/test_agents/test_intake.py apps/browser-gateway/tests -q --basetemp=logs/local/pytest-moving
```

Từ `apps/web/`, có thể chụp ảnh form fixture khi chạy test:

```powershell
$env:SIU_UI_SCREENSHOTS='1'
npm run test:e2e -- --grep 'moving form submits' --workers=2
```

Ảnh nằm trong `logs/local/` ở gốc repo. Map nền trống trong fixture là chủ ý
chặn mạng; camera/OSRM có test riêng. Không dùng ảnh fixture để kết luận tile
provider thật đã tải.

### Đợt kiểm tra trước Moving mở rộng

- Trọn bộ trước bổ sung: **50/50 qua** (`npx playwright test --workers=2`).
- Hai tình huống mới tái hiện mã sân bay thiếu và lỗi bị giấu khi chat thu gọn. Sau sửa,
  **10/10 ca có mục tiêu qua**, gồm 4 ca mới và 6 ca liên quan đã có.
- Kiểm tra ảnh kế hoạch, tài khoản và Moving trên hai kích thước: **6/6 qua**.
  Đã xem ảnh panel kế hoạch, tài khoản và chi tiết chuyến bay trên desktop/mobile.
- `npm run build` qua; gateway 8503 phục vụ đúng bản build mới.
- Python `apps/browser-gateway/tests`: **7/7 qua**. Trong môi trường giới hạn quyền temp, tạo thư
  mục cha trước rồi dùng `--basetemp=logs/local/pytest-temp`.
- Flight/Payment Python: **86 passed, 6 failed**; 5 test server Flight kỳ vọng tool
  simulation khi simulation mặc định tắt, 1 test Payment có allowlist thiếu
  `expire_duration_seconds`. Đây là lỗi test còn mở, chưa kết luận suite sạch.
- Live Location → Housing: **1 passed, 3 deselected**, không gọi LLM. Một truy vấn
  SerpApi thật trả 3 offer; Payment chỉ kiểm tra danh sách tool, không tạo giao dịch.
- Tổng **54 ca browser đã qua các lượt**, không ghi là một lần chạy toàn bộ 54 ca.

Nhóm kiểm tra lại lỗi mới:

```powershell
npx playwright test tests/browser/app.spec.ts --grep 'flight detail keeps|failed workspace selection|flight results open|choosing a home from the map list|moving quotes open' --workers=2
```

Phạm vi thực tế và các tính năng chưa kiểm chứng được ghi ở
[báo cáo 05/10](../../../docs/integration/user-service-ui-audit-2026-10-05.md).

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
.venv/Scripts/python.exe -m pytest apps/browser-gateway/tests -q
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
điểm geometry khớp Docker. Xem [báo cáo hiện hành](../../../docs/integration/vietnam-map-moving-update-2026-10-04.md).

- Playwright trả số ca passed/failed và vị trí assertion. Screenshot khi lỗi cùng `error-context.md` nằm trong `apps/web/test-results/`.
- Đối chiếu request body, route và contract trước khi sửa; test phải kiểm tra tác động người dùng hoặc dữ liệu gửi đi, không chỉ sự tồn tại của component.
- Với layout có animation, chờ điều kiện cuối cùng trước khi đo vị trí.
- HTTP 200/health hoặc danh sách domain chỉ xác minh trạng thái tại thời điểm đọc, không xác minh mọi provider đang hoạt động.
- Chất lượng LLM, hội thoại đa dịch vụ thật, đặt/sửa/hủy AhaMove staging và thanh toán provider cần đợt kiểm tra tích hợp riêng.

Các đợt chỉnh giao diện trước chỉ sửa frontend/đường mở lại nhà đã lưu và test;
gateway và `.env` được giữ nguyên. Đợt 04/10 còn chuẩn hóa studio ở dữ liệu theo
yêu cầu riêng; xem báo cáo cập nhật để phân biệt phạm vi và số liệu từng đợt.
