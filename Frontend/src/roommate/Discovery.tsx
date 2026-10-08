import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search, UsersRound, Heart } from "lucide-react";
import { ContentSkeleton, EmptyState } from "../components/UiStates";
import { roommate } from "./client";
import { FactsForm } from "./FactsForm";
import { PreferencesForm } from "./PreferencesForm";
import { SelectField } from "./Fields";
import { ProfileSummary, CompatibilityReasons } from "./ProfileSummary";
import { ErrorNotice } from "./ErrorNotice";
import { cityName, rt } from "./text";
import { useResource } from "./useResource";
import { emptyCriteria, type City, type Criteria, type Page } from "./types";
export function Discovery({
  initial,
  initialOffset = 0,
}: {
  initial?: Criteria;
  initialOffset?: number;
}) {
  const stored = useResource<Criteria>(initial ? null : "/me/criteria");
  const [criteria, setCriteria] = useState(initial || emptyCriteria()),
    [searched, setSearched] = useState<Criteria | null>(null),
    [result, setResult] = useState<Page | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const request = useRef<AbortController | null>(null),
    edited = useRef(false);
  useEffect(() => {
    if (stored.value && !edited.current) setCriteria(stored.value);
  }, [stored.value]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (initial) void search(initial, initialOffset);
  }, [initial, initialOffset]);
  function change(next: Criteria) {
    edited.current = true;
    setCriteria(next);
    setResult(null);
    setSearched(null);
    request.current?.abort();
    setBusy(false);
  }
  async function search(next: Criteria, offset = 0) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await roommate<Page>(
        "/search",
        "POST",
        { criteria: next, offset, limit: 12 },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setResult(data);
        setSearched(next);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="rm-discovery">
      <aside
        className="rm-filter-panel"
        aria-label={rt("Tiêu chí tìm người", "Roommate search criteria")}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search(criteria);
          }}
        >
          <h2>
            {rt("Bạn muốn ở cùng ai?", "Who would you like to live with?")}
          </h2>
          <p className="rm-hint">
            {rt(
              "Chỉ cần chọn thành phố để tìm. Hai mục bên dưới là tùy chọn; bạn không cần đăng hồ sơ công khai.",
              "Only a city is needed to search. The sections below are optional; no public profile is required.",
            )}
          </p>
          <SelectField
            label={rt("Thành phố tìm kiếm", "Search city")}
            required
            value={criteria.city}
            choices={["hcm", "hanoi", "danang"].map((c) => [c, cityName(c)])}
            change={(v) =>
              change({
                ...criteria,
                city: v as City,
                self_facts: {
                  ...criteria.self_facts,
                  city: v as City,
                  area_ids: [],
                },
                preferences: { ...criteria.preferences, areas: null },
              })
            }
          />
          <details className="rm-disclosure">
            <summary>{rt("Thông tin của bạn", "About you")}</summary>
            <p className="rm-hint">
              {rt(
                "Dùng để kiểm tra điều kiện hai chiều. Không đăng công khai.",
                "Used for mutual criteria checks. Not published.",
              )}
            </p>
            <FactsForm
              fixedCity={criteria.city}
              value={criteria.self_facts}
              change={(self_facts) => change({ ...criteria, self_facts })}
            />
          </details>
          <details className="rm-disclosure">
            <summary>
              {rt("Ưu tiên với người ở cùng", "Roommate preferences")}
            </summary>
            <PreferencesForm
              city={criteria.city}
              value={criteria.preferences}
              change={(preferences) => change({ ...criteria, preferences })}
            />
          </details>
          <div className="rm-filter-footer">
            <button className="primary full" disabled={busy || stored.loading}>
              <Search size={17} aria-hidden="true" />
              {busy
                ? rt("Đang tìm…", "Searching…")
                : rt("Tìm người phù hợp", "Find people")}
            </button>
          </div>
        </form>
      </aside>
      <section
        className="rm-results"
        aria-label={rt("Kết quả tìm người", "Roommate results")}
      >
        <div className="rm-section-heading">
          <div>
            <h2>
              {rt(
                "Người đang có nhu cầu ở cùng",
                "People looking for a roommate",
              )}
            </h2>
            <p className="rm-hint">
              {result
                ? `${result.total} ${rt("hồ sơ · xếp hạng theo tiêu chí", "profiles · ranked by your criteria")}`
                : rt(
                    "Bạn tự quyết định xem và kết nối.",
                    "You choose who to explore and connect with.",
                  )}
            </p>
          </div>
        </div>
        <ErrorNotice
          error={error || stored.error}
          retry={() => (error ? void search(criteria) : stored.reload())}
        />
        {busy ? (
          <ContentSkeleton label={rt("Đang tìm hồ sơ…", "Finding profiles…")} />
        ) : result?.items.length ? (
          <>
            <ul className="rm-candidate-list">
              {result.items.map((item) => (
                <li className="rm-candidate" key={item.profile.profile_id}>
                  <ProfileSummary profile={item.profile} />
                  <CompatibilityReasons value={item.compatibility} />
                  <Link
                    className="secondary"
                    to={
                      "/roommate/profiles/" +
                      encodeURIComponent(item.profile.profile_id)
                    }
                    state={{ criteria: searched, offset: result.offset }}
                  >
                    {rt("Xem hồ sơ", "View profile")}
                    <UsersRound size={16} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
            <nav
              className="rm-pagination"
              aria-label={rt("Phân trang hồ sơ", "Profile pagination")}
            >
              <button
                className="secondary"
                disabled={result.offset === 0}
                onClick={() =>
                  void search(
                    searched!,
                    Math.max(0, result.offset - result.limit),
                  )
                }
              >
                {rt("Trước", "Previous")}
              </button>
              <span>
                {result.offset + 1}–
                {Math.min(result.total, result.offset + result.limit)} /{" "}
                {result.total}
              </span>
              <button
                className="secondary"
                disabled={result.offset + result.limit >= result.total}
                onClick={() =>
                  void search(searched!, result.offset + result.limit)
                }
              >
                {rt("Sau", "Next")}
              </button>
            </nav>
          </>
        ) : (
          <EmptyState
            icon={<UsersRound />}
            title={
              result
                ? rt(
                    "Chưa tìm thấy hồ sơ phù hợp",
                    "No profiles meet your criteria",
                  )
                : rt("Tìm người, rồi cùng trao đổi", "Find people, then talk")
            }
            text={
              result
                ? rt(
                    "Chưa có hồ sơ công khai còn hiệu lực đáp ứng tiêu chí. Dữ liệu nhà cho thuê không phải hồ sơ người ở ghép; hệ thống không tự tạo người giả. Bạn có thể đổi tiêu chí hoặc vào Hồ sơ của tôi để chủ động đăng nhu cầu.",
                    "No active public profiles meet these criteria. Housing listings are not roommate profiles; we never generate people. Change criteria or publish your own needs from My profile.",
                  )
                : rt(
                    "Chọn tiêu chí và bấm tìm. Bạn không cần đăng hồ sơ công khai để xem kết quả.",
                    "Choose criteria and search. You do not need a public profile to browse.",
                  )
            }
          />
        )}
        {searched && result && <SaveCriteria criteria={searched} />}
      </section>
    </div>
  );
}
function SaveCriteria({ criteria }: { criteria: Criteria }) {
  const [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setSaved(false);
    setError(null);
  }, [criteria]);
  return (
    <div className="rm-save-search">
      <ErrorNotice error={error} />
      <button
        type="button"
        className="text-button"
        disabled={busy || saved}
        onClick={async () => {
          setBusy(true);
          try {
            await roommate("/me/criteria", "PUT", criteria);
            setSaved(true);
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Heart size={16} aria-hidden="true" />
        {saved
          ? rt("Đã lưu tiêu chí", "Criteria saved")
          : rt("Lưu tiêu chí cho lần sau", "Save criteria for next time")}
      </button>
    </div>
  );
}
