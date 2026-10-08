/** Original ReloHome reading guides, edited from themes found in the local research corpus. */
export type GuideSection = {
  heading: string;
  text: string;
  checklist?: string[];
};

export type GuideArticle = {
  id: string;
  category: string;
  title: string;
  summary: string;
  minutes: number;
  lead: string;
  sections: GuideSection[];
  remember: string;
};

export const guides: GuideArticle[] = [
  {
    id: "xem-phong",
    category: "Tìm nhà",
    title: "Đi xem phòng: kiểm tra gì ngoài ảnh đăng?",
    summary: "Một buổi xem nhà hiệu quả nên trả lời được câu hỏi về không gian, an toàn và tổng chi phí.",
    minutes: 4,
    lead: "Ảnh đẹp giúp bạn chọn nơi để đến xem, nhưng quyết định thuê nên dựa vào những gì bạn tự kiểm tra tại chỗ. Hãy hẹn xem phòng vào lúc đủ sáng và dành thêm vài phút quan sát khu vực xung quanh.",
    sections: [
      { heading: "Kiểm tra đúng căn sẽ thuê", text: "Xác nhận số phòng, tầng, diện tích sử dụng và đồ đạc đi kèm. Thử mở cửa sổ, vòi nước, công tắc, ổ cắm và điều hòa nếu có. Quan sát dấu thấm, mùi ẩm và độ ồn khi đóng cửa.", checklist: ["Chụp lại hiện trạng các góc phòng và thiết bị", "Hỏi rõ đồ nào được giữ lại khi nhận phòng", "Xem tín hiệu điện thoại và đường vào nhà"] },
      { heading: "Hỏi về sinh hoạt hằng ngày", text: "Hỏi giờ ra vào, chỗ để xe, khách đến chơi, nấu ăn, thú cưng và cách xử lý hỏng hóc. Nếu ở ghép, hỏi số người đang ở và cách chia chi phí sinh hoạt trước khi quyết định." },
      { heading: "Chốt số tiền trước khi đặt cọc", text: "Đề nghị ghi riêng tiền thuê, điện, nước, internet, gửi xe, phí dịch vụ và khoản trả một lần. Hỏi thời điểm tăng giá, kỳ thanh toán và điều kiện hoàn cọc. Đừng chỉ nhìn mức giá nổi bật trên tin đăng." },
    ],
    remember: "Đừng chuyển tiền chỉ dựa vào ảnh hoặc lời hứa; hãy xác nhận căn thực tế và điều kiện thuê bằng văn bản.",
  },
  {
    id: "ngan-sach-thue",
    category: "Chi phí",
    title: "Tính ngân sách thuê nhà theo cả tháng",
    summary: "Gộp tiền thuê, hóa đơn, đi lại và khoản dự phòng để biết căn nào thực sự vừa túi tiền.",
    minutes: 3,
    lead: "Một căn có giá thuê thấp vẫn có thể tốn kém nếu điện nước, phí quản lý hoặc quãng đường đi làm cao. Lập bảng chi phí theo tháng giúp bạn so sánh các lựa chọn trên cùng một mặt bằng.",
    sections: [
      { heading: "Tách khoản cố định và biến động", text: "Khoản cố định thường gồm tiền thuê, internet, phí quản lý và gửi xe. Điện, nước, ăn uống và đi lại thay đổi theo cách sinh hoạt. Xin mức thu và cách tính của từng khoản trước khi ước lượng." },
      { heading: "Tính cả tiền cần có lúc bắt đầu", text: "Tiền cọc, tiền thuê kỳ đầu, vận chuyển và đồ dùng cơ bản có thể đến cùng một lúc. Đây là dòng tiền ban đầu, không nên chia nhỏ rồi bỏ quên khi so sánh phòng.", checklist: ["Chi phí hằng tháng", "Chi phí chuyển vào một lần", "Khoản dự phòng cho sửa chữa hoặc phát sinh"] },
      { heading: "So sánh theo nhu cầu thật", text: "Nếu ở xa nơi học hoặc làm việc, cộng thêm thời gian và tiền đi lại. Với nhà ở ghép, xác nhận mỗi người chịu bao nhiêu và phương án khi một người chuyển đi." },
    ],
    remember: "Chọn mức chi bạn duy trì được nhiều tháng, thay vì chỉ đủ trả tháng đầu.",
  },
  {
    id: "dien-nuoc",
    category: "Chi phí",
    title: "Đọc hóa đơn điện nước trước khi thanh toán",
    summary: "Biết chỉ số đầu kỳ, cuối kỳ và đơn giá để đối chiếu số tiền được yêu cầu trả.",
    minutes: 4,
    lead: "Tiền điện nước dễ gây tranh cãi khi chỉ có một con số tổng. Cách đơn giản nhất là thống nhất cách ghi chỉ số và cách tính ngay từ ngày nhận phòng.",
    sections: [
      { heading: "Ghi lại đồng hồ khi nhận nhà", text: "Chụp rõ mã đồng hồ và chỉ số điện, nước, kèm thời gian chụp. Nếu dùng đồng hồ chung, hỏi cách chia cho từng phòng và các khoản cộng thêm." },
      { heading: "Đối chiếu mỗi kỳ", text: "Kiểm tra số đầu kỳ, cuối kỳ, lượng tiêu thụ, đơn giá và phí phát sinh. Yêu cầu giải thích khi số liệu thay đổi bất thường hoặc không khớp ảnh đồng hồ.", checklist: ["Đúng mã đồng hồ hoặc cách chia", "Đúng kỳ tính và số tiêu thụ", "Có căn cứ cho đơn giá và phụ phí"] },
      { heading: "Kiểm tra quy định hiện hành", text: "Giá và cách áp dụng có thể thay đổi theo thời điểm, loại hợp đồng và đơn vị cung cấp. Khi nghi ngờ mức thu, hãy đối chiếu với thông tin chính thức của đơn vị điện, nước tại địa phương." },
    ],
    remember: "Giữ ảnh chỉ số và chứng từ thanh toán để có thể đối chiếu về sau.",
  },
  {
    id: "hop-dong-thue",
    category: "Hợp đồng",
    title: "Những điều nên đọc kỹ trong hợp đồng thuê",
    summary: "Tập trung vào tiền, thời hạn, quyền sử dụng và cách kết thúc hợp đồng.",
    minutes: 4,
    lead: "Hợp đồng tốt giúp hai bên hiểu giống nhau về căn nhà đang thuê. Trước khi ký, đọc bản đầy đủ và hỏi lại bất kỳ điều khoản nào chưa rõ; đừng dựa vào lời trao đổi miệng để lấp chỗ trống.",
    sections: [
      { heading: "Xác định người và tài sản", text: "Kiểm tra thông tin bên cho thuê, bên thuê, địa chỉ và phần diện tích sử dụng. Đồ đạc đi kèm nên có danh sách hoặc biên bản bàn giao riêng." },
      { heading: "Đọc các mốc tiền và thời gian", text: "Xem giá thuê, kỳ trả, tiền cọc, thời hạn thuê, điều kiện tăng giá, thời gian báo trước và trách nhiệm khi chấm dứt sớm. Mỗi khoản phí cần có cách tính hoặc mức thu rõ ràng.", checklist: ["Tiền thuê và chi phí ngoài tiền thuê", "Điều kiện giữ hoặc hoàn cọc", "Trách nhiệm sửa chữa và bồi thường", "Cách thông báo khi muốn chuyển đi"] },
      { heading: "Giữ bản có thể đối chiếu", text: "Sau khi thống nhất sửa đổi, yêu cầu cập nhật vào bản hợp đồng trước khi ký. Mỗi bên nên giữ một bản hoặc tệp đầy đủ cùng các phụ lục và biên nhận." },
    ],
    remember: "Nếu một điều quan trọng chưa được viết rõ, hãy làm rõ trước khi chuyển tiền.",
  },
  {
    id: "dat-coc",
    category: "Hợp đồng",
    title: "Đặt cọc phòng sao cho dễ đối chiếu về sau",
    summary: "Xác nhận căn phòng, số tiền, điều kiện hoàn trả và chứng từ trước khi chuyển cọc.",
    minutes: 3,
    lead: "Cọc giữ chỗ hoặc cọc thuê đều cần điều kiện rõ ràng. Một đoạn trao đổi ngắn nhưng đủ chi tiết thường hữu ích hơn một lời hứa chung chung.",
    sections: [
      { heading: "Xác nhận người nhận tiền", text: "Đối chiếu người nhận với bên cho thuê hoặc người được ủy quyền. Ghi rõ địa chỉ, số phòng, ngày dự kiến nhận phòng và mục đích khoản tiền." },
      { heading: "Làm rõ các trường hợp hoàn cọc", text: "Hỏi điều gì xảy ra nếu không nhận phòng, căn khác mô tả, chuyển đi sớm hoặc có hư hỏng. Đề nghị ghi cách tính khấu trừ và thời điểm hoàn lại." },
      { heading: "Lưu bằng chứng", text: "Giữ tin nhắn thống nhất điều kiện, biên nhận và xác nhận giao dịch. Sau khi nhận phòng, đối chiếu khoản cọc với hợp đồng chính thức.", checklist: ["Số tiền và người nhận", "Căn phòng cụ thể", "Điều kiện hoàn/khấu trừ", "Chứng từ thanh toán"] },
    ],
    remember: "Chưa xác minh được căn phòng hoặc người nhận tiền thì chưa nên đặt cọc.",
  },
  {
    id: "nhan-phong",
    category: "Chuyển nhà",
    title: "Ngày nhận phòng: ghi hiện trạng một lần cho rõ",
    summary: "Một biên bản ngắn và bộ ảnh đầy đủ giúp việc sửa chữa, trả phòng minh bạch hơn.",
    minutes: 3,
    lead: "Ngày chuyển vào thường bận, nhưng đây là lúc dễ ghi nhận hiện trạng nhất. Hãy dành thời gian đi một vòng cùng bên giao phòng trước khi xếp đồ.",
    sections: [
      { heading: "Kiểm kê và thử thiết bị", text: "Ghi tình trạng tường, sàn, cửa, khóa, thiết bị điện, đồ nội thất và chìa khóa được bàn giao. Đánh dấu lỗi sẵn có; không cần mô tả dài nhưng phải đủ nhận ra về sau." },
      { heading: "Lưu chỉ số và ảnh", text: "Chụp từng khu vực và đồng hồ điện nước. Đặt tên ảnh theo ngày hoặc lưu vào cùng thư mục với hợp đồng để dễ tìm.", checklist: ["Ảnh toàn cảnh và các vết hỏng", "Danh sách thiết bị, chìa khóa", "Chỉ số điện nước ngày đầu", "Việc cần sửa và người phụ trách"] },
      { heading: "Thống nhất việc sửa", text: "Nếu có hạng mục phải sửa sau khi nhận phòng, ghi rõ ai làm và khi nào hoàn thành. Gửi bản tổng hợp cho bên cho thuê để hai bên cùng xác nhận." },
    ],
    remember: "Ảnh và ghi chú có ngày giúp phân biệt hư hỏng cũ với phát sinh trong thời gian thuê.",
  },
  {
    id: "an-toan-phong",
    category: "An toàn",
    title: "Kiểm tra lối thoát và an toàn trước khi ở",
    summary: "Quan sát đường thoát, khóa cửa và thiết bị điện như một phần của buổi xem nhà.",
    minutes: 4,
    lead: "Vị trí đẹp và giá tốt không thay thế được điều kiện an toàn cơ bản. Trước khi quyết định, thử hình dung mình sẽ ra ngoài bằng lối nào nếu hành lang chính không dùng được.",
    sections: [
      { heading: "Tìm đường ra", text: "Xem lối thoát chính, lối thay thế nếu có, cầu thang và cách mở cửa từ bên trong. Hỏi cách xử lý khi mất điện hoặc có khói; tránh nơi lối đi bị khóa hoặc chứa đồ cản trở." },
      { heading: "Quan sát điện và thiết bị", text: "Chú ý ổ cắm lỏng, dây điện hở, thiết bị nóng bất thường và khu vực sạc xe. Hỏi vị trí ngắt điện, dụng cụ báo cháy hoặc chữa cháy và cách được hướng dẫn sử dụng.", checklist: ["Lối thoát dễ mở và không bị chắn", "Ổ cắm, dây điện, bếp ở tình trạng tốt", "Biết vị trí ngắt điện và số liên hệ khẩn cấp"] },
      { heading: "Thống nhất cách báo sự cố", text: "Lưu số của người quản lý và hỏi quy trình báo hỏng hoặc tình huống khẩn cấp. Nếu thấy rủi ro rõ ràng, yêu cầu xử lý trước khi nhận phòng." },
    ],
    remember: "Khi có sự cố thật, ưu tiên rời khỏi nơi nguy hiểm và gọi lực lượng cứu hộ tại địa phương.",
  },
  {
    id: "tin-dang-dang-nghi",
    category: "Tìm nhà",
    title: "Nhận biết tin thuê nhà cần kiểm tra thêm",
    summary: "Một vài dấu hiệu giúp bạn chậm lại đúng lúc trước khi gửi giấy tờ hoặc tiền.",
    minutes: 3,
    lead: "Tin đăng không rõ ràng chưa chắc là lừa đảo, nhưng đủ để bạn xác minh thêm. Hãy so sánh thông tin từ nhiều nguồn và giữ quyền chủ động khi liên hệ.",
    sections: [
      { heading: "Kiểm tra tính nhất quán", text: "So địa chỉ, ảnh, diện tích, giá và số liên hệ giữa tin đăng và căn thực tế. Hỏi lý do nếu cùng ảnh xuất hiện ở nhiều địa chỉ hoặc giá thay đổi khi đến xem." },
      { heading: "Nhận diện áp lực chuyển tiền", text: "Cẩn trọng khi bị yêu cầu cọc ngay để giữ suất, chuyển vào tài khoản không liên quan, hoặc gửi giấy tờ nhạy cảm trước khi xác minh người cho thuê.", checklist: ["Được xem đúng căn và biết người giao dịch", "Có điều kiện thuê, cọc bằng văn bản", "Có chứng từ cho mọi khoản đã trả"] },
      { heading: "Bảo vệ thông tin của mình", text: "Chỉ chia sẻ thông tin cá nhân cần thiết cho bước đang làm. Khi phát hiện chi tiết bất thường, lưu lại nội dung trao đổi và dừng giao dịch để kiểm tra." },
    ],
    remember: "Một căn phòng tốt vẫn có thể chờ bạn xác minh trước khi trả tiền.",
  },
  {
    id: "tam-tru",
    category: "Thủ tục",
    title: "Chuẩn bị đăng ký tạm trú khi chuyển đến",
    summary: "Nắm trước thông tin địa chỉ và giấy tờ để thủ tục chuyển chỗ ở thuận lợi hơn.",
    minutes: 3,
    lead: "Khi chuyển đến nơi ở mới, nên hỏi sớm bên cho thuê về thông tin địa chỉ và giấy tờ liên quan đến chỗ ở. Cách nộp và hồ sơ cụ thể phụ thuộc hướng dẫn hiện hành của cơ quan có thẩm quyền.",
    sections: [
      { heading: "Thu thập thông tin nơi ở", text: "Ghi địa chỉ đầy đủ, người quản lý hoặc chủ nhà, hợp đồng thuê và thông tin liên hệ cần thiết. Đối chiếu địa chỉ trên hợp đồng với địa chỉ thực tế." },
      { heading: "Xem hướng dẫn chính thức", text: "Kiểm tra cổng dịch vụ công hoặc cơ quan công an nơi cư trú để biết cách nộp, giấy tờ và thời hạn áp dụng tại thời điểm bạn chuyển đến. Một số nơi hỗ trợ nộp trực tuyến.", checklist: ["Thông tin cá nhân", "Địa chỉ chỗ ở mới", "Giấy tờ chứng minh chỗ ở theo hướng dẫn hiện hành"] },
      { heading: "Lưu kết quả", text: "Giữ mã hồ sơ hoặc xác nhận tiếp nhận và theo dõi yêu cầu bổ sung nếu có. Nếu ở ghép, mỗi người nên kiểm tra nghĩa vụ và thông tin của riêng mình." },
    ],
    remember: "Dùng hướng dẫn chính thức đang có hiệu lực thay cho mốc thời gian truyền miệng.",
  },
  {
    id: "tra-phong",
    category: "Chuyển nhà",
    title: "Trả phòng gọn gàng, đối chiếu tiền cọc rõ ràng",
    summary: "Thông báo đúng hẹn, kiểm kê cùng nhau và chốt các khoản cuối kỳ.",
    minutes: 3,
    lead: "Trả phòng thuận lợi bắt đầu từ việc xem lại điều khoản báo trước và biên bản ngày nhận phòng. Làm từng bước giúp tránh tranh luận vì thiếu thông tin ở phút cuối.",
    sections: [
      { heading: "Thông báo và hẹn kiểm tra", text: "Báo ngày dự kiến chuyển đi theo hợp đồng, thống nhất thời điểm bàn giao và hỏi cách xử lý phần tiền thuê còn lại. Sắp xếp việc chuyển đồ và vệ sinh trước buổi kiểm tra." },
      { heading: "Đối chiếu hiện trạng", text: "Dùng ảnh và ghi chú ngày nhận phòng để phân biệt hao mòn thông thường với hư hỏng cần xử lý. Ghi chỉ số điện nước cuối cùng và số chìa khóa trả lại.", checklist: ["Ảnh phòng lúc bàn giao", "Chỉ số điện nước cuối kỳ", "Đồ đạc, chìa khóa", "Khoản cần thanh toán hoặc hoàn lại"] },
      { heading: "Chốt bằng văn bản", text: "Yêu cầu bảng đối chiếu tiền cọc, các khoản khấu trừ và thời điểm hoàn. Nếu chưa thống nhất được, ghi lại điểm còn khác nhau cùng chứng từ để tiếp tục làm rõ." },
    ],
    remember: "Một bản xác nhận bàn giao ngắn sẽ giúp cả hai bên kết thúc việc thuê rõ ràng.",
  },
];
