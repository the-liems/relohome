import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  House,
  Route,
  ShieldCheck,
  Truck,
  X,
} from "lucide-react";
import { useUiPreferences } from "../uiPreferences";
import {
  hasSeenOnboarding,
  rememberOnboarding,
  tourSteps,
  type TourContext,
  type TourKind,
} from "./content";
import "./onboarding.css";

export const OPEN_ONBOARDING = "relohome:open-onboarding";
type Bounds = { top: number; left: number; width: number; height: number };

export function Onboarding({
  ready,
  eligible,
  context,
  scope,
}: {
  ready: boolean;
  eligible: boolean;
  context: TourContext;
  scope: string;
}) {
  const { locale } = useUiPreferences();
  const text = (vi: string, en: string) => (locale === "en" ? en : vi);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TourKind | null>(null);
  const [index, setIndex] = useState(0);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [cardHeight, setCardHeight] = useState(360);
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousScreen = useRef({ context, scope });
  const autoConsidered = useRef(false);
  const id = useId();
  const steps = useMemo(
    () => (kind ? tourSteps(kind, context) : []),
    [kind, context],
  );
  const step = steps[index];
  function close() {
    setOpen(false);
    setKind(null);
    setIndex(0);
  }

  useEffect(() => {
    // Decide only once after the workspace is ready, not when the user later
    // clears a draft or closes a form. Existing work consumes the invitation too.
    if (!ready || autoConsidered.current) return;
    autoConsidered.current = true;
    if (hasSeenOnboarding()) return;
    rememberOnboarding();
    if (eligible && !document.querySelector("dialog[open]")) setOpen(true);
  }, [ready, eligible]);
  useEffect(() => {
    const replay = () => {
      if (document.querySelector("dialog[open]")) return;
      rememberOnboarding();
      setKind(null);
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_ONBOARDING, replay);
    return () => window.removeEventListener(OPEN_ONBOARDING, replay);
  }, []);
  useEffect(() => {
    if (
      previousScreen.current.context !== context ||
      previousScreen.current.scope !== scope
    )
      close();
    previousScreen.current = { context, scope };
  }, [context, scope]);

  useLayoutEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current;
    const active =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const scrollPositions = [
      ...document.querySelectorAll<HTMLElement>(".ws-list-body, .chat-scroll"),
    ].map((el) => ({ el, top: el.scrollTop, left: el.scrollLeft }));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      scrollPositions.forEach(({ el, top, left }) => {
        if (el.isConnected) {
          el.scrollTop = top;
          el.scrollLeft = left;
        }
      });
      const fallback =
        document.querySelector<HTMLElement>('[data-tour="help"]');
      (active?.isConnected && active !== document.body
        ? active
        : fallback
      )?.focus({ preventScroll: true });
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    heading.current?.focus({ preventScroll: true });
    setBounds(null);
    if (!step) return;
    const target = [
      ...document.querySelectorAll<HTMLElement>(step.target),
    ].find(
      (el) =>
        el.getClientRects().length &&
        getComputedStyle(el).visibility !== "hidden",
    );
    if (!target) return; // Missing/hidden targets remain an explanatory card, never a synthetic click.
    target.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
    const update = () => {
      const rect = target.getBoundingClientRect();
      let top = Math.max(8, rect.top - 6),
        left = Math.max(8, rect.left - 6),
        bottom = Math.min(window.innerHeight - 8, rect.bottom + 6),
        right = Math.min(window.innerWidth - 8, rect.right + 6);
      // Nested form/list scrollports clip their children. Highlight only what is
      // actually visible, not the child's off-screen box through another panel.
      for (
        let parent = target.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const css = getComputedStyle(parent),
          box = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) {
          top = Math.max(top, box.top + parent.clientTop);
          bottom = Math.min(
            bottom,
            box.top + parent.clientTop + parent.clientHeight,
          );
        }
        if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) {
          left = Math.max(left, box.left + parent.clientLeft);
          right = Math.min(
            right,
            box.left + parent.clientLeft + parent.clientWidth,
          );
        }
      }
      setBounds(
        target.isConnected && bottom > top && right > left
          ? { top, left, width: right - left, height: bottom - top }
          : null,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(target);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [open, step]);

  useLayoutEffect(() => {
    if (!open || !card.current) return;
    const observer = new ResizeObserver(() =>
      setCardHeight(card.current?.getBoundingClientRect().height || 360),
    );
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [open]);

  if (!open) return null;
  const mobile = window.innerWidth < 720;
  const cardWidth = Math.min(370, window.innerWidth - 32);
  const beside =
    bounds && bounds.left + bounds.width + cardWidth + 32 < window.innerWidth;
  const style =
    step &&
    mobile &&
    bounds &&
    bounds.top + bounds.height / 2 > window.innerHeight / 2
      ? { top: 16, bottom: "auto" }
      : step && !mobile && bounds
        ? {
            left: beside
              ? bounds.left + bounds.width + 16
              : Math.max(
                  16,
                  Math.min(bounds.left, window.innerWidth - cardWidth - 16),
                ),
            top: Math.max(
              16,
              Math.min(
                window.innerHeight - cardHeight - 16,
                beside
                  ? bounds.top
                  : bounds.top > cardHeight + 32
                    ? bounds.top - cardHeight - 16
                    : bounds.top + bounds.height + 16,
              ),
            ),
          }
        : undefined;
  return createPortal(
    <dialog
      ref={dialog}
      className={"onboarding-dialog" + (step ? " is-tour" : "")}
      aria-modal="true"
      aria-labelledby={id + "-title"}
      aria-describedby={id + "-description"}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...dialog.current!.querySelectorAll<HTMLButtonElement>(
            "button:not([disabled])",
          ),
        ];
        const first = controls[0],
          last = controls.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === heading.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <svg
        className="onboarding-shade"
        aria-hidden="true"
        width="100%"
        height="100%"
      >
        <defs>
          <mask id={id + "-mask"}>
            <rect width="100%" height="100%" fill="white" />
            {step && bounds && (
              <rect
                {...{
                  x: bounds.left,
                  y: bounds.top,
                  width: bounds.width,
                  height: bounds.height,
                }}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(12, 32, 28, .62)"
          mask={`url(#${id}-mask)`}
        />
        {step && bounds && (
          <rect
            x={bounds.left}
            y={bounds.top}
            width={bounds.width}
            height={bounds.height}
            rx="12"
            fill="none"
            stroke="#63e2bb"
            strokeWidth="3"
          />
        )}
      </svg>
      <section
        ref={card}
        className={step ? "onboarding-card" : "onboarding-welcome"}
        style={style}
      >
        {!step && (
          <div className="onboarding-art" aria-hidden="true">
            <House size={42} />
            <span />
            <Route size={34} />
            <span />
            <Truck size={42} />
            <p>ReloHome</p>
          </div>
        )}
        <div className="onboarding-content">
          <button
            type="button"
            className="icon-button onboarding-close"
            aria-label={text("Đóng hướng dẫn", "Close guide")}
            onClick={close}
          >
            <X size={20} />
          </button>
          <p className="onboarding-eyebrow">
            {step
              ? text(
                  `Bước ${index + 1}/${steps.length}`,
                  `Step ${index + 1}/${steps.length}`,
                )
              : text("BẮT ĐẦU NHẸ NHÀNG", "A LITTLE HELP TO GET STARTED")}
          </p>
          <h2 ref={heading} tabIndex={-1} id={id + "-title"}>
            {step
              ? step.title[locale === "en" ? 1 : 0]
              : text("Làm quen với ReloHome", "Get to know ReloHome")}
          </h2>
          <p id={id + "-description"}>
            {step
              ? step.body[locale === "en" ? 1 : 0]
              : context === "other"
                ? text(
                    "Bản hướng dẫn hiện hỗ trợ Tìm nhà và Chuyển đồ. Mở một trong hai màn hình đó, rồi bấm Hướng dẫn để xem đúng thao tác.",
                    "Guided tours currently cover Housing and Moving. Open either workspace, then choose Help for its controls.",
                  )
                : text(
                    "Chọn việc bạn muốn làm. Mình sẽ chỉ đúng chỗ, từng bước ngắn.",
                    "Choose what you want to do. We will show you where to start, one short step at a time.",
                  )}
          </p>
          {!step && (
            <div className="onboarding-choices">
              {(context === "chat" || context === "housing-map") && (
                <button
                  type="button"
                  onClick={() => {
                    setKind("housing");
                    setIndex(0);
                  }}
                >
                  <House size={22} />
                  <span>
                    {text("Tìm nhà", "Find a home")}
                    <small>
                      {text(
                        "Nói nhu cầu · xem bản đồ · chọn căn",
                        "Describe · explore · choose",
                      )}
                    </small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              )}
              {(context === "chat" || context === "moving-form") && (
                <button
                  type="button"
                  onClick={() => {
                    setKind("moving");
                    setIndex(0);
                  }}
                >
                  <Truck size={22} />
                  <span>
                    {text("Chuyển đồ", "Plan a move")}
                    <small>
                      {text(
                        "Chọn A/B · chọn xe · xem báo giá",
                        "Locations · vehicle · quotes",
                      )}
                    </small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              )}
            </div>
          )}
          {!step && (
            <p className="onboarding-safety">
              <ShieldCheck size={18} />
              {text(
                "Không tự gửi tin, lấy báo giá hay thực hiện giao dịch.",
                "No automatic messages, quote requests or transactions.",
              )}
            </p>
          )}
          {step && !bounds && (
            <p className="onboarding-unavailable">
              {text(
                "Mục này chưa hiển thị ở màn hình hiện tại. Bạn có thể xem tiếp hoặc đóng hướng dẫn.",
                "This control is not visible on this screen. You can continue or close the guide.",
              )}
            </p>
          )}
          <div className="onboarding-actions">
            {step ? (
              <>
                <button type="button" className="text-button" onClick={close}>
                  {text("Bỏ qua", "Skip")}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => (index ? setIndex(index - 1) : setKind(null))}
                >
                  <ArrowLeft size={15} />
                  {text("Quay lại", "Back")}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    index + 1 < steps.length ? setIndex(index + 1) : close()
                  }
                >
                  {index + 1 < steps.length
                    ? text("Tiếp", "Next")
                    : text("Tự thử thôi", "Try it myself")}
                  <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <button type="button" className="secondary" onClick={close}>
                {text("Để sau", "Maybe later")}
              </button>
            )}
          </div>
          {!step && (
            <small className="onboarding-replay-note">
              {text(
                "Chỉ tự hiện lần đầu trên trình duyệt này. Mở lại bằng nút ? Hướng dẫn bất cứ lúc nào.",
                "Shown automatically only once in this browser. Reopen anytime with ? Help.",
              )}
            </small>
          )}
        </div>
      </section>
    </dialog>,
    document.body,
  );
}
