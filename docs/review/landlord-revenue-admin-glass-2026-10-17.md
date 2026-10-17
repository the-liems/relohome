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

Sau review PR #225:

- Migration đọc báo cáo cũ an toàn. API cũ nhận ngày dọn vào là chuỗi bất kỳ khớp `YYYY-MM-DD` (ví dụ `2026-02-31`), ép thẳng sang `date` sẽ làm migration lỗi và chặn deploy. Nay ngày không có thật hoặc số tiền không dùng được thì dùng ngày chuyển tiền và giá đang đăng. Cùng kiểm tra này áp dụng khi chủ nhà xác nhận đã nhận tiền, để một ngày sai không làm hỏng bước xác nhận.
- Khoảng thuê chưa bắt đầu (ngày dọn vào ở tương lai) hoặc rỗng không tạo doanh thu, không còn ra số âm.
- Màu của một nhà theo vị trí trong danh sách nhà (5 nhà đầu có màu riêng, còn lại là "Khác"), không đổi theo hạng doanh thu hay kỳ thống kê.

### Bổ sung sau vòng review ngày 17/10/2026

- Xác nhận báo chuyển tiền dùng ngày dọn vào hợp lệ, nếu không có thì dùng `paid_on`. Ngày review chỉ là mặc định cho thao tác đánh dấu thuê thủ công; ngày dọn vào rỗng hoặc sai không còn làm mất doanh thu trước ngày review.
- Kiểm tra riêng từng giá trị trước khi fallback: giá thuê tháng hợp lệ → giá tháng đầu hợp lệ → giá tin đăng. API và backfill dùng cùng thứ tự.
- `calendarDate` loại năm `0000`, dù JavaScript chấp nhận, để tránh lỗi ép kiểu ngày trong PostgreSQL khi chủ nhà xác nhận nhận tiền. Báo cáo cũ vẫn được xử lý bằng ngày chuyển tiền; không đổi API contract.
- Thêm 10 unit test ngày tháng và 6 integration case: ngày không tồn tại, chuỗi rỗng, thiếu ngày, năm 0, giá thuê sai nhưng tháng đầu đúng, cả hai giá thỏa thuận không dùng được. Mỗi integration case đối chiếu kỳ thuê qua API với chính migration trong transaction rollback.
- Đã chạy trước sửa: unit test năm 0 và 4 integration case thất bại đúng lỗi review. Sau sửa: 18 ca doanh thu/ngày tháng đạt. Toàn bộ hai file test Housing/ngày tháng: 29 đạt, còn 1 lỗi revision ở ca lưu draft (`revision=14` thay vì `11`) đã tồn tại trước bản sửa và được ghi nhận trong review; không bỏ test hoặc nới assertion.

Bản sửa bổ sung chỉ thay chuẩn hóa ngày/giá ở Platform API cùng test và tài liệu; không thêm env, không đổi migration 029 và không sửa CI. Migration 029 vẫn là yêu cầu triển khai của tính năng doanh thu trong PR gốc.

Giới hạn: phòng cho thuê trước khi có migration mà không có báo cáo chuyển tiền chỉ được tính từ lần đánh dấu Đã thuê gần nhất. Lịch sử đổi trạng thái trước đó không được lưu nên không dựng lại được.

### PR #230: chặn kỳ thuê chồng nhau

Review tiếp theo xác nhận kỳ thuê mới có thể bắt đầu trùng kỳ đã đóng: thuê từ
01/09, đánh dấu trống ngày 17/10, rồi xác nhận thuê tiếp từ 01/09. API cũ trả 200
và tính tháng 9 hai lần. Hai test API tái hiện lỗi trước sửa; hai test ghi trực
tiếp/đồng thời cũng chứng minh DB cũ chưa chặn khoảng chồng nhau.

- Thêm migration **030_housing_rent_period_overlap.sql**, giữ nguyên checksum 029.
  Ràng buộc PostgreSQL `rent_periods_no_overlap` dùng GiST, `btree_gist` và
  `daterange(starts_on, ends_on, '[)')` theo từng `listing_id`. DB bảo vệ cả INSERT,
  UPDATE và transaction cạnh tranh; vẫn giữ index mỗi tin có tối đa một kỳ mở.
- Ngày kết thúc không thuộc kỳ trước: kỳ mới bắt đầu đúng `ends_on` vẫn hợp lệ.
  Kỳ rỗng vẫn không có doanh thu. Không chuyển ngày người dùng sang hôm nay hoặc
  tự dời sang sau kỳ trước để xác nhận cho qua.
- Vi phạm đúng constraint này trả **409 `rent_period_overlap`**, kèm hướng dẫn
  kiểm tra ngày bắt đầu. Transaction xác nhận báo tiền rollback cả report,
  contact, trạng thái tin và mọi thay đổi kỳ thuê; doanh thu trước đó giữ nguyên.
- 6 regression case: trùng ngày bắt đầu kỳ đóng; bắt đầu trước kỳ đóng; giáp ranh
  hợp lệ; INSERT/UPDATE trực tiếp; hai transaction ghi khoảng đóng chồng nhau;
  migration gặp lịch sử xung đột. Hai ca lỗi API và hai ca lỗi DB đã đỏ trước sửa.
- Sau sửa: 54/55 test trong 7 file Housing đạt; ca còn lại là lỗi revision draft
  có sẵn ở dòng 1089 (`14` thay vì `11`), không nới assertion hoặc bỏ test.
  Platform API build, 36 test gateway và kiểm tra whitespace đạt. Không thay CI hoặc env.

Triển khai phải chạy migration 030 bằng migration runner hiện có trước API mới.
`btree_gist` được tạo bởi role migration, không cấp thêm quyền cho app role.
Migration **dừng** nếu đã có kỳ chồng nhau; không xóa kỳ hoặc tự sửa lịch sử. Trước
rollout có thể kiểm tra bằng tài khoản vận hành DB:

```sql
SELECT a.listing_id, a.id AS first_period, b.id AS second_period,
       a.starts_on, a.ends_on, b.starts_on, b.ends_on
FROM housing.rent_periods a
JOIN housing.rent_periods b ON a.listing_id = b.listing_id AND a.id < b.id
WHERE daterange(a.starts_on, a.ends_on, '[)') && daterange(b.starts_on, b.ends_on, '[)');
```

Nếu có kết quả, đối chiếu thỏa thuận/lịch sử thật và sửa có chủ đích trong quy
trình vận hành trước khi chạy lại migration. Không thay checksum migration đã
áp dụng. Ràng buộc không thay cách tính doanh thu hoặc khôi phục lịch sử bị thiếu.

Tham chiếu thiết kế: [PostgreSQL 16 — range constraints](https://www.postgresql.org/docs/16/rangetypes.html#RANGETYPES-CONSTRAINT)
và [btree_gist](https://www.postgresql.org/docs/16/btree-gist.html).

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
- Test mới cho hai lỗi review: ngày dọn vào tương lai cho doanh thu 0; ngày `2026-02-31` và số tiền không dùng được không làm hỏng xác nhận chuyển tiền lẫn migration (chạy lại migration trên dữ liệu xấu). Đã xác nhận test lỗi với code cũ: migration cũ báo `date/time field value out of range`, phép tính cũ cho doanh thu âm.
- Playwright: thêm ca màu ổn định khi đổi kỳ với 7 nhà.
- Platform API toàn bộ: các test housing và review qua. 5 ca POI/khu vực hành chính lỗi do database tạm không có dữ liệu bản đồ.
- Gateway housing management: 36 qua, thêm kiểm tra chuyển tiếp `landlord/revenue`.
- Playwright toàn bộ: 612 qua, 34 bỏ qua. 2 lỗi ở ca Admin đăng nhập lại (`service-auth.spec.ts`) cũng lỗi trên `main`: fixture trả `{}` cho hàng chờ Admin nên trang Admin sập tùy thời điểm. Đã sửa fixture trả đúng dạng rỗng; chạy lại cả file 2 lần: 26/26 qua.
- Playwright: thêm ca doanh thu (desktop và mobile, có kiểm tra axe). Ca Admin theme tối nay kiểm tra nền kính tối thay vì nền mặc định của trang.
