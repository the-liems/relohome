import { RequiredMark } from "../components/RequiredMark";
import { useState, type FormEvent } from "react";
import {
  BadgeCheck,
  Briefcase,
  Building,
  CircleAlert,
  Clock3,
  Home,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import { formatUi, t } from "../uiPreferences";
import { housingManagement } from "./client";
import type { HostProfile, HostProfilePage, PosterType } from "./types";

// Poster profile for the owner mode (docs/review/host-mode-design.md §3.2).
// Identity fields go to moderators only; tenants see the poster type and display name.
export const posterLabels: Record<PosterType, string> = {
  owner: "Chủ nhà",
  manager: "Người được ủy quyền quản lý",
  broker: "Môi giới",
  business: "Doanh nghiệp",
};
const posterHints: Record<PosterType, string> = {
  owner: "Bạn sở hữu nhà hoặc phòng cho thuê.",
  manager: "Chủ nhà ủy quyền cho bạn quản lý và cho thuê.",
  broker: "Bạn đăng tin hộ chủ nhà với tư cách môi giới.",
  business: "Công ty hoặc hộ kinh doanh cho thuê nhà.",
};
const posterIcons = {
  owner: Home,
  manager: KeyRound,
  broker: Briefcase,
  business: Building,
};

/** True when the poster still has to (re)submit the form before adding homes. */
export function needsProfile(page: HostProfilePage | null) {
  if (!page?.profile) return true;
  return Boolean(
    page.terms_version && page.profile.terms_version !== page.terms_version,
  );
}

export function HostStatusBanner({
  page,
  edit,
}: {
  page: HostProfilePage;
  edit: () => void;
}) {
  const profile = page.profile;
  if (profile?.status === "verified" && !needsProfile(page)) return null;
  const state: {
    Icon: typeof Clock3;
    title: string;
    text: string;
    action: string;
  } = !profile
    ? {
        Icon: CircleAlert,
        title: "Hoàn tất hồ sơ người đăng",
        text: t(
          "Khai hồ sơ một lần khi thêm căn đầu tiên. Các căn sau dùng lại hồ sơ này.",
        ),
        action: "Khai hồ sơ",
      }
    : needsProfile(page)
      ? {
          Icon: CircleAlert,
          title: "Điều khoản người đăng đã cập nhật",
          text: t("Hãy xem và đồng ý phiên bản mới để tiếp tục đăng tin."),
          action: "Xem lại hồ sơ",
        }
      : profile.status === "needs_info"
        ? {
            Icon: CircleAlert,
            title: "Hồ sơ cần bổ sung",
            // Written by the moderator; shown as is.
            text:
              profile.info_request ||
              t("ReloHome cần thêm thông tin để xác minh."),
            action: "Cập nhật hồ sơ",
          }
        : {
            Icon: Clock3,
            title: "Hồ sơ đang chờ xác minh",
            text: t(
              "Hồ sơ đã gửi để Admin xác minh. Bạn vẫn tạo được nhà, phòng và bản nháp; các căn tiếp theo dùng lại hồ sơ này. Tin chỉ công khai sau khi người đăng, địa điểm và nội dung được duyệt.",
            ),
            action: "Sửa hồ sơ",
          };
  const { Icon } = state;
  return (
    <div
      className={`ll-host-banner ${profile?.status || "missing"}`}
      role="status"
    >
      <Icon aria-hidden="true" />
      <div>
        <strong>{t(state.title)}</strong>
        <p>{state.text}</p>
      </div>
      <button className="secondary" onClick={edit}>
        {t(state.action)}
      </button>
    </div>
  );
}

export function HostVerifiedChip({ profile }: { profile: HostProfile | null }) {
  if (profile?.status !== "verified") return null;
  return (
    <span className="ll-host-chip">
      <BadgeCheck size={15} aria-hidden="true" />
      {formatUi("{0} · đã xác minh", [t(posterLabels[profile.poster_type])])}
    </span>
  );
}

export function HostProfileForm({
  page,
  close,
  saved,
}: {
  page: HostProfilePage;
  close?: () => void;
  saved: (page: HostProfilePage) => void;
}) {
  // Keep the revision the user started editing; background refreshes must not
  // turn a stale form into a write against a newer profile revision.
  const [current] = useState(page.profile);
  const [type, setType] = useState<PosterType>(current?.poster_type || "owner");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    const text = (key: string) => String(f.get(key) || "").trim();
    try {
      const result = await housingManagement<HostProfilePage>(
        "host/profile",
        "PUT",
        {
          poster_type: type,
          display_name: text("display_name"),
          legal_name: text("legal_name"),
          phone: text("phone"),
          broker_license_no:
            type === "broker" ? text("broker_license_no") || null : null,
          business_name:
            type === "business" ? text("business_name") || null : null,
          tax_code: type === "business" ? text("tax_code") || null : null,
          ...(page.terms_version && f.get("accept_terms")
            ? { accept_terms_version: page.terms_version }
            : {}),
          ...(current ? { revision: current.revision } : {}),
        },
      );
      saved(result);
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="ll-panel ll-form-panel ll-host-form">
      <div className="ll-section-heading">
        <div>
          <span className="ll-eyebrow">{t("HỒ SƠ NGƯỜI ĐĂNG")}</span>
          <h2>
            {current
              ? t("Cập nhật hồ sơ người đăng")
              : t("Bắt đầu cho thuê trên ReloHome")}
          </h2>
          <p>
            {t(
              "Người thuê chỉ thấy tên hiển thị và tư cách đăng tin. Họ tên, số điện thoại và giấy tờ chỉ đội kiểm duyệt ReloHome xem để xác minh.",
            )}
          </p>
        </div>
        {close && (
          <button
            className="icon-button"
            onClick={close}
            aria-label={t("Đóng")}
          >
            <X />
          </button>
        )}
      </div>
      <form className="ll-form" onSubmit={submit}>
        <fieldset className="wide ll-poster-types">
          <legend>{t("Bạn đăng tin với tư cách")}</legend>
          {(Object.keys(posterLabels) as PosterType[]).map((value) => {
            const Icon = posterIcons[value];
            return (
              <label key={value} className={type === value ? "active" : ""}>
                <input
                  type="radio"
                  name="poster_type"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                />
                <Icon aria-hidden="true" />
                <span>
                  <strong>{t(posterLabels[value])}</strong>
                  <small>{t(posterHints[value])}</small>
                </span>
              </label>
            );
          })}
        </fieldset>
        <label>
          <span className="field-label">{t("Tên hiển thị với người thuê")}<RequiredMark /></span>
          <input
            name="display_name"
            required
            maxLength={80}
            defaultValue={current?.display_name || ""}
            placeholder={t("Ví dụ: Cô Lan nhà trọ Cầu Giấy")}
          />
        </label>
        <label>
          <span className="field-label">{t("Họ tên đầy đủ")}<RequiredMark /></span>
          <input
            name="legal_name"
            required
            maxLength={160}
            autoComplete="name"
            defaultValue={current?.legal_name || ""}
          />
        </label>
        <label>
          <span className="field-label">{t("Số điện thoại để ReloHome xác minh")}<RequiredMark /></span>
          <input
            name="phone"
            required
            inputMode="tel"
            autoComplete="tel"
            pattern="\+?[0-9 .\-]{8,20}"
            defaultValue={current?.phone || ""}
            placeholder="0901 234 567"
          />
        </label>
        {type === "broker" && (
          <label>
            {t("Số chứng chỉ hành nghề môi giới (nếu có)")}
            <input
              name="broker_license_no"
              maxLength={80}
              defaultValue={current?.broker_license_no || ""}
            />
          </label>
        )}
        {type === "business" && (
          <>
            <label>
              <span className="field-label">{t("Tên doanh nghiệp hoặc hộ kinh doanh")}<RequiredMark /></span>
              <input
                name="business_name"
                required
                maxLength={200}
                defaultValue={current?.business_name || ""}
              />
            </label>
            <label>
              {t("Mã số thuế")}
              <input
                name="tax_code"
                maxLength={20}
                inputMode="numeric"
                defaultValue={current?.tax_code || ""}
              />
            </label>
          </>
        )}
        {page.terms_version && (
          <label className="wide checkbox ll-terms">
            <input type="checkbox" name="accept_terms" required />
            <span className="field-label">{formatUi("Tôi đồng ý Điều khoản người đăng (phiên bản {0})", [
              page.terms_version,
            ])}<RequiredMark /></span>
          </label>
        )}
        <p className="ll-form-hint wide">
          <ShieldCheck size={16} aria-hidden="true" />{" "}
          {current?.status === "verified"
            ? t(
                "Đổi tư cách, họ tên, số điện thoại hoặc giấy tờ sẽ cần xác minh lại; đổi tên hiển thị thì không.",
              )
            : t(
                "Sau khi gửi, đội kiểm duyệt sẽ gọi điện hoặc gọi video để xác minh. ReloHome không yêu cầu bạn tải ảnh giấy tờ lên.",
              )}
        </p>
        {error && (
          <p className="ll-form-error wide" role="alert">
            {error}
          </p>
        )}
        <div className="ll-form-actions wide">
          {close && (
            <button type="button" className="secondary" onClick={close}>
              {t("Hủy")}
            </button>
          )}
          <button className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : <ShieldCheck />}{" "}
            {current ? t("Lưu hồ sơ") : t("Gửi hồ sơ để xác minh")}
          </button>
        </div>
      </form>
    </section>
  );
}
