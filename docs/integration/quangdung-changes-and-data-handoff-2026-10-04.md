# Bàn giao QuangDung: code, POI và housing — 04/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## 1. Nền đối chiếu và phạm vi

- Working branch: **QuangDung**. Nền trước thay đổi: **b7cd0c7af728c2921ba4f1c4b1cdfb7d1d77a9b9**.
- Đã đọc remote ngày 04/10: `origin/khoa` = `b7cd0c7`; `origin/mvp` = **e59e5c9**.
- MVP mới có thêm dọn artifact, compact boundary và city catalog/DVC; `b7cd0c7`
  là tổ tiên của MVP mới. Bàn giao này không merge các commit MVP mới vào source local.
- Remote QuangDung trước push ở `41d9511`; nền local đã kế thừa các cải tiến agent/UI
  qua `b7cd0c7`. Người đang dùng QuangDung cũ cần lấy cả lịch sử commit mới, không
  chỉ copy vài file của đợt 04/10.
- **48 file cần commit so với b7cd0c7: 26 file sửa + 22 file mới**, gồm **27 file
  code/cấu hình/migration, 8 file test và 13 file Markdown**. Không có file xóa.
- Dữ liệu đã đổi trên local nằm ngoài Git: bộ POI portable và JSONL housing.
  Pull code không tự cập nhật các bảng dữ liệu trên máy khác.

MVP mới và đợt sửa local cùng chạm hai file tài liệu: `Frontend/README.md`,
`Maps VN/LifeFlow/README.md`. Khi ghép vào MVP, giữ đường dẫn ảnh mới
`docs/design/references/` và hướng dẫn city catalog/DVC của teammate, đồng thời
giữ các mục POI/Moving mới. Hai file cùng sửa không có nghĩa chắc chắn merge conflict;
không copy đè toàn bộ README từ bản cũ lên MVP mới.

## 2. Có thay logic không?

**Có, nếu xét toàn bộ thay đổi từ nền khoa**, không chỉ lượt sửa giao diện cuối.

| Phần | Thay đổi |
| --- | --- |
| Frontend | Gợi ý không lặp ID/alias, nhãn địa điểm rõ loại/thành phố, camera Việt Nam, Moving vẽ geometry OSRM và hai ô A/B tự tìm |
| Backend Location/POI | Làm sạch vật lý, bảo vệ POI khác tầng/tiện ích, nhãn tìm kiếm, tương thích ID/tọa độ cũ, importer và export/import bộ sạch |
| Map subagent | Chỉ xem hai biểu diễn là cùng địa điểm khi chung đối tượng OSM/category; không gộp tùy tiện hai trạm/cổng cùng tên ở gần nhau |
| Moving subagent | Không tự coi một kết quả exact duy nhất là điểm dừng xe đã xác nhận; giữ yêu cầu người dùng xác nhận pin |
| Housing | Chuẩn hóa dữ liệu room/studio 0 → 1 theo yêu cầu; không sửa logic housing importer |
| Khởi động Moving | Áp dụng migration 008 có sẵn do DB local thiếu 5 bảng; không sửa source dịch vụ Moving/AhaMove |

Planner, Intake, scheduler, Flight, Payment, gateway và `.env` không có diff ở
đợt này so với `b7cd0c7`. Riêng lượt sửa camera Việt Nam và hai ô A/B chỉ đổi source
frontend; các thay đổi backend ở trên thuộc đợt POI trước đó.

## 3. Danh sách đầy đủ file cần nhận qua Git

**M** = sửa file đã có; **A** = file mới, phải đưa vào commit cùng các file dùng nó.
Các đường dẫn tính từ gốc repo.

### 3.1. Frontend — 9 file source

| Trạng thái | File | Nội dung |
| --- | --- | --- |
| M | `Frontend/src/App.tsx` | Gộp lựa chọn POI theo ID/alias trong chat |
| M | `Frontend/src/components/MapPanel.tsx` | Dùng camera chung, fit/focus và map phóng lớn |
| M | `Frontend/src/components/MapWorkspace.tsx` | Camera workspace nhà và lựa chọn POI không lặp |
| M | `Frontend/src/components/ServiceWorkspaces.tsx` | Tuyến OSRM Moving, gợi ý tìm ngay trong hai ô A/B |
| M | `Frontend/src/components/WorkspaceChat.tsx` | Lựa chọn POI không lặp trong chat nhỏ |
| M | `Frontend/src/styles.css` | Bố cục hai ô A/B và danh sách gợi ý |
| A | `Frontend/src/mapScope.ts` | Khung camera Việt Nam, tách khỏi vùng phục vụ OSRM |
| A | `Frontend/src/movingRoute.ts` | Lấy GeoJSON OSRM tham khảo, không vẽ đường thẳng thay thế |
| A | `Frontend/src/placeCandidates.ts` | Gộp ID/alias, giữ pin cũ; không gộp nhà cùng tên/tọa độ |

### 3.2. LifeFlow — 13 file source/cấu hình

| Trạng thái | File | Nội dung |
| --- | --- | --- |
| M | `Maps VN/LifeFlow/package.json` | Lệnh làm sạch POI |
| M | `Maps VN/LifeFlow/platform-api/package.json` | Entrypoint làm sạch trong workspace |
| M | `Maps VN/LifeFlow/packages/contracts/src/location.ts` | Bổ sung display_name, city, alias_ids |
| M | `Maps VN/LifeFlow/packages/housing-query/src/index.ts` | Export API làm sạch POI |
| M | `Maps VN/LifeFlow/packages/housing-query/src/location-service.ts` | Nhãn/alias cho search và resolve |
| M | `Maps VN/LifeFlow/packages/housing-query/src/place-service.ts` | Get ID đã xóa vẫn giữ ID/tọa độ cũ |
| M | `Maps VN/LifeFlow/packages/housing-query/src/route-endpoint-service.ts` | Route bằng ID cũ vẫn đúng pin |
| M | `Maps VN/LifeFlow/platform-api/src/import-pois-v2.ts` | Danh tính OSM, tránh nhập lại duplicate, giữ tầng/cơ sở khác nhau |
| A | `Maps VN/LifeFlow/packages/housing-query/src/poi-canonicalization.ts` | Preview/apply xóa vật lý và kiểm tra dữ liệu ngoài phạm vi |
| A | `Maps VN/LifeFlow/packages/housing-query/src/poi-label.ts` | Tên hiển thị loại/địa giới |
| A | `Maps VN/LifeFlow/platform-api/src/clean-pois.ts` | CLI dry-run/apply/export/import |
| A | `Maps VN/LifeFlow/platform-api/src/deduplicate-pois.ts` | Entrypoint dùng cùng pipeline |
| A | `Maps VN/LifeFlow/platform-api/src/poi-dataset.ts` | Bộ portable, checksum và giữ UUID/ID cũ |

### 3.3. Migration, adapter agent và script — 5 file

| Trạng thái | File | Nội dung |
| --- | --- | --- |
| A | `Maps VN/LifeFlow/database/migrations/011_poi_canonical_identity.sql` | Danh tính OSM, mapping và index |
| A | `Maps VN/LifeFlow/database/migrations/012_poi_physical_cleanup.sql` | Mapping ID đã xóa; log về geo.import_runs; bỏ bảng log dư |
| M | `src/agents/subagents/services/location.py` | Không gộp điểm gần chỉ vì cùng tên; ưu tiên nhãn backend |
| M | `src/agents/subagents/services/moving_llm.py` | Kết quả exact duy nhất vẫn cần xác nhận pin |
| A | `scripts/normalize-housing-room-bedrooms.py` | Dry-run/apply chuẩn hóa room hoặc studio, backup và kiểm fingerprint |

Migration **008_moving_service.sql không thay đổi**; đã có trong nền nhưng cần
áp dụng trên DB còn thiếu schema. Giữ cả 011 và 012 theo thứ tự lịch sử;
không xóa 011 dù 012 đã hợp nhất bảng log.

### 3.4. Test — 8 file

| Trạng thái | File |
| --- | --- |
| M | `Frontend/tests/browser/app.spec.ts` |
| A | `Frontend/tests/browser/map-scope.spec.ts` |
| A | `Frontend/tests/browser/poi-candidates.spec.ts` |
| A | `Maps VN/LifeFlow/packages/housing-query/tests/poi-canonicalization.integration.test.ts` |
| M | `Maps VN/LifeFlow/platform-api/tests/api.integration.test.ts` |
| A | `Maps VN/LifeFlow/platform-api/tests/poi-dataset.integration.test.ts` |
| M | `tests/test_agents/test_map_workspace.py` |
| A | `tests/test_agents/test_poi_moving_confirmation.py` |

### 3.5. Markdown — 13 file

| Trạng thái | File |
| --- | --- |
| M | `Frontend/README.md` |
| M | `Frontend/tests/README.md` |
| M | `Maps VN/LifeFlow/README.md` |
| M | `Maps VN/LifeFlow/docs/HOUSING-CRAWL-PLAYBOOK.md` |
| M | `Maps VN/LifeFlow/docs/HOUSING-DATA-IMPORT.md` |
| A | `Maps VN/LifeFlow/docs/POI-CANONICALIZATION.md` |
| M | `docs/runbooks/local-mvp.md` |
| M | `docs/integration/agent-handoff-khoa-2026-10-03.md` |
| A | `docs/integration/location-data-quality-plan-2026-10-04.md` |
| A | `docs/integration/mainland-map-moving-studio-update-2026-10-04.md` |
| A | `docs/integration/map-housing-osrm-audit-2026-10-04.md` |
| A | `docs/integration/vietnam-map-moving-update-2026-10-04.md` |
| A | `docs/integration/quangdung-changes-and-data-handoff-2026-10-04.md` |

## 4. Dữ liệu phải gửi riêng

Có thể gửi **một ZIP**: `data/handoff-quangdung-20261004.zip`.
Giải nén tại gốc repo của teammate, giữ đúng cấu trúc dưới đây. Gói chỉ chứa dữ
liệu POI/housing và hướng dẫn, không chứa `.env`, DB account, checkpoint hoặc key.

ZIP đã được tạo và kiểm tra CRC: **74.247.515 byte** (khoảng 70,81 MiB).
SHA256 ZIP:
`0e4f49ad2a49027d53cff646bd44b8becbe065ac62eb8c2df05cafc5dc76d051`.
File đối chiếu: `data/handoff-quangdung-20261004.zip.sha256`.

```text
data/poi-clean/2026-10-04/
  pois.geojson
  poi-sources.ndjson
  legacy-ids.ndjson
  categories.json
  manifest.json
  README.md
Maps VN/Data/housing_clean_2026-09-26.jsonl
```

| Bộ | Số lượng / kích thước nguồn | Vai trò |
| --- | --- | --- |
| Toàn bộ thư mục POI | 186.912.947 byte, khoảng 178,25 MiB | 131.191 POI, 165.324 nguồn, 20.853 ID cũ; manifest kiểm checksum |
| JSONL housing | 38.930 dòng; 171.340.323 byte, khoảng 163,40 MiB | Room/studio đã chuẩn hóa và metadata nguồn; local DB publish 38.222 unit |

Housing SHA256:
`95c92c1e56046f9f8e7953ff5f0e9c879ff75e3a6b5b14bbb5f6fd1b895953fd`.
Checksum từng file POI nằm trong `manifest.json`; đã kiểm lại cả 4 checksum khớp.

Giữ cả các sidecar POI, không chỉ gửi `pois.geojson`. Hai bộ trên không chứa ranh
giới hành chính hoặc graph OSRM; teammate dùng lại snapshot boundary và graph
HCM/HN/Đà Nẵng đang có, hoặc dựng theo runbook city/DVC của MVP mới.

Housing không được dedup tin nhà. Đã đổi 8.840 dòng room và 1.521 dòng studio
0 → 1; DB tương ứng 8.795 room và 1.521 studio. Còn 1.084 room = 0 cần review,
không đổi hàng loạt. Không gửi backup trước chuẩn hóa để dùng làm nguồn hiện hành.

## 5. Teammate lấy code rồi chạy

### 5.1. Nhận code

Nếu teammate đang ở **QuangDung**, cập nhật nhánh đó bằng:

```powershell
git fetch origin
git pull --ff-only origin QuangDung
```

Nếu teammate đang phát triển trên **mvp/khoa hoặc nhánh riêng**, giữ các commit
đang làm và ghép nhánh QuangDung vào nhánh của mình bằng merge thông thường:

```powershell
git fetch origin
git merge origin/QuangDung
```

Không reset hard/force-push để nhận bộ sửa. Người dùng MVP mới cần giữ các cải
tiến city catalog/DVC và di chuyển ảnh đã có trên nhánh đó. Gói bàn giao không
tự ghi đè cấu hình/key riêng của từng máy.

### 5.2. Build và migration

Từ gốc repo, với Python environment/Docker/key riêng đã được cấu hình:

```powershell
Set-Location 'Maps VN/LifeFlow'
npm ci
npm run build
Set-Location ../..
.venv/Scripts/python.exe scripts/local-integration.py migrate
```

Nếu dùng cấu hình LifeFlow độc lập, chạy `npm run db:migrate` trong LifeFlow thay
runner integration. Hai cách phải trỏ **cùng DB đích**, không tạo DB khác vô tình.
Migration bỏ qua các bản đã áp dụng; cần **011 + 012**, và **008** nếu Moving thiếu bảng.

### 5.3. Nhận POI — phân biệt DB mới và DB cũ

**DB chưa có POI**: sau schema và ranh giới hành chính, nhập bộ sạch trực tiếp.

**DB đã có POI cũ**: backup DB đích, chạy dry-run và đọc số lượng/nhóm giữ lại.
Apply dùng hash của báo cáo trên **máy đích**, rồi mới import bộ gửi kèm:

```powershell
Set-Location 'Maps VN/LifeFlow'
node platform-api/dist/deduplicate-pois.js --report reports/poi-target-dry-run.json

# Chỉ sau khi đã kiểm tra báo cáo dry-run của DB đích:
$targetPoiReview = Get-Content reports/poi-target-dry-run.json -Raw | ConvertFrom-Json
node platform-api/dist/deduplicate-pois.js --apply --expect-hash $targetPoiReview.manifest_hash --report reports/poi-target-applied.json

# DB mới/đã sạch: nhập đầy đủ sidecar, giữ UUID của bộ xuất.
node platform-api/dist/deduplicate-pois.js --import-clean ../../data/poi-clean/2026-10-04
```

Không lấy manifest hash dry-run của DEMO_1 để apply trên DB khác. Import không
tự xóa các POI ngoài bộ xuất, và sẽ rollback nếu ID nguồn/alias xung đột với
POI/housing trên máy đích. Snapshot khác phải đối chiếu hoặc dùng DB phục hồi
riêng; không ép xóa các bản ghi mới của teammate. Tổng 131.191 chỉ khớp khi cùng
nền dữ liệu, không có POI bổ sung riêng.

### 5.4. Nhận housing đã chuẩn hóa

Giữ bản file cũ trước khi giải nén. Kiểm SHA256 của file mới, rồi dùng importer
hiện có trên đúng DB đích (từ `Maps VN/LifeFlow`):

```powershell
$env:HOUSING_SOURCE_PATH = (Resolve-Path '../Data/housing_clean_2026-09-26.jsonl').Path
$env:HOUSING_SOURCE_VERSION = 'housing-clean-2026-09-26-room-studio-normalized-2026-10-04'
node platform-api/dist/import-housing.js
```

Chỉ chép JSONL chưa cập nhật DB đang được API dùng; phải import và đọc báo cáo
`geo.import_runs`. Importer bảo vệ tin đã xác minh; số publish có thể khác nếu
máy đích có trạng thái/data mới riêng. Không cần chạy script chuẩn hóa lại trên
JSONL đã nhận; script chỉ để xử lý nguồn mới có review/dry-run.

### 5.5. Build UI và restart

```powershell
Set-Location ../..
Set-Location Frontend
npm ci
npm run build
Set-Location ..
```

Khởi động PostGIS và OSRM đang dùng, restart **Platform, Location MCP, Moving
MCP, Moving API, Agent API và UI** theo [runbook local](../runbooks/local-mvp.md).
Không chỉ restart map/browser; code TypeScript backend cần bản build và process mới.
Không cần gửi `node_modules`, `dist`, worker sinh tự động hoặc Docker volume.

## 6. Kiểm tra sau nhận

- Moving API 4200 và MCP 4400 `/ready` = 200; `/health` chưa đủ xác nhận DB.
- Truy vấn ID POI cũ vẫn trả đúng tọa độ, POI khác tầng/tiện ích còn riêng.
- Kiểm số POI và nguồn theo manifest, housing theo báo cáo import; dữ liệu
  riêng mới hơn trên máy đích có thể làm số lượng khác.
- Hỏi Moving, gõ trực tiếp trong A/B, chọn gợi ý, đổi địa chỉ phải xác nhận lại pin.
- Kiểm OSRM driving cả ba vùng; xem toàn Việt Nam không mở rộng graph routing.
- Mở 8503, Ctrl + F5 sau build.

Bằng chứng các lượt kiểm tra đã có: POI **47 Housing Query + 25 Platform + 2
portable dataset**; frontend **16 ca khác nhau desktop/mobile**, chạy lại 6 ca
form/POI/A-B ở lượt cuối; build qua. Gateway → OSRM thật khớp 53/72/105 điểm ở
HCM/HN/Đà Nẵng. Moving `/ready`, lưu/đọc quote thử với rollback và hai tool đọc
catalog AhaMove staging đã qua. Đây là bằng chứng theo từng đợt, không phải
một lượt chạy lại toàn bộ suite lúc bàn giao. Chưa nghiệm thu báo giá/đặt đơn
provider thật trong đợt cuối; không coi test UI fixture là giao dịch thành công.

## 7. Tài liệu chi tiết

- [POI: quy tắc, bảo vệ dữ liệu, export/import và khôi phục](../location/POI-CANONICALIZATION.md).
- [Housing: importer và chuẩn hóa](../location/HOUSING-DATA-IMPORT.md).
- [Map Việt Nam, Moving A/B và khởi động](vietnam-map-moving-update-2026-10-04.md).
- [Studio và bằng chứng đợt trước](mainland-map-moving-studio-update-2026-10-04.md).
- [README frontend](../../Frontend/README.md).
