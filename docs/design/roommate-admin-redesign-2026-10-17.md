# Kế hoạch nâng cấp Admin → Ở ghép

Ngày: 17/10/2026. Trạng thái: **đề xuất thiết kế và kế hoạch triển khai, chưa sửa code**.

Phạm vi đã được chủ sản phẩm thu hẹp: chỉ khu vực **Ở ghép trong Admin**.
Bản kế hoạch dựa trên screenshot được gửi, bản yêu cầu đính kèm và code của PR #218
đã merge vào main tại `456b6d0`. Code được đọc tại worktree `.tmp/review-pr-212`.
Checkout gốc đang cũ hơn main; khi triển khai phải đồng bộ baseline trước, giữ các
thay đổi local và tài liệu chưa commit.

## 1. Mục tiêu và phạm vi

Admin nhìn nhanh được việc cần xử lý, đọc đủ dữ liệu để quyết định và thao tác đúng
quyền. Giao diện gọn, có phân cấp, đồng nhất Emerald/Rose với ReloHome.

- Nâng cấp danh sách hồ sơ, hàng đợi ảnh và báo cáo trong Admin → Ở ghép.
- Giữ thanh điều hướng Admin hiện có; CSS mới nằm trong container của Roommate Admin.
- Tái sử dụng React/TypeScript, Lucide, design tokens, Dialog, client, xác thực,
  phân trang, operation key và cơ chế khôi phục thao tác hiện có.
- Các tab Duyệt tin, Người đăng & địa điểm, Đánh giá & báo cáo tiếp tục dùng luồng cũ.
- Khám phá/đăng hồ sơ/kết nối/chat của người dùng, thuật toán ghép, quota, consent và
  cấu hình bật Roommate giữ nguyên. Đây không phải công việc xử lý cấu hình staging.

## 2. Những điểm cần điều chỉnh từ bản yêu cầu gốc

### Mô hình thực tế

`profiles.owner` là khóa chính: hiện có một hồ sơ Roommate hiện hành cho mỗi tài
khoản. Hồ sơ gồm tên hiển thị, giới thiệu, facts, preferences, avatar và tùy chọn
liên kết phòng. Đây chưa phải hệ thống nhiều tin cho thuê độc lập có tiêu đề và gallery.

| Nội dung trong bản yêu cầu | Áp dụng vào Roommate hiện tại |
| --- | --- |
| Tiêu đề tin | Tên hiển thị + loại nhu cầu; không bắt người dùng nhập trường mới |
| Giá thuê | **Ngân sách/người/tháng**, kèm cơ sở phí; không đổi thành giá thuê cả căn |
| Chờ duyệt tin / từ chối tin | Hiện chưa có bước duyệt toàn hồ sơ trước khi xuất bản; chờ duyệt/từ chối áp dụng cho ảnh |
| Ẩn tin | Nghiệp vụ hiện có là **hạn chế tài khoản**, ảnh hưởng cả quyền Roommate; không đổi tên thành ẩn tin |
| Khôi phục tin | Bỏ hạn chế và đưa hồ sơ về **tạm dừng**, chủ hồ sơ tự đăng lại |
| Toàn bộ ảnh tin | Avatar và media được phép kiểm duyệt; ảnh căn nhà là dữ liệu Housing riêng |
| Ngày đăng | Có `updated_at`, `confirmed_at`, `expires_at`; chưa có ngày đăng lần đầu bất biến |
| Họ tên / email / ngày tạo tài khoản | Không nằm trong moderation DTO hiện tại; dùng tên hồ sơ, không mặc nhiên mở dữ liệu tài khoản |
| Lịch sử vi phạm | Có audit thao tác, chưa phải kết luận người dùng vi phạm hoặc điểm uy tín |

**Quyết định:** nâng cấp trình bày theo đúng mô hình hiện tại. Quy trình duyệt toàn
hồ sơ, ẩn riêng một tin hoặc nhiều tin/tài khoản là thay đổi nghiệp vụ riêng, cần
đề xuất khác nếu sau này có nhu cầu.

### Trạng thái cần tách biệt

| Đối tượng | Giá trị đang có | Nhãn UI đề xuất |
| --- | --- | --- |
| Hồ sơ | `draft`, `active`, `paused`, `resolved`, `expired`, `restricted`, `deleted` | Nháp, Đang tìm, Tạm dừng, Đã tìm được, Hết hạn, Bị hạn chế, Đã xóa |
| Ảnh | `pending`, `approved`, `rejected` | Chờ duyệt, Đã duyệt, Bị từ chối |
| Báo cáo | `open`, `reviewed` | Chưa xử lý, Đã xem xét |

`active` không có nghĩa đã được Admin xác minh. `reviewed` không có nghĩa người bị
báo cáo đã bị hạn chế. Hồ sơ nháp/đã xóa không nằm trong danh sách chính mặc định;
khi cần kiểm tra audit chỉ dùng thông tin còn được phép lưu, không phục hồi nội dung đã xóa.

## 3. Audit screenshot và code

| Vấn đề | Hệ quả | Cách sửa |
| --- | --- | --- |
| Khối trắng lớn chứa nhiều khoảng trống và nhiều lớp card | Ít dữ liệu nhưng chiếm gần một màn hình | Tách header gọn, KPI thấp và vùng danh sách chính |
| Nút Báo cáo/Ảnh/Hồ sơ cao như CTA lớn | Cạnh tranh với nội dung, khó nhận biết mục đang chọn | Chuyển thành tab ngang có count và selected state rõ |
| Select có label làm các nút cùng hàng bị kéo cao | Toolbar mất cân đối | Dùng toolbar riêng, controls cùng chiều cao, căn giữa |
| Dòng hồ sơ chỉ có tên, giới thiệu và nút Hạn chế | Thiếu thông tin để xử lý nhưng nút tác động lớn quá nổi | Bảng có ngữ cảnh + nút Xem chi tiết; hành động rủi ro nằm trong chi tiết/menu |
| KPI chỉ là số, chưa chỉ ra công việc tiếp theo | Admin phải tự mở từng nhóm | Card Báo cáo chờ/Ảnh chờ dẫn thẳng tới hàng đợi |
| Profile DTO phía UI bỏ qua `facts`, `version` đã có trong API | Dữ liệu hữu ích không được trình bày | Typed adapter dùng lại dữ liệu có sẵn |
| Endpoint queue chỉ có status/offset/limit | Chưa có tìm kiếm/lọc/sort toàn tập | Bổ sung truy vấn server khi triển khai các bộ lọc tương ứng |
| Queue hồ sơ lọc `state` nhưng KPI active còn kiểm tra `expires` | Số trên KPI có thể khác số hồ sơ thực sự đang tìm | Thống nhất tiêu chí còn hiệu lực giữa count/list bằng clock/policy hiện có |

## 4. Bố cục đề xuất

```text
Thanh điều hướng Admin hiện có

Ở ghép                                    [Làm mới]
Quản lý hồ sơ, ảnh và báo cáo.

[Báo cáo chờ · số thật] [Ảnh chờ · số thật] [Đang tìm · số thật]

[Hồ sơ] [Ảnh chờ duyệt · count] [Báo cáo · count]
------------------------------------------------------------
[Tìm tên / mã hồ sơ] [Trạng thái] [Thành phố] [Bộ lọc] [↻]
Các bộ lọc đã chọn · Xóa bộ lọc                  Tổng kết quả
------------------------------------------------------------
Danh sách phù hợp với loại nội dung đang mở
------------------------------------------------------------
20 mục/trang                           Trước · Trang hiện tại · Sau

Khi mở chi tiết: drawer bên phải, giữ nguyên vị trí danh sách.
```

Mặc định mở **Báo cáo chưa xử lý**, giữ lựa chọn qua URL khi Admin đổi tab. Khi tất
cả hàng đợi trống vẫn cho xem hồ sơ đang tìm; không coi danh sách trống là lỗi dịch vụ.
KPI dùng count server, không dùng số phần tử của trang hiện tại. Giữ ba KPI thật
đang hữu ích; thẻ thứ tư **Hồ sơ bị hạn chế** là bổ sung sau khi có aggregate đúng
ở server. `pending_requests` là yêu cầu kết nối giữa người dùng, không phải tin chờ duyệt.

### 4.1 Danh sách hồ sơ

Desktop dùng bảng semantic với 6 cột chính:

1. **Hồ sơ:** avatar 36–40px, tên, mã ngắn; cho copy mã đầy đủ bằng nút có nhãn.
2. **Nhu cầu:** Có phòng / Cùng tìm phòng.
3. **Khu vực:** thành phố và khu vực từ catalog có thật.
4. **Ngân sách:** khoảng hoặc trần VND/người/tháng, cơ sở phí trong chi tiết.
5. **Trạng thái:** badge có chữ và icon.
6. **Thao tác:** Xem chi tiết + menu phụ.

Tên và giới thiệu hiển thị tối đa hai dòng; chi tiết có đầy đủ nội dung. Ngày cập
nhật là cột tùy chọn khi API đã trả `updated_at`; không gắn nhãn ngày đăng cho dữ liệu này.
Không thêm checkbox khi chưa có thao tác hàng loạt phù hợp để thực thi.

### 4.2 Danh sách ảnh

Ảnh cần nhận diện bằng preview lớn hơn avatar, khoảng 96px, có nút **Xem ảnh**;
không cố nén thành một dòng bảng thông thường. Mỗi mục có mã ảnh, mã/người sở hữu
theo dữ liệu được phép, ngày tải, badge trạng thái và **Duyệt ảnh**.

Mở ảnh ở kích thước đọc được, hỗ trợ phóng to; ảnh riêng chỉ tải khi cần, qua API
hiện có. Cho duyệt/từ chối từng ảnh, có lý do; không tự chọn ảnh làm avatar cho chủ hồ sơ.

### 4.3 Danh sách báo cáo

Cột/mục chính: hồ sơ bị báo cáo, nội dung báo cáo rút gọn, thời gian, trạng thái,
**Xem báo cáo**. Nội dung đầy đủ nằm trong drawer và được render như text.

Admin có thể **Đánh dấu đã xem xét**; hạn chế tài khoản là hành động riêng cần lý do.
Nhãn “Đã xem xét” phản ánh đúng endpoint resolve hiện tại, không hứa có điều tra hoặc
tự thông báo cho người dùng khi backend chưa có sự kiện tương ứng.

## 5. Drawer chi tiết và quy trình xử lý

Desktop: drawer rộng khoảng 560–680px, giới hạn 48vw ở màn lớn; tablet/mobile dùng
panel toàn màn hình. Dùng cấu trúc/focus trap của Dialog hiện có.

- Header: tên hồ sơ/loại nội dung, mã, trạng thái, nút đóng.
- Nội dung chia mục: **Thông tin**, **Nội dung cần xem xét**, **Lịch sử xử lý**.
- Footer sticky nằm trong drawer; nội dung có khoảng chừa để không bị footer che.
- Đóng drawer trả focus về dòng vừa mở; giữ trang, bộ lọc và vị trí cuộn.

### Hồ sơ

Hiển thị giới thiệu, nhu cầu, thành phố/khu vực, ngân sách, thời điểm chuyển vào và
thông tin sinh hoạt được phép kiểm duyệt. Chỉ hiện liên kết phòng khi có dữ liệu hợp
lệ và consent vị trí theo chính sách cũ. Không tự lấy số điện thoại, email, nội dung
chat hay preferences riêng để lấp đầy drawer.

Nút **Hạn chế tài khoản** nằm trong footer phụ/menu, không phải CTA duy nhất trên
mỗi dòng. Dialog xác nhận ghi rõ phạm vi ảnh hưởng tới hồ sơ, kết nối/quyền liên hệ
và chat theo chính sách hiện có; bắt buộc lý do. Không dùng nhãn “Ẩn tin”.

Với tài khoản bị hạn chế, dùng **Khôi phục quyền sử dụng**; thông báo kết quả rõ:
“Đã khôi phục quyền. Hồ sơ đang tạm dừng; người dùng cần chủ động đăng lại.”

### Ảnh và báo cáo

- Ảnh: xem đủ nội dung → chọn duyệt/từ chối → nhập lý do → xác nhận lưu kết quả.
- Báo cáo: đọc lý do và nội dung hồ sơ còn được phép xem → đánh dấu đã xem xét;
  có thể mở hành động hạn chế riêng.
- Lý do mẫu chỉ hỗ trợ nhập nhanh, vẫn sửa được; không tự điền thay quyết định Admin.
- Pending khóa nút chống bấm đôi. Khi mất phiên, giữ nội dung đang nhập và đăng nhập
  lại theo cơ chế Admin cũ, không tự thực hiện lại thao tác tác động dữ liệu.
- Kết quả không rõ do timeout cần kiểm tra lại dữ liệu/operation key; chỉ thông báo
  thành công khi có phản hồi xác thực từ server.

### Lịch sử

DB `moderation` đã có actor, target, action, reason, created. API đọc lịch sử riêng
cần bổ sung có kiểm quyền và phân trang. Nhãn lịch sử chỉ thể hiện những trường
đang lưu được. Hiện audit ảnh gắn target là owner, chưa lưu media ID riêng hoặc trạng
thái trước/sau; không trình bày như đã có lịch sử chính xác cho từng ảnh.

Nếu muốn bổ sung media ID và before/after ở tương lai, thiết kế metadata additive,
để trống cho bản ghi cũ, giữ chính sách xóa/redaction. Không backfill bằng suy đoán.

## 6. Toolbar, dữ liệu và URL

### Bản làm đẹp đầu tiên

- Tab con rõ selected state, counts thật, status phù hợp từng loại nội dung.
- Phân trang server hiện có `offset/limit`, mặc định 20, tối đa 50 như API.
- Hiển thị dữ liệu queue có sẵn; drawer ở giai đoạn này chỉ dùng dữ liệu đã tải.
- Những bộ lọc chưa được server hỗ trợ chưa xuất hiện như nút chức năng giả.

### Bổ sung ngay sau nền tảng giao diện

Server hỗ trợ kết hợp `q`, thành phố, nhu cầu, trạng thái, ngân sách và sort được
allowlist; mở date range khi đã có đúng loại timestamp. `q` tìm trên tên/giới thiệu
và mã hồ sơ hiện có, không tìm email/điện thoại hoặc thông tin private.

Budget là khoảng/người/tháng; chốt rõ phép so sánh giao khoảng/trần và cách xử lý
fee basis chưa biết. Giá trị thiếu không bị biến thành 0 hoặc tự nhận đã bao gồm phí.
Khu vực chỉ chọn từ catalog, hỗ trợ toàn thành phố khi không có cấp quận/huyện.

Query, total và phân trang phải dùng cùng predicate, cùng cách xử lý hết hạn.
Sắp xếp có khóa phụ ID ổn định. Kiểm tra SQLite/PostgreSQL; không lọc hoặc sort chỉ
trên 20 kết quả đang mở rồi gọi đó là tìm kiếm toàn bộ.

Ví dụ URL đề xuất (chưa phải route hiện đã hỗ trợ):

`/admin?tab=roommate&rmQueue=profiles&rmStatus=active&rmCity=hcm&rmPage=1`

Chỉ lưu bộ lọc không nhạy cảm trong URL. Search text có thể chứa PII nên giữ trong
state phiên, không mặc định đưa vào URL/localStorage. Đổi bộ lọc reset trang và
selection; Back/Forward hoạt động. Response cũ không được ghi đè response mới.

## 7. Thao tác hàng loạt

Làm sau khi hàng đợi, quyền và kết quả từng mục đã ổn định.

- Ưu tiên **đánh dấu nhiều báo cáo đã xem xét** qua hành động resolve hiện có.
- Checkbox chọn tối đa các mục hợp lệ trong trang hiện tại; chọn tất cả có trạng
  thái indeterminate. Không ngầm chọn toàn bộ kết quả ở những trang chưa tải.
- Thanh thao tác chỉ xuất hiện khi có selection: số mục, hủy chọn, hành động hợp lệ.
- Xác nhận bằng số lượng và tóm tắt; xử lý có giới hạn đồng thời, không phát một
  request không giới hạn. Báo kết quả từng mục và chỉ giữ lại các mục chưa thành công.
- Session hết hạn hoặc mất mạng dừng gửi tiếp, không tự gửi lại toàn bộ batch.
- Giữ quyết định duyệt ảnh từng mục. Không thêm “duyệt hàng loạt hồ sơ” khi chưa có
  nghiệp vụ duyệt hồ sơ; không coi bulk hạn chế tài khoản là thao tác thông thường.

Endpoint mới cho batch chưa cần ở bước đầu. Nếu sau này hỗ trợ mutation ảnh/batch
khác, phải có idempotency cho từng mục trước khi bật retry; API review ảnh hiện tại
chưa nhận operation key như restrict. Không cam kết an toàn retry chỉ nhờ disable nút.

## 8. Thiết kế thị giác và responsive

### Design contract

| Thành phần | Quy tắc |
| --- | --- |
| Màu nhận diện | Emerald giữ thương hiệu/CTA; Rose dùng điểm nhấn của Roommate, icon/tab con |
| Màu trạng thái | Success/Warning/Danger/Pending theo token hiện có, luôn có chữ; Rose không thay cho trạng thái lỗi |
| Nền | `--ui-bg` bên ngoài; `--ui-surface` cho vùng chính; `--ui-line` chia hàng, không lồng nhiều card cùng độ nổi |
| Bán kính | Control 8px, panel 12px theo token, không tăng bo góc toàn bộ ứng dụng |
| Chữ | Body 14px, phụ 12–13px; tên hồ sơ 14px semibold; tiêu đề nội dung 20–24px; giữ H1 shell |
| Kích thước | Toolbar control khoảng 40px desktop; vùng chạm đạt 44px mobile; hàng hồ sơ khoảng 68–76px cho hai dòng |
| Khoảng cách | 8/12/16/24px theo spacing scale; KPI thấp khoảng 88–104px, không tạo hero quản trị lớn |
| Tương tác | Hover nhẹ trên hàng, focus ring rõ, tab active có nền/indicator; transition 120–180ms, reduced motion |
| CSS | Prefix/container riêng `.rm-admin-*`; ưu tiên token có sẵn, không đổi style `.rm-actions` hoặc `.rm-panel` toàn service |

Desktop giữ bảng rộng, cột hành động ở cuối; tablet giảm cột phụ và dùng chi tiết để
đọc phần còn lại. Mobile dưới khoảng 768px dùng card tối giản, filter mở sheet, tên,
nhu cầu, khu vực/ngân sách, badge và nút chi tiết thấy rõ. Thanh tab con cuộn ngang
và tự đưa mục active vào vùng nhìn. Không tạo cuộn ngang cho toàn trang.

Dark mode dùng đầy đủ surface/text/border token hiện có; kiểm tra cả input, menu,
badge, ảnh, dialog và footer, không chỉ nền. Mục tiêu WCAG AA: chữ thường ≥4.5:1,
chữ lớn và các thành phần UI cần phân biệt ≥3:1. Bàn phím dùng được từ bảng tới
drawer/menu/dialog; trạng thái loading và kết quả có live region phù hợp.

### Tham khảo có chọn lọc

- [IBM Carbon — Data table](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines):
  học cách chia toolbar, dữ liệu, phân trang, chi tiết mở thêm và thanh batch khi chọn.
- [Atlassian — Dynamic table](https://atlassian.design/components/dynamic-table/):
  tham khảo bảng có sắp xếp/phân trang, cấu trúc thao tác rõ ràng.

Đây là tham khảo pattern. Giữ component/tokens ReloHome, không thêm cả bộ UI library
hoặc sao chép branding/layout của sản phẩm khác.

## 9. Phạm vi code/API dự kiến

| Nơi | Cách tận dụng / bổ sung |
| --- | --- |
| `apps/web/src/admin/RoommateModeration.tsx` | Giữ gate availability, role, Identity và RecoveryPanel; gắn phần trình bày mới |
| `apps/web/src/roommate/Moderation.tsx` | Giữ công cụ standalone hoạt động; tách phần dùng chung nhỏ hoặc thêm presentation dành riêng Admin |
| `apps/web/src/admin/roommate/` (đề xuất) | Queue tabs, KPI, toolbar, bảng/card, drawer; typed adapter chung cho ba queue |
| `useResource`, `useRoommateClient`, `useOperation`, `PrivateAvatar`, `Dialog` | Reuse auth, abort, actor isolation, ảnh private, retry/focus; cải tiến có giới hạn nếu cần |
| `services/moderation.py` | Mở rộng read query/DTO/summary; giữ restrict/resolve policy |
| `api/roommate_safety.py`, `api/roommate_media.py` | Param/detail/history có validation nếu thực sự cần |
| `roommate_gateway.py` | Thêm đúng read route/query allowlist cho API mới, giữ trusted actor/CSRF/binary proxy |
| `profile_repository`, `safety_repository`, `postgres.py` | Dùng dữ liệu hiện có, truy vấn parameterized; kiểm tra cả hai backend |

Không tạo Admin database hoặc dịch vụ moderation mới. Giai đoạn giao diện và read
API cơ bản không cần migration. Chỉ thêm index nếu đo được query cần; metadata audit
mới là hạng mục additive riêng, chưa phải điều kiện bắt buộc cho bản làm đẹp.

## 10. Trình tự triển khai

Các mã công việc và checklist chi tiết nằm trong [tasks/todo.md](../../tasks/todo.md)
ở phần **Roommate Admin UI — 17/10/2026**, giữ nguyên các checklist Roommate lịch sử.

| Giai đoạn | Task | Kết quả kiểm tra được |
| --- | --- | --- |
| 1 — Làm đẹp trên dữ liệu thật | RA-01, RA-02 | Contract/adapter đúng dữ liệu; tabs/KPI/toolbar và hồ sơ table/card gọn |
| 1 — Xử lý nội dung | RA-03, RA-04 | Ảnh/báo cáo có ngữ cảnh; drawer và hành động cũ chạy đúng, không đổi nghiệp vụ |
| Checkpoint A | Sau RA-04 | Review sáng/tối, desktop/mobile bằng screenshot và thao tác dữ liệu test qua API thật |
| 2 — Hoàn thiện công cụ quản lý | RA-05, RA-06 | Tìm/lọc/sort/phân trang server nhất quán, chi tiết và audit theo quyền |
| 2 — Hàng loạt có giới hạn | RA-07 | Chọn và resolve báo cáo; kết quả riêng từng mục, không retry mù |
| Checkpoint B | Sau RA-07 | Quyền/version/race/expiry/partial failure đạt trước khi coi công cụ hoàn chỉnh |
| 3 — Nghiệm thu | RA-08 | Regression, accessibility, handoff và smoke sau deploy |

Ưu tiên giao diện có hiệu quả ngay ở giai đoạn 1. Giai đoạn 2 hoàn thiện phần công cụ
trong đúng module Admin Roommate; không đưa controls chưa hoạt động vào bản phát hành.

## 11. Kiểm thử và điều kiện nghiệm thu

### Chức năng và dữ liệu

- Không bịa KPI, tên tài khoản, giá, ngày đăng hoặc lịch sử trước/sau.
- Danh sách 0/1/nhiều trang, tên/intro dài, thiếu avatar/budget/area đều đọc được.
- Loading, empty, hết kết quả do filter, thiếu quyền và dịch vụ tắt là các trạng thái riêng.
- Active hết TTL: count và list cùng ý nghĩa, không đợi cron để quyết định còn hiệu lực.
- Lý do báo cáo không tự trở thành kết luận vi phạm; restricted restore về paused.
- Kết quả mutation cũ không làm mới nhầm trang/actor; submit không chạy lặp sau đăng nhập.

### Quyền và hồi quy

- Admin Housing dùng được moderation khi `eligible:false`; user thường/guest/role giả bị chặn ở API.
- Giữ key/DB/schema, privacy erase, ảnh private, owner-only recovery và không mở chat/contact.
- Hồi quy các tab Admin Housing và luồng Roommate người dùng; CSS riêng không tác động chúng.
- Có hai ca test `service-auth.spec.ts:329` lỗi ở baseline `4a14c23` trong đợt trước;
  xác minh lại trên baseline khi triển khai, ghi rõ nếu còn, không skip hoặc hạ assertion.

### Các lệnh dự kiến

```powershell
python -m pytest tests/test_roommate/test_housing_admin.py tests/test_roommate/test_runtime.py tests/test_roommate/test_operation_drafts.py -q
python -m pytest tests/test_roommate apps/browser-gateway/tests/test_roommate_gateway.py apps/browser-gateway/tests/test_service_auth_matrix.py -q
npm run build --workspace apps/web
npm run test:e2e --workspace apps/web -- --config playwright.roommate-ui.config.ts roommate-admin.spec.ts
npm run test:e2e --workspace apps/web -- --config playwright.roommate.config.ts
```

Khi thực thi dùng interpreter/launcher trong DEVELOPMENT.md và PostgreSQL test
riêng khi có test DB. Bổ sung các ca queue/detail/history/filter theo API thực tế.
Browser cần viewport 1440×960, 1024×768, 390×844, 360×740; screenshot light/dark và
VI/EN, keyboard/focus/zoom. Fixture test được phép nằm trong môi trường kiểm thử;
bundle/runtime hoàn thiện không dùng hồ sơ demo hoặc số thống kê giả.

Sau deploy, smoke bằng tài khoản được phép với ảnh/báo cáo thật do team chủ động tạo;
kiểm tra cả Admin và trải nghiệm chủ hồ sơ. CI xanh không thay cho xác minh dữ liệu
và cấu hình staging. Nếu cần rollback UI, giữ database/key và không chạy migration đảo.

## 12. Trạng thái bàn giao của lượt lập kế hoạch

Đã đọc screenshot, bản yêu cầu, code và hai nguồn design system chính thức. Đã chốt
phạm vi chỉ Admin → Ở ghép, chỉ rõ phần reuse và khoảng trống API/dữ liệu.
**Chưa triển khai UI/API, chưa migration, chưa sửa env, chưa commit/push/deploy.**
