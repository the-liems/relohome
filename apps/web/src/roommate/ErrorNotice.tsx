import { AlertCircle } from "lucide-react";
import { RoommateError } from "./client";
import { deadlineLabel, reasonName, rt } from "./text";
import { requestSignIn } from "../authEvents";

export function errorText(error: unknown) {
  const code =
    error instanceof RoommateError ? error.code : "service_unavailable";
  const messages: Record<string, string> = {
    actor_changed: rt(
      "Tài khoản đã thay đổi. Tải lại trang để tiếp tục với đúng tài khoản.",
      "Your account changed. Reload the page to continue with the correct account.",
    ),
    conversation_unavailable: rt(
      "Cuộc trò chuyện không còn khả dụng hoặc bạn không có quyền xem.",
      "This conversation is unavailable or you do not have access.",
    ),
    conversation_closed: rt(
      "Kết nối đã dừng. Không thể gửi thêm tin nhắn.",
      "This connection is closed. You cannot send more messages.",
    ),
    invalid_message: rt(
      "Nhập tin nhắn từ 1 đến 2.000 ký tự.",
      "Enter a message between 1 and 2,000 characters.",
    ),
    invalid_cursor: rt(
      "Không tải được phần tin nhắn này. Hãy tải lại hội thoại.",
      "This message page is unavailable. Refresh the conversation.",
    ),
    room_city_mismatch: rt(
      "Tin phòng thuộc thành phố khác. Hãy chọn lại tin hoặc đổi thành phố của hồ sơ.",
      "This listing belongs to a different city. Choose another listing or update your profile city.",
    ),
    rate_limit: rt(
      "Bạn thao tác nhiều lần trong thời gian ngắn. Chờ một chút rồi thử lại.",
      "Too many actions in a short time. Wait a moment and try again.",
    ),
    payload_too_large: rt(
      "Thông tin gửi quá dài. Rút gọn nội dung rồi thử lại.",
      "The request is too large. Shorten the content and try again.",
    ),
    invalid_image: rt(
      "Chọn ảnh JPEG hoặc PNG hợp lệ, tối đa 5 MB.",
      "Choose a valid JPEG or PNG image, up to 5 MB.",
    ),
    image_count_limit: rt(
      "Bạn đã có 10 ảnh. Xóa ảnh không dùng trước khi tải thêm.",
      "You already have 10 photos. Remove an unused photo before uploading another.",
    ),
    image_dimension_limit: rt(
      "Ảnh quá lớn hoặc có nhiều khung hình. Chọn ảnh tĩnh tối đa 16 megapixel.",
      "The image is too large or has multiple frames. Choose a still image up to 16 megapixels.",
    ),
    draft_limit: rt(
      "Có nhiều thao tác trước đó chưa được kiểm tra. Mở mục kiểm tra thao tác để đối soát.",
      "Several earlier actions need checking. Open action recovery to reconcile them.",
    ),
    draft_unavailable: rt(
      "Bản xác nhận đã hết hạn. Kiểm tra Inbox hoặc thông tin hiện tại trước khi thao tác lại.",
      "The reviewed draft expired. Check your inbox or current data before taking another action.",
    ),
    service_unavailable: rt(
      "Chưa kết nối được dịch vụ. Hãy thử lại.",
      "The service is unavailable. Please try again.",
    ),
    operation_unknown: rt(
      "Chưa xác định được kết quả. Kiểm tra trạng thái trước khi gửi lại.",
      "The outcome is unknown. Check its status before retrying.",
    ),
    authentication_required: rt(
      "Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.",
      "Your session expired. Sign in to continue.",
    ),
    service_terms_required: rt(
      "Cần xác nhận điều kiện sử dụng Roommate.",
      "Please accept the Roommate service terms.",
    ),
    adult_required: rt(
      "Dịch vụ dành cho người từ 18 tuổi.",
      "This service is for adults aged 18 or over.",
    ),
    service_restricted: rt(
      "Tài khoản hiện bị hạn chế sử dụng dịch vụ.",
      "Your account is currently restricted from this service.",
    ),
    intro_incomplete: rt(
      "Bổ sung tên, giới tính, giới thiệu, khu vực, ngân sách, nhu cầu và ngày vào ở.",
      "Complete your name, gender, introduction, area, budget, housing need and move-in date.",
    ),
    contact_in_public_text: rt(
      "Không ghi số điện thoại hoặc link liên hệ trong tên/giới thiệu.",
      "Do not put contact details or links in your name or introduction.",
    ),
    invalid_input: rt(
      "Kiểm tra các trường vừa nhập, số tiền và khoảng ngày.",
      "Check your entries, budget bounds and date range.",
    ),
    profile_unavailable: rt(
      "Hồ sơ không còn khả dụng. Vui lòng tìm lại.",
      "This profile is no longer available. Search again.",
    ),
    contact_unavailable: rt(
      "Quyền xem liên hệ đã đóng hoặc hết hạn.",
      "Contact access is closed or expired.",
    ),
    consent_required: rt(
      "Cần chủ động đồng ý chia sẻ kênh liên hệ.",
      "Explicit contact sharing consent is required.",
    ),
    contact_changed: rt(
      "Kênh liên hệ đã thay đổi. Tải lại và xác nhận lại.",
      "The contact channel changed. Reload and review it.",
    ),
    contact_version_conflict: rt(
      "Kênh liên hệ đã được cập nhật ở phiên khác. Tải lại.",
      "Your contact was updated elsewhere. Reload it.",
    ),
    version_conflict: rt(
      "Hồ sơ đã thay đổi ở phiên khác. Tải lại trước khi lưu.",
      "The profile changed elsewhere. Reload before saving.",
    ),
    criteria_no_longer_match: rt(
      "Thông tin mới không còn đáp ứng điều kiện bắt buộc của hai bên.",
      "Current information no longer satisfies both parties’ required criteria.",
    ),
    daily_limit: rt(
      "Đã đạt giới hạn 10 yêu cầu mới trong 24 giờ.",
      "You have reached 10 new requests in 24 hours.",
    ),
    pending_limit: rt(
      "Đã có 20 yêu cầu đang chờ. Xử lý chúng trước khi gửi thêm.",
      "You have 20 pending requests. Resolve them before sending more.",
    ),
    cooldown: rt(
      "Chưa thể gửi lại yêu cầu cho người này.",
      "You cannot send this person another request yet.",
    ),
    request_not_pending: rt(
      "Yêu cầu đã được xử lý hoặc hết hạn. Tải lại để xem trạng thái.",
      "This request was processed or expired. Reload its status.",
    ),
    request_unavailable: rt(
      "Yêu cầu không còn khả dụng.",
      "This request is unavailable.",
    ),
  };
  return (
    messages[code] ||
    rt(
      "Không thể hoàn tất thao tác. Tải lại dữ liệu và thử lại.",
      "Unable to complete this action. Reload and try again.",
    )
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="rm-error" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <div>
        <p>{errorText(error)}</p>
        {error instanceof RoommateError && error.retryAt && (
          <p>
            {rt("Có thể thử lại từ ", "Try again after ")}
            {deadlineLabel(error.retryAt)}
          </p>
        )}
        {error instanceof RoommateError && error.reasons.length > 0 && (
          <p>{error.reasons.map(reasonName).join(" · ")}</p>
        )}
        {error instanceof RoommateError && error.status === 401 ? (
          <button type="button" className="text-button" onClick={requestSignIn}>
            {rt("Đăng nhập lại", "Sign in again")}
          </button>
        ) : (
          retry && (
            <button type="button" className="text-button" onClick={retry}>
              {rt("Thử lại", "Retry")}
            </button>
          )
        )}
      </div>
    </div>
  );
}
