# SPEC-018 — Phạm vi tìm nhà và nhu cầu ghép trọ trên bản đồ

Status: Draft (chờ review yêu cầu, không tự coi là Accepted).
Owner: Khoa. Reviewers đề nghị: QuangDung (Housing/Maps), chủ Roommate và backend/security.
Issue: [#73](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/73).
Dependencies: PR #71 và dữ liệu Housing/Location hiện hành.

## Mục tiêu và phạm vi

Người dùng phân biệt được vùng hành chính thật, vùng tìm theo bán kính và
khung truy vấn. Các dịch vụ cùng hội thoại có thể được mở từ Kế hoạch;
chọn nhà có thể tiếp tục sang dịch vụ đang chờ, nhưng nút quay về chat không
tự mở workspace khác. Chọn phương án không đồng nghĩa đã đặt dịch vụ.

Nhà có hồ sơ công khai đang cần bạn trọ được đánh dấu vàng theo listing ID.
Không suy diễn có người ở ghép từ bookmark, chat, nhà được chọn hoặc kết quả LLM.
Không xác nhận quyền sở hữu/đang cư trú chỉ vì người dùng tự liên kết listing.

Ngoài phạm vi: xác minh cư trú/ownership, dữ liệu quận cũ chưa có, mở giao dịch,
deploy, Redis, sinh thêm người thật hay gán số điện thoại giả.

## Phạm vi địa lý

- Dùng polygon/multipolygon do Location cung cấp khi tìm theo đơn vị hành chính.
  Giữ phần lõm, đảo rời và lỗ polygon; không thay bằng bounding box hay circle.
- Tên và ID lấy từ dữ liệu hiện tại. Ví dụ dataset local hiện có **Phường Cầu Giấy**;
  không gọi đó là ranh giới Quận Cầu Giấy trước đây.
- Nếu không có boundary đúng yêu cầu: báo thiếu boundary, không vẽ boundary giả.
  Yêu cầu nhắc rõ đơn vị cũ không tự đổi sang đơn vị mới chỉ vì gần tên.
- Truy vấn thành phố + khu con đã resolve chỉ dùng ID khu con. Nhiều ID trong
  contract Housing có nghĩa OR; không dùng city OR ward thay cho một ward.
- Với "gần địa điểm": center + radius là phạm vi khoảng cách địa lý, không phải
  quãng đường đi xe. Pan/zoom giữ ràng buộc này; bbox viewport AND radius AND
  các bộ lọc khác. Giao rỗng trả rỗng, không tự nới phạm vi.
- Geometry chỉ yêu cầu khi render. Không gửi toàn bộ tọa độ polygon vào context
  quyết định của LLM.

## Ghép trọ thật và DEMO

### Hồ sơ thật

Người dùng đủ điều kiện Roommate khai `has_room`, tự nhập listing ID, chọn
đồng ý công khai liên kết phòng, lưu và chủ động publish/review như lifecycle hiện có.
Backend đọc listing thật trước khi lưu và publish/resume/reconfirm; không dùng
tọa độ client để tạo vị trí. Nhà vẫn lấy tọa độ/accuracy từ Housing.

Chỉ đánh dấu hồ sơ active, chưa hết hạn, người xem và người đăng còn đủ điều kiện,
không bị block hai chiều hoặc restriction. Pause/resolve/delete/revoke/expiry phải
gỡ nhu cầu khỏi dữ liệu trả về. Nhãn ghi rõ thông tin tự khai, chưa xác minh quyền ở phòng.
Không có room opt-in thì hồ sơ Roommate vẫn hoạt động, nhưng không đánh dấu phòng.

### 100 hồ sơ DEMO được người dùng yêu cầu

DEMO là dataset riêng, không seed vào repository hồ sơ thật hay tạo tài khoản/consent.
Tất cả hồ sơ có prefix `demo_` và tên `DEMO`, không có contact. Tài khoản thật
không được sử dụng namespace này. Discovery thật, requests và contact vault không
đọc dataset DEMO; không cho gửi kết nối đến người giả.

Đúng 100 hồ sơ, 60 minh họa người có phòng và 40 cùng tìm nhà; phân bố ba thành phố
được Location hỗ trợ. Liên kết tới ID nhà thật chỉ minh họa UI, **không có nghĩa có
người DEMO đang ở căn nhà đó**. DEMO hết hạn sau 30 ngày như dữ liệu generate;
không tự gia hạn để giả làm nhu cầu mới.

Chỉ bật bằng cấu hình rõ ràng ở môi trường không production. JSON lưu private,
không nằm trong frontend/public, không commit. Có toggle tách DEMO trên map;
nhãn vàng phải phân biệt người thật/DEMO và cụm nhiều nhà phải nói số nhà có nhu cầu,
không khẳng định mọi nhà chung vị trí đều cần ghép trọ.

## Contract và bảo mật

Nguồn schema chuẩn, không duy trì một bản DTO độc lập trong Markdown:

- `packages/contracts/src/location.ts`: `include_geometry`, `AreaGeometrySchema`.
- `packages/contracts/src/housing.ts`: bbox/center/radius, filter map/search.
- `packages/python/roommate/src/relohome_roommate/models.py`: `RoomPublication`, `RoommateProfile`.
- `apps/agent-api/src/relohome_agent/api/roommate_map.py`: `/roommate/map/rooms`, `/roommate/demo/search`.
- `packages/python/roommate/src/relohome_roommate/demo.py`: dataset/schema và phân tách DEMO.

Gateway lấy actor từ session, không nhận actor do browser khai. Map lookup tối đa
250 listing IDs/lượt, không trả contact/private preferences/tọa độ nhập tùy ý.
Không biến browse DEMO thành chấp thuận điều khoản Roommate. Nếu service lỗi,
thông báo chưa đọc được nhu cầu, không tuyên bố không có nhu cầu.

## Acceptance criteria (giữ mã ổn định)

- AC-01: Khu vực có polygon đúng được vẽ đúng geometry và tên/ID hiện hành.
- AC-02: Không giả circle/bbox/ward hiện tại thành ranh giới district cũ.
- AC-03: Truy vấn khu con không mở rộng sang cả thành phố bằng OR.
- AC-04: Map pan giữ radius và áp dụng viewport AND radius; giao rỗng trả rỗng.
- AC-05: Geometry không vào context LLM chỉ để render; planner/domain agent không bị bỏ.
- AC-06: Dịch vụ ready hiện trước form pending; chọn phương án chuyển tiếp phù hợp,
  Back về chat giữ ở chat; các dịch vụ còn lại mở được từ Kế hoạch.
- AC-07: Sau chọn, chat xác nhận ngắn; bản trả lời cũ vẫn đọc được, không mất trạng thái.
- AC-08: Liên kết phòng cần has_room + explicit opt-in + listing thật được backend đọc.
- AC-09: Ghép trọ thật trên map obey access/block/restriction/lifecycle/expiry; không lộ contact.
- AC-10: DEMO đúng 100 người giả, tách hoàn toàn khỏi tài khoản/hồ sơ/consent/kết nối thật.
- AC-11: DEMO không bật production; dữ liệu private, liên kết Housing chỉ minh họa, hết hạn rõ.
- AC-12: Marker vàng và chi tiết phòng phân biệt thật/DEMO, không suy diễn occupancy.

## Giới hạn và review cần thiết

Opt-in không phải bằng chứng cư trú. Kiểm tra provider diễn ra ở thời điểm save/publish,
không phải cam kết dữ liệu nhà luôn mới. Map lọc các listing đang được Housing trả về.
Trước mở cho nhiều người: review liên kết room ↔ thành phố/khu vực hồ sơ, abuse,
quyền disclosure địa chỉ và hiệu năng truy vấn marker khi repository lớn.

Bằng chứng thực thi và cách chạy: [bàn giao 08/10](../integration/search-scope-roommate-2026-10-08.md).
