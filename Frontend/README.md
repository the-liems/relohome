# SIU AI — Frontend

Cập nhật **03/10/2026**. React + TypeScript + Vite trong thư mục `Frontend/`, thay giao diện Streamlit. Gateway FastAPI phục vụ bản build, quản lý session và nối tới Agent API/Platform API.

## Trạng thái hiện tại

- **Chat là màn hình chính**, không còn sidebar trái hoặc breadcrumb.
- **Kế hoạch nằm ở mép phải**, người dùng mở/thu gọn để xem **Tiến trình**, **Chi phí**, **Cần phản hồi** của hội thoại đang mở.
- Đã bỏ trang Kế hoạch riêng và tab **Các kế hoạch**. Hội thoại cũ được mở lại từ **Lịch sử** hoặc **Tài khoản → Lịch sử yêu cầu**.
- **Nút tài khoản** ở header: avatar, tên, khung chữ nhật bo góc cùng kiểu nút Lịch sử; không có icon hình người phía sau.
- **Tiện ích trên map tự hiển thị khi zoom đủ gần** (zoom ≥ 14), không cần tick công tắc.
- **Chat trong workspace mặc định thu gọn** thành nút “Chat với SIU”. Bấm để mở thanh nhập nhỏ, bấm mũi tên xuống để ẩn lại; giữ nội dung đang gõ. Đã bỏ khối tóm tắt phản hồi và nút “Xem đầy đủ”; hội thoại đầy đủ vẫn xem tại chat chính. Câu hỏi cần chọn và lỗi gửi vẫn có phần hiển thị ngắn khi mở thanh chat.
- Đợt chỉnh giao diện và rà soát gần nhất chỉ sửa frontend; giữ nguyên backend, logic agent, gateway, lưu trữ và `.env`.

### Kết quả kiểm tra gần nhất

| Kiểm tra ngày 03/10 | Kết quả và phạm vi |
| --- | --- |
| TypeScript + Vite build | Thành công |
| Playwright | 32 ca hiện có qua trọn bộ; 4 ca bổ sung qua các lượt kiểm tra tiếp theo. Hiện có 18 tình huống × desktop/mobile = 36 ca |
| Kiểm tra lại sau sửa giao diện | Luồng chi tiết/chọn/lưu nhà và panel kế hoạch đã chạy lại; test đo vị trí panel chờ hiệu ứng mở hoàn tất. Sau khi thu gọn chat workspace, 12 ca map/chuyển đồ/chuyến bay desktop/mobile qua |
| Kiểm tra chỉ đọc ứng dụng local | Frontend 8503, Agent `/api/v1/status`, Platform `/health`, Moving API `/health` trả HTTP 200 tại thời điểm kiểm tra |
| Capability local | Agent công bố 5 domain: property, map, relocation, flight, payment; `writes_enabled=false` |

**Lỗi đã sửa:** nhà lưu khi khám phá map có thể không nằm trong kết quả chat ban đầu. Mở nhà đó từ Tài khoản nay lấy bản lưu đúng hội thoại và gọi API chi tiết hiện có, kể cả sau tải lại. Khi bản lưu không có ngữ cảnh kết quả để chọn phương án, dialog chỉ xem thông tin; thao tác chọn vẫn thực hiện qua map/kết quả dịch vụ.

Các ca trình duyệt dùng API giả lập. Chúng xác minh đường đi, trạng thái hiển thị và dữ liệu gửi đi; **không chứng minh chất lượng suy luận LLM, đặt đơn hoặc thanh toán thật**. Các kết quả Python/provider trong [SERVICE_AUDIT.md](SERVICE_AUDIT.md) có ngày kiểm tra riêng, chưa được chạy lại toàn bộ trong đợt chỉnh giao diện này.

## Màn hình và cách sử dụng

### Chat và lịch sử

1. Đăng nhập, bắt đầu tại `/ai`; nhập yêu cầu hoặc chọn một trong bốn nhóm: Tìm nhà, Tìm chuyến bay, Chuyển đồ, Đường đi.
2. Agent hỏi bổ sung hoặc trả kết quả. Form tìm kiếm vẫn gửi yêu cầu tới graph, cần LLM để xử lý đầy đủ.
3. Kết quả nhà, chuyến bay hoặc báo giá chuyển đồ mở workspace tương ứng. Nhấn **Chat với SIU** để mở thanh chat nhỏ; mũi tên xuống thu gọn lại.
4. Chọn phương án để trở lại chat và tiếp tục các dịch vụ khác.
5. Nút **Lịch sử** trên header tìm theo tiêu đề, mở lại hội thoại; có tạo mới, xóa từng hội thoại và xóa tất cả/làm mới SIU.

Lịch sử lưu ở máy chủ. Xóa hội thoại không đồng nghĩa hủy đơn đã đặt. Luồng xóa tất cả giữ hội thoại đang chờ thanh toán khi backend yêu cầu; hồ sơ, sở thích và nhà đã lưu được giữ.

### Kế hoạch bên phải

| Tab | Nội dung |
| --- | --- |
| Tiến trình | Các mục tiêu, trạng thái, phương án đã chọn và quan hệ phụ thuộc/song song từ `state.progress`; hội thoại cũ có thể dùng danh sách task hiện có |
| Chi phí | Tổng phương án đã chọn, tách hằng tháng/một lần, biên nhận dịch vụ |
| Cần phản hồi | Thông tin agent cần bổ sung; form phê duyệt hoặc kiểm tra thanh toán khi workflow đang chờ |

Panel dùng cùng hội thoại và callback với chat, không tạo bản kế hoạch riêng. **Đã chọn phương án chưa có nghĩa đã đặt dịch vụ hay đã thanh toán.** Người dùng đóng bằng nút trên mép phải, nút X, Escape hoặc bấm ngoài panel.

### Tài khoản

Nhấn avatar/tên trên header để vào `/account`.

| Mục | Nội dung |
| --- | --- |
| Lịch sử yêu cầu — tab mặc định | Từng lượt yêu cầu/phản hồi đã lưu, thời gian, tìm kiếm, lọc trạng thái, xem phản hồi, mở lại hội thoại |
| Đăng nhập & bảo mật | Email đăng nhập, thông tin bảo mật và khả năng trình duyệt lưu/tự điền mật khẩu |
| Hồ sơ | Sửa tên hiển thị |
| Sở thích AI | Thành phố, ngân sách, loại nhà, phương tiện, tiện nghi; chỉ áp dụng khi người dùng chọn, yêu cầu mới trong chat được ưu tiên |
| Đã lưu | Xem/bỏ lưu nhà; mở chi tiết gắn với hội thoại hoặc xem tại Tài khoản nếu hội thoại gốc đã bị xóa |

Lịch sử yêu cầu đọc API `/threads` và `/threads/:id` hiện có; không phải nhật ký từng tool/LLM. Mật khẩu không hiển thị lại. Chưa có đổi/khôi phục mật khẩu, xác minh email hoặc SSO.

### URL hiện có

| URL | Đích đến |
| --- | --- |
| `/ai` | Chat mới |
| `/ai/:threadId` | Hội thoại đã lưu |
| `/ai/:threadId?panel=plan` | Hội thoại và panel kế hoạch |
| `/account` | Tài khoản, mặc định lịch sử yêu cầu |
| `/plans` — URL cũ | Chuyển đến `/account` |
| `/plans/:planId` — URL cũ | Chuyển đến hội thoại tương ứng và mở panel kế hoạch |
| `/login` | Đăng nhập khi chưa có session; đã đăng nhập thì về chat |

## Phạm vi các dịch vụ

| Dịch vụ | Frontend hiện có | Giới hạn |
| --- | --- | --- |
| Nhà / Map | Card, chi tiết, lưu, so sánh tối đa 3 căn; danh sách theo viewport, sort, marker/cụm, tiện ích, tuyến đường, pin địa điểm | Bộ lọc commute/bán kính dùng bản đồ của kết quả; khám phá viewport không âm thầm bỏ điều kiện không hỗ trợ |
| Chuyển đồ / AhaMove | Form điểm lấy/giao, pin, ngày/giờ; căn đã chọn điền sẵn điểm đến; báo giá, phí, lựa chọn, review, biên nhận/tracking | Đặt/sửa/hủy phụ thuộc capability và cấu hình provider; chưa có UI đầy đủ cho nhiều đơn, timeline callback, rating, special request/COD |
| Chuyến bay | Tìm, sắp xếp, xem offer, chọn vào kế hoạch | Tìm thật cần SerpApi; chưa cung cấp luồng xuất vé thật |
| Thanh toán | Trạng thái workflow, link/QR provider, kiểm tra thanh toán | Chưa có form ZaloPay sandbox độc lập hoặc refund; không coi lời người dùng là xác nhận đã thanh toán |
| Phê duyệt / Chi phí | Form liên hệ riêng, task/version/hash và expiry; khóa thao tác khi không hỗ trợ hoặc writes tắt | Có giao diện không đồng nghĩa provider đã thực hiện giao dịch |

Không có streaming token; giao diện hiển thị trạng thái chờ theo lượt. Runtime không thay lỗi provider bằng dữ liệu demo. Ghép trọ/cẩm nang, quản lý vé thật và các tính năng chưa có capability chưa được bật. Danh sách tool và bằng chứng kiểm tra chi tiết: [SERVICE_AUDIT.md](SERVICE_AUDIT.md).

## Chạy ứng dụng

Cần Python environment của repo, Node 22.12+ và các service theo [runbook local](../docs/runbooks/local-mvp.md).

Từ gốc repo:

```powershell
cd Frontend
npm ci
npm run build
cd ..
.venv/Scripts/python.exe scripts/local-integration.py ui
```

Mở **http://127.0.0.1:8503**. Agent API cần chạy tại 8000; map khám phá vùng cần Platform tại 4100. Location/Moving/OSRM và database khởi động theo runbook. Lệnh trên chỉ khởi động UI/gateway.

### Phát triển với hot reload

Giữ gateway tại 8503. Trong terminal khác:

```powershell
cd Frontend
npm run dev
```

Mở **http://127.0.0.1:5174**. Vite proxy `/web/api` tới gateway. Nếu gateway đổi địa chỉ, đặt `SIU_GATEWAY_URL` trước khi chạy Vite.

Sau khi chỉnh source để xem qua cổng 8503, chạy lại `npm run build`, rồi tải lại bằng **Ctrl + F5**.

## Kiểm thử

Hướng dẫn, phạm vi 18 tình huống và cách đọc kết quả: [tests/README.md](tests/README.md).

```powershell
# Từ Frontend/
npm run build
npm run test:e2e -- --workers=1

# Từ gốc repo — gateway, hợp đồng UI và graph/action
.venv/Scripts/python.exe -m pytest Frontend/tests -q
```

Playwright dùng Chrome đã cài, tự chạy Vite ở 5174; dừng dev server đang chiếm cổng này trước khi test. Fixture API chỉ có trong test. Các test Python dùng mock/graph, không thay thế kiểm tra provider thật.

## Cấu trúc

| Đường dẫn | Vai trò |
| --- | --- |
| [src/App.tsx](src/App.tsx) | Route, chat, lịch sử, tài khoản và kết nối các workspace |
| [src/components/PlanPeek.tsx](src/components/PlanPeek.tsx) | Panel kế hoạch bên phải |
| [src/components/PlanProgress.tsx](src/components/PlanProgress.tsx) | Mô tả mục tiêu và tổng phương án đã chọn được tái sử dụng |
| [src/components/RequestHistory.tsx](src/components/RequestHistory.tsx) | Lịch sử từng lượt gửi yêu cầu |
| [src/components/MapWorkspace.tsx](src/components/MapWorkspace.tsx) | Map nhà và danh sách theo viewport |
| [src/components/ServiceWorkspaces.tsx](src/components/ServiceWorkspaces.tsx) | Workspace chuyến bay/chuyển đồ và form chuyển đồ |
| [src/components/WorkspaceChat.tsx](src/components/WorkspaceChat.tsx) | Chat ẩn/hiện trong workspace dịch vụ |
| [src/components/Forms.tsx](src/components/Forms.tsx), [Transactions.tsx](src/components/Transactions.tsx) | Form, phê duyệt, thanh toán và biên nhận |
| [src/styles.css](src/styles.css) | Giao diện và responsive |
| [server.py](server.py), [store.py](store.py) | Gateway cùng origin; SQLite user/session/history/saved |
| [scripts/prepare-map.mjs](scripts/prepare-map.mjs) | Chuẩn bị MapLibre worker/module khi install/dev/build |
| [tests/](tests/README.md) | Playwright, kiểm thử gateway và hợp đồng |
| `dist/` | Bản build Vite được gateway phục vụ |

## Cấu hình gateway

| Biến | Vai trò / mặc định |
| --- | --- |
| `AGENT_API_TOKEN` | Token ở máy chủ để gọi Agent API |
| `LIFEFLOW_API_BASE_URL` | `http://127.0.0.1:8000/api/v1` |
| `SIU_PLATFORM_API_URL` | `http://127.0.0.1:4100/v1` |
| `SIU_WEB_DB` | `data/siu-web.sqlite3` |
| `SIU_ALLOW_REGISTRATION` | `false` để tắt đăng ký mới |
| `SIU_SECURE_COOKIE` | `true` khi phục vụ qua HTTPS |
| `SIU_GATEWAY_URL` | Đích proxy Vite; mặc định `http://127.0.0.1:8503` |

Chạy một worker gateway. Giữ database web cùng dữ liệu checkpoint của agent để bảo toàn lịch sử. Secret LLM/AhaMove/SerpApi/ZaloPay nằm phía máy chủ; không dùng biến `VITE_*` để chứa token.

## Tài liệu liên quan

- [Audit tool và giới hạn dịch vụ](SERVICE_AUDIT.md).
- [Kiểm thử frontend](tests/README.md).
- [Kế hoạch frontend theo agent](../docs/integration/siu-ai-agent-first-frontend-plan.md).
- [Thiết kế màn hình ban đầu](../docs/integration/siu-ai-frontend-screen-design.md).
- [Workspace map và dịch vụ](../docs/integration/map-workspace-2026-10-01.md).
- [Kiến trúc MVP](../docs/review/mvp-architecture.md).
- [Chạy hệ thống local](../docs/runbooks/local-mvp.md).

Tài liệu thiết kế và ảnh dưới đây là tham chiếu ban đầu. Bố cục hiện hành được mô tả trong README này.

## Ảnh tham chiếu

![Tham chiếu 1](ChatGPT%20Image%20Sep%2030,%202026,%2011_48_57%20AM-1.png)

![Tham chiếu 2](ChatGPT%20Image%20Sep%2030,%202026,%2011_52_23%20AM-2.png)

![Tham chiếu 3](ChatGPT%20Image%20Sep%2030,%202026,%2011_52_34%20AM-3.png)

![Tham chiếu 4](ChatGPT%20Image%20Sep%2030,%202026,%2011_52_39%20AM-4.png)

![Tham chiếu 5](ChatGPT%20Image%20Sep%2030,%202026,%2011_52_39%20AM-5.png)
