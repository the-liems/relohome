# ReloHome — Đề xuất nâng cấp Housing: chọn nơi ở và quản lý tin đăng

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


- Ngày: 08/10/2026 (Asia/Saigon).
- Trạng thái: **product proposal để review**; chưa phải product spec hay technical design.
- Phạm vi: Tenant và Landlord trong ReloHome hiện có. Lượt này chỉ đọc code, tài liệu và snapshot dữ liệu; **không sửa code, database hoặc API**.
- Giả định theo chủ sản phẩm: kho Housing hiện tại tiếp tục phục vụ tìm kiếm. Việc làm sạch nguồn crawl sẽ được xử lý riêng; đề xuất này tập trung vào người đăng tự cung cấp và duy trì tin.

## 1. Vấn đề và hướng đề xuất

**Làm sao để người thuê biết căn nào thật sự phù hợp với ngân sách và việc đi lại, đồng thời giúp chủ trọ cập nhật nhiều phòng và trả lời đúng người quan tâm, trên cùng nền tảng ReloHome?**

Đề xuất một vòng sử dụng: **tin do chủ trọ quản lý → bảng quyết định của người thuê → yêu cầu liên hệ → chủ trọ xử lý → cập nhật tình trạng phòng**. Người thuê vẫn có thể bắt đầu bằng Agent hoặc dùng trực tiếp UI. Tin từ nguồn hiện tại vẫn tìm được, nhưng quyền chỉnh sửa, xác nhận tình trạng và số liệu liên hệ chỉ áp dụng cho tin có chủ thể quản lý được xác thực trong ReloHome.

Điểm khác biệt nên là **chi phí rõ khoản nào đã biết, khoản nào cần hỏi và căn nào còn nhận liên hệ**, thay vì thêm một thuật toán chấm điểm thuê nhà khó giải thích. Công thức, filter và so sánh chạy bằng code; Agent chỉ giúp hiểu câu hỏi, mở đúng màn hình và diễn giải dữ kiện có nguồn.

## 2. Audit: đã có và cần bổ sung

| Khả năng | Đã có trong codebase | Khoảng trống cần bổ sung |
| --- | --- | --- |
| Tìm nhà và bản đồ | PostGIS search/detail/map có giá, diện tích, tiện ích, cọc nullable, độ chính xác vị trí, nguồn, trạng thái xác minh; lọc nearby/commute bằng PostGIS và OSRM. Agent đưa kết quả vào chat và map workspace có marker/cluster, filter, phân trang. [Contract](../../packages/contracts/src/housing.ts), [query](../../packages/housing-query/src/housing-service.ts), [map UI](../../Frontend/src/components/MapWorkspace.tsx). | Bộ lọc theo **tổng chi phí** và tình trạng trống do chủ xác nhận; khả năng chuyển mạch rõ giữa tin nguồn và tin tự đăng. |
| Chọn, lưu, so sánh | Có chọn căn trong kế hoạch; tài khoản lưu nhà theo người dùng và snapshot; kết quả chat có bảng so sánh **tối đa 3 căn trong cùng nhóm kết quả** theo giá, diện tích, phòng, cọc, tiện ích, vị trí. [Results](../../Frontend/src/components/Results.tsx), [Housing UI](../../Frontend/src/components/Housing.tsx), [saved](../../Frontend/server.py). | Shortlist bền vững qua nhiều lần tìm/map, so sánh 2–4 căn được lưu và làm mới dữ liệu trước khi quyết định; chưa có bảng chi phí hoặc lý do cần hỏi. |
| Vị trí và POI | Có tìm tiện ích gần, route theo profile OSRM, hiển thị điểm gần đúng và cảnh báo nhiều tin chung pin. [Location spec](../specs/SPEC-009-tim-kiem-va-tien-ich-gan.md), [Housing spec](../specs/SPEC-010-tim-nha-o.md). | Luồng so sánh thời gian đi tới địa điểm riêng của người thuê cho từng căn; phân biệt khoảng cách đường chim bay và đường đi. OSRM hiện không phải dự báo giao thông theo giờ. |
| Nội dung tin và giá | `properties`/`units`/`listings`/`offers`/`listing_media` có trong PostGIS; offer có lịch sử phiên bản, media lưu URL. Importer lưu nguồn/provenance và không ghi đè tin đã xác minh. [Tables](../../deploy/database/migrations/002_core_tables.sql), [media](../../deploy/database/migrations/010_housing_ingestion.sql), [importer](../../apps/platform-api/src/import-housing.ts). | Chưa có luồng người đăng tạo/sửa/publish/upload, quyền sở hữu tòa/phòng hoặc xác nhận trống. Importer hiện cấp `property_id` và `unit_id` theo **mỗi source listing**, nên chưa tự nhận ra các phòng cùng tòa. |
| Tài khoản và tương tác | Gateway có tài khoản/phiên và danh sách nhà đã lưu; Housing Platform API hiện chỉ có read search/map/detail. [Store](../../Frontend/store.py), [Platform API](../../apps/platform-api/src/app.ts). | Chưa có vai trò chủ trọ/người quản lý, inbox Housing, trạng thái xử lý lead, event xem/lưu/liên hệ gắn với tin tự đăng hay dashboard. Bảng `audit.tool_calls` là log công cụ, không phải analytics người thuê. |

**Giới hạn của bằng chứng dữ liệu:** file local `Maps VN/Data/housing_clean_2026-09-26.jsonl` là snapshot ngày 26/09, không phải số tin đang hoạt động trên mọi deployment. File có 38.930 record, trong đó 37.873 là tin thuê tháng; 35.626 có diện tích, 17.033 có cọc, 3.401 có đơn giá điện, 2.532 có giá nước, 758 có phí dịch vụ và 88 có phí gửi xe. Tất cả 37.873 tin thuê trong file ghi `verification.status=unverified`; `observed_at` cùng ngày 26/09. `derived.monthly_fixed_cost_known` thường chỉ chứa tiền phòng, **không được gọi là tổng chi phí**. Các con số này chỉ xác định cách hiển thị trường thiếu; kế hoạch không phụ thuộc vào việc làm sạch lại nguồn crawl.

## 3. Trải nghiệm cần xây

### Người thuê

1. Nêu nhu cầu trong chat hoặc nhập filter trên map. Kết quả cho thấy giá thuê cơ bản, tình trạng do người đăng xác nhận (nếu có), độ mới, mức chính xác vị trí và khoản phí còn thiếu.
2. Lưu 2–4 căn vào **Danh sách cân nhắc** từ chat, map hoặc trang đã lưu. Mỗi căn được đọc lại trước khi so sánh; tin không còn khả dụng vẫn nằm trong danh sách với trạng thái rõ ràng, không hiện snapshot cũ như giá hiện hành.
3. Xem một bảng quyết định gồm giá thuê, diện tích/giá mỗi m² khi hợp lệ, tiện ích, cọc, **tiền cần chuẩn bị lúc vào ở** và **chi phí tháng theo dữ liệu đã biết**. Trường thiếu là “Chưa rõ”, không phải 0. Người thuê có thể nhập giả định kWh/m³, số người và số xe cho kịch bản riêng; giả định không sửa tin gốc.
4. Chọn tối đa hai điểm đến quan trọng (trường/công ty) để so tuyến từng căn khi OSRM hỗ trợ; nếu không có route, giữ trạng thái “chưa tính được”. POI xung quanh vẫn dùng bản đồ hiện có.
5. Nhận **3–5 câu cần hỏi khi đi xem phòng** tạo từ các trường còn thiếu, ví dụ cách tính điện, phí xe, thời điểm còn trống. Tự quyết định liên hệ; Agent không tự chọn căn hoặc gửi yêu cầu.

### Người đăng/chủ trọ

1. Đăng nhập, chọn “Quản lý nhà cho thuê”, xác nhận quyền quản lý theo quy trình duyệt ban đầu. Một tài khoản có thể quản lý nhiều địa điểm; mỗi địa điểm có nhiều phòng/căn với mã phòng, tầng hoặc tòa riêng. Không suy ra cùng tòa chỉ vì trùng tọa độ.
2. Tạo bản nháp địa điểm → thêm từng phòng → ảnh và tiện ích → giá thuê/cọc/phí với **đơn vị và phạm vi áp dụng** → xem trước → gửi duyệt/đăng. Có thể sao chép phí chung của tòa rồi chỉnh theo phòng, tránh nhập lặp.
3. Trên danh sách phòng, đổi trạng thái **đang trống / đã thuê / tạm ngừng nhận liên hệ** và **tin đang đăng / ẩn / xóa** bằng hai khái niệm riêng. Giá mới có thời điểm áp dụng; giữ bản cũ để đối chiếu, không sửa lịch sử ngược thời gian.
4. Nhận yêu cầu trong một inbox theo phòng và trạng thái mới/đang trao đổi/đã hẹn/đã xử lý; trả lời hoặc đóng yêu cầu. Chỉ người có quyền với địa điểm đó xem yêu cầu và thông tin người thuê đã tự nguyện cung cấp.
5. Dashboard trước tiên là **danh sách việc cần làm và các bộ đếm có thật**: phòng trống, tin cần xác nhận lại, yêu cầu chưa trả lời. Biểu đồ lượt xem/lưu/liên hệ chỉ xuất hiện sau khi hệ thống đã thu sự kiện thật, có ngày bắt đầu đo và chú thích định nghĩa chỉ số.

## 4. Các hướng đã cân nhắc và quyết định

| Hướng | Giá trị | Độ khó/rủi ro | Nhận định |
| --- | --- | --- | --- |
| A. Chỉ thêm bảng tính và so sánh cho tenant | Ra giá trị nhanh, tận dụng search/map/saved | Nhiều khoản phí và trạng thái vẫn thiếu; người thuê vẫn phải ra ngoài để hỏi | Tốt làm bước mở đầu, không giải quyết nguồn thông tin. |
| B. Xây workspace chủ trọ và dashboard đầy đủ trước | Tạo nguồn cung do người đăng cập nhật | Quyền sở hữu, ảnh, liên hệ và analytics cần dữ liệu/sự kiện mới; chậm thấy giá trị thuê | Quá nặng nếu mở toàn bộ cùng lúc. |
| **C. Vòng khép kín có kiểm soát** | Tin tự đăng đủ phí → so sánh thật → yêu cầu liên hệ → cập nhật tình trạng; tận dụng nền tảng hiện tại | Cần duyệt chủ trọ pilot và tách tin crawl với tin có chủ quản lý | **Đề xuất chọn**; bắt đầu với nhóm chủ trọ pilot, mở rộng khi quy trình chạy ổn. |

Các biến thể nên kiểm chứng trong hướng C: “bảng chi phí trước khi xem căn”, “shortlist thay cho lướt vô hạn”, “checklist câu hỏi theo dữ liệu thiếu”, “mỗi tòa một trang, mỗi phòng một trạng thái”, “hộp thư liên hệ theo phòng”, “tự xác nhận còn trống theo chu kỳ”. Không cần biến chúng thành sáu sản phẩm độc lập.

## 5. Ưu tiên theo lợi ích, độ khó và dependency

| Nhóm | Lợi ích | Độ khó | Phụ thuộc quyết định |
| --- | --- | --- | --- |
| Shortlist + so sánh 2–4 căn | Cao | Thấp–trung bình | Saved hiện có; đọc lại listing/offer; trạng thái tin. |
| Bảng chi phí + tiền đầu vào + kịch bản sử dụng | Rất cao | Trung bình | Mô hình phí rõ **bắt buộc/tùy chọn**, đơn vị kWh/m³/người/tháng, cơ sở giá thuê theo phòng hay theo người; dữ liệu thiếu không tính bằng 0. |
| Kiểm tra commute và POI theo từng căn | Cao với người đi học/đi làm | Trung bình | OSRM/POI hiện có, giới hạn số route và chỗ lưu điểm đến riêng tư. |
| Địa điểm → phòng → tin/giá + ảnh | Rất cao cho Landlord | Trung bình–cao | Quyền quản lý, xác minh địa điểm, upload an toàn, xử lý trùng với nguồn crawl. |
| Tình trạng trống và yêu cầu liên hệ | Rất cao | Trung bình–cao | Tin có người quản lý hợp lệ, chống spam, ủy quyền đọc yêu cầu và vòng đời trạng thái. |
| Dashboard hiệu quả/biểu đồ | Trung bình sau khi có lưu lượng | Cao | Event có định nghĩa, chống bot/trùng, quyền theo địa điểm, thời gian thu thập đủ dài. Không backfill số giả. |
| Giá tương tự, giá bất thường, lịch sử giá | Có ích khi dữ liệu đủ | Cao | Snapshot giá qua thời gian, cohort tương đồng, chất lượng diện tích/loại tin, ngưỡng mẫu, provenance. |

## 6. Phạm vi theo giai đoạn

### MVP — một vòng đăng, cân nhắc và liên hệ chạy thật

- **Tenant:** giữ search/map/chat; shortlist qua nhiều lần tìm; so sánh 2–4 căn; bảng tiền thuê/cọc/phí đã biết và “cần hỏi”; kịch bản điện/nước khi có biểu giá; route theo yêu cầu; xác nhận lại tin trước khi liên hệ. Hiển thị nhãn nguồn và độ mới, không dùng một điểm số “căn tốt nhất”.
- **Landlord pilot:** một tài khoản có thể tạo nhiều địa điểm và phòng trong mỗi địa điểm; bản nháp, upload ảnh, đăng sau duyệt, sửa giá/phí, ẩn/xóa mềm, đánh dấu còn trống/đã thuê, xác nhận lại tình trạng; inbox liên hệ theo phòng với trạng thái xử lý. Dùng quyền quản lý của từng địa điểm; chưa mở tự nhận quyền với tin crawl.
- **Vận hành:** kiểm duyệt quyền đăng và ảnh, chống tin trùng/spam cơ bản; thu event chuẩn từ lúc ra mắt. Dashboard chỉ hiện số có bằng chứng hoặc empty state “Chưa đủ dữ liệu”, không vẽ biểu đồ thử nghiệm trong tài khoản thật.

### Phase 2 — sau khi có nguồn tin và hành vi thật

- Biểu đồ xem → lưu → liên hệ, xu hướng theo phòng/tòa và kỳ thời gian; tách impression khỏi lượt xem chi tiết và yêu cầu liên hệ; lọc bot/trùng. Gợi ý cải thiện tin dựa vào trường thiếu và funnel thực, không hứa tăng chuyển đổi.
- Giá/m² và dải giá của căn **tương đồng** khi đủ mẫu theo khu vực, loại căn, diện tích và thời điểm; hiển thị cỡ mẫu và điều kiện so sánh. Lịch sử giá chỉ từ các lần thay đổi/snapshot thật sau mốc bắt đầu lưu.
- Phân quyền người quản lý theo địa điểm, thao tác hàng loạt, nhắc xác nhận phòng còn trống, hẹn xem phòng và ghi chú riêng sau buổi xem.

### Future — chỉ khi đã chứng minh nhu cầu

- Tích hợp hợp đồng, thu tiền thuê, bảo trì hoặc phần mềm quản lý khác; dự báo nhu cầu/giá và xếp hạng cá nhân hóa có kiểm chứng; dữ liệu giao thông theo giờ nếu có nguồn đáng tin. Đây không phải điều kiện để Tenant chọn nhà hay chủ trọ đăng tin.

## 7. Quy tắc sản phẩm phải chốt trước technical design

### Chi phí và so sánh

- **Tiền thuê cơ bản**, **phí cố định bắt buộc**, **phí tùy chọn**, **phí theo sử dụng**, **tiền cọc có thể hoàn lại** và **phí một lần không hoàn lại** là các nhóm riêng. Tổng tháng xác định được = thuê + phí cố định bắt buộc có giá trị; thiếu khoản bắt buộc thì hiện **“Tạm tính từ các khoản đã biết”**, không gọi là tổng cuối.
- Kịch bản = tổng xác định được + kWh × đơn giá điện + m³ × đơn giá nước + phí theo người/xe phù hợp. Chỉ tính thành phần có cả lượng và đơn giá; hiển thị lượng do người dùng nhập, đơn giá do chủ khai, ngày cập nhật và nguồn. Không lấy một mức tiêu thụ mặc định rồi trình bày như thực tế.
- **Tiền cần chuẩn bị lúc vào ở** hiển thị cọc + tháng thuê đầu + khoản trả trước/phí một lần đã biết. Cọc được ghi rõ là dòng tiền ban đầu, không cộng vào “chi phí tháng”. Nếu giá là theo người/giường hoặc chu kỳ không phải tháng, cần nhãn và quy tắc quy đổi rõ; không so trực tiếp với thuê nguyên căn.
- Giá/m² chỉ tính từ tiền thuê tháng và diện tích hợp lệ, không dùng khi diện tích hoặc đơn vị giá không chắc. So sánh giá thị trường chỉ khi có cohort đủ mẫu; không gắn nhãn “giá bất thường/lừa đảo” cho tin đơn lẻ chỉ dựa trên giá.
- Route là thời gian/distance từ OSRM theo profile và graph hiện có, không phải ETA giao thông thực. Vị trí gần đúng không được trình bày như cổng vào tòa; nếu route thất bại, giữ kết quả khác mà không tạo số ước lượng giả.

### Tin, chủ thể quản lý và tương tác

- Tin crawl hiện tại được giữ như nguồn tìm kiếm. Tin tự đăng có chủ thể quản lý, trạng thái phòng do họ xác nhận và mốc xác nhận. Không gộp hai tin chỉ vì cùng pin; chỉ liên kết tin nguồn với tòa/phòng sau khi kiểm tra địa chỉ, tầng/tòa/mã căn và quyền quản lý.
- `active` trong kho hiện tại là trạng thái dữ liệu, **không** chứng minh phòng còn trống; “chủ đã xác nhận còn trống” cần mốc riêng. Xóa trên workspace trước hết ẩn khỏi tìm kiếm và giữ dấu vết cần thiết; không cho một chủ sửa tin của người khác.
- Một yêu cầu liên hệ thuộc một phòng và một người thuê. Người thuê chủ động gửi; chủ/manager được phân quyền mới thấy nội dung, phản hồi và cập nhật trạng thái. Không biến lượt bấm mở nguồn ngoài thành một lead đã xử lý trong ReloHome.
- Chủ trọ/người quản lý địa điểm và moderator của nền tảng là hai vai trò khác nhau: moderator duyệt quyền/tin/ảnh và xử lý báo cáo; chủ trọ không tự duyệt tin của mình hoặc xem yêu cầu của địa điểm khác.
- Mọi số liệu chủ trọ xem phải là event được ghi thật, có định nghĩa, mốc bắt đầu thu, phạm vi và quyền xem. Lượt lưu hiện tại là snapshot trạng thái; không đủ để dựng chuỗi lịch sử lượt lưu.

## 8. Dữ liệu và ranh giới kiến trúc cần bổ sung về sau

Đây là **nhóm thông tin**, không phải schema hoặc API design:

1. **Quyền:** chủ thể quản lý/địa điểm, vai trò chủ hoặc người được ủy quyền, trạng thái duyệt và bằng chứng quyền quản lý; gắn với tài khoản hiện có qua backend tin cậy.
2. **Cấu trúc nhà:** địa điểm/tòa, địa chỉ và độ chính xác, mã tòa/tầng/phòng, tiện ích chung so với riêng, sức chứa, trạng thái phòng và mốc xác nhận. Mỗi phòng có định danh ổn định, không dựa trên tọa độ.
3. **Giá và điều kiện:** giá thuê, phạm vi giá (căn/phòng/người/giường), cọc, phí bắt buộc/tùy chọn/một lần, biểu giá điện/nước và đơn vị, internet, xe, dịch vụ, kỳ áp dụng và ai xác nhận.
4. **Media:** file upload, quyền sở hữu, thứ tự, alt text, trạng thái duyệt/xóa. `listing_media` hiện lưu URL nhưng chưa cung cấp upload cho Housing; có thể tái sử dụng **cách kiểm tra ảnh** của Roommate, không dùng chung dữ liệu riêng tư của Roommate.
5. **Tương tác và đo lường:** yêu cầu liên hệ/trạng thái, các sự kiện hiển thị/xem/lưu/liên hệ có thời điểm, nguồn, listing, định nghĩa chống đếm lặp và thời hạn lưu. Không ghi điểm đến cá nhân hoặc nội dung tin nhắn vào analytics.

Tận dụng PostGIS Housing và gateway/tài khoản hiện tại; bổ sung chức năng ghi **trong kiến trúc hiện hữu** với kiểm tra quyền ở server. Không gọi trực tiếp read-only Platform API hiện tại từ browser để ghi, không thêm database/microservice mới vì riêng feature này. Cần technical design đánh giá ranh giới SQLite tài khoản/saved và Postgres Housing, cơ chế upload trong môi trường deploy, concurrency khi hai người quản lý cùng sửa phòng và tương thích contract search/detail/map cũ.

## 9. Giả định cần kiểm chứng và thước đo

| Giả định | Cách kiểm chứng trước khi mở rộng |
| --- | --- |
| Chủ trọ chịu khai đủ phí và xác nhận tình trạng nếu form đủ ngắn | Pilot với chủ trọ có phòng thật; đo thời gian tạo tin, tỷ lệ điền phí, tỷ lệ xác nhận lại và lý do bỏ dở. |
| Bảng chi phí và shortlist giúp người thuê ra quyết định hơn danh sách thông thường | Test tác vụ với người thuê: chọn 1 trong 3 căn có cọc/phí khác nhau; quan sát họ hiểu “đã biết” và “chưa rõ” không, sau đó theo dõi hành vi so sánh → liên hệ. |
| Có thể xác minh người đăng và tránh trùng với nguồn crawl | Duyệt thủ công pilot; rà một mẫu tin cùng địa chỉ nhưng khác tầng/phòng/tòa trước khi thiết kế auto-link. |
| Dashboard có dữ liệu đủ tin cậy | Thu event từ ngày triển khai, đối chiếu count với log request, phân biệt view/save/contact; chỉ mở biểu đồ khi có ngày đo và kiểm tra chống lặp. |

Thước đo chính: tỷ lệ tin tự đăng có đủ cấu phần giá và mốc xác nhận còn trống; tỷ lệ người thuê hiểu đúng tổng tạm tính/cọc; tỷ lệ shortlist dẫn tới yêu cầu liên hệ có phản hồi; thời gian chủ trọ trả lời; tỷ lệ báo sai giá hoặc hết phòng. Chốt ngưỡng mục tiêu sau pilot và baseline, không điền số thành tích giả.

## 10. Chưa làm trong đợt đầu

- Không ép mọi tin crawl vào một tòa hoặc cho tự claim bằng tọa độ/địa chỉ gần giống: cùng pin có thể là các căn khác nhau.
- Không gọi LLM cho phép tính, đánh giá giá bất thường, lọc hay phân trang; không tạo “điểm nhà tốt nhất” thiếu căn cứ.
- Không vẽ biểu đồ lịch sử hay lịch sử giá từ một snapshot hoặc từ các bản ghi `saved` hiện tại.
- Không thu cọc/tiền thuê, ký hợp đồng hay triển khai ERP quản lý tòa nhà trong MVP: cần quy trình vận hành và trách nhiệm khác.
- Không công bố tin nguồn là “chủ đã xác minh”, “còn trống” hoặc “tổng chi phí” khi chưa có bằng chứng tương ứng.

## 11. Chia việc Tenant và Landlord để ít xung đột

Chia theo **luồng nghiệp vụ và thư mục sở hữu**, không chia một người làm frontend, một người làm backend: cách đó buộc cả hai sửa cùng `App.tsx`, gateway và contract liên tục. Hai nhánh feature tách khỏi `QuangDung`; chỉ merge bằng PR sau khi chạy test của từng nhánh và kiểm tra contract chung.

| Người phụ trách | Sở hữu chính | Không sửa trực tiếp trong nhánh của mình |
| --- | --- | --- |
| **Nhánh Tenant** (người làm phía người thuê) | Shortlist, bảng so sánh/chi phí, kịch bản sử dụng, route/POI trong quyết định, câu hỏi cần hỏi, UX và test tenant. Tạo component/CSS/test riêng dưới khu vực Housing tenant; tận dụng `Housing.tsx`, `Results.tsx`, `MapWorkspace.tsx` theo PR nhỏ. | Migration, importer, quyền chủ trọ, ghi tin và inbox; không tự đổi nghĩa trường giá/phí. |
| **Nhánh Landlord** (người làm chủ trọ/quản trị) | Quyền quản lý, địa điểm/phòng/tin/offer, upload, publish/ẩn/tình trạng, yêu cầu liên hệ, event analytics và test backend/landlord. Tạo module UI và backend riêng cho nghiệp vụ này. | Bảng so sánh tenant, map/Agent hiện có; không đổi search/detail/map contract cũ theo cách làm UI tenant hỏng. |
| **Người tích hợp duy nhất** (hai bạn cử một người cho từng đợt merge) | Các điểm vào app và file dùng chung: `Frontend/src/App.tsx`, `Frontend/server.py`, `Frontend/src/types.ts`, `packages/contracts/src/housing.ts`, `apps/platform-api/src/app.ts`, route registration, token/style toàn cục, tài liệu contract và regression. | Không làm thay toàn bộ code của hai nhánh trong một PR lớn. |

**Thứ tự để hai bên có thể làm song song:**

Người làm nhánh Landlord cũng có thể làm màn duyệt của **moderator nền tảng**, nhưng phải kiểm thử quyền riêng; “chủ trọ” không đồng nghĩa với “quản trị viên hệ thống”.

1. Cùng chốt một trang thuật ngữ/contract trước khi code: `property` = địa điểm/tòa, `unit` = phòng/căn cụ thể, `listing` = tin công khai, `offer` = giá/điều kiện theo thời gian; phân biệt tin nguồn với tin tự đăng, phí bắt buộc/tùy chọn, trạng thái đăng và trạng thái trống. Chốt ví dụ một tòa hai phòng và một tin nguồn thiếu phí. Người Landlord chịu trách nhiệm triển khai nguồn dữ liệu; người Tenant review dữ liệu đọc cần cho bảng quyết định.
2. PR nền tảng nhỏ do người tích hợp/nhánh Landlord thực hiện: contract **bổ sung** cho trường phí/trạng thái, quyền đọc theo người dùng, fixture/test contract. Không đổi hoặc xóa trường Housing đang dùng. Sau khi PR này được duyệt, hai nhánh phát triển song song; Tenant dùng fixture hợp đồng trong test chứ không dựng dữ liệu giả vào sản phẩm.
3. Tenant làm component và test trong phạm vi của mình; Landlord làm module ghi, quyền và UI quản lý. Nếu cần thêm trường chung, tạo một PR contract nhỏ trước, cả hai cập nhật sau. Không để hai PR cùng chỉnh migration hoặc file điểm vào.
4. Người tích hợp nối route/navigation, hợp nhất vào `QuangDung` theo thứ tự nền tảng → Landlord backend → Tenant UI → Landlord UI → kiểm thử end-to-end. Nếu thay đổi đọc phụ thuộc dữ liệu do chủ nhập, dùng nhãn “Chưa có dữ liệu” cho tin nguồn và vẫn chạy được trước khi có chủ trọ pilot.
5. Gate cuối: tạo tin ở hai phòng cùng tòa, sửa phí một phòng, người thuê lưu/so sánh/liên hệ đúng phòng, chủ xử lý yêu cầu, tin đã thuê biến khỏi luồng liên hệ mới; đồng thời Housing/Moving/Flight/Roommate cũ vẫn qua regression.

Ưu tiên giữ CSS theo phạm vi Tenant/Landlord và tránh sửa token toàn cục song song. Mỗi PR nêu rõ file chung đã chạm, contract trước/sau và test đã chạy. Phần dữ liệu crawl do chủ sản phẩm xử lý riêng; hai nhánh không đồng thời chạy importer hoặc sửa nguồn JSONL trong lúc xây tính năng.

## 12. Cần chốt cùng chủ sản phẩm trước product spec

1. Pilot chủ trọ bắt đầu ở một thành phố hay cả Hà Nội/Đà Nẵng/TP.HCM? Kho tìm kiếm có thể giữ phạm vi hiện có; câu hỏi này chỉ ảnh hưởng vận hành duyệt tin mới.
2. Ai duyệt quyền đăng và ảnh trong pilot, với thời gian phản hồi mong muốn nào? Nếu chưa có người duyệt, cần giới hạn publish thay vì mở tự đăng công khai.
3. Mức liên hệ mặc định: hộp thư trong app như đề xuất hay chỉ chuyển sang kênh do chủ trọ công bố? Hộp thư cho phép đo phản hồi và bảo vệ thông tin tốt hơn nhưng cần vận hành.
4. Chủ trọ được mời quản lý một tin crawl có sẵn sau khi xác minh quyền, hay trước mắt chỉ tạo tin mới? Đề xuất **chỉ tạo tin mới trong MVP**; rà trùng và claim ở Phase 2.

## Nghiên cứu tham khảo

Các nguồn dưới đây chỉ là ví dụ sản phẩm, **không phải bằng chứng ReloHome đã có tính năng**:

- [Zillow: giá thuê tháng gồm tiền thuê cơ bản và phí cố định bắt buộc; phí biến thiên/tùy chọn tách riêng](https://www.zillow.com/rentals-network/pricing-transparency/). Gợi ý cho cách hiển thị “tổng đã xác định” so với kịch bản tiêu thụ.
- [Apartments.com: quản lý nhiều phòng trong một địa điểm](https://propertyhelp.apartments.com/article/620-how-do-i-list-multiple-units-on-apartments-com). Gợi ý để chủ trọ không tạo một tòa trùng lặp cho mỗi phòng.
- [Apartments.com: phân biệt impression, view và lead](https://www.apartments.com/rental-manager/resources/advertising-your-property/rental-listing-analytics-impressions-vs-views-vs-leads). Gợi ý định nghĩa dashboard dựa trên sự kiện thật.
