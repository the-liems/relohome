# Housing/Map Sub-agent Lab: MCP + Map

> Demo local này không phải trạng thái triển khai của LangGraph product.
> Contract Location hiện tại có 9 tool; xem [status tích hợp](../integration/README.md)
> và [dữ liệu/backup](../integration/location-data-status.md).
> Lượt nghiệm thu 29/09 kiểm thử backend/MCP, không chạy lại demo Streamlit.

Đây là sandbox nhỏ để kiểm tra Housing/Map sub-agent, không phải agent chính
của toàn bộ product. Product Orchestrator chỉ cần chuyển yêu cầu phù hợp sang
sub-agent; sub-agent dùng OpenAI để chọn workflow và gọi MCP server TypeScript
hiện có qua `stdio`.

## Chuẩn bị

1. Mở Docker Desktop.
2. Từ repository root, chạy `scripts/relohome/Start-ReloHome.ps1` để bật PostGIS và
   chín OSRM service.
3. Build MCP server:

```powershell
# Run from repository root
npm run build
```

4. Cài dependency riêng của demo và chạy Streamlit từ repository root:

```powershell
# Run from repository root
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
npm run dev:location-demo
```

Mở `http://localhost:8501`.

## Test MCP tools trực tiếp, không qua agent

Để đánh giá tool và dữ liệu mà không bị ảnh hưởng bởi OpenAI chọn workflow,
chạy Tool Lab trên một cổng riêng:

```powershell
# Run from repository root
npm run dev:location-tool-lab
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
  -> ReloHome MCP tools qua stdio
  -> PostGIS / OSRM
  -> câu trả lời + tool trace + marker/route trên Streamlit map
```

Các MCP tools chỉ thuộc phạm vi Housing/Map sub-agent; agent cấp product không
cần biết schema hoặc cách phối hợp từng tool nội bộ.

The installable distribution is `relohome-location-demo`, import namespace
`relohome_location_demo`; its own requirements remain at
`examples/location-streamlit/requirements.txt`. For a wheel launch outside the
checkout set `RELOHOME_RUNTIME_ROOT` to the checkout root. Configuration remains
root `.env.local`, with process environment taking precedence. Stdio client
identity `lifeflow-streamlit` is preserved. Agent mode may call OpenAI when
explicitly used; the portable tests use fake tools and make no provider calls.
