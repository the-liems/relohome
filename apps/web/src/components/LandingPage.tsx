import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Compass,
  Copy,
  House,
  ListChecks,
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
import { AppearanceControls, useUiPreferences } from "../uiPreferences";
import { useUiMotion } from "../useUiMotion";
import { guides } from "../guides/content";
import "../landing-experience.css";

type CopyPair = readonly [string, string];
const services = [
  { service: "property", icon: House, href: "#services", label: ["Tìm nhà", "Find a home"] },
  {
    service: "map",
    icon: Compass,
    href: "#services",
    label: ["Bản đồ & đường đi", "Maps & routes"],
  },
  { service: "relocation", icon: Truck, href: "#relocation", label: ["Chuyển đồ", "Moving"] },
  { service: "flight", icon: Plane, href: "#relocation", label: ["Chuyến bay", "Flights"] },
  { service: "roommate", icon: UsersRound, href: "#next", label: ["Ghép trọ", "Roommates"] },
  {
    service: "landlord",
    icon: Building2,
    href: "#landlord",
    label: ["Dành cho chủ nhà", "For landlords"],
  },
  { service: "guides", icon: BookOpen, href: "#guide", label: ["Cẩm nang", "Guides"] },
] as const;
const journeySteps = [
  {
    icon: MessageCircle,
    title: ["Bạn nêu nhu cầu", "Tell us your needs"],
    text: [
      "Nói tự nhiên. Thiếu thông tin cần thiết, AI sẽ hỏi lại.",
      "Speak naturally. The AI asks when essential information is missing.",
    ],
  },
  {
    icon: ListChecks,
    title: ["AI lập kế hoạch", "AI builds a plan"],
    text: [
      "Chia việc, xác định bước làm trước và việc có thể tìm song song.",
      "Break down the work, identify dependencies and searches that can run in parallel.",
    ],
  },
  {
    icon: Compass,
    title: ["Phối hợp dịch vụ", "Coordinate services"],
    text: [
      "Tra địa điểm, tìm nhà và chuyến bay; dùng căn đã chọn cho bước chuyển đồ.",
      "Look up places, homes and flights; use your chosen home for the moving step.",
    ],
  },
  {
    icon: CheckCheck,
    title: ["Bạn xem & quyết định", "Review & decide"],
    text: [
      "Kết quả, bản đồ và chi phí trong cùng kế hoạch. Giao dịch cần xác nhận riêng.",
      "Results, maps and costs in one plan. Transactions require separate confirmation.",
    ],
  },
] as const;
const featuredGuides = [
  {
    id: "xem-phong",
    icon: House,
    en: "Viewing a home: what to check beyond photos?",
    enSummary: "Check the space, safety and total costs before deciding.",
  },
  {
    id: "ngan-sach-thue",
    icon: ListChecks,
    en: "Plan your full monthly rental budget",
    enSummary:
      "Consider rent, bills, transport and a buffer, not just the advertised price.",
  },
  {
    id: "hop-dong-thue",
    icon: BookOpen,
    en: "What to read carefully in a lease",
    enSummary:
      "Understand costs, duration, your rights and how the tenancy ends.",
  },
] as const;

export function LandingPage({ signedIn }: { signedIn: boolean }) {
  const motionRoot = useUiMotion();
  const { locale } = useUiPreferences();
  const text = (vi: string, en: string) => (locale === "en" ? en : vi);
  const pick = (pair: CopyPair) => text(...pair);
  const [menu, setMenu] = useState(false);
  const [mapView, setMapView] = useState(false);
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState<"idle" | "done" | "unavailable">("idle");
  const menuButton = useRef<HTMLButtonElement>(null);
  const exampleRef = useRef<HTMLParagraphElement>(null);
  const example = text(
    "Tôi muốn tìm phòng gần trường, dưới 6 triệu/tháng, và tìm chuyến bay từ Hà Nội vào TP.HCM để xem phòng. Sau khi chọn nhà, giúp tôi chuẩn bị chuyển đồ.",
    "I want a room near my university for under VND 6 million a month, and a flight from Hanoi to Ho Chi Minh City to view it. Once I choose a home, help me plan my move.",
  );
  async function copyExample() {
    try {
      await navigator.clipboard.writeText(example);
      setCopied("done");
    } catch {
      setCopied("unavailable");
      exampleRef.current?.focus();
    }
  }
  const illustration = text(
    "Minh họa giao diện · không phải dữ liệu trực tiếp",
    "Interface illustration · not live data",
  );
  return (
    <div className="landing-page landing-upgrade" ref={motionRoot}>
      <a className="landing-skip" href="#landing-main">
        {text("Đến nội dung chính", "Skip to main content")}
      </a>
      <header className="landing-header">
        <div className="landing-nav-wrap">
          <Link
            to="/"
            className="landing-brand"
            aria-label={text("Trang giới thiệu ReloHome", "ReloHome home")}
          >
            <span>
              ReloHome
              <small>
                {text(
                  "Cùng bạn bắt đầu cuộc sống mới",
                  "A new chapter, together",
                )}
              </small>
            </span>
          </Link>
          <nav
            id="landing-navigation"
            className={"landing-nav " + (menu ? "open" : "")}
            aria-label={text("Điều hướng giới thiệu", "Landing navigation")}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMenu(false);
                menuButton.current?.focus();
              }
            }}
          >
            {[
              ["#services", "Dịch vụ", "Services"],
              ["#journey", "AI đồng hành", "Your AI companion"],
              ["#next", "Ghép trọ", "Roommates"],
              ["#landlord", "Chủ nhà", "Landlords"],
              ["#guide", "Cẩm nang", "Guides"],
            ].map(([href, vi, en]) => (
              <a key={href} href={href} onClick={() => setMenu(false)}>
                {text(vi, en)}
              </a>
            ))}
          </nav>
          <div className="landing-nav-actions">
            <AppearanceControls />
            <Link className="landing-nav-cta" to={signedIn ? "/ai" : "/login"}>
              {signedIn
                ? text("Vào không gian AI", "Open AI workspace")
                : text("Đăng nhập", "Sign in")}
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
            <button
              ref={menuButton}
              className="landing-menu-button"
              type="button"
              aria-label={
                menu
                  ? text("Đóng điều hướng", "Close navigation")
                  : text("Mở điều hướng", "Open navigation")
              }
              aria-expanded={menu}
              aria-controls="landing-navigation"
              onClick={() => setMenu(!menu)}
            >
              {menu ? (
                <X size={20} aria-hidden="true" />
              ) : (
                <Menu size={20} aria-hidden="true" />
              )}
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
                {text(
                  "AI ĐỒNG HÀNH CÙNG KHỞI ĐẦU MỚI",
                  "AN AI COMPANION FOR YOUR NEXT CHAPTER",
                )}
              </span>
              <h1 id="landing-title">
                {text("Tìm nơi ở mới.", "Find your next home.")}
                <br />
                <em>
                  {text(
                    "Tìm đúng nơi. An tâm từng bước.",
                    "The right place. Every step considered.",
                  )}
                </em>
              </h1>
              <p>
                {text(
                  "Nói điều bạn cần. AI giúp tìm nhà, hiểu khu vực và sắp xếp hành trình, chuyển đồ — trong một cuộc trò chuyện và một kế hoạch chung.",
                  "Tell us what you need. Your AI helps find a home, explore the area and plan travel and moving — in one conversation, with one shared plan.",
                )}
              </p>
              <div className="landing-hero-actions">
                <Link className="landing-primary" to="/ai">
                  {text("Bắt đầu với AI", "Start with AI")}
                  <ArrowRight size={19} aria-hidden="true" />
                </Link>
                <a className="landing-text-link" href="#journey">
                  {text(
                    "Xem một nhu cầu thực tế",
                    "Explore a real-world scenario",
                  )}
                  <ChevronDown size={16} aria-hidden="true" />
                </a>
              </div>
              <div className="landing-hero-trust">
                <ShieldCheck size={17} aria-hidden="true" />
                <span>
                  {text(
                    "AI hỗ trợ. Bạn lựa chọn và xác nhận.",
                    "AI assists. You choose and confirm.",
                  )}
                </span>
              </div>
              <div className="landing-scope">
                <span>{text("Hà Nội", "Hanoi")}</span>
                <i />
                <span>{text("Đà Nẵng", "Da Nang")}</span>
                <i />
                <span>{text("TP.HCM", "Ho Chi Minh City")}</span>
              </div>
            </div>
          </div>
        </section>
        <nav
          className="lp-service-index"
          aria-label={text("Khám phá dịch vụ", "Explore services")}
        >
          <div className="landing-container">
            {services.map((service) => (
              <a key={service.href + service.label[0]} data-service={service.service} href={service.href}>
                <service.icon size={18} aria-hidden="true" />
                {pick(service.label)}
              </a>
            ))}
          </div>
        </nav>

        <section
          id="services"
          className="landing-section landing-container"
          aria-labelledby="landing-services-title"
        >
          <div className="landing-section-heading">
            <div>
              <span className="landing-kicker">
                01 /{" "}
                {text("BẮT ĐẦU TỪ ĐIỀU BẠN CẦN", "START WITH WHAT YOU NEED")}
              </span>
              <h2 id="landing-services-title">
                {text(
                  "Không chỉ tìm một căn nhà.",
                  "More than finding a home.",
                )}
                <br />
                <em>
                  {text("Tìm cách sống phù hợp.", "Find a life that fits.")}
                </em>
              </h2>
            </div>
            <p>
              {text(
                "Một căn phòng vừa túi tiền, đường đến trường thuận tiện, một chuyến đi để xem nhà. ReloHome đặt những lựa chọn ấy cạnh nhau để bạn dễ cân nhắc.",
                "An affordable room, an easier commute, a trip to view your options. ReloHome brings these choices together so you can weigh what matters.",
              )}
            </p>
          </div>
          <div className="lp-needs-layout">
            <article className="lp-home-feature" data-service="property">
              <div className="lp-feature-copy">
                <span className="lp-eyebrow">
                  <House size={17} aria-hidden="true" />
                  {text(
                    "TÌM NHÀ & HIỂU KHU VỰC",
                    "FIND A HOME & EXPLORE THE AREA",
                  )}
                </span>
                <h3>
                  {text(
                    "Chọn nhà bằng cả bức tranh.",
                    "See the whole picture.",
                  )}
                </h3>
                <p>
                  {text(
                    "Lọc theo nhu cầu, so sánh chi phí, xem tiện ích và đường đi. Chọn căn trên bản đồ, rồi dùng chính lựa chọn đó cho kế hoạch tiếp theo.",
                    "Filter by your needs, compare costs, explore amenities and routes. Choose a home on the map and carry it into your next steps.",
                  )}
                </p>
                <Link className="landing-inline-cta" to="/ai">
                  {text("Tìm nơi ở của tôi", "Find my next home")}
                  <ArrowUpRight size={17} aria-hidden="true" />
                </Link>
              </div>
              <div className="lp-home-preview">
                <div className="lp-preview-top">
                  <span>
                    <MapPin size={15} aria-hidden="true" />
                    {text("Không gian tìm nhà", "Home search workspace")}
                  </span>
                  <div
                    className="lp-segments"
                    role="group"
                    aria-label={text(
                      "Chế độ minh họa bản đồ",
                      "Map illustration mode",
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={!mapView}
                      onClick={() => setMapView(false)}
                    >
                      {text("Căn nhà", "Homes")}
                    </button>
                    <button
                      type="button"
                      aria-pressed={mapView}
                      onClick={() => setMapView(true)}
                    >
                      {text("Khu vực", "Area")}
                    </button>
                  </div>
                </div>
                <div className="lp-map-scene">
                  <MapIllustration
                    area={mapView}
                    label={text(
                      "Sơ đồ minh họa nhà, điểm tìm kiếm và tiện ích",
                      "Schematic illustration of homes, a search point and amenities",
                    )}
                  />
                  <div className="lp-map-caption" aria-live="polite">
                    <strong>
                      {mapView
                        ? text(
                            "Hiểu nhịp sống quanh nhà",
                            "Explore life around your home",
                          )
                        : text(
                            "Những căn bạn muốn cân nhắc",
                            "Homes you want to consider",
                          )}
                    </strong>
                    <span>
                      {mapView
                        ? text(
                            "Trường học · mua sắm · đường đi",
                            "Schools · shops · routes",
                          )
                        : text(
                            "Giá thuê · chi phí · vị trí",
                            "Rent · costs · location",
                          )}
                    </span>
                  </div>
                </div>
                <div className="lp-preview-bottom">
                  <span>
                    <Check size={15} aria-hidden="true" />
                    {text("So sánh trước khi chọn", "Compare before choosing")}
                  </span>
                  <span>{illustration}</span>
                </div>
              </div>
            </article>
            <article id="relocation" className="lp-relocation-feature">
              <span className="lp-eyebrow">
                {text("SẮP XẾP BƯỚC CHUYỂN", "PLAN YOUR NEXT STEPS")}
              </span>
              <h3>
                {text(
                  "Từ nơi đang ở đến nơi sẽ gọi là nhà.",
                  "From where you are to where you belong.",
                )}
              </h3>
              <div className="lp-relocation-row" data-service="flight">
                <span className="lp-icon-tile">
                  <Plane size={22} aria-hidden="true" />
                </span>
                <div>
                  <h4>
                    {text("Hành trình đến xem nhà", "Your trip to view a home")}
                  </h4>
                  <p>
                    {text(
                      "Tìm và so sánh chuyến bay theo lịch, lưu lựa chọn vào cùng kế hoạch.",
                      "Search and compare flights by schedule; keep your choice in the same plan.",
                    )}
                  </p>
                </div>
              </div>
              <div className="lp-relocation-row" data-service="relocation">
                <span className="lp-icon-tile">
                  <Truck size={22} aria-hidden="true" />
                </span>
                <div>
                  <h4>
                    {text(
                      "Chuyến chuyển đồ tới căn đã chọn",
                      "Move to your chosen home",
                    )}
                  </h4>
                  <p>
                    {text(
                      "Chốt điểm lấy/giao và thời gian, xem gói xe và báo giá AhaMove trước khi đặt.",
                      "Confirm pickup, destination and time. Review AhaMove vehicle options and quotes before booking.",
                    )}
                  </p>
                </div>
              </div>
              <div className="lp-safety-note">
                <ShieldCheck size={18} aria-hidden="true" />
                <p>
                  {text(
                    "Báo giá không phải đặt đơn. Giao dịch và thanh toán phụ thuộc cấu hình dịch vụ, luôn cần bạn xác nhận riêng.",
                    "A quote is not a booking. Transactions and payments depend on service configuration and always require your separate confirmation.",
                  )}
                </p>
              </div>
              <Link className="landing-inline-cta" to="/ai">
                {text("Lên kế hoạch cùng AI", "Plan with AI")}
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </article>
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
                  02 /{" "}
                  {text(
                    "MỘT CUỘC TRÒ CHUYỆN, MỘT KẾ HOẠCH",
                    "ONE CONVERSATION, ONE PLAN",
                  )}
                </span>
                <h2 id="landing-journey-title">
                  {text("Bạn nói mục tiêu.", "You set the goal.")}
                  <br />
                  <em>
                    {text("AI kết nối từng bước.", "AI connects the steps.")}
                  </em>
                </h2>
              </div>
              <p>
                {text(
                  "Không cần mở từng dịch vụ rồi nhập lại từ đầu. AI giữ ngữ cảnh, phối hợp công cụ và đưa những phần còn cần bạn quyết định về cùng một nơi.",
                  "No need to restart in each service. The AI keeps context, coordinates tools and brings the decisions that need you back into one place.",
                )}
              </p>
            </div>
            <div className="lp-story-layout">
              <div
                className="lp-step-selector"
                role="group"
                aria-label={text(
                  "Khám phá các bước AI đồng hành",
                  "Explore the AI journey steps",
                )}
              >
                {journeySteps.map((item, index) => (
                  <button
                    key={index}
                    type="button"
                    aria-pressed={step === index}
                    aria-controls="landing-story-preview"
                    onClick={() => setStep(index)}
                  >
                    <span className="lp-step-number">0{index + 1}</span>
                    <span>
                      <strong>{pick(item.title)}</strong>
                      <small>{pick(item.text)}</small>
                    </span>
                    <item.icon size={20} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <div id="landing-story-preview" className="lp-story-preview">
                <div className="lp-preview-top">
                  <span>
                    <Sparkles size={17} aria-hidden="true" />
                    ReloHome AI
                  </span>
                  <span>
                    {text("Kịch bản minh họa", "Illustrative scenario")}
                  </span>
                </div>
                <div className="lp-story-body" aria-live="polite">
                  <p className="lp-story-stage">
                    0{step + 1} / {pick(journeySteps[step].title)}
                  </p>
                  {step === 0 ? (
                    <>
                      <p
                        ref={exampleRef}
                        tabIndex={-1}
                        className="lp-example-message"
                      >
                        {example}
                      </p>
                      <div className="lp-agent-reply">
                        <Sparkles size={18} aria-hidden="true" />
                        <p>
                          {text(
                            "Mình sẽ tách các việc cần làm. Bạn cho mình biết trường/cơ sở nào và ngày bay dự kiến nhé?",
                            "I'll break this into steps. Which university or campus, and what is your intended travel date?",
                          )}
                        </p>
                      </div>
                    </>
                  ) : step === 1 ? (
                    <div className="lp-plan-sketch">
                      <p>
                        {text(
                          "Kế hoạch theo nhu cầu của bạn",
                          "A plan shaped around your needs",
                        )}
                      </p>
                      <div>
                        <MapPin size={19} aria-hidden="true" />
                        <span>
                          {text(
                            "Xác định trường / cơ sở",
                            "Identify university / campus",
                          )}
                        </span>
                      </div>
                      <div className="lp-parallel">
                        <span>
                          <House size={18} aria-hidden="true" />
                          {text("Tìm nhà quanh trường", "Search nearby homes")}
                        </span>
                        <span>
                          <Plane size={18} aria-hidden="true" />
                          {text("Tìm chuyến bay", "Search flights")}
                        </span>
                      </div>
                      <small>
                        {text(
                          "Hai tra cứu có thể làm song song khi đủ thông tin",
                          "These searches can run in parallel when details are sufficient",
                        )}
                      </small>
                      <div>
                        <Truck size={19} aria-hidden="true" />
                        <span>
                          {text(
                            "Chuyển đồ — sau khi bạn chọn nhà",
                            "Moving — after you choose a home",
                          )}
                        </span>
                      </div>
                    </div>
                  ) : step === 2 ? (
                    <>
                      <MapIllustration
                        area
                        label={text(
                          "Minh họa kết quả dịch vụ bản đồ",
                          "Illustration of map service results",
                        )}
                      />
                      <div className="lp-tool-notes">
                        <span>
                          <Compass size={16} aria-hidden="true" />
                          {text(
                            "Địa điểm → tọa độ tìm kiếm",
                            "Place → search coordinates",
                          )}
                        </span>
                        <span>
                          <House size={16} aria-hidden="true" />
                          {text(
                            "Nhà → vị trí & thông tin có nguồn",
                            "Homes → locations & sourced facts",
                          )}
                        </span>
                        <span>
                          <Truck size={16} aria-hidden="true" />
                          {text(
                            "Căn đã chọn → điểm giao đồ",
                            "Chosen home → moving destination",
                          )}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="lp-result-sketch">
                      <CheckCheck size={32} aria-hidden="true" />
                      <h3>
                        {text(
                          "Một kế hoạch để quay lại bất cứ lúc nào",
                          "One plan to return to",
                        )}
                      </h3>
                      <dl>
                        <div>
                          <dt>{text("Nhà & khu vực", "Home & area")}</dt>
                          <dd>
                            {text(
                              "Xem bản đồ, so sánh, chọn căn",
                              "Map, comparison, selection",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>
                            {text("Hành trình & chuyển đồ", "Travel & moving")}
                          </dt>
                          <dd>
                            {text(
                              "Xem phương án và báo giá",
                              "Options and quotes",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{text("Chi phí", "Costs")}</dt>
                          <dd>
                            {text(
                              "Khoản đã biết, khoản cần xác minh",
                              "Known amounts, items to verify",
                            )}
                          </dd>
                        </div>
                      </dl>
                      <p>
                        {text(
                          "Chọn phương án không đồng nghĩa đã thuê nhà hay đặt dịch vụ.",
                          "Selecting an option does not rent a home or book a service.",
                        )}
                      </p>
                    </div>
                  )}
                </div>
                <div className="lp-story-footer">
                  <button
                    type="button"
                    className="lp-copy-button"
                    onClick={copyExample}
                  >
                    <Copy size={16} aria-hidden="true" />
                    {text("Sao chép nhu cầu mẫu", "Copy example request")}
                  </button>
                  <Link to="/ai">
                    {text("Thử trong không gian AI", "Try in the AI workspace")}
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                </div>
                <p className="lp-copy-status" role="status">
                  {copied === "done"
                    ? text(
                        "Đã sao chép. Dán vào hội thoại và chỉnh theo nhu cầu của bạn; chưa gửi cho AI.",
                        "Copied. Paste into the conversation and adapt it to your needs; nothing has been sent to AI.",
                      )
                    : copied === "unavailable"
                      ? text(
                          "Trình duyệt chưa cho phép sao chép. Chọn bước 01 và sao chép nội dung bằng tay.",
                          "Clipboard access is unavailable. Select step 01 and copy the text manually.",
                        )
                      : text(
                          "Preview không gọi AI, không tìm kiếm hay đặt dịch vụ.",
                          "This preview does not call AI, search or book services.",
                        )}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="next"
          className="landing-section landing-container lp-roommate"
          aria-labelledby="landing-roommate-title"
        >
          <div className="lp-roommate-copy">
            <span className="landing-kicker">
              03 /{" "}
              {text(
                "CHIA SẺ KHÔNG GIAN, KHÔNG ÉP GHÉP ĐÔI",
                "SHARED SPACE, NOT AUTOMATIC MATCHING",
              )}
            </span>
            <h2 id="landing-roommate-title">
              {text("Ở cùng hợp nhu cầu.", "Share a home that works.")}
              <br />
              <em>
                {text(
                  "Bạn tự chọn người đồng hành.",
                  "You choose who to share it with.",
                )}
              </em>
            </h2>
            <p>
              {text(
                "Xem người đang có phòng hoặc muốn cùng tìm chỗ ở. Cân nhắc khu vực, ngân sách và thói quen sinh hoạt; những điều khác biệt cần được trao đổi, không giấu sau một điểm số.",
                "Explore people who have a room or want to find one together. Consider area, budget and daily routines; differences deserve a conversation, not just a score.",
              )}
            </p>
            <ol className="lp-connection-steps">
              <li>
                {text(
                  "Xem hồ sơ & điều kiện",
                  "Review profiles & requirements",
                )}
              </li>
              <li>
                {text("Gửi yêu cầu kết nối", "Send a connection request")}
              </li>
              <li>
                {text("Cả hai đồng ý rồi trao đổi", "Talk when both agree")}
              </li>
            </ol>
            <Link className="landing-inline-cta" to="/roommate">
              {text(
                "Khám phá người đang tìm bạn trọ",
                "Explore people seeking roommates",
              )}
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <div className="lp-profile-preview">
            <span className="lp-eyebrow">
              {text(
                "NHỮNG ĐIỀU NÊN BIẾT TRƯỚC KHI KẾT NỐI",
                "WHAT TO KNOW BEFORE CONNECTING",
              )}
            </span>
            <div className="lp-profile-heading">
              <span className="lp-profile-avatar">
                <UsersRound size={30} aria-hidden="true" />
              </span>
              <div>
                <h3>
                  {text("Hồ sơ tìm người ở cùng", "Roommate discovery profile")}
                </h3>
                <span>
                  {text(
                    "Nhu cầu: có phòng / cùng tìm phòng",
                    "Looking for: a roommate / a home together",
                  )}
                </span>
              </div>
            </div>
            <dl>
              <div>
                <dt>{text("Điều kiện thực tế", "Practical requirements")}</dt>
                <dd>
                  {text(
                    "Khu vực · ngân sách · ngày chuyển vào",
                    "Area · budget · move-in date",
                  )}
                </dd>
              </div>
              <div>
                <dt>{text("Ưu tiên sinh hoạt", "Daily-life preferences")}</dt>
                <dd>
                  {text(
                    "Giờ nghỉ · hút thuốc · thú cưng · không gian riêng",
                    "Quiet hours · smoking · pets · personal space",
                  )}
                </dd>
              </div>
            </dl>
            <div className="lp-profile-caution">
              <MessageCircle size={18} aria-hidden="true" />
              <span>
                {text(
                  "Cần trao đổi: cách chia chi phí và quy tắc sống chung.",
                  "Discuss: shared costs and household expectations.",
                )}
              </span>
            </div>
            <p className="lp-preview-disclaimer">
              {illustration}
              <br />
              {text(
                "Không đại diện cho người thật. Liên hệ chỉ chia sẻ theo sự đồng ý của hai bên.",
                "Not a real person. Contact details are shared with both parties' consent.",
              )}
            </p>
          </div>
        </section>

        <section
          id="landlord"
          className="lp-landlord-section"
          aria-labelledby="landing-landlord-title"
        >
          <div className="landing-container lp-landlord-layout">
            <div className="lp-dashboard-preview">
              <div className="lp-preview-top">
                <span>
                  <Building2 size={18} aria-hidden="true" />
                  {text("Không gian chủ nhà", "Landlord workspace")}
                </span>
                <span>{text("Bản xem trước", "Preview")}</span>
              </div>
              <div className="lp-dashboard-body">
                <div className="lp-dashboard-menu">
                  <span className="active">
                    {text("Nhà & phòng", "Homes & rooms")}
                  </span>
                  <span>{text("Yêu cầu liên hệ", "Contact requests")}</span>
                  <span>{text("Đánh giá", "Reviews")}</span>
                </div>
                <div className="lp-dashboard-table">
                  <div>
                    <House size={19} aria-hidden="true" />
                    <strong>
                      {text("Nhà / phòng của bạn", "Your properties / rooms")}
                    </strong>
                  </div>
                  <div>
                    <span>{text("Tình trạng phòng", "Room availability")}</span>
                    <span className="lp-state">
                      {text("Còn trống / Đã thuê", "Vacant / Rented")}
                    </span>
                  </div>
                  <div>
                    <span>{text("Tin đăng", "Listings")}</span>
                    <span className="lp-state">
                      {text("Bản nháp / Chờ duyệt", "Draft / Pending review")}
                    </span>
                  </div>
                  <div>
                    <span>{text("Yêu cầu liên hệ", "Contact requests")}</span>
                    <span className="lp-state">
                      {text("Mới / Đã hẹn xem", "New / Viewing arranged")}
                    </span>
                  </div>
                  <p>
                    {text(
                      "Tiền thuê, đặt cọc và các khoản phí được khai báo riêng.",
                      "Declare rent, deposits and fees separately.",
                    )}
                  </p>
                </div>
              </div>
              <p className="lp-preview-disclaimer">{illustration}</p>
            </div>
            <div className="lp-landlord-copy">
              <span className="landing-kicker">
                04 / {text("DÀNH CHO CHỦ NHÀ", "FOR LANDLORDS")}
              </span>
              <h2 id="landing-landlord-title">
                {text("Quản lý rõ ràng.", "Clearer management.")}
                <br />
                <em>
                  {text(
                    "Kết nối đáng tin cậy hơn.",
                    "More informed conversations.",
                  )}
                </em>
              </h2>
              <p>
                {text(
                  "Quản lý nhà, phòng và tin đăng trong một không gian. Công khai chi phí, cập nhật trạng thái, xử lý yêu cầu liên hệ và phản hồi đánh giá.",
                  "Manage properties, rooms and listings in one workspace. Publish costs, update availability, handle contact requests and respond to reviews.",
                )}
              </p>
              <p className="lp-scope-note">
                {text(
                  "Tin đăng tuân theo quy trình kiểm duyệt. Đây không phải phần mềm thu tiền thuê hay quản lý hợp đồng tự động.",
                  "Listings follow the moderation workflow. This is not automated rent collection or tenancy-contract management software.",
                )}
              </p>
              <Link className="landing-inline-cta" to="/landlord">
                {text("Mở không gian chủ nhà", "Open landlord workspace")}
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        <section
          id="guide"
          className="landing-section landing-container lp-guides"
          aria-labelledby="landing-guide-title"
        >
          <div className="landing-section-heading">
            <div>
              <span className="landing-kicker">
                05 /{" "}
                {text(
                  "CẨM NANG CHO QUYẾT ĐỊNH CỦA BẠN",
                  "GUIDES FOR YOUR DECISIONS",
                )}
              </span>
              <h2 id="landing-guide-title">
                {text("Biết thêm một chút.", "A little more knowledge.")}
                <br />
                <em>
                  {text("An tâm hơn một bước.", "A more confident next step.")}
                </em>
              </h2>
            </div>
            <div>
              <p>
                {text(
                  "Những bài viết ngắn do ReloHome biên soạn. Đọc trước buổi xem phòng, khi tính ngân sách hoặc trước lúc ký hợp đồng.",
                  "Short guides written by ReloHome. Read before a viewing, when planning your budget or before signing a lease.",
                )}
              </p>
              <Link className="landing-inline-cta" to="/guides">
                {text("Xem tất cả cẩm nang", "Browse all guides")}
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="lp-guide-list">
            {featuredGuides.map((feature) => {
              const guide = guides.find((item) => item.id === feature.id);
              if (!guide) return null;
              return (
                <Link
                  key={guide.id}
                  to={`/guides?article=${guide.id}`}
                  className="lp-guide-link"
                >
                  <span className="lp-icon-tile">
                    <feature.icon size={26} aria-hidden="true" />
                  </span>
                  <div>
                    <span className="lp-guide-meta">
                      {locale === "en"
                        ? "Article in Vietnamese"
                        : guide.category}
                      <span>
                        <Clock3 size={13} aria-hidden="true" />
                        {guide.minutes} {text("phút đọc", "min read")}
                      </span>
                    </span>
                    <h3>{locale === "en" ? feature.en : guide.title}</h3>
                    <p>{locale === "en" ? feature.enSummary : guide.summary}</p>
                  </div>
                  <ArrowUpRight size={20} aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>
        <section
          className="landing-final landing-container"
          aria-labelledby="landing-final-title"
        >
          <div>
            <span className="landing-kicker">ReloHome</span>
            <h2 id="landing-final-title">
              {text(
                "Bắt đầu từ một điều bạn muốn làm.",
                "Start with one thing you want to do.",
              )}
            </h2>
            <p>
              {text(
                "Không cần có sẵn kế hoạch hoàn chỉnh. Cùng AI làm rõ bước tiếp theo.",
                "You don't need a complete plan. Work out the next step with your AI.",
              )}
            </p>
          </div>
          <Link className="landing-primary" to="/ai">
            {text("Trò chuyện với ReloHome", "Talk to ReloHome")}
            <ArrowRight size={19} aria-hidden="true" />
          </Link>
        </section>
      </main>
      <footer className="landing-footer landing-container">
        <span className="landing-footer-brand">
          <strong>ReloHome</strong>
        </span>
        <p>
          {text(
            "Tìm nơi ở. Sắp xếp hành trình. Bắt đầu cuộc sống mới.",
            "Find a home. Plan your journey. Begin your next chapter.",
          )}
        </p>
        <Link to="/roommate">{text("Ghép trọ", "Roommates")}</Link>
        <Link to="/landlord">{text("Chủ nhà", "Landlords")}</Link>
        <Link to="/guides">{text("Cẩm nang", "Guides")}</Link>
        <span>© {new Date().getFullYear()} ReloHome</span>
      </footer>
    </div>
  );
}

// Presentation only: schematic shapes, not geographic coordinates or provider results.
function MapIllustration({ area, label }: { area: boolean; label: string }) {
  return (
    <svg
      className="lp-map-illustration"
      viewBox="0 0 580 280"
      role="img"
      aria-label={label}
    >
      <rect width="580" height="280" fill="var(--lp-map-land)" />
      <g
        fill="var(--lp-map-block)"
        stroke="var(--landing-line)"
        strokeWidth="1"
      >
        <path d="M20 20h110v65H20zM150 20h100v65H150zM285 20h110v65H285zM420 20h140v65H420zM20 115h150v55H20zM200 115h110v55H200zM340 115h90v55H340zM465 115h95v55H465zM20 200h90v60H20zM145 200h130v60H145zM310 200h120v60H310zM465 200h95v60H465z" />
      </g>
      <path
        d="M0 96h580M0 185h580M135 0v280M270 0v280M450 0v280"
        stroke="var(--lp-map-road)"
        strokeWidth="15"
      />
      <path
        d="M-10 265C100 225 145 275 245 220S340 195 430 260S510 230 610 260"
        fill="none"
        stroke="var(--lp-map-water)"
        strokeWidth="22"
      />
      <circle
        cx="290"
        cy="135"
        r="89"
        fill="var(--lp-map-radius)"
        stroke="var(--ui-accent)"
        strokeDasharray="5 5"
      />
      <g
        fill="var(--landing-ink)"
        stroke="var(--landing-surface)"
        strokeWidth="3"
      >
        <circle cx="205" cy="148" r="12" />
        <circle cx="359" cy="79" r="12" />
        <circle cx="389" cy="195" r="12" />
      </g>
      <path
        d="M290 109a14 14 0 0 1 14 14c0 11-14 24-14 24s-14-13-14-24a14 14 0 0 1 14-14"
        fill="#b83c32"
        stroke="var(--landing-surface)"
        strokeWidth="2"
      />
      <circle cx="290" cy="123" r="4" fill="white" />
      {area ? (
        <g
          stroke="var(--ui-accent)"
          fill="var(--landing-surface)"
          strokeWidth="2"
        >
          <rect x="73" y="58" width="24" height="24" rx="6" />
          <path d="M79 71h12m-6-6v12" />
          <rect x="459" y="136" width="24" height="24" rx="6" />
          <path d="M465 143h12v10h-12z" />
          <path d="M97 83L135 96H270V123" fill="none" strokeDasharray="4 4" />
        </g>
      ) : (
        <g
          fill="var(--landing-surface)"
          stroke="var(--landing-ink)"
          strokeWidth="2"
        >
          <path d="M199 148l6-5 6 5v7h-12zM353 79l6-5 6 5v7h-12zM383 195l6-5 6 5v7h-12z" />
        </g>
      )}
    </svg>
  );
}
