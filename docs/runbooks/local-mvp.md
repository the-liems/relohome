# Chạy MVP tích hợp trên máy — không deploy

## Đã nối những gì?

Streamlit → FastAPI → LangGraph: Intake LLM → Planner LLM → các task theo domain.
Moving có vòng gọi tool bằng LLM; Housing/Map/Flight dùng adapter chuyên biệt,
không bắt buộc mỗi service phải có thêm một LLM. Planner có thể sửa kế hoạch;
code kiểm schema, quyền gọi tool, dependency, giới hạn gọi và xác nhận giao dịch.

Housing/Map đọc snapshot thật của nhóm; Flight tìm bằng SerpApi;
Moving gọi AhaMove staging; trang thanh toán gọi ZaloPay sandbox thật.
Không dùng kết quả giả khi provider lỗi. API thiếu cấu hình thì không hứa có chức năng đó.

## Tổ chức thư mục

| Nơi | Trách nhiệm |
| --- | --- |
| `src/agents/` | Intake, Planner, graph, domain subagents |
| `src/services/adapters/` | MCP clients, approval, giao dịch, lưu trạng thái |
| `src/api/` | API hội thoại, xác nhận và demo thanh toán |
| `src/ui/` | Giao diện Streamlit |
| `src/mcp_servers/` | Flight/Payment MCP Python |
| `Maps VN/LifeFlow/` | Workspace TypeScript Housing/Map/Moving đã có; không di chuyển phá import |
| `scripts/` | Khởi tạo, nhập snapshot, restore, chạy local |
| `config/local-*.compose.yaml` | PostGIS và OSRM local, không phải deploy |
| `docs/specs/`, `docs/adr/`, `docs/runbooks/`, `eval/` | Yêu cầu, quyết định, vận hành, bằng chứng |
| `data/` | Dữ liệu/key/runtime riêng, không commit |

Các tài liệu teammate gửi ở gốc `docs/` được giữ nguyên; đây là tài liệu tham khảo,
không tự ghi đè spec hoặc coi mọi đề xuất trong đó là quyết định đã duyệt.

## Máy đang có dữ liệu

Không chạy lại import/restore/init nếu đã có `data/integration.env` và DB.
Chạy từ gốc repo, sau khi Docker Desktop sẵn sàng:

```powershell
docker compose --env-file data/integration.env -f config/local-integration.compose.yaml up -d
docker compose -f config/local-routing.compose.yaml up -d
```

Mở từng terminal riêng (Ctrl+C dừng đúng process):

```powershell
.venv/Scripts/python.exe scripts/local-integration.py location
.venv/Scripts/python.exe scripts/local-integration.py moving
.venv/Scripts/python.exe scripts/local-integration.py moving-api
.venv/Scripts/python.exe scripts/local-integration.py api
.venv/Scripts/python.exe scripts/local-integration.py ui
```

Mở <http://127.0.0.1:8503>. Mặc định chỉ đọc, tìm kiếm, báo giá.
Muốn demo giao dịch sandbox: dừng `moving`, `moving-api`, `api`, rồi chạy lại từng
lệnh với `--sandbox-writes`. Cờ không tự đặt xe/thanh toán; vẫn phải xác nhận trên form.
Không mở hai process trùng cổng. Chỉ một worker FastAPI cho bộ lưu local này.

## Thiết lập trên máy mới

1. Python 3.11+, Node 22+, Docker; tạo `.venv`, cài `requirements.txt`.
2. Sao chép `.env.example` thành `.env`, điền key thật riêng: OpenAI, AhaMove staging,
   SerpApi và ZaloPay sandbox. Liên hệ báo giá phải là liên hệ thật được phép sử dụng.
3. Chạy `python scripts/init-local-integration.py` sinh token và mật khẩu riêng.
   Script từ chối ghi đè cấu hình đã tồn tại; không in secret.
4. Nhập ZIP bằng PowerShell:

```powershell
./scripts/import-teammate-snapshot.ps1 -ArchivePath '<duong-dan-ZIP-cua-nhom>'
```

5. Trong `Maps VN/LifeFlow`, chạy `npm ci`, `npm run build`.
6. Khởi động PostGIS bằng lệnh Compose ở trên, rồi
   `python scripts/restore-local-snapshot.py`. DB đích phải chưa tồn tại.
   Script kiểm checksum, chờ restore xong rồi mới migrate. Không drop DB cũ.
7. Khởi động OSRM và các process như phần trên.

Nếu restore thất bại, không chạy migrations chồng lên restore chưa xong.
Chọn DB đích mới trong cấu hình và điều tra lỗi; giữ DB cũ để kiểm tra.
Không chạy `docker compose down -v` nếu còn dữ liệu cần giữ.

## Thử demo

- Housing: hỏi tìm nhà theo thành phố, ngân sách, tiêu chí; kết quả rỗng là hợp lệ.
  Ví dụ đã kiểm thử: “tìm phòng có 2 phòng ngủ ở quận 1 thành phố Hồ Chí Minh”.
  Bộ lọc số phòng ngủ/quận được truyền xuống truy vấn, không chỉ hiển thị trong câu trả lời.
- Map: hỏi địa điểm/đường đi; dữ liệu routing local có HCM, Hà Nội, Đà Nẵng,
  không đồng nghĩa AhaMove bị giới hạn chỉ trong một thành phố.
  Ví dụ đã kiểm thử: “Tính đường đi bộ từ Dinh Độc Lập Cafe đến Takashimaya tại Thành phố Hồ Chí Minh”.
- Flight: hỏi tuyến bay và ngày tương lai; chỉ tìm chuyến thật, chưa xuất vé.
- Moving: nhập địa chỉ; khi chưa đủ rõ, xác nhận tọa độ trên sidebar rồi hỏi báo giá.
  Chỉ tick xác nhận khi đã kiểm tra điểm trên bản đồ. Xem phí/điều kiện trước khi đặt.
- Đặt/hủy/cập nhật liên hệ Moving phải qua phương án và form xác nhận;
  đổi địa chỉ hoặc COD không thuộc form sửa liên hệ, phải đánh giá lại giá/đơn.
- ZaloPay: trang riêng, nhập 1.000–100.000 VND, xác nhận tạo yêu cầu sandbox,
  mở link/QR rồi kiểm tra trạng thái từ provider. Không có nút giả lập đã trả tiền.

Moving đang CASH. Thanh toán ZaloPay là demo riêng, **chưa phải thanh toán đơn
AhaMove hay vé máy bay**. Không tự nối hai khoản để tránh thu tiền hai lần.

## An toàn và phục hồi

- `AGENT_API_TOKEN` chỉ giữ ở backend Streamlit; `X-User-Id` do frontend tin cậy cấp.
  Đây chưa phải đăng nhập nhiều người dùng production; không expose các cổng ra Internet.
- Form chứa PII được mã hóa tại chỗ, TTL 30 phút; không gửi token/provider payload vào LLM.
- Checkpoint, ownership, approval và dấu giao dịch tồn tại sau restart.
  Giữ cả DB runtime lẫn key mã hóa; không commit/đưa vào log.
- Khi tạo đơn timeout/kết quả không rõ: **không đặt lại**. Tra tracking number,
  xác định duy nhất order ID, kiểm tra trạng thái rồi xử lý đúng đơn đó.
  Chưa có màn hình operator tự động xử lý mọi giao dịch bất định.
- Nếu LLM/API lỗi mạng: UI báo lỗi, không thay bằng dữ liệu mock.
- Không chạy lại test giao dịch chỉ để kiểm tra code; mỗi lần có thể tạo đơn thật
  trong sandbox và cần được người vận hành đồng ý.

## Kiểm tra không gọi API trả phí

```powershell
.venv/Scripts/python.exe -m ruff check src tests
.venv/Scripts/python.exe -m compileall -q src
.venv/Scripts/python.exe -m pytest tests/test_llm_agents/test_runtime_storage.py -q
```

Test checkpoint LLM sẽ skip khi chưa bật opt-in. Trên Windows nếu thư mục temp cũ
bị khóa, chọn `--basetemp=data/test-run-<ma-moi>` chưa tồn tại.
Live tests ở `tests/test_llm_agents/` có cờ opt-in; không tạo mock test mới.
Workflow `MVP local validation` chỉ lint/build/SQLite, không triển khai hoặc tạo đơn.
Xem [bằng chứng và giới hạn](../../eval/mvp-local-2026-09-30.md).
