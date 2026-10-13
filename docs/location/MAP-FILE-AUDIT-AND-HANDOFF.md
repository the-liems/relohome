# Rà soát file Map và hướng dẫn bàn giao

> Historical record: paths, names, commands and measured results below describe the original checkout. For current operation use the [ReloHome location guide](README.md) and [local runbook](../runbooks/local-mvp.md).

> **Tài liệu khảo sát/thiết kế lịch sử — không dùng làm status hiện hành.**
>
> **Cập nhật chỉ dẫn 2026-09-29:** xem [status triển khai](../integration/location-service-implementation-status.md) và [dữ liệu/backup hiện hành](../integration/location-data-status.md). Location hiện có 9 tool, housing thật và MCP HTTP có bearer token. Các số liệu, test và kế hoạch trong ghi chép cũ bên dưới thuộc thời điểm viết, không phải thống kê DB của máy mới. ZIP cũ đã xóa; giữ dữ liệu backup riêng với source trong Git.

Ngày rà soát: 26/09/2026

> **Cleanup 2026-10-04:** đã bỏ bốn bản `.en.bak` và ba asset mẫu không dùng ở mục 3.
> Hai bundle MapLibre ở mục 4.2 được bỏ khỏi Git; `postinstall`, `predev` và `prebuild`
> vẫn chạy `prepare:worker` để sinh lại từ dependency. Các mục bên dưới giữ nguyên
> như ghi chép lịch sử. Fallback GeoJSON và báo cáo POI vẫn được giữ.

## 1. Kết luận nhanh

Dự án hiện tại vẫn có thể build từ source. Không có file dư nào đang chặn TypeScript,
frontend hoặc MCP build.

Tuy nhiên thư mục làm việc có nhiều file rất lớn chỉ phục vụ máy local. Các file này đã
được Git ignore và **không được nén/gửi thủ công cho leader**. Ngoài ra có một số file đang
được Git theo dõi nhưng đã cũ hoặc không còn được dùng; nên dọn chúng trong một commit riêng
sau khi leader xác nhận không cần bản tiếng Anh và fallback GeoJSON cũ.

Không xóa file chỉ dựa vào tên. Một số file trông giống file sinh tự động nhưng vẫn đang
được frontend gọi trực tiếp, ví dụ hai bundle MapLibre trong `map-app/public/maplibre`.

## 2. File/thư mục chắc chắn không gửi

| Đường dẫn | Dung lượng khảo sát | Lý do | Hành động |
|---|---:|---|---|
| `.runtime/diagnostics/` | khoảng 4,1 GB | VHDX và crash dump WSL/OSRM | Không gửi; có thể xóa local sau khi không còn cần chẩn đoán |
| `backups/` | khoảng 582 MB | Các bản dump PostGIS theo mốc thời gian | Không gửi qua Git; chuyển sang kho backup riêng |
| `database/backups/` | khoảng 5,6 MB | Database dump local | Không gửi qua Git |
| `data/` | khoảng 99 MB | PBF/GeoJSONSeq nguồn nhập | Không đưa vào image MCP hoặc Git; lưu artifact/object storage |
| `node_modules/` | khoảng 105 MB | Dependency sinh bởi `npm install` | Không gửi; leader chạy `npm ci` |
| `map-app/node_modules/` | khoảng 174 MB | Dependency frontend | Không gửi; leader chạy `npm ci` trong `map-app` |
| Các thư mục `dist/` | khoảng 4,8 MB | Kết quả build | Không gửi khi bàn giao source |
| `map-app/test-results/` | khoảng 2,4 MB | Ảnh/chứng cứ Playwright local | Không gửi, trừ khi leader yêu cầu bằng chứng test |
| `.pytest_cache/`, `demo/__pycache__/` | nhỏ | Cache Python | Không gửi |
| `.env` | nhỏ nhưng nhạy cảm | Chứa password/token và cấu hình riêng của máy | Tuyệt đối không gửi/commit; chỉ gửi `.env.example` |

Các nhóm trên hiện đã được Git ignore. Nếu gửi bằng Git thì chúng không đi theo; rủi ro chỉ
xảy ra khi nén cả thư mục `LifeFlow` bằng Explorer.

## 3. File tracked có thể dọn trong một commit cleanup

### 3.1. Bốn file backup tài liệu

Các file sau là bản sao cũ, không phải tài liệu chính:

- `README.en.bak`
- `map-app/README.en.bak`
- `docs/HOUSING-QUERY-IMPLEMENTATION.en.bak`
- `docs/LIFEFLOW-MCP-POSTGIS-PLAN.en.bak`

Lý do nên bỏ:

- tên `.bak` không phù hợp để quản lý phiên bản bằng Git;
- nội dung đã lệch so với code hiện tại, ví dụ `README.en.bak` vẫn ghi MCP có 6 tool;
- `map-app/README.en.bak` được gắn nhãn English nhưng nội dung không phải bản tiếng Anh hoàn
  chỉnh và có dấu hiệu lỗi encoding;
- lịch sử cũ đã có Git lưu, không cần giữ thêm bản backup trong cây source.

Nếu team cần tài liệu tiếng Anh, nên tạo `README.en.md` chính thức và cập nhật cùng
`README.md`, không tiếp tục dùng `.bak`.

### 3.2. Asset mẫu Vite/React không được dùng

Ba file sau không có import hoặc tham chiếu trong `map-app/src` và `index.html`:

- `map-app/src/assets/vite.svg`
- `map-app/src/assets/react.svg`
- `map-app/src/assets/hero.png`

Đây là ứng viên xóa an toàn. Sau khi xóa vẫn cần chạy lại `npm run build` và E2E test để xác
nhận giao diện không phụ thuộc CSS động hoặc đường dẫn được tạo ở nơi khác.

## 4. Cụm legacy cần quyết định trước khi xóa

### 4.1. Fallback `accommodations.geojson`

Các thành phần liên quan:

- `map-app/public/data/accommodations.geojson` (khoảng 2,66 MB);
- `map-app/scripts/prepare-poi.mjs`;
- script `prepare:data` trong `map-app/package.json`;
- hàm `loadPois()` ở đầu `map-app/src/services/poi.ts`;
- một số mô tả trong README/docs và request trực tiếp trong E2E test.

Luồng ứng dụng hiện tại **không dùng fallback này**. `App.tsx` gọi
`map-app/src/services/platform-poi.ts`, và file đó chủ động báo lỗi khi Platform API không
sẵn sàng. Tuy vậy `poi.ts` chưa thể xóa cả file vì `SearchBar.tsx` và `PoiPopup.tsx` vẫn dùng
`searchPois`, `getPoiAddress` và `getProperty` từ file này.

Khuyến nghị:

- nếu sản phẩm bắt buộc luôn dùng dữ liệu PostGIS/API: xóa cả cụm fallback trong một PR,
  giữ lại các utility đang dùng trong `poi.ts`, rồi cập nhật E2E và tài liệu;
- nếu cần demo offline khi API hỏng: giữ cả cụm và sửa `platform-poi.ts` để fallback thực sự
  hoạt động. Hiện tài liệu nói có fallback nhưng code chính không fallback, nên trạng thái
  này cần được thống nhất.

Không xóa riêng `accommodations.geojson` lúc này vì E2E test vẫn gọi đường dẫn đó.

### 4.2. Bundle worker MapLibre

Hai file:

- `map-app/public/maplibre/maplibre-gl-worker.mjs`;
- `map-app/public/maplibre/maplibre-gl-shared.mjs`.

Chúng được copy từ `node_modules/maplibre-gl/dist` bằng
`map-app/scripts/copy-maplibre-worker.mjs`. Đây là file sinh tự động nhưng **không dư ở thời
điểm runtime**: `main.tsx` cấu hình worker URL trỏ trực tiếp đến file trong `public`.

Có hai lựa chọn hợp lệ:

1. Giữ tracked như hiện tại để clone xong vẫn có asset.
2. Bỏ khỏi Git, thêm ignore và bắt buộc pipeline chạy `npm ci` + `npm run build` để sinh lại.

Không nên xóa hai bundle mà không giữ bước `prepare:worker`.

## 5. File tùy chọn, không phải file dư

| Nhóm | Mục đích | Có cần cho MCP production? |
|---|---|---|
| `demo/` và `STREAMLIT_MVP.md` | Hai giao diện thử: Tool Lab và Housing/Map sub-agent | Không |
| `reports/poi-coverage-v2.json` | Bằng chứng chất lượng/lần nhập POI | Không, nhưng nên giữ để audit |
| `docs/CHECKPOINT-*` | Nhật ký checkpoint triển khai | Không, nhưng hữu ích khi review |
| `docs/LIFEFLOW-MCP-POSTGIS-PLAN.md` | Kiến trúc và quyết định trước đây | Không bắt buộc runtime |
| `docs/HOUSING-CRAWL-PLAYBOOK.md` | Kế hoạch crawl housing chưa triển khai | Không thuộc image MCP |
| `platform-api/` | API phục vụ frontend map và importer/migration | Không nằm trong MCP image nhưng cần cho map đầy đủ |
| `map-app/` | Frontend MapLibre | Không nằm trong MCP image nhưng cần cho sản phẩm map |

Hai app Streamlit không trùng hoàn toàn:

- `tool_lab_app.py` dùng để gọi và kiểm tra từng MCP tool;
- `streamlit_app.py` dùng sub-agent, OpenAI và bản đồ để thử luồng hội thoại.

Nếu leader chỉ nhận MCP container thì có thể không gửi `demo/`. Nếu leader nhận toàn bộ module
Map thì nên giữ để làm công cụ kiểm thử thủ công.

## 6. Những file không được xem là dư

- Hai `package-lock.json`: root Node workspace và `map-app` là hai dependency graph khác nhau.
- Toàn bộ `database/migrations/001...009`: migration sau phụ thuộc lịch sử migration trước.
- `packages/contracts`: hợp đồng Zod dùng chung bởi query service và MCP.
- `packages/housing-query`: lớp query/service dùng bởi MCP và Platform API.
- `mcp-server/src/tools/*`: registry riêng theo domain nhưng được ghép thành một MCP server.
- `mcp-server/src/server.ts`: transport `stdio` cho local client.
- `mcp-server/src/http-server.ts`: Streamable HTTP cho container/leader.
- `infra/osrm/profiles/motorcycle.lua`: profile routing xe máy tùy chỉnh.
- `Setup-Routing.ps1`, `Start-LifeFlow.ps1`, `Stop-LifeFlow.ps1`: vận hành local đầy đủ.
- `.dockerignore`: cần để không đưa data, backup, docs và dependency local vào build context.

## 7. Nên gửi leader theo cách nào

### Phương án khuyến nghị: gửi Git commit/branch của toàn module Map

Giữ trong source:

```text
.dockerignore
.env.example
.gitignore
README.md
package.json
package-lock.json
tsconfig.base.json
config/
database/migrations/
docs/
infra/
packages/
platform-api/
mcp-server/
map-app/
Setup-Routing.ps1
Start-LifeFlow.ps1
Stop-LifeFlow.ps1
Extract-Poi-V2.ps1
```

`demo/`, `STREAMLIT_MVP.md` và `reports/` có thể gửi kèm nếu leader cần demo/audit; chúng không
ảnh hưởng image MCP.

Không gửi:

```text
.env
.runtime/
.pytest_cache/
backups/
database/backups/
data/
node_modules/
**/node_modules/
**/dist/
map-app/test-results/
Docker named volume lifeflow-postgis-data
file graph OSRM/PBF local
```

### Nếu leader chỉ lấy MCP container/source MCP

Tối thiểu phải gửi cùng nhau:

```text
.dockerignore
.env.example
package.json
package-lock.json
tsconfig.base.json
packages/contracts/
packages/housing-query/
mcp-server/
infra/compose.yaml
database/migrations/
docs/MCP-CONTAINER-HANDOFF.md
```

Không chỉ gửi riêng thư mục `mcp-server`, vì Docker build và TypeScript workspace còn phụ
thuộc `packages/contracts`, `packages/housing-query`, root lockfile và root tsconfig.

Nếu chuyển image thay vì source, dùng registry nội bộ với tag cố định
`lifeflow-location-mcp:0.1.0`. Image vẫn không chứa PostGIS data hoặc graph OSRM; leader phải
cấu hình các service đó riêng.

## 8. File thay đổi cần stage cho phần MCP vừa triển khai

Từ repository root `D:\DEMO_AI\DEMO_1`, stage đúng phạm vi `Maps VN/LifeFlow`; không dùng
`git add .` ở repository root vì còn có thay đổi AI log/hook và ADR ngoài module Map.

Nhóm file MCP cần đưa vào commit gồm:

```text
Maps VN/LifeFlow/.dockerignore
Maps VN/LifeFlow/.env.example
Maps VN/LifeFlow/README.md
Maps VN/LifeFlow/infra/compose.yaml
Maps VN/LifeFlow/package.json
Maps VN/LifeFlow/package-lock.json
Maps VN/LifeFlow/packages/housing-query/src/config.ts
Maps VN/LifeFlow/mcp-server/Dockerfile
Maps VN/LifeFlow/mcp-server/package.json
Maps VN/LifeFlow/mcp-server/src/
Maps VN/LifeFlow/mcp-server/tests/mcp-http.integration.test.ts
Maps VN/LifeFlow/docs/MCP-CONTAINER-HANDOFF.md
Maps VN/LifeFlow/docs/MAP-FILE-AUDIT-AND-HANDOFF.md
```

`docs/HOUSING-CRAWL-PLAYBOOK.md` là tài liệu kế hoạch dữ liệu, không phải code container. Chỉ
stage file này nếu leader cũng cần review kế hoạch crawl.

Không stage các thay đổi ngoài `Maps VN/LifeFlow`, đặc biệt `.codex/hooks.json`,
`scripts/log_manual.py`, `docs/adr/` và `docs/specs/`, vào commit bàn giao Map nếu chúng thuộc
công việc khác.

## 9. Kiểm tra trước khi gửi

```powershell
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"

npm ci
npm run build

Set-Location .\map-app
npm ci
npm run lint
npm run build
Set-Location ..

docker compose --env-file .env -f infra/compose.yaml config --quiet
docker build -f mcp-server/Dockerfile -t lifeflow-location-mcp:0.1.0 .
```

Để chạy MCP container:

```powershell
# Đặt MCP_AUTH_TOKEN trong .env trước khi chia sẻ endpoint.
npm run mcp:up

Invoke-RestMethod http://127.0.0.1:3000/healthz
Invoke-RestMethod http://127.0.0.1:3000/readyz
```

`/healthz` xác nhận process sống; `/readyz` xác nhận MCP kết nối được PostGIS. Tool
`calculate_route` chỉ hoạt động end-to-end khi các container OSRM tương ứng đã chạy.

## 10. Kết quả build/chạy thực tế ngày 26/09/2026

Đã kiểm tra trực tiếp trên workspace này:

| Kiểm tra | Kết quả |
|---|---|
| Root workspace `npm run build` | Đạt: contracts, housing-query, Platform API và MCP |
| Frontend `npm run lint` | Đạt |
| Frontend `npm run build` | Đạt, 1.892 module được transform |
| Docker Compose config | Hợp lệ |
| Docker image `lifeflow-location-mcp:0.1.0` | Build thành công |
| MCP container | `running/healthy` |
| `/healthz` | `ok` |
| `/readyz` | `ready`, database `connected` |
| MCP `tools/list` qua HTTP | Đủ 8 tool |

Frontend build có cảnh báo JavaScript chunk khoảng 1,30 MB trước gzip (khoảng 361 KB sau
gzip). Đây không phải lỗi build hoặc file dư, nhưng là việc tối ưu hiệu năng nên làm sau bằng
code splitting/dynamic import.

Tại thời điểm kiểm tra, `.env` chưa có giá trị `MCP_AUTH_TOKEN`. Compose chỉ bind MCP vào
`127.0.0.1`, nên có thể thử trên máy local; phải đặt token trước khi đổi bind address hoặc
chia sẻ endpoint cho máy khác.
