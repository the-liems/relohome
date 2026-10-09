# Housing/Flight: độ trễ đọc thật và chuyển snapshot — 05/10/2026

Liên quan: [SPEC-014](../docs/specs/SPEC-014-domain-llm-agents.md), đặc biệt
AC-02/03/05/34; [ADR-021](../docs/adr/ADR-021-mission-driven-domain-tools.md).
Đây là evidence local, không phải kết quả deployment hay benchmark thống kê.

## Điều kiện và chẩn đoán

- Checkout `review/quangdung-post-mvp`, nền merge `62f83b7` chứa main `1224f82`
  và QuangDung `07f23b6`, cộng thay đổi local lần này. Chưa push.
- Ban đầu chỉ API 8000 và UI 8503 nghe cổng; Location/Platform/Moving MCP/Moving
  API chưa chạy. DB đang dùng thiếu `catalog.poi_aliases` mà code QuangDung cần.
  Đã áp dụng migrations có sẵn `011`–`012`. Không có log từ lần chạy lệnh ẩn
  cũ nên không kết luận chắc nguyên nhân process cũ thoát.
- Đã sửa startup có log và preflight/readiness. Health 200 của API/UI riêng lẻ
  không chứng minh các dependency hay provider ngoài hoạt động.
- Model không đổi: `gpt-6-luna`; Intake, Planner và các domain LLM vẫn có.
  Không dùng keyword để chọn hộ domain tool, không tạo mock data/test/provider.
- Có đúng **5 lượt chat gọi LLM**, theo cho phép của user. Chỉ tra cứu; không
  đặt/hủy xe, đặt vé, tạo hay thực hiện thanh toán.

## Năm lượt chat thật

FastAPI + LangGraph thật, LLM thật, MCP/provider thật; API gọi qua
`httpx.ASGITransport` trong process với lifespan thật. Không mock transport hay
adapter. Thời gian dưới đây là tổng backend API, **không gồm browser render**.
Các thread/actor/runtime riêng, không sửa hội thoại chính của user.

| Ca | Yêu cầu | API (s) | LLM calls | Input tokens | Output tokens |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Tối đa 5 nhà Cầu Giấy, Hà Nội dưới 6 triệu/tháng | 13,555 | 3 | 10.405 | 297 |
| 2 | Cùng thread: giữ khu vực, hạ xuống dưới 4,5 triệu, tối đa 5 căn | 9,609 | 3 | 13.070 | 246 |
| 3 | Hà Nội → Đà Nẵng 20/10/2026, một người lớn, chỉ tra cứu | 16,191 | 3 | 10.199 | 301 |
| 4 | Cùng thread: giữ tuyến/người, đổi ngày sang 22/10/2026 | 11,936 | 3 | 11.571 | 297 |
| 5 | Nhà Hải Châu dưới 6 triệu + chuyến HAN → DAD 20/10 độc lập | 15,250 | 4 | 12.045 | 499 |
| Tổng | | | **16** | **57.290** | **1.640** |

Tổng **58.930 tokens** cho các lượt này, không quy đổi thành tiền vì chưa kiểm
biểu phí/provider billing. Số token mỗi dòng là phát sinh của lượt đó, không
cộng lặp usage cumulative của thread.

Cả năm trả `ANSWER`, mỗi domain có 5 phương án thật. Lượt 2 giữ khu vực và dùng
`max_price_vnd=4500000`; lượt 4 tìm ngày mới. Đây là hai cặp đa lượt, không phải
test tất cả kiểu tham chiếu/mâu thuẫn. Không xuất vé hay giả vờ đã đặt gì.

Mỗi domain tìm kiếm dùng **1 lượt LLM**, model chọn
`search_housing_and_return` hoặc `search_flights_and_return`. Hai lượt còn lại
là Intake và Planner; ca 5 có thêm domain thứ hai. Không tạo assessment giả.
Đối chiếu không gọi LLM giữa normal search và compound search cho Housing:
status/candidates khớp từ DB thật; terminal facts-only ghi `model_assessed=false`.

### Domain timing

| Domain/ca | LLM (ms) | Tools (ms) | Tổng domain (ms) |
| --- | ---: | ---: | ---: |
| Housing/1 | 2.702 | 1.832 | 4.535 |
| Housing/2 | 1.534 | 1.468 | 3.002 |
| Flight/3 | 2.744 | 6.429 | 9.175 |
| Flight/4 | 1.703 | 4.141 | 5.845 |
| Housing/5 | 2.084 | 2.589 | 4.673 |
| Flight/5 | 1.456 | 893 | 2.349 |

Ca 5 Flight dùng **cache kết quả provider thật** từ ca 3 (cùng tuyến/ngày),
không phải một network search mới. Ca 3 có SerpApi thật; chi phí/độ trễ provider
phụ thuộc cache và thời điểm. Không quảng bá thời gian ca 5 thành độ trễ cold.

Ca 5 có dependency rỗng cho hai task. Execution trace UTC:

- Housing: `09:48:04.934122` → `09:48:09.608481`.
- Flight: `09:48:04.935121` → `09:48:07.287415`.

Khoảng thực thi chồng nhau: **song song thực tế**, không chỉ có hai task trong
plan. Bộ ca này không đo lại một chuỗi phụ thuộc cross-domain phức tạp.

## Catalog và thao tác UI: không dùng LLM

Đối chiếu **toàn bộ JSON trả về** giữa `search_airports` qua MCP stdio thật và
lookup trực tiếp cùng catalog local, cùng query/limit: đều khớp.
Endpoint HTTP/custom server không dùng fast-path này.

| Query | MCP stdio (ms) | Cùng catalog local (ms) |
| --- | ---: | ---: |
| Hà Nội | 791,64 | 18,39 |
| Đà Nẵng | 729,94 | 0,32 |
| SGN | 700,69 | 0,33 |

Đây chỉ là giảm transport overhead **lookup sân bay**, không phải tăng tốc toàn
bộ search giá/chuyến. Không dùng bảng thành phố → IATA viết riêng cho test.

Sau khi chuyển DB mới, mở lại các thread đo riêng và dùng API action thật:

| Thao tác | HTTP | Backend (ms) | LLM calls |
| --- | ---: | ---: | ---: |
| Housing xem chi tiết | 200 | 341,75 | 0 |
| Housing chọn căn | 200 | 14,13 | 0 |
| Housing xem thêm | 200 | 1.779,53 | 0 |
| Flight xem chi tiết | 200 | 772,32 | 0 |
| Flight chọn chuyến | 200 | 5,48 | 0 |

Usage store không tăng số bản ghi sau các action; không gọi lại chat.
Các action cơ học đã có đường structured API không cần LLM. **Form tìm kiếm
gửi qua chat và câu tự nhiên vẫn chạy Intake/Planner/domain**, không suy ra mọi
thao tác UI đều nhanh. Chưa đo click-to-render trong browser.

## Snapshot mới và thời điểm chuyển DB

Năm lượt chat trên chạy với **DB cũ `lifeflow_verified` sau cập nhật schema**.
Sau đó mới restore/switch DB theo lựa chọn user. Không chạy lại năm lượt trả phí.
Các action UI phía trên chạy sau khi chuyển sang DB mới.

- ZIP `project-data-quangdung-20261005.zip`: 723.496.440 bytes,
  SHA256 `27d2554170dd26a18029b1aec9f6a906de927e306a9331ec6791ec3a2abe34c5`.
- Xác minh checksum 182 file, giải nén vào `data/quangdung-snapshot-20261005` mới.
- Restore vào DB mới `lifeflow_quangdung_20261005`, `ANALYZE`, migrate/grant.
  Số lượng khớp manifest: 38.222 listings, 169.413 places
  (131.191 POI + 38.222 housing anchors), 20.853 aliases, 8.735 admin areas.
- Đổi riêng `POSTGRES_DB` trong `data/integration.env`, restart đủ sáu service.
  Kiểm tra schema pass; startup lần hai tái sử dụng sáu service không mở trùng.
- DB cũ `lifeflow_verified` **vẫn tồn tại**. Không drop/reset hay chạy POI cleanup.
  ZIP không có lịch sử Moving của DB cũ; không tự chuyển lịch sử.
- Giữ chín container OSRM đang có, không thay graph chỉ vì restore PostgreSQL.

Map picker trên API đang chạy với DB mới: query UTF-8 “Đại học Bách khoa Hà Nội”
trả POI cùng tên với `match_type=exact`, score 1 ở đầu. Kết quả vẫn có
`ambiguous=true` và các ứng viên khác; bài kiểm tra này không tự chọn pin hay
khẳng định đã hoàn thành một nhiệm vụ Housing quanh trường. Không gọi LLM.

Rollback và khởi động: [runbook](../docs/runbooks/local-mvp.md).

## Kết luận và giới hạn

Đã giảm một lượt domain LLM khi nhiệm vụ chỉ cần dữ kiện; model vẫn chọn tool.
Normal search/inspect/finish/replan còn nguyên cho đánh giá phức tạp. Không đo
baseline paired trước/sau cùng điều kiện, vì vậy **không khẳng định % cải thiện
tổng thể**. Không đủ mẫu để công bố p50/p95 hay SLA. Chat 9,6–16,2 s vẫn là độ
trễ cần cải thiện; riêng Intake/Planner và provider chiếm thời gian đáng kể.

Không kiểm chứng toàn bộ AC của SPEC-014, Payment/Moving live, sở thích phức
tạp, các lỗi provider, mọi hành động map hay tải nhiều user trong bộ đo này.
Không chạy suite mock để thay thế kiểm chứng thực, không sửa CI/CD của teammate.

## Tái lập và artifact

```powershell
# Không gọi LLM
.venv/Scripts/python.exe scripts/local-integration.py check
.venv/Scripts/python.exe scripts/measure-read-latency.py --catalog

# Có chi phí: đúng năm lượt mới, chỉ chạy lại khi đã duyệt ngân sách
.venv/Scripts/python.exe scripts/measure-read-latency.py --live-llm

# Không gọi LLM; chỉ tác động thread đo riêng đã tạo bởi script
.venv/Scripts/python.exe scripts/measure-read-latency.py --ui-report data/read-latency-20261005-e9f1128fa2/report.json
```

Artifact riêng ở `data/read-latency-20261005-e9f1128fa2/report.json` và
`ui-report.json`, checkpoint/usage cùng thư mục. Không commit runtime, dữ liệu
provider, keys, `.env` hay logs. Ruff/compile kiểm tra code riêng; không gọi API
trả phí khi khởi động hoặc preflight.

Kiểm tra cuối: Ruff `src`, `tests` và các script sửa/thêm pass; Ruff gateway
Frontend pass với ignore `N999` cho tên thư mục có sẵn; Python compileall pass;
`git diff --check` pass. Build toàn bộ workspace LifeFlow TypeScript và React
Frontend đều pass. Không dùng các kết quả build/lint để tuyên bố toàn suite CI
của nhóm đã pass.
