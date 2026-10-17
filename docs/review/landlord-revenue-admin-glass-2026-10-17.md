# ReloHome: doanh thu ước tính cho chủ nhà và giao diện kính cho Admin

Nhánh `feat/landlord-admin-revenue`, tạo từ `origin/main` (`d2bedd0`). Áp dụng hai phần mới trên canvas "Không gian chủ nhà": khối Doanh thu ở board 6 · Thống kê và các board Admin 8a–8h.

## Doanh thu ước tính

Tiền thuê sau tháng đầu không đi qua ReloHome, nên doanh thu là **ước tính**, không phải số tiền đã nhận:

> doanh thu tháng = giá thuê hằng tháng × số ngày phòng ở trạng thái đã thuê trong tháng ÷ số ngày của tháng

- Không bao giờ tính tiền cọc, tiền điện nước thu hộ hay khoản hoàn trả.
- Tháng hiện tại chỉ tính tới hôm nay (giờ Việt Nam).

| Phần | Nội dung |
| --- | --- |
| Migration `029_housing_rent_periods.sql` | Bảng `housing.rent_periods`: mỗi dòng là một khoảng thời gian một tin ở trạng thái đã thuê, kèm giá thuê chụp lại lúc bắt đầu. Mỗi tin chỉ có một khoảng đang mở. |
| Backfill trong migration | Lấy báo chuyển tiền đã xác nhận mới nhất của mỗi tin: ngày dọn vào (hoặc ngày chuyển) và giá thuê trong thỏa thuận. Tin đang cho thuê mà không có báo cáo thì bắt đầu từ lần cuối được đánh dấu đã thuê và dùng giá đang đăng. Tin đã thôi cho thuê thì khoảng đóng ở lần đổi trạng thái gần nhất. |
| Ghi khoảng thuê | Chủ nhà xác nhận đã nhận tiền: mở khoảng từ ngày dọn vào với giá thuê hằng tháng (không lấy cọc). Chủ nhà đổi trạng thái sang Đã thuê: mở khoảng từ hôm nay theo giá đang đăng. Đổi sang Còn trống hoặc Tạm dừng: đóng khoảng hôm nay. |
| API `GET /v1/landlord/revenue?months=3\|6\|12&property_id=` | Trả chuỗi theo tháng và theo nhà, tổng kỳ, kỳ trước cùng độ dài, trung bình tháng, tháng này/tháng trước và số phòng đã thuê trên tổng phòng của mỗi nhà. Chỉ thấy nhà mình quản lý; lọc nhà người khác trả 403. Tin đã xóa ngừng tính từ ngày xóa. |
| Gateway | Thêm `landlord/revenue` vào danh sách đường dẫn được chuyển tiếp. |
| Giao diện `RevenuePanel` | Đặt dưới Thống kê tin đăng:<ul><li>Bộ lọc kỳ và nhà.</li><li>Ba số: tổng kỳ, trung bình tháng, % so với kỳ trước.</li><li>Biểu đồ cột chồng theo nhà. Tối đa 5 nhà có màu riêng, còn lại gom vào "Khác". Màu theo thứ tự nhà trong danh sách, không theo hạng doanh thu. Bảng màu đã kiểm tra phân biệt cho người mù màu ở cả nền sáng và tối.</li><li>Bảng theo tháng.</li><li>Bảng so sánh giữa các nhà.</li><li>Ghi chú cách ước tính.</li></ul> |

Giới hạn: phòng cho thuê trước khi có migration mà không có báo cáo chuyển tiền chỉ được tính từ lần đánh dấu Đã thuê gần nhất. Lịch sử đổi trạng thái trước đó không được lưu nên không dựng lại được.

## Admin dùng giao diện kính như chủ nhà

`landlord/glass.css` áp dụng cho cả `.rh-admin-shell`:

- Nền xanh, header, tiêu đề, thanh tab và các khung dùng kính mờ.
- Màn Ở ghép có thêm khung kính bao quanh.
- Theme tối dùng biến tối có sẵn của chủ nhà.

Cấu trúc và thao tác của các tab Admin giữ nguyên.

## Kiểm tra

- Platform API, test housing trên PostGIS tạm (đã migrate tới 029): 13 qua, gồm test doanh thu mới. Test doanh thu kiểm tra:
  - Giá thuê lấy từ thỏa thuận, không cộng cọc.
  - Tháng trước đủ tiền, tháng này tính theo ngày.
  - Đánh dấu Đã thuê hai lần không tạo khoảng trùng.
  - Đổi sang Còn trống thì đóng khoảng.
  - Lọc nhà người khác trả 403; tham số kỳ sai trả 400.
- Platform API toàn bộ: các test housing và review qua. 5 ca POI/khu vực hành chính lỗi do database tạm không có dữ liệu bản đồ.
- Gateway housing management: 36 qua, thêm kiểm tra chuyển tiếp `landlord/revenue`.
- Playwright toàn bộ: 612 qua, 34 bỏ qua. 2 lỗi ở ca Admin đăng nhập lại (`service-auth.spec.ts`) cũng lỗi trên `main`: fixture trả `{}` cho hàng chờ Admin nên trang Admin sập tùy thời điểm. Đã sửa fixture trả đúng dạng rỗng; chạy lại cả file 2 lần: 26/26 qua.
- Playwright: thêm ca doanh thu (desktop và mobile, có kiểm tra axe). Ca Admin theme tối nay kiểm tra nền kính tối thay vì nền mặc định của trang.
