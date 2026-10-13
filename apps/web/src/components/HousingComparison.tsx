import type { Data } from "../types";
import { money } from "../api";
import { amenities } from "./Housing";
import { t } from "../uiPreferences";

export function HousingComparison({ data }: { data: Data }) {
  const rows: Data[] = data.comparison?.rows || [];
  if (!rows.length) return null;
  const amount = (v: unknown) =>
    typeof v === "number" ? money(v) : t("Chưa có dữ liệu");
  const columns: [string, (r: Data) => string][] = [
    ["Tiền thuê/tháng", (r) => amount(r.rent_vnd)],
    ["Tiền cọc", (r) => amount(r.deposit_vnd)],
    [
      "Diện tích",
      (r) =>
        typeof r.area_m2 === "number"
          ? `${r.area_m2} m²`
          : t("Chưa có dữ liệu"),
    ],
    ["Thuê tháng đầu + cọc", (r) => amount(r.known_move_in_vnd)],
    [
      "Tiện nghi đã ghi nhận",
      (r) =>
        (r.amenities || []).map((a: string) => amenities[a] || a).join(", ") ||
        t("Chưa có dữ liệu"),
    ],
    ["Địa chỉ", (r) => r.address || t("Chưa có dữ liệu")],
  ];
  return (
    <section
      className="housing-comparison"
      aria-label={t("So sánh các căn nhà")}
    >
      <h3>{t("So sánh các căn nhà")}</h3>
      {!!data.comparison?.price_outside_requested_range_ids?.length && (
        <p role="status">
          {t(
            "Có căn nằm ngoài khoảng giá bạn yêu cầu. Bảng này không thay đổi nhà đã chọn hoặc bộ lọc tìm nhà.",
          )}
        </p>
      )}
      <div className="comparison-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("Tiêu chí")}</th>
              {rows.map((r) => (
                <th key={r.id} scope="col">
                  {r.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{t(label)}</th>
                {rows.map((r) => (
                  <td key={r.id}>{value(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {data.comparison?.scope === "new_search_results_only"
          ? t(
              "So sánh các căn vừa tìm được trong trang kết quả này. Nếu còn trang khác, đây chưa chắc là các căn rẻ nhất toàn khu vực. Thuê tháng đầu + cọc chưa gồm điện, nước và phí dịch vụ.",
            )
          : t(
              "Chỉ so sánh các căn được yêu cầu. Thuê tháng đầu + cọc không phải tổng chi phí: chưa xác minh tiền điện, nước và phí dịch vụ. Thiếu dữ liệu không có nghĩa là miễn phí.",
            )}
      </p>
      {data.agent_assessment?.kind === "model_assessment_not_provider_fact" && (
        <details>
          <summary>{t("Nhận xét và giới hạn so sánh")}</summary>
          <p>{data.agent_assessment.reason}</p>
          {data.agent_assessment.next_step && (
            <p>{data.agent_assessment.next_step}</p>
          )}
          <p className="muted small">
            {t(
              "Đánh giá của AI dựa trên dữ kiện đã đọc, không phải xác nhận từ chủ nhà.",
            )}
          </p>
        </details>
      )}
    </section>
  );
}
