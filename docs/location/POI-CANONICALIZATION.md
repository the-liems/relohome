# Bộ dữ liệu POI sạch — 04/10/2026

> Historical record: paths, names, commands and measured results below describe the original checkout. For current operation use the [ReloHome location guide](README.md) and [local runbook](../runbooks/local-mvp.md).

Hướng dẫn nhận cả code/dữ liệu housing và đối chiếu nhánh:
[bàn giao QuangDung](../integration/quangdung-changes-and-data-handoff-2026-10-04.md).

## Kết quả và phạm vi

Đã chuyển từ lọc alias khi truy vấn sang **xóa POI trùng trong database**.

| Chỉ số | Trước | Sau |
|---|---:|---:|
| POI active | 152.044 | **131.191** |
| Tổng catalog.places | 190.266 | **169.413** |
| Housing anchors | 38.222 | 38.222 |
| catalog.place_sources | 203.546 | 203.546 |

Đã xóa **20.853** hàng. Raw source/media được giữ, liên kết chuyển về đại diện.
Fingerprint housing, anchors và housing staging không đổi. Không sửa dữ liệu nhà,
.env, Planner, Flight, Payment hay basemap ở bước làm sạch vật lý này.

## Quy tắc giữ và xóa

- Chỉ gộp **tên không rỗng giống nhau** sau trim/lower; không bỏ dấu.
- Phải chung đối tượng OSM gốc và category. area/N quy về way/relation gốc;
  nhóm liên thông chỉ hình thành qua danh tính OSM chung.
- Giữ riêng nếu tên/category/tầng/phòng/chi nhánh mâu thuẫn, tham chiếu housing,
  nhiều hàng đã xác minh hoặc mapping mâu thuẫn.
- Không gộp chỉ vì cùng tên hoặc tọa độ. Tiện ích khác tầng, cơ sở, cổng và trạm
  có thể là thực thể khác nhau. Importer kiểm tra floor/unit/branch khi ghép điểm gần.
- POI không có tên vẫn giữ; không tự đặt tên cho POI.

Còn **9.830 nhóm chưa gộp**: **9.824 thiếu tên**, **6 có metadata tên/tầng/cơ sở
không nhất quán**. Không tự suy đoán để xóa. Đây là số nhóm, không phải số POI.
Các hàng này vẫn tìm kiếm và hiển thị bình thường.

## Schema và tương thích ID

- catalog.places là dữ liệu chính, không tạo bảng POI sạch song song.
- Migration 011 tạo hàm danh tính OSM/index và mapping ban đầu.
- Migration 012 chuyển log cũ vào **geo.import_runs** sẵn có, bỏ
  **catalog.poi_dedup_runs**, bổ sung metadata tương thích ID cũ.
- catalog.poi_aliases chỉ giữ **20.853 ID đã xóa → ID đại diện**, tên/tọa độ cũ.
  Alias không còn hàng vật lý trong catalog.places.
- Search/resolve/map/nearby đọc POI vật lý; đã bỏ lọc alias khi truy vấn.
- get_place(ID cũ) và route trả **ID được yêu cầu và tọa độ cũ**, metadata từ
  đại diện. Agent API _verified_place vẫn chấp nhận ID; không tự đổi pin đã xác nhận.
- Source/media, integration.source_records và geo.poi_staging nối lại đại diện
  trong cùng transaction; payload nguồn giữ nguyên.

## Bộ dữ liệu portable

Từ gốc DEMO_1: **data/poi-clean/2026-10-04/**, không commit dữ liệu vào Git.

| File | Nội dung |
|---|---|
| pois.geojson | **131.191** POI, canonical UUID, tên, loại, tọa độ, địa chỉ, contact, attributes |
| poi-sources.ndjson | **165.324** nguồn của POI, giữ payload gốc; không gồm nguồn nhà |
| legacy-ids.ndjson | **20.853** mapping ID và tọa độ cũ |
| categories.json | Danh mục loại tiện ích |
| manifest.json | Phiên bản, số lượng, quy tắc, thời điểm và SHA256 |

GeoJSON dùng để xem/phân tích. Để dựng lại dữ liệu trên máy khác, chuyển **cả thư
mục**, cài schema và dùng --import-clean; giữ nguyên UUID. Import kiểm tra checksum,
số lượng và tham chiếu; nhập lại idempotent. Nó từ chối ID xung đột với nhà hoặc
nguồn đang thuộc POI khác. Bộ này không chứa nhà, ranh giới hành chính hay graph OSRM.

## Vận hành

Chạy từ Maps VN/LifeFlow với credential admin DB đích cấu hình qua môi trường;
không truyền secret trên command line. Backup trước khi xóa.

```powershell
npm run build
node ../../apps/platform-api/dist/deduplicate-pois.js --install-schema --report reports/poi-dry-run.json

$poiManifest = Get-Content reports/poi-dry-run.json -Raw | ConvertFrom-Json
node ../../apps/platform-api/dist/deduplicate-pois.js --apply --expect-hash $poiManifest.manifest_hash --report reports/poi-applied.json

# rows_to_delete phải bằng 0 sau apply. Thư mục export phải chưa tồn tại.
node ../../apps/platform-api/dist/deduplicate-pois.js --report reports/poi-after.json --export reports/clean-poi

# Chuyển cả thư mục sang máy đích đã cài schema.
node ../../apps/platform-api/dist/deduplicate-pois.js --import-clean reports/clean-poi
```

Apply kiểm tra fingerprint/count housing, anchors, housing staging, source/media
và payload integration.source_records. Chỉ cột liên kết về đại diện được phép đổi;
sai fingerprint thì rollback transaction. Manifest hash thay đổi thì từ chối.
Advisory lock dùng chung importer; các bảng liên quan khóa trong transaction.

Khởi động lại Platform API, Location MCP và Agent API sau build/apply.
Máy khác cần cài schema và xử lý/nhập dữ liệu; pull code chưa đủ.

### Máy đã có snapshot POI cũ

Không nhập thẳng bộ portable khi các ID đã xóa vẫn còn hàng vật lý hoặc nguồn
đang trỏ sang POI khác. `--import-clean` kiểm tra và rollback khi gặp các xung
đột này; nó không tự xóa toàn bộ POI đang có trên máy đích.

Backup DB đích, migrate, build code mới; chạy dry-run/apply bằng manifest của
**chính DB đích** theo lệnh ở trên, rồi mới nhập cả thư mục sạch. Không dùng hash
dry-run của máy DEMO_1 cho DB khác. Nếu DB đích khác snapshot gốc hoặc còn xung
đột sau làm sạch, giữ DB đó để đối chiếu; nhập vào DB phục hồi riêng đã có schema
và ranh giới hành chính. Không xóa nhà hoặc POI khác để ép import chạy qua.

Import giữ UUID từ export và không loại bỏ các POI ngoài export. Tổng 131.191
chỉ khớp khi máy đích dùng cùng nền dữ liệu, không có POI bổ sung riêng.

### Khôi phục

Xóa vật lý **không hoàn tác bằng --rollback hoặc xóa mapping**. Restore backup
đã kiểm chứng vào DB phục hồi rồi chuyển cấu hình ứng dụng. Tránh ghi đè DB đang
chạy và làm mất thay đổi mới sau thời điểm backup.

Backup trước xóa: data/poi-physical-cleanup-20261004/before-physical-cleanup.dump
(**539.190.599 byte**), đã kiểm tra archive và restore đầy đủ trên DB riêng.
SHA256: e15d333b082d0e7897dec55dfafb94dbd42732cadb7032bea5e92db64f066b7b.

Run local: 101940fb-c481-456e-a148-0a6922d59bf3.
Manifest apply: 42d09ba55f71a2a0145b488d08d915bf1def61d1e5d940ea3893f92bb5c51b5a.
Reports/tests: data/poi-physical-cleanup-20261004/.

## Kiểm thử và giới hạn

- **47 test Housing Query đạt** trên fixture riêng: xóa vật lý, ID/tọa độ cũ,
  route, giữ khác tên/category/tầng/phòng, bảo vệ nhà, nối source/media,
  manifest guard, rollback transaction, import và re-import.
- **25 test Platform API đạt** trên bản sao dữ liệu thật đã xóa 20.853 POI;
  bỏ qua 9 test full PBF và 2 test portable cần DB fixture riêng.
- **2 test portable đạt** riêng: export/import giữ UUID/tọa độ cũ, nhập hai lần
  không nhân bản, checksum sai bị chặn trước ghi.
- Build toàn bộ LifeFlow đạt. Không gọi LLM/provider trả phí, đặt xe hay thanh toán.
- Runtime sau restart: UI/Agent/Platform/Location trả 200; writes_enabled=false.
  MCP get ID cũ, Agent _verified_place và OSRM route local thành công; ID/tọa độ
  cũ được giữ. Không còn alias vật lý hoặc alias trỏ tới POI đã mất.
  Checksum toàn bộ export khớp manifest. Chi tiết: runtime-verification.json
  trong thư mục reports local nêu trên.
- Đợt picker trước đã chạy 10 Playwright và 21 Python liên quan; không chạy lại
  frontend ở bước chỉ xử lý dữ liệu này.
- Ba test Python cũ cũng lỗi trên HEAD b7cd0c7: Planner binding, partial ranking,
  housing amenity filter. Lỗi nền thiếu bảng moving.* được khắc phục ở lượt
  khởi động tiếp theo bằng migration 008 có sẵn; API/MCP `/ready` đã 200.
  Chưa nghiệm thu báo giá AhaMove live; xem [cập nhật Moving](../integration/vietnam-map-moving-update-2026-10-04.md).

Gộp OSM không xác minh địa điểm ngoài đời, giờ mở cửa hay cổng xe tới. Nearby/route
mới dùng điểm đại diện nên khoảng cách có thể khác trước; pin cũ giữ nguyên.
Sau đổi phiên bản dữ liệu, bắt đầu lại phân trang tìm kiếm.
