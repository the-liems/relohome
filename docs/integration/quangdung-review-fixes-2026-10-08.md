# Bàn giao sửa lỗi sau review QuangDung — 08/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## Bản đã ghép

- Nguồn: `origin/QuangDung@374d38c`.
- Nhánh local: `fix/quangdung-review-20261008`.
- Commit `b10d225` giữ lại toàn bộ thay đổi local trước khi ghép; `666c914`
  ghép QuangDung vào workspace đang làm. Không reset hoặc ghi đè `.env`/database.
- Giữ UI mới, Roommate, lịch sử lựa chọn liên dịch vụ và các công cụ geocode
  của teammate. Giữ các tối ưu Housing/Flight và đường báo giá Moving từ form.
- Không merge thêm các thay đổi mới trên `main`; cần review/CI theo đúng nhánh
  đích khi tạo PR. Chưa push, tạo PR, merge trên GitHub hoặc deploy.

## Những lỗi đã sửa

### 1. Lựa chọn được nhớ không đồng nghĩa giá còn dùng được

Thêm `src/agents/selections.py` làm quy tắc dùng chung cho tiến trình, dữ liệu
selection trả UI, khôi phục căn nhà đã chọn cho Intake và kiểm tra chọn trên UI.

Một lựa chọn hiện hành phải thuộc kết quả đúng task/domain, có cả trạng thái
task **DONE** và kết quả **done**, ID đã được quan sát và thời hạn còn hợp lệ.
Task STALE/FAILED/PENDING/NEEDS_INPUT không được tính giá hay xuất thành
selection hiện hành. Fact cũ không tự kích hoạt task ngoài kế hoạch hiện tại;
lựa chọn lịch sử được lưu riêng vẫn có thể dùng nếu kết quả còn hợp lệ.

Nhãn lựa chọn cũ vẫn có thể xuất hiện trên tiến trình, nhưng giá là `null`,
không tính tổng và không gắn nhãn đã chốt khi không còn hợp lệ. Không xóa hay
diễn giải lại biên nhận trong `committed`; đây là tổng phương án chọn, không
phải sổ thanh toán.

### 2. Thời hạn Flight và Moving

- Kiểm tra `expires_at` của **đúng offer được chọn**, thay vì chỉ xét Moving.
- Chỉ dùng thời hạn cấp kết quả khi offer không có trường thời hạn riêng.
- Thời hạn riêng bị lỗi/null không được che bằng thời hạn chung còn hiệu lực.
- Flight/Moving thiếu thời hạn, thời hạn sai định dạng/không có timezone hoặc
  đã hết hạn đều không còn là giá hiện hành; cần tìm/báo giá lại.
- Offer khác hết hạn không làm mất hiệu lực của offer đang chọn còn hạn.
- Housing không bị áp đặt một TTL giá mới; nếu có thời hạn tường minh thì vẫn
  phải kiểm tra. Đây không phải cam kết listing còn tồn tại mãi trên provider.

### 3. Giờ yên tĩnh của Roommate

Schema chấp nhận giờ địa phương ở độ chính xác **phút**, phù hợp phép tính
normalization và UI hiện tại. Chấp nhận `22:00` và `22:00:00`, từ chối giây/
microsecond khác 0. Khoảng `22:00:00–22:00:30` không còn lọt qua schema rồi bị
hiểu nhầm thành cả ngày. Khoảng qua nửa đêm vẫn được hỗ trợ.

### 4. Lint và khả năng review

Sửa lỗi lint trong test geocode và scripts geocode bằng sắp xếp import,
formatting, `datetime.UTC`, tách các câu lệnh cùng dòng và đổi lambda sang hàm.
Không tắt quy tắc lint. Ngoại lệ `StopRun` được giữ tên tương thích cho tooling
đang import script. Không chạy geocode apply, restore hoặc migration dữ liệu.

## LLM và độ linh hoạt

Không thay Intake/Planner/domain agents bằng bộ phân loại keyword, không đổi
model hay prompt trong đợt sửa này. Các kiểm tra bằng code chỉ bảo vệ tính hợp
lệ của dữ kiện, giá và trạng thái. Chat vẫn qua LLM; form Moving đã có lựa chọn
gói xe cụ thể tiếp tục đi đường typed intent không cần diễn giải lại bằng LLM.
Tên địa điểm và service ID dùng trong kiểm thử không được đưa thành nhánh xử
lý riêng trong code sản phẩm.

## Kiểm chứng đã thực hiện

| Kiểm tra | Kết quả |
| --- | --- |
| `ruff check src/ tests/` và ba script geocode | Qua |
| Roommate + progress, trừ test composition dùng graph fake | **185 qua** |
| Geocode, bỏ các ca dùng mock HTTP/patch filesystem | **29 qua**, 4 không chạy |
| Frontend: TypeScript + Vite build | Qua |
| LifeFlow: build tất cả workspace TypeScript | Qua |
| Preflight DB/schema và health của 6 service local | Qua |

**214 là số test duy nhất trong hai bộ cuối**, không cộng thêm các lần chạy
lặp lại tập con. Test tmp ban đầu vướng quyền thư mục Windows; chạy lại trong
thư mục private mới ở `logs/` đã qua. Không nới guard private storage để làm
test xanh. Các test hồi quy mới kiểm tra hàm/schema thuần, không thay provider
bằng mock và không thêm dữ liệu demo vào DB ứng dụng.

### Luồng thật trên DB/provider hiện tại

1. Tìm tối đa 3 nhà ở Cầu Giấy/Hà Nội dưới 6 triệu: **ANSWER**, 3 kết quả thật,
   **9,23 giây**. Chọn căn trên endpoint UI: tổng tháng **1.100.000đ**.
2. Cùng hội thoại, tìm chuyến Hà Nội → Đà Nẵng cho một người lớn và giữ căn đã
   chọn: **ANSWER**, 5 offer SerpApi, **12,57 giây**. Chọn offer vẫn giữ căn nhà;
   tổng một lần **994.781đ**. Không đặt vé.
3. Lấy điểm Đại học Bách khoa Hà Nội và Đại học Kinh tế Quốc dân từ Map thật,
   xác nhận pin trong form, lấy gói `HAN-ECO` từ catalog AhaMove thực tế:
   báo giá staging **1,01 giây**, giá **19.000đ**, **0 lượt LLM**.
4. Đổi giờ trên form và báo giá lại: **0,96 giây**. Lựa chọn giá cũ không còn
   xuất thành selection hiện hành, tổng chưa chọn trở về 0. Không đặt xe.

Các thời gian/giá trên là quan sát của ca cụ thể, không phải SLA hay giá cố
định. Có lần kiểm thử ban đầu lỗi do encoding PowerShell và đọc sai schema
response của harness; đã sửa cách chạy rồi hoàn thành các luồng nêu trên.
Không có giao dịch đặt xe/thanh toán, không import/restore data mới.

## Phần vẫn cần trước khi release

- Chưa chạy **toàn bộ** pytest/CI GitHub, browser E2E hoặc kiểm thử production.
  Kết quả local này không thay cho required checks/review trên PR.
- Roommate đang **tắt theo cấu hình local** (`ROOMMATE_ENABLED=false`). Không
  tự bật, thêm moderator hoặc tạo hồ sơ giả. Các ca backend/private API/storage
  chạy trên database test riêng; vẫn cần người dùng thật, moderation và các
  release gate của teammate trước khi bật sản phẩm.
- Chưa kiểm tra/migrate hồ sơ Roommate cũ có giây khác 0; nếu có dữ liệu đó,
  cần đối soát và xác nhận lại, không tự làm tròn để đổi ý nghĩa hard preference.
- Chat có LLM vẫn mất khoảng 9–13 giây ở các ca trên. Đợt sửa này không tuyên
  bố tăng tốc toàn bộ chat; đường form/UI không gọi LLM vẫn được giữ nguyên.
- Sau khi push theo yêu cầu riêng: tạo PR có liên kết issue phù hợp, review diff
  và chạy CI theo nhánh đích; không merge chỉ vì build local đã qua.

Nguồn review độc lập ban đầu:
[quangdung-independent-review-2026-10-08.md](../review/quangdung-independent-review-2026-10-08.md).
