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
  demoAvailable = false,
}: {
  initial?: Criteria;
  initialOffset?: number;
  demoAvailable?: boolean;
}) {
  const stored = useResource<Criteria>(initial ? null : "/me/criteria");
  const [criteria, setCriteria] = useState(initial || emptyCriteria()),
    [searched, setSearched] = useState<Criteria | null>(null),
    [result, setResult] = useState<Page | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const request = useRef<AbortController | null>(null),
    edited = useRef(false),
    initialized = useRef(false);
  useEffect(
    () => () => {
      initialized.current = false;
      request.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (initialized.current || (!initial && stored.loading)) return;
    initialized.current = true;
    const next = initial || (!edited.current && stored.value) || criteria;
    setCriteria(next);
    void search(next, initialOffset);
  }, [initial, initialOffset, stored.loading, stored.value]);
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
  const preferenceCount = Object.values(criteria.preferences).filter(
    Boolean,
  ).length;
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
              "Danh sách tự tải theo thành phố. Không cần điền hết thông tin hoặc đăng hồ sơ để xem.",
              "Profiles load by city. No full form or public profile is needed to browse.",
            )}
          </p>
          <SelectField
            label={rt("Thành phố tìm kiếm", "Search city")}
            required
            value={criteria.city}
            choices={["hcm", "hanoi", "danang"].map((c) => [c, cityName(c)])}
            change={(v) => {
              if (!v) return;
              const next = {
                ...criteria,
                city: v as City,
                self_facts: {
                  ...criteria.self_facts,
                  city: v as City,
                  area_ids: [],
                },
                preferences: { ...criteria.preferences, areas: null },
              };
              change(next);
              void search(next);
            }}
          />
          <div className="rm-quick-search">
            <button className="primary full" disabled={busy || stored.loading}>
              <Search size={17} aria-hidden="true" />
              {busy
                ? rt("Đang tìm…", "Searching…")
                : rt("Tìm người phù hợp", "Find people")}
            </button>
          </div>
          <details className="rm-disclosure">
            <summary>
              {rt("Thông tin của bạn · tùy chọn", "About you · optional")}
            </summary>
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
              {rt("Lọc nâng cao · tùy chọn", "Advanced filters · optional")}
              {preferenceCount > 0 && ` (${preferenceCount})`}
            </summary>
            <PreferencesForm
              city={criteria.city}
              value={criteria.preferences}
              change={(preferences) => change({ ...criteria, preferences })}
            />
          </details>
          {preferenceCount > 0 && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                const next = { ...criteria, preferences: {} };
                change(next);
                void search(next);
              }}
            >
              {rt("Bỏ bộ lọc nâng cao", "Clear advanced filters")}
            </button>
          )}
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
                    "Chưa có hồ sơ thật công khai phù hợp tại đây. Thử thành phố khác, đổi bộ lọc hoặc chủ động đăng nhu cầu.",
                    "No active real profiles match here. Try another city, change filters, or publish your own needs.",
                  )
                : rt(
                    "Chọn tiêu chí và bấm tìm. Bạn không cần đăng hồ sơ công khai để xem kết quả.",
                    "Choose criteria and search. You do not need a public profile to browse.",
                  )
            }
          />
        )}
        {result?.total === 0 && (
          <div className="rm-empty-actions">
            {demoAvailable && (
              <Link className="secondary" to="/roommate?tab=demo">
                {rt(
                  "Xem hồ sơ DEMO (không kết nối)",
                  "Explore DEMO profiles (no connections)",
                )}
              </Link>
            )}
            <Link className="text-button" to="/roommate?tab=profile">
              {rt("Đăng nhu cầu của tôi", "Publish my needs")}
            </Link>
          </div>
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
