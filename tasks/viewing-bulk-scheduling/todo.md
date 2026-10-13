# Checklist Xem nhà bulk scheduling

- [x] BVS-01 Eligibility/draft/validation + test
- [x] BVS-02 Serial sender + partial/unknown tests
- [x] Checkpoint: 34 contract tests qua; payload cũ, stop lỗi/unknown
- [x] BVS-03 Wizard slots/review/results
- [x] BVS-04 Card/disclosure/sticky footer + đồng bộ
- [x] Checkpoint: browser fixture giữ map/lịch
- [x] BVS-05 Regression, a11y, responsive, build/handoff

Kết quả: 34 contracts, 52 browser scenarios liên quan qua (50 regression +
2 progress kiểm lại), 2 journal reload/GET kiểm lại qua; build và health local
qua. [Bàn giao](../../docs/integration/viewing-bulk-scheduling-2026-10-12.md).
Chưa push phạm vi bulk vào PR #127; CI của PR đó thuộc checkpoint trước.

- [x] Phản hồi mới: ngày/giờ luôn hiện trên card, bỏ bước Chọn giờ và stepper
- [x] Chọn giờ tự tick, không vượt giới hạn; bỏ tick giữ draft
- [x] 34 regression + 2 ca chọn giờ trực tiếp qua trên desktop/mobile
- [x] Bỏ mục thu gọn và nội dung mở đầu, nới bảng desktop 560px; giữ action cũ
