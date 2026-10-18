import { RequiredMark } from "./RequiredMark";
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Flag,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Star,
} from "lucide-react";
import { dateTime } from "../api";
import { ConfirmDialog } from "./Dialog";
import { formatUi, t } from "../uiPreferences";
import {
  reviewsApi,
  type HousingReview,
  type ReviewPage,
  type ReviewQueue,
  type ReviewSummary,
} from "../housingReviews";
import "../housing-reviews.css";
import { useAccountAccess } from "../accountAccess";

function Summary({ data }: { data: ReviewSummary }) {
  return (
    <div className="hr-summary">
      <div className="hr-summary-score">
        {data.rating == null ? (
          <strong>
            {t(
              data.count
                ? "Chưa đủ đánh giá để hiện điểm"
                : "Chủ nhà chưa có đánh giá",
            )}
          </strong>
        ) : (
          <strong>
            <Star size={24} aria-hidden="true" fill="currentColor" />{" "}
            {data.rating.toLocaleString(document.documentElement.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} <span>/ 5</span>
          </strong>
        )}
        <p>
          {formatUi("{0} đánh giá · trên {1} nhà", [
            data.count,
            data.property_count,
          ])}
        </p>
      </div>
      {data.count > 0 && (
        <ol className="hr-histogram" aria-label={t("Phân bố đánh giá 1–5 sao")}>
          {[5, 4, 3, 2, 1].map((stars) => (
            <li key={stars}>
              <span>
                {stars} <Star size={12} aria-hidden="true" />
              </span>
              <meter
                min={0}
                max={Math.max(data.count, 1)}
                value={data.histogram[stars] || 0}
                aria-label={formatUi("{0} sao: {1} đánh giá", [
                  stars,
                  data.histogram[stars] || 0,
                ])}
              />
              <span>{data.histogram[stars] || 0}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Failure({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div className="hr-error" role="alert">
      <p>{text}</p>
      {retry && (
        <button className="text-button" onClick={retry}>
          <RefreshCw size={15} /> {t("Thử lại")}
        </button>
      )}
    </div>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span
      className="hr-stars"
      role="img"
      aria-label={formatUi("{0} trên 5 sao", [rating])}
    >
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          size={16}
          className={value <= rating ? "on" : "off"}
          fill={value <= rating ? "currentColor" : "none"}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function ReviewCard({
  review,
  children,
}: {
  review: HousingReview;
  children?: ReactNode;
}) {
  const anonymous = review.is_anonymous !== false;
  return (
    <article className="hr-review">
      <div className="hr-review-heading">
        <span className="hr-author">
          <strong>
            {anonymous
              ? t("Người thuê ẩn danh")
              : review.author_name || t("Người thuê")}
          </strong>
          <span className={`hr-visibility ${anonymous ? "anonymous" : "public"}`}>
            {t(anonymous ? "Ẩn danh" : "Công khai")}
          </span>
        </span>
        <StarRow rating={review.rating} />
      </div>
      <div className="hr-meta">
        <span>
          {t(review.stage === "viewed" ? "Đã hẹn xem" : "Đã liên hệ")}
        </span>
        <span>{review.property_name}</span>
        <time dateTime={review.created_at}>{dateTime(review.created_at)}</time>
      </div>
      {review.body && <p className="hr-body">{review.body}</p>}
      {review.reply_body && (
        <blockquote>
          <strong>
            <MessageSquareText size={14} aria-hidden="true" />{" "}
            {t("Phản hồi của chủ nhà")}
          </strong>
          <p>{review.reply_body}</p>
        </blockquote>
      )}
      {children}
    </article>
  );
}

function ReportForm({
  reviewId,
  sent,
}: {
  reviewId: string;
  sent: () => void;
}) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await reviewsApi(`housing/reviews/${reviewId}/report`, "POST", {
        reason,
      });
      setOpen(false);
      sent();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="hr-report">
      {!open ? (
        <button className="text-button" onClick={() => setOpen(true)}>
          <Flag size={14} /> {t("Báo cáo đánh giá")}
        </button>
      ) : (
        <form onSubmit={submit}>
          <label>
            <span className="field-label">{t("Lý do báo cáo")}<RequiredMark /></span>
            <textarea
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t(
                "Ví dụ: sai đối tượng, lộ thông tin cá nhân hoặc ngôn ngữ xúc phạm.",
              )}
            />
          </label>
          {error && <Failure text={error} />}
          <div className="hr-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              {t("Hủy")}
            </button>
            <button className="primary" disabled={busy || !reason.trim()}>
              {t(busy ? "Đang gửi…" : "Gửi báo cáo")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function TenantHostReviews({ listingId }: { listingId: string }) {
  const { isGuest, requireAccount } = useAccountAccess();
  if (isGuest)
    return (
      <section className="hr-section">
        <button className="text-button" onClick={requireAccount}>
          {t("Đăng nhập để xem đánh giá chủ nhà")}
        </button>
      </section>
    );
  return <AccountTenantHostReviews key={listingId} listingId={listingId} />;
}

function AccountTenantHostReviews({ listingId }: { listingId: string }) {
  const [page, setPage] = useState<ReviewPage | null>(null),
    [error, setError] = useState(""),
    [sort, setSort] = useState("newest");
  const [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [rating, setRating] = useState(0),
    [body, setBody] = useState(""),
    [anonymous, setAnonymous] = useState(true);
  const [notice, setNotice] = useState(""),
    [withdrawing, setWithdrawing] = useState(false);
  const id = useId();
  const path = `housing/${encodeURIComponent(listingId)}`;
  const load = useCallback(
    async (offset = 0) => {
      setError("");
      try {
        const next = await reviewsApi<ReviewPage>(
          `housing/${encodeURIComponent(listingId)}/reviews?sort=${sort}&limit=10&offset=${offset}`,
        );
        setPage((old) =>
          offset && old
            ? { ...next, items: [...old.items, ...next.items] }
            : next,
        );
      } catch (cause) {
        setError((cause as Error).message);
      }
    },
    [listingId, sort],
  );
  useEffect(() => {
    setPage(null);
    setEditing(false);
    setNotice("");
    void load();
  }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!rating) return;
    setBusy(true);
    setError("");
    try {
      await reviewsApi(`${path}/review`, "PUT", {
        rating,
        body,
        is_anonymous: anonymous,
      });
      setEditing(false);
      setNotice("Đã lưu đánh giá của bạn.");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function withdraw() {
    setWithdrawing(false);
    setBusy(true);
    setError("");
    try {
      await reviewsApi(`${path}/review`, "DELETE", {});
      setEditing(false);
      setNotice("Đã rút đánh giá. Điểm này không còn được tính.");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit() {
    setRating(page?.mine?.rating || 0);
    setBody(page?.mine?.body || "");
    setAnonymous(page?.mine?.is_anonymous !== false);
    setEditing(true);
  }
  return (
    <section className="hr-panel" aria-labelledby={`${id}-title`}>
      <div className="hr-heading">
        <h3 id={`${id}-title`}>{t("Đánh giá chủ nhà")}</h3>
        <Star size={20} aria-hidden="true" />
      </div>
      {error && <Failure text={error} retry={() => void load()} />}
      {!page ? (
        !error && (
          <p role="status">
            <LoaderCircle size={16} className="spin" />{" "}
            {t("Đang tải đánh giá…")}
          </p>
        )
      ) : (
        <>
          <Summary data={page.summary} />
          {page.property_summary && <p className="hr-hint">{formatUi('Nhà đang xem: {0} · {1} đánh giá', [page.property_summary.rating == null ? t('Chưa đủ đánh giá để hiện điểm') : `${page.property_summary.rating.toLocaleString(document.documentElement.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/5`, page.property_summary.count])}</p>}
          <p className="hr-hint">
            {t(
              "Đánh giá từ người đã hẹn xem và báo đã gặp chủ nhà, không chứng minh đã thuê. Người viết tự chọn ẩn danh hoặc hiện tên tài khoản.",
            )}
          </p>
          {notice && (
            <p className="hr-notice" role="status">
              {t(notice)}
            </p>
          )}
          {page.mine && page.mine.status !== "withdrawn" && (
            <div className="hr-mine">
              <strong>{t("Đánh giá của bạn")}</strong>
              <p>{formatUi("{0} trên 5 sao", [page.mine.rating])}</p>
              {page.mine.status === "hidden" && (
                <p className="hr-error">
                  {t("Đánh giá đang bị ẩn; sửa nội dung không tự công bố lại.")}{" "}
                  {page.mine.hidden_reason}
                </p>
              )}
              {!editing && (
                <div className="hr-actions">
                  <button className="secondary" onClick={edit} disabled={busy}>
                    {t("Sửa đánh giá")}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setWithdrawing(true)}
                    disabled={busy}
                  >
                    {t("Rút đánh giá")}
                  </button>
                </div>
              )}
            </div>
          )}
          {page.can_review ? (
            editing ? (
              <form className="hr-editor" onSubmit={save}>
                <fieldset>
                  <legend>{t("Trải nghiệm với chủ nhà")}<RequiredMark /></legend>
                  <div className="hr-rating-picker">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <label
                        key={value}
                        className={rating === value ? "selected" : ""}
                      >
                        <input
                          type="radio"
                          name={`${id}-rating`}
                          value={value}
                          checked={rating === value}
                          onChange={() => setRating(value)}
                          required
                        />
                        <Star
                          size={18}
                          fill={rating >= value ? "currentColor" : "none"}
                          aria-hidden="true"
                        />
                        <span>{formatUi("{0} sao", [value])}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label>
                  {t("Nhận xét (không bắt buộc)")}
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    maxLength={2000}
                    rows={4}
                  />
                </label>
                <fieldset className="hr-visibility-picker">
                  <legend>{t("Hiển thị tên của bạn")}</legend>
                  <label>
                    <input
                      type="radio"
                      name={`${id}-visibility`}
                      checked={anonymous}
                      onChange={() => setAnonymous(true)}
                    />
                    <span>
                      <strong>{t("Ẩn danh")}</strong>
                      <small>{t("Hiện là “Người thuê ẩn danh”.")}</small>
                    </span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`${id}-visibility`}
                      checked={!anonymous}
                      onChange={() => setAnonymous(false)}
                    />
                    <span>
                      <strong>{t("Công khai")}</strong>
                      <small>{t("Hiện tên tài khoản của bạn.")}</small>
                    </span>
                  </label>
                </fieldset>
                <p className="hr-hint">
                  {t(
                    "Chia sẻ trải nghiệm thực tế, không đưa số điện thoại, email hoặc lời xúc phạm.",
                  )}
                </p>
                <div className="hr-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditing(false)}
                    disabled={busy}
                  >
                    {t("Hủy")}
                  </button>
                  <button className="primary" disabled={busy || !rating}>
                    {t(busy ? "Đang lưu…" : "Lưu đánh giá")}
                  </button>
                </div>
              </form>
            ) : (
              (!page.mine || page.mine.status === "withdrawn") && (
                <button className="secondary" onClick={edit}>
                  {t("Viết đánh giá")}
                </button>
              )
            )
          ) : (
            <div className="notice amber review-locked">
              <span className="notice-symbol" aria-hidden="true">!</span>
              <span>{t("Chỉ viết đánh giá sau khi bạn đã hẹn xem lịch và gặp chủ nhà.")}</span>
              <button className="secondary" disabled>{t("Viết đánh giá")}</button>
            </div>
          )}
          {page.items.length > 0 && (
            <label className="hr-sort">
              {t("Sắp xếp đánh giá")}
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">{t("Mới nhất")}</option>
                <option value="highest">{t("Điểm cao nhất")}</option>
                <option value="lowest">{t("Điểm thấp nhất")}</option>
              </select>
            </label>
          )}
          <div className="hr-list">
            {page.items.map((review) => (
              <ReviewCard key={review.id} review={review}>
                {review.id !== page.mine?.id && (
                  <ReportForm
                    reviewId={review.id}
                    sent={() =>
                      setNotice("Đã gửi báo cáo để kiểm duyệt xem xét.")
                    }
                  />
                )}
              </ReviewCard>
            ))}
          </div>
          {page.next_offset != null && (
            <button
              className="secondary"
              onClick={() => void load(page.next_offset!)}
            >
              {t("Xem thêm đánh giá")}
            </button>
          )}
        </>
      )}
      {withdrawing && (
        <ConfirmDialog
          title={t("Rút đánh giá")}
          action={t("Rút đánh giá")}
          onConfirm={withdraw}
          onClose={() => setWithdrawing(false)}
        >
          <p>
            {t(
              "Đánh giá sẽ ngừng hiển thị và không còn được tính vào điểm chủ nhà.",
            )}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function OwnerReview({
  review,
  changed,
  reportSent,
}: {
  review: HousingReview;
  changed: () => void;
  reportSent: () => void;
}) {
  const [open, setOpen] = useState(false),
    [reply, setReply] = useState(review.reply_body || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await reviewsApi(`landlord/reviews/${review.id}/reply`, "POST", {
        body: reply,
      });
      setOpen(false);
      changed();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ReviewCard review={review}>
      {error && <Failure text={error} />}
      {open ? (
        <form className="hr-editor" onSubmit={submit}>
          <label>
            <span className="field-label">{t("Trả lời đánh giá")}<RequiredMark /></span>
            <textarea
              required
              maxLength={2000}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
          </label>
          <div className="hr-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => setOpen(false)}
            >
              {t("Hủy")}
            </button>
            <button className="primary" disabled={busy || !reply.trim()}>
              {t(busy ? "Đang lưu…" : "Lưu phản hồi")}
            </button>
          </div>
        </form>
      ) : (
        <button className="text-button" onClick={() => setOpen(true)}>
          {t(review.reply_body ? "Sửa phản hồi" : "Trả lời đánh giá")}
        </button>
      )}
      <ReportForm reviewId={review.id} sent={reportSent} />
    </ReviewCard>
  );
}

export function LandlordReviews() {
  const [page, setPage] = useState<ReviewPage | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(async (offset = 0) => {
    setError("");
    try {
      const next = await reviewsApi<ReviewPage>(
        `landlord/reviews?limit=20&offset=${offset}`,
      );
      setPage((old) =>
        offset && old
          ? { ...next, items: [...old.items, ...next.items] }
          : next,
      );
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="ll-panel hr-panel">
      <div className="hr-heading">
        <h2>{t("Đánh giá từ người thuê")}</h2>
        <Star size={22} aria-hidden="true" />
      </div>
      <p className="hr-hint">
        {t(
          "Điểm được tổng hợp từ đánh giá đang hiển thị trên các nhà của bạn. Bạn có thể trả lời hoặc báo cáo để kiểm duyệt xem xét.",
        )}{" "}
        {t(
          "Người thuê tự chọn hiện tên tài khoản (công khai) hoặc ẩn danh khi gửi đánh giá.",
        )}
      </p>
      {error && <Failure text={error} retry={() => void load()} />}
      {notice && (
        <p role="status" className="hr-notice">
          {t(notice)}
        </p>
      )}
      {!page ? (
        !error && <p role="status">{t("Đang tải đánh giá…")}</p>
      ) : (
        <>
          <Summary data={page.summary} />
          <div className="hr-list">
            {page.items.map((review) => (
              <OwnerReview
                key={review.id}
                review={review}
                changed={() => void load()}
                reportSent={() =>
                  setNotice("Đã gửi báo cáo để kiểm duyệt xem xét.")
                }
              />
            ))}
          </div>
          {page.next_offset != null && (
            <button
              className="secondary"
              onClick={() => void load(page.next_offset!)}
            >
              {t("Xem thêm đánh giá")}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function ReviewModerationPanel() {
  const [page, setPage] = useState<ReviewQueue | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const load = useCallback(async (offset = 0) => {
    setError("");
    try {
      const next = await reviewsApi<ReviewQueue>(
        `moderation/housing/reviews?limit=20&offset=${offset}`,
      );
      setPage((old) =>
        offset && old
          ? { ...next, items: [...old.items, ...next.items] }
          : next,
      );
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function action(id: string, path: string, payload: unknown) {
    setBusy(id);
    setError("");
    try {
      await reviewsApi(path, "POST", payload);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="ll-panel hr-panel">
      <h2>{t("Đánh giá bị báo cáo")}</h2>
      {error && <Failure text={error} retry={() => void load()} />}
      {!page ? (
        !error && <p role="status">{t("Đang tải đánh giá…")}</p>
      ) : (
        <>
          {!page.items.length && (
            <p className="hr-hint">
              {t("Chưa có báo cáo đánh giá cần xử lý.")}
            </p>
          )}
          <div className="hr-list">
            {page.items.map((review) => (
              <ReviewCard key={review.id} review={review}>
                <ul className="hr-report-reasons">
                  {review.reports?.map((report) => (
                    <li key={report.id}>{report.reason}</li>
                  ))}
                </ul>
                <label>
                  {t("Lý do ẩn đánh giá")}
                  <textarea
                    maxLength={500}
                    value={reasons[review.id] || ""}
                    onChange={(e) =>
                      setReasons((old) => ({
                        ...old,
                        [review.id]: e.target.value,
                      }))
                    }
                  />
                </label>
                <div className="hr-actions">
                  <button
                    className="secondary"
                    disabled={busy === review.id}
                    onClick={() =>
                      void action(
                        review.id,
                        `moderation/housing/reviews/${review.id}/decision`,
                        { decision: "keep" },
                      )
                    }
                  >
                    {t("Giữ nguyên")}
                  </button>
                  <button
                    className="primary"
                    disabled={busy === review.id || !reasons[review.id]?.trim()}
                    onClick={() =>
                      void action(
                        review.id,
                        `moderation/housing/reviews/${review.id}/decision`,
                        { decision: "hide", reason: reasons[review.id] },
                      )
                    }
                  >
                    {t("Ẩn đánh giá")}
                  </button>
                </div>
              </ReviewCard>
            ))}
          </div>
          {page.next_offset != null && (
            <button
              className="secondary"
              onClick={() => void load(page.next_offset!)}
            >
              {t("Xem thêm đánh giá")}
            </button>
          )}
          <h3>{t("Cảnh báo theo chủ nhà")}</h3>
          <p className="hr-hint">
            {t(
              "Tín hiệu theo số sao để rà soát thủ công; không tự ẩn tin hoặc giảm thứ tự tìm kiếm.",
            )}
          </p>
          {!page.flags.length && (
            <p className="hr-hint">{t("Chưa có cảnh báo cần rà soát.")}</p>
          )}
          {page.flags.map((flag) => (
            <article className="hr-flag" key={flag.id}>
              <strong>
                <Flag size={16} aria-hidden="true" /> {flag.host_name}
              </strong>
              <p>
                {formatUi(
                  "{0} đánh giá thấp · {1} người viết · {2} nhà · trong {3} ngày",
                  [
                    flag.evidence.review_count,
                    flag.evidence.author_count,
                    flag.evidence.property_count,
                    flag.evidence.window_days,
                  ],
                )}
              </p>
              {!flag.evidence.qualifies && (
                <p className="hr-hint">
                  {t(
                    "Tín hiệu hiện không còn đủ ngưỡng; giữ lại để rà soát lịch sử.",
                  )}
                </p>
              )}
              <button
                className="secondary"
                disabled={busy === flag.id}
                onClick={() =>
                  void action(
                    flag.id,
                    `moderation/housing/flags/${flag.id}/review`,
                    {},
                  )
                }
              >
                {t("Đã rà soát cảnh báo")}
              </button>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
