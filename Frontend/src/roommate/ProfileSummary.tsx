import {
  MapPin,
  CalendarDays,
  Wallet,
  Check,
  Minus,
  HelpCircle,
} from "lucide-react";
import { money } from "../api";
import {
  areaName,
  cityName,
  dateLabel,
  factorName,
  rt,
  valueName,
} from "./text";
import type { Compatibility, PublicProfile, Profile } from "./types";
import { PrivateAvatar } from "./PrivateAvatar";
export function ProfileSummary({
  profile,
  full = false,
}: {
  profile: PublicProfile | Profile;
  full?: boolean;
}) {
  const facts = profile.facts,
    traits = facts.self_traits;
  return (
    <div className="rm-profile-summary">
      <div className="rm-person-heading">
        <PrivateAvatar
          id={"avatar_id" in profile ? profile.avatar_id : undefined}
        />
        <div>
          <h3>
            {profile.display_name ||
              rt("Người đang tìm ở cùng", "Roommate seeker")}
          </h3>
          <p className="rm-hint">
            <MapPin size={14} aria-hidden="true" />
            {cityName(facts.city)}
          </p>
        </div>
      </div>
      <p className={full ? "rm-introduction" : "rm-introduction rm-clamp"}>
        {profile.introduction}
      </p>
      <dl className="rm-facts">
        <div>
          <dt>
            <Wallet size={16} aria-hidden="true" />
            {rt("Ngân sách / người / tháng", "Budget / person / month")}
          </dt>
          <dd>
            {facts.budget
              ? `${money(facts.budget.min_vnd)} – ${money(facts.budget.max_vnd)}`
              : rt("Chưa khai", "Not provided")}
            <small>
              {facts.budget?.fee_basis === "rent_only"
                ? rt("Chỉ tiền thuê", "Rent only")
                : facts.budget?.fee_basis === "including_fees"
                  ? rt("Đã gồm phí", "Including fees")
                  : rt("Chưa rõ cơ sở phí", "Cost basis not provided")}
            </small>
          </dd>
        </div>
        <div>
          <dt>
            <CalendarDays size={16} aria-hidden="true" />
            {rt("Vào ở", "Move-in")}
          </dt>
          <dd>
            {!facts.move_in
              ? rt("Chưa khai", "Not provided")
              : facts.move_in.kind === "flexible"
                ? rt("Linh hoạt", "Flexible")
                : [facts.move_in.start, facts.move_in.end]
                    .filter(Boolean)
                    .map((d) => dateLabel(d!))
                    .join(" – ")}
          </dd>
        </div>
        <div>
          <dt>{rt("Nhu cầu", "Housing situation")}</dt>
          <dd>
            {facts.need?.kind === "has_room"
              ? rt("Đã có phòng", "Has a room")
              : facts.need?.kind === "looking_together"
                ? rt("Cùng tìm chỗ ở", "Find a place together")
                : rt("Chưa khai", "Not provided")}
          </dd>
        </div>
        {full && (
          <div>
            <dt>{rt("Khu vực", "Areas")}</dt>
            <dd>
              {facts.area_ids.map(areaName).join(" · ") ||
                rt("Chưa khai", "Not provided")}
            </dd>
          </div>
        )}
      </dl>
      {full && (
        <>
          <h3>{rt("Sinh hoạt tự khai", "Self-declared lifestyle")}</h3>
          <dl className="rm-facts">
            {(
              [
                ["gender", rt("Giới tính", "Gender"), "gender"],
                ["smoking", rt("Hút thuốc", "Smoking"), "smoking"],
                ["has_pets", rt("Thú cưng", "Pets"), "boolean"],
                ["cleanliness", rt("Dọn dẹp", "Cleaning"), "cleanliness"],
                [
                  "sociability",
                  rt("Không gian chung", "Shared space"),
                  "sociability",
                ],
              ] as const
            ).map(([key, label, kind]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{valueName(kind, traits[key])}</dd>
              </div>
            ))}
            <div>
              <dt>{rt("Giờ yên tĩnh", "Quiet hours")}</dt>
              <dd>
                {traits.quiet_hours
                  ? `${traits.quiet_hours.start.slice(0, 5)} – ${traits.quiet_hours.end.slice(0, 5)}`
                  : rt("Chưa khai", "Not provided")}
              </dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}
export function CompatibilityReasons({ value }: { value: Compatibility }) {
  return (
    <section
      className="rm-compatibility"
      aria-label={rt("Mức độ phù hợp", "Compatibility")}
    >
      <div className="rm-score-heading">
        {value.score != null ? (
          <>
            <strong>
              {value.score}
              <span>/100</span>
            </strong>
            <span>
              {value.label === "high"
                ? rt("Đáp ứng nhiều ưu tiên", "Meets many preferences")
                : value.label === "medium"
                  ? rt("Có điểm phù hợp", "Some preferences align")
                  : rt("Cần trao đổi thêm", "Discuss the differences")}
            </span>
          </>
        ) : (
          <>
            <HelpCircle size={18} aria-hidden="true" />
            <strong>
              {rt(
                "Chưa đủ dữ liệu để chấm điểm",
                "Not enough data for a score",
              )}
            </strong>
          </>
        )}
      </div>
      <p className="rm-hint">
        {rt(
          "Mức đáp ứng tiêu chí bạn chọn, không phải xác suất hòa hợp hay đánh giá con người.",
          "How well your criteria are met, not a probability or a judgment of the person.",
        )}
      </p>
      <ul className="rm-reasons">
        {value.positives.map((key) => (
          <li key={"p" + key}>
            <Check size={15} aria-hidden="true" />
            {factorName(key)} · {rt("phù hợp", "aligned")}
          </li>
        ))}
        {value.differences.map((key) => (
          <li key={"d" + key}>
            <Minus size={15} aria-hidden="true" />
            {factorName(key)} · {rt("có khác biệt", "differs")}
          </li>
        ))}
        {value.missing.map((key) => (
          <li key={"m" + key}>
            <HelpCircle size={15} aria-hidden="true" />
            {factorName(key)} · {rt("chưa đủ thông tin", "missing information")}
          </li>
        ))}
      </ul>
    </section>
  );
}
