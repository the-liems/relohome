# Roommate Discovery — Implementation checklist

- Plan chi tiết: [plan.md](plan.md).
- Product spec: [roommate-service.md](../docs/ideas/roommate-service.md).
- Feature issue: [#65](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/65).
- Trạng thái: RM-01–31 hoàn tất backend/API/Agent; 169 focused tests pass. Full regression: 503 passed / 29 failed / 80 skipped; 29 lỗi trùng baseline. Frontend RM-32–41 chưa triển khai; RM-42–47/gates phát hành chưa hoàn tất toàn phần. Evidence: [backend checkpoint](../docs/integration/roommate-backend-checkpoint.md). Checklist local, chưa tạo issue con.
- Tick task xác nhận phạm vi task đó đạt; không thay kết quả checkpoint hoặc gate phát hành. Test command/acceptance criteria/file/dependency của từng task nằm trong plan.
- Không triển khai task phụ thuộc trước khi dependency đạt; tests viết/chạy cùng từng task. Phase Tests kiểm tra thêm xuyên lớp.
- Nếu chuyển sang tracker sau này, dùng mã RM cố định và chuyển nguồn tiến độ; không giữ hai checklist chạy độc lập.

## Data model

- [x] [RM-01 — Mô hình hồ sơ và tiêu chí](plan.md#rm-01) — dependency: không có. 53 focused tests pass; evidence và baseline failures: [technical design](../docs/design/roommate-discovery.md#4-evidence-rm-01). Full suite tại checkpoint RM-01: 387 passed / 29 failed / 80 skipped; chưa sửa service legacy.
- [x] [RM-02 — Mô hình request và consent](plan.md#rm-02) — dependency: RM-01. 16 tests mới pass, commit `98a53e6`.
- [x] [RM-03 — Contract nội bộ và projection an toàn](plan.md#rm-03) — dependency: RM-01, RM-02. 4 tests mới pass; foundation tổng 73 pass, G1 reviewed trong technical design.

### CP-01 — sau RM-01–RM-03

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

## Repository/storage

- [x] [RM-04 — Khởi tạo persistence riêng](plan.md#rm-04) — dependency: RM-03.
- [x] [RM-05 — Lưu hồ sơ và quan tâm](plan.md#rm-05) — dependency: RM-04.

### CP-02 — sau RM-04–RM-05

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-06 — Persistence nguyên tử cho kết nối](plan.md#rm-06) — dependency: RM-04, RM-02.
- [x] [RM-07 — Persistence cho block và moderation](plan.md#rm-07) — dependency: RM-04.

### CP-03 — sau RM-06–RM-07

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

## Scoring engine

- [x] [RM-08 — Chuẩn hóa giá trị dùng cho so sánh](plan.md#rm-08) — dependency: RM-01, RM-03.
- [x] [RM-09 — Hard filter hai chiều](plan.md#rm-09) — dependency: RM-08.

### CP-04 — sau RM-08–RM-09

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-10 — Hàm tính từng tiêu chí](plan.md#rm-10) — dependency: RM-08, RM-09.
- [x] [RM-11 — Điều kiện hiện score và xếp hạng](plan.md#rm-11) — dependency: RM-09, RM-10.

### CP-05 — sau RM-10–RM-11

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

## Service layer

- [x] [RM-12 — Quyền dùng Roommate](plan.md#rm-12) — dependency: RM-05, RM-07.
- [x] [RM-13 — Discovery và chi tiết theo quyền](plan.md#rm-13) — dependency: RM-05, RM-11, RM-12.
- [x] [RM-14 — Lifecycle hồ sơ](plan.md#rm-14) — dependency: RM-05, RM-06, RM-12.

### CP-06 — sau RM-12–RM-14

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-15 — Gửi request và cooldown](plan.md#rm-15) — dependency: RM-06, RM-09, RM-12, RM-14.
- [x] [RM-16 — Accept và mở contact](plan.md#rm-16) — dependency: RM-06, RM-12, RM-15.
- [x] [RM-17 — Thu hồi và đổi kênh liên hệ](plan.md#rm-17) — dependency: RM-16.

### CP-07 — sau RM-15–RM-17

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-18 — Block/report và xử lý vi phạm](plan.md#rm-18) — dependency: RM-07, RM-12, RM-14, RM-17.
- [x] [RM-19 — Expiry, inbox và nhắc nhu cầu](plan.md#rm-19) — dependency: RM-14, RM-15, RM-16, RM-18.

### CP-08 — sau RM-18–RM-19

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

## API

- [x] [RM-20 — Composition và feature availability](plan.md#rm-20) — dependency: RM-04, RM-13, RM-19.
- [x] [RM-21 — Guard và API discovery](plan.md#rm-21) — dependency: RM-03, RM-12, RM-13, RM-20.
- [x] [RM-22 — API hồ sơ và quan tâm](plan.md#rm-22) — dependency: RM-14, RM-20, RM-21.

### CP-09 — sau RM-20–RM-22

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-23 — API request, consent và đối soát](plan.md#rm-23) — dependency: RM-15, RM-16, RM-17, RM-19, RM-21.
- [x] [RM-24 — API an toàn và moderator](plan.md#rm-24) — dependency: RM-18, RM-21.

### CP-10 — sau RM-23–RM-24

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-25 — Ảnh hồ sơ riêng tư](plan.md#rm-25) — dependency: RM-14, RM-18, RM-21.
- [x] [RM-26 — Browser gateway Roommate](plan.md#rm-26) — dependency: RM-21, RM-22, RM-23, RM-24, RM-25.

### CP-11 — sau RM-25–RM-26

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

## Agent integration

- [x] [RM-27 — Capability và fixture Roommate](plan.md#rm-27) — dependency: RM-03, RM-11.
- [x] [RM-28 — Subagent discovery không LLM](plan.md#rm-28) — dependency: RM-13, RM-20, RM-27.
- [x] [RM-29 — Intake tiêu chí và định tuyến](plan.md#rm-29) — dependency: RM-01, RM-27, RM-28.

### CP-12 — sau RM-27–RM-29

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-30 — Planner và phản hồi domain](plan.md#rm-30) — dependency: RM-28, RM-29.
- [x] [RM-31 — Không rò dữ liệu từ lịch sử Agent](plan.md#rm-31) — dependency: RM-18, RM-26, RM-28, RM-30.

### CP-13 — sau RM-30–RM-31

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

## Frontend

- [ ] [RM-32 — Typed client và entry quyền dùng](plan.md#rm-32) — dependency: RM-26, RM-31.
- [ ] [RM-33 — Form tiêu chí và danh sách](plan.md#rm-33) — dependency: RM-11, RM-32.
- [ ] [RM-34 — Chi tiết hồ sơ và quan tâm](plan.md#rm-34) — dependency: RM-22, RM-32, RM-33.

### CP-14 — sau RM-32–RM-34

- [ ] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [ ] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [ ] Build frontend và kiểm tra flow liên quan; lưu lỗi console/network và kết quả responsive.

- [ ] [RM-35 — Editor bản giới thiệu riêng](plan.md#rm-35) — dependency: RM-22, RM-23, RM-25, RM-32.
- [ ] [RM-36 — Quản lý nhu cầu và xuất bản](plan.md#rm-36) — dependency: RM-14, RM-19, RM-35.
- [ ] [RM-37 — Form gửi request và consent](plan.md#rm-37) — dependency: RM-23, RM-34, RM-35.

### CP-15 — sau RM-35–RM-37

- [ ] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [ ] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [ ] Build frontend và kiểm tra flow liên quan; lưu lỗi console/network và kết quả responsive.

- [ ] [RM-38 — Inbox và xem liên hệ có thời hạn](plan.md#rm-38) — dependency: RM-19, RM-23, RM-37.
- [ ] [RM-39 — Block/report và moderation UI](plan.md#rm-39) — dependency: RM-24, RM-34, RM-38.

### CP-16 — sau RM-38–RM-39

- [ ] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [ ] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [ ] Build frontend và kiểm tra flow liên quan; lưu lỗi console/network và kết quả responsive.

- [ ] [RM-40 — Navigation và result card Agent](plan.md#rm-40) — dependency: RM-30, RM-31, RM-32, RM-33, RM-34, RM-36, RM-38, RM-39.
- [ ] [RM-41 — VI/EN, responsive và accessibility](plan.md#rm-41) — dependency: RM-40.

### CP-17 — sau RM-40–RM-41

- [ ] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [ ] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [ ] Build frontend và kiểm tra flow liên quan; lưu lỗi console/network và kết quả responsive.

## Tests

- [ ] [RM-42 — Integration vòng đời và cạnh tranh](plan.md#rm-42) — dependency: RM-19, RM-20, RM-26.
- [ ] [RM-43 — Full-stack browser Roommate](plan.md#rm-43) — dependency: RM-26, RM-31, RM-41, RM-42.
- [ ] [RM-44 — Privacy, số lần gọi LLM và chi phí tìm](plan.md#rm-44) — dependency: RM-11, RM-26, RM-31, RM-43.

### CP-18 — sau RM-42–RM-44

- [ ] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [ ] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [ ] Build frontend và kiểm tra flow liên quan; lưu lỗi console/network và kết quả responsive.

## Regression

- [ ] [RM-45 — Hồi quy backend và Agent hiện tại](plan.md#rm-45) — dependency: RM-42, RM-43, RM-44.
- [ ] [RM-46 — Hồi quy frontend toàn bộ service](plan.md#rm-46) — dependency: RM-41, RM-43, RM-45.
- [ ] [RM-47 — Gate phát hành và bàn giao](plan.md#rm-47) — dependency: RM-44, RM-45, RM-46.

### CP-19 — sau RM-45–RM-47

- [ ] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [ ] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [ ] Build frontend và kiểm tra flow liên quan; lưu lỗi console/network và kết quả responsive.

## Gate cuối

- [ ] G1–G9 ở plan đã có bằng chứng tương ứng.
- [ ] AC-01..31 có test mapping và kết quả, không bỏ tiêu chí để rút scope.
- [ ] Backend/gateway/Agent/frontend regression pass; build sạch; không làm thay đổi logic service cũ.
- [ ] Chủ sản phẩm review trước bật service; không tự deploy/push.

## Checkpoint backend hiện tại

- G1–G6 có evidence tại backend checkpoint; các checkbox CP-01–13 phản ánh review/test backend, không thay gate phát hành toàn project.
- RM-42: đã thêm race, expiry/restart, backup/restore xuyên backend; vẫn giữ task tổng pending vì phase tests/regression cuối còn theo plan.
- RM-43/44: có real session ASGI integration, privacy và query-count 10/100/1000; chưa full browser.
- RM-45: đã chạy hồi quy; 29 lỗi baseline còn tồn tại, không tick pass.
- RM-46/47: chưa triển khai/gate chưa đạt. Feature giữ off; chưa push/deploy.
