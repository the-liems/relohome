# Housing Product V1 — Technical Design

## Ranh giới

Browser gọi same-origin gateway. Gateway lấy user từ session, gắn trusted actor rồi gọi Platform API. Platform API sở hữu Housing write/read. PostGIS hiện tại giữ canonical property/unit/listing/offer/media và bảng quản lý bổ sung. Agent chỉ đọc contract Housing hiện hữu; không thực hiện phép tính bằng LLM.

## Module

| Module | Trách nhiệm | Phụ thuộc |
| --- | --- | --- |
| `housing-management-data` | ownership, publication, availability, fees, contacts, events | schema Housing hiện tại |
| `housing-management-api` | authz, CRUD, publish workflow, inbox, overview | management data |
| `housing-decision-tools` | cost calculator, persistent shortlist, contact request | read contract, management API |
| `housing-landlord-ui` | workspace property/unit/listing/inbox/dashboard | management API |
| `housing-integration` | gateway, navigation, events, regression | tất cả module trên |

Build order: data → API → decision tools → landlord UI → integration/regression.

## Tương thích

- Không đổi tên/xóa field hay endpoint Housing cũ.
- Field quản lý được thêm dạng optional/default.
- Bảng mới tham chiếu bảng canonical; importer không ghi vào bảng quản lý.
- Tin self-service chỉ public sau approval; query cũ vẫn đọc `housing.listings.status='active'` nên publish workflow chuyển trạng thái canonical có kiểm soát.
- Feature chưa sẵn sàng không tạo navigation công khai.

## Security

- `Authorization: Bearer` giữa gateway và Platform API; `X-User-Id` chỉ tin sau khi token hợp lệ.
- Membership kiểm tra theo property ở từng query write/read private.
- Moderator lấy từ cấu hình server, không từ body hoặc account preferences.
- Media lưu ngoài public source tree, tên ngẫu nhiên, MIME allowlist, giới hạn byte và response `nosniff`.

## Analytics

Event types ban đầu: `impression`, `detail_view`, `save`, `contact_request`. Dedupe bằng khóa actor/session-window phù hợp. Dashboard luôn ghi mốc `measured_since`; không suy luận lịch sử từ saved snapshot.

