import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Search } from "lucide-react";
import { AppearanceControls, useUiPreferences } from "../uiPreferences";
import { rt } from "./text";
export function RoommateGuest() {
  useUiPreferences();
  const location = useLocation();
  const signInParams = new URLSearchParams(location.search);
  signInParams.set("signin", "1");
  return (
    <main className="rm-guest">
      <header className="rm-guest-header">
        <Link to="/">ReloHome</Link>
        <AppearanceControls />
      </header>
      <section className="rm-guest-body">
        <span className="rm-kicker">ROOMMATE DISCOVERY</span>
        <h1>
          {rt(
            "Tìm người cùng chia sẻ một nơi ở",
            "Find someone to share a place with",
          )}
        </h1>
        <p>
          {rt(
            "Khám phá những người đang có nhu cầu ở cùng, so sánh các ưu tiên rồi tự quyết định kết nối. Không tự ghép cặp.",
            "Discover people who are looking for a roommate, compare preferences and decide who to connect with. No automatic pairing.",
          )}
        </p>
        <div className="rm-guest-values">
          <p>
            <Search size={20} aria-hidden="true" />
            {rt(
              "Tìm theo nhu cầu và sinh hoạt",
              "Search by housing needs and lifestyle",
            )}
          </p>
          <p>
            <ShieldCheck size={20} aria-hidden="true" />
            {rt(
              "Liên hệ chỉ mở khi cả hai đồng ý",
              "Contacts are shared only with mutual consent",
            )}
          </p>
        </div>
        <p className="rm-hint">
          {rt(
            "Dành cho người từ 18 tuổi tại TP.HCM, Hà Nội và Đà Nẵng. Đăng nhập và xác nhận điều kiện để xem hồ sơ thật.",
            "For adults aged 18+ in Ho Chi Minh City, Hanoi and Da Nang. Sign in and accept the service terms to view real profiles.",
          )}
        </p>
        <Link className="primary" to={location.pathname + "?" + signInParams + location.hash}>
          {rt("Đăng nhập để tìm người", "Sign in to discover people")}
        </Link>
        <Link className="text-button" to="/">
          <ArrowLeft size={16} aria-hidden="true" />
          {rt("Về ReloHome", "Back to ReloHome")}
        </Link>
      </section>
    </main>
  );
}
