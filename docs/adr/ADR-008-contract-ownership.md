# ADR-008: Một nguồn schema chuẩn cho mỗi runtime

Ngày: 2026-09-25  
Trạng thái: Proposed (chờ nhóm duyệt)  
Người đề xuất: @DungMQ | Review: người phụ trách API và agent

## Bối cảnh

Maps API và MCP dùng chung Zod; app FastAPI gốc dùng Pydantic. Đây là hai
ứng dụng khác nhau. Nếu chép field vào Markdown, YAML và code để sửa độc lập,
các bản sẽ nhanh chóng lệch nhau.

## Các phương án

1. Viết lại request/response đầy đủ trong từng tài liệu.
2. Giữ schema ở runtime làm nguồn chuẩn; tài liệu chỉ giải thích ý nghĩa,
   dẫn link và nêu ví dụ.

## Quyết định đề xuất

Chọn phương án 2: Maps dùng
[`packages/contracts/src/`](../../Maps%20VN/LifeFlow/packages/contracts/src/);
Python dùng [`src/models/schemas.py`](../../src/models/schemas.py) và
OpenAPI do FastAPI sinh. Chưa có schema chung cho Python ↔ Maps.

## Lý do

API và MCP Maps đã kiểm tra input theo Zod. Tài liệu nên nói hành vi mong
đợi, không tạo một bộ quy tắc validation thứ hai.

## Hệ quả

Khi đổi contract, phải kiểm tra client/UI, test và tài liệu liên quan.
Nếu tích hợp Python ↔ Maps, nhóm cần chọn/version một hợp đồng mới; ADR
này không giả định hai hệ type hiện tại đã tương thích.

## Cập nhật 2026-09-29 (theo code agent graph)

Nguyên tắc "một nguồn schema cho mỗi runtime" giữ nguyên. Ranh giới Python ↔ Maps nay có hai contract,
mỗi cái có đúng một nguồn:

| Contract | Nguồn | Bên kia dùng |
|---|---|---|
| MCP tool của Location / Moving | Zod trong `packages/contracts/src/` | Python gọi qua MCP, không chép schema; `config/agent-services/registry.json` sinh từ Zod, không sửa tay |
| Contract subagent (ADR-016) | Pydantic trong [`src/agents/contracts/`](../../src/agents/contracts/) | Service TypeScript dùng JSON Schema xuất ra [`docs/api/agent-contract/`](../api/agent-contract/) |

Schema của Chat API là Pydantic trong `src/models/schemas.py` và `src/agents/models.py`.

Liên quan: [SPEC-009](../specs/SPEC-009-tim-kiem-va-tien-ich-gan.md),
[SPEC-013](../specs/SPEC-013-mcp-vi-tri.md).
