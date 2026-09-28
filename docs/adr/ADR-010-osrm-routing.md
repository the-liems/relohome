# ADR-010: PostGIS lấy ứng viên, OSRM xác nhận quãng đường đi

Ngày: 2026-09-25  
Trạng thái: Proposed (chờ nhóm duyệt)  
Người đề xuất: @DungMQ | Review: người phụ trách routing/API

## Bối cảnh

Truy vấn "nhà cách trường tối đa 2 km đường đi" không thể quyết định chỉ
bằng khoảng cách đường thẳng. Gọi OSRM cho mọi tin nhà vừa tốn tài nguyên
vừa khó giới hạn. Hệ thống hiện có graph OSRM theo thành phố và profile.

## Các phương án

1. Dùng khoảng cách Euclid để kết luận: nhanh nhưng sai khi đường vòng,
   cầu, sông hoặc đường cấm.
2. Gọi OSRM cho toàn bộ bản ghi: đúng hơn nhưng không có bước giảm ứng viên.
3. Dùng PostGIS lọc ứng viên rồi dùng OSRM kiểm tra distance/duration.

## Quyết định đề xuất

Chọn phương án 3 cho điều kiện commute của nhà; route A→B cũng lấy bằng
OSRM. Chỉ hỗ trợ `driving`, `motorcycle`, `walking` tại các thành phố
đã cấu hình. Với ngưỡng snap, kiểm tra bằng chứng bắt đường của cả A và B.

## Lý do

Khoảng cách thẳng với biên độ dự phòng cho việc bắt đường giúp giảm tập
ứng viên, không phải chứng cứ một tuyến đi được. OSRM trả quãng đường,
thời gian và geometry trên graph tương ứng.

## Hệ quả

Cần graph/port OSRM đúng profile và xử lý offline, no-route, phản hồi lỗi.
Thời gian là ước lượng routing, không phải cam kết vận chuyển. Chưa hỗ trợ
multi-stop, bike hay map matching. Một trang housing có thể rỗng nhưng còn
cursor do giới hạn số ứng viên được kiểm tra.

Liên quan: [SPEC-010](../specs/SPEC-010-tim-nha-o.md),
[SPEC-011](../specs/SPEC-011-dinh-tuyen.md).
