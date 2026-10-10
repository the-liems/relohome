# Housing query performance

Ngày: 10/10/2026. Baseline sản phẩm: `PERF-MUC1-truy-van-ban-do.md`.

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

- [ ] Read model và trigger; test insert/update/ẩn/xóa/move pin/soft delete/rollback.
- [ ] Query map/search; đối chiếu kết quả gốc và mới, mọi filter/sort/cursor/commute.
- [ ] Giá tương lai/hết hạn/overlap/tie; không cần refresh để đổi giá theo thời gian.
- [ ] Tìm chữ và resolve: chỉ giữ thay đổi có số đo tốt hơn và danh sách tương đương.
- [ ] Build Housing/Platform; chạy test PostGIS của các workspace bị ảnh hưởng.
- [ ] Benchmark cùng DB, cùng request; ghi cả phương án loại bỏ và hướng rollback.

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
không sửa bảng gốc. Nếu tháo read model, dùng rollback riêng sau khi quay về code cũ.
