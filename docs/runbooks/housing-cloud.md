# ReloHome Housing: deploy và vận hành cloud

Bản nâng cấp nằm trên `feat/housing-management-cloud`, dựa trên QuangDung
`67a5522`. Giữ đường dẫn monorepo để không đụng các PR đang tái cấu trúc.
Dùng `compose.coolify.yaml` và các Dockerfile/CI hiện hữu. Chưa triển khai tới một
cloud account; các bước dưới đây chạy trên resource staging do operator chọn.

## 1. Cấu hình trước release

- `APP_URL`: origin HTTPS cố định của ứng dụng. `SIU_PUBLIC_BASE_URL` trên web
  lấy từ giá trị này để URL ảnh tồn tại sau restart/redeploy. Khi restore từ local,
  web client đưa các URL `/web/media/housing/<id>.png` về origin hiện tại; ảnh
  external và dữ liệu canonical không bị thay đổi. Phải restore đúng thư mục ảnh.
- `AGENT_API_TOKEN`: cùng secret trên web/backend/platform. Platform và PostGIS
  chỉ ở mạng nội bộ; browser không được biết token hay database credentials.
- `VIETMAP_API_KEY`: đặt **chỉ trên Platform**, quyền Autocomplete v4 và Place v4.
  Key rỗng: lưu nháp bằng tọa độ nhập tay được, gửi duyệt cần chọn và xác nhận
  kết quả Vietmap. Không tự đoán pin khi provider lỗi. Hạn mức: 30 request/phút/
  account, timeout 8 giây, cache tìm kiếm 5 phút. Chọn kết quả mới gọi Place.
- `HOUSING_MODERATOR_IDS`: ID tài khoản operator cụ thể, không phải email;
  cách cấp tài khoản ở bước 3. Không có đăng ký Admin công khai.
- Giữ `web-data` (SQLite auth, traveler encryption key, `housing-media`) và
  `location-data` (PostGIS). Giữ tất cả volume service khác đang dùng.
  Không dùng `docker compose down -v` khi cập nhật.
- Web chạy **một replica, một worker**, storage bền vững. SQLite phù hợp demo
  cloud này; không scale nhiều web replicas chia sẻ file bằng NFS.
- HTTPS + `SIU_SECURE_COOKIE=true`; không dùng ephemeral filesystem cho ảnh.
  Image tags phải cùng một release của web, platform, location và migration.
  Compose hiện có PostGIS/routing images ARM64: dùng host ARM64 hoặc chuẩn bị
  image/graph phù hợp AMD64 trước khi chọn host khác.

API mapping theo tài liệu [Autocomplete v4](https://maps.vietmap.vn/docs/map-api/autocomplete-version/autocomplete-v4/)
và [Place v4](https://maps.vietmap.vn/docs/map-api/place-v4/). Hỗ trợ địa chỉ
hai cấp; district không bắt buộc. Vị trí geocode được ghi nhận gần đúng,
không gắn nhãn rooftop chỉ vì có pin. Private preview dùng basemap hiện có.

## 2. Backup và migration

Đưa staging vào maintenance, ngừng ghi tin/upload và agent writes trong lúc chụp
bộ backup. Tại terminal container PostGIS, dùng role admin của resource:

```bash
pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > /tmp/housing-before-upgrade.dump
```

Tại terminal container **web**, chạy bằng user runtime:

```bash
python -m Frontend.cloud_backup --output /app/data/backup-housing-before-upgrade
```

Copy dump và thư mục backup ra storage private bên ngoài host. Archive có PII và
khóa giải mã, không upload vào Git/public bucket. Backup các volume agent,
Roommate, moving, payment, flight theo runbook hiện có. Công cụ web dùng SQLite
backup API (bao gồm WAL), kiểm `quick_check`, lưu ảnh/key và manifest SHA256.
Nếu dùng `SIU_TRAVELER_KEY` external, giữ secret đó trong secret manager riêng.

Trên Linux/POSIX, thư mục backup có mode 0700 và file 0600. Trên Windows,
công cụ bỏ ACL kế thừa của **thư mục mới tạo** và chỉ cấp quyền cho account đang
chạy cùng SYSTEM; file/thư mục con kế thừa ACL riêng này. Dùng SID, không dùng tên
account phụ thuộc ngôn ngữ. Nếu không lấy được SID hoặc thiết lập ACL thất bại,
công cụ dừng trước khi copy database/ảnh/khóa. Không dùng kết quả `stat().st_mode`
trên NTFS để kết luận archive đã riêng tư. Tham khảo
[Microsoft icacls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls).

Chạy image `location-migrate` **mới trước** Platform/Location mới. Compose đã
`depends_on: service_completed_successfully`; runner có advisory lock, checksum
và transaction từng migration. `023_housing_publication_guards.sql` thêm revision,
xác nhận location, approval revision, media metadata, lịch sử review và public
visibility view; không sửa migration 001–022, không reimport hoặc reset data.
Nếu có checksum mismatch, dừng release để kiểm tra nguồn; không xóa history.
Platform health trả 503 `migration_required` khi schema mới chưa tồn tại.

Test migration image trong CI/local Linux có Docker:

```bash
docker build -f 'Maps VN/LifeFlow/platform-api/Dockerfile' --target location-migrate -t relohome-migrate:test .
python scripts/test-migration-image.py location-migrate relohome-migrate:test
```

## 3. Tạo Admin bằng quyền operator

Trong terminal web container:

```bash
python -m Frontend.admin_provision --email admin@your-domain.vn --name 'ReloHome Admin'
```

Nhập mật khẩu 12+ ký tự qua prompt kín; không truyền password trên command line.
Tool trả **account ID**, không tự nâng quyền. Append ID đó vào
`HOUSING_MODERATOR_IDS` ở Platform, giữ các ID cũ, restart Platform. Đăng nhập
`https://your-domain/admin` hoặc chọn “Đăng nhập Admin” ở màn login.
Muốn dùng account có sẵn, thêm `--existing`; password/data cũ được giữ nguyên.
Không seed account/password cố định trong image hoặc cấp quyền từ browser.

Khách/chủ nhà vẫn login chung và đổi workspace như trước. Admin session có
workspace riêng; login thường của cùng account vẫn không mở moderation API từ
browser. Backend kiểm ID Admin mỗi thao tác; rút ID khỏi cấu hình và restart
Platform sẽ thu hồi khả năng kiểm duyệt, kể cả session cũ.

## 4. Smoke test trước mở traffic

1. `/health` từng service; web session/login hoạt động qua HTTPS, cookie HttpOnly/
   Secure; không có route public tới PostGIS/Platform/Location/internal docs.
2. Account mới tạo hồ sơ, chọn nhà bằng Vietmap, xác nhận pin, thêm hai phòng cùng
   tọa độ, lưu nháp thiếu thông tin. Tin/ảnh riêng chưa xuất hiện Customer/Map/MCP.
3. Admin xem hồ sơ/địa điểm, duyệt location và gửi tin đủ nội dung/ảnh vào queue;
   reject thiếu reason bị chặn. Owner và account khác không tự approve/sửa tin.
4. Admin duyệt: Search/Map/MCP đều đọc cùng listing ID. Rented/hidden rút khỏi cả
   ba; chỉnh title/description/price/fees/ảnh/unit/address đưa về draft và cần duyệt lại.
5. Hai cửa sổ cùng sửa/duyệt: chỉ revision mới thành công; cửa sổ cũ nhận 409.
6. Upload/reorder/cover/delete ảnh, xem private preview, inbox/lịch xem và thống
   kê 7/30 ngày. Không có event thì không tự sinh số liệu demo.
7. Restart web/platform rồi kiểm accounts, photos, trạng thái và danh sách vẫn tồn tại.

## 5. Restore và rollback

Ưu tiên rollback application image cùng bộ release **giữ schema additive mới**;
không DROP cột/bảng để rollback. Nếu phải restore database, giữ maintenance và
restore vào database/volumes **mới** trước. Dùng `pg_restore --no-owner --no-acl`,
chạy migration/grants của đúng release, restore SQLite + media + encryption key,
kiểm checksums/health/ownership rồi mới đổi resource sang bộ volume đó. File
web cần owner runtime UID 10001 và quyền đọc/ghi phù hợp. Không
restore dump cũ đè lên database đã nhận bài/tài khoản mới.

Backups chưa đủ nếu chưa thử restore. Lưu lịch backup ngoài host và định kỳ chạy
smoke test trên staging tách biệt; không chạy integration tests dùng dữ liệu test
trực tiếp trên database production.

## Release qua Coolify hiện có của repo

Xác nhận ngày 13/10/2026: repo có các biến `COOLIFY_STAGING_URL`,
`COOLIFY_STAGING_SERVICE_UUID`, `COOLIFY_PRODUCTION_URL`,
`COOLIFY_PRODUCTION_SERVICE_UUID` và secrets tương ứng. Giữ secrets trên GitHub/
Coolify; không cố đọc hoặc copy chúng vào `.env` local.

1. Tạo PR từ nhánh nâng cấp vào main. CI PR kiểm tra và build các image bị ảnh
   hưởng; chưa publish/deploy bản PR.
2. Sau review và merge, CI main publish toàn bộ release.
   [deploy-staging.yml](../../.github/workflows/deploy-staging.yml) tự deploy khi
   CI thành công; workflow kiểm main HEAD để tránh đẩy release cũ.
3. Cấp tài khoản operator trong web container staging bằng công cụ ở bước 3,
   lấy **ID từ database staging**, append vào `HOUSING_MODERATOR_IDS` của Platform
   staging. ID local chỉ dùng khi chính database local được restore có chủ đích
   vào resource đó. Cấu hình key Vietmap ở Platform và chạy smoke test.
4. Production dùng [deploy-production.yml](../../.github/workflows/deploy-production.yml)
   với CI run ID đã kiểm trên staging. Chọn đúng resource và backup trước rollout;
   account/role/config của production thuộc database production.

Không merge vào main chỉ để vượt deploy guard: merge làm thay đổi code chung và
khởi động deploy staging tự động. PR phải được review trước bước này.
