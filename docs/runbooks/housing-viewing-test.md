# Test lịch xem nhà ngay trên local/staging

Backend hỗ trợ `HOUSING_VIEWING_TEST_VISIT_ANYTIME`. Khi bật trong môi trường
khác production, người thuê có thể ghi kết quả buổi xem ngay sau khi đặt lịch,
không phải chờ đến giờ hẹn. Với nhà do chủ nhà trên ReloHome quản lý, chủ nhà
vẫn phải xác nhận lịch; vẫn cần một lịch đã đặt, quyền sở hữu và trạng thái hợp lệ.
Sau khi ghi nhận đã gặp chủ nhà, người thuê có thể tiếp tục chốt căn.

## Bật trên Coolify staging

Trong Environment Variables của **resource staging**, đặt:

```dotenv
APP_ENV=staging
HOUSING_VIEWING_TEST_VISIT_ANYTIME=true
```

Save rồi redeploy/recreate backend để container nhận environment mới. Chỉ
restart process/container cũ có thể giữ environment trước đó. Release phải chứa
Compose đã truyền biến này vào `backend`; thêm biến vào resource có Compose cũ
chưa đủ. Không cần rebuild image khi đổi giá trị sau khi release này được deploy.

Compose lấy giá trị từ environment của resource, không gán cứng bật test trong
image hoặc code. Nếu biến chưa được đặt, mặc định `false`: kiểm tra giờ hẹn như
cũ. Đặt `false` và redeploy/recreate backend để tắt.

Resource production phải cấu hình `APP_ENV=production`. Runtime luôn bỏ qua cờ
test trong production, kể cả khi biến test bị đặt nhầm `true`. `APP_ENV` cũng
được lấy từ cấu hình resource; default staging giữ tương thích resource hiện có.
Không dùng `VITE_*` cho cờ backend này. Không thay biến/quyền ghi provider.

## Test luồng chủ nhà ↔ người thuê

1. Người thuê chọn tin đã duyệt, còn khả dụng và đặt một lịch xem hợp lệ trong tương lai.
2. Chủ nhà mở inbox, bấm **Xác nhận giờ xem**.
3. Người thuê tải lại tab **Xem nhà**: thấy **Chế độ test: ghi kết quả ngay** và
   các nút kết quả buổi xem, dù giờ hẹn chưa tới.
4. Chọn kết quả đã gặp, sau đó thử **Chốt căn này**.
5. Tắt cờ bằng `false`, redeploy: với lịch chưa đến giờ và chưa ghi kết quả,
   người thuê phải chờ đến giờ hẹn. Cờ không xóa hoặc đặt lại kết quả đã ghi.

Thay đổi chỉ bỏ điều kiện thời gian khi ghi kết quả. Quy tắc chọn slot trong
tương lai, thời gian báo trước, trùng lịch và việc chủ nhà nhận/từ chối giờ hẹn
vẫn áp dụng. Trên local, đặt biến trong file environment đang được launcher dùng
và khởi động lại API; không chỉnh source hay Dockerfile.

## Kiểm chứng

```bash
python -m pytest tests/test_deployment_settings.py tests/test_checkout/test_viewing.py -q
```

Test cấu hình dùng `docker compose config` để kiểm interpolation thực rồi đọc
bằng Settings của backend, không liên hệ Docker daemon/Coolify/provider. Bao gồm
default/tắt, bật staging và cờ `true` trong production vẫn bị vô hiệu. Test runtime
kiểm việc ghi kết quả trước giờ hẹn và production guard bằng clock/DB fixtures.
