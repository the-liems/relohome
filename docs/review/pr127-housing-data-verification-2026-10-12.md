# PR127 — kiểm chứng dữ liệu Housing

Ngày kiểm tra: 12/10/2026 (Asia/Saigon). Nguồn code: QuangDung `c1de7d48626c1bb84e6bce3fdd08686046f7cee5`.

## Kết luận

**QuangDung đã xử lý ổn phần bảo toàn dữ liệu, đóng gói, đồng bộ source → PostGIS → read model bản đồ.** Audit này đã kiểm artifact thật và restore thử độc lập, không chỉ đọc báo cáo của người bàn giao.

Địa chỉ/tọa độ chưa đạt mức xác minh chính xác từng căn. Còn vị trí gần đúng cấp đường và pin nguồn chưa resolve được; dữ liệu nguồn cũng còn thiếu một số nội dung. Đây là giới hạn cần thể hiện đúng trong sản phẩm, không phải lý do tự xóa/gộp/ẩn hàng loạt dữ liệu cũ.

Đề xuất: giữ dataset và luồng Customer/Landlord hiện tại, tái sử dụng mapping/read model đã có; thêm đăng nhập/workspace Admin và hoàn thiện form cho thuê. Tin mới tự đăng phải đủ thông tin, có pin được xác nhận và qua review. Không chạy lại geocode toàn nguồn hoặc thay snapshot ứng dụng trong phạm vi này.

## Artifact đã kiểm

Đúng ZIP `data/project-data-quangdung-20261008.zip` từ PR127, nội dung release 11/10 dù tên file còn ngày 08/10:

- Kích thước: **806.587.570 byte**.
- SHA256: `0bab81c0b1e27e6fe1dd4c9d910ea238c876a2794dbba48253cb916f182767ab`; khớp Git LFS pointer và `.zip.sha256`.
- **198 mục**, không trùng tên, không đường dẫn nguy hiểm.
- **197 checksum thành phần** khớp; không thiếu file/entry so với SHA256SUMS; CRC tất cả mục hợp lệ.
- Hai JSONL before/after, CSV review, database dump và 9 bộ graph OSRM đều đọc được. CRC/checksum không thay thế chạy routing thật; audit này chưa khởi động OSRM.
- Bản snapshot có sẵn trong workspace là bản 29/09; không dùng bản đó để kết luận về PR127.

## Đối chiếu toàn bộ JSONL trước/sau

| Kiểm tra | Kết quả thực đo |
|---|---:|
| Số tin trước và sau | 38.930 / 38.930 |
| ID nguồn trùng trước/sau | 0 / 0 |
| ID hoặc thứ tự thay đổi | 0 |
| Thay đổi ngoài `address_normalized`, `location`, `derived` | 0 |
| Địa chỉ chuẩn hóa thay đổi so với before trong ZIP | 590 |
| Tọa độ thay đổi so với before trong ZIP | 16.184 |
| Tọa độ không phải số hữu hạn/ngoài khung Việt Nam | 0 / 0 |
| Tin đổi tọa độ bị tự nâng thành rooftop | 0 |
| CSV review | 38.930 dòng |
| SHA256 bản after | `48bac15cfd6a88fbfea792c05491d71fab45eb5bf875d9724cbf50898a437e67` |

Giá, unit, media, source identity, raw address, title/description và verification giữ nguyên byte nghĩa JSON giữa hai bản, vì mọi field ngoài ba nhóm geocode đều được so từng record. Không thấy chuẩn hóa làm mất tin hoặc gộp hai phòng chỉ vì cùng pin.

Con số **16.184** là so với bản trước chuẩn hóa đầy đủ trong ZIP. Con số **2.969 source / 2.902 DB** trong tài liệu PR127 là phần tăng thêm so với checkpoint **08/10**; khác baseline nên không mâu thuẫn. Manifest cũng tách hai baseline. Không có snapshot checkpoint 08/10 trong gói để độc lập đo lại phần tăng thêm đó, nên audit không coi 2.969/2.902 là số vừa tái tính.

## Restore và kiểm PostGIS độc lập

Đã restore dump vào DB `pr127_restore` trong container riêng `relohome-pr127-audit-20261012`, image PostGIS 16–3.5, network `none`, không mở port, dữ liệu nằm tmpfs. Không mount volume ứng dụng hoặc kết nối DB người dùng. Không chạy script restore của ứng dụng vì không cần thay cấu hình local.

| Kiểm tra | Kết quả |
|---|---|
| Restore `--exit-on-error --no-owner --no-acl` | Thành công |
| Số hàng 16 bảng phục vụ so với manifest | Khớp tất cả |
| Listing / property / unit / offer / map_points | Mỗi bảng 38.222 |
| 38.222 tọa độ canonical PostGIS so với JSONL after | Khớp toàn bộ |
| Method / accuracy / status PostGIS so với source | Không có sai khác |
| Map points thiếu/thừa so với `map_point_source` | 0 / 0 |
| Geometry/address/property/unit/area/amenities của map mirror | Không có sai khác |
| Title/source_url/location_accuracy của map mirror | Không có sai khác |
| Current offers | 38.222, không giá <= 0 |
| 23 migration đã apply so với source PR127 | Không thiếu file, checksum khớp sau chuẩn hóa LF/CRLF |
| 19 bảng runtime/private kiểm tra | Đều rỗng |
| POI active, không gồm Housing anchor | 131.191, khớp manifest |

**708 tin có trong JSONL nhưng không có trong DB đều có cờ `likely_commercial`.** Importer hiện đưa nhóm này vào quarantine. Không thấy tin thiếu DB ngoài nhóm đó; đây là lọc nguồn đã có, không phải geocode làm rơi record. Gói nguồn giữ chúng để đối chiếu, dump serving không đưa chúng vào kết quả nhà ở.

Đã thử trong một transaction rồi **ROLLBACK**:

1. Đổi một listing active → inactive: map point bị rút ngay.
2. Đổi lại active: map point được khôi phục.
3. Đổi diện tích unit: area trên map mirror đồng bộ.
4. Thực hiện với `search_path=pg_catalog,pg_temp`: trigger chạy thành công; lỗi search_path cũ đã được xử lý.

Sau rollback, listing/map_points/units vẫn đủ 38.222. Đây là kiểm chứng trigger dữ liệu canonical; không thay thế test transaction của moderation API. Khoảng trống API ghi nhiều query độc lập trong audit hệ thống vẫn còn.

## Chất lượng địa chỉ và nội dung còn giới hạn

| Hạng mục | Số liệu thực đo |
|---|---:|
| Tin dùng method `vietmap_street_v4` trong source | 13.039 |
| Tin dùng method `vietmap_geocode_v4` trong source | 3.145 |
| Tin còn method `source_map` / `source_api` | 21.697 / 1.049 |
| Accuracy approximate / rooftop trong source | 27.664 / 11.266 |
| Geocode được ghi independently_verified=true | 0 |
| Verification của tin source / DB | Tất cả `unverified` |
| Source có quyết định `preserve_street_unresolved` / `preserve_unresolved` | 13.315 / 6.901 |
| DB thiếu diện tích | 3.286 |
| DB thiếu mô tả | 173 |
| DB chưa có media | 22 |

`rooftop` còn lại là nhãn nguồn được giữ, không phải xác minh độc lập của audit hoặc Admin. Hoàn tất 16.371 khóa lookup nghĩa hàng đợi đã được xử lý theo policy; không có nghĩa 16.371 địa chỉ đều khớp nhà chính xác.

Source có 4.193 nhóm cùng pin, chứa 32.212 tin; DB có 4.126 nhóm, chứa 31.580 tin. Trong source, 2.195 pin gắn nhiều khóa địa chỉ khác nhau. Nhóm này gồm cả khả năng nhiều căn/phòng cùng tòa và pin đại diện chưa resolve; chưa có cơ sở để phân loại mọi nhóm là trùng hay sai. **Không unique/dedup bằng lat/lng, không rải pin ngẫu nhiên.** Giữ ID từng tin và cho người dùng chọn từ danh sách khi marker chồng nhau.

Không xác nhận ảnh URL nguồn còn truy cập được; kiểm checksum media trong dump và số bản ghi không phải kiểm tải từng ảnh ngoài. Cũng chưa xác minh thực tế phòng còn trống. Những giới hạn này cần hiển thị đúng, không suy ra từ `active` hoặc geocode.

## Hệ quả cho kế hoạch nâng cấp

- Giữ ingestion, canonical identity, `housing_anchor`, map_points và migrations 019–022. Không viết lại phần bạn đã làm ổn.
- Giữ hoạt động đọc dataset cũ trong phạm vi này. Không tự ẩn/reset toàn bộ crawl hoặc backfill “đã duyệt/còn trống”.
- Tin mới từ chủ nhà: form hướng dẫn rõ, địa chỉ → Vietmap suggestion → resolve ref → preview pin → xác nhận; đủ diện tích/mô tả/ảnh rồi mới gửi duyệt.
- Admin có lối đăng nhập riêng trên màn đăng nhập, dùng auth/session/backend hiện hữu, vào workspace review riêng. Khách/chủ nhà dùng chung tài khoản và chuyển chế độ như đang có.
- UI phân biệt “vị trí gần đúng” với vị trí được chủ nhà/Admin xác nhận; không gọi mọi kết quả Vietmap là địa chỉ chính xác hoặc hồ sơ đã xác minh.
- Tiếp tục sửa validation, revision, ảnh public và duyệt lại sau important edits của tin tự đăng. Các khoảng trống workflow không bị giải quyết chỉ bằng snapshot chuẩn hóa.
- Trước triển khai, fetch main/QuangDung và kiểm PR đổi cấu trúc monorepo; giữ PR127 độc lập, không kéo artifact ZIP vào PR quản lý tin.

Bằng chứng tổng hợp: [JSON kiểm chứng](pr127-housing-data-verification-2026-10-12.json). Diagnostic scripts và dữ liệu tải ở worktree `/tmp/relohome-audit-s6N6T7`; chỉ báo cáo/aggregate được lưu trong repo, không thêm dataset hoặc sửa code sản phẩm.
