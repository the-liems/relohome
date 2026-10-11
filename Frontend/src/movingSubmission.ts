import type { Data, Thread } from "./types";

// HTTP success means the graph ran, not that the provider supplied a quote.
// Read only the reply to this submission; an old quote must never mask a refusal.
export function movingQuoteFeedback(thread: Thread): string | undefined {
  const reply = [...(thread.messages || [])]
    .reverse()
    .find((message) => message.role === "assistant");
  const response = reply?.content.response;
  const earlierIds = new Set(
    (thread.messages || [])
      .filter((message) => message.role === "assistant" && message !== reply)
      .flatMap((message) =>
        (message.content.ui?.components || []).map((component) => component.id),
      ),
  );
  const quoted =
    // A valid quote may accompany a plan-level clarification (e.g. total budget).
    // Showing it is read-only, not approval to book/pay or dismissal of the warning.
    ["ANSWER", "PARTIAL", "CLARIFY"].includes(response?.kind || "") &&
    (reply?.content.ui?.components || []).some(
      (component) =>
        component.type === "relocation" &&
        component.data?.quotes?.length &&
        !component.data?.order &&
        !earlierIds.has(component.id),
    );
  if (quoted) return;
  const questions = (response?.questions || [])
    .map((question: Data) => question.text)
    .filter(
      (text: unknown): text is string =>
        typeof text === "string" && !!text.trim(),
    );
  if (questions.length) return [...new Set(questions)].join("\n");
  if (typeof response?.text === "string" && response.text.trim())
    return response.text;
  return "Chưa nhận được báo giá. Kiểm tra thông tin chuyến và trạng thái dịch vụ trước khi thử lại.";
}

export class MovingQuoteFeedbackError extends Error {}

// Point B of a quote. Before the user has decided on a home (moving runs alongside
// the viewings), B needs a picked suggestion or a map pin, exactly like point A.
// Once a home is decided, that home is point B unless the user pins another point.
export function movingDestinationPoint<Point>(
  pinned: Point | null | undefined,
  home: { decided: boolean; point: Point | null; loading?: boolean },
): { point?: Point; issue?: string } {
  if (pinned) return { point: pinned };
  if (!home.decided) return {};
  if (home.point) return { point: home.point };
  if (home.loading)
    return {
      issue: "Đang lấy vị trí căn đã chốt. Chờ một chút rồi lấy báo giá.",
    };
  return {
    issue:
      "Chưa có vị trí căn đã chốt. Hãy ghim cổng nhà trên bản đồ làm điểm B.",
  };
}

// Moving is scheduled in Vietnam, irrespective of the device/browser time zone.
// Keep the same >=30-minute safety window as the authoritative server validation.
export function movingScheduleIssue(
  date: string,
  time: string,
  now = Date.now(),
): string | undefined {
  if (!date || !time) return "Hãy chọn ngày chuyển và giờ xe đến.";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    return "Ngày giờ chuyển chưa hợp lệ.";
  const scheduled = Date.parse(`${date}T${time}:00+07:00`);
  if (!Number.isFinite(scheduled)) return "Ngày giờ chuyển chưa hợp lệ.";
  if (
    new Date(scheduled + 7 * 60 * 60 * 1000).toISOString().slice(0, 16) !==
    `${date}T${time}`
  )
    return "Ngày giờ chuyển chưa hợp lệ.";
  if (scheduled < now + 30 * 60 * 1000)
    return "Ngày giờ chuyển phải cách hiện tại ít nhất 30 phút (giờ Việt Nam).";
}
