import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  UsersRound,
  Flag,
  ShieldAlert,
  Search,
  RefreshCw,
  SlidersHorizontal,
  ChevronRight,
  X,
} from "lucide-react";
import { ConfirmDialog } from "../../components/Dialog";
import { ContentSkeleton, EmptyState } from "../../components/UiStates";
import { ErrorNotice } from "../../roommate/ErrorNotice";
import { RoommateError } from "../../roommate/client";
import { useResource } from "../../roommate/useResource";
import { useRoommateClient } from "../../roommate/useRoommateClient";
import { useActiveRefresh } from "../../roommate/useActiveRefresh";
import { PrivateAvatar } from "../../roommate/PrivateAvatar";
import { rt, stateName } from "../../roommate/text";
import type { Profile, Report, Queue, Summary } from "./types";
import { cityName, budgetName, needName, timeName } from "./format";
import { Details } from "./Details";
import "./admin.css";

export function ModerationWorkspace({ allowed }: { allowed: boolean }) {
  const roommate = useRoommateClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get("rmQueue") === "profiles" ? "profiles" : "reports";
  const statuses =
    tab === "profiles"
      ? ["active", "paused", "resolved", "expired", "restricted"]
      : ["open", "reviewed"];
  const status = statuses.includes(params.get("rmStatus") || "")
    ? params.get("rmStatus")!
    : params.get("rmStatus") === "all"
      ? ""
      : statuses[0]!;
  const page = Math.max(
    1,
    Math.min(100000, Math.floor(Number(params.get("rmPage")) || 1)),
  );
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [filters, setFilters] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const [opened, setOpened] = useState<{
    target: string;
    report?: Report;
  } | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const alive = useRef(true),
    stop = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current = true;
    };
  }, []);
  const update = (values: Record<string, string>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values))
        value ? next.set(key, value) : next.delete(key);
      if (!("rmPage" in values)) next.set("rmPage", "1");
      return next;
    });
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const args = new URLSearchParams({
    offset: String((page - 1) * 20),
    limit: "20",
  });
  if (status) args.set("status", status);
  if (tab === "profiles") {
    if (query) args.set("q", query);
    for (const [urlKey, apiKey] of [
      ["rmCity", "city"],
      ["rmNeed", "need"],
      ["rmMin", "min_budget"],
      ["rmMax", "max_budget"],
      ["rmSort", "sort"],
    ]) {
      if (params.get(urlKey!)) args.set(apiKey!, params.get(urlKey!)!);
    }
  }
  const path = "/moderation/" + tab + "?" + args;
  const queue = useResource<Queue>(allowed ? path : null);
  const summary = useResource<Summary>(allowed ? "/moderation/summary" : null);
  const reload = () => {
    queue.reload();
    summary.reload();
  };
  useActiveRefresh(reload, allowed && !opened && !busy, 30000);
  useEffect(() => {
    setSelected([]);
    stop.current = true;
  }, [path]);
  useEffect(() => {
    if (queue.value && page > Math.max(1, Math.ceil(queue.value.total / 20)))
      update({
        rmPage: String(Math.max(1, Math.ceil(queue.value.total / 20))),
      });
  }, [queue.value]);
  const reports =
    queue.value?.items.filter((item): item is Report => "id" in item) || [];
  const selectable = reports
    .filter((item) => item.status === "open")
    .map((item) => item.id);
  const selectedAll =
    selectable.length > 0 && selectable.every((id) => selected.includes(id));
  const selectedBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectedBox.current)
      selectedBox.current.indeterminate = selected.length > 0 && !selectedAll;
  }, [selected.length, selectedAll]);
  const selectTab = (next: string, nextStatus: string) => {
    setSearch("");
    setQuery("");
    setNotice("");
    update({ rmQueue: next, rmStatus: nextStatus });
  };
  if (!allowed)
    return (
      <p role="alert">
        {rt(
          "Bạn không có quyền quản lý cộng đồng.",
          "You do not have community moderation access.",
        )}
      </p>
    );
  return (
    <section
      className="ra-workspace"
      data-service="roommate"
      aria-label={rt("Quản lý cộng đồng", "Community moderation")}
    >
      <header className="ra-heading">
        <div>
          <span className="ra-eyebrow">
            {rt("CỘNG ĐỒNG Ở GHÉP", "ROOMMATE COMMUNITY")}
          </span>
          <h2>{rt("Hồ sơ và báo cáo", "Profiles and reports")}</h2>
          <p>
            {rt(
              "Xem thông tin, xử lý báo cáo và quản lý quyền sử dụng.",
              "Review profiles, reports and service access.",
            )}
          </p>
        </div>
        <button className="secondary" disabled={busy} onClick={reload}>
          <RefreshCw size={16} aria-hidden="true" />
          {rt("Làm mới", "Refresh")}
        </button>
      </header>
      <div className="ra-stats">
        {(
          [
            {
              field: "pending_reports",
              label: rt("Báo cáo chờ", "Open reports"),
              Icon: Flag,
              queue: "reports",
              status: "open",
              tone: "warning",
            },
            {
              field: "active_profiles",
              label: rt("Đang tìm", "Active profiles"),
              Icon: UsersRound,
              queue: "profiles",
              status: "active",
              tone: "success",
            },
            {
              field: "restricted_profiles",
              label: rt("Hồ sơ bị hạn chế", "Restricted profiles"),
              Icon: ShieldAlert,
              queue: "profiles",
              status: "restricted",
              tone: "danger",
            },
          ] as const
        ).map((metric) => (
          <button
            key={metric.field}
            className={"ra-stat ra-tone-" + metric.tone}
            disabled={busy || !summary.value}
            onClick={() => selectTab(metric.queue, metric.status)}
          >
            <span>
              <metric.Icon size={18} aria-hidden="true" />
              {metric.label}
            </span>
            <strong>
              {summary.loading && !summary.value
                ? "…"
                : (summary.value?.[metric.field] ?? "—")}
            </strong>
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="ra-content">
        <div
          className="ra-tabs"
          role="group"
          aria-label={rt("Loại nội dung", "Content queue")}
        >
          {(
            [
              ["reports", rt("Báo cáo", "Reports"), Flag],
              ["profiles", rt("Hồ sơ", "Profiles"), UsersRound],
            ] as const
          ).map(([key, title, Icon]) => (
            <button
              key={key}
              aria-pressed={tab === key}
              disabled={busy}
              onClick={() =>
                selectTab(key, key === "reports" ? "open" : "active")
              }
            >
              <Icon size={17} aria-hidden="true" />
              {title}
            </button>
          ))}
        </div>
        <div className="ra-toolbar">
          {tab === "profiles" && (
            <label className="ra-search">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label={rt(
                  "Tìm tên hoặc mã hồ sơ",
                  "Search name or profile ID",
                )}
                value={search}
                maxLength={100}
                placeholder={rt(
                  "Tìm tên, giới thiệu, mã hồ sơ…",
                  "Name, introduction, profile ID…",
                )}
                disabled={busy}
                onChange={(e) => {
                  setSearch(e.target.value);
                  update({ rmPage: "1" });
                }}
              />
            </label>
          )}
          <label>
            {rt("Trạng thái", "Status")}
            <select
              value={status || "all"}
              disabled={busy}
              onChange={(e) => update({ rmStatus: e.target.value })}
            >
              <option value="all">{rt("Tất cả", "All")}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {stateName(s)}
                </option>
              ))}
            </select>
          </label>
          {tab === "profiles" && (
            <>
              <label>
                {rt("Thành phố", "City")}
                <select
                  value={params.get("rmCity") || ""}
                  disabled={busy}
                  onChange={(e) => update({ rmCity: e.target.value })}
                >
                  <option value="">{rt("Tất cả", "All")}</option>
                  {["hcm", "hanoi", "danang"].map((city) => (
                    <option key={city} value={city}>
                      {cityName(city)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary"
                aria-expanded={filters}
                disabled={busy}
                onClick={() => setFilters((v) => !v)}
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
                {rt("Bộ lọc", "Filters")}
              </button>
            </>
          )}
        </div>
        {tab === "profiles" && filters && (
          <div className="ra-filters">
            <label>
              {rt("Nhu cầu", "Housing need")}
              <select
                value={params.get("rmNeed") || ""}
                disabled={busy}
                onChange={(e) => update({ rmNeed: e.target.value })}
              >
                <option value="">{rt("Tất cả", "All")}</option>
                <option value="has_room">{needName("has_room")}</option>
                <option value="looking_together">
                  {needName("looking_together")}
                </option>
              </select>
            </label>
            {[
              ["rmMin", rt("Ngân sách từ", "Budget from")],
              ["rmMax", rt("Ngân sách đến", "Budget to")],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={0}
                  max={1000000000}
                  step={100000}
                  value={params.get(key!) || ""}
                  disabled={busy}
                  onChange={(e) => update({ [key!]: e.target.value })}
                />
              </label>
            ))}
            <label>
              {rt("Sắp xếp", "Sort")}
              <select
                value={params.get("rmSort") || "updated_desc"}
                disabled={busy}
                onChange={(e) => update({ rmSort: e.target.value })}
              >
                <option value="updated_desc">
                  {rt("Cập nhật mới nhất", "Recently updated")}
                </option>
                <option value="updated_asc">
                  {rt("Cập nhật cũ nhất", "Oldest update")}
                </option>
                <option value="budget_asc">
                  {rt("Ngân sách tăng dần", "Budget ascending")}
                </option>
                <option value="budget_desc">
                  {rt("Ngân sách giảm dần", "Budget descending")}
                </option>
              </select>
            </label>
            <small>
              {rt(
                "VND/người/tháng. Lọc các khoảng ngân sách giao nhau.",
                "VND/person/month. Filters overlapping budget ranges.",
              )}
            </small>
          </div>
        )}
        <div className="ra-list-meta">
          {tab === "reports" && (
            <label className="ra-select-all">
              <input
                type="checkbox"
                aria-label={rt(
                  "Chọn báo cáo trong trang",
                  "Select reports on this page",
                )}
                ref={selectedBox}
                checked={selectedAll}
                disabled={busy || !selectable.length}
                onChange={(e) =>
                  setSelected(e.target.checked ? selectable : [])
                }
              />
              {rt("Chọn trong trang", "Select this page")}
            </label>
          )}
          <span role="status">
            {queue.value
              ? `${queue.value.total} ${rt(tab === "profiles" ? "hồ sơ" : "báo cáo", tab === "profiles" ? "profiles" : "reports")}`
              : ""}
          </span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setSearch("");
              setQuery("");
              setParams((current) => {
                const next = new URLSearchParams(current);
                for (const key of Array.from(next.keys()))
                  if (key.startsWith("rm") && key !== "rmQueue")
                    next.delete(key);
                return next;
              });
            }}
          >
            <X size={14} aria-hidden="true" />
            {rt("Xóa bộ lọc", "Clear filters")}
          </button>
        </div>
        <ErrorNotice error={queue.error || summary.error} retry={reload} />
        {notice && (
          <p className="ra-notice" role="status">
            {notice}
          </p>
        )}
        {selected.length > 0 && (
          <div className="ra-batch">
            <strong>
              {rt("Đã chọn ", "Selected ")}
              {selected.length}
            </strong>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setSelected([])}
            >
              {rt("Bỏ chọn", "Clear selection")}
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => setBatchConfirm(true)}
            >
              {rt("Đánh dấu đã xem xét", "Mark reviewed")}
            </button>
          </div>
        )}
        {queue.loading ? (
          <ContentSkeleton
            label={rt("Đang tải danh sách…", "Loading queue…")}
          />
        ) : queue.value?.items.length ? (
          <div className="ra-table-wrap">
            <table className="ra-table">
              <caption className="sr-only">
                {rt(
                  tab === "profiles"
                    ? "Danh sách hồ sơ ở ghép"
                    : "Danh sách báo cáo",
                  tab === "profiles" ? "Roommate profiles" : "Reports",
                )}
              </caption>
              <thead>
                <tr>
                  {tab === "reports" && (
                    <th className="ra-check">
                      <span className="sr-only">{rt("Chọn", "Select")}</span>
                    </th>
                  )}
                  <th>{rt("Hồ sơ", "Profile")}</th>
                  {tab === "profiles" ? (
                    <>
                      <th>{rt("Nhu cầu", "Need")}</th>
                      <th>{rt("Khu vực", "Location")}</th>
                      <th>{rt("Ngân sách", "Budget")}</th>
                    </>
                  ) : (
                    <th>{rt("Nội dung báo cáo", "Report details")}</th>
                  )}
                  <th>{rt("Trạng thái", "Status")}</th>
                  <th>
                    <span className="sr-only">{rt("Thao tác", "Actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {queue.value.items.map((item) =>
                  "profile_id" in item ? (
                    <tr key={item.profile_id}>
                      <td>
                        <div className="ra-person">
                          <PrivateAvatar id={item.avatar_id} />
                          <div>
                            <strong>
                              {item.display_name ||
                                rt("Chưa có tên", "Unnamed profile")}
                            </strong>
                            <small>{item.profile_id.slice(0, 10)}</small>
                            <p>{item.introduction}</p>
                          </div>
                        </div>
                      </td>
                      <td data-label={rt("Nhu cầu", "Need")}>
                        {needName(item.facts?.need?.kind)}
                      </td>
                      <td data-label={rt("Khu vực", "Location")}>
                        {cityName(item.facts?.city)}
                      </td>
                      <td data-label={rt("Ngân sách", "Budget")}>
                        {budgetName(item)}
                      </td>
                      <td>
                        <span className={"ra-badge ra-state-" + item.state}>
                          {stateName(item.state)}
                        </span>
                      </td>
                      <td>
                        <button
                          className="secondary ra-detail-button"
                          onClick={() => setOpened({ target: item.profile_id })}
                        >
                          {rt("Xem chi tiết", "View details")}
                          <ChevronRight size={15} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={item.id}>
                      <td className="ra-check">
                        <input
                          type="checkbox"
                          aria-label={
                            rt("Chọn báo cáo ", "Select report ") + item.id
                          }
                          checked={selected.includes(item.id)}
                          disabled={busy || item.status !== "open"}
                          onChange={(e) =>
                            setSelected((ids) =>
                              e.target.checked
                                ? [...ids, item.id]
                                : ids.filter((id) => id !== item.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <strong>
                          {item.target_name ||
                            rt("Hồ sơ được báo cáo", "Reported profile")}
                        </strong>
                        <small className="ra-id">
                          {item.target.slice(0, 12)}
                        </small>
                        <small>{timeName(item.created)}</small>
                      </td>
                      <td>
                        <p className="ra-report-preview">{item.reason}</p>
                      </td>
                      <td>
                        <span className={"ra-badge ra-state-" + item.status}>
                          {stateName(item.status)}
                        </span>
                      </td>
                      <td>
                        <button
                          className="secondary ra-detail-button"
                          disabled={busy}
                          onClick={() =>
                            setOpened({ target: item.target, report: item })
                          }
                        >
                          {rt("Xem báo cáo", "Review report")}
                          <ChevronRight size={15} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        ) : (
          !queue.error && (
            <EmptyState
              icon={tab === "profiles" ? <UsersRound /> : <Flag />}
              title={rt(
                "Không có nội dung trong mục này",
                "This queue is empty",
              )}
              text={rt(
                "Thử đổi bộ lọc hoặc quay lại sau khi có nội dung mới.",
                "Try another filter or return when new content is available.",
              )}
            />
          )
        )}
        <footer className="ra-pagination">
          <span>{rt("20 mục mỗi trang", "20 items per page")}</span>
          <div>
            <button
              className="secondary"
              disabled={busy || queue.loading || page <= 1}
              onClick={() => update({ rmPage: String(page - 1) })}
            >
              {rt("Trước", "Previous")}
            </button>
            <span>
              {page} / {Math.max(1, Math.ceil((queue.value?.total || 0) / 20))}
            </span>
            <button
              className="secondary"
              disabled={
                busy ||
                queue.loading ||
                !queue.value ||
                page * 20 >= queue.value.total
              }
              onClick={() => update({ rmPage: String(page + 1) })}
            >
              {rt("Sau", "Next")}
            </button>
          </div>
        </footer>
      </div>
      {opened && (
        <Details
          {...opened}
          close={() => setOpened(null)}
          done={() => {
            setOpened(null);
            reload();
            setNotice(rt("Đã lưu kết quả xử lý.", "Moderation action saved."));
          }}
        />
      )}
      {batchConfirm && (
        <ConfirmDialog
          title={rt(
            "Xem xét các báo cáo đã chọn?",
            "Mark selected reports reviewed?",
          )}
          action={rt("Xác nhận xử lý", "Confirm action")}
          onClose={() => !busy && setBatchConfirm(false)}
          onConfirm={async () => {
            stop.current = false;
            setBusy(true);
            let success = 0;
            const failed: string[] = [];
            const unknown: string[] = [];
            const completed = new Set<string>();
            const ids = [...selected];
            for (const id of ids) {
              if (!alive.current || stop.current) break;
              try {
                await roommate(
                  "/moderation/reports/" + encodeURIComponent(id) + "/resolve",
                  "POST",
                );
                success++;
                completed.add(id);
              } catch (e) {
                const uncertain =
                  !(e instanceof RoommateError) ||
                  e.code === "operation_unknown";
                (uncertain ? unknown : failed).push(id);
                if (
                  uncertain ||
                  (e as { status?: number }).status === 401 ||
                  (e as { status?: number }).status === 503
                )
                  stop.current = true;
              }
            }
            if (alive.current) {
              setBusy(false);
              setBatchConfirm(false);
              setSelected(ids.filter((id) => !completed.has(id)));
              setNotice(
                `${success} ${rt("thành công", "succeeded")} · ${failed.length} ${rt("lỗi", "failed")}${unknown.length ? ` · ${unknown.length} ${rt("chưa rõ kết quả", "unknown outcome")}` : ""} · ${ids.length - success - failed.length - unknown.length} ${rt("chưa gửi", "not sent")}`,
              );
              reload();
            }
          }}
        >
          <p>
            {selected.length}{" "}
            {rt(
              "báo cáo sẽ được đánh dấu đã xem xét. Thao tác này không tự hạn chế tài khoản.",
              "reports will be marked reviewed. This does not restrict any account.",
            )}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
