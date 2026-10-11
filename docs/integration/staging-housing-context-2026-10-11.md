# Housing context và lớp Ghép trọ trên staging — 11/10/2026

Issue: [#99](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/99).
Nhánh: `fix/99-staging-housing-context`, từ `main` tại `8c34dfc`.

## Phân biệt lỗi đã xác nhận và giả thuyết

- Ảnh thất bại và ảnh thành công thuộc **hai thread khác nhau**. Chưa đủ bằng chứng để kết luận chỉ reload đã sửa cùng một trạng thái.
- Agent có thể gửi city ID `hanoi` tới `search_areas`. Catalog tìm theo tên hành chính đã chuẩn hóa dấu/khoảng trắng, không chuyển city ID thành tên. Đây là bất tương thích có trong code; chưa có trace chứng minh là nguyên nhân duy nhất của lượt staging lỗi.
- Bộ nhớ giá trước đây phụ thuộc city/near nhưng không phụ thuộc district. Đổi quận/phường có thể vẫn dùng ngân sách cũ. Thông báo dùng bộ nhớ trước đây chỉ hiện khi có kết quả, nên lượt thất bại có thể che nguồn của mức giá.
- UI có fallback lấy thẻ Housing cũ trong lịch sử khi tìm kiếm mới chưa có kết quả.
- Lớp Ghép trọ gọi `/map/rooms` mà chưa xét `availability.enabled`, và tiếp tục polling sau lỗi. Backend hiện trả 503 nếu Roommate runtime chưa sẵn sàng; cần xem body/log của staging để phân biệt với 503 từ gateway.
- Cảnh báo MapLibre về road shield là cảnh báo style. Chưa có bằng chứng nó gây hỏng Housing; không sửa style theo suy đoán.

## Thay đổi

### Location và ngữ cảnh tìm nhà

`city_search_text` dịch đúng ba city ID trong contract hiện có thành tên dùng tra catalog. Tên địa điểm khác được giữ nguyên. Áp dụng tại adapter Location và bước chuẩn bị tool của domain agent. Không gán tọa độ, ID hành chính hay kết quả tìm kiếm giả; vẫn tra bằng tool và dữ liệu thật.

Ngân sách nhớ chỉ được tự điền khi khu vực người dùng nêu không thay đổi so với bộ nhớ. Bổ sung district vào bộ nhớ và anchor của giá, có TTL 60 ngày. Bộ nhớ cũ không biết district không được dùng giá cũ cho một district mới được nêu. Cùng khu vực vẫn có thể dùng giá nhớ và phải thông báo, kể cả khi truy vấn thất bại. Đây **không phải** xóa toàn bộ bộ nhớ hay loại bỏ LLM.

Sau khi chuyển nhà thành công, district cũng ngừng tự điền cùng city/near, không tiếp tục áp khu vực ở cũ.

UI chỉ tự mở kết quả Housing thuộc kế hoạch hiện tại và đã hoàn thành. Kết quả lịch sử vẫn có thể mở bằng task ID từ Kế hoạch, không tự giả làm kết quả mới. Phân tích so sánh vẫn tách khỏi tìm/chọn nhà.

Khi Housing chưa có ứng viên để chọn, câu hỏi đích Moving báo đang chờ chốt căn, không mời người dùng chọn một căn chưa tìm được. Không thay lịch, địa chỉ hay quyền đặt đơn.

### Ghép trọ vẫn giữ nguyên

**Không tắt Roommate, không sửa `.env`, compose, dữ liệu hoặc điều kiện consent.** Khi `/availability` xác nhận dịch vụ bật, lớp ghim vàng vẫn tải và cập nhật bình thường. Khi dịch vụ chưa sẵn sàng hoặc request lỗi:

- Housing vẫn tiếp tục hoạt động độc lập;
- không gửi request overlay chồng nhau;
- lỗi overlay dừng polling tự động trong phạm vi đang xem;
- người dùng có nút thử lại; thay phạm vi tìm kiếm cũng cho phép thử lại;
- không giả lập nhu cầu ghép trọ khi không đọc được backend.

Backend cần cấu hình Roommate runtime/token/catalog hợp lệ để cung cấp dữ liệu. Chặn request lặp không phải sửa cấu hình runtime của staging.

### Lỗi gateway dễ phân biệt hơn

Frontend phân biệt HTTP 403/5xx trả HTML với phản hồi JSON của API, và không coi body không phải JSON là kết quả thành công. Thông báo giữ mã HTTP, không hiển thị raw HTML của proxy. Không bypass Cloudflare.

## Kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| Python: policy mới + memory/turn rules/comparison identity/housing viewing graph | 43 passed |
| Agent/API/Roommate/gateway, môi trường test tách cấu hình local | 498 passed, 2 skipped |
| Frontend: scope/housing controls/staging context contracts | 13 passed |
| Ruff theo phạm vi CI | Passed |
| Frontend TypeScript + Vite production build | Passed |
| Intake + Planner thật, câu Housing + Moving của người dùng | Passed, 9,67 giây |
| Intake + Planner thật, tìm phường Cầu Giấy chưa giới hạn giá | Passed, 6,42 giây |

Hai ca LLM hợp lệ đều không sinh `max_price_vnd`, nhận đúng Housing; ca đầu nhận thêm Moving, ngày 13/10/2026 lúc 16:00 và đích `selected:property`. Tổng usage hai ca: **43.533 token**, chỉ cho Intake/Planner; không phải số token toàn phiên hay benchmark full luồng. Một lần harness trước đó truyền tiếng Việt qua PowerShell ASCII không hợp lệ đã bị loại khỏi đánh giá chất lượng; sau đó truyền bằng Unicode escape để bảo toàn đầu vào.

Các test mới là kiểm tra hàm/chính sách thuần, không tạo provider response hay dữ liệu nhà giả. Bộ test cũ của repo có fixture offline riêng; không gọi chúng là E2E provider thật. Cấu hình contracts dùng lại runner không cần Vite/browser để kiểm tra các chính sách này.

Bộ Python toàn repo trên Windows **chưa xanh**: vòng tách `.env` đạt 818 passed, 90 skipped, 18 failed. Các lỗi còn lại thuộc harness shell/symlink/path/redaction phụ thuộc nền tảng, cùng một test Roommate kế thừa demo local. Vòng liên quan Agent/API/Roommate/gateway đã tách demo và `.env` trong **process test**, đạt 498 passed, 2 skipped. Không sửa feature flag của sản phẩm để làm xanh test. CI Linux của PR vẫn phải chạy và được reviewer kiểm tra; không lấy số test local thay cho gate CI.

## Giới hạn và checklist review trên staging

Chưa kiểm chứng truy vấn Housing/Moving/MCP với DB staging: môi trường hiện không có Docker engine chạy và HTTP trực tiếp tới staging bị Cloudflare challenge 403. Không thay CI/CD hoặc trực tiếp deploy. Healthcheck `postgis_version()` và việc Coolify nhận restart chưa chứng minh schema Housing/query và rollout đã sẵn sàng; phần này cần chủ deployment đối soát riêng.

Sau CI xanh và review, kiểm tra bản triển khai đúng SHA:

1. Thread mới: hỏi tìm nhà Cầu Giấy và chuyển từ VinUni tới căn sẽ chọn. Không nêu giá thì không được tự tạo giá; nếu dùng bộ nhớ cùng khu vực, phải báo rõ nguồn.
2. Người có bộ nhớ giá 5 triệu ở khu khác: đổi sang Cầu Giấy, không kế thừa mức giá đó.
3. Cố ý để truy vấn mới thiếu địa điểm/kết quả: không mở bản đồ của lần tìm cũ như kết quả mới. Kế hoạch vẫn mở được kết quả lịch sử đúng task.
4. Khi tìm nhà chưa xong, Moving chờ chốt căn và giữ thông tin đã nêu; khi có kết quả thì tiếp tục chọn như trước.
5. Roommate bật và runtime khỏe: ghim vàng/consent hoạt động như cũ. Runtime lỗi: cảnh báo riêng, không spam `/map/rooms`, thử lại được, Housing không bị chặn.
6. Đối soát request ID, body lỗi và log API/location/DB nếu vẫn có 503 hoặc không tìm được city. Không kết luận lỗi model hay thiếu schema chỉ từ một thông báo chung.

PR cần CI và reviewer duyệt; không tự merge.
