# Housing — lịch xem và đánh giá chủ nhà 1–5 sao

Ngày: 09/10/2026 (Asia/Saigon). Nhánh: `feature/housing-landlord-reviews`, từ QuangDung `4a7ed0c`.

## Đã hoàn thành

1. Hủy lịch xem rồi đặt lại cùng timestamp gửi lại yêu cầu cho chủ nhà, kể cả khi request cũ đã đóng. Lịch còn mở đã requested/confirmed/declined vẫn idempotent và giữ câu trả lời.
2. Đánh giá theo mục 14 của [thiết kế](../review/housing-feedback-design.md): mỗi người một đánh giá cho mỗi property, rating 1–5, nhận xét tùy chọn, sửa/rút, điểm trung bình và phân bố sao từ dữ liệu thực.
3. Tác giả phải có contact request trên property; người quản lý không tự đánh giá. Danh tính tác giả không xuất hiện trong response công khai.
4. Chủ nhà trả lời/sửa phản hồi và báo cáo; moderator giữ/ẩn kèm lý do, không xử lý nhà của mình. Sửa/rút/đăng lại không vượt qua trạng thái ẩn.
5. Cờ `repeated_low_ratings` theo số property và tác giả độc lập, cửa sổ thời gian cấu hình; cờ duy nhất theo host, có evidence, xử lý/rà soát và mở lại khi có review thấp mới. Không tự ẩn tin hay thay thứ tự tìm kiếm.
6. Chi tiết Housing có `host_rating`/`host_review_count` optional. Agent nhận điểm tổng hợp, không nhận văn bản đánh giá hoặc danh tính.
7. Giao diện tenant trong Chi tiết nhà; tab Đánh giá của chủ nhà; mục review/flag trong Duyệt tin. Có VI/EN, mobile, dark mode, loading/error/retry và xác nhận rút.

## Dữ liệu và khởi động

- Đã áp dụng migration `018_housing_landlord_reviews.sql` trên PostGIS local. Giữ dữ liệu cũ; không seed điểm sao giả.
- Config mặc định: min count 1, low stars 2, pattern days 90, properties 2, authors 3. `.env` cá nhân không được sửa; defaults được ghi vào `.env.example` và cấu hình deploy/local runner.
- Sau build đã restart Location/Platform/Agent/Web. 6 service local cùng Docker/PostGIS/OSRM vẫn ready.
- Dùng `scripts/start-local-mvp.ps1` hoặc runner `scripts/local-integration.py` để nạp integration config; khởi động uvicorn trực tiếp trong shell thiếu token có thể không bật được Roommate.
- URL: `http://127.0.0.1:8503`, chủ nhà `/landlord`. Review chỉ mở cho tin tự đăng có chủ thể quản lý; tin crawl giữ luồng hiện tại.

## Kiểm chứng

| Gate | Kết quả |
| --- | --- |
| Regression API/Agent/Roommate/Flight/Payment/Checkout/Gateway Python | 620 passed, 2 opt-in live tests skipped |
| Backend contracts + Housing management/reviews trên PostGIS | 54 passed |
| Browser Housing cũ + Reviews mới, desktop/mobile | 18 passed; console page errors, axe, dark mode/English và ảnh UI đã kiểm tra |
| Build frontend/contracts/housing-query/platform/MCP | PASS |
| Gateway → Platform → PostGIS đang chạy thật | Anonymous 401, authenticated review read 200, moderator boundary 403 |
| Health/readiness 6 service | PASS |

Bug lịch xem và Agent projection đã được test đỏ trước khi sửa và test xanh sau sửa. Test review bao phủ RV-01..07, trạng thái ẩn sau rút/đăng lại, tự kiểm duyệt, cờ đã rà soát, mở lại cờ và hết cửa sổ thời gian.

Các 34 lỗi browser legacy ghi trong [audit trước đó](../review/quangdung-housing-validation-2026-10-09.md) nằm ngoài hai task này; không coi toàn bộ suite project đã xanh. Không thay fixture/assertion các ca đó trong lượt này.

## Ranh giới

Bản này hoàn thành đánh giá 1–5 sao ở mục 14. Các ý tưởng Bayes, báo sai chi phí, ML/LLM xử lý phản hồi, tự động ẩn tin/tạm khóa tài khoản ở phần trước của thiết kế vẫn là phần mở rộng. Bộ lọc public text bằng luật không thay thế hàng chờ kiểm duyệt.

Rollback ứng dụng: quay về commit nền và giữ các bảng additive của migration 018; không cần xóa review đã có hoặc reset database. Khi triển khai lên môi trường khác, chạy migration trước reader/UI mới theo [runbook](../runbooks/housing-management.md).
