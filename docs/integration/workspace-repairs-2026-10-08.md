# Bàn giao: map, báo giá, nhiều dịch vụ và so sánh nhà

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Ngày kiểm tra: 08/10/2026. Công việc và acceptance criteria theo
[issue #70](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/70).
Không coi tài liệu này là trạng thái đã merge hoặc đã deploy.

## Quy trình và phạm vi

- Làm trên nhánh riêng, không push thẳng `main`, `mvp` hoặc `QuangDung`.
- Bản nền là `QuangDung@374d38c`; giữ UI, map và Roommate của teammate.
- PR nối tiếp vào `QuangDung` vì [#42](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/42)
  chưa merge. Sau khi #42 merge, retarget sang `main`, kiểm tra lại diff và CI.
- Không kéo toàn bộ các commit tài liệu/data/infra từ nhánh integration vào PR này.
- Không merge, deploy, tạo đơn, thanh toán hay tạo hồ sơ Roommate trong test.
- Không thêm dữ liệu mẫu hay provider giả. Các test live phải bật opt-in.

## Các thay đổi

### Map và Moving

Nguyên nhân mất đường là cả 9 container OSRM local đang dừng, không phải
AhaMove mất khoảng cách báo giá. Đã khởi động lại các engine có sẵn, không
restore/xóa database. Khoảng cách và thời gian từ AhaMove khác với tuyến
tham khảo do OSRM tính; không thay thế hai nguồn cho nhau.

Frontend tải route cùng lúc với bản đồ, lưu tối đa 16 geometry đã kiểm tra
trong bộ nhớ trình duyệt trong 60 giây, keyed theo tọa độ/profile/thành phố.
Không cache giá hay trạng thái đặt đơn. Route lỗi không vẽ đường thẳng giả;
vẫn cho xem báo giá và giải thích lỗi preview. Giới hạn engine local không
phải quy tắc cấm AhaMove chuyển giữa các thành phố.

Form báo giá giữ nguyên trong lúc chờ; cập nhật thread có thẩm quyền trước,
không chờ refresh sidebar. Chọn gói xe rõ ràng dùng typed request, kiểm tra
catalog/provider/budget/plan như cũ, không bắt LLM hiểu lại thao tác trên form.
Lựa chọn để AI đề xuất xe vẫn đi qua Moving LLM, không bị thay bằng keyword.

### Workspace, chat và kế hoạch

`serviceJourney.ts` chọn kết quả theo task/plan/trạng thái thực tế. Các dịch vụ
đều xuất hiện trên thanh điều hướng; dịch vụ chưa đủ thông tin vẫn hiện trong
kế hoạch. Chọn nhà có thể chuyển ngay sang Flight đã có kết quả, không cần
nhắn lại yêu cầu Flight. Người dùng vẫn có thể chuyển lại từng dịch vụ.

Trong chat, các kết quả map/Housing/Flight/Moving thành dòng ngắn có nút mở,
không lặp lại toàn bộ workspace. Sau chọn phương án, backend trả xác nhận
ngắn; mở lại từ kế hoạch. Kết quả lịch sử chỉ đọc khi task không còn trong
plan hiện tại, không gửi action với version cũ để thay lựa chọn.

Sửa hover nút chat: giữ transform căn giữa, không reset vị trí khi hover.
Chuyển workspace có animation ngắn và tôn trọng `prefers-reduced-motion`.

### So sánh 2–4 căn bằng dữ liệu thật

Intake LLM nhận `housing_mode=compare` và `listing_ids` từ những căn đã đọc.
Danh sách tìm gần nhất lưu tối đa 20 cặp ID/nhãn, không coi giá cũ là dữ kiện
hiện hành. Danh sách để so sánh tách khỏi danh sách để chọn một căn.

Planner vẫn là LLM. Housing domain agent có tool `compare_housing`, đọc lại
đúng từng ID qua `get_housing`, đánh giá đủ/thiếu rồi trả bảng có cấu trúc.
Trong mission so sánh không mở tool tìm kiếm mới thay thế các căn người dùng
đang nói tới. ID không quan sát được hoặc số lượng ngoài 2–4 bị từ chối.

Bảng hiển thị giá thuê, cọc, diện tích, giá/m² khi đủ dữ liệu, tiện nghi và địa
chỉ. Giá có cờ chất lượng không được dùng để tính tổng; giá/cọc thiếu là chưa
biết, không phải 0. Thuê tháng đầu + cọc chỉ là phần đã biết, không phải tổng
chi phí cuối cùng. Điện, nước và phí dịch vụ vẫn cần xác minh.

Cập nhật tập căn cần so sánh là cập nhật thao tác đọc có evidence; không bắt
người dùng xác nhận lại việc thêm căn thứ tư. Không tự đổi căn đã chọn, nới
ngân sách, liên hệ chủ nhà, hoặc cho phép đặt dịch vụ.

Câu hỏi có ích để thử tiếp:

- “So sánh 3 căn đầu về giá, cọc và diện tích.”
- “Thêm căn thứ tư của danh sách ban đầu, giữ căn đã chọn.”
- “Thuê tháng đầu và cọc của các căn này là bao nhiêu? Khoản nào chưa biết?”
- “Các căn này có máy lạnh/WC riêng không? Chỉ dùng thông tin có nguồn.”

Chưa nghiệm thu so sánh commute cho 4 căn, tư vấn an ninh/độ yên tĩnh không
có nguồn, hoặc trả lời mọi dạng câu hỏi nhà ở. Không khẳng định các phần đó
đã hoàn chỉnh chỉ vì có bảng so sánh.

### Ghim và vùng tìm kiếm

Địa điểm đã resolve có ghim đỏ. Bán kính quanh điểm được vẽ bằng địa lý cầu;
truy vấn vùng có bounding box hiển thị envelope. Chú thích phân biệt bán kính
đường thẳng, tuyến đi và envelope: rectangle không được gọi là ranh giới hành
chính chính xác. Không gán tọa độ bằng danh sách tên địa danh hardcode.

### Roommate

Local runner tự bật cho API và UI ngoài production; cấu hình `false` tường
minh vẫn được tôn trọng. Production không tự bật. Không cấp quyền moderator
cho tài khoản người dùng. Form khám phá chỉ cần thành phố, các tiêu chí khác
là tùy chọn. Form đăng hồ sơ vẫn cần consent và các trường hợp lệ.

Database Roommate local hiện có 0 hồ sơ active. Dữ liệu nhà không tự biến
thành dữ liệu người ở cùng. UI giải thích trạng thái trống, không tạo người
giả hay tự đồng ý điều khoản thay người dùng.

## Kiểm chứng và phần cần review

Xem [bằng chứng test](../../eval/workspace-repairs-2026-10-08.md).
Hai test trình duyệt thật đã qua; phần đối chiếu CI chưa xanh toàn repo.
Cần chủ Housing/Map/UI review geometry và dữ kiện, chủ graph review thay đổi
Intake/Planner/state, chủ Roommate review cờ bật local và trạng thái trống.
Không dùng kết quả live pass để thay thế CI/review.

Data mới không có match chính xác cho “Bưu điện Trung tâm Sài Gòn” trong lần
kiểm tra này; fuzzy match ra địa điểm khác. Đây là việc bổ sung POI/data,
không được sửa bằng tự nhận kết quả fuzzy là bưu điện hoặc tọa độ hardcode.

## Redis

Chưa thêm Redis. Khi có nhiều worker/container, nó hữu ích cho shared cache
catalog/resolve địa điểm/route với TTL và dataset version. Cache-aside cần
invalidation và fallback nguồn gốc; xem
[hướng dẫn Redis](https://redis.io/docs/latest/develop/use-cases/cache-aside/).
Không cache approval, giá báo mới hoặc trạng thái thanh toán để thay nguồn
có thẩm quyền. Ca báo giá đã đo chủ yếu chờ provider, không chờ LLM: thêm
Redis không tự làm API AhaMove nhanh hơn.

## Chạy lại local

Sau khi cài dependencies, build `Frontend` và có cấu hình DB local hợp lệ:

```powershell
.\scripts\start-local-mvp.ps1
```

Launcher khởi động các container OSRM local có sẵn, kiểm tra schema/readiness,
ghi log riêng và không tự giết process chiếm port. Nếu service đang chạy code
cũ, restart đúng service của project trước khi thử bản sửa mới.

Probe gateway `/health` trong lần sửa này chỉ dành cho local runner: opt-in
`SIU_WEB_LOCAL_HEALTHCHECK=true`, client loopback, không production. Đây là
process probe, không thay readiness DB/build của production ở issue #67.

Cập nhật 09/10: khi ghép `main`, `/health` dùng readiness SQLite của `main`
(container healthcheck; Traefik giữ đường này khỏi domain công khai). Đã bỏ
probe local, biến `SIU_WEB_LOCAL_HEALTHCHECK` và test riêng của nó; readiness
được kiểm ở `Frontend/tests/test_gateway.py`.
