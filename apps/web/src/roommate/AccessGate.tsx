import { RequiredMark } from "../components/RequiredMark";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { roommate, RoommateError } from "./client";
import { ErrorNotice } from "./ErrorNotice";
import type { Access } from "./types";
import { rt } from "./text";
import { useContext } from "react";
import { RoommateFeatures } from "./Features";
import { PrivacyPanel } from "./PrivacyPanel";
export function AccessGate({
  access,
  done,
}: {
  access: Access;
  done: () => void;
}) {
  const privacyEnabled = useContext(RoommateFeatures).includes("privacy");
  const [adult, setAdult] = useState(false),
    [terms, setTerms] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  if (access.reason === "service_restricted")
    return (
      <>
        <ErrorNotice error={new RoommateError("service_restricted", 403)} />
        {privacyEnabled && <PrivacyPanel />}
      </>
    );
  return (
    <section className="rm-access rm-panel">
      <ShieldCheck size={26} aria-hidden="true" />
      <h2>
        {rt("Không gian tìm người ở cùng", "Your roommate discovery space")}
      </h2>
      <p>
        {rt(
          "Hồ sơ do người dùng tự khai, không phải cam kết xác minh hay bảo đảm hòa hợp. Bạn tự quyết định gửi yêu cầu; không cần đăng hồ sơ công khai để tìm.",
          "Profiles are self-declared, not verified guarantees of compatibility. You decide who to contact; browsing does not require a public profile.",
        )}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await roommate("/access", "POST", {
              adult,
              terms_version: access.terms_version,
            });
            done();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="rm-check">
          <input
            type="checkbox"
            required
            checked={adult}
            onChange={(e) => setAdult(e.target.checked)}
          />
          <span className="field-label">{rt(
            "Tôi xác nhận mình từ 18 tuổi.",
            "I confirm I am at least 18 years old.",
          )}<RequiredMark /></span>
        </label>
        <label className="rm-check">
          <input
            type="checkbox"
            required
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
          />
          <span className="field-label">{rt(
            "Tôi đồng ý quy tắc sử dụng: không đăng thông tin liên hệ công khai, tôn trọng consent và chỉ cung cấp thông tin đúng về nhu cầu của mình.",
            "I agree to the service rules: no public contact details, respect consent and provide accurate information about my housing needs.",
          )}<RequiredMark /></span>
        </label>
        <p className="rm-hint">
          {rt("Phiên bản điều kiện: ", "Terms version: ")}
          {access.terms_version}
        </p>
        <ErrorNotice error={error} />
        <button className="primary" disabled={busy || !adult || !terms}>
          {busy
            ? rt("Đang xác nhận…", "Confirming…")
            : rt("Xác nhận và tiếp tục", "Confirm and continue")}
        </button>
      </form>
    </section>
  );
}
