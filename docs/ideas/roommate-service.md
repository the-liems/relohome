# ReloHome — Product Specification: Tìm người ở cùng

- Phiên bản: 1.0.
- Ngày cập nhật: 2026-10-07, Asia/Saigon.
- Trạng thái: product spec v1.0 đã chốt; backend/API/Agent RM-01–31 và frontend các màn tìm/kết nối/hồ sơ cơ bản đã triển khai. Service chưa phát hành/bật mặc định. Evidence: [backend checkpoint](../integration/roommate-backend-checkpoint.md), [frontend handoff](../../Frontend/ROOMMATE_UI_HANDOFF.md). Các acceptance criteria cho bản phát hành đầy đủ vẫn giữ nguyên.
- Issue theo dõi: [#65 — ReloHome: tìm người ở cùng](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/65).
- Phạm vi tài liệu: trải nghiệm, quyền sử dụng, quy tắc nghiệp vụ sản phẩm và tiêu chí nghiệm thu. Không định nghĩa database schema, API chi tiết hoặc code.
- Các chính sách dưới đây là baseline nghiệm thu; không coi toàn bộ trải nghiệm đã hoàn tất chỉ vì backend đã triển khai.

## 1. Mục tiêu và nguyên tắc

Giúp người thuê tìm những người đang thực sự có nhu cầu ở cùng, hiểu mức đáp ứng các ưu tiên của mình và chủ động quyết định có kết nối hay không.

Service phục vụ sinh viên, người đi làm và các nhóm người thuê khác đủ điều kiện sử dụng. Đây là một service bổ sung trong ReloHome, hoạt động độc lập với tìm nhà, chuyển đồ và chuyến bay.

Các nguyên tắc cố định:

- Tìm và xếp hạng hồ sơ đang có nhu cầu; người dùng tự xem, quan tâm, gửi yêu cầu và quyết định liên hệ.
- Không tự ghép cặp, không chọn người thay người dùng, không tự gửi yêu cầu.
- Dữ liệu từ hồ sơ tự đăng. Hồ sơ pilot phải có sự đồng ý và tài khoản của chủ hồ sơ để họ quản lý, xác nhận nhu cầu và xử lý yêu cầu liên hệ.
- Scoring bằng code từ tiêu chí có cấu trúc, có thể giải thích và cho kết quả ổn định.
- Không gọi LLM cho từng candidate hoặc dùng LLM tính điểm. LLM chỉ hỗ trợ hiểu yêu cầu ngôn ngữ tự nhiên và chuyển thành tiêu chí; giải thích thông thường dùng lý do từ scoring.
- Thông tin liên hệ chỉ được chia sẻ theo consent cụ thể giữa hai người.
- Không suy ra giới tính, tính cách, độ tin cậy hay thói quen từ ảnh, tên hoặc tin housing crawl.
- Không yêu cầu đã chọn nhà để tìm người. Ngữ cảnh căn nhà chỉ được gợi ý khi liên quan và người dùng xác nhận.
- Mở service không thay đổi lựa chọn hoặc tạo giao dịch trong Housing, Moving, Flight.

### Thành công được đánh giá bằng

Người dùng tìm được hồ sơ còn nhu cầu, hiểu lý do phù hợp và tạo được kết nối tự nguyện hữu ích. Theo dõi tỷ lệ có kết quả, xem hồ sơ, gửi/chấp nhận yêu cầu, thời gian phản hồi, phản hồi về top kết quả và tỷ lệ báo cáo. Số điểm cao hoặc số yêu cầu gửi đơn thuần không chứng minh thành công.

## 2. Các quyết định sản phẩm đã chốt

| Điểm cần chốt | Quyết định phiên bản 1.0 |
| --- | --- |
| Quyền sử dụng | Khách xem giới thiệu và minh họa; dữ liệu hồ sơ thật và chức năng service dành cho người đăng nhập đã xác nhận đủ 18 tuổi, chấp nhận điều kiện sử dụng service. |
| MVP / post-MVP | MVP là đợt phát hành đầu của service trong sản phẩm hiện tại, bao gồm tìm, hồ sơ, quan tâm, consent hai chiều, inbox yêu cầu, block/report và chất lượng vận hành. |
| Score khi thiếu dữ liệu | Chỉ hiện số khi đủ điều kiện tại mục 7; trường hợp còn thiếu hiển thị các điểm phù hợp đã biết, không gắn nhãn tương thích cao. |
| Lifecycle | Hồ sơ hoạt động 30 ngày sau đăng/xác nhận lại; yêu cầu pending 7 ngày; cooldown và giới hạn gửi tại mục 9. |
| Contact consent | Người gửi xác nhận kênh trước khi gửi; người nhận xác nhận kênh khi chấp nhận; chia sẻ hai chiều trong 7 ngày từ lúc chấp nhận, có thể thu hồi sớm. |

Các giá trị này là baseline sản phẩm đã lựa chọn để technical design có thể thực hiện. Thay đổi chính sách phải cập nhật spec và tiêu chí nghiệm thu tương ứng.

## 3. Quyền xem và sử dụng

### 3.1 Điều kiện và ma trận quyền

Service dành cho người từ 18 tuổi. Dùng xác nhận tự khai về điều kiện tuổi, không yêu cầu ngày sinh đầy đủ hoặc giấy tờ trong MVP. Xác nhận tuổi không tạo nhãn đã xác minh danh tính.

| Hành động | Chưa đăng nhập | Đã đăng nhập, chưa đủ điều kiện service | Đã đăng nhập, xác nhận 18+ và chấp nhận điều kiện |
| --- | --- | --- | --- |
| Xem giới thiệu, hướng dẫn | Có | Có | Có |
| Xem minh họa có nhãn dữ liệu mẫu | Có | Có | Có |
| Tìm/xem hồ sơ người thật | Không | Không | Có |
| Nhập tiêu chí và xem score cá nhân hóa | Không | Không | Có |
| Lưu quan tâm | Không | Không | Có |
| Tạo/sửa/đăng hồ sơ của mình | Không | Không | Có |
| Gửi/nhận/chấp nhận yêu cầu | Không | Không | Có, khi đạt điều kiện tại mục 9 |
| Xem liên hệ | Không | Không | Chỉ khi thuộc đúng kết nối có consent còn hiệu lực |
| Chặn/báo cáo | Không | Không | Có |

- Người đăng nhập chỉ cần xác nhận điều kiện service một lần; thay đổi điều kiện cần người dùng đồng ý lại trước thao tác tiếp theo.
- Nếu tự khai chưa đủ 18 tuổi, không cho dùng dữ liệu thật hoặc kết nối; không ảnh hưởng quyền dùng các service khác.
- Khi khách bấm vào service, hiển thị giới thiệu và CTA đăng nhập. Sau đăng nhập giữ ý định mở service và tiêu chí đã nhập; không lưu contact trong phần chuyển tiếp.
- Không có danh sách người thật, avatar thật, score cá nhân hoặc hồ sơ thật được truy cập qua trang công khai, link chia sẻ khi chưa đăng nhập hay bản xem trước cho công cụ tìm kiếm.
- Hồ sơ đang tìm chỉ được xem bởi người đủ điều kiện service. Link hồ sơ tạm dừng/hết hạn/đã tìm được chỉ hiện trạng thái không còn nhận yêu cầu, ngoại trừ chủ hồ sơ; chi tiết yêu cầu hiện có chỉ dùng bản giới thiệu đã được cho phép chia sẻ riêng.
- Minh họa dùng dữ liệu giả được ghi rõ, không được xuất hiện như kết quả thật hoặc cho gửi yêu cầu.
- Không bắt buộc đăng hồ sơ công khai để tìm, xem chi tiết hoặc lưu quan tâm.
- Gửi yêu cầu cần bản giới thiệu đủ thông tin và consent, nhưng người gửi có thể giữ bản giới thiệu riêng tư, chỉ chia sẻ với người nhận. Việc gửi không tự đăng hồ sơ lên danh sách.
- Chỉ chủ hồ sơ sửa, đăng, tạm dừng hoặc xóa hồ sơ của mình. Nhân sự được phân quyền chỉ xử lý moderation theo vai trò; không tự chấp nhận kết nối thay người dùng.

### 3.2 Phạm vi địa lý

MVP hỗ trợ TP.HCM, Hà Nội và Đà Nẵng, sử dụng danh mục khu vực hiện có của ReloHome. Người dùng chọn một thành phố và một hoặc nhiều khu vực trong lần tìm. Nhu cầu ngoài phạm vi được thông báo rõ; không tự chuyển sang thành phố khác.

Mỗi tài khoản có tối đa một hồ sơ đăng tìm đang hoạt động, với một thành phố và các khu vực mong muốn trong thành phố đó. Có thể đổi nhu cầu qua chỉnh sửa hồ sơ.

## 4. Phạm vi phát hành

### 4.1 MVP — service đủ sử dụng trong sản phẩm

| Nhóm chức năng | Bao gồm |
| --- | --- |
| Khám phá và tìm kiếm | Mở từ Agent hoặc entry của service; tiêu chí, filter, sort, phân trang; trạng thái tải/trống/lỗi; lý do phù hợp. |
| Hồ sơ | Bản giới thiệu riêng tư, bản xem trước, đăng tìm, sửa, tạm dừng, tiếp tục, xác nhận lại, đánh dấu đã tìm được, xóa. |
| Chi tiết và quan tâm | Xem thông tin tự khai, nhu cầu, lý do và thông tin còn thiếu; lưu/bỏ lưu riêng tư. |
| Kết nối | Lời giới thiệu ngắn, consent hai chiều, inbox đã gửi/đã nhận, chấp nhận/từ chối/rút/hết hạn, xem/thu hồi liên hệ. |
| An toàn và quản lý | Block/report, giới hạn gửi, ngăn thao tác trùng, xử lý hồ sơ vi phạm, kiểm tra trạng thái sau lỗi chưa rõ kết quả. |
| Chất lượng trải nghiệm | Desktop/tablet/mobile, Việt/Anh, sáng/tối, bàn phím/focus, thông báo trong app và kiểm tra hồi quy các service cũ. |

MVP không có nghĩa là chỉ làm UI mẫu: các chức năng và quyền được liệt kê phải hoạt động với dữ liệu thật trước khi bật service.

### 4.2 Post-MVP

Có thể xem xét sau khi kiểm chứng nhu cầu:

- Chat trực tiếp trong ứng dụng, thông báo email/push.
- Mở rộng địa lý, nhiều vùng tìm và công cụ hỗ trợ nhóm người.
- Commute hoặc bản đồ khu vực nâng cao khi người dùng chủ động cung cấp địa điểm.
- Điều chỉnh trọng số qua nghiên cứu người dùng hoặc dữ liệu phản hồi.
- Quy trình xác minh danh tính/kênh liên hệ có ý nghĩa rõ ràng, nếu cần.

Không nằm trong hướng sản phẩm hiện tại: tự động ghép cặp, LLM chấm từng người, suy đoán tính cách từ ảnh, mạng xã hội/feed, đánh giá độ tin cậy tự động. Hợp đồng, chia tiền và thanh toán cần đặc tả sản phẩm riêng nếu bổ sung.

## 5. User flow và thông tin cần hỏi

### 5.1 Tìm người

1. Người dùng nói “Tôi muốn tìm người ở cùng”, “Tôi muốn ghép trọ”, “Có ai đang tìm roommate không?” hoặc mở service trực tiếp.
2. Sau kiểm tra điều kiện sử dụng, mở form tiêu chí. Những thông tin đã nói được điền sẵn để người dùng kiểm tra.
3. Hỏi gọn thành phố/khu vực, ngân sách mỗi người và loại nhu cầu. Ngân sách/thời điểm có thể chọn chưa chốt hoặc linh hoạt.
4. Các ưu tiên sinh hoạt nằm trong phần bổ sung; không ép trả lời một chuỗi câu hỏi dài trước khi xem kết quả.
5. Hiển thị hồ sơ đủ điều kiện, lý do phù hợp và điểm cần trao đổi.
6. Người dùng tự xem hồ sơ, lưu quan tâm hoặc gửi yêu cầu liên hệ.

Hai loại nhu cầu chính:

- Đã có phòng, đang tìm người ở cùng.
- Chưa có phòng, muốn tìm phòng cùng nhau.

Người dùng có thể khai sẵn sàng chuyển sang phòng khác. Hai người đều có phòng và đều không muốn chuyển không đáp ứng nhau. Không mặc định hai người đều chưa có phòng là không phù hợp.

### 5.2 Trường thông tin

Tách thông tin bản thân và mong muốn đối với người ở cùng. Tách lựa chọn “Ưu tiên” và “Bắt buộc”; các trường không chọn có nghĩa là không đặt preference, không phải đồng ý mọi điều kiện.

| Nhóm | Khi tìm | Khi đăng hoặc gửi bản giới thiệu |
| --- | --- | --- |
| Tên hiển thị, giới thiệu | Không bắt buộc | Bắt buộc; giới thiệu ngắn không chứa contact công khai. |
| Thành phố/khu vực | Bắt buộc chọn thành phố; có thể chọn toàn thành phố | Bắt buộc khai thành phố và ít nhất một khu vực. |
| Ngân sách | Khoảng/trần hoặc chưa chốt | Bắt buộc khai mức hoặc khoảng mỗi người/tháng, tiền thuê có gồm phí hay không. |
| Loại nhu cầu | Chọn nhu cầu; có thể linh hoạt | Bắt buộc khai nhu cầu và khả năng chuyển phòng nếu có phòng. |
| Thời điểm vào ở | Ngày/khoảng hoặc linh hoạt | Bắt buộc chọn một trong các cách khai đó. |
| Hút thuốc, thú cưng | Tùy chọn, hỏi bổ sung khi điều kiện hai chiều cần | Có lựa chọn chưa cung cấp; thông tin liên quan điều kiện bắt buộc phải có trước khi gửi yêu cầu. |
| Giờ yên tĩnh, sạch sẽ, giao tiếp/không gian riêng | Tùy chọn | Tùy chọn; dùng mô tả hành vi dễ hiểu. |
| Giới tính | Chỉ khi người dùng đặt preference hoặc cần kiểm tra yêu cầu đối phương | Tự khai hoặc chưa cung cấp; không suy ra từ tên/ảnh. |
| Ảnh đại diện, thông tin phòng | Không bắt buộc | Tùy chọn, do người dùng cho phép hiển thị. |
| Kênh liên hệ | Không cần để xem kết quả | Chỉ cần khi gửi/chấp nhận yêu cầu; lưu riêng tư. |

- Ngân sách luôn ghi “mỗi người/tháng”, tách tiền thuê và chi phí bổ sung; không cộng vào bảng chi phí đặt dịch vụ.
- Chỉ so sánh ngân sách khi cùng cơ sở tiền thuê/đã gồm phí. Khi cần, người dùng phải làm rõ cơ sở thay vì hệ thống tự ước lượng phí.
- “Có thú cưng” khác “chấp nhận thú cưng”; “hút thuốc” khác “cho hút thuốc trong nhà”.
- Giờ sinh hoạt được giải thích qua nhu cầu yên tĩnh và sử dụng không gian chung. Không chấm nghề nghiệp hoặc sự hướng nội/hướng ngoại là tốt/xấu.
- Không bắt buộc địa chỉ nhà chính xác, giấy tờ hoặc ngày sinh đầy đủ. Mô tả/ảnh không được dùng để lách chính sách contact.
- Hồ sơ public trong service chỉ hiện thông tin người dùng đã xem trước và cho phép công bố.

## 6. Hard filters và eligibility

Kết quả chính chỉ gồm hồ sơ đang hoạt động, còn hạn, được phép hiển thị và có nhu cầu đáp ứng loại tìm kiếm. Loại hồ sơ của chính người tìm và cặp bị chặn ở bất kỳ chiều nào.

### 6.1 Điều kiện bắt buộc

- Khu vực, trần ngân sách, thời điểm không linh hoạt hoặc preference sinh hoạt/giới tính chỉ là hard filter khi người dùng chọn “Bắt buộc”.
- Kiểm tra hard filter của người tìm đối với candidate và của candidate đối với người tìm.
- Không biết một dữ kiện cần cho hard filter không được xem là đáp ứng.
- Nếu người tìm thiếu dữ kiện để kiểm tra điều kiện của candidate, giải thích rằng bổ sung thông tin có thể mở thêm kết quả; không tự suy ra.
- MVP không có nhóm candidate thiếu hard-filter data được gắn nhãn phù hợp. Người dùng có thể bổ sung dữ kiện hoặc chủ động đổi tiêu chí sang “Ưu tiên”.
- Không tự nới hard filter khi kết quả trống.
- Kiểm tra lại eligibility và các điều kiện bắt buộc lúc gửi và lúc chấp nhận yêu cầu. Nếu không còn đáp ứng, không thực hiện thao tác và giải thích cần làm gì.

### 6.2 Soft preferences

Khu vực ưu tiên trong phạm vi đã chọn, ngân sách thuận tiện, thời điểm linh hoạt, hút thuốc/thú cưng khi không bắt buộc, giờ yên tĩnh, sạch sẽ và giao tiếp là các tiêu chí xếp hạng. Không mặc định loại theo nghề, khác giờ làm việc hoặc dữ kiện chưa khai.

## 7. Compatibility score và dữ liệu thiếu

### 7.1 Ý nghĩa

Tên hiển thị: **“Điểm phù hợp theo tiêu chí”**, dạng **82/100**. Đây là mức đáp ứng các preference của người đang tìm, không phải xác suất ở hòa hợp, điểm độ tin cậy hoặc kết quả ghép cặp.

Hard filters được kiểm tra hai chiều. Điểm mềm thể hiện ưu tiên người tìm; không tuyên bố là điểm đối xứng đầy đủ của hai người.

### 7.2 Quy tắc tính ở mức sản phẩm

Trọng số baseline v1.0:

| Tiêu chí | Trọng số |
| --- | ---: |
| Khu vực | 20 |
| Ngân sách | 20 |
| Thời điểm vào ở | 15 |
| Hút thuốc | 10 |
| Thú cưng | 10 |
| Nhịp sinh hoạt/yên tĩnh | 10 |
| Sạch sẽ | 10 |
| Giao tiếp/không gian riêng | 5 |

- Chỉ tính những tiêu chí người tìm thực sự đặt preference; chuẩn hóa theo tổng trọng số của tập tiêu chí đó.
- Mức đáp ứng mỗi tiêu chí có đủ dữ liệu nằm từ 0 đến 1. Độ phù hợp giữa lựa chọn/ngày/khu vực phải được đặc tả trong technical design, tuân thủ ý nghĩa sản phẩm ở mục 5–6.
- Tiêu chí được yêu cầu nhưng chưa đủ dữ liệu dùng mức trung tính 0,5 cho xếp hạng nội bộ và vẫn nằm trong mẫu số. Giá trị này không được mô tả như dữ kiện đã xác nhận.
- Độ đầy đủ dữ liệu = tổng trọng số tiêu chí đủ dữ liệu chia tổng trọng số tiêu chí được áp dụng.
- Không có preference thì không tạo score. Không renormalize riêng theo những trường candidate đã khai để tạo điểm cao giả.
- Sửa/ngừng dùng một preference là quyết định của người tìm; hệ thống không tự bỏ trường thiếu của candidate khỏi tiêu chí đang áp dụng.

### 7.3 Điều kiện hiển thị số

Chỉ hiển thị score số và nhãn mức phù hợp khi đồng thời:

1. Tất cả hard filters hai chiều đã được xác nhận đáp ứng.
2. Khu vực và ngân sách đủ dữ liệu để so sánh, kể cả cơ sở tính ngân sách.
3. Có ít nhất **4 tiêu chí được áp dụng và đủ dữ liệu**.
4. Trong đó có ít nhất **2 tiêu chí sinh hoạt** đủ dữ liệu: hút thuốc, thú cưng, nhịp sinh hoạt, sạch sẽ hoặc giao tiếp.
5. Độ đầy đủ dữ liệu có trọng số đạt **80% trở lên**.

Nếu không đạt, ẩn số và các nhãn “cao/trung bình/thấp”, hiển thị **“Chưa đủ thông tin để tính điểm phù hợp”** cùng các điểm đã biết và thông tin cần bổ sung. Có thể ghi “Phù hợp khu vực/ngân sách” khi thực sự đã xác nhận hai mặt này.

Khi đạt điều kiện:

- 80–100: “Phù hợp cao theo tiêu chí”.
- 60 đến dưới 80: “Phù hợp trung bình theo tiêu chí”.
- Dưới 60: “Có khác biệt cần trao đổi”.
- Số hiển thị làm tròn tới số nguyên; nhãn và thứ tự dựa trên điểm chưa làm tròn. Luôn ghi các dữ kiện còn thiếu và lý do có bằng chứng.

### 7.4 Xếp hạng và giải thích

- Trong danh sách cùng tiêu chí: nhóm đủ điều kiện hiển thị score đứng trước, xếp theo score giảm dần.
- Nhóm chưa đủ dữ liệu được tách rõ “Các hồ sơ khác đáp ứng điều kiện bắt buộc”; xếp theo mức đáp ứng khu vực/ngân sách/thời điểm đã biết, không dùng nhãn tương thích tổng thể.
- Khi không có hồ sơ đủ điều kiện hiển thị score, vẫn hiển thị nhóm còn lại và giải thích; không tạo score để lấp chỗ trống.
- Xếp hạng trên toàn bộ tập đủ điều kiện trước phân trang. Cùng dữ liệu, tiêu chí và phiên bản scoring phải có cùng thứ tự; tie-break ổn định, không ưu tiên việc chỉnh sửa thường xuyên.
- Lý do tạo từ dữ kiện đã so sánh: tối đa 3 điểm phù hợp, điểm khác biệt đáng chú ý và dữ liệu thiếu. Không suy đoán tính cách hoặc đảm bảo sống hòa hợp.
- Chỉnh tiêu chí, phân trang, xem profile, quan tâm và xử lý contact không gọi LLM. Thời gian hiểu câu chat không được đánh đồng với thời gian filter/scoring.

Ví dụ nghiệm thu:

| Trường hợp | Hiển thị |
| --- | --- |
| Chỉ biết cùng khu vực và ngân sách | Không có số; nêu hai điểm phù hợp và thiếu thông tin sinh hoạt. |
| 4 tiêu chí đủ dữ liệu, có 2 sinh hoạt, coverage 100%, hard filters đạt | Có score và lý do, ghi rõ dựa trên các tiêu chí đã chọn. |
| Coverage 79% dù các điều kiện khác đạt | Không có số hoặc nhãn phù hợp cao. |
| Coverage 85%, nhưng chỉ 1 tiêu chí sinh hoạt đủ dữ liệu | Không có số. |
| Hút thuốc là bắt buộc nhưng candidate chưa khai | Không vào kết quả chính; không tính việc chưa khai là không hút thuốc. |

## 8. Lifecycle của hồ sơ

| Trạng thái | Xuất hiện trong tìm kiếm | Nhận yêu cầu mới | Hành động của chủ hồ sơ |
| --- | --- | --- | --- |
| Bản nháp / chỉ giới thiệu riêng tư | Không | Không từ danh sách tìm kiếm | Sửa, xem trước, đăng; có thể dùng bản giới thiệu đủ thông tin để gửi yêu cầu. |
| Đang tìm | Có, nếu không bị hạn chế | Có | Sửa, xác nhận lại, tạm dừng, đã tìm được, xóa. |
| Tạm dừng | Không | Không | Sửa, xác nhận vẫn có nhu cầu và tiếp tục. |
| Đã tìm được người | Không | Không | Đăng lại khi có nhu cầu mới, hoặc xóa. |
| Hết hạn | Không | Không | Xem trước, xác nhận nhu cầu và kích hoạt lại. |
| Bị hạn chế bởi moderation | Không | Không | Xem lý do/hướng xử lý; không tự bật lại. |
| Đã xóa | Không | Không | Không truy cập hồ sơ qua link cũ. |

- Hồ sơ đang tìm có hiệu lực **30 × 24 giờ**, tính từ lúc đăng hoặc chủ động xác nhận lại nhu cầu.
- Sửa ảnh, mô tả hoặc các trường khác không gia hạn. Chủ hồ sơ phải bấm “Tôi vẫn đang tìm” để bắt đầu chu kỳ 30 ngày mới.
- Hiển thị ngày xác nhận gần nhất và hạn hiệu lực; nhắc trong app trong 3 ngày cuối. MVP không bắt buộc email/push.
- Tiếp tục sau tạm dừng, kích hoạt hồ sơ hết hạn hoặc đăng lại nhu cầu mới đều cần xác nhận chủ động và có hạn 30 ngày mới. Không tự tái đăng.
- Tạm dừng/hết hạn hủy các yêu cầu pending gửi đến hồ sơ đó; yêu cầu đã gửi đi của người này vẫn giữ hiệu lực nếu bản giới thiệu đủ điều kiện.
- Đánh dấu đã tìm được người hủy toàn bộ yêu cầu pending gửi/nhận của người đó.
- Các kết nối accepted và quyền contact đã cấp không bị thu hồi chỉ vì tạm dừng/hết hạn/đã tìm được; vẫn theo thời hạn hoặc thu hồi tại mục 10.
- Xóa hồ sơ hoặc bị hạn chế service hủy mọi pending liên quan và đóng mọi quyền chia sẻ contact liên quan. Thao tác xóa phải cảnh báo hậu quả trước xác nhận.
- Sửa thông tin bản thân hoặc hard preferences khiến pending không còn đáp ứng phải hủy pending đó với lý do rõ ràng. Sửa mô tả/soft preference không tự hủy; người nhận được biết hồ sơ đã cập nhật trước khi quyết định.
- Profile hết hạn ngay khi tới hạn, kể cả khi chưa có thông báo nhắc. Không được dựa vào việc người dùng đã mở trang để quyết định hiệu lực.

## 9. Lifecycle, expiry và cooldown của yêu cầu

### 9.1 Điều kiện gửi

Người gửi phải đủ điều kiện service, có bản giới thiệu với các trường bắt buộc tại mục 5, đáp ứng hard conditions hai chiều, chọn một kênh liên hệ và xác nhận consent. Người nhận phải có hồ sơ đang tìm còn hiệu lực; không có block/restriction ở bất kỳ chiều nào.

Trước gửi có màn review: bản giới thiệu sẽ được chia sẻ với ai, lời nhắn, kênh của người gửi chỉ mở sau khi chấp nhận, thời hạn yêu cầu và thời hạn contact sau chấp nhận. Không tự đăng bản giới thiệu đang giữ riêng tư.

Bản giới thiệu trong yêu cầu chỉ chứa nội dung người gửi đã review và cho phép chia sẻ lúc gửi; không tự bổ sung tiêu chí tìm kiếm riêng tư hoặc các trường mới khai sau đó. Thông tin hiện tại vẫn được kiểm tra để bảo đảm hard conditions khi accept; thay đổi làm yêu cầu không hợp lệ phải hủy theo mục 8–9. Người nhận có thể xem profile đang tìm hiện tại của người gửi nếu profile đó đang công khai trong service.

### 9.2 Trạng thái và thời hạn

| Trạng thái | Ai tạo chuyển trạng thái | Hệ quả |
| --- | --- | --- |
| Chờ phản hồi | Người gửi xác nhận gửi | Người nhận đọc giới thiệu; không bên nào thấy contact của bên kia. |
| Đã chấp nhận | Người nhận xác nhận chấp nhận và kênh chia sẻ trước hạn | Mở quyền contact hai chiều theo mục 10. |
| Đã từ chối | Người nhận từ chối | Không mở contact; áp dụng cooldown 30 ngày với người gửi. |
| Đã rút | Người gửi rút khi còn pending | Không mở contact; cooldown 24 giờ với người gửi. |
| Hết hạn | Tới hạn khi vẫn pending | Không mở contact; cooldown 7 ngày với người gửi. |
| Đã hủy do không còn đủ điều kiện | Profile ngừng nhận, thay đổi contact, không đáp ứng hard conditions, xóa hoặc hạn chế | Nêu lý do phù hợp; không mở contact. Không cộng cooldown thời gian, nhưng phải đáp ứng lại điều kiện mới và giới hạn gửi. |

- Pending có hiệu lực **7 × 24 giờ từ lúc gửi**; không được gia hạn bằng sửa hồ sơ/lời nhắn. Người gửi không sửa một yêu cầu đang pending; muốn đổi phải rút và gửi lại theo cooldown.
- Khi đã accepted, request giữ lịch sử “Đã chấp nhận”. Contact có trạng thái riêng: đang chia sẻ, hết quyền, đã thu hồi; không đổi lịch sử thành bị từ chối.
- Khi thời điểm hiện tại đúng bằng hạn hết hiệu lực, yêu cầu/contact đã hết hạn. Không cho accept một pending hết hạn.
- Một cặp chỉ có một pending hoặc một kết nối còn quyền contact; không tạo hai yêu cầu pending ngược chiều.
- Nếu A có pending đến B và B bấm gửi đến A, đưa B tới yêu cầu đã nhận. B phải chủ động chấp nhận và consent; không tự accept vì “cả hai đều quan tâm”.
- Retry/double-click không tạo thêm yêu cầu, không gia hạn thời gian và không tiêu thụ thêm hạn mức. Khi kết quả gửi/accept chưa rõ, ưu tiên kiểm tra trạng thái.

### 9.3 Cooldown và giới hạn

| Tình huống | Quy tắc gửi lại |
| --- | --- |
| Bị từ chối | Người gửi cũ không gửi lại cùng người nhận trong **30 × 24 giờ từ lúc từ chối**. |
| Tự rút pending | Người gửi cũ đợi **24 giờ từ lúc rút**. |
| Pending hết hạn | Người gửi cũ đợi **7 × 24 giờ từ lúc hết hạn**. |
| Pending bị hủy do điều kiện thay đổi | Có thể gửi mới khi điều kiện hợp lệ; không có cooldown bổ sung. |
| Contact còn hiệu lực | Không gửi yêu cầu trùng giữa hai người. |
| Contact hết hạn tự nhiên | Có thể gửi yêu cầu mới và xin consent mới ngay khi hết hạn, trong hạn mức gửi chung. |
| Một bên chủ động thu hồi contact | Bên còn lại không gửi lại cho người thu hồi trong **30 × 24 giờ từ lúc thu hồi**. |
| Block ở bất kỳ chiều nào | Không gửi, nhận, accept hoặc xem contact; bỏ block không tái mở consent cũ. |

- Cooldown áp dụng theo hướng được mô tả. Người đã từ chối/thu hồi có thể chủ động gửi yêu cầu mới sớm hơn nếu không có block; người nhận vẫn phải consent mới.
- Mỗi người gửi tối đa **10 yêu cầu mới trong bất kỳ 24 giờ liên tục**, đồng thời tối đa **20 pending đã gửi**.
- Đếm mọi yêu cầu mới gửi thành công, kể cả yêu cầu sau đó bị rút/từ chối/hủy; không hoàn hạn mức để tránh lách bằng rút rồi gửi.
- Không đổi cooldown bằng sửa/xóa/đăng lại hồ sơ. Mốc thời gian gắn với hai tài khoản.
- UI ghi rõ lý do chưa gửi được, thời điểm có thể gửi lại, số pending hiện có. Không gợi ý đổi tài khoản để vượt giới hạn.
- Yêu cầu được phản hồi trước hạn vẫn phải qua kiểm tra điều kiện hiện tại; xem được yêu cầu cũ không có nghĩa là được accept.

## 10. Contact consent và quyền chia sẻ

### 10.1 Nội dung và thời điểm consent

MVP hỗ trợ một kênh mỗi người cho mỗi yêu cầu: số điện thoại hoặc kênh Zalo do người dùng tự cung cấp. Không gắn nhãn kênh đã xác minh nếu chưa có quy trình xác minh thực tế.

- Consent gửi: “Tôi đồng ý chia sẻ [kênh đã chọn] với [người nhận] trong 7 ngày nếu người đó chấp nhận. Bản giới thiệu và lời nhắn sẽ được gửi ngay.”
- Consent nhận: “Tôi đồng ý chia sẻ [kênh đã chọn] với [người gửi] trong 7 ngày và mở kênh liên hệ người đó đã cho phép.”
- Màn review cho mỗi bên thấy rõ giá trị kênh của chính mình, người được nhận, thời hạn và nút thu hồi.
- Consent không chọn sẵn, không dùng điều khoản tài khoản chung thay consent cho từng cặp, không suy ra từ lưu quan tâm hoặc gửi chéo.
- Trước accept, người nhận chỉ thấy bản giới thiệu được cho phép và lời nhắn; contact của người gửi vẫn ẩn.
- Chỉ mở contact sau khi người nhận đã chấp nhận hợp lệ và cả hai consent còn hiệu lực. Việc mở hai chiều phải là một kết quả hoàn chỉnh; không để một bên đọc contact khi consent bên kia chưa hoàn tất.
- Liên hệ không được đưa vào public profile, danh sách tìm, score/reasons, prompt/LLM, log hoặc lịch sử hội thoại Agent. MVP không cho gửi contact trực tiếp trong lời nhắn công khai/bản giới thiệu để bỏ qua consent.

### 10.2 Thời hạn, thu hồi và thay đổi contact

- Chia sẻ có hiệu lực **7 × 24 giờ từ lúc accepted**; không gia hạn khi xem lại, refresh hoặc đăng nhập lại.
- Sau hạn, giao diện chỉ hiện “Quyền xem liên hệ đã hết hạn”; muốn mở lại cần yêu cầu và consent mới.
- Mỗi bên có thể bấm **Ngừng chia sẻ liên hệ** bất kỳ lúc nào. Một bên thu hồi sẽ đóng quyền đọc contact của cả hai trong kết nối đó, giữ trạng thái lịch sử và áp dụng cooldown.
- Thu hồi trong một kết nối không tự thu hồi các kết nối khác. Block/xóa hồ sơ/hạn chế service có phạm vi theo mục 8–11.
- Thay đổi hoặc xóa một kênh liên hệ hủy pending và thu hồi quyền của các kết nối dùng kênh đó. Kênh mới không được tự chia sẻ bằng consent cũ. Nếu đổi kênh sau accepted, cùng áp dụng cooldown như thu hồi.
- Các kết nối dùng kênh không đổi giữ nguyên hiệu lực. Không tự thu hồi quyền chỉ do sửa tên hiển thị hoặc ảnh.
- Bỏ block, phục hồi tài khoản/hồ sơ hoặc đăng lại không khôi phục quyền đã thu hồi/hết hạn.
- Các trang/link đã mở phải mất khả năng xem lại khi quyền hết hiệu lực; contact không được lấy từ lịch sử chat hoặc bản lưu hồ sơ để né kiểm tra quyền.
- Đăng xuất hoặc phiên hết hiệu lực phải ẩn contact đang hiển thị. Mọi lần mở lại cần phiên đăng nhập và quyền còn hiệu lực.
- Trước consent có thông báo ngắn: thu hồi ngăn xem lại trong ReloHome, không xóa được thông tin đối phương đã sao chép hoặc dùng bên ngoài.

## 11. Quan tâm, inbox, block/report và trạng thái UX

- Quan tâm là danh sách riêng tư. Chủ hồ sơ không nhận thông báo và không được xem danh sách người quan tâm.
- Hồ sơ đã lưu ngừng hoạt động có nhãn trạng thái; không thể gửi yêu cầu mới. Hồ sơ đã xóa/bị ẩn chỉ còn thông báo không khả dụng, không giữ bản snapshot công khai để xem lại dữ liệu đã rút.
- Inbox có “Đã gửi / Đã nhận”, trạng thái request và thời hạn; contact chỉ nằm trong chi tiết kết nối có quyền. MVP thông báo trong app/badge, không bắt buộc chat hoặc cập nhật realtime.
- Sau khi một bên xóa hồ sơ hoặc bị ẩn/hạn chế service, phía kia chỉ thấy trạng thái không khả dụng và lịch sử thao tác cần thiết; không xem lại bản giới thiệu, ảnh hay contact bằng snapshot của yêu cầu. Block cũng dừng khả năng xem bản giới thiệu riêng của đối phương.
- Block hai chiều loại nhau khỏi tìm kiếm, ngăn yêu cầu, hủy pending và thu hồi mọi contact giữa cặp đó. Người bị block thấy thông báo không khả dụng phù hợp, không lộ người block hoặc lý do.
- Report độc lập với block. Gửi báo cáo không tự xác định người kia vi phạm hoặc tự gắn nhãn; người báo cáo có thể chọn block thêm.
- Cần có chức năng tiếp nhận, xem xét và ẩn/hạn chế hồ sơ vi phạm cho người được phân quyền trước khi mở dữ liệu thật. Không công khai chi tiết báo cáo.
- Loading không xóa lựa chọn đã nhập. Error giữ form và có thao tác thử lại phù hợp. Kết quả trống giải thích filter; không dựng hồ sơ giả.
- Request gửi/accept chưa rõ kết quả hiển thị “Đang kiểm tra trạng thái”; không đổi thành CTA tạo lại ngay.
- Khi profile/request/contact đổi trạng thái trong lúc người dùng đang mở trang, từ chối thao tác không hợp lệ và cập nhật trạng thái, không báo thành công giả.
- Card/chi tiết phân biệt thông tin tự khai, dữ kiện thiếu và các nhận định theo tiêu chí; không dùng “đã xác minh” hoặc “an toàn” khi chưa có căn cứ.
- Giữ hệ thống màu, Việt/Anh, sáng/tối của ReloHome; mobile ưu tiên danh sách, chi tiết và inbox. Bàn phím, focus, nhãn input và trạng thái không chỉ dựa vào màu phải dùng được.

## 12. Bối cảnh tích hợp và giới hạn tài liệu

Codebase đã có React/TypeScript/Vite, FastAPI gateway, tài khoản và LangGraph điều phối theo service. Thiết kế RM-01/RM-02/RM-03 trong tài liệu frontend đã dự tính tiêu chí, hồ sơ và kết nối có sự đồng ý. Backend và workspace roommate thực thi chưa có.

- Tái sử dụng danh tính người dùng và trải nghiệm ứng dụng hiện có; không tự biến tài khoản thành hồ sơ public.
- Roommate cần tiêu chí, kết quả và quyền riêng; không dùng thao tác chọn nhà để “chọn người” hoặc tạo giao dịch.
- Phạm vi dữ liệu contact phải được bảo vệ ngay ở quyền sử dụng, không chỉ che trên UI.
- Các tin housing crawl có chữ “ở ghép” không tự trở thành hồ sơ người, không được suy ra consent hoặc thông tin sinh hoạt.
- Technical design sẽ quyết định cách tổ chức thành phần, lưu trữ, xử lý cạnh tranh, bảo vệ dữ liệu và vận hành để đáp ứng spec. Tài liệu này không quyết định database schema, API, lựa chọn thư viện hoặc thứ tự triển khai.

## 13. Acceptance criteria

Các mục dưới đây là điều kiện phát hành, chưa đánh dấu hoàn thành khi chưa triển khai và kiểm thử.

### Quyền sử dụng và phạm vi

- [ ] AC-01: Khách chỉ xem giới thiệu/minh họa; mở link profile thật không trả thông tin người thật trước đăng nhập và xác nhận điều kiện service.
- [ ] AC-02: Người chưa đủ 18 tuổi/chưa chấp nhận điều kiện không dùng dữ liệu thật hoặc kết nối; các service khác không bị thay đổi.
- [ ] AC-03: Người đủ điều kiện tìm/xem/lưu mà không cần public profile; gửi bản giới thiệu riêng tư không tự đăng tìm.
- [ ] AC-04: Hỗ trợ ba thành phố đã chốt; ngoài phạm vi được thông báo, không tự đổi khu vực.
- [ ] AC-05: Nhận đúng intent roommate, dùng được độc lập với nhà; Housing/Moving/Flight và luồng xác nhận cũ giữ nguyên.

### Tiêu chí và scoring

- [ ] AC-06: Hiển thị ngân sách mỗi người/tháng và cơ sở phí; cơ sở khác nhau cần làm rõ trước khi so sánh.
- [ ] AC-07: Hard filters hai chiều kiểm tra cả dữ kiện người tìm; unknown không trở thành đáp ứng và không tự nới filter.
- [ ] AC-08: Ít dữ liệu, coverage dưới 80%, dưới 4 tiêu chí đủ dữ liệu hoặc dưới 2 sinh hoạt đều không hiện score/nhãn tương thích cao.
- [ ] AC-09: Khi đạt mọi điều kiện, hiện số /100, nhãn đúng ngưỡng, các dữ kiện thiếu và lý do có bằng chứng; không biểu diễn như xác suất.
- [ ] AC-10: Trường thiếu vẫn thuộc mẫu số tiêu chí được yêu cầu; không tạo 100 điểm chỉ từ một trường đã khai.
- [ ] AC-11: Nhóm có score/nhóm thiếu dữ liệu và thứ tự tuân thủ mục 7; sort trước phân trang và kết quả ổn định.
- [ ] AC-12: Scoring và các thao tác structured UI không gọi LLM; số lần gọi LLM không tăng theo số candidate.

### Hồ sơ

- [ ] AC-13: Một tài khoản tối đa một hồ sơ đang tìm; có preview và chủ động đăng/xác nhận lại.
- [ ] AC-14: Đúng mốc 30 ngày hồ sơ hết hạn; sửa mô tả không gia hạn; tiếp tục/xác nhận lại đặt chu kỳ mới.
- [ ] AC-15: Tạm dừng/hết hạn/đã tìm được/hạn chế/xóa áp dụng đúng hệ quả với search, pending và accepted tại mục 8.
- [ ] AC-16: Hồ sơ đã xóa/ẩn không đọc lại được từ link hoặc snapshot đã lưu như dữ liệu còn công khai.

### Request, expiry và giới hạn

- [ ] AC-17: Pending hết hạn đúng 7 ngày; accept tại/sau hạn không mở contact.
- [ ] AC-18: Chỉ người nhận accept/reject và người gửi rút pending; không ai thao tác thay người khác.
- [ ] AC-19: Các cooldown 30 ngày, 24 giờ và 7 ngày áp dụng đúng hướng/mốc; sửa/đăng lại không bỏ cooldown.
- [ ] AC-20: Yêu cầu thứ 11 trong cửa sổ 24 giờ hoặc khi đã có 20 pending bị chặn có giải thích; retry không đếm thêm.
- [ ] AC-21: Double-click/retry/yêu cầu chéo chỉ có một pending/kết nối còn quyền; không tự accept.
- [ ] AC-22: Profile ngừng nhận, hard condition đổi, contact đổi hoặc block giữa lúc xem và accept không tạo kết quả sai.
- [ ] AC-23: Timeout thao tác ghi có kiểm tra trạng thái, không hướng người dùng tạo yêu cầu mới khi kết quả cũ chưa rõ.

### Consent và quản lý sử dụng

- [ ] AC-24: Trước accept không ai thấy contact bên kia; consent không chọn sẵn và cần cả hai bên.
- [ ] AC-25: Người thứ ba, phiên đăng xuất/hết hạn hoặc link cũ không đọc được contact của cặp khác.
- [ ] AC-26: Sau accepted đúng 7 ngày quyền contact hết hạn; xem lại không gia hạn; cần consent mới để mở lại.
- [ ] AC-27: Thu hồi/đổi kênh/xóa/block đóng đúng phạm vi quyền; contact mới không kế thừa consent cũ.
- [ ] AC-28: Contact không có trong search/profile public, lời nhắn để né consent, score, LLM, log hoặc lịch sử Agent.
- [ ] AC-29: Bỏ block/phục hồi/đăng lại không tự mở lại consent; báo cáo không tự kết luận vi phạm.
- [ ] AC-30: Quan tâm riêng tư; inbox và moderation cơ bản đủ sử dụng với hồ sơ thật.
- [ ] AC-31: Desktop/tablet/mobile, Việt/Anh, sáng/tối, keyboard/focus và loading/empty/error hoạt động nhất quán.

## 14. Trạng thái bàn giao

Năm quyết định sản phẩm yêu cầu chốt đã có quy tắc và tiêu chí nghiệm thu, không còn để technical design tự chọn quyền guest, phạm vi MVP, ngưỡng hiển thị score, expiry/cooldown hoặc contact consent.

MVP/post-MVP trong tài liệu xác định phạm vi phát hành của service, không thay đổi định vị ReloHome là sản phẩm. Các trọng số và chính sách là baseline v1.0; thay đổi sau nghiên cứu cần ghi phiên bản mới, không sửa âm thầm.

Implementation plan và checklist đã được lưu tại [tasks/plan.md](../../tasks/plan.md) và [tasks/todo.md](../../tasks/todo.md). Technical design được chốt/review trong các task foundation trước phần triển khai phụ thuộc. Chưa tạo database schema, API chi tiết, code hoặc thực hiện thay đổi runtime ở bước lập tài liệu.
