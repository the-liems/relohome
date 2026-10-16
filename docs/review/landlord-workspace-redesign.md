# ReloHome — nghiệm thu cập nhật Không gian chủ nhà

Ngày kiểm tra: 16/10/2026 (giờ Việt Nam).

## Trạng thái và nền tảng

- Worktree: `/home/doan/Vin/P-044-landlord`.
- Branch: `feat/landlord-workspace-redesign`, mở PR chồng lên PR #170.
- Đây là phần cập nhật tiếp trên PR #170 (`feat/housing-tenant-landlord-handoff`).
- Đã fetch và xác nhận nhánh chứa `origin/main` tại `39786ce` (PR #191).
- Compose, CI, dependency manifests và cấu hình triển khai của main không có thay đổi trên nhánh này.
- Checkout `/home/doan/Vin/P-044` đang chạy dịch vụ được giữ nguyên. Không áp dụng migration lên database đang dùng trong phiên kiểm tra này.

## Các phần cần xem

- Bảy tab của chủ nhà, nền kính xanh light/dark và bố cục desktop/mobile.
- Tổng quan còn ba ô nguồn cung; các ô trạng thái mở đúng bộ lọc.
- Yêu cầu theo nhà/phòng: số lượng lịch, tiền, tin nhắn và xem nhanh phòng.
- Tin đăng mặc định lọc tin đã duyệt, còn trống.
- Lịch xem có trạng thái, đếm ngày và nhắc lịch hôm nay/ngày mai.
- Thống kê có biểu đồ lượt xem, lưu, liên hệ và bảng ngày thu gọn.
- Form phòng: chọn vệ sinh chung/khép kín; tiền cọc, ngày vào ở, điện, nước bắt buộc; phí dịch vụ tùy chọn. Các nhãn và nút lưu phải đọc được ở màn hình 390px.
- Tin bị từ chối, gửi lại khi chưa sửa: mở thông báo yêu cầu bổ sung. Lưu nội dung không đổi giữ nguyên revision, kể cả khi có phí, cọc và ngày vào ở.
- Đánh giá: sao năm cánh, chọn ẩn danh/công khai; tên công khai lấy từ tài khoản ở gateway. Không trả ID tác giả ra browser, kể cả phản hồi ngay sau khi lưu và danh sách kiểm duyệt.
- Kiểm duyệt đánh giá nằm tại `/admin` → **Đánh giá & báo cáo**.

## Điều kiện chạy thật

Phải chạy migration `027_housing_review_anonymity.sql` cùng release trước platform/gateway mới. Migration giữ các đánh giá cũ ở chế độ ẩn danh. Platform health sẽ báo `migration_required` nếu thiếu cột này.

`.env.local` trong worktree chỉ là cấu hình placeholder để build/test. Để nghiệm thu với dữ liệu thật, cấu hình riêng cổng, database và runtime cho worktree này hoặc dùng một đợt chuyển dịch vụ local có chủ đích. Không chỉ mở frontend mới rồi coi đó là đã kiểm thử backend mới; không dùng script database test trên database thật.

Luồng nghiệp vụ và cấu hình dịch vụ tham khảo [kịch bản local](housing-local-test-scenario.md) và [runbook hiện tại](../runbooks/housing-handoff-coolify.md). Trong form mới phải nhập thêm loại vệ sinh, ngày vào ở và điện/nước. Dùng tài khoản chủ nhà, người thuê và Admin ở các profile trình duyệt riêng.

## Lưu ý hành vi

- Khoảng ngày chủ nhà được đề xuất giờ xem thay thế là cấu hình `HOUSING_VIEWING_PROPOSAL_DAYS` (mặc định 7, từ 1–60). Backend (agent API) dùng nó để lọc giờ gợi ý, platform API dùng để kiểm tra, giao diện hiển thị theo số ngày backend trả về. Compose truyền cùng một giá trị cho cả hai dịch vụ.

- Bỏ ô tag tiện ích: tin mới mô tả tiện ích bằng văn bản, nên bộ lọc tiện ích theo tag sẽ không khớp tin mới. Các tag đã có được giữ lại khi sửa.
- Đổi riêng `bathroom_type` vẫn được lưu, nhưng hiện không kích hoạt duyệt lại tin đã công khai.
- Kiểm tra accessibility sau khi hiệu ứng đổi theme hữu hạn kết thúc; không tắt kiểm tra tương phản.
- Venv dùng cho gateway test được tạo riêng trong `/tmp`; không cài lại gateway vào venv đang phục vụ checkout chính.

## Kết quả kiểm tra

- Typecheck web, production build, `lint:ts`, Ruff gateway và `git diff --check`: đạt.
- Database dùng PostGIS disposable, migrate đủ 027: housing-query **65/65**, platform-api **66/66**, location-mcp **7/7**.
- Gateway ở venv riêng: **91 passed, 1 skipped**. Bao gồm kiểm tra ẩn danh/công khai ở GET và PUT; 6 test relocation đã qua khi dùng môi trường đúng.
- Contracts: **46/46**.
- Visual/a11y: bảy tab + form phòng ở light/dark, desktop/mobile: **4/4**. Sau chỉnh riêng form mobile, kiểm tra lại cả hai theme: **2/2**. Không tràn ngang; Axe không báo vi phạm WCAG A/AA trong các trạng thái fixture đã kiểm tra.
- Browser chủ nhà/đánh giá, lượt cuối ở server riêng 5276 và không sửa code trong lúc chạy: **50/50 passed** (desktop + mobile).
- Full browser: **404 passed, 40 failed, 34 skipped** (478 test, 10,4 phút). Lượt này bắt đầu trước khi sửa audit theme và có HMR trong lúc hoàn thiện UI; lỗi review dark đã được xác nhận qua ở lượt cuối 50/50. Các lỗi rộng khác vẫn còn mở, gồm luồng chat/flight/moving, focus bàn phím và launch Chrome trong map-appearance. Hai lỗi ngoài phần chủ nhà đã tái hiện trên HEAD `e7ae652` chưa có diff thiết kế: keyboard tab **Đã lưu** và flight expired-price detail thiếu nút **Về hội thoại**. Không quy toàn bộ lỗi còn lại là lỗi nền khi chưa đối chiếu.

Log và ảnh dùng fixture, lưu dưới `/tmp/relohome-landlord-*`:

- `/tmp/relohome-landlord-housing-verified.log`: lượt chức năng cuối ở server riêng.
- `/tmp/relohome-landlord-database.log`, `/tmp/relohome-landlord-gateway-isolated.log`, `/tmp/relohome-landlord-contracts.log`.
- `/tmp/relohome-landlord-browser.log`: lượt full desktop/mobile (có lỗi và có một số lần HMR trong quá trình sửa; không dùng để tuyên bố full suite đã xanh).
- `/tmp/relohome-landlord-baseline.log`: hai lỗi tái hiện ở HEAD không có diff thiết kế.
- `/tmp/relohome-landlord-visual-fixed/`: ảnh desktop cả hai theme và mobile trước chỉnh chiều rộng form.
- `/tmp/relohome-landlord-visual-mobile-final/`: ảnh mobile cuối cùng của bảy tab và form.
- `/tmp/relohome-landlord-visual-review.source.ts`: fixture kiểm tra bằng ảnh; file tạm đã được dọn khỏi repo.


## Bản test riêng đã chạy

Theo lựa chọn của người dùng, đã dựng bản chạy thật trên http://127.0.0.1:8513/landlord. Người thuê: `/ai`; Admin: `/admin` trên cùng cổng 8513. Dùng tài khoản/mật khẩu local hiện có ở thời điểm sao chép, với profile trình duyệt riêng để không lẫn cookie của cổng 8503.

- PostGIS riêng tại 5554, container `relohome-landlord-preview-postgis`, volume riêng; sao chép 38.239 nhà và 38.251 tin, áp dụng migration 027 chỉ trên bản sao.
- Web 8513 → Platform 4110 / Agent 8010 → Location 4310; toàn bộ source lấy từ worktree này. Accounts, SQLite, khóa, ảnh và Agent runtime được sao chép riêng.
- Health cả bốn dịch vụ mới và bốn dịch vụ gốc đạt; 19 kiểm tra API của chủ nhà/Admin đạt. Browser thật đã mở đủ 7 tab ở desktop/mobile, kiểm tra tổng quan light/dark, không lỗi JavaScript/tràn ngang, và mở tab kiểm duyệt đánh giá của Admin.
- Đã xác nhận database gốc vẫn chưa có cột migration 027. Các phiên smoke tạm trên bản sao đã được thu hồi.
- Bản test bật bỏ chờ giờ xem trong môi trường development, vẫn phải đặt lịch và được chủ nhà xác nhận. Provider writes/payment demo không bật.
- Điều khiển, log và dữ liệu preview nằm ở `/home/doan/Vin/P-044/data/landlord-preview` (đã gitignore), hướng dẫn trong `README.md` ở đó. Không đưa environment, snapshot hoặc khóa vào Git.

Chưa commit/push/PR; giữ bản test đang chạy để người dùng nghiệm thu.
