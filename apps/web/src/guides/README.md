# Cẩm nang ReloHome

`/guides` là thư viện bài viết đọc trực tiếp trong ứng dụng. Danh sách, tìm kiếm, lọc chủ đề và trang bài viết dùng chung cho người dùng đã đăng nhập và khách.

`content.ts` chứa 10 bài do ReloHome biên soạn theo các chủ đề tìm nhà, chi phí, hợp đồng, chuyển nhà, an toàn và thủ tục. Chủ đề được đối chiếu với dữ liệu nghiên cứu nội bộ `data/cẩm nang.jsonl`; nội dung bài, tiêu đề và cấu trúc được viết lại. Không nhập URL, tên nguồn, thời điểm crawl hoặc văn bản gốc vào bundle frontend. Dữ liệu gốc giữ nguyên trong `data/` để nhóm biên tập tham khảo.

Các phần có thể thay đổi theo thời gian như giá điện, thời hạn thủ tục và quy định pháp luật chỉ đưa ra bước kiểm tra thực tế, không chốt mức giá hoặc mốc pháp lý trong bài. Khi cập nhật nội dung, hãy xác minh các chi tiết này với nguồn chính thức đang có hiệu lực.

Mở bài qua `/guides?article=<id>` để có thể chia sẻ đường dẫn và dùng nút Back của trình duyệt. Không thay backend/API hoặc các service khác.
