import { useEffect, useState } from "react";
import { roommate } from "./client";
import { ProfileSummary, CompatibilityReasons } from "./ProfileSummary";
import { ErrorNotice } from "./ErrorNotice";
import { cityName, rt } from "./text";
import { Link } from "react-router-dom";
import { emptyCriteria, type City, type Page } from "./types";

type DemoPage = Page & {
  source_kind: "demo";
  connections_enabled: false;
  notice: string;
};

export function DemoDiscovery() {
  const [city, setCity] = useState<City>("hanoi");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<DemoPage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError(null);
    setPage(null);
    roommate<DemoPage>(
      "/demo/search",
      "POST",
      {
        criteria: { ...emptyCriteria(), city },
        offset,
        limit: 12,
      },
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setPage(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [city, offset]);
  return (
    <section className="rm-results">
      <h2>
        {rt(
          "Hồ sơ DEMO — không phải người thật",
          "DEMO profiles — not real people",
        )}
      </h2>
      <p className="rm-hint">
        {rt(
          "Dữ liệu thử tách riêng, không thể kết nối hoặc lấy liên hệ. Phòng liên kết chỉ để minh họa bản đồ, không xác nhận người đang ở đó.",
          "Separate sample profiles: no connections or contacts. Linked rooms only illustrate the map, not actual occupancy.",
        )}
      </p>
      <label>
        {rt("Thành phố", "City")}{" "}
        <select
          value={city}
          onChange={(e) => {
            setCity(e.target.value as City);
            setOffset(0);
          }}
        >
          {(["hanoi", "hcm", "danang"] as City[]).map((c) => (
            <option key={c} value={c}>
              {cityName(c)}
            </option>
          ))}
        </select>
      </label>
      <ErrorNotice error={error} />
      {busy ? (
        <p role="status">Đang tải hồ sơ DEMO…</p>
      ) : (
        <>
          <p>
            {page?.total ?? 0} hồ sơ DEMO còn hiệu lực tại {cityName(city)}
          </p>
          <ul className="rm-candidate-list">
            {page?.items.map((item) => (
              <li className="rm-candidate" key={item.profile.profile_id}>
                <ProfileSummary profile={item.profile} />
                <CompatibilityReasons value={item.compatibility} />
                <details>
                  <summary>Xem thông tin sinh hoạt DEMO</summary>
                  <ProfileSummary profile={item.profile} full />
                </details>
                <small>DEMO · Không nhận yêu cầu kết nối</small>
              </li>
            ))}
          </ul>
          {page?.total === 0 && (
            <p className="notice">
              {rt(
                "Chưa có hồ sơ DEMO phù hợp/còn hiệu lực tại thành phố này. Kiểm tra file dữ liệu được cấu hình; không tự sinh người thay thế.",
                "No valid DEMO profiles in this city. Check the configured dataset; profiles are never fabricated as a fallback.",
              )}
            </p>
          )}
          <Link className="text-button" to="/roommate">
            {rt("Về hồ sơ thật", "Back to real profiles")}
          </Link>
          <nav className="rm-pagination" aria-label="Phân trang DEMO">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 12))}
            >
              Trước
            </button>
            <span>
              {page?.total ? offset + 1 : 0}–
              {Math.min(offset + 12, page?.total || 0)} / {page?.total || 0}
            </span>
            <button
              disabled={offset + 12 >= (page?.total || 0)}
              onClick={() => setOffset(offset + 12)}
            >
              Sau
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
