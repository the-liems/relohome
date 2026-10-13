# CHECKPOINT - POI ingestion v2 cho LifeFlow Map

> Historical record: commands and source paths below describe the original checkout. Use the [current ReloHome location guide](docs/location/README.md) for operation.

> **Checkpoint lịch sử ngày 24/09/2026.** Cập nhật chỉ dẫn 29/09:
> [status dữ liệu](docs/integration/location-data-status.md) phân biệt POI,
> housing anchor, listing và bbox; [status tích hợp](docs/integration/location-service-implementation-status.md)
> ghi 9 tool và test mới. 34.322 là POI trong bbox HCM của báo cáo cũ.
> 9 test POI pass bên dưới thuộc lần chạy 24/09; lần 29/09 bỏ qua 9 test này.

Cập nhật sau thực hiện: 24/09/2026. POI v2 đã được extract, migrate, import,
kiểm tra idempotency và hiển thị theo nhóm trên bản đồ. Phần bên dưới mục
"Ghi chép trước khi thực hiện" là checkpoint cũ, được giữ để đối chiếu.

## Kết quả tại mốc 24/09/2026

- Migration 006 và 007 đã áp dụng. Migration 007 lưu Osmium feature ID của area.
- PBF gốc giữ nguyên: 329120265 bytes, SHA256
  `3B03E0DE5ADD781BB3B68C71FBF651D432C88C534CDA600BEE50C95A3AB5627A`.
- Extracted PBF: 5733150 bytes, SHA256
  `57F6B765D31AF014E726E35614F9D7DC403166D583AF063AF5530C1F812C0FE9`.
- GeoJSON sequence: 49908890 bytes, SHA256
  `CDEBBB5FC83BF53B22F83913854BB9F175F90FA71D4FDED4173DF655DF8842AE`.
- Import thành công: 156276 input = 152206 accepted + 4070 rejected + 0 duplicate.
  Toàn bộ rejected còn lại là `unsupported_category`; không còn reject do OSM ID.
- 31178 area polygon được accepted; Osmium ID `a...` được ánh xạ về way/relation
  gốc, đồng thời giữ feature ID gốc trong payload. Source URL trỏ đúng OSM object.
- Lần import đầu publish 109762 POI; lần sửa area publish thêm 29164. Canonical
  total tại mốc POI v2: 152044. Lần import kiểm tra idempotency publish 0 POI mới
  (run `9f26ec18-5549-4e35-ae57-74279197aeb4`).
- Coverage theo bounding box bản đồ: HCM 34322, Hà Nội 32022, Đà Nẵng 8414.
  Chi tiết 128 hàng city/category và độ đầy đủ name/address/phone/website/
  opening_hours ở `Maps VN/LifeFlow/reports/poi-coverage-v2.json`.
- Truy vấn thực tế ở HCM: hospital 412, supermarket 423, school 2991, gym 94,
  restaurant 3024. Integration test category và radius đều qua.
- Backend build/test qua; 9 integration test POI v2 qua; frontend build/lint và
  Playwright 7/7 qua. Bản đồ tải POI theo nhóm category, giữ routing 3 profile.
- Backup trước import còn nguyên 58323879 bytes. Backup cuối sau import:
  `Maps VN/LifeFlow/backups/lifeflow-post-poi-v2-final-20260924.dump`,
  305663115 bytes, đã đọc được bằng `pg_restore -l`.
- Một import_run trung gian đã failed vì hai source cùng khớp một canonical ID.
  Transaction publish rollback; importer đã được sửa để upsert mỗi canonical ID
  một lần. Giữ failed run/staging làm dấu vết, không cần chạy lại.

Không còn bước bắt buộc của POI ingestion v2. Khi cập nhật PBF ở phiên bản sau,
cần thiết kế quy trình đánh dấu source cũ stale/inactive trước khi triển khai.

## Ghi chép trước khi thực hiện

## Mục tiêu

Mở rộng POI theo luồng:

    Raw PBF -> Osmium extract -> geo.poi_staging -> normalize/deduplicate
            -> catalog.places -> Platform API/MCP/Housing Query -> MapLibre

Không làm Recommendation, custom basemap hoặc rebuild OSRM trong công việc này.

## Repo và dữ liệu phải bảo toàn

- Repo: D:\Demo AI thực chiến, nhánh QuangDung.
- Module: D:\Demo AI thực chiến\Maps VN\LifeFlow.
- PBF gốc: Maps VN\Raw\vietnam-260922.osm.pbf.
- Kích thước: 329120265 bytes.
- SHA256: 3B03E0DE5ADD781BB3B68C71FBF651D432C88C534CDA600BEE50C95A3AB5627A.
- Backup trước POI v2:
  Maps VN\LifeFlow\backups\lifeflow-pre-poi-v2-20260924-212436.dump.
- Backup 58323879 bytes, đã pass pg_restore -l.

Worktree có nhiều thay đổi chưa commit từ routing và POI. Không revert hoặc checkout
đè các thay đổi đó.

## Baseline trước POI v2 (lịch sử)

- Distro Ubuntu-24.04; Osmium 1.16.0 tại /usr/bin/osmium.
- PostGIS container: lifeflow-postgis.
- API: http://127.0.0.1:4100; frontend: http://127.0.0.1:5173.
- 9 OSRM container cho 3 thành phố x 3 profile đã hoạt động. Giữ nguyên routing.
- catalog.places: 13.118 canonical POI.
- catalog.place_sources: 13.118; integration.source_records: 13.118.
- geo.import_runs: 3 trước POI v2.
- catalog.places.geom là geometry(Point,4326); geog là generated geography.
- Raw payload đã giữ trong place_sources.source_payload và source_records.payload.
- Boundary local hợp lệ: hcm, hanoi, danang.
- Baseline: name 9.909; address 4.068; phone 1.812; website 1.105.

Kiến trúc hiện tại phải tái sử dụng:

- catalog.places là canonical place.
- catalog.place_sources nối canonical với nguồn.
- integration.source_records giữ raw/source traceability.
- geo.import_runs ghi mỗi lần import.
- POST /v1/places/search đã lọc text, categories, area, bbox, radius, verified, source.
- findNearby đã dùng ST_DWithin và trả ID, name, category, distance.
- Housing Query đã dùng PostGIS cho nearby.

Không tạo bảng canonical hoặc endpoint trùng lặp.

## File đã tạo nhưng chưa chạy

### Migration 006

File: Maps VN/LifeFlow/database/migrations/006_poi_ingestion_v2.sql

Migration chỉ bổ sung, không drop/truncate:

- thêm accounting/source version vào geo.import_runs;
- thêm opening_hours vào catalog.places;
- mở rộng integration.source_records với OSM identity, source geometry,
  first/last seen, version và status;
- tạo geo.poi_staging cùng indexes;
- seed category healthcare, shopping, education, food, transport, utility,
  lifestyle và accommodation.

### Mapping tập trung

File: Maps VN/LifeFlow/platform-api/src/poi-normalization.ts

Đã có mapping các nhóm yêu cầu và helper parse Osmium ID/address. Cần sửa ngay:
ưu tiên tourism accommodation trước amenity, để hotel có amenity=cafe vẫn là hotel.

### Importer streaming

File: Maps VN/LifeFlow/platform-api/src/import-pois-v2.ts

Đã viết nhưng chưa build/chạy:

- stream GeoJSON sequence theo batch 500;
- hash PBF và artifact;
- stage và account mọi record;
- giữ source geometry, dùng ST_PointOnSurface cho canonical point;
- không bịa name;
- dedup theo OSM identity;
- chỉ match legacy cùng category/name ở khoảng cách rất nhỏ khi có đúng 1 ứng viên;
- flag possible_duplicate nếu chưa đủ tin cậy;
- không overwrite lifeflow_verified;
- upsert canonical/source/source record có truy vết.

### Test và scripts

- Test mapping: platform-api/tests/poi-normalization.test.ts.
- db:import:pois:v2 đã thêm ở package API và root LifeFlow.
- Test mới chưa chạy.
- Migration 006 chưa apply.
- Chưa có POI v2 vào staging/canonical.

## Phần chưa hoàn thành

Một lần apply patch cuối bị lỗi truyền patch, nên các mục sau CHƯA có trong code:

1. Sửa precedence accommodation và thêm regression test.
2. Thêm opening_hours vào Place contract và PlaceService response.
3. Tạo LifeFlow/config/poi-tags-filter.txt.
4. Tạo LifeFlow/Extract-Poi-V2.ps1.
5. Tạo platform-api/src/report-poi-coverage.ts và db:report:pois.
6. Thêm OSM_PBF_PATH, POI_V2_SOURCE_PATH, OSM_SOURCE_VERSION vào env.
7. Cho frontend tải POI theo nhóm category, không tải/render tất cả.
8. Cập nhật README tiếng Việt.
9. Thêm integration test tọa độ, traceability, duplicate, radius, category,
   import accounting.

## Cấu trúc thư mục cần dùng

    Maps VN/
      Raw/vietnam-260922.osm.pbf
      Extracts/POI/vietnam-260922/
        vietnam-pois-v2.osm.pbf
        vietnam-pois-v2.geojsonseq
      Routing/                         giữ nguyên
      LifeFlow/
        config/poi-tags-filter.txt
        Extract-Poi-V2.ps1
        database/migrations/006_poi_ingestion_v2.sql
        reports/

Artifact PBF/GeoJSON lớn đã được root .gitignore bao phủ.

## Filter Osmium cần dùng

    nwr/tourism=hotel,guest_house,hostel,motel,apartment,camp_site,chalet,resort,homestay
    nwr/amenity=hospital,clinic,pharmacy,doctors,dentist,marketplace,school,kindergarten,college,university,restaurant,cafe,fast_food,food_court,bus_station,bank,atm,fuel,parking,charging_station
    nwr/healthcare
    nwr/shop
    nwr/public_transport
    nwr/railway=station,halt
    nwr/highway=bus_stop
    nwr/aeroway=aerodrome,terminal
    nwr/leisure=fitness_centre,sports_centre,park,swimming_pool

Osmium export -f geojsonseq -u type_id đã được thử trên sample. Dòng output có
thể bắt đầu bằng record separator 0x1e; importer đã xử lý. ID n481837735 được
parse thành node/481837735.

## Trình tự tiếp tục bắt buộc

1. Review migration/importer/mapping, sửa precedence accommodation.
2. Hoàn thiện extractor, report, contract/API và test.
3. Chạy npm run build và npm test trong Maps VN/LifeFlow.
4. Chỉ khi pass mới chạy npm run db:migrate.
5. Chạy Extract-Poi-V2.ps1 bằng PowerShell; Osmium chạy trong Ubuntu-24.04.
6. Kiểm tra checksum/count/sample geometry/category của output.
7. Chạy npm run db:import:pois:v2.
8. Xác nhận input = accepted + rejected + duplicate.
9. Sinh coverage HCM/Hanoi/Đà Nẵng theo category và completeness.
10. Test API category/radius/traceability/idempotency.
11. Hoàn thiện frontend category visibility; chạy lint/build/E2E.
12. Tạo backup DB sau import, giữ backup trước import.

## Acceptance cuối

Báo số liệu thật, không ước lượng:

- PBF/checksum;
- raw, staging, accepted, duplicate, rejected, published, canonical total;
- coverage category tại HCM/Hanoi/Đà Nẵng;
- tỷ lệ name/address/phone/website/opening_hours;
- query hospital/supermarket/school/gym/restaurant;
- build/test/E2E;
- xác nhận raw PBF, routing và custom data không bị sửa/xóa.

## Rào chắn an toàn

Không DROP, TRUNCATE, Docker prune, reset DB/Docker, unregister WSL, xóa PBF,
xóa OSRM graph hoặc rebuild routing. Không hard-delete custom/LifeFlow verified
POI. OSM mất ở refresh tương lai thì mark stale/inactive trước.

Lần import v2 đầu tiên không tự stale legacy records vì source ID cũ là hash,
chưa phải OSM identity thật.
