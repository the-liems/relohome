# Bàn giao QuangDung: Housing performance và geocode — 10/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## 1. Phạm vi code được bàn giao

Nền code là main `9b2b2db` (merge PR #88). Giữ các thay đổi của nhóm; không rebase
hay force-push lên lịch sử đã được bạn khác cập nhật.

| Commit | Thay đổi |
|---|---|
| `966bc0c` | Retry giờ xem không mở lại yêu cầu chủ nhà đã đóng/hủy; chặn ghi kết quả bằng xác nhận cũ; vẫn cho chủ động đặt lại |
| `4b2fa8d` | Bảng tra cứu Housing gọn, đồng bộ cùng transaction với listing/property/unit/place |
| `56a6ca9` | Lọc/sắp xếp/phân trang trước khi lấy chi tiết; chọn giá theo hiệu lực tại thời điểm truy vấn |
| `2ef8378` | Marker đọc metadata nhỏ, tránh đọc payload crawl và join lại toàn bộ bảng |
| `46614be` | Index và SQL tìm chữ giữ nguyên nghĩa ILIKE; index resolve phù hợp điều kiện thực tế |
| `88687da` | Baseline, benchmark/parity script, hướng dẫn và rollback |
| `5ba82bc` | Bản sửa của nhóm: migration 022 giúp trigger đồng bộ map chạy được trên kết nối DB mới |

Chi tiết quyết định và số đo: [Housing query performance](../design/housing-query-performance.md).
Sửa lịch xem: [Viewing landlord confirmation](../review/viewing-landlord-confirmation.md).

Các file chính:

- `Maps VN/LifeFlow/packages/housing-query/src/housing-service.ts`
- `Maps VN/LifeFlow/packages/housing-query/src/current-offer.ts`
- `Maps VN/LifeFlow/database/migrations/019_housing_map_points.sql`
- `Maps VN/LifeFlow/database/migrations/020_housing_map_display.sql`
- `Maps VN/LifeFlow/database/migrations/021_housing_text_indexes.sql`
- `Maps VN/LifeFlow/database/migrations/022_normalize_search_path_independent.sql`
- `Maps VN/LifeFlow/scripts/verify-housing-query-performance.mjs`
- `Frontend/server.py`, `Frontend/src/components/Viewings.tsx` và regression tests tương ứng

Không đổi request/response schema, filter, cursor, tính giá, scoring hoặc luồng
Housing/Moving/Flight. Không sửa `.env`. Không bật cache có độ trễ cho giá/tình trạng phòng.

## 2. Kiểm chứng và triển khai code

- Performance: 44 test Housing và 42 test Platform qua; 37 test contracts qua.
  Những test live/POI canonical cần opt-in giữ gate cũ; không phát sinh giao dịch thật.
- Parity: 24 bộ request, 65 so sánh với code gốc, không khác kết quả sau loại query_id
  ngẫu nhiên và nhiễu centroid 8 chữ số. So field, id, thứ tự, cursor và số đếm.
- Build toàn bộ LifeFlow qua. SQL rollback đã thử trên DB test riêng, giữ bảng gốc,
  reapply migration thành công.
- Lịch xem: 99 test regression, 6 browser tests desktop/mobile qua; build frontend và lint qua.
- Local đã khởi động 6 service và 9 OSRM. Housing map/search trả 20 kết quả;
  frontend `http://127.0.0.1:8503` trả HTTP 200.

Số đo SQL local, cùng DB/snapshot, median 3 lần:

| Query | Truy cập trang cũ → mới (MiB) | SQL cũ → mới (ms) |
|---|---|---|
| Cụm cả TP.HCM | 1.362,45 → 50,80 | 187,60 → 103,06 |
| Marker Q1 | 98,80 → 43,34 | 37,99 → 21,82 |
| Danh sách trong khung nhìn | 98,80 → 16,73 | 40,18 → 18,09 |
| Tìm chữ | 332,84 → 26,08 | 274,18 → 28,33 |
| Bán kính 2 km | 345,02 → 25,24 | 79,20 → 22,92 |

Đây là lượng truy cập trang, không phải số byte physical disk. Chưa đo lại cloud.
Payload POI lớn và RAM/OSRM vẫn là hạng mục riêng; không cắt marker để làm số đẹp.

Người nhận pull nhánh và chạy từ `Maps VN/LifeFlow`, với env trỏ đúng DB đích:

```sh
npm ci
npm run db:migrate --workspace @lifeflow/platform-api
npm run build
node scripts/verify-housing-query-performance.mjs 9b2b2db
```

**Migrate 019–022 trước khi khởi động code mới.** Migration có backfill/index, nên
chạy trong cửa sổ triển khai. Kiểm tra API tìm nhà/map, cập nhật/ẩn tin, giá hết hạn,
rồi so CPU/RAM/read/IOPS và latency trên cloud với cùng thao tác trong baseline.

Rollback code cũ được ngay vì bảng gốc vẫn giữ nguyên. Thường giữ schema bổ sung;
nếu cần tháo, dùng `database/rollbacks/housing_query_performance.sql` sau khi code cũ
đã chạy, không chạy rollback khi code mới còn đọc map_points.

## 3. Trạng thái data geocode

### Đã áp dụng local và thay ZIP ngày 11/10

Theo yêu cầu áp dụng ngay của người dùng, đã dry-run/apply/verify cả lượt có sẵn
và lượt cuối sau khi quota dùng lại được: tổng 2.902 bản ghi DB, 2.969 tọa độ source
so với checkpoint 08/10. Đã tra đủ 16.371 khóa; không còn pending. Giá, units,
media và POI giữ nguyên. Cổng 8503 và API detail/map đã kiểm dữ liệu mới.
ZIP chung `data/project-data-quangdung-20261008.zip` đã được thay dump và thêm hai
JSONL so sánh; tên file lịch sử giữ nguyên, nội dung là release 11/10.
Xem [bàn giao dữ liệu mới](housing-geocode-live-and-data-handoff-2026-10-11.md).

### Cập nhật lượt toàn nguồn chiều 10/10

Người dùng yêu cầu tra nốt rồi gộp thành hai bản để so sánh. Lượt `whole_source`
đã tra đủ **8.378/8.378 khóa số nhà**. Sau phục hồi cache còn **224 khóa cấp đường**
chưa có lookup theo policy hiện tại; cả ba key gặp HTTP 429. Tác vụ ngừng gọi API
khi hết quota, giữ cache và có supervisor chờ key/quota khả dụng để tiếp tục.

Kiểm tra lại lúc **16:41 ngày 10/10 (Asia/Saigon)** bằng đúng một request mỗi key:
cả ba vẫn trả HTTP 429. Đã ghi cả 3 request kiểm tra vào bộ đếm, tổng 27.391 request
bao gồm pilot. Không reset trạng thái quota hoặc gọi lặp; không có thời điểm reset
được provider xác nhận. Supervisor kiểm ngày/key ở local để resume khi khả dụng.
Con số 225 trong snapshot của job trước cache recovery là cũ; số còn thiếu thực tế
theo task/candidate và policy là **224/16.371** (98,63% đã có lookup).

Trong lượt kiểm tra này đã đồng bộ `origin/QuangDung` đến `fc82a24`, áp migration
022 trên DB local và chạy 3 test tích hợp map_points thành công, gồm test kết nối
mới có search_path cố định. Chạy lại 34 test chuẩn hóa và 2 subtest đều qua.

Sau đó nhóm push tiếp đến `46730bb` (PR #92/CI/MCP và tối ưu truy vấn district).
Đã merge giữ nguyên các commit đó, build toàn bộ LifeFlow qua; regression Housing
trên DB test riêng: **45 qua, 9 POI opt-in giữ skipped**. Test MCP auth TypeScript:
20 qua; Python dedicated MCP/auth: 26 qua. Lượt chạy Housing trên DB ứng dụng bị
trùng ID fixture `district_7_test`, nên chuyển sang DB test có sẵn; không sửa/xóa
record của ứng dụng để làm test qua. Đây không phải kiểm chứng end-to-end toàn
bộ các dịch vụ sau cập nhật mới.

Đầu ra bàn giao dự kiến: `data/housing-handoff/final/01-before-standardization.jsonl`
và `02-after-standardization.jsonl`, kèm manifest/README và ZIP. Chỉ phát hành bản
đầy đủ khi `pending()` kiểm cả số nhà **và policy lookup của đường** bằng 0.
Không lấy `cache-review.completed == total` làm bằng chứng tra hết, vì các bản
`preserve_street_only` offline trước đây vẫn có thể tồn tại trong candidate file.

Supervisor đã được duyệt cho inspect/export/dry-run/đóng gói preview; việc tự động
áp live trước khi người dùng xem pair đã bị automatic approval review từ chối.
Ở checkpoint 10/10, source/DB chưa nhận lô mới. Sau đó người dùng yêu cầu áp
dụng ngay; lô một phần đã được áp và kiểm chứng ngày 11/10 như mục trên.
Xem `data/housing-geocode/active-live-release.json` và báo cáo bàn giao mới.

Sửa export nối lô (`159d72f`): preserve khi evidence mới không khớp hoặc va chạm
phải giữ pin **hiện hành**, không quay lại pin raw trước những lô đã áp. Test RED
tái hiện cả hai trường hợp; GREEN 34 tests và 2 subtests, lint qua. Không đổi backend.

Các số ở phần dưới mô tả checkpoint của lượt shared-pins trước lượt toàn nguồn.

Job resume đã kết thúc **13:37:27, 10/10/2026 (Asia/Saigon)**, `status=complete`.
Scope đang chọn có 8.637 khóa địa chỉ; 7.697 đã có kết quả trước khi resume;
940 khóa còn lại đã tra xong bằng 1.523 request mới, có cache và tổng 120 RPM.
Ba key được nạp từ env, tự chuyển khi cần; giá trị key không nằm trong Git/docs/log.

Kết quả của **940 khóa vừa tra**, chưa phải số tin được cập nhật:

| Quyết định candidate | Số khóa |
|---|---:|
| Có candidate theo số nhà | 116 |
| Có candidate gần đúng cấp đường | 215 |
| Chưa khớp địa chỉ | 241 |
| Chưa khớp đường | 360 |
| Xung đột tòa/block, giữ lại | 2 |
| Dịch chuyển quá xa, giữ lại | 6 |

331 khóa có candidate thuận lợi còn phải qua guard va chạm tọa độ, trạng thái verified,
DB drift, shared anchor và kiểm tra patch. Không suy ra 331 tin chắc chắn sẽ được sửa.
Các phòng hợp lệ trong cùng tòa giữ riêng; không rải pin ngẫu nhiên hay xóa/gộp record.

**Lô 10/10 chỉ ghi cache/candidate theo xác nhận của người dùng; chưa export/apply live.**
`full-run.live_data_applied=true` phản ánh nguồn đã từng áp lô cũ, không chứng minh
lô 10/10 đã áp. JSONL/DB live vẫn là bản đã áp ngày 08/10.

Hoàn tất scope chung pin không phải hoàn tất toàn nguồn: hiện 7.014/8.378 khóa số nhà
đã có quyết định; 1.364 khóa số nhà ngoài phần đã tra vẫn pending. Nhiều trường hợp
chỉ có đường hoặc không khớp cần thông tin bổ sung, không thể gọi là GPS chính xác.

## 4. Dữ liệu chuẩn hóa nằm ở đâu

Các đường dẫn dưới đây tương đối từ gốc repo, **đều là data local được ignore**:

| Đường dẫn | Ý nghĩa / trạng thái hiện tại |
|---|---|
| `data/housing-geocode/housing-original.jsonl` | Input bất biến để resume; không prepare lại trên source live |
| `data/housing-geocode/housing-address-normalized.jsonl` | Chuẩn hóa cấu trúc địa chỉ, chưa đổi tọa độ; bản tạo 05/10 |
| `data/housing-geocode/full-candidates.jsonl` | Kết quả/candidate mới nhất, đã bao gồm lượt 10/10 |
| `data/housing-geocode/full-cache.jsonl` | Cache response đã redacted để không gọi lại API |
| `data/housing-geocode/full-run.json` | Trạng thái/quota/counter của lượt run mới nhất |
| `data/housing-geocode/housing-geocoded.jsonl` | Export đầy đủ 38.930 tin đã áp ngày 11/10; hàng đợi đã tra hết |
| `data/housing-geocode/full-patch.jsonl`, `full-export.json` | Patch/manifest lô cuối đã áp 11/10, cùng version với source và DB; lượt đầu giữ trong release riêng |
| `Maps VN/Data/housing_clean_2026-09-26.jsonl` | Source canonical đã cập nhật 11/10; giữ tên để importer dùng đúng đường dẫn |
| PostGIS `lifeflow`, các bảng Housing và housing anchors trong `catalog.places` | Runtime phục vụ ứng dụng; không tự đổi theo file candidate |

Không lấy `housing-address-normalized.jsonl` ghi đè source canonical: nó chưa có tọa
độ đã được áp ở những lô sau. Checkpoint cũ và metadata của lô 08/10 được giữ riêng.

## 5. Đề xuất gộp data sau khi kiểm tra

**Tách hai đợt:** push/merge code và migration trước; chuẩn bị một đợt data có version
riêng sau. Candidate mới không làm thay đổi yêu cầu triển khai code performance.

1. Lưu snapshot candidate và inventory của lượt đã xong vào một thư mục proposal
   riêng, ví dụ `data/housing-geocode/releases/2026-10-10-proposal/` (chưa tạo trong đợt push này).
   Giữ bản gốc/cache/journal lô trước để rollback; điều chỉnh đường dẫn inventory nếu chuyển máy.
2. `inspect` source và DB hiện tại, rồi `export --allow-partial` cho proposal. Cờ partial
   cần thiết vì toàn nguồn vẫn còn pending ngoài scope chung pin. Lưu checksum, số tin,
   số patch, mức chính xác và các ca phải giữ nguyên. Chạy `dry-run` (rollback),
   chuẩn bị backup source/target rows, review sample và các guard để duyệt kết quả cụ thể.
3. Sau khi proposal được duyệt để áp live, kiểm tra baseline còn đúng rồi chạy
   `apply`, `verify`, `audit-shared-pins`. Không apply ngay lúc đang đọc cache/candidate.
   Công cụ `housing-geocode-apply.py` hiện nối container local `lifeflow-postgis`;
   cloud cần adapter/kết nối đích đúng và baseline của DB cloud, không chạy mù lệnh local.
4. Lô đã verify được **gộp vào source canonical hiện tại và housing anchors trong DB**,
   không tạo một nguồn runtime cạnh tranh. Trigger 019–020 tự cập nhật read model
   trong transaction; không cần refresh materialized view hay đổi code nghiệp vụ.
5. Đưa manifest/checksum/báo cáo vào Git trong commit data riêng. JSONL lớn và gói
   data bàn giao đặt ở kênh lưu trữ dataset hiện có của nhóm; chỉ dùng DVC/storage
   khi remote đã cấu hình. Không đẩy `.env`, keys, private state hay response cache lên Git.
6. Máy đồng đội/cloud nhận đúng version JSONL đã duyệt, áp patch hoặc ingest theo
   [quy trình hiện có](../location/HOUSING-DATA-IMPORT.md), rồi verify.
   Không restore nguyên DB local đè dữ liệu chủ nhà, contact requests, Roommate hay payments trên cloud.

Read model là dữ liệu dẫn xuất của DB đích, không phải artifact cần copy từ máy này sang máy khác.
Nếu import/ingest lại JSONL cũ sau apply sẽ khôi phục pin cũ; luôn giữ source canonical
và DB cùng version. Giá, units, media, IDs và POI phải được bảo toàn.

Runbook: [Housing geocode](housing-geocode-runbook.md),
[lô 08/10](housing-geocode-batch-2026-10-08.md),
[import Housing](../location/HOUSING-DATA-IMPORT.md).
