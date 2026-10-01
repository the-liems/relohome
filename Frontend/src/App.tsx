import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route as WebRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Compass,
  Heart,
  History,
  House,
  LayoutList,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Plane,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRound,
  X,
  RefreshCw,
  Clock,
  ArrowDown,
} from "lucide-react";
import { api, ApiError, dateTime, domainLabels, money, requestId } from "./api";
import type {
  Component,
  Data,
  House as HouseData,
  Saved,
  Thread,
  User,
} from "./types";
import { Robot } from "./components/Robot";
import { Dialog } from "./components/Dialog";
import { HousingCard, HousingDetail } from "./components/Housing";
import { Approval, CostLines, TaskForm } from "./components/Forms";
import { Results } from "./components/Results";
import { Receipts, PendingPayment } from "./components/Transactions";

interface AppContext {
  user: User;
  setUser: (u: User) => void;
  status: Data | null;
  threads: Thread[];
  saved: Saved[];
  refresh: () => Promise<void>;
  save: (house: HouseData, thread: string) => Promise<void>;
  notify: (message: string) => void;
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
    title: "Khám phá khu vực",
    subtitle: "Tiện ích và đường đi quanh bạn",
    icon: Compass,
    color: "mint",
  },
];

export default function App() {
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
      setSaved(await api<Saved[]>("/saved"));
      setToast(
        existing ? "Đã bỏ lưu căn nhà." : "Đã lưu vào Tài khoản → Đã lưu.",
      );
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  if (loading)
    return (
      <div className="boot">
        <Robot />
        <p>Đang mở không gian của bạn…</p>
      </div>
    );
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          if (location.pathname === "/login")
            navigate("/ai", { replace: true });
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
      }}
    >
      <Shell>
        <Routes>
          <WebRoute path="/ai" element={<Chat />} />
          <WebRoute path="/ai/:threadId" element={<Chat />} />
          <WebRoute path="/plans" element={<Plans />} />
          <WebRoute path="/plans/:planId" element={<PlanDetail />} />
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
          <WebRoute path="/" element={<Navigate to="/ai" replace />} />
          <WebRoute path="/login" element={<Navigate to="/ai" replace />} />
          <WebRoute
            path="*"
            element={
              <Empty
                icon={<Compass />}
                title="Không tìm thấy trang"
                text="Trang này không tồn tại hoặc bạn chưa có quyền truy cập."
              >
                <Link className="primary" to="/ai">
                  Về Hệ thống AI
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
            aria-label="Đóng thông báo"
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
      <section className="login-story">
        <Link className="brand" to="/ai">
          <span className="brand-symbol">
            <Sparkles size={22} />
          </span>
          SIU AI
          <span className="brand-dot" />
        </Link>
        <div className="login-visual">
          <span className="orbit orbit-one">
            <House size={26} />
          </span>
          <span className="orbit orbit-two">
            <Plane size={26} />
          </span>
          <Robot />
          <span className="orbit orbit-three">
            <MapPin size={25} />
          </span>
        </div>
        <span className="eyebrow">MỘT KHỞI ĐẦU MỚI, DỄ DÀNG HƠN</span>
        <h1>
          Cuộc sống có nhiều việc.
          <br />
          <em>Cùng SIU, từng bước một.</em>
        </h1>
        <p>
          Từ tìm một nơi ở, khám phá khu vực đến sắp xếp hành trình. Trợ lý của
          bạn, trong một cuộc trò chuyện.
        </p>
        <div className="login-cities">
          <MapPin size={15} />
          Hà Nội <span>·</span> Đà Nẵng <span>·</span> TP.HCM
        </div>
      </section>
      <section className="login-form-wrap">
        <div className="login-form">
          <span className="service-icon purple">
            <MessageCircle size={24} />
          </span>
          <h2>{register ? "Bắt đầu cùng SIU AI" : "Chào bạn quay lại"}</h2>
          <p>
            {register
              ? "Tạo tài khoản để lưu hội thoại và những lựa chọn của bạn."
              : "Đăng nhập để tiếp tục câu chuyện của bạn."}
          </p>
          <form onSubmit={submit}>
            {register && (
              <label>
                Tên hiển thị
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="Bạn muốn SIU gọi là gì?"
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
              Mật khẩu
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                placeholder="Ít nhất 10 ký tự"
                minLength={10}
                maxLength={128}
                required
              />
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              {busy ? "Đang xử lý…" : register ? "Tạo tài khoản" : "Đăng nhập"}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="auth-switch">
            {register ? "Đã có tài khoản?" : "Lần đầu đến với SIU?"}{" "}
            <button
              className="text-button"
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "Đăng nhập" : "Tạo tài khoản"}
            </button>
          </p>
          <div className="login-foot">
            <ShieldCheck size={16} />
            Không gian riêng cho kế hoạch của bạn
          </div>
        </div>
      </section>
    </main>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, status, threads } = useApp(),
    location = useLocation();
  const [menu, setMenu] = useState(false),
    [history, setHistory] = useState(false);
  useEffect(() => setMenu(false), [location.pathname]);
  const isChat = location.pathname.startsWith("/ai"),
    title = isChat
      ? "Hệ thống AI"
      : location.pathname.startsWith("/plans")
        ? "Kế hoạch"
        : "Tài khoản";
  const active = threads.find((t) => location.pathname === "/ai/" + t.id);
  return (
    <div className="app-shell">
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="Đóng menu"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <Link className="brand" to="/ai">
          <span className="brand-symbol">
            <Sparkles size={22} />
          </span>
          SIU AI
          <span className="brand-dot" />
        </Link>
        <p className="brand-caption">Trợ lý cuộc sống của bạn</p>
        <nav aria-label="Điều hướng chính">
          <NavLink to="/ai">
            <MessageCircle size={20} />
            <span>Hệ thống AI</span>
            <ChevronRight size={15} />
          </NavLink>
          <NavLink to="/plans">
            <LayoutList size={20} />
            <span>Kế hoạch</span>
          </NavLink>
          <NavLink to="/account">
            <UserRound size={20} />
            <span>Tài khoản</span>
          </NavLink>
        </nav>
        <div className="sidebar-art">
          <div className="art-spark">✧</div>
          <p>
            Mỗi hành trình mới,
            <br />
            <strong>một người bạn đồng hành.</strong>
          </p>
          <Robot />
          <div className="cityline">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <p className="art-caption">
            Nhẹ việc hôm nay.
            <br />
            Rộng mở ngày mai.
          </p>
        </div>
        <Link className="sidebar-profile" to="/account">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{user.name}</strong>
            <small>Tài khoản của bạn</small>
          </span>
          <Settings2 size={16} />
        </Link>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Mở menu"
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              Không gian của bạn <ChevronRight size={13} />{" "}
              <strong>{title}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className={"connection " + (status ? "online" : "")}>
              <i />
              {status ? "AI đã kết nối" : "Chưa kết nối AI"}
            </span>
            <Link
              className="avatar avatar-small"
              aria-label="Mở tài khoản"
              to="/account"
            >
              {user.name.slice(0, 1).toUpperCase()}
            </Link>
          </div>
        </header>
        {isChat && (
          <div className="chat-header">
            <div className="chat-brand">
              <span className="robot-avatar">
                <Robot />
              </span>
              <div>
                <h2>
                  {active?.title ||
                    "Một cuộc trò chuyện, nhiều điều được giải quyết"}
                </h2>
                <p>
                  SIU AI <span>·</span> Cùng bạn sắp xếp cuộc sống
                </p>
              </div>
            </div>
            <div className="header-actions">
              <button className="secondary" onClick={() => setHistory(true)}>
                <History size={17} />
                <span>Lịch sử</span>
              </button>
              <Link
                className="icon-button outlined"
                to="/ai"
                aria-label="Cuộc trò chuyện mới"
              >
                <Plus size={20} />
              </Link>
            </div>
          </div>
        )}
        <main className={isChat ? "page-main chat-main" : "page-main"}>
          {children}
        </main>
      </div>
      {history && <HistoryDrawer onClose={() => setHistory(false)} />}
    </div>
  );
}

function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const { threads } = useApp();
  const [query, setQuery] = useState("");
  return (
    <Dialog title="Cuộc trò chuyện của bạn" onClose={onClose}>
      <div className="search-row">
        <Search size={17} />
        <input
          placeholder="Tìm theo tiêu đề…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <Link className="primary full" to="/ai" onClick={onClose}>
        <Plus size={17} />
        Cuộc trò chuyện mới
      </Link>
      <div className="history-list">
        {threads
          .filter((t) =>
            t.title
              .toLocaleLowerCase("vi")
              .includes(query.toLocaleLowerCase("vi")),
          )
          .map((t) => (
            <Link key={t.id} to={"/ai/" + t.id} onClick={onClose}>
              <MessageCircle size={19} />
              <span>
                <strong>{t.title}</strong>
                <small>{dateTime(t.updated)}</small>
              </span>
              <ChevronRight size={16} />
            </Link>
          ))}
      </div>
      {!threads.length && (
        <p className="muted">
          Cuộc trò chuyện đầu tiên của bạn sẽ xuất hiện ở đây.
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
    [draft, setDraft] = useState(""),
    [form, setForm] = useState<string | null>(null),
    [context, setContext] = useState<HouseData | null>(null),
    [newMessage, setNewMessage] = useState(false);
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
      await refresh();
    }
  }
  async function send(text: string, extra: Data = {}) {
    if (inFlight.current || !text.trim()) return;
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
      const updated = await api<Thread>("/threads/" + id + "/chat", "POST", {
        request_id: requestId(),
        message,
        ...extra,
      });
      if (currentThread.current === id) setThread(updated);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setDraft(text);
      if (id && currentThread.current === id) {
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
      if (currentThread.current === threadId) setThread(next);
      await refresh();
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
  const allComponents = (thread?.messages || []).flatMap((m) =>
    (m.content.ui?.components || []).map((c) => ({
      c,
      version: m.content.ui?.plan_version || 0,
    })),
  );
  const selectedHouse = allComponents
    .flatMap(({ c }) => c.data?.candidates || [])
    .find((h) => h.id === facts["selected:property"]?.value);
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
  const openDetail = opened?.c.data.candidates.find(
    (h: HouseData) => h.id === params.get("house"),
  ) as HouseData | undefined;
  const unavailable = (kind: string) => !status?.domains?.includes(kind);
  return (
    <div className="chat-page">
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
          <div className="loading-history">
            <span className="spinner" />
            <span>Đang tải hội thoại…</span>
          </div>
        )}
        {!loading && !thread?.messages?.length && (
          <section className="welcome">
            <div className="welcome-heading">
              <span className="welcome-icon">
                <Sparkles size={22} />
              </span>
              <span className="eyebrow">
                CHÀO {user.name.toLocaleUpperCase("vi")}
              </span>
            </div>
            <h1>
              Bạn đang ấp ủ<br />
              <span>kế hoạch gì hôm nay?</span>
            </h1>
            <p>
              Tìm một nơi ở mới, chuẩn bị chuyến đi, hay khám phá khu vực.
              <br className="desktop-only" /> Kể SIU nghe, mình sẽ cùng bạn bắt
              đầu.
            </p>
            <div className="quick-grid">
              {quick.map((q) => (
                <button
                  className="quick-card"
                  key={q.kind}
                  onClick={() => setForm(q.kind)}
                  disabled={unavailable(q.kind)}
                  title={
                    unavailable(q.kind) ? "Dịch vụ chưa được kết nối" : q.title
                  }
                >
                  <span className={"service-icon " + q.color}>
                    <q.icon size={24} />
                  </span>
                  <strong>{q.title}</strong>
                  <span>{q.subtitle}</span>
                  <ArrowUpRight size={17} className="quick-arrow" />
                </button>
              ))}
            </div>
            <div className="starter">
              <span className="muted small">THỬ BẮT ĐẦU VỚI</span>
              <button
                onClick={() => {
                  setDraft("Tìm phòng ở Hà Nội dưới 5 triệu đồng mỗi tháng");
                  input.current?.focus();
                }}
              >
                “Tìm phòng ở Hà Nội dưới 5 triệu/tháng”
                <ArrowRight size={16} />
              </button>
              <button
                onClick={() => {
                  setDraft("Tôi muốn tìm nhà và báo giá chuyển đồ tới đó");
                  input.current?.focus();
                }}
              >
                “Tôi muốn tìm nhà và chuyển đồ tới đó”
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="welcome-note">
              <ShieldCheck size={15} />
              Bạn luôn là người xác nhận trước mỗi giao dịch.
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
                Dùng sở thích đã lưu cho lần tìm này
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
            {m.role === "assistant" && (
              <span className="message-avatar">
                <Robot />
              </span>
            )}
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
                        SIU AI <Sparkles size={12} />
                      </div>
                      <p className="prose">{m.content.response.text}</p>
                      {m.content.response.kind === "PARTIAL" && (
                        <span className="tag amber">Kết quả một phần</span>
                      )}
                    </div>
                  )}
                  <Results
                    payload={m.content}
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
                      })
                    }
                    onPrompt={(s) => {
                      setDraft(s);
                      input.current?.focus();
                    }}
                    onFilter={() => setForm("property")}
                  />
                  {m.content.response?.data?.cost_summary && (
                    <section className="result-group">
                      <h3>Chi phí dự kiến tại thời điểm tìm kiếm</h3>
                      <CostLines
                        summary={m.content.response.data.cost_summary}
                      />
                      <p className="muted">
                        Chưa phải khoản đã thanh toán. Xem Kế hoạch để biết tổng
                        theo lựa chọn mới nhất.
                      </p>
                    </section>
                  )}
                  <Receipts
                    receipts={m.content.response?.data?.receipts || []}
                  />
                  {(m.content.response?.questions || []).map(
                    (q: Data, i: number) => (
                      <div className="question" key={i}>
                        {!m.content.response?.text.includes(q.text) && (
                          <p>{q.text}</p>
                        )}
                        <div className="tags">
                          {(q.options || []).map((o: string) => (
                            <button
                              key={o}
                              className="suggestion"
                              disabled={busy}
                              onClick={() => send(o).catch(() => {})}
                            >
                              {o}
                            </button>
                          ))}
                        </div>
                      </div>
                    ),
                  )}
                  {(m.content.response?.suggestions || []).length > 0 && (
                    <div className="suggestions">
                      {m.content.response!.suggestions!.map((s: Data) => (
                        <button
                          key={s.key}
                          className="suggestion"
                          onClick={() => setDraft(s.message)}
                        >
                          {s.label}
                          <ArrowUpRight size={13} />
                        </button>
                      ))}
                    </div>
                  )}
                  {m.content.confirmation &&
                    m.content.confirmation.payload_hash !==
                      pending?.payload_hash && (
                      <p className="notice">
                        Phương án cũ đã được xử lý hoặc thay đổi. Xem trạng thái
                        hiện tại bên dưới.
                      </p>
                    )}
                  {m.content.uncertain && (
                    <p className="notice amber">
                      Chưa rõ kết quả xử lý. Kiểm tra trạng thái trước khi gửi
                      lại.
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
            onDecision={(body) => mutate("decision", body)}
          />
        )}
        {pending?.type === "payment_required" && thread && (
          <PendingPayment
            pending={pending}
            threadId={thread.id}
            busy={busy}
            onCheck={() => mutate("payment/check", {})}
          />
        )}
        {busy && (
          <div className="thinking" role="status">
            <span className="message-avatar">
              <Robot />
            </span>
            <span>
              <i />
              <i />
              <i />
            </span>
            <small>SIU đang xử lý yêu cầu của bạn…</small>
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button
              className="text-button"
              onClick={() => {
                setError("");
                reload().catch((e) => setError(e.message));
              }}
            >
              <RefreshCw size={14} />
              Kiểm tra trạng thái
            </button>
          </div>
        )}
        {thread?.runs?.some(
          (r) => r.status === "running" || r.status === "unknown",
        ) &&
          !busy && (
            <div className="notice amber">
              Có yêu cầu đang xử lý hoặc chưa rõ kết quả.
              <button
                className="text-button"
                onClick={() => reload().catch((e) => setError(e.message))}
              >
                Kiểm tra trạng thái
              </button>
            </div>
          )}
      </div>
      <div className="composer-wrap">
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
            Có phản hồi mới
          </button>
        )}
        {selectedHouse && (
          <div className="selection-strip">
            <span>
              <Check size={14} />
              Đã chọn: <strong>{selectedHouse.title}</strong>
            </span>
            <button
              className="text-button"
              onClick={() => setForm("relocation")}
            >
              Chuyển đồ tới đây <ArrowRight size={13} />
            </button>
          </div>
        )}
        {context && (
          <div className="context-chip">
            Đang hỏi về: {context.title}
            <button
              className="icon-button"
              aria-label="Bỏ ngữ cảnh"
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
            placeholder="Nhắn cho SIU AI… cùng bắt đầu một điều mới"
            aria-label="Tin nhắn cho SIU AI"
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
            aria-label="Gửi tin nhắn"
          >
            <Send size={20} />
          </button>
        </form>
        <div className="composer-caption">
          <span>SIU AI có thể mắc lỗi. Hãy kiểm tra thông tin quan trọng.</span>
          <span className="desktop-only">
            Enter để gửi <span>·</span> Shift + Enter xuống dòng
          </span>
        </div>
        {!status && (
          <div className="connection-alert">
            Chưa kết nối được AI.{" "}
            <button className="text-button" onClick={() => void refresh()}>
              Thử kết nối lại
            </button>
          </div>
        )}
      </div>
      {form && (
        <TaskForm
          kind={form}
          house={selectedHouse}
          onClose={() => setForm(null)}
          onSubmit={send}
        />
      )}
      {params.get("panel") === "house" && openDetail && opened && (
        <HousingDetail
          house={openDetail}
          saved={savedIds.has(openDetail.id)}
          selected={facts["selected:property"]?.value === openDetail.id}
          busy={busy}
          onClose={() => setParams({}, { replace: true })}
          onSave={() => void save(openDetail, thread!.id)}
          onSelect={() =>
            mutate("action", {
              kind: "select",
              task_id: opened.c.task_id,
              plan_version: opened.version,
              fetched_at: opened.c.fetched_at,
              entity_id: openDetail.id,
            })
              .then(() =>
                notify(
                  "Đã chọn căn nhà. Bạn có thể tiếp tục hỏi về đường đi hoặc chuyển đồ.",
                ),
              )
              .catch(() => {})
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

function Plans() {
  const { threads } = useApp();
  const [filter, setFilter] = useState("all");
  const plans = threads.filter(
    (t) => t.state?.plan && (filter !== "pending" || t.state.pending),
  );
  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">TỪ Ý TƯỞNG ĐẾN TỪNG BƯỚC NHỎ</span>
          <h1>Kế hoạch của bạn</h1>
          <p>Theo dõi những lựa chọn, chi phí và việc cần bạn phản hồi.</p>
        </div>
        <Link to="/ai" className="primary">
          <Plus size={17} />
          Lên kế hoạch với AI
        </Link>
      </div>
      <div className="plan-banner">
        <span className="robot-avatar">
          <Robot />
        </span>
        <div>
          <h3>Cùng bạn đi từng bước</h3>
          <p>
            Kế hoạch và cuộc trò chuyện luôn dùng chung những lựa chọn của bạn.
          </p>
        </div>
        <span className="banner-spark">✦</span>
      </div>
      <div className="tabs">
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          Tất cả kế hoạch
        </button>
        <button
          className={filter === "pending" ? "active" : ""}
          onClick={() => setFilter("pending")}
        >
          Cần bạn phản hồi
        </button>
      </div>
      {!plans.length ? (
        <Empty
          icon={<LayoutList />}
          title={
            filter === "pending"
              ? "Không có việc đang chờ bạn"
              : "Mọi kế hoạch đều bắt đầu bằng một câu chuyện"
          }
          text="Nhắn nhu cầu của bạn để SIU giúp chia thành những bước dễ theo dõi."
        >
          <Link className="secondary" to="/ai">
            Bắt đầu trò chuyện <ArrowRight size={16} />
          </Link>
        </Empty>
      ) : (
        <div className="plan-grid">
          {plans.map((t) => (
            <Link to={"/plans/" + t.id} className="plan-card" key={t.id}>
              <div className="plan-card-top">
                <span className="service-icon purple">
                  <LayoutList size={23} />
                </span>
                <span className={"tag " + (t.state.pending ? "amber" : "")}>
                  {t.state.pending ? "Cần phản hồi" : "Đã có phương án"}
                </span>
              </div>
              <h3>{t.title}</h3>
              <p className="muted">
                {t.state.plan.tasks?.length || 0} tác vụ AI · Cập nhật{" "}
                {dateTime(t.updated)}
              </p>
              <div className="tags">
                {[
                  ...new Set<string>(
                    (t.state.plan.tasks || []).map((a: Data) => a.agent),
                  ),
                ].map((d) => (
                  <span className="tag" key={d}>
                    {domainLabels[d] || d}
                  </span>
                ))}
              </div>
              <div className="plan-card-footer">
                Xem kế hoạch
                <ArrowRight size={17} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
function PlanDetail() {
  const { planId } = useParams(),
    { status, refresh } = useApp();
  const [thread, setThread] = useState<Thread | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<Thread>("/threads/" + planId)
      .then((t) => {
        if (active) setThread(t);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [planId]);
  if (error)
    return (
      <Empty
        icon={<LayoutList />}
        title="Chưa tải được kế hoạch"
        text={error}
      />
    );
  if (!thread) return <div className="loading-history">Đang tải kế hoạch…</div>;
  const state = thread.state;
  return (
    <div className="content-page">
      <Link to="/plans" className="text-button">
        ← Kế hoạch của bạn
      </Link>
      <div className="page-heading">
        <div>
          <h1>{thread.title}</h1>
          <p>Các tác vụ AI và lựa chọn hiện tại của bạn</p>
        </div>
        <Link className="primary" to={"/ai/" + thread.id}>
          <MessageCircle size={17} />
          Tiếp tục chat
        </Link>
      </div>
      <div className="plan-detail-grid">
        <section className="surface">
          <h3>Các bước trong kế hoạch</h3>
          <div className="timeline">
            {(state.plan?.tasks || []).map((t: Data, i: number) => (
              <div className="timeline-row" key={t.id}>
                <span
                  className={
                    "timeline-number " +
                    (state.task_status?.[t.id] === "done" ? "complete" : "")
                  }
                >
                  {state.task_status?.[t.id] === "done" ? (
                    <Check size={17} />
                  ) : (
                    i + 1
                  )}
                </span>
                <div>
                  <h4>{domainLabels[t.agent] || t.agent}</h4>
                  <p>
                    {t.inputs.city ||
                      t.inputs.origin ||
                      t.inputs.from_address ||
                      "Theo yêu cầu trong hội thoại"}
                  </p>
                  <span className="tag">
                    {(
                      {
                        done: "Đã có kết quả tìm kiếm",
                        failed: "Chưa thực hiện được",
                        running: "Đang xử lý",
                        pending: "Chờ xử lý",
                        blocked: "Cần bổ sung thông tin",
                        stale: "Cần tính lại theo lựa chọn mới",
                        needs_input: "Cần bổ sung thông tin",
                        skipped: "Đã bỏ qua",
                        ready: "Sẵn sàng xử lý",
                      } as Data
                    )[state.task_status?.[t.id]] || "Chờ xử lý"}
                  </span>
                </div>
                <Link className="text-button" to={"/ai/" + thread.id}>
                  Xem kết quả <ArrowUpRight size={14} />
                </Link>
              </div>
            ))}
          </div>
          <p className="notice">
            Hoàn thành tìm kiếm chưa đồng nghĩa đã thuê nhà hoặc đặt dịch vụ.
            Đơn đã xác nhận được hiển thị riêng.
          </p>
          <Receipts receipts={Object.values(state.committed || {})} />
        </section>
        <section className="surface">
          <h3>Chi phí dự kiến</h3>
          {state.cost_summary ? (
            <CostLines summary={state.cost_summary} />
          ) : (
            <p className="muted">Chưa có đủ thông tin chi phí.</p>
          )}
          <p className="muted small">
            Các khoản chưa biết chưa được tính. Đây là chi phí dự kiến, chưa
            phải số tiền đã chi.
          </p>
        </section>
      </div>
      {state.pending?.type === "confirmation_required" && (
        <Approval
          pending={state.pending}
          enabled={!!status?.writes_enabled}
          busy={busy}
          onDecision={async (body) => {
            setBusy(true);
            try {
              setThread(
                await api<Thread>(
                  "/threads/" + thread.id + "/decision",
                  "POST",
                  { ...body, request_id: requestId() },
                ),
              );
              await refresh();
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function Account({ onLogout }: { onLogout: () => void }) {
  const { user, setUser, saved, threads, save, notify } = useApp();
  const [tab, setTab] = useState("profile"),
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
    <div className="content-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">KHÔNG GIAN RIÊNG CỦA BẠN</span>
          <h1>Tài khoản của tôi</h1>
          <p>Quản lý hồ sơ, những ưu tiên và các căn nhà đã lưu.</p>
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
          Đăng xuất
        </button>
      </div>
      <div className="profile-banner">
        <span className="avatar avatar-large">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h2>{user.name}</h2>
          <p>{user.email}</p>
          <span className="tag selected-tag">
            <ShieldCheck size={12} />
            Không gian cá nhân
          </span>
        </div>
        <Robot />
      </div>
      <div className="tabs">
        <button
          className={tab === "profile" ? "active" : ""}
          onClick={() => changeTab("profile")}
        >
          Hồ sơ
        </button>
        <button
          className={tab === "preferences" ? "active" : ""}
          onClick={() => changeTab("preferences")}
        >
          Sở thích AI
        </button>
        <button
          className={tab === "saved" ? "active" : ""}
          onClick={() => changeTab("saved")}
        >
          Đã lưu <span className="count">{saved.length}</span>
        </button>
      </div>
      {tab !== "saved" ? (
        <div className="account-grid">
          <section className="surface">
            <h3>
              {tab === "profile"
                ? "Thông tin cá nhân"
                : "Những điều bạn ưu tiên"}
            </h3>
            <form
              key={tab + user.name + JSON.stringify(user.preferences)}
              onSubmit={submit}
              onChange={() => setDirty(true)}
            >
              {tab === "profile" ? (
                <>
                  <label>
                    Tên hiển thị
                    <input
                      name="name"
                      required
                      defaultValue={user.name}
                      maxLength={80}
                    />
                  </label>
                  <label>
                    Email đăng nhập
                    <input value={user.email} disabled />
                  </label>
                </>
              ) : (
                <>
                  <p className="muted">
                    Lưu để sử dụng lại khi bắt đầu tìm kiếm. Bạn quyết định khi
                    nào áp dụng; yêu cầu mới trong chat được ưu tiên.
                  </p>
                  <div className="form-grid">
                    <label>
                      Thành phố
                      <select
                        name="city"
                        defaultValue={user.preferences.city || ""}
                      >
                        <option value="">Chưa chọn</option>
                        <option>Hà Nội</option>
                        <option>Đà Nẵng</option>
                        <option>Thành phố Hồ Chí Minh</option>
                      </select>
                    </label>
                    <label>
                      Ngân sách thuê · VND/tháng
                      <input
                        name="budget"
                        type="number"
                        min="0"
                        defaultValue={user.preferences.budget || ""}
                        placeholder="Ví dụ: 5000000"
                      />
                    </label>
                    <label>
                      Loại nhà
                      <input
                        name="room_type"
                        defaultValue={user.preferences.room_type || ""}
                        placeholder="Căn hộ, phòng trọ…"
                      />
                    </label>
                    <label>
                      Phương tiện
                      <select
                        name="transport"
                        defaultValue={user.preferences.transport || ""}
                      >
                        <option value="">Chưa chọn</option>
                        <option>Đi bộ</option>
                        <option>Xe máy</option>
                        <option>Ô tô</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Tiện nghi quan tâm
                    <input
                      name="amenities"
                      defaultValue={user.preferences.amenities || ""}
                      placeholder="Ví dụ: có chỗ để xe"
                      maxLength={300}
                    />
                  </label>
                </>
              )}
              {error && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
              <div className="form-actions">
                <button
                  type="reset"
                  className="secondary"
                  onClick={() => setDirty(false)}
                >
                  Hủy thay đổi
                </button>
                <button className="primary" disabled={busy || !dirty}>
                  Lưu thay đổi
                </button>
              </div>
            </form>
          </section>
          <section className="surface recent-activity">
            <h3>Hội thoại gần đây</h3>
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
                Chưa có hoạt động nào. Bắt đầu một cuộc trò chuyện cùng SIU.
              </p>
            )}
          </section>
        </div>
      ) : saved.length ? (
        <div className="saved-grid">
          {saved.map((s) => (
            <HousingCard
              key={s.id}
              house={s.house}
              saved
              onSave={() => void save(s.house, s.thread_id)}
              onOpen={() =>
                window.location.assign(
                  "/ai/" +
                    s.thread_id +
                    "?panel=house&house=" +
                    encodeURIComponent(s.id),
                )
              }
            />
          ))}
        </div>
      ) : (
        <Empty
          icon={<Heart />}
          title="Giữ lại những nơi bạn thích"
          text="Bấm biểu tượng trái tim trên một căn nhà để lưu và xem lại tại đây."
        >
          <Link className="secondary" to="/ai">
            Tìm nhà cùng SIU <ArrowRight size={15} />
          </Link>
        </Empty>
      )}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
