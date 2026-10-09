# Thiết kế: chế độ chủ nhà trên cùng một tài khoản

Trạng thái: **v2, đã code trên nhánh `feat/housing-product-v1-finish` (chưa push).** Ngày: 09/10/2026.
Nền đối chiếu: nhánh `feat/housing-product-v1-finish` (từ `origin/QuangDung` `9edfbf6` cộng HP-08..10), gồm
[SPEC-021](../specs/SPEC-021-housing-product-v1.md), [thiết kế kỹ thuật Housing Product V1](../design/housing-product-v1.md),
[đề xuất Tenant/Landlord](../ideas/housing-platform-upgrade.md), [payment-design](payment-design.md) và
[housing-viewing-design](housing-viewing-design.md).

### Ghi chú khi code (09/10/2026)

- **Tạm khóa người đăng không đưa lên staging** (dính pháp lý): bỏ trạng thái `suspended` khỏi schema và API. Khi team
  chốt chính sách sẽ thêm bằng migration riêng.
- `GET /v1/host/profile` trả `{profile: null, terms_version}` thay vì `404` khi chưa có hồ sơ, để giao diện không phải
  phân biệt "chưa có" với lỗi.
- Gateway chỉ chuyển tiếp ba mã kết quả cho trình duyệt: `host_profile_required`, `host_terms_required`,
  `host_not_verified`; các trường khác từ upstream không đi qua.
- "Cần bổ sung" lưu lý do ở `info_request` (người đăng thấy); ghi chú nội bộ ở `review_note` (chỉ kiểm duyệt).
- Nút chuyển chế độ nằm ở header chung; nút "Về ReloHome" trong không gian chủ nhà bỏ đi để không trùng. Trên màn hình
  hẹp nút chỉ còn icon (vùng bấm 44px, có `aria-label`).
- Người chưa có hồ sơ và chưa có địa điểm nào: vào `/landlord` thấy ngay màn đăng ký. Người đã có địa điểm từ trước
  (dữ liệu cũ) thấy không gian quản lý kèm banner "Hoàn tất hồ sơ người đăng".

## 1. Bối cảnh

Hiện mọi tài khoản đều vào được `/landlord` và tạo địa điểm ngay. Quyền cấp theo từng địa điểm
(`housing.management_members`: `pending` → kiểm duyệt bấm xác minh → `active`). ReloHome chưa biết người đăng là ai:
kiểm duyệt chỉ thấy tên và địa chỉ nhà, không có thông tin người đăng để đối chiếu. Người thuê cũng không biết tin do
chủ nhà hay môi giới đăng.

Mục tiêu:

- Một tài khoản, hai chế độ: **thuê nhà** và **chủ nhà**, chuyển bằng một nút (như Airbnb "Switch to hosting").
- Lần đầu vào chế độ chủ nhà, người dùng khai **hồ sơ người đăng**. Kiểm duyệt **xác minh thủ công** (pilot) trước
  khi tin của họ được hiển thị.
- Không đổi luồng thuê nhà, không đổi contract đọc Housing, không phá dữ liệu đã có.

## 2. Quyết định

| # | Quyết định | Trạng thái |
|---|---|---|
| H1 | Một tài khoản, hai chế độ, chuyển bằng nút trên header. Không có tài khoản đối tác riêng | Đã chốt |
| H2 | Vai trò của ReloHome: trung gian. Khi có luồng tiền, app chỉ **giữ tạm rồi chuyển lại** cho bên cung cấp; hợp đồng và trách nhiệm pháp lý là giữa người thuê và người cho thuê (như payment-design §1) | Đã chốt |
| H3 | Môi giới được đăng tin. Loại người đăng hiện công khai trên tin để người thuê biết | Đã chốt |
| H4 | Xác minh danh tính: **pilot thủ công** trên staging. Kiểm duyệt liên hệ ngoài app và chỉ ghi kết quả; app không lưu ảnh hay số giấy tờ | Đã chốt |
| H5 | Điều khoản chủ nhà: **chưa làm**, để team bàn. Thiết kế chừa chỗ bằng cấu hình, bật sau không cần đổi schema | Đã chốt |
| H6 | Hồ sơ người đăng lưu trong schema `housing` của PostGIS (không thêm database), Platform API kiểm tra ở server | Đề xuất |
| H7 | Chế độ đang dùng là tiện ích giao diện, nhớ theo thiết bị; quyền thật nằm ở hồ sơ và membership | Đề xuất |
| H8 | Có hồ sơ (kể cả đang chờ) thì được tạo địa điểm, phòng, bản nháp và gửi duyệt. **Chỉ khi người đăng đã được xác minh** kiểm duyệt mới duyệt được địa điểm và tin của họ | Đề xuất |
| H9 | Tạm khóa người đăng **không đưa lên staging**; để team chốt cùng điều khoản | Đã chốt |

H8 giữ đúng SPEC-021 ("chuẩn bị phòng và bản nháp trong lúc chờ xác minh") và chỉ thêm một điều kiện ở bước duyệt.

## 3. Trải nghiệm

### 3.1. Chuyển chế độ

- Header (`Shell` trong `App.tsx`) có nút cạnh avatar: ở chế độ thuê nhà hiện **"Chế độ chủ nhà"**, ở `/landlord`
  hiện **"Chế độ thuê nhà"**. Mobile: nút thu thành icon, có `aria-label`.
- Bấm "Chế độ chủ nhà":
  - chưa có hồ sơ → mở màn đăng ký người đăng (3.2);
  - đã có hồ sơ → vào `/landlord` như hiện tại.
- Bấm "Chế độ thuê nhà" → `/ai`. Nút "Về ReloHome" trong `Workspace.tsx` đổi thành nút này.
- Link "Quản lý nhà cho thuê" ở trang Tài khoản và thẻ `/landlord` ở trang giới thiệu vẫn giữ, cùng đi qua bước kiểm
  tra hồ sơ.
- Sau khi đăng nhập, mở lại chế độ dùng gần nhất trên thiết bị đó (`localStorage`, bọc `try/catch`; lỗi thì về
  `/ai`). Không lưu vào `users.preferences` vì trường này là sở thích cho agent.

### 3.2. Đăng ký người đăng (lần đầu)

Một màn, tối đa hai bước, không chặn việc xem không gian quản lý.

| Bước | Nội dung | Ai thấy |
|---|---|---|
| 1. Bạn đăng tin với tư cách | Chủ nhà (chủ sở hữu) · Người được ủy quyền quản lý · Môi giới · Doanh nghiệp | Công khai nhãn trên tin |
| 2. Thông tin để ReloHome xác minh | Tên hiển thị (công khai), họ tên đầy đủ, số điện thoại; môi giới thêm số chứng chỉ hành nghề (không bắt buộc ở pilot); doanh nghiệp thêm tên doanh nghiệp và mã số thuế | Chỉ kiểm duyệt |

Sau khi gửi: hồ sơ ở trạng thái **Chờ xác minh**. Banner trong `/landlord`: "ReloHome sẽ liên hệ để xác minh. Bạn vẫn
tạo được nhà, phòng và bản nháp; tin chỉ hiển thị sau khi bạn và địa điểm đã được xác minh."

Khi `HOST_TERMS_VERSION` được cấu hình (H5), màn này có thêm một ô đồng ý riêng và lưu phiên bản cùng thời điểm đồng
ý. Hiện để trống nên không có bước này.

### 3.3. Kiểm duyệt (pilot thủ công)

Tab "Duyệt tin" hiện có thêm mục đầu tiên **"Người đăng chờ xác minh"**:

- Thẻ người đăng: loại, tên hiển thị, họ tên, số điện thoại, chứng chỉ/mã số thuế (nếu có), số địa điểm và tin đang
  chờ của người này.
- Kiểm duyệt gọi điện hoặc gọi video ngoài app để đối chiếu, rồi chọn **Đã xác minh** kèm cách xác minh
  (`phone_call`, `video_call`, `in_person`) và ghi chú ngắn; hoặc **Cần bổ sung** kèm lý do.
- Các thẻ địa điểm và tin trong hàng chờ ghi trạng thái người đăng. Nút "Xác minh địa điểm" và "Duyệt và hiển thị" bị
  khóa khi người đăng chưa được xác minh (cùng cách đang khóa khi địa điểm chưa xác minh).
- Không tự xác minh hồ sơ của chính mình (như quy tắc hiện có với địa điểm và tin).

### 3.4. Người thuê thấy gì

- Trên chi tiết tin tự đăng: nhãn loại người đăng ("Chủ nhà", "Môi giới"…) và "Người đăng đã được ReloHome xác minh".
- Không có số điện thoại hay họ tên đầy đủ. Liên hệ vẫn qua hộp thư trong app (SPEC-021: "không tự công khai số điện
  thoại").
- Tin nguồn (crawl) giữ nguyên, không có nhãn này.

## 4. Dữ liệu

Migration mới `014_housing_host_profiles.sql`, chỉ thêm bảng:

```sql
CREATE TABLE IF NOT EXISTS housing.host_profiles (
    user_id text PRIMARY KEY,                 -- id tài khoản từ gateway, cùng nguồn với management_members.user_id
    poster_type text NOT NULL CHECK (poster_type IN ('owner', 'manager', 'broker', 'business')),
    display_name text NOT NULL,
    legal_name text NOT NULL,
    phone text NOT NULL,
    broker_license_no text,
    business_name text,
    tax_code text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'needs_info')),
    verification_method text CHECK (verification_method IN ('phone_call', 'video_call', 'in_person')),
    review_note text,                         -- chỉ kiểm duyệt đọc; không ghi số giấy tờ
    info_request text,                        -- lý do "cần bổ sung", người đăng thấy
    reviewed_at timestamptz,
    reviewed_by text,
    terms_version text,                       -- null khi chưa bật điều khoản (H5)
    terms_accepted_at timestamptz,
    revision integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
```

- Grant cho app role trong `migrate.ts`: `SELECT, INSERT, UPDATE` trên bảng này, giống các bảng của migration 013.
- Danh sách cách xác minh nằm trong `CHECK`; khi có VNeID hoặc bên eKYC thì thêm giá trị mới bằng migration, không đổi
  code đọc.
- Sửa `poster_type`, `legal_name`, `phone`, `broker_license_no`, `business_name` hoặc `tax_code` sau khi đã xác minh
  thì hồ sơ về lại `pending`. Sửa `display_name` thì không.
- Xóa tài khoản: xóa luôn hồ sơ (cascade theo luồng xóa tài khoản sẵn có khi có).

## 5. API (Platform API, `housing-management.ts`)

| Endpoint | Ai gọi | Ghi chú |
|---|---|---|
| `GET /v1/host/profile` | Người dùng | `{profile, terms_version}`; `profile` là `null` khi chưa đăng ký |
| `PUT /v1/host/profile` | Người dùng | Tạo hoặc sửa, có `revision`; trả `409` khi xung đột |
| `GET /v1/moderation/housing/queue` | Kiểm duyệt | Thêm `hosts[]` (hồ sơ `pending`), và `host_status` cho mỗi địa điểm và tin |
| `POST /v1/moderation/host/:userId/review` | Kiểm duyệt | `{decision: verify\|needs_info, method?, note?, reason?}`; không cho tự duyệt |

Quy tắc mới ở server, cùng kiểu `ManagementError` đang có:

- `POST /v1/landlord/properties` khi chưa có hồ sơ → `409` với `code: host_profile_required`.
- Duyệt địa điểm hoặc tin khi người đăng chưa `verified` → `409` với `code: host_not_verified`.
- Tạm khóa người đăng: chưa làm (H9).

Contract đọc (`packages/contracts/src/housing.ts`) chỉ thêm trường optional trong `management`:
`poster_type` và `host_verified`, mặc định `null`/`false`, để client cũ vẫn parse được.

Gateway (`Frontend/server.py`): thêm `host/profile` và `moderation/host/{id}/review` vào `HOUSING_MANAGEMENT_PATHS`.
Danh tính vẫn lấy từ session; body không mang `user_id`.

## 6. Cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `HOUSING_MODERATOR_IDS` | (có sẵn) | Tài khoản kiểm duyệt |
| `HOST_TERMS_VERSION` | trống | Trống: không có bước đồng ý điều khoản. Có giá trị: bắt đồng ý phiên bản này; phiên bản mới thì hỏi lại |

Không gán cứng danh sách cách xác minh, loại người đăng hay nhãn hiển thị trong giao diện; nhãn đi qua `uiText` và
`en.json`.

## 7. Tương thích với thiết kế của QuangDung

| Nguyên tắc trong SPEC-021 / housing-product-v1 | Thiết kế này |
|---|---|
| Chỉ thay đổi additive; không đổi endpoint và field cũ | Một bảng mới, hai endpoint mới, hai trường optional trong `management` |
| Persistence trong schema `housing`, không thêm database hay microservice | `housing.host_profiles` trong PostGIS |
| Gateway gắn trusted `X-User-Id`; browser không tự khai actor | Giữ nguyên |
| Quyền kiểm tra theo từng địa điểm ở server | Giữ `management_members`; hồ sơ chỉ thêm điều kiện ở bước tạo và bước duyệt |
| Moderator lấy từ cấu hình server, khác với Landlord | Giữ `HOUSING_MODERATOR_IDS`; không tự duyệt hồ sơ của mình |
| Chuẩn bị bản nháp trong lúc chờ xác minh | Giữ (H8) |
| Liên hệ qua hộp thư trong app, không công khai số điện thoại | Số điện thoại chỉ kiểm duyệt thấy |
| Landlord UI ở `/landlord`, CSS riêng; không đổi hierarchy của `/ai` | Chỉ thêm nút chuyển chế độ trên header chung |
| MVP chỉ tạo tin mới, chưa claim tin crawl | Giữ; tin crawl không có nhãn người đăng |
| Analytics chỉ từ event thật | Không đổi |

Với payment-design: chưa đổi luồng tiền nhà (D7: tiền nhà vẫn trả thẳng cho chủ nhà, app chỉ ghi "cần trả" và "đã
báo trả"). Quyết định H2 chỉ ghi nhận hướng dài hạn. Khi làm luồng "giữ tạm rồi chuyển lại", hồ sơ người đăng sẽ cần
thêm phương thức nhận tiền; phần đó thuộc payment-design §16.5, không thuộc thiết kế này.

## 8. Dữ liệu cũ và chuyển đổi

- Không backfill. Địa điểm và tin đã có giữ nguyên trạng thái; tin đang hiển thị vẫn hiển thị.
- Người đã có địa điểm nhưng chưa có hồ sơ: vào `/landlord` thấy banner yêu cầu khai hồ sơ; địa điểm mới và lần duyệt
  tiếp theo mới áp dụng quy tắc mới.
- Dữ liệu thử trên máy local (tài khoản `chunha@example.test`…) không ảnh hưởng staging.

## 9. Để sau

1. Điều khoản chủ nhà và quy chế đăng tin (team bàn), bật qua `HOST_TERMS_VERSION`.
2. Tạm khóa người đăng (H9): trạng thái, tin đang hiển thị ẩn ngay hay báo trước. Không đưa lên staging khi chưa chốt.
3. Xác minh điện tử (VNeID hoặc bên eKYC) thay cho pilot thủ công trước khi lên production.
4. Bằng chứng quyền cho thuê theo từng địa điểm (sổ, hợp đồng, ủy quyền), cùng lúc với bước 3.
5. Phương thức nhận tiền cho luồng "giữ tạm rồi chuyển lại" (payment-design §16.5).
6. Đổi địa chỉ hoặc vị trí của địa điểm đã xác minh thì xác minh lại (lỗ hổng ghi nhận khi test HP-09).

Lưu ý cho bước 3 và 5: khi chạy thật, việc giữ và chuyển tiền phải đi qua đơn vị trung gian thanh toán có phép (như
ZaloPay), và có thể kéo theo nghĩa vụ khấu trừ thuế của sàn có chức năng thanh toán. Cần hỏi ý kiến pháp lý trước khi
lên production, như payment-design §16.5 đã ghi.

## 10. Tiêu chí nghiệm thu

- **HM-01:** Một tài khoản chuyển qua lại hai chế độ; chat, tìm nhà, đã lưu, xem nhà và thanh toán của người thuê không
  đổi (regression).
- **HM-02:** Chưa có hồ sơ: tạo địa điểm bị từ chối với `host_profile_required`; giao diện mở màn đăng ký.
- **HM-03:** Hồ sơ đang chờ: vẫn tạo nhà, phòng, bản nháp và gửi duyệt được; kiểm duyệt không duyệt được địa điểm hay
  tin của người này (`host_not_verified`).
- **HM-04:** Kiểm duyệt xác minh hồ sơ, ghi cách xác minh; không tự xác minh hồ sơ của mình; người khác không đọc được
  hồ sơ không phải của mình.
- **HM-05:** Chi tiết tin hiện loại người đăng và "đã xác minh"; không lộ họ tên đầy đủ hay số điện thoại; tin crawl
  không đổi.
- **HM-06:** Sửa thông tin định danh sau khi đã xác minh đưa hồ sơ về chờ xác minh.
- **HM-07:** `HOST_TERMS_VERSION` trống thì không có bước điều khoản; có giá trị thì bắt đồng ý và lưu phiên bản.
- **HM-08:** Desktop và mobile, bàn phím, axe không lỗi; chuỗi giao diện qua `uiText`.

## 11. Thứ tự làm

1. Migration 014, grant, endpoint hồ sơ và quy tắc ở Platform API; test tích hợp trên PostGIS (HM-02..04, HM-06, HM-07).
2. Contract đọc thêm `poster_type`, `host_verified`; housing-query map trường mới (HM-05).
3. Gateway allowlist; test gateway.
4. Giao diện: nút chuyển chế độ, màn đăng ký, banner, mục "Người đăng chờ xác minh" trong tab Duyệt tin, nhãn trên chi
   tiết tin; Playwright (HM-01, HM-08).
5. Cập nhật SPEC-021 (thêm mục hồ sơ người đăng), runbook và `tasks/housing-product-v1.md`.
