# Kiểm tra các dịch vụ và lỗi form Flight — 12/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## Kết luận theo bằng chứng

Yêu cầu Flight trong ảnh đã đi qua form và tới Agent. Log của lượt đó ghi
`intake failed: LLM_PROVIDER_ERROR`; kiểm tra structured output tối thiểu nhận
HTTP 403 từ OpenRouter vì key đã chạm giới hạn tổng 2 USD, không tự reset.
Đây không phải lỗi đọc nơi đi/nơi đến của form hay lỗi SerpApi.

Sau khi người dùng tăng giới hạn, cùng cấu hình LLM trả structured output thành công.
Không sửa `.env`, model, backend, API contract, thuật toán hoặc cơ chế giao dịch.

Các lượt browser thật dùng build của ứng dụng, gateway với tài khoản test riêng
và Agent/Location/Moving/Flight đang chạy local. Không đặt xe, xuất vé hoặc thanh toán.

## Sửa trong phạm vi frontend

- HTTP 200 có response `kind=ERROR` được coi là một lượt form thất bại. Form
  hiển thị thông báo của Agent và giữ nơi đi/đến, ngày, loại hành trình, số người.
- Tạo hội thoại từ màn hình mới không làm unmount dialog trước khi nhận kết quả.
  Chuyển sang hội thoại khác vẫn đóng form để không mang dữ liệu sang người/mục tiêu khác.
- Form clarification trong chat cũng giữ đúng component đang nhập sau ERROR.
  Không tìm lại form bất kỳ trong lịch sử. Gửi yêu cầu chat mới xóa binding này.
- Lỗi không tự gửi lại request. Người dùng tự bấm thử lại; chỉ phản hồi thành công
  mới đóng dialog hoặc chuyển tới danh sách kết quả.
- Select thành phố có accessible name VI/EN riêng, không nối tên các option.
- Bỏ dòng hướng dẫn thêm ở welcome gây quá chiều cao laptop thấp. Sáu ô dịch vụ
  và nội dung giới thiệu cũ được giữ.
- Hai test cũ của form Housing được cập nhật thao tác chọn thành phố/mở tiêu chí
  chi tiết theo UI mới; assertion giá sai và giữ dữ liệu khi lỗi vẫn giữ nguyên.

File chính: `Frontend/src/App.tsx`, `Frontend/src/components/Forms.tsx`,
`Frontend/tests/browser/service-input.spec.ts`, `app.spec.ts`,
`runtime-audit.live.spec.ts`.

## Phạm vi đã kiểm tra

| Nhóm | Bằng chứng | Kết quả |
| --- | --- | --- |
| Gateway/Agent/Roommate/Flight/Payment Python | `pytest Frontend/tests tests/test_agents tests/test_roommate tests/test_mcp_flights tests/test_mcp_payments` | 613 pass, 1 skip; fixture/DB tạm |
| Form dịch vụ | `playwright test service-input.spec.ts` | 14 pass; desktop/mobile, HTTP 200 ERROR, HTTP 502, draft, retry, responsive, axe, selection |
| Housing form/theme | Rerun `appearance: login, welcome` và `service failure preserves` | 4 pass sau sửa nhãn/thao tác test |
| Welcome thấp và form entry/clarification | Rerun có mục tiêu | 10 pass; welcome desktop/mobile qua sau bỏ dòng thừa |
| Flight form thật | Runtime browser, SGN → HAN ngày kế tiếp | Ra offers trong một lượt nhập form, không phải hỏi lại; không commit action |
| Flight chat đầy đủ thật | Runtime browser, HAN → DAD | Ra offers và mở workspace |
| Flight chat thiếu thông tin thật | Runtime browser nhắn nhu cầu, điền form inline SGN → HAN | Ra offers sau một lượt bổ sung trên form, không hỏi lại; không commit action |
| Housing thật | Runtime browser tìm phòng HCM | Mở map, viewport trả features, list hết loading, không lỗi JS |
| Moving thật | Runtime browser chọn A/B từ gợi ý | Hai điểm được xác nhận, catalog hãng có gói; chưa submit quote/order |
| Contracts/MCP/Moving unit TS | `npm run test:ci` trong LifeFlow | 58 pass, 14 skip; Moving API không có test file riêng trong lệnh này |
| Housing-query unit TS | Nhánh test chạy trước DB integration fail | 30 pass; không coi phần integration skip/fail là pass |
| Platform/Location unit TS | `vitest run --exclude '**/*.integration.test.ts' platform-api/tests mcp-server/tests` | 20 pass, 11 skip |
| Build | `npm run build` trong Frontend | TypeScript/Vite qua; build mới phục vụ tại 8503 |
| Roommate/Guides/Housing chủ nhà/đánh giá/hẹn xem | Lượt full browser fixtures | Các file `roommate`, `service-entry`, `housing-product`, `housing-reviews`, `viewing-closed-request` đều qua |

Các kiểm tra routing local của lượt khởi động trả route `Ok` ở cả 9 cổng.
Roommate availability bật và có chế độ demo. Readiness không thay cho kiểm tra
mọi API ngoài; checkout/giao dịch sandbox vẫn chưa bật trong launcher mặc định.

## Lượt full browser và việc còn mở

Chạy full desktop/mobile: **274 ca: 207 pass, 39 fail, 28 skip**. Lượt này diễn ra
trước khi sửa welcome và cập nhật hai thao tác test Housing. Không báo full suite xanh.
Sau đó 5 ca fail thuộc welcome/Housing form đã được rerun và qua. 34 ca còn lại
trong danh sách full vẫn cần đóng riêng; không suy ra toàn bộ chúng là lỗi sản phẩm.

Đối chiếu source baseline trước khi thêm form trong checkout `merge-120-123-check`
(frontend source khớp `a778812`): 7 ca tiêu biểu chạy độc lập, **6 fail giống bản hiện
tại, 1 welcome pass**. Sáu nhóm fail đã xác nhận có từ trước:

1. Flight timeline/workspace không mở trong fixture lịch sử.
2. Account keyboard test mong tab Đã lưu là tab cuối.
3. Moving PARTIAL test tìm nút theo selector `.ws-select-small` cũ.
4. Map test không thấy thông tin route/warning được kỳ vọng.
5. Housing test chọn/lưu/plan/reload thiếu control được kỳ vọng.
6. Flight test sorting/selection không thấy workspace.

Các nhóm khác của 34 ca: hết hạn offer, detail, tracking, plan summary và lỗi
selection. Cần đối chiếu fixture với projection/current task của API thật, cập nhật
selector nếu UI đã đổi, hoặc tái hiện lỗi runtime rồi sửa. Không xóa/skip assertion
để làm suite xanh. Các bài live opt-in không chạy trong full fixture suite vẫn là skip.

`npm run test` LifeFlow dừng ở DB integration Housing-query: trùng primary key
`district_7_test` trong `geo.administrative_areas`. Setup dùng BEGIN và afterAll
ROLLBACK; không xóa dữ liệu ứng dụng để vượt lỗi. Cần DB test riêng/fixture ID không
va chạm trước chạy lại nhánh integration. Đây chưa phải bằng chứng truy vấn nhà thật lỗi.

## Artifacts local

- Full browser JSON: `.tmp/service-regression-20261012.json`.
- Baseline JSON: `.tmp/service-baseline-20261012.json`.
- Các lượt follow-up: `.tmp/service-followup-*.json`.
- Python JUnit: `logs/local/service-regression-20261012.xml`.
- Runtime screenshots/test output: `Frontend/test-results/runtime-audit/`.
- Runtime logs: `data/local-mvp-logs/`.

Artifacts và auth test DB là ignored, không đóng gói token/contact/API key vào tài liệu.
