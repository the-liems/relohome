# Housing query performance

Ngày: 10/10/2026. Baseline sản phẩm: ghi chú đo đạc mức 1 (tài liệu nội bộ, không lưu trong repo).

## Contract

- Giữ endpoint, schema, bộ lọc, thứ tự và cursor hiện có.
- Không thay routing, recommendation, Housing/Moving/Flight nghiệp vụ.
- So lượng **truy cập trang** và thời gian riêng; không gọi buffer hit là đọc đĩa.
- Tin ẩn/đã thuê, cập nhật unit/property/place phải hiện trong cùng giao dịch.
- Giá được chọn ở thời điểm truy vấn, kể cả offer tương lai và offer hết hiệu lực.

## Phương án

1. Migration bổ sung `housing.map_points`: chỉ chứa dữ liệu cần lọc/sắp xếp không gian,
   không chứa giá hay payload crawl. Trigger cập nhật theo tin/property/unit/place trong
   cùng giao dịch; không refresh toàn bộ sau mỗi lần chủ nhà sửa tin.
2. Index covering cho việc chọn offer hiện hành theo đúng `valid_from, created_at, id`.
   Giữ offers gốc là nguồn giá, không đóng băng giá trong read model.
3. Gom cụm trực tiếp trên read model. Danh sách/marker lọc và phân trang trước, rồi lấy
   chi tiết đúng các id của trang trong cùng SQL statement/snapshot.
4. Tìm chữ giữ nghĩa `ILIKE` trên từng trường gốc; thêm index đúng biểu thức nếu đo được
   cải thiện. Không chuyển sang full text hoặc bỏ dấu một cách làm đổi kết quả.
5. Không giảm điểm POI hay đổi schema marker. Không bỏ request frontend chỉ dựa trên
   việc hai component có cùng endpoint; chỉ sửa khi xác định đúng request dư.

## Thứ tự và nghiệm thu

- [x] Read model và trigger; test insert/update/ẩn/xóa/move pin/soft delete/rollback.
- [x] Query map/search; parity 24 bộ request, 65 so sánh; integration kiểm tra nearby/commute.
- [x] Giá tương lai/hết hạn/overlap; giữ đúng tie-break gốc; không cần refresh để đổi giá.
- [x] Tìm chữ và resolve: giữ ngữ nghĩa cũ, index đúng biểu thức, có cải thiện đo được.
- [x] Build toàn ReloHome; chạy test PostGIS của các workspace bị ảnh hưởng.
- [x] Benchmark cùng DB, cùng request; ghi cả phương án loại bỏ và hướng rollback.

## Thử nghiệm trước triển khai

Đối chiếu local riêng (38.222 tin, không thay số đo baseline của tác giả):

| Phương án | Kết quả | Quyết định |
|---|---|---|
| Đổi tất cả `current_offers` sang LATERAL trên bảng gốc | Map cả thành phố: 1.103 → 1.972 MiB truy cập trang; warm 266 → 328 ms | Loại bỏ cho truy vấn rộng |
| LATERAL trên vùng nhỏ | Bỏ temp sort nhưng vẫn đọc >100 MiB từ bảng gốc | Chưa đủ; thu hẹp read model trước |

Không bổ sung cache có độ trễ cho giá hay tình trạng phòng ở bước này.

## Triển khai và rollback

Chạy migration mới trước khi chạy code query mới. Role app chỉ đọc read model; trigger
chạy dưới quyền owner với `search_path` cố định. Quay về code query cũ được ngay vì
không sửa bảng gốc. Nếu thật sự cần tháo schema, dùng
`deploy/database/rollbacks/housing_query_performance.sql` **sau** khi quay về
code cũ; thường chỉ rollback code là đủ. Script không nằm trong thư mục migrations
nên không chạy tự động khi deploy.

Từ repository root, với env trỏ đúng database:

```sh
npm run db:migrate --workspace @relohome/platform-api
npm run build
node scripts/relohome/verify-housing-query-performance.mjs 9b2b2db
```

Migration 019 tạo/backfill read model và covering index cho offers. Migration 020 thêm
metadata marker nhỏ và index chọn ảnh. Migration 021 thêm index tìm chữ/resolve.
Migration 022 gọi `unaccent` kèm schema trong `geo.normalize_search`: trigger chạy với
`search_path` cố định nên trước đó một kết nối mới, chưa đọc `catalog.places`, sẽ lỗi khi tạo
hoặc sửa tin. Kết quả hàm không đổi nên các index cũ vẫn dùng được; rollback không cần tháo 022.
Không refresh theo lịch; thay đổi ghi cập nhật read model trong cùng transaction.
Không cần sửa `.env` hay thêm infrastructure. Đợt tạo index/backfill nên chạy trong
cửa sổ triển khai trước khi bật code mới.

## Kết quả cuối trên local

PostgreSQL 16.9, `shared_buffers=128MB`, `work_mem=4MB`, 38.222 tin và 169.413 places.
Đây là lượt xác minh riêng; không thay số đo cloud/baseline trong báo cáo gốc.

Công cụ trong repo chạy READ ONLY, giữ cùng snapshot và cùng schema đã migrate,
đối chiếu code `9b2b2db` với code mới. EXPLAIN đo 3 lần, đảo thứ tự cũ/mới, lấy median.
Do schema mới cũng có lợi cho code tham chiếu, số đo này khác bảng baseline trước migration.

| Query | Truy cập trang cũ → mới (MiB) | SQL median cũ → mới (ms) |
|---|---|---|
| Cụm cả TP.HCM | 1.362,45 → 50,80 | 187,60 → 103,06 |
| Marker Q1, tối đa 500 | 98,80 → 43,34 | 37,99 → 21,82 |
| Danh sách trong khung nhìn | 98,80 → 16,73 | 40,18 → 18,09 |
| Tìm chữ | 332,84 → 26,08 | 274,18 → 28,33 |
| Bán kính 2 km | 345,02 → 25,24 | 79,20 → 22,92 |

- 24 bộ request / 65 so sánh: không khác response sau bỏ `query_id` ngẫu nhiên;
  tọa độ làm tròn 8 chữ số để bỏ nhiễu centroid song song. So cả field, id, thứ tự,
  cursor và số đếm cụm. Script thoát lỗi khi có khác biệt.
- Resolve POI: index normalized-address cũ loại địa chỉ `{}` nên OR không suy ra
  predicate partial index. Index mới giữ cả `{}`; không thay SQL, fuzzy threshold
  hay ranking. Lượt EXPLAIN đối chiếu: 172,81 → 119,45 MiB, đã dùng bitmap trigram.
- 44 test housing-query qua trên DB test riêng; 9 test POI canonical tùy chọn vẫn
  chưa bật như cấu hình cũ.
- Platform: 30 test tự tạo fixture qua trên DB riêng; 12 test cần POI/area import
  qua trên snapshot local. Tổng 42 test qua; 11 test tùy chọn giữ nguyên gate.
  Lượt chạy toàn suite trên DB trống ban đầu có 5 lỗi thiếu dữ liệu tham chiếu;
  cả 5 đã kiểm lại thành công trên snapshot, không xóa data để làm test xanh.
- `npm run test:ci` qua: 37 test contracts; các test Moving live chưa bật (14 test
  giữ nguyên gate), không phát sinh đơn thật. Build toàn bộ workspace qua.
- Test trigger RED trước migration; metadata marker RED trước migration 020;
  GREEN sau migrate. App đọc được read model nhưng không được ghi trực tiếp
  hay gọi các helper SECURITY DEFINER.
- Mutation tạm `valid_from <= now()` thành `>= now()` bị test giá tương lai bắt
  đúng lỗi; source đã khôi phục nguyên vẹn. Không bỏ hay nới assertion.
- Rollback SQL đã chạy trên DB test riêng: bảng gốc giữ nguyên số dòng, chỉ tháo
  schema/index/migration ledger bổ sung. Reapply 019–021 thành công.

## Giới hạn và theo dõi cloud

- Chưa đạt mục tiêu mọi truy vấn dưới 10 MiB/50 ms trong báo cáo; marker 500 điểm
  và cụm toàn thành phố vẫn phải xử lý lượng kết quả cần thiết. Không giảm marker
  hay bỏ filter để đạt số đẹp. Không suy ra mức giảm physical disk từ buffer hits.
- Payload POI lớn và RAM/OSRM là hạng mục riêng; chưa thay contract hoặc frontend
  để cắt dữ liệu. Không bật cache có độ trễ cho giá/tình trạng phòng.
- Sau deploy cần so cùng thao tác với biểu đồ read/IOPS, CPU, RAM và thời gian API
  trên cloud. Các số ở trên là SQL local, không phải kết quả đã deploy.
