# Bàn giao sửa review PR #83 — chọn nhiều căn, hẹn xem, chốt nhà

Ngày: 09/10/2026. Issue: [#84](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/84).
PR: [#83](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/83), `feat/housing-viewing` → `khoa`.
Không deploy và không merge vào `main` trong công việc này.

## Giữ nguyên thiết kế của teammate

- Chọn nhiều căn chỉ để hẹn xem; chưa đổi `selected:property` hay địa chỉ chuyển đồ.
- Sau khi ghi đã gặp chủ nhà, người dùng chốt đúng một căn và chỉ định căn dự phòng.
- Calendar vẫn là chế độ thử: app không liên hệ chủ nhà. Thỏa thuận/đã trả tiền là tự báo, không xác minh hay thu tiền.
- Các thao tác UI có kiểu không gọi LLM. Intake/Planner/subagent vẫn giữ nguyên quyền suy luận.
- Cờ độc lập `HOUSING_VIEWING_ENABLED`; không cần bật checkout/thanh toán mô phỏng để dùng hẹn xem.

## Các lỗi đã sửa độc lập

1. `visit` không thể hạ trạng thái `agreed`/`reported_paid` thành chưa chốt hay bỏ chọn. Khi báo không đi được, xóa cả kết quả xem cũ.
2. API chốt giữ khóa hội thoại xuyên suốt: ghi ý định → đọc lại listing thật → chọn trong graph → ghi thỏa thuận/tập dự phòng → đồng bộ projection. Yêu cầu đồng thời nhận 409, không chen ngang; helper chọn nội bộ không tự lấy khóa lần thứ hai.
3. Ghi fingerprint tập căn/lịch/kết quả xem; quyết định cũ bị từ chối nếu tập đã thay đổi, căn bị bỏ chọn, đã chốt căn khác hoặc đã mở lại. Không hồi sinh căn hay replay quyết định đã kết thúc.
4. Cùng `decision_key` chỉ được gửi lại cùng tiền thuê, cọc, ngày dọn vào và tập căn giữ lại. Sửa nội dung sau lỗi nghiệp vụ thì UI tạo khóa mới. Nếu lỗi mạng/server làm kết quả chưa rõ, UI giữ nội dung và khóa để retry; không đổi yêu cầu khi chưa đối soát.
5. Thỏa thuận, bỏ chọn/giữ dự phòng và bước quyết định được ghi trong cùng transaction SQLite; lỗi ghi DB rollback toàn bộ bước này. Graph và store là hai nơi lưu riêng, **không** được gọi là một transaction xuyên cả hai; các bước lưu ý định cho phép retry/repair projection.
6. Map không hiện “Bỏ chọn” cho căn đã chốt. Lỗi chọn/bỏ chọn được hiển thị thay vì nuốt. Bổ sung bản dịch thông báo retry; cập nhật đường API và điều kiện thời gian trong tài liệu.

## Kiểm chứng

- Ruff: pass.
- Build Frontend (`tsc -b` + Vite): pass.
- 38 regression test Housing/Viewings/API/graph: pass, gồm 18 test mới với SQLite thật (trạng thái, retry, rollback bằng lỗi SQLite thật).
- Suite portable trên Windows: **704 passed, 90 skipped, 47 subtests passed**. Loại riêng ba module CI runner/container/prompt-hook phụ thuộc shell/quyền symlink Linux; không coi đây là kết quả CI Linux.
- Ba module bị loại trên Windows được chạy riêng trong container Linux: **15 passed, 50 subtests passed**.
- LifeFlow TypeScript workspace build + `test:ci`: pass trên máy local (37 contract test pass; 14 test live opt-in skip). Kiểm tra lại build/test với giới hạn heap Node 512 MiB để đối chiếu runner.
- Test live mới `tests/test_api/test_viewing_live.py`: pass, dùng **Location MCP + dữ liệu DB thật + LangGraph checkpoint + HTTP handler hiện tại**, state riêng trong thư mục tạm. Ba request chốt/chốt/bỏ chọn đồng thời: một 200, hai 409; retry đúng nội dung thành công, đổi tiền với cùng khóa bị chặn, trạng thái graph/store khớp, replay sau mở lại bị chặn, căn đã báo trả tiền không bị hạ trạng thái.
- Test live chỉ đọc provider; không tạo dữ liệu Housing giả, không gọi LLM, không đặt xe/đặt nhà/thanh toán. Bỏ điều kiện thời gian xem chỉ trong instance test tách riêng, không sửa `.env` của người dùng.

Chạy live từ root project (cần Location MCP đang chạy):

```powershell
$env:RUN_HOUSING_VIEWING_LIVE = '1'
$env:VIEWING_ENV_FILE = "$PWD\.env"
python -m pytest tests/test_api/test_viewing_live.py -q
Remove-Item Env:RUN_HOUSING_VIEWING_LIVE, Env:VIEWING_ENV_FILE
```

## Giới hạn còn lại

- Khóa hiện tại là nội bộ **một worker/một host**. Không tuyên bố an toàn multi-worker; cần khóa/CAS dùng chung và kiểm soát chuyển trạng thái khi triển khai nhiều instance.
- Chưa có landlord availability/confirmation thật. Không dùng `HOUSING_VIEWING_TEST_VISIT_ANYTIME` cho production (runtime bỏ qua cờ khi `APP_ENV=production`).
- CI GitHub phải kiểm tra đúng SHA mới trước khi kết luận sẵn sàng merge; lỗi runner mã 137 ở lần chạy SHA cũ không phải bằng chứng code mới đã qua CI.
- CI trên `69fd5d6` đã qua MCP smoke nhưng compiler `platform-api` bị kill mã 137, không báo lỗi type. Thêm giới hạn heap Node 512 MiB **chỉ cho bước TypeScript CI** và log cgroup để xác định tài nguyên; không bỏ test/typecheck và không sửa runner/deploy. Đây là biện pháp cần kiểm chứng, không khẳng định đã giải quyết lỗi hạ tầng.
