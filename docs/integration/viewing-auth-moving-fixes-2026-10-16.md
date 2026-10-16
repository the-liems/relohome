# Lịch xem nhà, tiếp tục sau đăng nhập và Moving A/B

Ngày kiểm tra: 16/10/2026, múi giờ Asia/Ho_Chi_Minh. Nền code: main `49ab46a`.

## 1. Khung giờ xem nhà

Theo yêu cầu đã xác nhận, **22:00 là giờ bắt đầu cuối cùng**, không phải giờ buổi xem phải kết thúc.

- Báo trước tối thiểu 60 phút, thay mặc định 120 phút.
- Các giờ bắt đầu từ 08:00 đến hết 22:00, bước 30 phút.
- Chọn giờ sớm nhất trên lưới lịch lớn hơn hoặc bằng `now + 60 phút`.
- Ví dụ lúc 15:33: giờ đầu tiên là 17:00; lúc 21:00 còn được chọn 22:00; lúc 21:01 chỉ còn lịch các ngày sau.
- `HOUSING_VIEWING_DAY_END` hiện được hiểu là giờ bắt đầu cuối cùng, bao gồm chính mốc cấu hình. Nếu một môi trường đã cấu hình riêng, cần kiểm tra ý nghĩa này khi triển khai.
- Không thay số căn tối đa, thời lượng buổi xem, điều kiện chống trùng giờ, thời gian di chuyển hay quyền xác nhận của chủ nhà.
- Lịch ban đầu dùng toàn bộ `viewing.slots`. Sau khi chủ nhà đề xuất lại, `available_slots` vẫn chỉ chứa các đề xuất còn hợp lệ; không mở rộng thành lịch tự do.
- Backend kiểm tra lại khung giờ lúc gửi, tránh gửi giờ đã quá sát sau khi để form mở lâu.

Thiết lập trên service Agent API khi triển khai:

```dotenv
HOUSING_VIEWING_LEAD_MINUTES=60
HOUSING_VIEWING_DAY_END=22:00
```

Đã khởi động lại Agent API local. Kiểm tra API thực lúc thực hiện: HTTP 200; ngày 16/10 có giờ đầu 17:30 và giờ bắt đầu cuối 22:00. Gateway 8503 đang phục vụ bản frontend build mới.

## 2. Đăng nhập đúng thời điểm, giữ thao tác chưa gửi

### Nguyên nhân

1. Xác nhận đặt lịch chưa có kiểm tra tài khoản ở frontend: gửi POST, nhận 401 rồi biến thành kết quả thất bại.
2. Hộp đăng nhập chỉ được mở khi state frontend là khách, nên trường hợp tài khoản đã hết phiên bị bỏ sót.
3. Khung kế hoạch coi thao tác trong portal đăng nhập/thanh toán là click bên ngoài và có thể đóng.
4. Các API đọc riêng tư trả yêu cầu đăng nhập chưa được xử lý thống nhất với API ghi.

### Cách xử lý

- Khách xem được chat, tìm nhà, xem bản đồ; khi xác nhận lịch, lấy báo giá Moving hoặc mở thanh toán thì yêu cầu đăng nhập trước khi gửi thao tác riêng tư.
- Giữ ngày/giờ, danh sách căn, địa chỉ và tọa độ A/B, nội dung form và workspace đang mở qua đăng nhập hoặc đóng hộp đăng nhập.
- Đăng nhập xong **không tự gửi lại POST**. Người dùng phải xác nhận tiếp.
- Lỗi xác thực lúc gửi lịch được đánh dấu `not_sent`, không phải đã lưu hoặc kết quả không rõ.
- Nếu chưa có lịch nào được ghi, giữ bước xem lại. Nếu một phần đã lưu rồi mới hết phiên, giữ kết quả riêng từng căn, chỉ cho tiếp tục phần chưa gửi.
- Giữ cơ chế xử lý kết quả không rõ do timeout/mất kết nối: không tự gửi lại các lịch có thể đã lưu.
- Xử lý yêu cầu đăng nhập cho cả tài khoản hết phiên và API đọc riêng tư; lỗi sai mật khẩu vẫn hiển thị trong form đăng nhập.
- Không sửa cơ chế phân quyền hoặc chuyển quyền thread ở backend. Các kiểm thử gateway/agent xác nhận phiên khách cũ không còn đọc được thread sau khi chuyển quyền.

Các điểm chặn đã kiểm tra: đặt lịch, báo giá Moving, thanh toán, lưu nhà, Roommate, chủ nhà, đọc hồ sơ hành khách. Có kiểm tra sai mật khẩu, hủy đăng nhập, hết phiên khách và hết phiên tài khoản giữa lúc gửi.

## 3. Moving: tìm địa điểm và ghim A/B

### Bằng chứng lịch sử Git

- `git blame -w` và `git show 21fc882:Frontend/src/components/ServiceWorkspaces.tsx` cho thấy `pin()` đã chỉ cập nhật tọa độ, giữ nguyên chuỗi địa chỉ từ lúc form bản đồ được thêm ở commit **`21fc882`**.
- Commit này xuất hiện trên lịch sử first-parent main qua merge **`46c48d6`, PR [#22](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/22)**.
- Handler bỏ ghim trong lịch sử này cũng không đặt lại endpoint đang chỉnh; một lần chạm bản đồ tiếp theo có thể đi vào endpoint khác đang active.
- Các thay đổi sau đó bổ sung tìm kiếm/chuẩn hóa POI và reset gói xe, nhưng hai nhánh chọn trên danh sách và chọn marker vẫn khác cách cập nhật địa chỉ.
- Bằng chứng xác định lỗi tồn tại từ thời điểm trên; không đủ cơ sở kết luận mọi biểu hiện người dùng nhớ là do một PR gần đây gây ra.

### Sửa

- Marker địa điểm và hàng kết quả dùng chung `pin()` để địa chỉ gửi đi khớp địa điểm được chọn.
- Giữ địa chỉ đầy đủ từ chat khi gợi ý chỉ đang làm rõ chính địa chỉ đó. Kết quả tìm kiếm mới thay chuỗi tìm kiếm bằng địa chỉ kết quả.
- Ghim tay tinh chỉnh vị trí cổng, giữ địa chỉ đã nhập; cần có pin cho cả A và B trước khi lấy báo giá.
- `Tìm lại vị trí A/B` đặt đúng endpoint đang chỉnh, giữ endpoint còn lại và bật lại tìm kiếm.
- Có nút `Ghim điểm A/B trên bản đồ`; trên mobile nút thu gọn bảng nhập để có chỗ chạm bản đồ.
- Có thể chọn marker A/B để chỉnh lại; khi chọn endpoint có pin, camera quay lại điểm đó.
- Kết quả tìm kiếm trễ/bị hủy không được ghi đè endpoint khác. Không tìm được địa chỉ thì hướng dẫn tìm cụ thể hơn hoặc ghim tay.
- Giữ cơ chế reset lựa chọn xe/phụ phí phụ thuộc điểm lấy khi tọa độ A thay đổi; giữ lịch chuyển và ghi chú.

## 4. Kết quả kiểm thử

| Nhóm | Kết quả |
| --- | --- |
| Python: checkout, viewing API, guest/claim, gateway guest và tenant-landlord | **119 passed** |
| Chrome: luồng khách, auth, lịch và A/B trọng tâm, desktop/mobile | **32 passed** |
| Chrome sau điều chỉnh giữ địa chỉ đầy đủ: tìm kiếm A/B, kết quả trễ, không có kết quả, gợi ý từ chat và POI | **12 passed** |
| Chrome chạy trên chính bản build tại `127.0.0.1:8503`, desktop/mobile | **12 passed** |
| TypeScript / `npm run build:web` / Ruff các file Python thay đổi | Đạt |
| Health local: gateway, Agent API, Platform, Location MCP, Moving API/MCP, Flight MCP, Payment MCP | Cả 8 HTTP 200 |

Kiểm thử trình duyệt dùng fixture để không gửi lịch/đặt dịch vụ/thanh toán thật. Kiểm tra API khung giờ thực chỉ đọc dữ liệu. Basemap trong một số fixture được thay bằng nền đơn sắc để không phụ thuộc máy chủ tile.

### Hồi quy rộng hơn: chưa phải toàn bộ suite xanh

Lần chạy rộng gồm 162 ca: 150 đạt và 12 lỗi. Trong đó 2 lỗi desktop/mobile là hồi quy rút ngắn địa chỉ từ chat, đã sửa và kiểm thử lại thành công trong nhóm 12 ca A/B ở trên.

Còn 5 nhóm kiểm thử cũ, tổng 10 trường hợp desktop/mobile, nằm trong `app.spec.ts`:

1. `production: moving and flight panes fit narrow, tablet and desktop screens` — không tìm được region chuyến bay.
2. `moving PARTIAL reply opens usable quotes despite housing warnings` — không tìm được workspace/nút chọn báo giá theo kỳ vọng test.
3. `moving stops selecting an expired price while the workspace remains open` — không tìm được nút chọn báo giá.
4. `moving also expires prices in chat cards and flight details` — không tìm được nút quay về hội thoại.
5. `moving quotes open a moving workspace with A/B points and fee details` — không tìm được workspace báo giá.

Đã dựng frontend HEAD `49ab46a` riêng trên cổng 5296 và chạy đối chiếu cả 5 nhóm ở desktop: chúng cũng lỗi trước bản sửa này. Đây là các lỗi hiện hữu cần điều tra tiếp; không sửa assertion, bỏ qua test hoặc thay CI để làm xanh.

### Tái kiểm tra thủ công

1. Mở `http://127.0.0.1:8503/ai`, tải lại trang để lấy bundle mới.
2. Khách chọn căn → chọn giờ xem → xem lại → xác nhận: mở đăng nhập, chưa gửi lịch. Đóng đăng nhập vẫn giữ lịch; đăng nhập xong xác nhận lại mới gửi.
3. Với chủ nhà từ chối và đề xuất giờ khác, tenant chỉ chọn được các giờ đề xuất hợp lệ.
4. Moving: tìm A → chọn bằng marker; chuyển sang B → chọn; tìm lại A rồi ghim trên bản đồ. B không đổi, địa chỉ/tọa độ gửi đi khớp lựa chọn, ngày/giờ và ghi chú vẫn giữ.
5. Thử tương tự trên mobile bằng nút ghim trên bản đồ.

Chưa commit, push hoặc tạo PR trong đợt này. Không thay database hay CI. Các sửa MCP SSE có sẵn từ trước được giữ nguyên, không gộp vào nguyên nhân của ba lỗi này.

## 5. Chọn thêm căn sau khi đã hẹn căn đầu

Tái hiện bằng test: hẹn căn A thành công, chọn thêm căn B trên bản đồ, bấm **Xong, hẹn lịch xem**. Bộ đặt lịch giữ state `result` từ lần gửi A; hàm mở tab chỉ đổi URL nên tiếp tục hiện kết quả cũ, không hiện bộ chọn lịch cho B.

Đã sửa:

- Nút hẹn từ bản đồ và nút Xem nhà trong chat phát một yêu cầu mở lượt đặt lịch mới, kể cả tab đang mở và URL không đổi. Yêu cầu gắn với thread hiện tại.
- Lượt mới ưu tiên các căn đủ điều kiện chưa có lịch. Căn A vẫn trong kế hoạch, giữ ngày/giờ và trạng thái; không tự được đánh dấu gửi lại.
- Bản nháp của căn chưa gửi được giữ; chỉ khi người dùng xem lại và xác nhận thì mới gửi lịch.
- Nếu lần gửi trước chưa rõ kết quả, vẫn hiện bước kiểm tra trạng thái, không vượt qua cơ chế chống trùng.
- Map giữ nguyên mount; không quay về chat, không thay backend/schema hay giới hạn 3 căn.

Kiểm thử: 118 ca browser liên quan lịch xem/đăng nhập qua trên desktop/mobile; 22 ca backend viewing qua. Thêm kiểm thử thực tế chuỗi **hẹn A → chọn B trên map → hẹn B** trên bản build gateway 8503 ở cả hai kích thước: chỉ gửi A và B một lần, lịch A không đổi. TypeScript, production build và `git diff --check` qua.

Phân biệt với trạng thái chốt thuê thật: `agreed`/`reported_paid` vẫn tuân theo điều kiện mở lại thỏa thuận hiện có. Trạng thái **Đã lưu lịch/đã hẹn xem** trong ảnh không phải chốt thuê, nên vẫn được chọn thêm căn trong giới hạn.
