import { formatUi, t as uiText } from "./uiPreferences";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useId,
  type ReactNode,
} from "react";
import {
  Link,
  Navigate,
  Route as WebRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  Check,
  CreditCard,
  ChevronRight,
  Compass,
  Heart,
  History,
  House,
  LayoutList,
  LogOut,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Plane,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  UserRound,
  Sparkles,
  Truck,
  X,
  RefreshCw,
  Clock,
  ArrowDown,
  Trash2,
  UsersRound,
  BookOpen,
} from "lucide-react";
import { api, ApiError, dateTime, domainLabels, money, requestId } from "./api";
import { mergePlaceCandidates } from "./placeCandidates";
import { movingQuoteFeedback, MovingQuoteFeedbackError } from "./movingSubmission";
import {
  currentHousingTarget,
  hasSelection,
  nextServiceTarget,
  serviceTargets,
  pendingServiceInput,
  closedResultSummary,
  canSelectServiceResult,
  navigationProgress,
} from "./serviceJourney";
import type {
  Component,
  Data,
  House as HouseData,
  Saved,
  Thread,
  User,
} from "./types";
import { ConfirmDialog, Dialog } from "./components/Dialog";
import { Comparison, HousingCard, HousingDetail } from "./components/Housing";
import { TenantRequests } from "./components/TenantRequests";
import { MAX_COMPARISON_HOMES, toggleComparison } from "./housingInteraction";
import { HousingComparison } from "./components/HousingComparison";
import { Approval, TaskForm } from "./components/Forms";
import { ServiceInputPanel } from "./components/ServiceInputPanel";
import { clarificationServices, guidedReplyText, requestDefaults, type FormService } from "./serviceRequest";
import { Results } from "./components/Results";
import { Receipts, PendingPayment } from "./components/Transactions";
import { TravelerProfileForm } from "./components/Checkout";
import { MapWorkspace } from "./components/MapWorkspace";
import {
  FlightWorkspace,
  MOVING_FIELDS,
  MovingRequestWorkspace,
  MovingWorkspace,
  movingField,
} from "./components/ServiceWorkspaces";
import { filtersFromSearch } from "./mapWorkspace";
import { PlanPeek } from "./components/PlanPeek";
import { RequestHistory } from "./components/RequestHistory";
import { LandingPage } from "./components/LandingPage";
import { AppearanceControls, useUiPreferences } from "./uiPreferences";
import { ContentSkeleton, EmptyState } from "./components/UiStates";
import { TabList } from "./components/TabList";
import { RoommateGuest, RoommateWorkspace } from "./roommate/Workspace";
import { rt as roommateText } from "./roommate/text";
import { GuidesPage } from "./guides/GuidesPage";
import { LandlordWorkspace } from "./landlord/Workspace";

interface AppContext {
  user: User;
  setUser: (u: User) => void;
  status: Data | null;
  threads: Thread[];
  saved: Saved[];
  refresh: () => Promise<void>;
  save: (house: HouseData, thread: string) => Promise<void>;
  notify: (message: string) => void;
  deleteThread: (id: string) => Promise<void>;
  resetThreads: () => Promise<void>;
}
const Context = createContext<AppContext>(null!);
const useApp = () => useContext(Context);
const quick = [
  {
    kind: "property",
    title: "Tìm nhà",
    subtitle: "Một nơi ở phù hợp với bạn",
    icon: House,
    color: "peach",
  },
  {
    kind: "flight",
    title: "Tìm chuyến bay",
    subtitle: "Sẵn sàng cho hành trình mới",
    icon: Plane,
    color: "blue",
  },
  {
    kind: "relocation",
    title: "Chuyển đồ",
    subtitle: "Chuyển đến, nhẹ nhàng hơn",
    icon: Truck,
    color: "purple",
  },
  {
    kind: "map",
    title: "Đường đi",
    subtitle: "Khoảng cách và thời gian di chuyển",
    icon: Compass,
    color: "mint",
  },
] as const;

export default function App() {
  useUiPreferences();
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [status, setStatus] = useState<Data | null>(null),
    [threads, setThreads] = useState<Thread[]>([]),
    [saved, setSaved] = useState<Saved[]>([]),
    [toast, setToast] = useState("");
  const navigate = useNavigate(),
    location = useLocation();
  useEffect(() => {
    api<User>("/session")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  async function refresh() {
    const results = await Promise.allSettled([
      api<Thread[]>("/threads"),
      api<Saved[]>("/saved"),
      api<Data>("/status"),
    ]);
    if (results[0].status === "fulfilled") setThreads(results[0].value);
    if (results[1].status === "fulfilled") setSaved(results[1].value);
    if (results[2].status === "fulfilled") setStatus(results[2].value);
    else setStatus(null);
  }
  useEffect(() => {
    if (user) void refresh();
  }, [user?.id]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function save(house: HouseData, thread: string) {
    try {
      const existing = saved.some((s) => s.id === house.id);
      await api(
        "/saved/" + encodeURIComponent(house.id),
        existing ? "DELETE" : "PUT",
        existing ? undefined : { thread_id: thread },
      );
      if (!existing)
        void api(
          "/housing-management/housing/" + encodeURIComponent(house.id) + "/events",
          "POST",
          { event_type: "save", dedup_key: `save:${user?.id || "session"}:${house.id}` },
        ).catch(() => {});
      setSaved(await api<Saved[]>("/saved"));
      setToast(
        existing ? "Đã bỏ lưu căn nhà." : "Đã lưu vào Tài khoản → Đã lưu.",
      );
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  function forgetDraft(id: string) {
    try {
      sessionStorage.removeItem("siu-draft-" + user?.id + "-" + id);
    } catch {
      // Drafts are a convenience; storage may be unavailable.
    }
  }
  async function deleteThread(id: string) {
    await api("/threads/" + encodeURIComponent(id), "DELETE");
    forgetDraft(id);
    if (location.pathname === "/ai/" + id) navigate("/ai", { replace: true });
    await refresh();
    setToast("Đã xóa cuộc trò chuyện.");
  }
  async function resetThreads() {
    const result = await api<Data>("/threads", "DELETE");
    const kept: Data[] = result.kept || [];
    threads
      .filter((t) => !kept.some((k) => k.id === t.id))
      .forEach((t) => forgetDraft(t.id));
    if (
      location.pathname.startsWith("/ai/") &&
      !kept.some((k) => location.pathname === "/ai/" + k.id)
    )
      navigate("/ai", { replace: true });
    await refresh();
    setToast(
      kept.length
        ? `Đã xóa ${result.deleted} cuộc trò chuyện. Giữ lại ${kept.length}: ${kept[0].detail}`
        : result.memory_forgotten
          ? "Đã xóa toàn bộ trò chuyện và làm mới những gì ReloHome ghi nhớ."
          : "Đã xóa toàn bộ trò chuyện. Chưa làm mới được bộ nhớ của ReloHome, hãy thử lại sau.",
    );
  }
  if (location.pathname === "/")
    return <LandingPage signedIn={Boolean(user)} />;
  if (location.pathname === "/guides" && !user)
    return <GuidesPage standalone />;
  if (loading)
    return (
      <div className="boot">
        <span className="boot-progress" aria-hidden="true" />
        <p role="status">{uiText("Đang mở không gian của bạn…")}</p>
      </div>
    );
  if (
    !user &&
    location.pathname.startsWith("/roommate") &&
    new URLSearchParams(location.search).get("signin") !== "1"
  )
    return <RoommateGuest />;
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          if (location.pathname === "/login")
            navigate(rememberedHome(), { replace: true });
        }}
      />
    );
  return (
    <Context.Provider
      value={{
        user,
        setUser,
        status,
        threads,
        saved,
        refresh,
        save,
        notify: setToast,
        deleteThread,
        resetThreads,
      }}
    >
      <Shell>
        <Routes>
          <WebRoute path="/ai" element={<Chat />} />
          <WebRoute path="/ai/:threadId" element={<Chat />} />
          <WebRoute path="/roommate/*" element={<RoommateWorkspace />} />
          <WebRoute path="/guides" element={<GuidesPage />} />
          <WebRoute path="/landlord" element={<LandlordWorkspace />} />
          <WebRoute
            path="/plans"
            element={<Navigate to="/account" replace />}
          />
          <WebRoute path="/plans/:planId" element={<LegacyPlanRedirect />} />
          <WebRoute
            path="/account"
            element={
              <Account
                onLogout={() => {
                  setUser(null);
                  setThreads([]);
                  setSaved([]);
                  setStatus(null);
                  navigate("/login", { replace: true });
                }}
              />
            }
          />
          <WebRoute
            path="/"
            element={<Navigate to={rememberedHome()} replace />}
          />
          <WebRoute
            path="/login"
            element={<Navigate to={rememberedHome()} replace />}
          />
          <WebRoute
            path="*"
            element={
              <Empty
                headingLevel={1}
                icon={<Compass />}
                title={uiText("Không tìm thấy trang")}
                text={uiText(
                  "Trang này không tồn tại hoặc bạn chưa có quyền truy cập.",
                )}
              >
                <Link className="primary" to="/ai">
                  {uiText("Về Hệ thống AI")}
                </Link>
              </Empty>
            }
          />
        </Routes>
      </Shell>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button
            className="icon-button"
            aria-label={uiText("Đóng thông báo")}
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      onLogin(
        await api<User>(
          "/auth/" + (register ? "register" : "login"),
          "POST",
          f,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <AppearanceControls className="login-appearance" />
      <section className="login-story">
        <Link className="brand" to="/" aria-label={uiText("Trang giới thiệu")}>
          ReloHome
          <span className="brand-dot" />
        </Link>
        <span className="eyebrow">
          {uiText("MỘT KHỞI ĐẦU MỚI, DỄ DÀNG HƠN")}
        </span>
        <h1>
          {uiText("Cuộc sống có nhiều việc.")}
          <br />
          <em>{uiText("Cùng ReloHome, từng bước một.")}</em>
        </h1>
        <p>
          {uiText(
            "Từ tìm một nơi ở, khám phá khu vực đến sắp xếp hành trình. Trợ lý của bạn, trong một cuộc trò chuyện.",
          )}
        </p>
        <div className="login-cities">
          <MapPin size={15} />
          {uiText("Hà Nội ")}
          <span>·</span>
          {uiText(" Đà Nẵng ")}
          <span>·</span> TP.HCM
        </div>
      </section>
      <section className="login-form-wrap">
        <div className="login-form">
          <span className="service-icon purple">
            <MessageCircle size={24} />
          </span>
          <h2>
            {register
              ? uiText("Bắt đầu cùng ReloHome")
              : uiText("Chào bạn quay lại")}
          </h2>
          <p>
            {register
              ? uiText(
                  "Tạo tài khoản để lưu hội thoại và những lựa chọn của bạn.",
                )
              : uiText("Đăng nhập để tiếp tục câu chuyện của bạn.")}
          </p>
          <form onSubmit={submit}>
            {register && (
              <label>
                {uiText("Tên hiển thị")}
                <input
                  name="name"
                  autoComplete="name"
                  placeholder={uiText("Bạn muốn ReloHome gọi là gì?")}
                  required
                  maxLength={80}
                />
              </label>
            )}
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="ban@example.com"
                required
              />
            </label>
            <label>
              {uiText("Mật khẩu")}
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                placeholder={uiText("Ít nhất 10 ký tự")}
                minLength={10}
                maxLength={128}
                required
              />
            </label>
            {error && (
              <p className="notice error" role="alert">
                {uiText(error)}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              {busy
                ? uiText("Đang xử lý…")
                : register
                  ? uiText("Tạo tài khoản")
                  : uiText("Đăng nhập")}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="auth-switch">
            {register
              ? uiText("Đã có tài khoản?")
              : uiText("Lần đầu đến với ReloHome?")}{" "}
            <button
              className="text-button"
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? uiText("Đăng nhập") : uiText("Tạo tài khoản")}
            </button>
          </p>
          <div className="login-foot">
            <ShieldCheck size={16} />
            {uiText("Không gian riêng cho kế hoạch của bạn")}
          </div>
        </div>
      </section>
    </main>
  );
}

// One account, two modes (docs/review/host-mode-design.md §3.1). The mode is a per-device
// convenience only; owner permissions live in the poster profile and property membership.
const MODE_KEY = "relohome.mode";
function rememberedHome() {
  try {
    return localStorage.getItem(MODE_KEY) === "host" ? "/landlord" : "/ai";
  } catch {
    return "/ai";
  }
}

function Shell({ children }: { children: ReactNode }) {
  const { user, status, threads } = useApp(),
    location = useLocation();
  const hostMode = location.pathname.startsWith("/landlord");
  useEffect(() => {
    if (!hostMode && !location.pathname.startsWith("/ai")) return;
    try {
      localStorage.setItem(MODE_KEY, hostMode ? "host" : "renter");
    } catch {
      // Private mode or blocked storage: the next login simply opens chat.
    }
  }, [hostMode, location.pathname]);
  const [history, setHistory] = useState(false),
    [removing, setRemoving] = useState<Thread | null>(null);
  const isChat = location.pathname.startsWith("/ai");
  const active = threads.find((t) => location.pathname === "/ai/" + t.id);
  return (
    <div className="app-shell chat-only-shell">
      <a href="#app-main" className="app-skip">
        {uiText("Đến nội dung chính")}
      </a>
      <div className="main-shell">
        <header className="chat-header">
          {isChat ? (
            <div className="chat-brand">
              <Link
                className="chat-home-link"
                to="/ai"
                aria-label={uiText("Về chat")}
              >
                RH
              </Link>
              <div>
                <p className="chat-title">
                  {active?.title ||
                    uiText("Một cuộc trò chuyện, nhiều điều được giải quyết")}
                </p>
                <p>
                  ReloHome <span>·</span>
                  {uiText(" Cùng bạn sắp xếp cuộc sống")}
                </p>
              </div>
            </div>
          ) : (
            <Link className="brand" to="/ai">
              ReloHome
              <span className="brand-dot" />
            </Link>
          )}
          <div className="header-actions">
            <Link
              className="icon-button outlined header-home"
              to="/"
              aria-label={uiText("Trang giới thiệu")}
              title={uiText("Trang giới thiệu")}
            >
              <House size={18} />
            </Link>
            <AppearanceControls />
            <Link
              className="secondary mode-switch"
              to={hostMode ? "/ai" : "/landlord"}
              aria-label={
                hostMode ? uiText("Chế độ thuê nhà") : uiText("Chế độ chủ nhà")
              }
              title={
                hostMode
                  ? uiText("Chuyển sang chế độ thuê nhà")
                  : uiText("Chuyển sang chế độ chủ nhà")
              }
            >
              <ArrowLeftRight size={16} aria-hidden="true" />
              <span>
                {hostMode ? uiText("Chế độ thuê nhà") : uiText("Chế độ chủ nhà")}
              </span>
            </Link>
            {isChat ? (
              <>
                <span className={"connection " + (status ? "online" : "")}>
                  <i />
                  {status ? uiText("AI đã kết nối") : uiText("Chưa kết nối AI")}
                </span>
                <button
                  className="secondary"
                  aria-label={uiText("Lịch sử")}
                  onClick={() => setHistory(true)}
                >
                  <History size={17} />
                  <span>{uiText("Lịch sử")}</span>
                </button>
                {active && (
                  <button
                    className="icon-button outlined"
                    aria-label={uiText("Xóa cuộc trò chuyện này")}
                    title={uiText("Xóa cuộc trò chuyện này")}
                    onClick={() => setRemoving(active)}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
                <Link
                  className="icon-button outlined"
                  to="/ai"
                  aria-label={uiText("Cuộc trò chuyện mới")}
                >
                  <Plus size={20} />
                </Link>
              </>
            ) : hostMode ? null : (
              <Link
                className="secondary"
                to="/ai"
                aria-label={uiText("Về chat")}
              >
                <MessageCircle size={16} />
                <span>{uiText("Về chat")}</span>
              </Link>
            )}
            <Link
              className="account-chip"
              to="/account"
              aria-label={uiText("Mở tài khoản")}
              title={user.name}
            >
              <span className="avatar account-chip-avatar">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="account-chip-name">
                <strong>{user.name}</strong>
                <small>{uiText("Tài khoản")}</small>
              </span>
            </Link>
          </div>
        </header>
        <main
          id="app-main"
          tabIndex={-1}
          className={isChat ? "page-main chat-main" : "page-main"}
        >
          {children}
        </main>
      </div>
      {history && <HistoryDrawer onClose={() => setHistory(false)} />}
      {removing && (
        <DeleteThreadDialog
          thread={removing}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function DeleteThreadDialog({
  thread,
  onClose,
}: {
  thread: Thread;
  onClose: () => void;
}) {
  const { deleteThread } = useApp();
  return (
    <ConfirmDialog
      title={uiText("Xóa cuộc trò chuyện?")}
      action={uiText("Xóa cuộc trò chuyện")}
      onConfirm={() => deleteThread(thread.id)}
      onClose={onClose}
    >
      <p>
        <strong>{thread.title}</strong>
        {uiText(
          " và những gì ReloHome ghi nhớ từ cuộc trò chuyện này sẽ bị xóa, không khôi phục được.",
        )}
      </p>
      <p className="muted small">
        {uiText(
          "Đơn đã đặt không bị hủy. Nhà đã lưu vẫn ở Tài khoản → Đã lưu.",
        )}
      </p>
    </ConfirmDialog>
  );
}

function ResetThreadsDialog({ onClose }: { onClose: () => void }) {
  const { resetThreads } = useApp();
  return (
    <ConfirmDialog
      title={uiText("Xóa tất cả và làm mới ReloHome?")}
      action={uiText("Xóa tất cả")}
      onConfirm={resetThreads}
      onClose={onClose}
    >
      <p>
        {uiText(
          "Mọi cuộc trò chuyện sẽ bị xóa và ReloHome quên các sở thích đã ghi nhớ từ trò chuyện. Bạn bắt đầu lại từ đầu.",
        )}
      </p>
      <p className="muted small">
        {uiText(
          'Hồ sơ, "Sở thích AI" và nhà đã lưu được giữ. Đơn đã đặt không bị hủy; cuộc trò chuyện đang chờ thanh toán sẽ được giữ lại.',
        )}
      </p>
    </ConfirmDialog>
  );
}

function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const { threads } = useApp();
  const [query, setQuery] = useState(""),
    [removing, setRemoving] = useState<Thread | null>(null),
    [resetting, setResetting] = useState(false);
  if (removing)
    return (
      <DeleteThreadDialog thread={removing} onClose={() => setRemoving(null)} />
    );
  if (resetting)
    return <ResetThreadsDialog onClose={() => setResetting(false)} />;
  return (
    <Dialog title={uiText("Cuộc trò chuyện của bạn")} onClose={onClose}>
      <div className="search-row">
        <Search size={17} />
        <input
          aria-label={uiText("Tìm theo tiêu đề…")}
          placeholder={uiText("Tìm theo tiêu đề…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <Link className="primary full" to="/ai" onClick={onClose}>
        <Plus size={17} />
        {uiText("Cuộc trò chuyện mới")}
      </Link>
      <div className="history-list">
        {threads
          .filter((t) =>
            t.title
              .toLocaleLowerCase("vi")
              .includes(query.toLocaleLowerCase("vi")),
          )
          .map((t) => (
            <div className="history-item" key={t.id}>
              <Link to={"/ai/" + t.id} onClick={onClose}>
                <MessageCircle size={19} />
                <span>
                  <strong>{t.title}</strong>
                  <small>{dateTime(t.updated)}</small>
                </span>
                <ChevronRight size={16} />
              </Link>
              <button
                className="icon-button"
                aria-label={uiText("Xóa cuộc trò chuyện ") + t.title}
                title={uiText("Xóa cuộc trò chuyện")}
                onClick={() => setRemoving(t)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
      </div>
      {threads.length > 0 &&
        !threads.some((t) =>
          t.title
            .toLocaleLowerCase("vi")
            .includes(query.toLocaleLowerCase("vi")),
        ) && (
          <EmptyState
            icon={<Search size={24} />}
            title={uiText("Không có yêu cầu phù hợp")}
            text={uiText("Thử đổi từ khóa hoặc trạng thái lọc.")}
          />
        )}
      {threads.length ? (
        <button
          className="text-button danger"
          onClick={() => setResetting(true)}
        >
          <Trash2 size={14} />
          {uiText(" Xóa tất cả và làm mới ReloHome")}
        </button>
      ) : (
        <p className="muted">
          {uiText("Cuộc trò chuyện đầu tiên của bạn sẽ xuất hiện ở đây.")}
        </p>
      )}
    </Dialog>
  );
}

function Chat() {
  const { threadId } = useParams(),
    [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    { user, status, saved, refresh, save, notify } = useApp();
  const [thread, setThread] = useState<Thread | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState(
      () =>
        sessionStorage.getItem(
          "siu-draft-" + user.id + "-" + (threadId || "new"),
        ) || "",
    ),
    [form, setForm] = useState<FormService | null>(null),
    [context, setContext] = useState<HouseData | null>(null),
    [newMessage, setNewMessage] = useState(false),
    [workspace, setWorkspace] = useState<string | null>(null);
  const [movingSubmission, setMovingSubmission] = useState<{
    threadId?: string;
    formKey: string;
  } | null>(null);
  const [workspaceTaskId, setWorkspaceTaskId] = useState<string | null>(null);
  const reviewedServices = useRef(new Set<string>());
  const manualWorkspaceReply = useRef<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    nearBottom = useRef(true),
    inFlight = useRef(false),
    generation = useRef(0),
    currentThread = useRef(threadId);
  currentThread.current = threadId;
  useEffect(() => {
    const version = ++generation.current;
    setError("");
    setContext(null);
    if (!inFlight.current) setForm(null);
    setWorkspaceTaskId(null);
    reviewedServices.current.clear();
    setDraft(
      sessionStorage.getItem(
        "siu-draft-" + user.id + "-" + (threadId || "new"),
      ) || "",
    );
    if (!threadId) {
      setThread(null);
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    api<Thread>("/threads/" + threadId, "GET", undefined, abort.signal)
      .then((t) => {
        if (version === generation.current && !inFlight.current) setThread(t);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (version === generation.current) setLoading(false);
      });
    return () => abort.abort();
  }, [threadId, user.id]);
  useEffect(() => {
    sessionStorage.setItem(
      "siu-draft-" + user.id + "-" + (threadId || "new"),
      draft,
    );
  }, [draft, threadId, user.id]);
  useEffect(() => {
    if (!thread?.messages?.length) return;
    if (nearBottom.current) {
      scroll.current?.scrollTo({
        top: scroll.current.scrollHeight,
        behavior: "smooth",
      });
    } else setNewMessage(true);
  }, [thread?.messages?.length, busy]);
  async function reload() {
    if (threadId) {
      setThread(await api<Thread>("/threads/" + threadId));
      void refresh().catch(() => {});
    }
  }
  async function send(text: string, extra: Data = {}) {
    const quoteForm = extra.moving_quote_form;
    if (inFlight.current) {
      if (quoteForm) throw new Error(uiText("Hội thoại đang xử lý. Hãy chờ kết quả."));
      return;
    }
    if (!text.trim()) return;
    const formKey = movingSubmission?.formKey || lastAssistant?.id || "new";
    if (quoteForm) {
      setMovingSubmission({ threadId, formKey });
      setWorkspace("relocation-form");
    } else setMovingSubmission(null);
    inFlight.current = true;
    setBusy(true);
    setError("");
    const message = context
      ? `Về căn nhà ${context.title} (ID: ${context.id}): ${text}`
      : text;
    let id = threadId;
    try {
      if (!id) {
        const created = await api<Thread>("/threads", "POST");
        id = created.id;
        if (quoteForm) setMovingSubmission({ threadId: id, formKey });
        setThread(created);
        navigate("/ai/" + id, { replace: true });
        currentThread.current = id;
      }
      sessionStorage.removeItem(
        "siu-draft-" + user.id + "-" + (threadId || "new"),
      );
      setDraft("");
      setContext(null);
      setThread((t) =>
        t
          ? {
              ...t,
              messages: [
                ...(t.messages || []),
                {
                  id: "optimistic",
                  role: "user",
                  created: Date.now() / 1000,
                  content: { status: "done", text: message },
                },
              ],
            }
          : t,
      );
      const updated = await api<Thread>(
        "/threads/" + id + (quoteForm ? "/moving/quote" : "/chat"),
        "POST",
        quoteForm
          ? {
              request_id: requestId(),
              ...quoteForm,
              plan_version: thread?.state?.plan?.version || 0,
            }
          : { request_id: requestId(), message, ...extra },
      );
      if (currentThread.current === id) {
        setThread(updated);
        if (quoteForm) {
          const feedback = movingQuoteFeedback(updated);
          if (feedback) throw new MovingQuoteFeedbackError(feedback);
          setMovingSubmission(null);
          setWorkspace("relocation");
          // A clarification/error keeps the same mounted form and its confirmed pins.
        }
      }
      // The updated thread is authoritative; sidebar refresh is not part of quote latency.
      void refresh().catch(() => {});
    } catch (e) {
      setError((e as Error).message);
      // An accepted graph reply is already authoritative. Do not reload it or
      // copy a form action into the chat draft just because it needs clarification.
      if (!(e instanceof MovingQuoteFeedbackError)) setDraft(text);
      if (!(e instanceof MovingQuoteFeedbackError) && id && currentThread.current === id) {
        try {
          setThread(await api<Thread>("/threads/" + id));
        } catch {}
      }
      throw e;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function mutate(path: string, body: Data) {
    if (!threadId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await api<Thread>(
        "/threads/" + threadId + "/" + path,
        "POST",
        { request_id: requestId(), ...body },
      );
      if (path === "action" && body.kind === "select") {
        manualWorkspaceReply.current =
          [...next.messages].reverse().find((m) => m.role === "assistant")
            ?.id || null;
      }
      if (currentThread.current === threadId) setThread(next);
      void refresh().catch(() => {});
      return next;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function openHouse(h: HouseData, c: Component, version: number) {
    setParams({
      panel: "house",
      house: h.id,
      task: c.task_id,
      result: c.id,
      version: String(version),
    });
  }
  const facts = thread?.state?.intake?.user_confirmed_facts || {},
    savedIds = new Set(saved.map((s) => s.id)),
    pending = thread?.state?.pending;
  // Several homes chosen for viewing; the plan home stays `selected:property` (set when deciding).
  const viewing = thread?.state?.viewing;
  const viewingItems: Data[] = viewing?.items || [];
  const viewingIds = viewingItems.map((i) => i.listing_id);
  const undecidedHomes = viewingItems
    .filter((i) => !["agreed", "reported_paid"].includes(i.status))
    .map((i) => ({ listing_id: i.listing_id, ...i.snapshot }));
  function openViewings() {
    setWorkspace(null);
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("panel", "plan");
      next.set("planTab", "viewing");
      return next;
    });
  }
  async function movingDestination(index: number, count: number) {
    // Contract with respond.moving_destination_question: the last option is "quote to an
    // address now"; with two options the first is "wait until a home is decided".
    if (count === 2 && index === 0) {
      await api("/threads/" + threadId + "/viewings/moving-mode", "POST", {
        mode: "wait_for_home",
      });
      await reload();
      notify("Chuyển đồ sẽ chờ bạn chốt nhà.");
      return;
    }
    if (thread?.state?.viewing?.moving_mode)
      await api("/threads/" + threadId + "/viewings/moving-mode", "POST", {
        mode: null,
      });
    setWorkspace("relocation-form");
  }
  const allComponents = (thread?.messages || []).flatMap((m) =>
    (m.content.ui?.components || []).map((c) => ({
      c,
      version: m.content.ui?.plan_version || 0,
    })),
  );
  const selectedId = facts["selected:property"]?.value;
  // A home chosen on the map may not be in any chat message; the cost summary still names it.
  const costLine = (thread?.state?.cost_summary?.lines || []).find(
    (l: Data) =>
      thread?.state?.cost_summary?.selected?.[l.task_id] === selectedId,
  );
  const selectedHouseInState =
    (thread?.state?.selections?.property?.id === selectedId
      ? (thread?.state?.selections?.property as HouseData)
      : undefined) ||
    allComponents
      .flatMap(({ c }) => c.data?.candidates || [])
      .find((h) => h.id === selectedId) ||
    (selectedId && costLine
      ? ({ id: selectedId, title: costLine.label } as HouseData)
      : undefined);
  // Map choices can outlive result cards and selection snapshots. Resolve the persisted ID
  // through the existing read-only detail endpoint; never substitute another candidate.
  const [resolvedHome, setResolvedHome] = useState<{
    threadId: string;
    house: HouseData;
  } | null>(null);
  const [homeIssue, setHomeIssue] = useState("");
  const needsHomeDetail = Boolean(
    selectedId &&
    (!selectedHouseInState?.address ||
      !Number.isFinite(selectedHouseInState.lat) ||
      !Number.isFinite(selectedHouseInState.lng)),
  );
  useEffect(() => {
    setHomeIssue("");
    if (!threadId || !selectedId || !needsHomeDetail) return;
    const abort = new AbortController();
    api<HouseData>(
      "/housing/" + encodeURIComponent(selectedId),
      "GET",
      undefined,
      abort.signal,
    )
      .then((house) => {
        if (house?.id !== selectedId)
          throw new Error("Không tìm thấy căn đã chọn.");
        if (!abort.signal.aborted) setResolvedHome({ threadId, house });
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setHomeIssue(
            "Chưa đọc được địa chỉ căn đã chọn. Bạn có thể nhập điểm B hoặc tải lại trang để thử lại.",
          );
      });
    return () => abort.abort();
  }, [threadId, selectedId, needsHomeDetail]);
  const fetchedHome =
    resolvedHome &&
    resolvedHome.threadId === threadId &&
    resolvedHome.house.id === selectedId
      ? resolvedHome.house
      : undefined;
  const selectedHouse = fetchedHome || selectedHouseInState;
  const opened = [...allComponents]
    .reverse()
    .find(
      ({ c, version }) =>
        (!params.get("task") || c.task_id === params.get("task")) &&
        (!params.get("result") || c.id === params.get("result")) &&
        (!params.get("version") || version === Number(params.get("version"))) &&
        c.data?.candidates?.some(
          (h: HouseData) => h.id === params.get("house"),
        ),
    );
  // A home saved while exploring the map may be absent from the agent's result cards.
  const openDetail = (opened?.c.data.candidates.find(
    (h: HouseData) => h.id === params.get("house"),
  ) ||
    saved.find((s) => s.id === params.get("house") && s.thread_id === threadId)
      ?.house) as HouseData | undefined;
  const unavailable = (kind: string) => !status?.domains?.includes(kind);
  const journey = serviceTargets(thread);
  const navigation = navigationProgress(thread);
  const activeTarget = journey.find((t) => t.c.task_id === workspaceTaskId);
  // Each service result opens its own workspace (map for housing, flights, moving quotes).
  // Choosing an option there returns to the chat so the user can continue with other services.
  const latestOf = (type: string, field: string) =>
    [...allComponents]
      .reverse()
      .find(({ c }) => c.type === type && (c.data?.[field] || []).length > 0);
  const latestProperty = currentHousingTarget(thread, workspaceTaskId);
  const latestFlight =
      (activeTarget?.c.type === "flight" ? activeTarget : undefined) ||
      latestOf("flight", "offers"),
    // Once an order exists the quotes are history; tracking stays in the chat card.
    latestMoving = [
      (activeTarget?.c.type === "relocation" ? activeTarget : undefined) ||
        latestOf("relocation", "quotes"),
    ].find((x) => x && !x.c.data?.order);
  const latestService = nextServiceTarget(thread, reviewedServices.current);
  const lastAssistant = [...(thread?.messages || [])]
    .reverse()
    .find((m) => m.role === "assistant");
  const inputServices = clarificationServices(thread);
  async function sendForm(text: string) {
    if (inFlight.current) throw new Error(uiText("Hội thoại đang xử lý. Hãy chờ kết quả."));
    if (!status) throw new Error(uiText("Chưa kết nối được AI."));
    await send(text);
  }
  // A moving question (pickup, destination, date, time) opens the moving form instead of a
  // plain chat question; what the user already said prefills it.
  const movingQuestions = (
    lastAssistant?.content.response?.questions || []
  ).filter((q: Data) =>
    (MOVING_FIELDS as readonly string[]).includes(movingField(q.field)),
  );
  const movingKnown: Data = {
    ...((thread?.state?.progress?.items || []).find(
      (i: Data) => i.agent === "relocation" && i.state === "waiting",
    )?.inputs || {}),
    ...Object.fromEntries(
      ["moving_options", "pickup_coordinate", "destination_coordinate"]
        .filter(
          (k) => thread?.state?.intake?.constraints?.values?.[k] !== undefined,
        )
        .map((k) => [k, thread!.state.intake.constraints.values[k]]),
    ),
    ...Object.fromEntries(
      MOVING_FIELDS.filter((k) => facts[k]?.value).map((k) => [
        k,
        facts[k].value,
      ]),
    ),
    ...(lastAssistant?.content.response?.data?.known_request || {}),
  };
  // Results produced in this turn. A reply repeats earlier results (e.g. the home list while
  // answering about moving); only a fresh result reopens its workspace or replaces the chat text.
  const earlierIds = new Set(
    (thread?.messages || [])
      .filter((m) => m.role === "assistant" && m.id !== lastAssistant?.id)
      .flatMap((m) =>
        (m.content.ui?.components || []).map((c: Component) => c.id),
      ),
  );
  const lastHasService = (lastAssistant?.content.ui?.components || []).some(
    (c: Component) => c.id === latestService?.c.id && !earlierIds.has(c.id),
  );
  const lastHasComparison = (lastAssistant?.content.ui?.components || []).some(
    (c: Component) => !!c.data?.comparison,
  );
  // The newest message decides: a confirmation request, a service result, or plain chat.
  useEffect(() => {
    if (manualWorkspaceReply.current === lastAssistant?.id) return;
    if (movingSubmission) {
      if (
        threadId === movingSubmission.threadId ||
        (inFlight.current && !threadId)
      )
        return;
      // Explicit navigation to another conversation must not retain this form.
      setMovingSubmission(null);
    }
    setWorkspace(
      lastHasService && !latestService?.c.data?.comparison
        ? (latestService?.c.type ?? null)
        : movingQuestions.length ||
            (!lastHasComparison && pendingServiceInput(thread, "relocation"))
          ? "relocation-form"
          : null,
    );
    setWorkspaceTaskId(
      lastHasService ? latestService?.c.task_id || null : null,
    );
    // Only a new server reply or navigation auto-opens a workspace. A local
    // submit/exit state change must not override the user's explicit workspace choice.
  }, [lastAssistant?.id, threadId]);
  const chatDock = {
    text: lastAssistant?.content.response?.text,
    fromResult: lastHasService,
    kind: lastAssistant?.content.response?.kind,
    questions: lastAssistant?.content.response?.questions || [],
    suggestions: lastAssistant?.content.response?.suggestions || [],
    busy,
    error,
    online: !!status,
    onSend: (text: string, extra?: Data) => send(text, extra),
  };
  async function selectIn(
    target: { c: Component; version: number },
    id: string,
    message: string,
  ) {
    const next = await mutate("action", {
      kind: "select",
      task_id: target.c.task_id,
      plan_version: target.version,
      fetched_at: target.c.fetched_at,
      entity_id: id,
    });
    notify(message);
    // Viewing mode: keep the map open so several homes can be chosen; "done" moves on.
    if (viewing && target.c.type === "property") return;
    advanceAfter(target, next);
  }
  function advanceAfter(
    target: { c: Component; version: number },
    next?: Thread | void,
  ) {
    reviewedServices.current.add(target.c.id);
    const remaining = nextServiceTarget(
      next || thread,
      reviewedServices.current,
    );
    setWorkspaceTaskId(remaining?.c.task_id || null);
    const nextAssistant = [...(next?.messages || thread?.messages || [])]
      .reverse()
      .find((m) => m.role === "assistant");
    const hasMovingInput = (
      nextAssistant?.content.response?.questions || []
    ).some((q: Data) =>
      (MOVING_FIELDS as readonly string[]).includes(movingField(q.field)),
    );
    setWorkspace(
      remaining?.c.type ||
        (hasMovingInput || pendingServiceInput(next || thread, "relocation")
          ? "relocation-form"
          : null),
    );
  }
  function openService(taskId: string, agent: string) {
    if (agent === "roommate") {
      navigate("/roommate");
      return;
    }
    const target = journey.find((t) => t.c.task_id === taskId);
    if (target) {
      setWorkspaceTaskId(taskId);
      setWorkspace(target.c.type);
    } else if (agent === "relocation") {
      setWorkspaceTaskId(taskId);
      setWorkspace("relocation-form");
    } else if (["property", "flight", "map"].includes(agent)) {
      setWorkspace(null);
      setForm(agent as FormService);
    } else {
      setWorkspace(null);
      notify(
        "Dịch vụ này chưa có kết quả. Bạn có thể bổ sung thông tin trong chat.",
      );
    }
  }
  function finishWorkspace() {
    const target = activeTarget || journey.find((t) => t.c.type === workspace);
    if (target) reviewedServices.current.add(target.c.id);
    // Back means chat. Automatic next-service navigation belongs to selection.
    setWorkspaceTaskId(null);
    setWorkspace(null);
  }
  // Selected services the app can take payment for and that are not finished yet (payment-design §7).
  const payable = thread?.state?.checkout
    ? ["flight", "relocation"].filter(
        (d) =>
          facts["selected:" + d] &&
          !(thread.state.checkout.transactions || []).some(
            (t: Data) =>
              t.domain === d &&
              t.option_id === facts["selected:" + d].value &&
              ["ticketed", "approved"].includes(t.status),
          ),
      )
    : [];
  function openCheckout() {
    setWorkspace(null);
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("panel", "plan");
      next.set("planTab", "checkout");
      return next;
    });
  }
  function choosePlace(choice: Data, field: string) {
    const place =
      choice.entity_type === "place" &&
      ["near", "route_from", "route_to"].includes(field);
    return send(
      "Chọn " + choice.label,
      place ? { place_choice: { field, place_id: choice.id } } : {},
    );
  }
  return (
    <div className={"chat-page" + (workspace ? " map-mode" : "")}>
      {thread?.messages?.length ? (
        <h1 className="sr-only">{thread.title}</h1>
      ) : null}
      <PlanPeek
        key={threadId || "new"}
        progress={navigation}
        threadId={thread?.id}
        thread={thread}
        writesEnabled={!!status?.writes_enabled}
        onDecision={(body) => mutate("decision", body).then(() => {})}
        onPaymentCheck={() => mutate("payment/check", {}).then(() => {})}
        onCheckoutChanged={reload}
        onMovingForm={() => setWorkspace("relocation-form")}
        house={selectedHouse}
        busy={busy}
        onOpenService={openService}
      />
      {(navigation.items || []).length > 1 && (
        <nav
          className="service-journey"
          aria-label={uiText("Dịch vụ trong kế hoạch")}
        >
          {(navigation.items || []).map((item: Data) => (
            <button
              key={item.task_id}
              className={workspaceTaskId === item.task_id ? "active" : ""}
              disabled={busy}
              aria-current={
                workspaceTaskId === item.task_id ? "step" : undefined
              }
              onClick={() => openService(item.task_id, item.agent)}
            >
              {item.chosen && <Check size={14} />}
              {uiText(domainLabels[item.agent] || item.agent)}
              {!journey.some((t) => t.c.task_id === item.task_id) && (
                <small>{uiText("Chờ thông tin/kết quả")}</small>
              )}
            </button>
          ))}
        </nav>
      )}
      {workspace === "relocation-form" ? (
        <MovingRequestWorkspace
          key={movingSubmission?.formKey || lastAssistant?.id || "new"}
          questions={movingQuestions}
          known={movingKnown}
          house={selectedHouse}
          homeLoading={needsHomeDetail && !fetchedHome && !homeIssue}
          homeIssue={homeIssue}
          suggestedHomes={selectedHouse ? [] : undecidedHomes}
          // Next-step suggestions would only repeat this form; the dock keeps the question.
          chat={{
            ...chatDock,
            fromResult: movingQuestions.length > 0,
            suggestions: [],
          }}
          onConfirm={(text, extra) => send(text, extra)}
          onExit={() => {
            setMovingSubmission(null);
            setWorkspace(null);
          }}
        />
      ) : workspace === "flight" && latestFlight ? (
        <FlightWorkspace
          readOnly={
            !thread?.state.plan?.tasks?.some(
              (t: Data) => t.id === latestFlight.c.task_id,
            )
          }
          key={latestFlight.c.id}
          data={latestFlight.c.data}
          selectedId={facts["selected:flight"]?.value}
          chat={chatDock}
          onSelect={(id) =>
            selectIn(latestFlight, id, "Đã chọn chuyến bay vào kế hoạch.")
          }
          onOutbound={(id) =>
            mutate("flight/outbound", {
              task_id: latestFlight.c.task_id,
              plan_version: latestFlight.version,
              fetched_at: latestFlight.c.fetched_at,
              offer_id: id,
            }).then(() => {})
          }
          onPay={thread?.state?.checkout ? openCheckout : undefined}
          onEdit={() => setForm("flight")}
          onExit={finishWorkspace}
        />
      ) : workspace === "relocation" && latestMoving ? (
        <MovingWorkspace
          readOnly={
            !thread?.state.plan?.tasks?.some(
              (t: Data) => t.id === latestMoving.c.task_id,
            )
          }
          key={latestMoving.c.id}
          data={latestMoving.c.data}
          selectedId={facts["selected:relocation"]?.value}
          chat={chatDock}
          onEdit={() => setWorkspace("relocation-form")}
          onPay={thread?.state?.checkout ? openCheckout : undefined}
          onSelect={(id) =>
            selectIn(
              latestMoving,
              id,
              "Đã chọn phương án chuyển đồ. Nhắn yêu cầu đặt khi bạn sẵn sàng.",
            )
          }
          onExit={finishWorkspace}
        />
      ) : workspace === "map" && activeTarget ? (
        <section className="service-map-result" key={activeTarget.c.id}>
          <button className="secondary" onClick={finishWorkspace}>
            {uiText("Tiếp tục kế hoạch")}
          </button>
          <Results
            payload={{
              status: "done",
              ui: {
                version: 1,
                plan_version: activeTarget.version,
                components: [activeTarget.c],
              },
            }}
            selected={facts}
            saved={savedIds}
            busy={busy}
            writes={!!status?.writes_enabled}
            onOpen={openHouse}
            onSave={(h) => void save(h, thread!.id)}
            onAction={(c, v, kind, id) =>
              mutate("action", {
                kind,
                task_id: c.task_id,
                plan_version: v,
                fetched_at: c.fetched_at,
                entity_id: id,
              }).then(() => {})
            }
            onPrompt={setDraft}
            onFilter={() => setForm("property")}
          />
        </section>
      ) : workspace === "property" && latestProperty ? (
        <MapWorkspace
          readOnly={!canSelectServiceResult(thread, latestProperty)}
          focus={{
            key: latestProperty.c.id,
            viewport: latestProperty.c.data?.map_context?.viewport,
            searchScope: latestProperty.c.data?.map_context?.search_scope,
          }}
          initialFilters={filtersFromSearch(
            latestProperty.c.data?.search_request,
          )}
          areaName={latestProperty.c.data?.area_name}
          saved={savedIds}
          selectedId={facts["selected:property"]?.value}
          selectedIds={viewing ? viewingIds : undefined}
          selectionLimit={viewing?.max_selected}
          onUnselect={
            viewing
              ? async (h) => {
                  await api(
                    "/threads/" + threadId + "/viewings/unselect",
                    "POST",
                    { listing_id: h.id },
                  );
                  await reload();
                }
              : undefined
          }
          onSelectionDone={
            viewing
              ? () => {
                  // Close the map and go straight to booking viewings.
                  reviewedServices.current.add(latestProperty.c.id);
                  openViewings();
                }
              : undefined
          }
          chat={chatDock}
          onSave={(h) => void save(h, thread!.id)}
          onSelect={(h) =>
            selectIn(
              latestProperty,
              h.id,
              viewing
                ? "Đã chọn căn để hẹn xem. Hẹn lịch trong Kế hoạch → Xem nhà."
                : "Đã chọn căn nhà. Bạn có thể tiếp tục với chuyển đồ hoặc dịch vụ khác.",
            )
          }
          onExit={() => setWorkspace(null)}
        />
      ) : (
        <>
          <div
            className="conversation-scroll"
            ref={scroll}
            onScroll={() => {
              const el = scroll.current!;
              nearBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 130;
              if (nearBottom.current) setNewMessage(false);
            }}
          >
            {loading && (
              <ContentSkeleton label={uiText("Đang tải hội thoại…")} rows={2} />
            )}
            {!loading && !thread?.messages?.length && (
              <section className="welcome">
                <div className="welcome-heading">
                  <span className="welcome-icon">
                    <Sparkles size={22} />
                  </span>
                  <span className="eyebrow">
                    {uiText("CHÀO ")}
                    {user.name.toLocaleUpperCase("vi")}
                  </span>
                </div>
                <h1>
                  <span className="welcome-title-lead">
                    {uiText("Bạn đang ấp ủ")}
                  </span>{" "}
                  <span>{uiText("kế hoạch gì hôm nay?")}</span>
                </h1>
                <p>
                  {uiText(
                    "Tìm một nơi ở mới, chuẩn bị chuyến đi, hay khám phá khu vực.",
                  )}
                  <br className="desktop-only" />
                  {uiText(" Kể ReloHome nghe, mình sẽ cùng bạn bắt đầu.")}
                </p>
                <p className="welcome-service-help">{uiText("Chọn dịch vụ để điền nhanh, hoặc nhắn yêu cầu của bạn ở bên dưới.")}</p>
                <div
                  className="quick-grid"
                  role="group"
                  aria-label={roommateText(
                    "Chức năng ReloHome",
                    "ReloHome services",
                  )}
                >
                  {quick.map((q) => (
                    <button
                      className="quick-card"
                      aria-label={`${uiText(q.title)} ${uiText(q.subtitle)}`}
                      key={q.kind}
                      aria-haspopup={q.kind === "relocation" ? undefined : "dialog"}
                      onClick={() =>
                        q.kind === "relocation"
                          ? setWorkspace("relocation-form")
                          : setForm(q.kind)
                      }
                      disabled={unavailable(q.kind)}
                      title={
                        unavailable(q.kind)
                          ? uiText("Dịch vụ chưa được kết nối")
                          : uiText(q.title)
                      }
                    >
                      <span className={"service-icon " + q.color}>
                        <q.icon size={24} />
                      </span>
                      <strong>{uiText(q.title)}</strong>
                      <span>{uiText(q.subtitle)}</span>
                      <ArrowUpRight size={17} className="quick-arrow" />
                    </button>
                  ))}
                  <Link
                    className="quick-card"
                    to="/roommate"
                    aria-label={roommateText("Ở ghép", "Roommates")}
                  >
                    <span className="service-icon mint">
                      <UsersRound size={24} aria-hidden="true" />
                    </span>
                    <strong>{roommateText("Ở ghép", "Roommates")}</strong>
                    <span>
                      {roommateText(
                        "Tìm người cùng chia sẻ chỗ ở",
                        "Find someone to share a home",
                      )}
                    </span>
                    <ArrowUpRight
                      size={17}
                      className="quick-arrow"
                      aria-hidden="true"
                    />
                  </Link>
                  <Link
                    className="quick-card"
                    to="/guides"
                    aria-label={roommateText("Cẩm nang", "Guides")}
                  >
                    <span className="service-icon mint">
                      <BookOpen size={24} aria-hidden="true" />
                    </span>
                    <strong>{roommateText("Cẩm nang", "Guides")}</strong>
                    <span>
                      {roommateText(
                        "Kinh nghiệm thuê nhà và sống chung",
                        "Tips for renting and living together",
                      )}
                    </span>
                    <ArrowUpRight
                      size={17}
                      className="quick-arrow"
                      aria-hidden="true"
                    />
                  </Link>
                </div>
                <div className="starter">
                  <span className="muted small">
                    {uiText("THỬ BẮT ĐẦU VỚI")}
                  </span>
                  <button
                    onClick={() => {
                      setDraft(
                        "Tìm phòng ở Hà Nội dưới 5 triệu đồng mỗi tháng",
                      );
                      input.current?.focus();
                    }}
                  >
                    {uiText("“Tìm phòng ở Hà Nội dưới 5 triệu/tháng”")}
                    <ArrowRight size={16} />
                  </button>
                  <button
                    onClick={() => {
                      setDraft("Tôi muốn tìm nhà và báo giá chuyển đồ tới đó");
                      input.current?.focus();
                    }}
                  >
                    {uiText("“Tôi muốn tìm nhà và chuyển đồ tới đó”")}
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="welcome-note">
                  <ShieldCheck size={15} />
                  {uiText("Bạn luôn là người xác nhận trước mỗi giao dịch.")}
                </div>
                {Object.values(user.preferences).some(Boolean) && (
                  <button
                    className="text-button"
                    onClick={() => {
                      const p = user.preferences;
                      setDraft(
                        `Tìm ${p.room_type || "nhà cho thuê"}${p.city ? " tại " + p.city : ""}${p.budget ? ", ngân sách tối đa " + p.budget + " đồng/tháng" : ""}${p.amenities ? ", ưu tiên " + p.amenities : ""}${p.transport ? ", tôi đi " + p.transport : ""}.`,
                      );
                      input.current?.focus();
                    }}
                  >
                    {uiText("Dùng sở thích đã lưu cho lần tìm này")}
                  </button>
                )}
              </section>
            )}
            {(thread?.messages || []).map((m) => (
              <article
                className={"message " + m.role}
                key={m.id}
                id={"message-" + m.id}
              >
                <div className="message-content">
                  {m.role === "user" ? (
                    <div className="user-bubble">{m.content.text}</div>
                  ) : (
                    <>
                      {m.content.response?.text && (
                        <div
                          className={
                            "assistant-bubble " +
                            (m.content.response.kind === "ERROR"
                              ? "error-bubble"
                              : "")
                          }
                        >
                          <div className="assistant-label">
                            ReloHome <Sparkles size={12} />
                          </div>
                          <p className="prose">
                            {closedResultSummary(m, thread) ||
                              (m.id === lastAssistant?.id && inputServices.length
                                ? guidedReplyText(m.content.response.text, m.content.response.questions || [], inputServices)
                                : m.content.response.text)}
                          </p>
                          {closedResultSummary(m, thread) && (
                            <details className="completed-result-detail">
                              <summary>Xem nội dung kết quả ban đầu</summary>
                              <p className="prose">{m.content.response.text}</p>
                            </details>
                          )}
                          {m.content.response.kind === "PARTIAL" && (
                            <span className="tag amber">
                              {uiText("Kết quả một phần")}
                            </span>
                          )}
                        </div>
                      )}
                      {(m.content.ui?.components || [])
                        .filter((c) => c.data?.comparison)
                        .map((c) => (
                          <div key={c.id} id={"comparison-" + c.id}>
                            <HousingComparison data={c.data} />
                          </div>
                        ))}
                      <div className="chat-service-summaries">
                        {(m.content.ui?.components || [])
                          .filter((c) =>
                            [
                              "property",
                              "flight",
                              "relocation",
                              "map",
                            ].includes(c.type),
                          )
                          .map((c) => {
                            const target = journey.find(
                              (t) => t.c.task_id === c.task_id,
                            );
                            const chosen =
                              target && hasSelection(thread, target);
                            return (
                              <div key={c.id} className="chat-service-summary">
                                <span>
                                  {chosen
                                    ? uiText("Đã chọn")
                                    : uiText("Có kết quả")}
                                  : {uiText(domainLabels[c.type] || c.type)}
                                </span>
                                {!chosen && target && (
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      openService(c.task_id, c.type)
                                    }
                                  >
                                    {uiText("Xem phương án")}{" "}
                                    <ChevronRight size={14} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                      </div>
                      <Results
                        payload={{
                          ...m.content,
                          ui: m.content.ui
                            ? {
                                ...m.content.ui,
                                components: m.content.ui.components.filter(
                                  (c) =>
                                    ![
                                      "property",
                                      "flight",
                                      "relocation",
                                      "map",
                                    ].includes(c.type),
                                ),
                              }
                            : undefined,
                        }}
                        selected={facts}
                        saved={savedIds}
                        busy={busy}
                        writes={!!status?.writes_enabled}
                        onOpen={openHouse}
                        onSave={(h) => void save(h, thread!.id)}
                        onAction={(c, v, kind, id) =>
                          mutate("action", {
                            kind,
                            task_id: c.task_id,
                            plan_version: v,
                            fetched_at: c.fetched_at,
                            entity_id: id,
                          }).then(() => {})
                        }
                        onPrompt={(s) => {
                          setDraft(s);
                          input.current?.focus();
                        }}
                        onFilter={() => setForm("property")}
                      />
                      <Receipts
                        receipts={m.content.response?.data?.receipts || []}
                      />
                      {m.id === lastAssistant?.id && thread && inputServices.length > 0 && (
                        <ServiceInputPanel services={inputServices} thread={thread} disabled={busy || !status} onSubmit={sendForm} onChat={() => input.current?.focus()} />
                      )}
                      {(closedResultSummary(m, thread)
                        ? []
                        : m.content.response?.questions || []
                      ).map((q: Data, i: number) => (
                        <div className="question" key={i}>
                          {!m.content.response?.text.includes(q.text) && (
                            <p>{q.text}</p>
                          )}
                          <div className="tags">
                            {mergePlaceCandidates(q.choices || []).map(
                              (c: Data) => (
                                <button
                                  key={c.id}
                                  className="suggestion"
                                  disabled={busy}
                                  onClick={() =>
                                    choosePlace(c, q.field).catch(() => {})
                                  }
                                >
                                  <MapPin size={12} /> {c.label}
                                </button>
                              ),
                            )}
                            {(q.choices?.length ? [] : q.options || []).map(
                              (o: string, index: number, all: string[]) => (
                                <button
                                  key={o}
                                  className="suggestion"
                                  disabled={busy}
                                  onClick={() =>
                                    (viewing &&
                                    q.field === "relocation.selected:property"
                                      ? movingDestination(index, all.length)
                                      : send(o)
                                    ).catch(() => {})
                                  }
                                >
                                  {o}
                                </button>
                              ),
                            )}
                          </div>
                        </div>
                      ))}
                      {(m.content.response?.suggestions || []).length > 0 && (
                        <div className="suggestions">
                          {m.content.response!.suggestions!.map((s: Data) => (
                            <button
                              key={s.key}
                              className="suggestion"
                              onClick={() => setDraft(s.message)}
                            >
                              {uiText(s.label)}
                              <ArrowUpRight size={13} />
                            </button>
                          ))}
                        </div>
                      )}
                      {m.content.confirmation &&
                        m.content.confirmation.payload_hash !==
                          pending?.payload_hash && (
                          <p className="notice">
                            {uiText(
                              "Phương án cũ đã được xử lý hoặc thay đổi. Xem trạng thái hiện tại bên dưới.",
                            )}
                          </p>
                        )}
                      {m.content.uncertain && (
                        <p className="notice amber">
                          {uiText(
                            "Chưa rõ kết quả xử lý. Kiểm tra trạng thái trước khi gửi lại.",
                          )}
                        </p>
                      )}
                    </>
                  )}
                  <time>{dateTime(m.created)}</time>
                </div>
              </article>
            ))}
            {pending?.type === "confirmation_required" && (
              <Approval
                pending={pending}
                enabled={!!status?.writes_enabled}
                busy={busy}
                onDecision={(body) => mutate("decision", body).then(() => {})}
              />
            )}
            {pending?.type === "payment_required" && thread && (
              <PendingPayment
                pending={pending}
                threadId={thread.id}
                busy={busy}
                onCheck={() => mutate("payment/check", {}).then(() => {})}
              />
            )}
            {busy && (
              <div className="thinking" role="status">
                <span>
                  <i />
                  <i />
                  <i />
                </span>
                <small>{uiText("ReloHome đang xử lý yêu cầu của bạn…")}</small>
              </div>
            )}
            {error && (
              <div className="notice error" role="alert">
                {uiText(error)}
                <button
                  className="text-button"
                  onClick={() => {
                    setError("");
                    reload().catch((e) => setError(e.message));
                  }}
                >
                  <RefreshCw size={14} />
                  {uiText("Kiểm tra trạng thái")}
                </button>
              </div>
            )}
            {thread?.runs?.some(
              (r) => r.status === "running" || r.status === "unknown",
            ) &&
              !busy && (
                <div className="notice amber">
                  {uiText("Có yêu cầu đang xử lý hoặc chưa rõ kết quả.")}
                  <button
                    className="text-button"
                    onClick={() => reload().catch((e) => setError(e.message))}
                  >
                    {uiText("Kiểm tra trạng thái")}
                  </button>
                </div>
              )}
          </div>
          <div className="composer-wrap">
            <div className="chat-plan-tools">
              {newMessage && (
                <button
                  className="new-message"
                  onClick={() => {
                    scroll.current?.scrollTo({
                      top: scroll.current.scrollHeight,
                      behavior: "smooth",
                    });
                    setNewMessage(false);
                  }}
                >
                  <ArrowDown size={14} />
                  {uiText("Có phản hồi mới")}
                </button>
              )}
              {movingQuestions.length > 0 && (
                <button
                  className="secondary open-map"
                  onClick={() => setWorkspace("relocation-form")}
                >
                  <Truck size={15} />
                  {uiText(" Nhập thông tin chuyển đồ")}
                </button>
              )}
              {latestService && !movingQuestions.length && (
                <button
                  className="secondary open-map"
                  onClick={() =>
                    openService(latestService.c.task_id, latestService.c.type)
                  }
                >
                  <MapPin size={15} />{" "}
                  {
                    {
                      property: "Mở bản đồ nhà ở",
                      flight: "Mở danh sách chuyến bay",
                      relocation: "Mở phương án chuyển đồ",
                    }[latestService.c.type]
                  }
                </button>
              )}
              {viewingItems.length > 0 && (
                <button className="secondary open-map" onClick={openViewings}>
                  <CalendarClock size={15} />
                  {formatUi(" Xem nhà ({0} căn)", [viewingItems.length])}
                </button>
              )}
              {payable.length > 0 && (
                <button className="primary open-map" onClick={openCheckout}>
                  <CreditCard size={15} />
                  {payable.length > 1
                    ? uiText(" Thanh toán")
                    : payable[0] === "flight"
                      ? uiText(" Thanh toán vé máy bay")
                      : uiText(" Thanh toán chuyển đồ")}
                </button>
              )}
            </div>
            {selectedHouse && (
              <div className="selection-strip">
                <span>
                  <Check size={14} />
                  {uiText("Đã chọn: ")}
                  <strong>{selectedHouse.title}</strong>
                </span>
                <button
                  className="text-button"
                  onClick={() => setWorkspace("relocation-form")}
                >
                  {uiText("Chuyển đồ tới đây ")}
                  <ArrowRight size={13} />
                </button>
              </div>
            )}
            {context && (
              <div className="context-chip">
                {uiText("Đang hỏi về: ")}
                {context.title}
                <button
                  className="icon-button"
                  aria-label={uiText("Bỏ ngữ cảnh")}
                  onClick={() => setContext(null)}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                send(draft).catch(() => {});
              }}
            >
              <span className="composer-spark">
                <Sparkles size={21} />
              </span>
              <textarea
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={1}
                placeholder={uiText(
                  "Nhắn cho ReloHome… cùng bắt đầu một điều mới",
                )}
                aria-label={uiText("Tin nhắn cho ReloHome")}
                maxLength={5000}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    send(draft).catch(() => {});
                  }
                }}
              />
              <button
                className="send-button"
                disabled={busy || !draft.trim() || !status}
                aria-label={uiText("Gửi tin nhắn")}
              >
                <Send size={20} />
              </button>
            </form>
            <div className="composer-caption">
              <span>
                {uiText(
                  "ReloHome có thể mắc lỗi. Hãy kiểm tra thông tin quan trọng.",
                )}
              </span>
              <span className="desktop-only">
                {uiText("Enter để gửi ")}
                <span>·</span>
                {uiText(" Shift + Enter xuống dòng")}
              </span>
            </div>
            {!status && (
              <div className="connection-alert">
                {uiText("Chưa kết nối được AI.")}{" "}
                <button className="text-button" onClick={() => void refresh()}>
                  {uiText("Thử kết nối lại")}
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {form && (
        <TaskForm kind={form} known={requestDefaults(thread, form)} disabled={busy || !status} onClose={() => setForm(null)} onSubmit={sendForm} />
      )}
      {params.get("panel") === "house" && openDetail && thread && (
        <HousingDetail
          house={openDetail}
          saved={savedIds.has(openDetail.id)}
          selected={
            facts["selected:property"]?.value === openDetail.id ||
            viewingIds.includes(openDetail.id)
          }
          busy={busy}
          onClose={() => setParams({}, { replace: true })}
          onSave={() => void save(openDetail, thread!.id)}
          onSelect={
            opened
              ? () =>
                  mutate("action", {
                    kind: "select",
                    task_id: opened.c.task_id,
                    plan_version: opened.version,
                    fetched_at: opened.c.fetched_at,
                    entity_id: openDetail.id,
                  })
                    .then(() =>
                      notify(
                        viewing
                          ? "Đã chọn căn để hẹn xem. Hẹn lịch trong Kế hoạch → Xem nhà."
                          : "Đã chọn căn nhà. Bạn có thể tiếp tục hỏi về đường đi hoặc chuyển đồ.",
                      ),
                    )
                    .catch(() => {})
              : undefined
          }
          onAsk={() => {
            setContext(openDetail);
            setParams({}, { replace: true });
            input.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function LegacyPlanRedirect() {
  const { planId } = useParams();
  return <Navigate to={"/ai/" + planId + "?panel=plan"} replace />;
}

function Account({ onLogout }: { onLogout: () => void }) {
  const accountId = useId();
  const { user, setUser, saved, threads, save, notify } = useApp();
  const [resetting, setResetting] = useState(false),
    [openSaved, setOpenSaved] = useState<Saved | null>(null);
  // Persistent shortlist = saved homes; compare 2–4 of them with re-read details (SPEC-021 AC-04).
  const [savedCompare, setSavedCompare] = useState<HouseData[]>([]),
    [comparingSaved, setComparingSaved] = useState(false);
  const [tab, setTab] = useState("history"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    try {
      const u = await api<User>("/profile", "PATCH", {
        name: tab === "profile" ? f.name : user.name,
        preferences: tab === "preferences" ? f : user.preferences,
      });
      setUser(u);
      setDirty(false);
      notify("Đã lưu thay đổi.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeTab(next: string) {
    if (dirty && !window.confirm("Bỏ những thay đổi chưa lưu để chuyển tab?"))
      return;
    setTab(next);
    setDirty(false);
    setError("");
  }
  return (
    <div className="content-page account-page">
      <section className="account-overview">
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              <UserRound size={13} />
              {uiText(" TÀI KHOẢN ReloHome")}
            </span>
            <h1>{uiText("Tài khoản của tôi")}</h1>
            <p>
              {uiText(
                "Mọi cuộc trò chuyện và lựa chọn của bạn, ở cùng một nơi.",
              )}
            </p>
          </div>
          <button
            className="secondary"
            onClick={async () => {
              if (
                dirty &&
                !window.confirm("Bạn có thay đổi chưa lưu. Đăng xuất?")
              )
                return;
              await api("/logout", "POST");
              onLogout();
            }}
          >
            <LogOut size={16} />
            {uiText("Đăng xuất")}
          </button>
        </div>
        <p>
          <Link className="text-button" to="/roommate">
            {roommateText("Tìm người ở cùng", "Find a roommate")}{" "}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <span aria-hidden="true"> · </span>
          <Link className="text-button" to="/landlord">
            {uiText("Chế độ chủ nhà")} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </p>
        <div className="profile-banner">
          <span className="avatar avatar-large">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="account-identity">
            <h2>{user.name}</h2>
            <p>{user.email}</p>
          </div>
          <div className="account-overview-stats">
            <div>
              <span className="account-stat-icon">
                <MessageCircle size={18} />
              </span>
              <span>
                <strong>{threads.length}</strong>
                <small>{uiText("Cuộc trò chuyện")}</small>
              </span>
            </div>
            <div>
              <span className="account-stat-icon saved">
                <Heart size={18} />
              </span>
              <span>
                <strong>{saved.length}</strong>
                <small>{uiText("Nhà đã lưu")}</small>
              </span>
            </div>
          </div>
        </div>
      </section>
      <TabList
        className="tabs account-tabs"
        label={uiText("Nội dung tài khoản")}
      >
        <button
          role="tab"
          id={accountId + "history"}
          aria-selected={tab === "history"}
          aria-controls={accountId + "panel"}
          className={tab === "history" ? "active" : ""}
          onClick={() => changeTab("history")}
        >
          <History size={17} />
          {uiText(" Lịch sử yêu cầu")}
        </button>
        <button
          role="tab"
          id={accountId + "security"}
          aria-selected={tab === "security"}
          aria-controls={accountId + "panel"}
          className={tab === "security" ? "active" : ""}
          onClick={() => changeTab("security")}
        >
          <ShieldCheck size={17} />
          {uiText(" Đăng nhập & bảo mật")}
        </button>
        <button
          role="tab"
          id={accountId + "profile"}
          aria-selected={tab === "profile"}
          aria-controls={accountId + "panel"}
          className={tab === "profile" ? "active" : ""}
          onClick={() => changeTab("profile")}
        >
          <UserRound size={17} />
          {uiText(" Hồ sơ")}
        </button>
        <button
          role="tab"
          id={accountId + "preferences"}
          aria-selected={tab === "preferences"}
          aria-controls={accountId + "panel"}
          className={tab === "preferences" ? "active" : ""}
          onClick={() => changeTab("preferences")}
        >
          <Settings2 size={17} />
          {uiText(" Sở thích AI")}
        </button>
        <button
          role="tab"
          id={accountId + "saved"}
          aria-selected={tab === "saved"}
          aria-controls={accountId + "panel"}
          className={tab === "saved" ? "active" : ""}
          onClick={() => changeTab("saved")}
        >
          <Heart size={17} />
          {uiText(" Đã lưu")} <span className="count">{saved.length}</span>
        </button>
        <button
          role="tab"
          id={accountId + "contacts"}
          aria-selected={tab === "contacts"}
          aria-controls={accountId + "panel"}
          className={tab === "contacts" ? "active" : ""}
          onClick={() => changeTab("contacts")}
        >
          <MessageCircle size={17} />
          {uiText(" Liên hệ chủ nhà")}
        </button>
      </TabList>
      <section
        id={accountId + "panel"}
        role="tabpanel"
        aria-labelledby={accountId + tab}
        tabIndex={0}
      >
        {tab === "contacts" ? (
          <TenantRequests />
        ) : tab === "history" ? (
          <RequestHistory threads={threads} />
        ) : tab === "security" ? (
          <section className="surface account-security">
            <ShieldCheck size={26} />
            <h3>{uiText(" Đăng nhập & bảo mật")}</h3>
            <label>
              {uiText("Email đăng nhập")}
              <input value={user.email} disabled />
            </label>
            <p className="muted">
              {uiText(
                "Tài khoản đã được lưu. Mật khẩu được bảo vệ và không hiển thị lại.",
              )}
            </p>
            <p className="muted">
              {uiText(
                "Bạn có thể dùng chức năng lưu mật khẩu của trình duyệt để tự điền khi đăng nhập lần sau.",
              )}
            </p>
            <p className="muted small">
              {uiText("Đổi hoặc khôi phục mật khẩu hiện chưa được hỗ trợ.")}
            </p>
          </section>
        ) : tab !== "saved" ? (
          <div className="account-grid">
            <section className="surface">
              <h3>
                {tab === "profile"
                  ? uiText("Thông tin cá nhân")
                  : uiText("Những điều bạn ưu tiên")}
              </h3>
              <form
                key={tab + user.name + JSON.stringify(user.preferences)}
                onSubmit={submit}
                onChange={() => setDirty(true)}
              >
                {tab === "profile" ? (
                  <>
                    <label>
                      {uiText("Tên hiển thị")}
                      <input
                        name="name"
                        required
                        defaultValue={user.name}
                        maxLength={80}
                      />
                    </label>
                    <label>
                      {uiText("Email đăng nhập")}
                      <input value={user.email} disabled />
                    </label>
                  </>
                ) : (
                  <>
                    <p className="muted">
                      {uiText(
                        "Lưu để sử dụng lại khi bắt đầu tìm kiếm. Bạn quyết định khi nào áp dụng; yêu cầu mới trong chat được ưu tiên.",
                      )}
                    </p>
                    <div className="form-grid">
                      <label>
                        {uiText("Thành phố")}
                        <select
                          name="city"
                          defaultValue={user.preferences.city || ""}
                        >
                          <option value="">{uiText("Chưa chọn")}</option>
                          <option value="Hà Nội">{uiText("Hà Nội ")}</option>
                          <option value="Đà Nẵng">{uiText("Đà Nẵng")}</option>
                          <option value="Thành phố Hồ Chí Minh">
                            {uiText("Thành phố Hồ Chí Minh")}
                          </option>
                        </select>
                      </label>
                      <label>
                        {uiText("Ngân sách thuê · VND/tháng")}
                        <input
                          name="budget"
                          type="number"
                          min="0"
                          defaultValue={user.preferences.budget || ""}
                          placeholder={uiText("Ví dụ: 5000000")}
                        />
                      </label>
                      <label>
                        {uiText("Loại nhà")}
                        <input
                          name="room_type"
                          defaultValue={user.preferences.room_type || ""}
                          placeholder={uiText("Căn hộ, phòng trọ…")}
                        />
                      </label>
                      <label>
                        {uiText("Phương tiện")}
                        <select
                          name="transport"
                          defaultValue={user.preferences.transport || ""}
                        >
                          <option value="">{uiText("Chưa chọn")}</option>
                          <option value="Đi bộ">{uiText("Đi bộ")}</option>
                          <option value="Xe máy">{uiText("Xe máy")}</option>
                          <option value="Ô tô">{uiText("Ô tô")}</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      {uiText("Tiện nghi quan tâm")}
                      <input
                        name="amenities"
                        defaultValue={user.preferences.amenities || ""}
                        placeholder={uiText("Ví dụ: có chỗ để xe")}
                        maxLength={300}
                      />
                    </label>
                  </>
                )}
                {error && (
                  <p className="notice error" role="alert">
                    {uiText(error)}
                  </p>
                )}
                <div className="form-actions">
                  <button
                    type="reset"
                    className="secondary"
                    onClick={() => setDirty(false)}
                  >
                    {uiText("Hủy thay đổi")}
                  </button>
                  <button className="primary" disabled={busy || !dirty}>
                    {uiText("Lưu thay đổi")}
                  </button>
                </div>
              </form>
            </section>
            {tab === "profile" && <TravelerProfileForm />}
            <section className="surface recent-activity">
              <h3>{uiText("Hội thoại gần đây")}</h3>
              {threads.slice(0, 5).map((t) => (
                <Link key={t.id} to={"/ai/" + t.id}>
                  <span className="service-icon blue">
                    <MessageCircle size={17} />
                  </span>
                  <span>
                    <strong>{t.title}</strong>
                    <small>{dateTime(t.updated)}</small>
                  </span>
                  <ChevronRight size={15} />
                </Link>
              ))}
              {!threads.length && (
                <p className="muted">
                  {uiText(
                    "Chưa có hoạt động nào. Bắt đầu một cuộc trò chuyện cùng ReloHome.",
                  )}
                </p>
              )}
              {threads.length > 0 && (
                <button
                  className="text-button danger"
                  onClick={() => setResetting(true)}
                >
                  <Trash2 size={14} />
                  {uiText(" Xóa tất cả trò chuyện và làm mới ReloHome")}
                </button>
              )}
            </section>
          </div>
        ) : saved.length ? (
          <>
          <div className="saved-compare-bar">
            <span className="muted small">
              {formatUi(
                "Chọn 2–{0} căn đã lưu để so sánh chi phí và thông tin mới nhất.",
                [MAX_COMPARISON_HOMES],
              )}
            </span>
            <button
              className="primary"
              disabled={savedCompare.length < 2}
              onClick={() => setComparingSaved(true)}
            >
              {formatUi("So sánh {0} căn", [savedCompare.length])}
            </button>
          </div>
          <div className="saved-grid">
            {saved.map((s) => (
              <HousingCard
                key={s.id}
                house={s.house}
                saved
                compare={savedCompare.some((h) => h.id === s.id)}
                onCompare={() =>
                  setSavedCompare((homes) => toggleComparison(homes, s.house))
                }
                onSave={() => void save(s.house, s.thread_id)}
                onOpen={() =>
                  s.thread_id
                    ? window.location.assign(
                        "/ai/" +
                          s.thread_id +
                          "?panel=house&house=" +
                          encodeURIComponent(s.id),
                      )
                    : setOpenSaved(s)
                }
              />
            ))}
          </div>
          {comparingSaved && (
            <Comparison
              houses={savedCompare}
              refresh
              onClose={() => setComparingSaved(false)}
              onOpen={(h) => {
                const item = saved.find((s) => s.id === h.id);
                setComparingSaved(false);
                if (item) setOpenSaved(item);
              }}
            />
          )}
          </>
        ) : (
          <Empty
            icon={<Heart />}
            title={uiText("Giữ lại những nơi bạn thích")}
            text={uiText(
              "Bấm biểu tượng trái tim trên một căn nhà để lưu và xem lại tại đây.",
            )}
          >
            <Link className="secondary" to="/ai">
              {uiText("Tìm nhà cùng ReloHome ")}
              <ArrowRight size={15} />
            </Link>
          </Empty>
        )}
      </section>
      {resetting && <ResetThreadsDialog onClose={() => setResetting(false)} />}
      {openSaved && (
        <HousingDetail
          house={openSaved.house}
          saved
          selected={false}
          busy={false}
          onClose={() => setOpenSaved(null)}
          onSave={() =>
            void save(openSaved.house, "").then(() => setOpenSaved(null))
          }
        />
      )}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
  children,
  headingLevel = 2,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <Heading>{title}</Heading>
      <p>{text}</p>
      {children}
    </div>
  );
}
