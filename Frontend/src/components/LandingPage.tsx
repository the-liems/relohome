import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  Compass,
  House,
  MapPin,
  Menu,
  MessageCircle,
  Plane,
  ShieldCheck,
  Sparkles,
  Truck,
  UsersRound,
  X,
} from "lucide-react";
import { AppearanceControls, t, useUiPreferences } from "../uiPreferences";
import { useUiMotion } from "../useUiMotion";

const services = [
  {
    icon: House,
    href: "/ai",
    title: "Tìm nơi ở phù hợp",
    text: "Lọc theo khu vực, ngân sách và tiện nghi. Xem vị trí, so sánh và lưu những căn bạn quan tâm.",
  },
  {
    icon: Compass,
    href: "/ai",
    title: "Hiểu khu vực trước khi chọn",
    text: "Khám phá tiện ích xung quanh và xem khoảng cách, tuyến đường để cân nhắc nhịp sống hằng ngày.",
  },
  {
    icon: Truck,
    href: "/ai",
    title: "Chuẩn bị chuyến chuyển đồ",
    text: "Chọn điểm lấy, điểm giao, gói xe và tùy chọn từ AhaMove. Xem báo giá trước khi quyết định.",
  },
  {
    icon: Plane,
    href: "/ai",
    title: "Sắp xếp hành trình",
    text: "Tìm và so sánh chuyến bay theo nhu cầu. Các lựa chọn cùng xuất hiện trong kế hoạch của bạn.",
  },
  {
    icon: UsersRound,
    href: "/roommate",
    title: "Tìm người ở cùng",
    text: "Khám phá hồ sơ đang tìm người ở cùng và tự chọn người phù hợp với nhu cầu, thói quen của bạn.",
  },
  {
    icon: BookOpen,
    href: "/guides",
    title: "Cẩm nang thuê và sống",
    text: "Đọc kinh nghiệm về tìm nhà, chi phí, hợp đồng, an toàn và chia sẻ không gian sống.",
  },
  {
    icon: Building2,
    href: "/landlord",
    title: "Quản lý nhà cho thuê",
    text: "Dành cho chủ trọ: quản lý nhiều nhà và phòng, công khai chi phí, cập nhật trạng thái và xử lý yêu cầu liên hệ.",
  },
];
const steps = [
  {
    number: "01",
    title: "Kể ReloHome điều bạn cần",
    text: "Một nơi ở mới, ngân sách, khu vực hay lịch chuyển. Bắt đầu bằng cách trò chuyện tự nhiên.",
  },
  {
    number: "02",
    title: "Xem và cân nhắc lựa chọn",
    text: "Cùng xem căn nhà trên bản đồ, tiện ích, chuyến bay và các gói chuyển đồ phù hợp.",
  },
  {
    number: "03",
    title: "Bạn chọn. ReloHome theo dõi.",
    text: "Theo dõi tiến trình và chi phí trong cùng hội thoại. Mỗi giao dịch vẫn cần bạn xem lại và xác nhận.",
  },
];
const guideTopics = [
  {
    icon: MapPin,
    title: "Chọn khu vực để sống",
    text: "Đi lại, tiện ích và những điều nên quan sát khi tìm nơi ở mới.",
  },
  {
    icon: Truck,
    title: "Chuẩn bị một chuyến chuyển nhà",
    text: "Đồ đạc, lịch chuyển và các câu hỏi cần làm rõ với dịch vụ vận chuyển.",
  },
  {
    icon: UsersRound,
    title: "Sống chung sao cho phù hợp",
    text: "Thói quen, không gian riêng và cách thống nhất nhu cầu khi ở ghép.",
  },
];

export function LandingPage({ signedIn }: { signedIn: boolean }) {
  const motionRoot = useUiMotion();
  useUiPreferences();
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  return (
    <div className="landing-page" ref={motionRoot}>
      <a className="landing-skip" href="#landing-main">
        {t("Đến nội dung chính")}
      </a>
      <header className="landing-header">
        <div className="landing-nav-wrap">
          <Link
            to="/"
            className="landing-brand"
            aria-label={t("Trang giới thiệu ReloHome")}
          >
            <span>
              ReloHome
              <small>{t("Cùng bạn bắt đầu cuộc sống mới")}</small>
            </span>
          </Link>
          <nav
            id="landing-navigation"
            className={"landing-nav " + (menu ? "open" : "")}
            aria-label={t("Điều hướng giới thiệu")}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMenu(false);
                menuButton.current?.focus();
              }
            }}
          >
            {[
              ["#services", "Dịch vụ"],
              ["#journey", "Cách ReloHome đồng hành"],
              ["#next", "Ghép trọ"],
              ["#guide", "Cẩm nang"],
            ].map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenu(false)}>
                {t(label)}
              </a>
            ))}
          </nav>
          <div className="landing-nav-actions">
            <AppearanceControls />
            <Link className="landing-nav-cta" to={signedIn ? "/ai" : "/login"}>
              {t(signedIn ? "Vào không gian ReloHome" : "Đăng nhập")}
              <ArrowUpRight size={15} />
            </Link>
            <button
              ref={menuButton}
              className="landing-menu-button"
              type="button"
              aria-label={t(menu ? "Đóng điều hướng" : "Mở điều hướng")}
              aria-expanded={menu}
              aria-controls="landing-navigation"
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </header>
      <main id="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-media" aria-hidden="true">
            <img
              src="/images/relohome-hero-home.png"
              alt=""
              width={1792}
              height={1024}
              fetchPriority="high"
            />
          </div>
          <div className="landing-hero-inner landing-container">
            <div className="landing-hero-copy">
              <span className="landing-kicker">
                <span />
                {t("TRỢ LÝ CHO MỘT KHỞI ĐẦU MỚI")}
              </span>
              <h1 id="landing-title">
                {t("Tìm nơi ở mới.")}
                <br />
                <em>{t("Tìm đúng nơi. An tâm từng bước.")}</em>
              </h1>
              <p>
                {t(
                  "Tìm nhà, khám phá đường đi, chuyển đồ, tìm chuyến bay, tìm người ở cùng và đọc cẩm nang. ReloHome gom những bước quan trọng vào một nơi để bạn dễ chọn điều phù hợp.",
                )}
              </p>
              <div className="landing-hero-actions">
                <Link className="landing-primary" to="/ai">
                  {t("Bắt đầu cùng ReloHome")}
                  <ArrowRight size={19} />
                </Link>
                <a className="landing-text-link" href="#journey">
                  {t("Khám phá cách hoạt động")}
                  <ChevronDown size={16} />
                </a>
              </div>
              <div className="landing-hero-trust">
                <ShieldCheck size={17} />
                <span>{t("Lựa chọn của bạn. Xác nhận của bạn.")}</span>
              </div>
              <div className="landing-scope">
                <span>{t("Hà Nội")}</span>
                <i />
                <span>{t("Đà Nẵng")}</span>
                <i />
                <span>TP.HCM</span>
              </div>
            </div>
          </div>
        </section>
        <div className="landing-service-strip">
          <div className="landing-container">
            {services.map((s) => (
              <span key={s.title}>
                <s.icon size={18} />
                {t(s.title)}
              </span>
            ))}
          </div>
        </div>
        <section
          id="services"
          className="landing-section landing-container"
          aria-labelledby="landing-services-title"
        >
          <div className="landing-section-heading">
            <div>
              <span className="landing-kicker">
                01 / {t("NHỮNG ĐIỀU ReloHome GIÚP BẠN")}
              </span>
              <h2 id="landing-services-title">
                {t("Nhiều việc cần lo.")}
                <br />
                <em>{t("Một nơi để bắt đầu.")}</em>
              </h2>
            </div>
            <p>
              {t(
                "Bạn không cần giữ từng lựa chọn ở một nơi khác nhau. Cùng ReloHome tìm hiểu, so sánh và xây dựng kế hoạch cho bước chuyển tiếp của mình.",
              )}
            </p>
          </div>
          <div className="landing-service-grid">
            {services.map((s) => (
              <article className="landing-service-card" key={s.title}>
                <span className="landing-service-icon">
                  <s.icon size={24} />
                </span>
                <h3>{t(s.title)}</h3>
                <p>{t(s.text)}</p>
                <Link to={s.href}>
                  {t(s.href === "/roommate" ? "Khám phá hồ sơ" : s.href === "/guides" ? "Mở cẩm nang" : s.href === "/landlord" ? "Mở quản lý nhà" : "Bắt đầu trò chuyện")}
                  <ArrowUpRight size={16} />
                </Link>
              </article>
            ))}
          </div>
        </section>
        <section
          id="journey"
          className="landing-journey"
          aria-labelledby="landing-journey-title"
        >
          <div className="landing-container">
            <div className="landing-section-heading">
              <div>
                <span className="landing-kicker">
                  02 / {t("CÁCH ReloHome ĐỒNG HÀNH")}
                </span>
                <h2 id="landing-journey-title">
                  {t("Từ một nhu cầu,")}
                  <br />
                  <em>{t("đến một kế hoạch rõ ràng.")}</em>
                </h2>
              </div>
              <p>
                {t(
                  "ReloHome giữ các bước, lựa chọn và chi phí trong cùng hội thoại. Bạn luôn có thể xem lại, bổ sung thông tin hoặc thay đổi phương án.",
                )}
              </p>
            </div>
            <div className="landing-steps">
              {steps.map((s) => (
                <article key={s.number}>
                  <span className="landing-step-number">{s.number}</span>
                  <h3>{t(s.title)}</h3>
                  <p>{t(s.text)}</p>
                </article>
              ))}
            </div>
            <div className="landing-story">
              <div>
                <MessageCircle size={22} />
                <p>{t("“Tôi muốn tìm nhà và chuẩn bị chuyển đồ tới đó.”")}</p>
                <span>{t("Một ví dụ để bắt đầu cuộc trò chuyện")}</span>
              </div>
              <ArrowRight className="landing-story-arrow" size={24} />
              <div>
                <span className="landing-story-label">
                  <Sparkles size={16} />
                  ReloHome
                </span>
                <ul>
                  <li>
                    <Check size={16} />
                    {t("Làm rõ nơi ở và ngân sách")}
                  </li>
                  <li>
                    <Check size={16} />
                    {t("Xem vị trí và các lựa chọn")}
                  </li>
                  <li>
                    <Check size={16} />
                    {t("Chuẩn bị điểm A/B và lịch chuyển")}
                  </li>
                  <li>
                    <Check size={16} />
                    {t("Theo dõi lựa chọn trong kế hoạch")}
                  </li>
                </ul>
              </div>
            </div>
            <p className="landing-journey-note">
              <ShieldCheck size={16} />
              {t(
                "Xem kết quả hoặc chọn phương án chưa phải thuê nhà, đặt vé hay đặt xe.",
              )}
            </p>
          </div>
        </section>
        <section
          id="next"
          className="landing-section landing-container landing-next"
          aria-labelledby="landing-next-title"
        >
          <div className="landing-next-visual">
            <div className="landing-person">
              <UsersRound size={70} />
            </div>
            <div className="landing-next-tags">
              <span>
                <House size={15} />
                {t("Không gian chung")}
              </span>
              <span>
                <HeartMark />
                {t("Nhu cầu phù hợp")}
              </span>
              <span>
                <Compass size={15} />
                {t("Cùng nhịp sống")}
              </span>
            </div>
          </div>
          <div>
            <span className="landing-status landing-status-live"><i />{t("ĐANG HOẠT ĐỘNG")}</span>
            <h2 id="landing-next-title">
              {t("Một nơi ở tốt.")}
              <br />
              <em>{t("Một người ở cùng phù hợp.")}</em>
            </h2>
            <p>
              {t(
                "Xem những hồ sơ đang chủ động tìm người ở cùng. ReloHome sắp xếp theo tiêu chí và mức độ tương thích để bạn tham khảo; bạn luôn là người xem hồ sơ và quyết định có gửi yêu cầu liên hệ hay không.",
              )}
            </p>
            <p className="landing-future-note">
              {t("Không tự động ghép đôi. Thông tin liên hệ chỉ được chia sẻ khi cả hai bên đồng ý.")}
            </p>
            <Link className="landing-inline-cta" to="/roommate">{t("Khám phá người đang tìm bạn ở cùng")}<ArrowRight size={17} /></Link>
          </div>
        </section>
        <section
          id="guide"
          className="landing-guide landing-container"
          aria-labelledby="landing-guide-title"
        >
          <div className="landing-section-heading">
            <div>
              <span className="landing-kicker">
                03 / {t("CẨM NANG CUỘC SỐNG MỚI")}
              </span>
              <h2 id="landing-guide-title">
                {t("Chuẩn bị tốt hơn,")}
                <br />
                <em>{t("an tâm hơn ở bước tiếp theo.")}</em>
              </h2>
            </div>
            <div>
              <Link className="landing-status landing-status-live" to="/guides"><i />{t("ĐANG HOẠT ĐỘNG")}<ArrowUpRight size={14} /></Link>
              <p>
                {t(
                  "Đọc cẩm nang do ReloHome biên soạn về tiền điện, hợp đồng, đặt cọc, xem phòng, an toàn và những chủ đề thiết thực khi thuê nhà.",
                )}
              </p>
            </div>
          </div>
          <div className="landing-guide-grid">
            {guideTopics.map((s, i) => (
              <article key={s.title}>
                <span className="landing-guide-art">
                  <s.icon size={43} />
                  <span>0{i + 1}</span>
                </span>
                <div>
                  <span className="landing-guide-tag">{t("Bài viết tuyển chọn")}</span>
                  <h3>{t(s.title)}</h3>
                  <p>{t(s.text)}</p>
                  <Link className="landing-guide-soon" to="/guides"><BookOpen size={15} />{t("Đọc trong Cẩm nang")}<ArrowUpRight size={14} /></Link>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="landing-final landing-container">
          <div>
            <span className="landing-kicker">ReloHome</span>
            <h2>{t("Bạn đang nghĩ đến một khởi đầu mới?")}</h2>
            <p>
              {t(
                "Kể ReloHome điều bạn muốn làm. Cùng bắt đầu từ bước đầu tiên.",
              )}
            </p>
          </div>
          <Link className="landing-primary" to="/ai">
            {t("Trò chuyện với ReloHome")}
            <ArrowRight size={19} />
          </Link>
        </section>
      </main>
      <footer className="landing-footer landing-container">
        <span className="landing-footer-brand">
          <strong>ReloHome</strong>
        </span>
        <p>{t("Tìm nơi ở. Sắp xếp hành trình. Bắt đầu cuộc sống mới.")}</p>
        <Link to="/ai">
          {t("Vào chatbot")}
          <ArrowUpRight size={15} />
        </Link>
        <span>© {new Date().getFullYear()} ReloHome</span>
      </footer>
    </div>
  );
}
function HeartMark() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}
