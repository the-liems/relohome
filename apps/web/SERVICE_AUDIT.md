# Kiểm tra frontend và từng tool dịch vụ

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## Production UI — lượt mới nhất 07/10/2026

**124 browser cases: 120 pass + 4 live opt-in skip trong lượt full**;
**8/8 gateway/UI contract pass**, build qua. Axe và keyboard qua các màn
đại diện; responsive navigation/account/Moving/Flight ở 320/768/1024/1440
qua, welcome các viewport thấp vẫn đủ thao tác. Không che launcher kế hoạch,
dialog giữ/return focus; theme không tạo contrast lỗi tạm thời.

Hồi quy chữ dính sau redesign đã sửa: input có icon dùng padding riêng,
không viền kép; Moving giữ A/B và căn đã chọn, thêm navigation trong form,
giải thích catalog cần ghim A. Chat không che Về hội thoại ở mobile/tablet,
nhãn bước xuống dòng; Flight timeline, housing/chat/history qua kiểm tra
vị trí chữ/icon thực tế. Hai ca mới chạy trên desktop/mobile, 4/4 qua.

Static baseline: 279 backend/helper file không đổi; api/send/mutate và
decision/quote/action expressions không thêm/bớt/đổi. Endpoint/schema,
payload/price/expiry/auth/permission/camera/OSRM/helpers giữ nguyên.

Build thật 8503: landing/login 4 breakpoint, light VI → dark EN giữ input,
axe zero trong phạm vi quét, không pageerror/console error (401 session guest
là expected). Không tạo QA account, submit auth/profile/chat/quote/order/
payment hoặc sửa database ở lượt live. 6 health endpoint 200; read thật
housing/search/detail, POI và AhaMove catalog qua. Location còn gợi ý sai
tên query; giữ logic/data, không hợp thức hóa bằng dữ liệu giả.

Xem [audit/design/finish gate](PRODUCTION_UI_AUDIT.md). Artifact local:
logs/local/frontend-production/, Frontend/test-results/.

Các mục dưới là lịch sử những lượt trước.

## Landing, Cẩm nang và gói xe — lượt mới nhất 07/10/2026

Landing công khai tại `/`, CTA vào `/ai` theo auth/session hiện có. Mục
Ghép trọ và Cẩm nang ghi rõ đang chuẩn bị; không gọi endpoint chưa có.
Ảnh nhà/hồ cá koi lưu local, có alt/caption minh họa. Theme/VI/EN và menu
mobile hoạt động; chatbot không bị nhúng vào trang giới thiệu.

Gói AhaMove chia theo loại xe, chọn trực tiếp thẻ có tên/cỡ xe/mô tả thật.
Đã bỏ bộ lọc tải trọng và ô Gói khác. ECO/POOL thuộc xe máy; mua hộ/gói
chưa xác định loại vận chuyển không hiện trong lựa chọn mới. Bán tải/ba gác
chỉ hiện nếu catalog có. Catalog backend không sửa, gói đã chọn giữ ID cũ.
Giữ addon, COD, quote typed PR #53 và
quy trình xác nhận. Chỉ khi người dùng chọn tự chọn xe mà chưa chọn gói,
frontend nhắc chọn gói hoặc quay về ReloHome gợi ý. Không sửa backend hay data.

Guide có SVG từng loại xe, mở bằng hover/focus/click, có nút đóng, VI/EN,
sáng/tối. Hover chỉ xem, không chọn xe hoặc gọi quote; mở lại loại đang
chọn không xóa addon/COD/ghi chú. ReloHome gợi ý giải thích bước so sánh báo giá,
không hứa tự đặt xe hoặc phương án tối ưu chưa được kiểm chứng.

Rà lại theo phản hồi chọn Van: danh sách/tiêu đề theo loại đã bấm, không
chen gói của loại cũ. Hover xe khác vẫn giữ Van; catalog refresh và VI/EN
không đổi loại/gói. Sửa CSS input văn bản áp nhầm cho radio: radio 16 px,
thẻ chưa chọn gọn, mô tả/mã hiện ở gói đang chọn. **20/20 ca Moving có mục
tiêu qua**, gồm ca Van 500/750/1000 trên desktop/mobile.
Build thật 8503 tại viewport 1920×990 cũng qua: catalog HCM trả đúng
`SGN-VAN-500`, `SGN-VAN-750`, `SGN-VAN-1000`; sau chọn Van chỉ có ba gói
này, radio đều 16×16 px, không có lỗi JavaScript. Chỉ đọc catalog và chọn
trên UI; không gửi chat/quote/order/payment. Bằng chứng:
`logs/local/product-runtime-20261007/van-live.json`, `live-van-only.png`.

**Browser tổng 110 ca**: full **105 pass, 4 live opt-in skip, 1 lỗi mạng Chrome
`ERR_NETWORK_IO_SUSPENDED` tại goto**; chạy lại ca lỗi **1/1 pass**. Tổng
**106 ca đã xác minh qua**, không sửa code/test để bỏ qua lỗi môi trường.
**8/8 contract qua ở lượt trước**,
build qua. Read build thật 8503: landing/ảnh/auth CTA/catalog/theme-pin-ID
đều qua; chọn thẻ gói từ catalog HCM thật, hover xem xe máy vẫn giữ gói xe
tải, không có select tải trọng hoặc Gói khác. Không lỗi JS, không gửi
chat/quote/order/payment thật. Sáu health endpoint 200 ở lượt startup.
`.env`, integration.env và housing nguồn khớp hash trước đợt frontend;
`git diff` của `src/`, `Frontend/server.py`, `Maps VN/` rỗng.

Artifacts local: `logs/local/product-runtime-20261007/landing-live.json`,
`live-landing-koi.png`, `live-motorbike-guide.png`, `live-vehicle-guide-dark.png`, `Frontend/test-results/`.

Các mục sau là lịch sử những lượt kiểm tra trước.

## Khởi động và rà build thật — 07/10/2026

UI 8503, Agent 8000, Platform 4100, Location 4300, Moving 4200/4400 đều
sẵn sàng; PostGIS và 9 OSRM đang chạy. Read thật housing/search/detail,
Location/POI và catalog AhaMove qua. **13/13 bước browser trên build thật**,
**96/96 regression UI**, **8/8 contract qua**; 4 live opt-in skip. Không
chạy thêm LLM/Flight search, quote, order hay payment thật. Chỉ bổ sung
nhãn EN và repaint map từ style.load; không đổi business/backend/data.
Location còn trả gợi ý không khớp tên trong ca Bưu điện Trung tâm Sài Gòn;
được ghi nhận, không sửa logic. Xem [báo cáo runtime](RUNTIME_CHECK_2026-10-07.md).

## Giao diện sản phẩm và bảo toàn luồng — 07/10/2026

Thay bảng màu, chữ/khung, dấu hiệu thương hiệu; thêm theme sáng/tối và
nhãn Việt/Anh lưu trên trình duyệt. Giữ Agent/API, pin A/B, catalog thật,
quote form PR #53, guard ngày giờ/phê duyệt và write flags hiện có.

**96/96 browser regression qua** trên desktop/mobile trong một lượt;
**4 ca live opt-in skip**. **8/8 Python gateway/UI contract qua**. Build
TypeScript/Vite qua. Kiểm tra mới xác nhận đổi theme/locale không gửi thêm
yêu cầu chat, không mất nháp/form, không dịch địa chỉ/ghi chú và không đổi
payload/giá trị preferences. Map đổi paint, giữ canvas/marker/tuyến.

Fixtures báo giá có cả hai pin được đồng bộ typed endpoint `/moving/quote`;
ca chưa đủ pin vẫn dùng `/chat`. Không đổi logic sản phẩm để test qua.
Đã xem ảnh sáng/tối và EN/VI desktop/mobile. Backend/service/.env/housing
không sửa trong đợt này. Chưa chạy thêm LLM/provider hay transaction thật;
các lỗi backend fixture đã thấy khi lấy PR #53 không được che bằng việc
bật simulation. Chi tiết cấu trúc theme/locale và lệnh test ở [README](README.md).

Các mục bên dưới ghi nhận từng đợt kiểm tra trước đây.

## Điểm B và housing chung pin — 05/10/2026

Căn trong ảnh có fact `selected:property`, nhưng không có snapshot property
và không nằm trong candidates chat. Frontend nay dùng endpoint chi tiết
hiện có để khôi phục đúng căn theo ID. Ô căn đã chọn nằm dưới B, cho phép
chọn lại sau khi nhập địa chỉ khác; không ghi đè B người dùng nhập khi fetch
về chậm, không tự xác nhận tọa độ gần đúng. **10/10 browser qua** trên hai
viewport; build qua. GET chi tiết căn thật trả 200 trong khoảng 0,62 giây.

Đọc toàn bộ 38.222 housing active: tọa độ khớp file nguồn và staging gốc
38.222/38.222; 33.761 tin dùng chung tọa độ. Căn đã chọn chung pin với 9 tin
khác, nguồn ghi `approximate/source_map`. Không chỉnh tọa độ, xóa housing,
gọi thêm LLM/provider hoặc sửa backend ở lượt này. Nhãn nhóm map nay nói rõ
đây là các tin dùng chung điểm, chưa xác nhận cùng một căn. Tổng suite hiện
có 88 ca; số 82 bên dưới ghi nhận thời điểm rà Moving/Flight trước lượt này.

## Rà giao diện Moving/Flight, không sửa logic backend — 05/10/2026

Trọn bộ **78/78 browser qua**. Bổ sung hồi quy giá hết hạn trong thẻ chat/chi
tiết: **16/16** ca liên quan qua; header Flight mobile **2/2 qua**. Suite hiện
có 82 ca, chưa chạy lại cả 82 cùng một lượt. Gateway/UI contract **6/6 qua**;
4 payload Moving capture từ browser qua schema Agent API. Build qua.

Chỉ sửa React/CSS/test/docs: mô tả kiện trống không gửi chuỗi rỗng; Flight
chặn nơi đi/đến trống/trùng; Moving/Flight tự cập nhật nút chọn khi hết hạn;
catalog rỗng có thông báo/tải lại; bố cục header Flight mobile gọn hơn.
Đã xem ảnh hai viewport và kiểm tra build thật trên 8503 với API fixture,
basemap công khai thật. OSRM driving ba thành phố trả tuyến có hình học;
UI/Agent/Platform/Location/Moving API/MCP health/ready đều 200 khi kết thúc.
Không gọi thêm LLM/SerpApi/báo giá AhaMove hoặc đặt đơn/thanh toán thật.

## Moving mở rộng — 05/10/2026

Đã nối các trường form mới qua gateway/Agent tới báo giá và báo giá lại theo
cho phép của người dùng. Có kiện/kg/cm, gói xe theo tọa độ A, add-on/số lượng/mức,
khai giá/COD, mã giảm giá, ghi chú và POD/xác minh; liên hệ/tòa nhà/tầng/chỉ dẫn
gửi riêng ở bước xác nhận. Giữ CASH, phê duyệt/hash/expiry, kiểm giá và idempotency.

**62/62 browser qua trọn bộ; 50/50 Python có mục tiêu qua; Ruff/build qua.** Hai
báo giá AhaMove staging thật cùng gói/tuyến: cơ bản 162.000đ, có bốc xếp 237.000đ,
phí thêm 75.000đ. Không tạo đơn, thanh toán hoặc gọi LLM. Suite Python rộng còn
17 lỗi đã tái hiện trên HEAD trước sửa và hai ca phụ thuộc môi trường.

[Chi tiết và phạm vi](../../docs/integration/moving-service-workspace-update-2026-10-05.md).
Các kết quả bên dưới là bằng chứng của các đợt trước.

## Cập nhật kiểm tra người dùng và UI — 05/10/2026

Đợt mới đã chạy toàn bộ **50 ca browser ban đầu**, **7 ca Python frontend**,
kiểm tra thật chuỗi Location → Housing và một lần tìm Flight SerpApi. Hai tình
huống browser mới đã bổ sung; sau sửa **10/10 ca liên quan qua** trên desktop/mobile.
Kiểm tra ảnh kế hoạch/tài khoản/Moving thêm **6/6 qua**. Hiện có 54 ca browser,
đã qua các lượt, chưa chạy toàn bộ 54 trong một lượt.

Sửa source chỉ ở React: mã sân bay chi tiết Flight, response chi tiết về chậm,
và lỗi lựa chọn bị giấu khi chat workspace thu gọn. Build qua, bản mới đang được
phục vụ tại 8503. Không đổi backend, cấu hình, dữ liệu hay capability.

Local hiện có cấu hình SerpApi/ZaloPay, khác với ghi nhận credentials của audit
01/10 bên dưới. Có key không đồng nghĩa giao dịch đã sẵn sàng:
`writes_enabled=false`, `flight_booking_enabled=false`, `sandbox_payments_enabled=false`.
Flight MCP thực tế chỉ công bố 3 tool đọc; không có luồng xuất vé thật. Payment
MCP có create/get/cancel/refund, nhưng chưa tạo hay thanh toán thật trong đợt này.
Không gọi LLM nên chưa kiểm chứng suy luận hoặc hội thoại đa dịch vụ thật.

Suite Python Flight/Payment còn **6 failed**: 5 ca simulation Flight và 1 ca
allowlist Payment lệch payload thời hạn. Không sửa runtime để chiều theo fixture.
Chi tiết luồng, bằng chứng và ưu tiên còn mở:
[báo cáo 05/10](../../docs/integration/user-service-ui-audit-2026-10-05.md).

## Audit gốc và bằng chứng lịch sử

Audit service gốc: **01/10/2026**. Cập nhật mô tả giao diện và kết quả kiểm tra UI: **03/10/2026**. Audit gốc đọc source service, schema đầu vào/đầu ra, adapter/graph, gateway và React. Các bằng chứng tool/provider/Python bên dưới là kết quả của đợt cũ, không phải các lần gọi lại ngày 03/10. Đợt kiểm tra UI mới dùng API giả lập và chỉ đọc health/status local; không gọi LLM, tạo đơn hay thanh toán thật.

## Kết luận và phạm vi bằng chứng

**Frontend đáp ứng luồng MVP chính, chưa bao phủ mọi tool của service. Chưa thể kết luận chỉ cần gắn LLM là toàn bộ hệ thống chạy được.**

Giao diện hiện tại: chat toàn màn hình, bỏ sidebar trái, kế hoạch ba tab ở mép phải, tài khoản qua avatar/tên trên header. Lịch sử thay đường tới danh sách kế hoạch cũ. Chi tiết và hướng dẫn chạy: [README](README.md); phạm vi kiểm thử: [tests/README.md](tests/README.md).

Các thông tin credentials, provider và dữ liệu trong các gạch đầu dòng tiếp theo ghi nhận từ audit service ngày 01/10, chưa được xác minh lại toàn bộ ngày 03/10.

- Housing/Location: database có sẵn `lifeflow` tại 5433; đã xác minh 38.222 tin ở lượt trước. Đợt này gọi trực tiếp cả 9 tool đọc Location thành công.
- Routing: đã khởi động lại container có sẵn. 9 endpoint OSRM của 3 thành phố × 3 phương tiện phản hồi `Ok`; đã thử hai tool tính đường qua MCP với tọa độ tại HCM. Kiểm tra `nearest` ở các thành phố còn lại không thay thế kiểm thử mọi tuyến đường.
- AhaMove: form Thông tin chuyển đồ, card báo giá, lựa chọn, chi tiết phí, phê duyệt, biên nhận, giá/link theo dõi đã có. (01/10) **Đã báo giá thật trên AhaMove staging** qua Moving MCP (chỉ báo giá, không tạo đơn); lý do từ chối của provider (ví dụ đặt quá 7 ngày) được hỏi lại người dùng. Đặt/hủy đơn thật chưa kiểm chứng.
- Flight: form và card/chọn offer đã có; cần `FLIGHT_SERPAPI_API_KEY` để tìm thật. Xuất vé không được bật vì backend hiện chỉ có booking giả lập.
- Payment: có renderer trạng thái, link/QR workflow, kiểm tra thanh toán và biên nhận. Chưa có form tạo ZaloPay sandbox độc lập trong React; chưa có giao diện refund. Máy chưa có key ZaloPay.
- LLM: giao diện gửi hội thoại/form tới graph hiện tại. **Form tìm kiếm chuyển thành yêu cầu chat, vẫn cần Intake/Planner/subagent LLM để xử lý đầy đủ.** Fixture chỉ nằm trong test; app không thay dịch vụ lỗi bằng dữ liệu giả.

## Trang và tương tác người dùng

| Trang / màn hình | Có gì | Giới hạn |
| --- | --- | --- |
| Đăng nhập / đăng ký | Session HttpOnly; tài khoản lưu SQLite | Chưa có xác minh email, quên mật khẩu, SSO |
| `/ai` | Chào người dùng, 4 nhóm tác vụ, form, gợi ý, áp dụng sở thích | Tác vụ cần LLM; danh sách domain đăng ký chưa chứng minh provider đang khỏe |
| `/ai/:threadId` | Chat, hỏi bổ sung, kết quả dịch vụ, lịch sử, lựa chọn, chi phí, phê duyệt, biên nhận | Chờ theo lượt; chưa stream token/tool progress |
| Chi tiết nhà | Dialog có URL theo hội thoại/kết quả; ảnh, giá, nguồn, lưu/chọn/hỏi AI | Dữ liệu thiếu hiển thị chưa có; không tự nhận là tin còn trống |
| So sánh nhà | Tối đa 3 căn từ kết quả đã tải | Không so sánh toàn bộ DB |
| Bản đồ / workspace nhà | Danh sách theo viewport, sort, marker/cụm, POI tự hiện ở zoom ≥ 14, route, cảnh báo độ chính xác, chat ẩn/hiện | Khám phá viewport không áp dụng commute/bán kính; chọn nhà từ map dùng action/API kiểm tra lại tin |
| Chuyển đồ | A/B tìm/ghim map, ngày giờ, kiện hàng, gói xe, add-on theo danh mục, COD/khai giá/ghi chú/mã giảm giá, POD/xác minh; báo giá/phê duyệt/biên nhận | CASH; chưa có add-on nhập tự do, nhiều điểm giao, quản lý nhiều đơn, timeline callback hoặc rating |
| Phê duyệt | Chi phí, thao tác, thời hạn, form liên hệ riêng, xác nhận/đổi/từ chối | Chỉ chấp nhận các thao tác Moving UI hỗ trợ; chưa có giao diện operator đối soát giao dịch bất định |
| Thanh toán workflow | Link provider, QR sinh tại máy chủ, kiểm tra trạng thái; link hết hạn bị khóa | Không tự coi callback/lời người dùng là đã trả tiền; chưa có trang tạo demo độc lập/refund |
| Panel Kế hoạch ở mép phải | Tiến trình, Chi phí, Cần phản hồi của hội thoại đang mở; tổng tháng/một lần, biên nhận, form xác nhận/thanh toán hiện có | Không còn tab Các kế hoạch; trạng thái tìm kiếm không phải tiến độ chuyển nhà ngoài đời; không có lịch/reminder riêng |
| `/plans`, `/plans/:planId` — URL cũ | `/plans` chuyển tới `/account`; `/plans/:planId` mở đúng chat và panel kế hoạch | Không còn trang Kế hoạch riêng |
| `/account` | Lịch sử từng yêu cầu/phản hồi, tìm/lọc/mở chat; hồ sơ, bảo mật, sở thích, nhà đã lưu, đăng xuất | Không phải log từng tool/LLM; chưa đổi/khôi phục mật khẩu; sở thích không tự áp dụng thay yêu cầu mới |

Map/AhaMove/Flight có workspace theo kết quả và tương tác qua chat. Trong workspace, mặc định chỉ hiện nút Chat với ReloHome; mở thanh nhập nhỏ và thu gọn bằng mũi tên xuống, không còn khối tóm tắt/Xem đầy đủ. Bố cục hiện tại không có sidebar trái; kế hoạch nằm bên phải, tài khoản và Lịch sử nằm trên header. Đã sửa mở chi tiết nhà lưu từ map khi căn không nằm trong card chat ban đầu; bản lưu thiếu ngữ cảnh kết quả chỉ xem chi tiết, chọn phương án qua map/kết quả dịch vụ.

## Đối chiếu 34 tool

**Có UI** = đã có đường tương tác/render phù hợp; không đồng nghĩa provider đã chạy thật. **Qua graph** = user yêu cầu bằng chat/form, LLM và code graph quyết định tool. **Một phần / chưa nối** = không nên quảng bá là tính năng hoàn chỉnh.

### Location / Housing / Map — 9 tool

Nguồn: `apps/location-mcp/src/tools/{location,housing,place,routing}-tools.ts`; schema trong `packages/contracts/src/`.

| Tool | Hợp đồng cần giữ | Đường tới frontend / mức đáp ứng |
| --- | --- | --- |
| `search_areas` | Tìm địa giới, trả ID/parent/center/bbox; không phải POI | Qua adapter tìm nhà. Form có thành phố/quận; chưa có picker địa giới chuyên biệt. **Một phần** |
| `resolve_location` | Có thể nhiều ứng viên; dùng ID/vị trí đã chọn, không tự lấy đầu | Picker địa điểm và graph. UI phân biệt khu hành chính, không cho dùng tâm quận như điểm dừng xe. Ứng viên mơ hồ trả `choices` (ID + toạ độ) để chọn bằng pin/nút; POI trùng trong 150 m gom làm một điểm đến cho Map/Housing (01/10). **Có UI** |
| `search_housing` | Bộ lọc cứng, cursor, nguồn, đơn vị tiền/chu kỳ; không tự xếp hạng | Card/list/map, phân trang, so sánh, empty/error; form các tiêu chí chính. Chế độ bản đồ gọi search theo `bounding_box` vùng đang xem, 10 căn/trang, sort chọn được (01/10). Commute/nearby/availability/nhiều filter nâng cao chủ yếu qua chat. **Có UI** |
| `get_housing` | Chính xác `listing_id` từ nguồn | Dialog gọi gateway → MCP; lưu/chọn giữ nguồn task/version. Chọn căn từ bản đồ: backend đọc lại tin bằng tool này trước khi ghi lựa chọn (01/10). **Có UI** |
| `search_places` | Text/category/spatial filter, cursor; không phải tìm nhà | Service chạy được nhưng UI chưa có trình duyệt POI độc lập/phân trang; picker hiện dùng resolve. **Chưa nối đầy đủ** |
| `get_place` | Một `place_id` chuẩn | API dùng để kiểm `place_choice` (ID người dùng chọn) và graph dùng cho `near_place_id`. Chưa có màn hình chi tiết POI riêng. **Một phần** |
| `find_nearby_places` | Điểm đã resolve; gần nhất từng category, khoảng cách đường thẳng | Card POI, map, nút yêu cầu tính đường, nhãn gần đúng. **Có UI qua graph** |
| `calculate_route` | Hai tọa độ; city/profile; trả GeoJSON + mét/giây | Renderer route dùng được; luồng người dùng ưu tiên tool entity bên dưới. **Qua adapter; không có nút gọi raw tool riêng** |
| `calculate_route_between_entities` | Housing/place ID hoặc coordinate; nguồn/độ chính xác/cảnh báo có cấu trúc | Form đường đi/chat → graph; vẽ tuyến và điểm đầu/cuối, km/phút, cảnh báo. **Có UI** |

API `POST /v1/housing/map` phục vụ khám phá viewport là REST bổ sung, không phải một trong 9 MCP tool. UI giữ bộ lọc tương thích, tách cluster khỏi listing, chặn mode khám phá khi filter không hỗ trợ.

### AhaMove / Moving — 13 tool

Nguồn: `apps/moving-mcp/src/create-server.ts`, `packages/contracts/src/moving.ts`, `src/agents/subagents/services/moving_llm.py` và transaction adapter.

| Tool | Hợp đồng cần giữ | Đường tới frontend / mức đáp ứng |
| --- | --- | --- |
| `list_service_areas` | Danh sách thành phố thực tế từ provider | Chat catalog → danh sách khu vực có nút hỏi tiếp. **Có UI qua graph** |
| `list_moving_services` | Theo city/tọa độ, loại dịch vụ; có yêu cầu bổ sung | Form đọc danh mục tại pin A qua endpoint xác thực mới, chỉ trả trường cần cho UI; graph kiểm lại trước báo giá. **Có UI gói/add-on** |
| `get_moving_service` | Giới hạn, mô tả, special requests của service ID | Đọc thêm qua chat; form dùng danh mục với mô tả/tùy chọn/COD và kg/cm. **Chưa mô hình hóa tất cả quy tắc sức chứa/tùy chọn nhập tự do** |
| `estimate_move` | Draft điểm lấy/giao, liên hệ, giờ, dịch vụ; quote có hạn và phí chi tiết | Form mở rộng nối tới báo giá/báo giá lại. Liên hệ báo giá cấu hình server; liên hệ thật nhập riêng. **Hai ca staging 05/10 thành công; chưa đặt đơn thật** |
| `get_move_order` | ID đơn, trạng thái, phí, tracking; payload đầy đủ có PII | Graph rút gọn trước UI; card dùng `total_price`, `shared_link`. **Có UI trạng thái cơ bản** |
| `get_move_orders` | Tối đa 100 order ID | Tool được service/allowlist hỗ trợ; chưa có flow graph và màn hình quản lý nhiều đơn hoàn chỉnh. Renderer nhận `orders[]` chưa đủ để gọi tính năng hoàn chỉnh. **Chưa nối đầy đủ** |
| `find_move_orders_by_tracking_number` | Tracking đối tác; có thể nhiều đơn và khoảng thời gian | Qua chat; adapter hiện lấy một đơn. **Một phần**, chưa có UI chọn khi nhiều kết quả |
| `get_move_tracking_link` | Trả `shared_link` từ provider | Graph đọc link → nút mở theo dõi. **Có UI** |
| `get_move_order_events` | Lịch sử callback theo tracking number | Moving agent có thể gọi nhưng hiện chỉ ghi nhận đã kiểm tra, không trả timeline đầy đủ. **Chưa có UI lịch sử sự kiện** |
| `create_move_order` | Quote còn hạn + approval do server giữ, cost/hash/version đúng | Yêu cầu đặt qua chat → review → form riêng → xác nhận → biên nhận. **Có UI, write mặc định tắt** |
| `update_move_order` | Approval đúng đơn/thao tác, chỉ sửa trường được provider cho phép | Nút yêu cầu sửa → chat → review/form liên hệ, ghi chú và điểm cần sửa. **Có UI phạm vi liên hệ/ghi chú** |
| `cancel_move_order` | ID/tracking, approval, điều kiện/chi phí hủy | Nút yêu cầu hủy chỉ điền yêu cầu chat; cần phương án phê duyệt riêng. **Có UI qua graph** |
| `rate_move_driver` | Đơn hoàn thành, approval, rating flag | Chưa có commit kind/flow graph/UI đánh giá. **Chưa nối; mặc định tắt** |

Chuyển đồ hiện dùng **CASH**. Chi phí dự kiến là báo giá/ước tính; không thu ZaloPay cho đơn AhaMove để tránh thu trùng. Thiết kế mới (Draft, chưa code) đưa vé và chuyển đồ qua đơn thanh toán ZaloPay sandbox riêng từng dịch vụ: xem [payment-design.md](../../docs/review/payment-design.md). API webhook `/ready` còn yêu cầu DB migration Moving và webhook secret đúng, ngoài API key.

### Flight — 7 tool

Nguồn: `src/mcp_servers/flights/tools.py`, `server.py`, schema, `src/agents/subagents/services/flight.py`.

| Tool | Hợp đồng cần giữ | Đường tới frontend / mức đáp ứng |
| --- | --- | --- |
| `search_airports` | Tên/IATA → sân bay nội địa | Graph chuẩn hóa đầu vào form. **Qua graph**, chưa autocomplete sân bay riêng |
| `search_flights` | Một chiều nội địa, tổng giá cho toàn bộ hành khách, offer có hạn | Form tuyến/ngày/người lớn, card giá/giờ/điểm dừng. **Có UI cơ bản**; chưa có form cabin/trẻ em/khứ hồi đầy đủ |
| `get_offer` | ID đã tìm; service còn kèm fare rules giả lập | Dialog và workspace chuyến bay (01/10) lấy dữ liệu chuyến thật qua gateway; không trình bày fare rules giả lập như điều kiện đã xác minh. **Có UI** |
| `hold_booking` | Giữ chỗ trước xác nhận, PII hành khách | Runtime MVP không quảng bá booking giả lập. **Không bật UI** |
| `confirm_booking` | Xác nhận xuất vé sau đồng ý | Chỉ có engine giả lập, không phải vé thật. **Không bật UI** |
| `get_booking` | Booking ID/PNR | Chưa có flow/UI quản lý vé thật. **Không bật UI** |
| `cancel_booking` | Xem phí trước, xác nhận sau | Chưa có nghiệp vụ vé thật. **Không bật UI** |

### Payment — 5 tool (4 nghiệp vụ + 1 mock)

Nguồn: `src/mcp_servers/payments/tools.py`, `server.py`, engine/gateway và `src/api/sandbox_payments.py`.

| Tool | Hợp đồng cần giữ | Đường tới frontend / mức đáp ứng |
| --- | --- | --- |
| `create_payment` | Mã đơn/khách vô danh, số nguyên VND, idempotency; không gửi PII | Backend có luồng sandbox riêng. React hiện **chưa có form tạo demo riêng**; chỉ render payment interrupt nếu workflow được phép tạo |
| `get_payment` | Kết quả provider mới quyết định PAID; kiểm tra ownership | Card trạng thái qua graph; payment workflow có nút kiểm tra, link/QR. **Có UI**, chưa thử provider thật |
| `cancel_payment` | Provider không hỗ trợ hủy thì giữ chờ/hết hạn | Gateway/backend có endpoint; chưa có review/nút hủy payment riêng trên React. Đã sửa graph không báo CANCELLED khi provider trả PENDING/timeout. **Một phần** |
| `refund_payment` | Preview số tiền với `confirm=false`, rồi người dùng xác nhận | Chưa có endpoint nghiệp vụ/flow graph/UI review refund tương ứng. **Chưa nối** |
| `simulate_payment_result` | Chỉ đăng ký trong mock | **Không đưa vào UI sản phẩm**; dùng trong test |

## Tính tiền và trạng thái đã kiểm tra

- Chi phí tháng và một lần tách riêng. Khoản chưa có số tiền không được biến thành 0 trên card.
- Chọn kết quả có kiểm tra owner, task, plan version, thời điểm fetch và expiry; đổi lựa chọn làm stale kết quả phụ thuộc.
- Tổng dự kiến không cộng lại khoản đã commit. Tiền thực tế hiển thị theo receipt, không suy từ nút chọn.
- Test riêng kiểm chứng 9.000.000 VND/tháng + 250.000 VND một lần; biên độ 5% khi được cấu hình là 262.500 VND, không tự bật biên độ ở runtime.
- Báo giá hết hạn/thiếu thời hạn bị chặn chọn ở các luồng cần expiry. Phê duyệt quá hạn/loại thao tác không hỗ trợ bị chặn.
- Liên hệ gửi riêng qua decision; không chèn vào tin nhắn chat. QR chỉ phục vụ cho user sở hữu hội thoại.
- Provider chưa trả kết quả hủy thanh toán chắc chắn thì tiếp tục chờ; không suy diễn thành hủy thành công.

## Bằng chứng kiểm tra

| Bộ kiểm tra | Kết quả / phạm vi |
| --- | --- |
| Build React/TypeScript — 03/10 | Thành công |
| Playwright — 03/10 | 32 ca hiện có qua trọn bộ, 4 ca bổ sung qua các lượt chạy sau sửa lỗi; hiện 18 tình huống × desktop 1440×960/mobile 390×844 = 36 ca. Fixture API, không phải giao dịch thật. Xem [chi tiết](tests/README.md) |
| Health/status local — 03/10 | Frontend 8503, Agent `/api/v1/status`, Platform `/health`, Moving API `/health` trả HTTP 200 tại thời điểm kiểm tra; Agent công bố 5 domain, `writes_enabled=false` |
| Gateway/graph + payment flow/approval/map/commit adapter — audit 01/10 | 36 passed; test chi phí, quyền đọc QR và hủy thanh toán chưa chắc chắn. Chưa chạy lại trong đợt UI 03/10 |
| Bộ Python rộng — audit 01/10 | `tests/test_agents tests/test_api tests/test_mcp_payments Frontend/tests`: **153 passed, 17 failed** trước khi thêm 2 test UI-contract. Đây là kết quả cũ; xem nhóm lỗi bên dưới, chưa coi suite hiện tại sạch |
| Tool dịch vụ — audit 01/10 | 9 tool Location thành công; platform/database và frontend HTTP 200; 9 OSRM nearest thành công. Chưa chạy lại toàn bộ trong đợt UI 03/10 |

### Các lỗi Python ghi nhận trong audit 01/10

17 lỗi của lượt rà rộng đã được đọc, không bị xóa hoặc skip để làm đẹp kết quả:

- 8 ca `test_api`: fixture khởi tạo theo default cũ/fake hoặc thiếu lifespan service; default hiện là live và yêu cầu gateway authentication nên trả 503. Cần fixture API tách biệt, cấu hình rõ và thêm assertions auth.
- 2 ca Flight MCP/graph: kỳ vọng hold/confirm từ mock trong khi simulation mặc định tắt và Flight adapter từ chối source mock. Cần tách kiểm thử simulation engine và runtime live; không bật booking giả lập trong sản phẩm để chiều test.
- 2 ca Moving: mock geocoder thiếu `get_housing` và metadata độ chính xác sau thay đổi lookup nhà chuẩn.
- 1 ca Moving price band: giả định default 5%; runtime hiện default 0. Test cần truyền cấu hình biên độ rõ ràng.
- 1 ca planner: kỳ vọng phụ thuộc tìm nhà lại dù đã có canonical selected ID; cần đối chiếu semantics lựa chọn đã xác nhận.
- 2 ca Flight adapter: fixture source mock/IATA lookup cũ không khớp read adapter hiện tại.
- 1 ca privacy Payment: allowlist trong test chưa gồm `expire_duration_seconds` mà gateway đã gửi; cần xác minh schema expiry và vẫn giữ assertions không lộ PII.

Đã bổ sung `fixtures/payment.json` còn thiếu để chạy được test graph dùng fake registry. Fixture không được dùng bởi application runtime live.

## Cần gì trước khi chạy end-to-end với user?

1. Giữ `data/integration.env` trỏ database nhà đang có; chạy Location 4300, Platform 4100, API 8000, gateway 8503 và OSRM theo nhu cầu.
2. Gắn LLM vào cấu hình server Intake/Planner/domain agents; chạy lại hội thoại đa lượt và hỏi bổ sung với dữ liệu thật. Đợt audit này chưa đánh giá chất lượng lập kế hoạch của LLM.
3. AhaMove staging: `AHAMOVE_USER_TOKEN` **hoặc** `AHAMOVE_API_KEY` + `AHAMOVE_MOBILE`; thêm `MOVING_QUOTE_CONTACT_NAME`, `MOVING_QUOTE_CONTACT_MOBILE`, cấu hình webhook và database schema Moving. Đây là cấu hình riêng với LLM.
4. Flight thật: `FLIGHT_SERPAPI_API_KEY`. Payment sandbox: `PAYMENT_ZALOPAY_APP_ID`, `PAYMENT_ZALOPAY_KEY1`, `PAYMENT_ZALOPAY_KEY2`. Không đưa key vào React/VITE hoặc commit.
5. Sau khi có credentials, thử đọc/báo giá trước. Đặt/sửa/hủy staging chỉ chạy theo review và xác nhận của người dùng; chưa có bằng chứng provider thật cho các thao tác đó trong đợt này.
6. Xử lý test cũ còn lệch và các tool chưa nối nếu chúng thuộc phạm vi bản phát hành; đừng coi phần UI có renderer là đã có flow nghiệp vụ hoàn chỉnh.

## Chạy lại kiểm tra local không dùng LLM

```powershell
# Từ gốc repo, chỉ gọi tool đọc và health; lưu trạng thái không chứa key vào data/
.venv/Scripts/python.exe Frontend/scripts/check-services.py
```
.venv/Scripts/python.exe -m pytest Frontend/tests tests/test_agents/test_payment_flow.py tests/test_agents/test_approval.py tests/test_agents/test_map_backend.py tests/test_agents/test_commit_adapter.py -q

cd Frontend
npm run build
npm run test:e2e


Script lưu báo cáo runtime tại `data/frontend-service-audit.json` (ignored); kết quả chỉ đúng thời điểm chạy. Không tự tạo đơn, thanh toán, import dữ liệu hay gọi LLM.
