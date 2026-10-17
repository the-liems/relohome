import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { LogOut, ShieldCheck, RefreshCw, Search } from "lucide-react";
import { api, dateTime, money } from "../api";
import type { Data, User } from "../types";
import type { ModerationQueue } from "../landlord/types";
import { AppearanceControls, t } from "../uiPreferences";
import { ModerationPanel } from "../landlord/Workspace";
import { ReviewModerationPanel } from "../components/HousingReviews";
import { housingManagement } from "../landlord/client";
import { publicationText } from "../landlord/ManagementPanels";
import { PreviewContent } from "../landlord/ListingPreview";
import { RoommateModeration } from "./RoommateModeration";
import { rt } from "../roommate/text";
import "../landlord/workspace-upgrade.css";

export function AdminWorkspace({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [routeParams, setRouteParams] = useSearchParams();
  const navigation = useRef<HTMLElement>(null);
  const [tab, setTab] = useState(
      routeParams.get("tab") === "roommate" ? "roommate" : "listings",
    ),
    [queue, setQueue] = useState<ModerationQueue | null>(null),
    [page, setPage] = useState<Data | null>(null),
    [detail, setDetail] = useState<Data | null>(null);
  const [status, setStatus] = useState("pending_review"),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        status,
        search,
        limit: "20",
        offset: String(offset),
      });
      const [pending, listings] = await Promise.all([
        housingManagement<ModerationQueue>("moderation/housing/queue"),
        housingManagement<Data>("moderation/housing/listings?" + query),
      ]);
      setQueue(pending);
      setPage(listings);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status, search, offset]);
  useEffect(() => {
    if (tab === "roommate") return;
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load, tab]);
  useEffect(() => {
    if (tab === "roommate") return;
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load, tab]);
  useEffect(() => {
    if (
      navigation.current &&
      navigation.current.scrollWidth > navigation.current.clientWidth
    )
      navigation.current
        .querySelector('[aria-current="page"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);
  useEffect(() => {
    const listing = routeParams.get("listing");
    if (listing) {
      setTab("listings");
      void open(listing);
    } else if (routeParams.has("identity")) {
      setTab("identity");
      void load();
    } else if (routeParams.get("tab") === "roommate") {
      setTab("roommate");
    } else {
      setTab(
        ["listings", "identity", "reviews"].includes(routeParams.get("tab")!)
          ? routeParams.get("tab")!
          : "listings",
      );
    }
  }, [routeParams]);
  useEffect(() => {
    const identity = routeParams.get("identity");
    if (identity && tab === "identity" && queue)
      requestAnimationFrame(() => {
        const element = document.getElementById(
          "moderation-identity-" + identity,
        );
        element?.scrollIntoView({ block: "center" });
        element?.focus({ preventScroll: true });
      });
  }, [routeParams, tab, queue]);
  async function open(id: string) {
    setBusy(true);
    setError("");
    try {
      setDetail(
        await housingManagement<Data>(`moderation/housing/listings/${id}`),
      );
      setReason("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review(decision: "approve" | "reject") {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await housingManagement(
        `moderation/housing/listings/${detail.id}/review`,
        "POST",
        {
          decision,
          revision: detail.revision,
          ...(decision === "reject" ? { reason: reason.trim() } : {}),
        },
      );
      setDetail(null);
      await load();
    } catch (cause) {
      await open(detail.id);
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const own = detail?.created_by === user.id;
  const canApprove =
    detail?.publication_status === "pending_review" &&
    detail?.property_status === "active" &&
    detail?.host_status === "verified" &&
    !Object.keys(detail?.issues || {}).length &&
    !own;
  return (
    <div className="rh-admin-shell">
      <header className="rh-admin-header">
        <Link className="brand" to="/">
          ReloHome
        </Link>
        <span>
          <ShieldCheck size={18} />
          {t("Không gian Admin")}
        </span>
        <div>
          <AppearanceControls />
          <button
            className="secondary"
            onClick={() => void api("/logout", "POST").then(onLogout)}
          >
            <LogOut size={16} />
            {t("Đăng xuất")}
          </button>
        </div>
      </header>
      <main className="ll-workspace" data-service="landlord">
        <div className="ll-heading">
          <div>
            <span className="ll-kicker">{t("KIỂM DUYỆT")}</span>
            <h1>
              {tab === "roommate"
                ? rt("Quản lý ở ghép", "Roommate management")
                : t("Quản lý và duyệt tin")}
            </h1>
            <p>
              {tab === "roommate"
                ? rt(
                    "Quản lý hồ sơ, xử lý báo cáo và quyền sử dụng ở ghép.",
                    "Manage profiles, reports and roommate service access.",
                  )
                : t(
                    "Kiểm tra người đăng, địa điểm và nội dung trước khi công khai.",
                  )}
            </p>
          </div>
          {tab !== "roommate" && (
            <button
              className="secondary"
              onClick={() => {
                setDetail(null);
                void load();
              }}
            >
              <RefreshCw size={16} />
              {t("Làm mới")}
            </button>
          )}
        </div>
        <nav ref={navigation} className="ll-nav" aria-label={t("Quản trị")}>
          {[
            ["listings", "Duyệt tin"],
            ["identity", "Người đăng & địa điểm"],
            ["reviews", "Đánh giá & báo cáo"],
            ["roommate", "Ở ghép"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => {
                setTab(key!);
                setDetail(null);
                setRouteParams({ tab: key! });
              }}
            >
              {key === "roommate" ? rt("Ở ghép", "Roommates") : t(label!)}
            </button>
          ))}
        </nav>
        {error && tab !== "roommate" && (
          <p role="alert" className="ll-error">
            {error}
          </p>
        )}
        {tab === "roommate" ? (
          <RoommateModeration key={user.id} user={user} />
        ) : tab === "identity" ? (
          <ModerationPanel queue={queue} changed={load} viewerId={user.id} />
        ) : tab === "reviews" ? (
          <ReviewModerationPanel />
        ) : detail ? (
          <section className="ll-panel rh-admin-detail">
            <button className="ll-back" onClick={() => setDetail(null)}>
              {t("Quay lại danh sách tin")}
            </button>
            <div className="rh-admin-detail-grid">
              <PreviewContent listing={detail} />
              <aside>
                <h2>{t("Thông tin người đăng")}</h2>
                <p>{detail.host_name || detail.legal_name}</p>
                <p>{detail.phone}</p>
                <p>
                  {t("Trạng thái tin")}:{" "}
                  {t(
                    publicationText[detail.publication_status] ||
                      detail.publication_status,
                  )}
                </p>
                {own && (
                  <p className="ll-form-error">
                    {t("Bạn không thể duyệt tin của chính mình.")}
                  </p>
                )}
                {Object.keys(detail.issues || {}).length > 0 && (
                  <div className="ll-checklist">
                    <h3>{t("Thông tin còn thiếu")}</h3>
                    <ul>
                      {Object.values(detail.issues || {}).map(
                        (issue, index) => (
                          <li key={index}>{t(String(issue))}</li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
                {detail.host_status !== "verified" && (
                  <p>{t("Người đăng chưa được xác minh.")}</p>
                )}
                {detail.property_status !== "active" && (
                  <p>{t("Địa điểm chưa được duyệt.")}</p>
                )}
                {detail.publication_status === "pending_review" && (
                  <>
                    <label>
                      {t("Lý do từ chối")}
                      <textarea
                        value={reason}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                        rows={4}
                      />
                    </label>
                    <div className="rh-admin-review-actions">
                      <button
                        className="primary"
                        disabled={busy || !canApprove}
                        onClick={() => void review("approve")}
                      >
                        {t("Duyệt và hiển thị")}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy || own || !reason.trim()}
                        onClick={() => void review("reject")}
                      >
                        {t("Trả lại để bổ sung")}
                      </button>
                    </div>
                  </>
                )}
                <h3>{t("Lịch sử kiểm duyệt")}</h3>
                {!(detail.review_history || []).length ? (
                  <p>{t("Chưa có quyết định kiểm duyệt được ghi nhận.")}</p>
                ) : (
                  detail.review_history.map((item: Data, index: number) => (
                    <article className="rh-admin-history" key={index}>
                      <strong>
                        {t(
                          item.decision === "approve"
                            ? "Đã duyệt"
                            : "Đã từ chối",
                        )}
                      </strong>
                      <time>{dateTime(item.created_at)}</time>
                      <p>{item.reason}</p>
                    </article>
                  ))
                )}
              </aside>
            </div>
          </section>
        ) : (
          <section className="ll-panel">
            <div className="ll-status-metrics">
              <button type="button" onClick={() => setTab("identity")}>
                <strong>{queue?.hosts.length ?? "—"}</strong>
                <span>{t("Người đăng chờ xác minh")}</span>
              </button>
              <button type="button" onClick={() => setTab("identity")}>
                <strong>{queue?.properties.length ?? "—"}</strong>
                <span>{t("Nhà chờ xác minh")}</span>
              </button>
              <div>
                <strong>{queue?.listings.length ?? "—"}</strong>
                <span>{t("Tin chờ duyệt")}</span>
              </div>
            </div>
            <div className="ll-filters">
              <label>
                <Search size={16} />
                <input
                  aria-label={t("Tìm tin theo tiêu đề hoặc phòng")}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                  placeholder={t("Tìm tin theo tiêu đề hoặc phòng")}
                />
              </label>
              <select
                aria-label={t("Trạng thái tin")}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setOffset(0);
                }}
              >
                {Object.entries(publicationText).map(([key, label]) => (
                  <option key={key} value={key}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </div>
            {loading ? (
              <p role="status">{t("Đang tải tin…")}</p>
            ) : !page?.items.length ? (
              <p className="ll-empty-inline">
                {t("Chưa có tin phù hợp với bộ lọc.")}
              </p>
            ) : (
              <div className="ll-listing-table">
                {page.items.map((row: Data) => (
                  <article key={row.id}>
                    <div>
                      <h3>{row.title || t("Tin chưa có tiêu đề")}</h3>
                      <p>
                        {row.property_name} · {row.unit_code}
                      </p>
                      <span className={`ll-status ${row.publication_status}`}>
                        {t(
                          publicationText[row.publication_status] ||
                            row.publication_status,
                        )}
                      </span>
                      <p>{row.host_name}</p>
                    </div>
                    <strong>{money(row.rent_vnd)}</strong>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void open(row.id)}
                    >
                      {t("Xem chi tiết để duyệt")}
                    </button>
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
                  {offset + 1}–{Math.min(offset + 20, page.total)} /{" "}
                  {page.total}
                </span>
                <button
                  disabled={offset + 20 >= page.total || loading}
                  onClick={() => setOffset(offset + 20)}
                >
                  {t("Trang sau")}
                </button>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
