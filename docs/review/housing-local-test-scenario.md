# Kịch bản test local: chủ nhà → người thuê → Admin

Bắt đầu bằng một bộ nhà/phòng mới có tiền tố `TEST-CHAT`, và một hội thoại mới của người thuê. Mỗi lượt chỉ chọn một phòng để dễ theo dõi. Chuông chỉ hiển thị cuộc trò chuyện; cập nhật lịch hẹn/chuyển tiền nằm trong chat của yêu cầu đó. Admin xử lý trong các tab của Admin Workspace.

## 1. Chuẩn bị phiên đăng nhập

| Vai trò | Phiên trình duyệt riêng | Địa chỉ |
| --- | --- | --- |
| Chủ nhà | Chrome thường | http://localhost:8503/landlord |
| Người thuê | Chrome ẩn danh | http://localhost:8503/ai |
| Admin | Firefox, Edge hoặc một Chrome profile khác | http://localhost:8504/admin |

Chủ nhà và người thuê dùng hai tài khoản khác nhau. Tài khoản chủ nhà cũng khác tài khoản Admin. Admin dùng tài khoản/mật khẩu local đã cấp. Hai cổng trên cùng hostname vẫn chia sẻ cookie trong một profile; hai cửa sổ ẩn danh Chrome cũng chia sẻ phiên với nhau. Sau khi đổi tài khoản, kiểm tra tên tài khoản ở menu trước khi thao tác. Ctrl+F5 để nạp giao diện mới.

Local đang bật chế độ bỏ chờ giờ xem. Vẫn phải đặt lịch và được chủ nhà xác nhận trước khi ghi kết quả. Dùng một khung giờ khả dụng trong ngày mai, tránh giờ đã qua.

## 2. Chuẩn bị nhà và hai tin đăng — làm một lần

1. **Chủ nhà:** thêm nhà `TEST-CHAT-01`, điền hồ sơ nếu đây là căn đầu tiên của tài khoản. Nhập địa chỉ, chọn gợi ý và xác nhận vị trí trên bản đồ.
2. **Admin:** vào **Người đăng & địa điểm**, xác minh hồ sơ chủ nhà, rồi duyệt địa điểm `TEST-CHAT-01`. Nếu hồ sơ đã xác minh thì tiếp tục duyệt địa điểm. Tài khoản Admin không tự duyệt hồ sơ của mình.
3. **Chủ nhà:** mở nhà này, tạo hai phòng bằng form phòng/tin gộp:

   | Dữ liệu | Phòng A | Phòng B |
   | --- | --- | --- |
   | Mã phòng | `TEST-A` | `TEST-B` |
   | Tiêu đề | `TEST-CHAT-A: xem nhưng không thuê` | `TEST-CHAT-B: xem và thuê` |
   | Diện tích | 25 m² | 25 m² |
   | Phòng ngủ / phòng tắm | 1 / 1 | 1 / 1 |
   | Giá thuê / tháng | 6.000.000 | 6.000.000 |
   | Tiền cọc | 6.000.000 | 6.000.000 |
   | Mô tả | Một mô tả phòng có nội dung | Một mô tả phòng có nội dung |
   | Ảnh | Ít nhất một ảnh JPEG/PNG hợp lệ | Ít nhất một ảnh JPEG/PNG hợp lệ |

4. Lưu nháp trước. Người thuê tìm tin: **chưa được thấy** tin nháp. Chủ nhà mở lại tin và bấm **Gửi duyệt** (hoặc **Lưu và gửi duyệt** ngay trong form).
5. **Admin:** vào **Tin đăng**, lọc **Chờ duyệt**, mở từng tin và duyệt. Người thuê tải lại danh sách và tìm đúng hai tiêu đề trên. Nếu thiếu dữ liệu, sửa các mục giao diện báo thiếu rồi gửi lại.

**Đạt:** hai tin đã duyệt xuất hiện với trạng thái còn trống; hồ sơ được dùng lại khi tạo phòng/căn tiếp theo.

Đánh giá công khai hiện tính theo **Nhà + tài khoản người thuê**. Vì A và B cùng nhà, đánh giá B sẽ cập nhật đánh giá công khai đã viết ở A. Kiểm tra đánh giá A ngay tại bước A7; mỗi buổi xem vẫn giữ kết quả/đánh giá riêng trong lịch sử kế hoạch.

## 3. Phòng A — đã gặp, không đồng ý

| Bước | Người thao tác | Thao tác | Kết quả cần thấy |
| --- | --- | --- | --- |
| A1 | Người thuê | Tạo hội thoại mới, tìm `TEST-CHAT-A`, chọn căn này; vào **Kế hoạch → Xem nhà**, chọn giờ ngày mai và xác nhận lịch. | Trạng thái chờ chủ nhà xác nhận. Chưa có nút ghi kết quả được phép dùng. |
| A2 | Chủ nhà | Vào **Yêu cầu liên hệ**. | Nhà `TEST-CHAT-01` có số đỏ; mở nhà, phòng `TEST-A` cũng có số đỏ. Mỗi yêu cầu chỉ tính một lần dù có nhiều tin nhắn. |
| A3 | Chủ nhà | Bấm chuông, chọn cuộc trò chuyện của người thuê. | Chỉ thấy danh sách chat. Trong chat có dòng đề nghị xem nhà kèm giờ đã chọn. Bấm dòng cập nhật đó để tới đúng yêu cầu của `TEST-A`. |
| A4 | Chủ nhà và người thuê | Chủ nhà gửi `TEST-A: chủ nhà đã nhận lịch`; người thuê trả lời `TEST-A: em xác nhận`. | Hai phía thấy đúng người gửi, đúng nội dung; không lẫn với phòng B. Có thể chờ khoảng 10–15 giây hoặc mở lại chat. |
| A5 | Chủ nhà | Bấm **Xác nhận giờ xem** trong yêu cầu. | Người thuê thấy lịch đã xác nhận và hai nút kết quả xem nhà. Với chế độ test hiện tại có thể ghi kết quả ngay. |
| A6 | Người thuê | Chọn **Đã gặp, không đồng ý**. Chọn 3 sao, nhập `TEST-A: trải nghiệm xem thử`, bấm **Gửi đánh giá và bỏ chọn**. | Phòng A tự rời danh sách đang chọn; lịch hẹn đóng. Không mở bước chốt tiền thuê/cọc. |
| A7 | Chủ nhà | Mở yêu cầu và tab **Đánh giá**. | Yêu cầu đã hủy/đóng; có đánh giá của người thuê. Phòng vẫn còn trống. Có thể **Xóa khỏi hộp thư** cho yêu cầu đã đóng. |

**Điểm kiểm tra thêm:** mở form đánh giá mà chưa chọn sao thì nút gửi bị khóa. Bấm **Quay lại** chỉ đóng form; kết quả chưa được ghi và căn vẫn đang chọn.

## 4. Phòng B — đã gặp, đồng ý và xác nhận tiền

Tiếp tục trong hội thoại test trên, chọn **chỉ phòng B** sau khi phòng A đã bị bỏ chọn.

| Bước | Người thao tác | Thao tác | Kết quả cần thấy |
| --- | --- | --- | --- |
| B1 | Người thuê | Chọn `TEST-CHAT-B`, đặt một giờ khác khả dụng trong ngày mai. | Một lịch mới chờ chủ nhà xác nhận. |
| B2 | Chủ nhà | Mở **Nhà → TEST-B → Yêu cầu**, xác nhận giờ xem. | Người thuê thấy lịch đã xác nhận. Chat của phòng B có cập nhật đúng giờ. |
| B3 | Người thuê | Chọn **Đã gặp, đồng ý**, chấm 4 sao, gửi đánh giá. | Form chốt căn mở ra sau khi đánh giá gửi thành công. |
| B4 | Người thuê | Nhập thuê/tháng `6000000`, cọc `6000000`, ngày dọn vào phù hợp; bấm **Xác nhận chốt**. | Căn đã chốt và xuất hiện nút **Báo đã trả chủ nhà**. |
| B5 | Người thuê | Bấm **Báo đã trả chủ nhà**, nhập `12000000`, ngày trả là hôm nay, lưu. | Chờ chủ nhà xác nhận tiền. Đây là báo cáo thủ công; nhập số liệu test là đủ để kiểm tra luồng giao diện. |
| B6 | Chủ nhà | Mở yêu cầu `TEST-B`, kiểm tra số tiền/ngày trả và bấm **Xác nhận đã nhận tiền**. | Yêu cầu hoàn tất, phòng được đánh dấu **Đã thuê**. |
| B7 | Người thuê | Tải lại kế hoạch; thử tìm phòng B trong tìm kiếm/bản đồ. | Có xác nhận nhận tiền; phòng B rời kết quả cho thuê còn khả dụng. Lịch sử chat/yêu cầu vẫn xem được. |

**Đạt:** không thể ghi kết quả khi chủ nhà chưa xác nhận lịch; không thể chốt trước đánh giá; sau xác nhận tiền, trạng thái ở hai phía khớp nhau.

## 5. Test đổi giờ — một lượt riêng, sau khi hai lượt trên đã rõ

1. Dùng một phòng còn trống, bắt đầu một lịch mới.
2. Chủ nhà chọn **Không nhận giờ này**, đề xuất ít nhất một giờ khác trong 7 ngày tới.
3. Người thuê mở lịch: chỉ chọn được các giờ chủ nhà đã đề xuất còn khả dụng.
4. Người thuê chọn lại giờ; chủ nhà xác nhận. Tiếp tục ghi kết quả như A hoặc B.

## Khi bị lẫn luồng

- Kiểm tra **tên tài khoản**, **mã phòng**, **tiêu đề tin** và **giờ hẹn** trước mỗi nút xác nhận.
- Mỗi lượt dùng một phòng đang chọn; hoàn thành A rồi mới bắt đầu B. Lịch mới dùng giờ mới.
- Nếu thông báo chưa cập nhật, chờ 10–15 giây rồi tải lại đúng trang. Nếu báo mất phản hồi, kiểm tra trạng thái trước khi gửi lại.
- Ghi lỗi theo mẫu: `Vai trò / TEST-A hoặc TEST-B / bước A3 hoặc B6 / kết quả thực tế / kết quả mong đợi`. Ảnh nên gồm tên căn/phòng và trạng thái để đối chiếu.
