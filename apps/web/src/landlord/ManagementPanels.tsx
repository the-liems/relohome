import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Clock3,
  Eye,
  ImagePlus,
  PenLine,
  RefreshCw,
  Search,
  Trash2,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { dateTime, money } from "../api";
import { t, formatUi } from "../uiPreferences";
import type { Data } from "../types";
import type { ContactRequest, ManagedListing } from "./types";
import { housingManagement } from "./client";
import { ListingPreview } from "./ListingPreview";
import { ActivityCharts } from "./ActivityCharts";
import { daysUntil, viewingReminders } from "./viewingDue";

export const publicationText: Record<string, string> = {
  draft: "Bản nháp",
  pending_review: "Đang chờ duyệt",
  published: "Đã duyệt",
  rejected: "Cần bổ sung",
  hidden: "Đã ẩn",
  deleted: "Đã xóa",
};
const availabilityText: Record<string, string> = {
  vacant: "Còn trống",
  rented: "Đã thuê",
  paused: "Tạm dừng nhận khách",
};
export function ListingGallery({
  listing,
  changed,
}: {
  listing: ManagedListing;
  changed: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function update(order: string[], cover_id?: string) {
    setBusy(true);
    setError("");
    try {
      await housingManagement(
        `landlord/listings/${listing.id}/media`,
        "PATCH",
        { revision: listing.revision, order, cover_id },
      );
      await changed();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await housingManagement(
        `landlord/listings/${listing.id}/media/${id}`,
        "DELETE",
        { revision: listing.revision },
      );
      await changed();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const order = listing.media.map((media) => media.id),
    cover = listing.media.find((media) => media.is_primary)?.id;
  function move(index: number, direction: number) {
    const next = [...order];
    [next[index], next[index + direction]] = [
      next[index + direction]!,
      next[index]!,
    ];
    void update(next, cover);
  }
  return (
    <section className="wide ll-gallery" aria-label={t("Bộ ảnh phòng")}>
      <h3>
        <ImagePlus size={18} />
        {t("Bộ ảnh phòng")}
      </h3>
      {!listing.media.length && (
        <p className="ll-form-hint">
          {t("Chưa có ảnh. Tải ít nhất một ảnh trước khi gửi duyệt.")}
        </p>
      )}
      <div className="ll-gallery-grid">
        {listing.media.map((media, index) => (
          <article key={media.id}>
            <img
              src={media.url}
              alt={media.alt_text || listing.title || t("Ảnh phòng")}
            />
            <span className={`ll-status ${media.moderation_status}`}>
              {t(
                media.moderation_status === "approved"
                  ? "Đã duyệt"
                  : "Chờ duyệt",
              )}
            </span>
            <div className="ll-gallery-actions">
              <button
                type="button"
                disabled={busy || media.is_primary}
                onClick={() => void update(order, media.id)}
              >
                {t(media.is_primary ? "Ảnh bìa" : "Chọn làm ảnh bìa")}
              </button>
              <button
                type="button"
                disabled={busy || index === 0}
                aria-label={t("Chuyển ảnh về trước")}
                onClick={() => move(index, -1)}
              >
                <ArrowLeft size={15} />
              </button>
              <button
                type="button"
                disabled={busy || index === order.length - 1}
                aria-label={t("Chuyển ảnh ra sau")}
                onClick={() => move(index, 1)}
              >
                <ArrowRight size={15} />
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={t("Xóa ảnh")}
                onClick={() => void remove(media.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {error && (
        <p role="alert" className="ll-form-error">
          {error}
        </p>
      )}
    </section>
  );
}

export function ListingsPanel({
  edit,
  initialStatus = "",
}: {
  initialStatus?: string;
  edit: (id: string, property: string) => void;
}) {
  // Opening the tab shows what tenants can rent now; a status chosen elsewhere
  // (an overview tile) is kept as it is. "Tất cả" stays one choice away.
  const [property, setProperty] = useState(""),
    [properties, setProperties] = useState<Data[]>([]),
    [status, setStatus] = useState(initialStatus || "published"),
    [search, setSearch] = useState(""),
    [availability, setAvailability] = useState(initialStatus ? "" : "vacant"),
    [offset, setOffset] = useState(0);
  // Vacancy applies to approved listings only.
  const roomFilter = status === "published" ? availability : "";
  const [page, setPage] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [preview, setPreview] = useState("");
  useEffect(() => {
    void housingManagement<Data>("landlord/properties")
      .then((result) => setProperties(result.items))
      .catch(() => {});
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        search,
        limit: "20",
        offset: String(offset),
      });
      if (property) query.set("property_id", property);
      if (status) query.set("status", status);
      if (roomFilter) query.set("availability", roomFilter);
      setPage(await housingManagement<Data>("landlord/listings?" + query));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status, search, roomFilter, offset, property]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);
  return (
    <section className="ll-panel">
      <div className="ll-section-heading">
        <div>
          <span className="ll-eyebrow">{t("TIN ĐĂNG")}</span>
          <h2>{t("Tất cả tin cho thuê")}</h2>
        </div>
        <button className="secondary" onClick={() => void load()}>
          <RefreshCw size={16} />
          {t("Làm mới")}
        </button>
      </div>
      <div className="ll-filters">
        <label>
          <Search size={16} />
          <input
            aria-label={t("Tìm tin theo tiêu đề hoặc phòng")}
            value={search}
            placeholder={t("Tìm tin theo tiêu đề hoặc phòng")}
            onChange={(e) => {
              setOffset(0);
              setSearch(e.target.value);
            }}
          />
        </label>
        <select
          aria-label={t("Trạng thái tin")}
          value={status}
          onChange={(e) => {
            setOffset(0);
            setStatus(e.target.value);
          }}
        >
          <option value="">{t("Tất cả trạng thái tin")}</option>
          {Object.entries(publicationText)
            .filter(([key]) => key !== "deleted")
            .map(([key, label]) => (
              <option key={key} value={key}>
                {t(label)}
              </option>
            ))}
        </select>
        <select
          aria-label={t("Tình trạng phòng")}
          value={roomFilter}
          disabled={status !== "published"}
          title={
            status !== "published"
              ? t("Tình trạng phòng chỉ áp dụng cho tin đã duyệt.")
              : undefined
          }
          onChange={(e) => {
            setOffset(0);
            setAvailability(e.target.value);
          }}
        >
          <option value="">{t("Tất cả tình trạng phòng")}</option>
          {Object.entries(availabilityText).map(([key, label]) => (
            <option key={key} value={key}>
              {t(label)}
            </option>
          ))}
        </select>
      </div>
      <div className="ll-filters">
        <select
          aria-label={t("Lọc tin theo nhà")}
          value={property}
          onChange={(e) => {
            setProperty(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t("Tất cả nhà")}</option>
          {properties.map((row) => (
            <option value={row.id} key={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p role="alert" className="ll-form-error">
          {error}
        </p>
      ) : loading ? (
        <p role="status">{t("Đang tải tin…")}</p>
      ) : !page?.items.length ? (
        <p className="ll-empty-inline">
          {t('Không có tin nào khớp bộ lọc. Chọn "Tất cả" để xem thêm.')}
        </p>
      ) : (
        <div className="ll-listing-table">
          <p className="ll-result-count" role="status">
            {formatUi("{0} tin", [page.total ?? page.items.length])}
          </p>
          {page.items.map((row: Data) => (
            <article key={row.id}>
              {row.thumbnail_url && (
                <img
                  src={row.thumbnail_url}
                  alt={row.title || t("Ảnh phòng")}
                />
              )}
              <div>
                <h3>{row.title || t("Tin chưa có tiêu đề")}</h3>
                <p>
                  {row.property_name} · {row.unit_code} · {row.area_m2 ?? "—"}{" "}
                  m²
                </p>
                <span className={`ll-status ${row.publication_status}`}>
                  {t(
                    publicationText[row.publication_status] ||
                      row.publication_status,
                  )}
                </span>{" "}
                {row.publication_status === "published" && (
                  <span
                    className={`ll-availability ${row.availability_status}`}
                  >
                    {t(
                      availabilityText[row.availability_status] ||
                        row.availability_status,
                    )}
                  </span>
                )}
                {row.rejection_reason && <p>{row.rejection_reason}</p>}
              </div>
              <strong>{money(row.rent_vnd)}</strong>
              <div className="ll-listing-buttons">
                <button
                  className="secondary"
                  onClick={() => edit(row.id, row.property_id)}
                >
                  {t("Sửa tin")}
                </button>
                <button
                  className="secondary"
                  onClick={() => setPreview(row.id)}
                >
                  <Eye size={15} />
                  {t("Xem trước")}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {page && page.total > 20 && (
        <div className="ll-pagination">
          <button
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            {t("Trang trước")}
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 20, page.total)} / {page.total}
          </span>
          <button
            disabled={offset + 20 >= page.total || loading}
            onClick={() => setOffset(offset + 20)}
          >
            {t("Trang sau")}
          </button>
        </div>
      )}
      {preview && <ListingPreview id={preview} close={() => setPreview("")} />}
    </section>
  );
}

export function StatisticsPanel({
  compact = false,
  go,
}: {
  compact?: boolean;
  go?: (tab: string, filter?: string) => void;
}) {
  const [listing, setListing] = useState(""),
    [listings, setListings] = useState<Data[]>([]),
    [days, setDays] = useState(30),
    [property, setProperty] = useState(""),
    [properties, setProperties] = useState<Data[]>([]),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void housingManagement<Data>("landlord/properties")
      .then((page) => setProperties(page.items))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: "100" });
    if (property) query.set("property_id", property);
    void housingManagement<Data>(
      "landlord/listings?" + query,
      "GET",
      undefined,
      controller.signal,
    )
      .then((page) => setListings(page.items))
      .catch(() => {});
    return () => controller.abort();
  }, [property]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    const query = new URLSearchParams({ days: String(days) });
    if (property) query.set("property_id", property);
    if (listing) query.set("listing_id", listing);
    void housingManagement<Data>(
      "landlord/stats?" + query,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setData)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [days, property, listing]);
  const totals = (data?.daily || []).reduce(
    (result: Data, day: Data) => ({
      detail_views: result.detail_views + day.detail_views,
      saves: result.saves + day.saves,
      contacts: result.contacts + day.contacts,
    }),
    { detail_views: 0, saves: 0, contacts: 0 },
  );
  const cards: [string, string, typeof Eye][] = [
    ["published", "Tin đã duyệt", CircleCheck],
    ["pending_review", "Tin chờ duyệt", Clock3],
    ["rejected", "Tin cần bổ sung", CircleAlert],
    ["draft", "Tin nháp", PenLine],
  ];
  return (
    <section className="ll-panel ll-statistics">
      <div className="ll-section-heading">
        <div>
          <h2>{t(compact ? "Việc cần xử lý" : "Thống kê tin đăng")}</h2>
          <p>{t("Số liệu từ hoạt động đã ghi nhận, theo giờ Việt Nam.")}</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="ll-form-error">
          {error}
        </p>
      )}
      {compact ? (
        // Listing work at a glance; contact requests and viewings have their own tabs.
        <div className="ll-status-metrics ll-status-tiles">
          {cards.map(([key, label, Icon]) => (
            <button
              key={key}
              className={`ll-status-tile ${key}`}
              onClick={() => go?.("listings", key)}
            >
              <span>
                <i aria-hidden="true">
                  <Icon size={20} />
                </i>
                {t(label)}
              </span>
              <strong>{data?.inventory?.[key] ?? "—"}</strong>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="ll-filters">
            <select
              aria-label={t("Khoảng thời gian thống kê")}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={7}>{t("7 ngày gần nhất")}</option>
              <option value={30}>{t("30 ngày gần nhất")}</option>
            </select>
            <select
              aria-label={t("Lọc thống kê theo nhà")}
              value={property}
              onChange={(e) => {
                setProperty(e.target.value);
                setListing("");
              }}
            >
              <option value="">{t("Tất cả nhà")}</option>
              {properties.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              aria-label={t("Lọc thống kê theo tin")}
              value={listing}
              onChange={(e) => setListing(e.target.value)}
            >
              <option value="">{t("Tất cả tin")}</option>
              {listings.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title || item.unit_code}
                </option>
              ))}
            </select>
          </div>
          {data && (
            <>
              <div className="ll-status-metrics">
                {[
                  ["detail_views", "Lượt xem chi tiết"],
                  ["saves", "Lượt lưu đã ghi nhận"],
                  ["contacts", "Yêu cầu liên hệ"],
                ].map(([key, label]) => (
                  <div key={key}>
                    <strong>{totals[key!]}</strong>
                    <span>{t(label!)}</span>
                  </div>
                ))}
              </div>
              <p className="ll-form-hint">
                {t(
                  "Lượt xem tính theo phiên và tin; lượt lưu không phải số khách hiện còn lưu tin.",
                )}
              </p>
              {!data.daily.length ? (
                <p className="ll-empty-inline">
                  {t("Chưa có hoạt động trong khoảng thời gian này.")}
                </p>
              ) : (
                <>
                  <ActivityCharts daily={data.daily} />
                  {/* The table stays available for exact numbers and screen readers. */}
                  <details className="ll-table-scroll ll-daily-table">
                    <summary>
                      {t("Hoạt động theo ngày · xem dạng bảng")}
                    </summary>
                    <table>
                      <caption className="sr-only">
                        {t("Hoạt động theo ngày")}
                      </caption>
                      <thead>
                        <tr>
                          <th>{t("Ngày")}</th>
                          <th>{t("Lượt xem")}</th>
                          <th>{t("Lượt lưu")}</th>
                          <th>{t("Liên hệ")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.daily.map((row: Data) => (
                          <tr key={row.day}>
                            <td>{row.day}</td>
                            <td>{row.detail_views}</td>
                            <td>{row.saves}</td>
                            <td>{row.contacts}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </>
              )}
              {data.measured_since && (
                <small>
                  {formatUi("Bắt đầu ghi nhận từ {0}", [
                    dateTime(data.measured_since),
                  ])}
                </small>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export function ViewingCalendar({
  contacts,
  openInbox,
}: {
  contacts: Data[];
  openInbox: (id: string) => void;
}) {
  const [filter, setFilter] = useState("upcoming");
  const items = contacts
    .filter(
      (row) =>
        row.viewing_slot &&
        row.viewing_status &&
        (["requested", "confirmed"].includes(row.viewing_status) ||
          filter === "all"),
    )
    .filter(
      (row) =>
        filter === "all" || new Date(row.viewing_slot).getTime() >= Date.now(),
    )
    .sort(
      (a, b) =>
        new Date(a.viewing_slot).getTime() - new Date(b.viewing_slot).getTime(),
    );
  const reminders = viewingReminders(contacts as ContactRequest[]);
  const next = reminders[0];
  // Count each day on its own so "today" never includes tomorrow's viewings.
  const today = reminders.filter((row) => daysUntil(row.viewing_slot!) === 0).length;
  const tomorrow = reminders.length - today;
  const statusLabel = (status: string) =>
    status === "confirmed"
      ? "Đã xác nhận"
      : status === "requested"
        ? "Chờ xác nhận"
        : status === "cancelled"
          ? "Đã hủy"
          : "Đã từ chối";
  return (
    <section className="ll-panel">
      <div className="ll-section-heading">
        <div>
          <h2>
            <CalendarClock size={20} />
            {t("Lịch xem nhà")}
          </h2>
          <p>
            {t(
              "Lịch từ yêu cầu của khách, liên kết với đúng phòng và cuộc trò chuyện.",
            )}
          </p>
        </div>
        <select
          aria-label={t("Lọc lịch xem")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="upcoming">{t("Sắp tới")}</option>
          <option value="all">{t("Tất cả lịch xem")}</option>
        </select>
      </div>
      {next && (
        <section
          className="ll-reminder"
          role="status"
          aria-label={t("Nhắc lịch xem nhà")}
        >
          <span className="ll-reminder-icon">
            <Bell size={20} aria-hidden="true" />
            <b aria-hidden="true">{reminders.length}</b>
          </span>
          <div>
            <strong>
              {today && tomorrow
                ? formatUi(
                    "Nhắc lịch: hôm nay bạn có {0} lịch, ngày mai có {1} lịch xem nhà",
                    [today, tomorrow],
                  )
                : formatUi(
                    today
                      ? "Nhắc lịch: hôm nay bạn có {0} lịch xem nhà"
                      : "Nhắc lịch: ngày mai bạn có {0} lịch xem nhà",
                    [today || tomorrow],
                  )}
            </strong>
            <p>
              {dateTime(next.viewing_slot!)} · {next.title} ·{" "}
              {next.property_name}
              {next.unit_code ? ` · ${next.unit_code}` : ""}
            </p>
          </div>
          <button
            className="secondary"
            onClick={() =>
              document
                .getElementById("viewing-" + next.id)
                ?.scrollIntoView({ block: "center", behavior: "smooth" })
            }
          >
            {t("Xem lịch hẹn")}
          </button>
        </section>
      )}
      {!items.length ? (
        <p className="ll-empty-inline">{t("Chưa có lịch xem phù hợp.")}</p>
      ) : (
        <div className="ll-calendar-list">
          {items.map((row) => {
            const days = daysUntil(row.viewing_slot);
            const upcoming =
              ["requested", "confirmed"].includes(row.viewing_status) &&
              new Date(row.viewing_slot).getTime() >= Date.now();
            const soon = upcoming && days <= 1;
            return (
              <article
                key={row.id}
                id={"viewing-" + row.id}
                className={soon ? "soon" : ""}
              >
                <time dateTime={row.viewing_slot}>
                  {dateTime(row.viewing_slot)}
                </time>
                <div>
                  <strong>{row.title}</strong>
                  <p>
                    {row.property_name} · {row.unit_code}
                  </p>
                  <span className="ll-chip-row">
                    <span className={`ll-viewing-chip ${row.viewing_status}`}>
                      {t(statusLabel(row.viewing_status))}
                    </span>
                    {upcoming && (
                      <span className={"ll-countdown" + (soon ? " soon" : "")}>
                        <Clock3 size={14} aria-hidden="true" />
                        {days === 0
                          ? t("Hôm nay")
                          : formatUi("Còn {0} ngày", [days])}
                      </span>
                    )}
                  </span>
                </div>
                <button className="secondary" onClick={() => openInbox(row.id)}>
                  {t("Mở hộp thư")}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
