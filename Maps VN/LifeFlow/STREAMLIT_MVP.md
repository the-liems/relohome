# Housing/Map Sub-agent Lab: MCP + Map

> Demo local này không phải trạng thái triển khai của LangGraph product.
> Contract Location hiện tại có 9 tool; xem [status tích hợp](../../docs/integration/README.md)
> và [dữ liệu/backup](../../docs/integration/location-data-status.md).
> Lượt nghiệm thu 29/09 kiểm thử backend/MCP, không chạy lại demo Streamlit.

Đây là sandbox nhỏ để kiểm tra Housing/Map sub-agent, không phải agent chính
của toàn bộ product. Product Orchestrator chỉ cần chuyển yêu cầu phù hợp sang
sub-agent; sub-agent dùng OpenAI để chọn workflow và gọi MCP server TypeScript
hiện có qua `stdio`.

## Chuẩn bị

1. Mở Docker Desktop.
2. Từ thư mục `Maps VN/LifeFlow`, chạy `Start-LifeFlow.ps1` để bật PostGIS và
   chín OSRM service.
3. Build MCP server:

```powershell
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"
npm run build
```

4. Cài dependency riêng của demo và chạy Streamlit từ thư mục `LifeFlow`:

```powershell
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"
..\..\.venv\Scripts\python.exe -m pip install -r demo\requirements.txt
..\..\.venv\Scripts\python.exe -m streamlit run demo\streamlit_app.py
```

Mở `http://localhost:8501`.

## Test MCP tools trực tiếp, không qua agent

Để đánh giá tool và dữ liệu mà không bị ảnh hưởng bởi OpenAI chọn workflow,
chạy Tool Lab trên một cổng riêng:

```powershell
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"
..\..\.venv\Scripts\python.exe -m streamlit run demo\tool_lab_app.py --server.port 8502
```

Mở `http://localhost:8502`. Tab **Kịch bản nhanh** chạy các chuỗi tool thường
dùng; tab **Gọi một tool** cho phép sửa JSON và gọi trực tiếp từng MCP tool.

## Câu hỏi demo

- `Tìm khách sạn trong bán kính 2 km quanh Hồ Gươm và hiện trên bản đồ.`
- `Tìm bệnh viện gần Đại học VinUni.`
- `Tính đường đi xe máy từ Chợ Bến Thành tới sân bay Tân Sơn Nhất.`
- `Tìm căn hộ thuê dưới 15 triệu/tháng, 2 phòng ngủ, cách VinUni tối đa 30 phút.`

Câu cuối chỉ trả kết quả khi PostGIS có listing nhà thật. Agent không tạo dữ
liệu nhà giả nếu kho housing đang rỗng.

## Luồng demo

```text
Product Orchestrator (ngoài phạm vi demo)
  -> Housing/Map Sub-agent
  -> chọn workflow
  -> LifeFlow MCP tools qua stdio
  -> PostGIS / OSRM
  -> câu trả lời + tool trace + marker/route trên Streamlit map
```

Các MCP tools chỉ thuộc phạm vi Housing/Map sub-agent; agent cấp product không
cần biết schema hoặc cách phối hợp từng tool nội bộ.
