# SPEC-011: Định tuyến A đến B

Trạng thái: Draft | Phụ trách: @DungMQ | Review/issue cha: nhóm xác nhận sau

## Mục đích và phạm vi

Người dùng chọn A và B trong một thành phố được cấu hình để xem tuyến đường,
khoảng cách, thời gian dự kiến và geometry. Hệ thống hiện có profile
`driving`, `motorcycle`, `walking` tại TP.HCM, Hà Nội và Đà Nẵng. Không
gọi thời gian OSRM là thời gian giao hàng được đối tác cam kết.

## Giao diện và hành vi

- API: `POST /v1/routes`; schema [`route.ts`](../../packages/contracts/src/route.ts).
- Service: [`route-service.ts`](../../packages/housing-query/src/route-service.ts).
- MCP `calculate_route_between_entities` tra hai endpoint housing/place/coordinate
  rồi dùng chung RouteService; city bắt buộc, profile mặc định motorcycle,
  snap mặc định 100 m. Trả metadata và warning cho vị trí approximate/unknown.
  Contract/ví dụ: [handoff](../integration/location-service-implementation-status.md).
- Kết quả có distance mét, duration giây và GeoJSON LineString.
  `snap_radius_m` là giới hạn bắt đường tùy chọn; khi dùng, service kiểm tra
  bằng chứng snap của cả hai đầu.
- API backend dùng OSRM; frontend hiện cũng gọi OSRM để vẽ tuyến tương tác.
  Hai đường gọi cần được xem xét riêng khi đổi cấu hình.
- `snap_radius_m`/giới hạn snap 100 m là khoảng lệch tối đa từ **mỗi điểm đầu
  cuối tới graph**, không phải giới hạn chiều dài tuyến A→B hoặc bán kính tìm
  nhà/POI. Route có thể dài hơn 100 m nhiều lần.

## Lỗi, giới hạn và ngoài phạm vi

OSRM offline trả lỗi, không có tuyến/segment trả `NO_ROUTE`, phản hồi
thiếu hoặc sai cấu trúc trả `INVALID_RESPONSE`. Timeout mỗi OSRM request là
10 giây; deadline tổng mỗi MCP tool là 15 giây. Hai endpoint phải nằm trong
bounds của city đã chọn; ngoài bounds trả `OUTSIDE_ROUTING_AREA`.
Browser device-to-home directions có policy riêng tại
`POST /v1/routes/device`: UI gửi `routing_policy: auto`, ưu tiên local và tự chuyển
OSRM công khai khi ngoài vùng/local offline/không có segment/local timeout.
Không có checkbox đồng ý riêng; vẫn cần quyền vị trí trình duyệt và hiện thông báo
gửi tọa độ cho FOSSGIS (có ghi log). Caller cũ không gửi policy vẫn local-only,
trừ legacy flag chủ động chọn public. Deadline device riêng 20 giây, UI 25 giây.
Quyền riêng tư, snapping và giới hạn thử nghiệm xem
[SPEC-020/AC-08–09](SPEC-020-housing-controls-roommate-discovery.md) và
[ADR-024 (Proposed)](../adr/ADR-024-auto-public-device-routing.md).
Ngoại lệ này không bật fallback công khai cho MCP hoặc bộ lọc commute Housing.
Chưa hỗ trợ nhiều điểm dừng, bike hoặc GPS map matching.
Graph cũ Hà Nội thiếu đường quanh Ocean Park; PBF thành phố có thể đã được cắt
theo địa giới trong khi UI/backend chấp nhận bounding box lớn hơn. Không coi một route ở
trung tâm là bằng chứng graph phủ đủ cả thành phố.

## Tiêu chí nghiệm thu

- **SPEC-011/AC-01:** Route A→B cho profile/thành phố được hỗ trợ trả
  distance, duration và geometry có ít nhất hai tọa độ.
- **SPEC-011/AC-02:** Chuyển profile dùng graph OSRM tương ứng, không đổi nhãn
  UI mà tái sử dụng tuyến profile khác.
- **SPEC-011/AC-03:** Offline, không có tuyến, JSON sai hoặc bằng chứng snap
  vượt ngưỡng được báo lỗi; không trả 0 m như tuyến hợp lệ.
- **SPEC-011/AC-04:** Điều kiện commute của nhà dùng distance/duration từ
  cùng dịch vụ routing thay vì lấy từ đường thẳng.
- **SPEC-011/AC-05 (chưa đạt):** PBF/graph cho từng thành phố phủ vùng tọa độ
  mà UI/API chấp nhận, có biên đệm; các route mẫu trung tâm và vùng biên cho
  cả ba profile có snap không quá 100 m hoặc báo không có tuyến đúng thực tế.
  Kiểm tra từng graph mới trước khi chuyển container production.

Kiểm chứng: [test route](../../packages/housing-query/tests/route-service.test.ts).
Kết quả runtime ba thành phố × ba profile và các điểm biên được ghi trong
[handoff](../integration/location-service-implementation-status.md)
(smoke test không chứng minh toàn bộ độ phủ).
Quyết định liên quan: [ADR-010](../adr/ADR-010-osrm-routing.md).
