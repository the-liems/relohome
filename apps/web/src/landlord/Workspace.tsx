import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Eye,
  Home,
  ImagePlus,
  Inbox,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { ApiError, api, dateTime, money, requestId } from "../api";
import type { Data } from "../types";
import { formatUi, t } from "../uiPreferences";
import { EmptyState } from "../components/UiStates";
import { useContactMessenger } from "../components/ContactMessenger";
import { Dialog } from "../components/Dialog";
import { LandlordReviews } from "../components/HousingReviews";
import { housingManagement, uploadListingImage } from "./client";
import {
  HostProfileForm,
  HostStatusBanner,
  HostVerifiedChip,
  needsProfile,
  posterLabels,
} from "./HostProfile";
import type {
  AvailabilityStatus,
  ContactRequest,
  HostProfilePage,
  ManagedListing,
  ManagedUnit,
  ModerationQueue,
  Overview,
  PropertyDetail,
  PropertySummary,
  PublicationStatus,
} from "./types";
import {
  LocationPicker,
  PrivateLocationMap,
  type AddressSelection,
} from "./LocationPicker";
import { ListingPreview } from "./ListingPreview";
import {
  ListingGallery,
  ListingsPanel,
  StatisticsPanel,
  ViewingCalendar,
} from "./ManagementPanels";
import "./landlord.css";
import "./workspace-upgrade.css";

type Tab =
  | "overview"
  | "properties"
  | "listings"
  | "inbox"
  | "calendar"
  | "statistics"
  | "reviews";

const propertyLabels: Record<string, string> = {
  apartment: "Căn hộ",
  house: "Nhà nguyên căn",
  room: "Phòng trọ",
  studio: "Studio",
  serviced_apartment: "Căn hộ dịch vụ",
  homestay: "Homestay",
  other: "Khác",
};
const publicationLabels: Record<PublicationStatus, string> = {
  draft: "Bản nháp",
  pending_review: "Đang chờ duyệt",
  published: "Đã duyệt",
  hidden: "Đã ẩn",
  rejected: "Cần bổ sung",
  deleted: "Đã xóa",
};
const availabilityLabels: Record<AvailabilityStatus, string> = {
  vacant: "Còn trống",
  rented: "Đã thuê",
  paused: "Tạm dừng nhận khách",
};
const statusLabels: Record<string, string> = {
  pending: "Chờ xác minh",
  active: "Đã xác minh",
  revoked: "Đã thu hồi",
  new: "Mới",
  contacted: "Đã liên hệ",
  viewing: "Đã hẹn xem",
  resolved: "Hoàn tất",
  declined: "Đã từ chối",
  ...publicationLabels,
};
// Billing units the Platform API accepts; labels only.
const unitLabels: Record<string, string> = {
  month: "/ tháng",
  one_time: "một lần",
  kwh: "/ kWh",
  m3: "/ m³",
  person_month: "/ người / tháng",
  vehicle_month: "/ xe / tháng",
};
// Common fees offered as one-click rows; the owner edits or removes any of them.
const feeSuggestions: { label: string; billing_unit: string }[] = [
  { label: "Tiền điện", billing_unit: "kwh" },
  { label: "Tiền nước", billing_unit: "m3" },
  { label: "Internet", billing_unit: "month" },
  { label: "Phí dịch vụ", billing_unit: "month" },
  { label: "Gửi xe", billing_unit: "vehicle_month" },
];

function addressText(address: Record<string, unknown>) {
  return String(
    address.full_address ||
      address.formatted ||
      address.address ||
      t("Chưa có địa chỉ"),
  );
}

function ErrorPanel({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="ll-error" role="alert">
      <CircleAlert aria-hidden="true" />
      <div>
        <strong>{t("Chưa tải được dữ liệu")}</strong>
        <p>{message}</p>
      </div>
      <button className="secondary" onClick={retry}>
        <RefreshCw size={16} /> {t("Thử lại")}
      </button>
    </div>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span className={`ll-status ${value}`}>
      {t(statusLabels[value] || value)}
    </span>
  );
}

export function LandlordWorkspace() {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [properties, setProperties] = useState<PropertySummary[]>([]);
  const [contacts, setContacts] = useState<ContactRequest[]>([]);
  const [listingFilter, setListingFilter] = useState("");
  const [inboxThread, setInboxThread] = useState("");
  const [editListing, setEditListing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createProperty, setCreateProperty] = useState(false);
  const [host, setHost] = useState<HostProfilePage | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [hostPage, summary, propertyPage, inbox] = await Promise.all([
        housingManagement<HostProfilePage>("host/profile"),
        housingManagement<Overview>("landlord/overview"),
        housingManagement<{ items: PropertySummary[] }>("landlord/properties"),
        housingManagement<{ items: ContactRequest[] }>(
          "landlord/contact-requests",
        ),
      ]);
      setHost(hostPage);
      setOverview(summary);
      setProperties(propertyPage.items);
      setContacts(inbox.items);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => void load(true);
    window.addEventListener("housing-contact-update", refresh);
    return () => window.removeEventListener("housing-contact-update", refresh);
  }, [load]);

  const newContacts = contacts.filter(
    (item) => item.status === "new" || item.unread > 0,
  ).length;
  // First visit in owner mode: the poster profile comes before anything else (host-mode-design §3.2).
  // Moderators who do not post themselves are not pushed into the poster form or banner.
  const showProfileForm =
    editingProfile ||
    (host !== null && !host.profile && properties.length === 0);
  const showHostBanner = Boolean(host);
  const startProperty = () => {
    setTab("properties");
    setSelected(null);
    if (needsProfile(host)) setEditingProfile(true);
    else setCreateProperty(true);
  };
  const tabs: [Tab, string, typeof Inbox, number][] = [
    ["overview", "Tổng quan", BarChart3, 0],
    ["properties", "Nhà & phòng", Building2, 0],
    ["inbox", "Yêu cầu liên hệ", Inbox, newContacts],

    ["listings", "Tin đăng", Home, 0],
    ["calendar", "Lịch xem nhà", CalendarClock, 0],
    ["statistics", "Thống kê", BarChart3, 0],
    ["reviews", "Đánh giá", Star, 0],
  ];

  return (
    <div className="ll-workspace" data-service="landlord">
      <header className="ll-heading">
        <div>
          <span className="ll-kicker">
            <Building2 size={14} /> {t("KHÔNG GIAN CHỦ TRỌ")}
          </span>
          <h1>{t("Quản lý nhà cho thuê")}</h1>
          <HostVerifiedChip profile={host?.profile ?? null} />
          <p>
            {t(
              "Cập nhật nguồn cung, theo dõi quan tâm và xử lý yêu cầu từ người thuê tại một nơi.",
            )}
          </p>
        </div>
        <div className="ll-heading-actions">
          <button className="primary" onClick={startProperty}>
            <Plus size={17} /> {t("Thêm nhà")}
          </button>
        </div>
      </header>

      <nav className="ll-nav" aria-label={t("Quản lý nhà cho thuê")}>
        {tabs.map(([key, label, Icon, count]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => {
              setTab(key);
              setSelected(null);
              setEditListing(null);
              setListingFilter("");
              setEditingProfile(false);
            }}
          >
            <Icon size={17} /> {t(label)}
            {count > 0 && <span className="ll-count">{count}</span>}
          </button>
        ))}
      </nav>

      {!error && !loading && host && showHostBanner && !showProfileForm && (
        <HostStatusBanner page={host} edit={() => setEditingProfile(true)} />
      )}

      {error ? (
        <ErrorPanel message={error} retry={() => void load()} />
      ) : loading ? (
        <div className="ll-loading" role="status">
          <LoaderCircle className="spin" />{" "}
          {t("Đang chuẩn bị không gian quản lý…")}
        </div>
      ) : showProfileForm && host ? (
        <HostProfileForm
          page={host}
          close={
            host.profile || properties.length
              ? () => setEditingProfile(false)
              : undefined
          }
          saved={(page) => {
            setHost(page);
            setEditingProfile(false);
          }}
        />
      ) : tab === "overview" ? (
        <OverviewPanel
          overview={overview}
          properties={properties}
          contacts={contacts}
          go={(target, filter) => {
            setTab(target);
            setListingFilter(filter || "");
          }}
        />
      ) : tab === "listings" ? (
        <ListingsPanel
          initialStatus={listingFilter}
          edit={(listing, property) => {
            setEditListing(listing);
            setSelected(property);
            setTab("properties");
          }}
        />
      ) : tab === "calendar" ? (
        <ViewingCalendar
          contacts={contacts}
          openInbox={(id) => {
            setInboxThread(id);
            setTab("inbox");
          }}
        />
      ) : tab === "statistics" ? (
        <StatisticsPanel />
      ) : tab === "properties" ? (
        selected ? (
          <PropertyPanel
            id={selected}
            initialListing={editListing}
            back={() => setSelected(null)}
            changed={load}
          />
        ) : (
          <PropertiesPanel
            properties={properties}
            open={setSelected}
            creating={createProperty}
            setCreating={(value) =>
              value ? startProperty() : setCreateProperty(false)
            }
            changed={load}
          />
        )
      ) : tab === "inbox" ? (
        <InboxPanel
          contacts={contacts}
          initialThread={inboxThread}
          changed={load}
        />
      ) : tab === "reviews" ? (
        <LandlordReviews />
      ) : (
        <LandlordReviews />
      )}
    </div>
  );
}

function OverviewPanel({
  overview,
  properties,
  contacts,
  go,
}: {
  overview: Overview | null;
  properties: PropertySummary[];
  contacts: ContactRequest[];
  go: (tab: Tab, filter?: string) => void;
}) {
  const stats = [
    ["Nhà đang quản lý", overview?.properties || 0, Building2, "forest"],
    ["Phòng trong hệ thống", overview?.units || 0, Home, "blue"],
    ["Phòng còn trống", overview?.vacant || 0, CheckCircle2, "teal"],
    ["Yêu cầu mới", overview?.new_contacts || 0, MessageSquareText, "amber"],
  ] as const;
  const hasMeasurement = Boolean(overview?.measured_since);
  return (
    <div className="ll-overview">
      <section className="ll-metrics" aria-label={t("Tình hình vận hành")}>
        {stats.map(([label, value, Icon, tone]) => (
          <article key={label} className={`ll-metric ${tone}`}>
            <span>
              <Icon size={20} />
            </span>
            <strong>{value}</strong>
            <p>{t(label)}</p>
          </article>
        ))}
      </section>
      <StatisticsPanel
        compact
        go={(value, filter) => go(value as Tab, filter)}
      />
      <div className="ll-overview-grid">
        <section className="ll-panel ll-performance">
          <div className="ll-section-heading">
            <div>
              <span className="ll-eyebrow">{t("HIỆU QUẢ TIN ĐĂNG")}</span>
              <h2>{t("Tín hiệu quan tâm thực tế")}</h2>
            </div>
            {hasMeasurement && (
              <small>
                {formatUi("Từ {0}", [dateTime(overview!.measured_since!)])}
              </small>
            )}
          </div>
          {hasMeasurement ? (
            <div className="ll-signal-grid">
              <div>
                <Eye />
                <strong>{overview?.detail_views || 0}</strong>
                <span>{t("Lượt xem chi tiết")}</span>
              </div>
              <div>
                <Sparkles />
                <strong>{overview?.saves || 0}</strong>
                <span>{t("Lượt lưu")}</span>
              </div>
              <div>
                <Users />
                <strong>{overview?.contact_requests || 0}</strong>
                <span>{t("Yêu cầu liên hệ")}</span>
              </div>
            </div>
          ) : (
            <div className="ll-empty-inline">
              <BarChart3 />
              <div>
                <strong>{t("Chưa đủ dữ liệu đo lường")}</strong>
                <p>
                  {t(
                    "Số liệu sẽ xuất hiện khi tin đã duyệt bắt đầu có lượt xem, lưu hoặc liên hệ thật.",
                  )}
                </p>
              </div>
            </div>
          )}
        </section>
        <section className="ll-panel">
          <div className="ll-section-heading">
            <div>
              <span className="ll-eyebrow">{t("CẦN XỬ LÝ")}</span>
              <h2>{t("Việc tiếp theo")}</h2>
            </div>
          </div>
          <div className="ll-next-list">
            <button onClick={() => go("properties")}>
              <span>
                {properties.filter((p) => p.status === "pending").length}
              </span>
              <div>
                <strong>{t("Nhà chờ xác minh")}</strong>
                <small>{t("Hoàn thiện thông tin trước khi đăng tin")}</small>
              </div>
              <ChevronRight />
            </button>
            <button onClick={() => go("inbox")}>
              <span>{contacts.filter((c) => c.status === "new").length}</span>
              <div>
                <strong>{t("Yêu cầu liên hệ mới")}</strong>
                <small>{t("Phản hồi người thuê đang quan tâm")}</small>
              </div>
              <ChevronRight />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function PropertiesPanel({
  properties,
  open,
  creating,
  setCreating,
  changed,
}: {
  properties: PropertySummary[];
  open: (id: string) => void;
  creating: boolean;
  setCreating: (value: boolean) => void;
  changed: () => Promise<void>;
}) {
  if (creating)
    return (
      <PropertyForm
        close={() => setCreating(false)}
        done={async (id) => {
          setCreating(false);
          await changed();
          open(id);
        }}
      />
    );
  return (
    <section className="ll-panel ll-properties">
      <div className="ll-section-heading">
        <div>
          <span className="ll-eyebrow">{t("DANH MỤC QUẢN LÝ")}</span>
          <h2>{t("Nhà và tòa nhà")}</h2>
          <p>{t("Mỗi địa điểm có thể chứa nhiều phòng hoặc căn cho thuê.")}</p>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>
          <Plus size={17} /> {t("Thêm nhà")}
        </button>
      </div>
      {properties.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={t("Chưa có nhà nào")}
          text={t("Thêm địa điểm đầu tiên, sau đó tạo phòng và tin cho thuê.")}
        />
      ) : (
        <div className="ll-property-list">
          {properties.map((property) => (
            <button key={property.id} onClick={() => open(property.id)}>
              <span className="ll-property-icon">
                <Building2 />
              </span>
              <div className="ll-property-copy">
                <span className="ll-property-row">
                  <strong>{property.name}</strong>
                  <Status value={property.status} />
                </span>
                <p>
                  <MapPin size={14} /> {addressText(property.address)}
                </p>
                <small>
                  {t(
                    propertyLabels[property.property_type] ||
                      property.property_type,
                  )}
                </small>
              </div>
              <div className="ll-property-facts">
                <span>
                  <strong>{property.unit_count}</strong> {t("phòng")}
                </span>
                <span>
                  <strong>{property.vacant_count}</strong> {t("còn trống")}
                </span>
              </div>
              <ChevronRight />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function PropertyForm({
  close,
  done,
  existing,
}: {
  close: () => void;
  done: (id: string) => void;
  existing?: PropertyDetail;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selection, setSelection] = useState<AddressSelection>({
    address: existing ? addressText(existing.address) : "",
    location: existing ? { lat: existing.lat, lng: existing.lng } : null,
    confirmed: Boolean(existing?.location_confirmed_at),
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const payload = {
        name: form.get("name"),
        property_type: form.get("property_type"),
        address: {
          ...(selection.location_token ||
          selection.address !== (existing ? addressText(existing.address) : "")
            ? selection.components || {}
            : existing?.address || {}),
          full_address: selection.address,
          raw: selection.address,
        },
        location: selection.location,
        location_token: selection.location_token,
        location_confirmed: selection.confirmed,
        ...(existing ? { revision: existing.revision } : {}),
      };
      if (
        !selection.location ||
        !Number.isFinite(selection.location.lat) ||
        !Number.isFinite(selection.location.lng)
      ) {
        setError(
          t(
            "Chọn vị trí cho nhà trước khi lưu. Nếu chưa tìm được, hãy thử địa chỉ cụ thể hơn.",
          ),
        );
        setBusy(false);
        return;
      }
      const result = await housingManagement<{ id: string }>(
        existing ? `landlord/properties/${existing.id}` : "landlord/properties",
        existing ? "PATCH" : "POST",
        payload,
      );
      done(result.id);
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="ll-panel ll-form-panel">
      <div className="ll-section-heading">
        <div>
          <span className="ll-eyebrow">{t("BƯỚC 1")}</span>
          <h2>{t(existing ? "Chỉnh sửa nhà" : "Thêm nhà hoặc tòa nhà")}</h2>
          <p>
            {t(
              "Chọn địa chỉ, kiểm tra pin bản đồ, rồi thêm từng phòng cho thuê.",
            )}
          </p>
        </div>
        <button className="icon-button" onClick={close} aria-label={t("Đóng")}>
          <X />
        </button>
      </div>
      {existing && (
        <p className="ll-review-note">
          {t(
            "Thay đổi địa chỉ hoặc thông tin quan trọng sẽ đưa các tin liên quan về nháp để duyệt lại.",
          )}
        </p>
      )}
      <form className="ll-form" onSubmit={submit}>
        <label className="wide">
          {t("Tên dễ nhận biết")}
          <input
            name="name"
            required
            minLength={2}
            maxLength={160}
            defaultValue={existing?.name}
            placeholder={t("Ví dụ: Nhà trọ Nguyễn Trãi")}
          />
        </label>
        <label>
          {t("Loại hình")}
          <select
            name="property_type"
            defaultValue={existing?.property_type || "room"}
          >
            {Object.entries(propertyLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <LocationPicker value={selection} onChange={setSelection} />
        {error && (
          <p role="alert" className="ll-form-error wide">
            {error}
          </p>
        )}
        <div className="ll-form-actions wide">
          <button type="button" className="secondary" onClick={close}>
            {t("Hủy")}
          </button>
          <button className="primary" disabled={busy}>
            {t(busy ? "Đang lưu…" : existing ? "Lưu thay đổi" : "Thêm nhà")}
          </button>
        </div>
      </form>
    </section>
  );
}

function PropertyPanel({
  id,
  back,
  changed,
  initialListing,
}: {
  initialListing?: string | null;
  id: string;
  back: () => void;
  changed: () => Promise<void>;
}) {
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [error, setError] = useState("");
  const [addingUnit, setAddingUnit] = useState(false);
  const [editingUnit, setEditingUnit] = useState<ManagedUnit | null>(null);
  const [editingProperty, setEditingProperty] = useState(false);
  const [listingUnit, setListingUnit] = useState<ManagedUnit | null>(null);
  const load = useCallback(async () => {
    setError("");
    try {
      setProperty(
        await housingManagement<PropertyDetail>(`landlord/properties/${id}`),
      );
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (initialListing && property)
      setListingUnit(
        property.units.find((unit) => unit.listing_id === initialListing) ||
          null,
      );
  }, [initialListing, Boolean(property)]);
  if (error) return <ErrorPanel message={error} retry={() => void load()} />;
  if (!property)
    return (
      <div className="ll-loading">
        <LoaderCircle className="spin" /> {t("Đang tải nhà…")}
      </div>
    );
  const refresh = async () => {
    await load();
    await changed();
  };
  if (editingProperty)
    return (
      <PropertyForm
        existing={property}
        close={() => setEditingProperty(false)}
        done={async () => {
          setEditingProperty(false);
          await refresh();
        }}
      />
    );
  if (addingUnit || editingUnit)
    return (
      <UnitForm
        propertyId={id}
        existing={editingUnit || undefined}
        close={() => {
          setAddingUnit(false);
          setEditingUnit(null);
        }}
        done={async () => {
          setAddingUnit(false);
          setEditingUnit(null);
          await refresh();
        }}
      />
    );
  if (listingUnit)
    return (
      <ListingForm
        unit={listingUnit}
        active={property.management_status === "active"}
        close={() => {
          setListingUnit(null);
          void refresh();
        }}
        done={async () => {
          setListingUnit(null);
          await refresh();
        }}
      />
    );
  return (
    <section className="ll-panel ll-property-detail">
      <button className="ll-back" onClick={back}>
        <ArrowLeft size={16} /> {t("Tất cả nhà")}
      </button>
      <div className="ll-property-hero">
        <span className="ll-property-icon large">
          <Building2 />
        </span>
        <div>
          <div className="ll-property-row">
            <h2>{property.name}</h2>
            <Status value={property.management_status} />
          </div>
          <p>
            <MapPin size={15} /> {addressText(property.address)}
          </p>
          <small>
            {t(
              propertyLabels[property.property_type] || property.property_type,
            )}
          </small>
        </div>
        <button className="secondary" onClick={() => setEditingProperty(true)}>
          {t("Chỉnh sửa nhà")}
        </button>
        <button className="primary" onClick={() => setAddingUnit(true)}>
          <Plus size={17} /> {t("Thêm phòng")}
        </button>
      </div>
      <PrivateLocationMap lat={property.lat} lng={property.lng} />
      {!property.location_confirmed_at && (
        <p className="ll-form-hint">
          {t("Địa điểm chưa được xác nhận. Mở Chỉnh sửa nhà để chọn vị trí.")}
        </p>
      )}
      {property.management_status === "pending" && (
        <div className="ll-review-note">
          <CircleAlert />
          <div>
            <strong>{t("Địa điểm đang chờ xác minh")}</strong>
            <p>
              {t(
                "Bạn có thể chuẩn bị phòng và bản nháp. Tin chỉ hiển thị sau khi địa điểm và nội dung được duyệt.",
              )}
            </p>
          </div>
        </div>
      )}
      <div className="ll-section-heading compact">
        <div>
          <span className="ll-eyebrow">{t("NGUỒN CUNG")}</span>
          <h3>{formatUi("{0} phòng / căn", [property.units.length])}</h3>
        </div>
      </div>
      {property.units.length === 0 ? (
        <EmptyState
          icon={<Home />}
          title={t("Chưa có phòng")}
          text={t(
            "Thêm từng phòng hoặc căn để quản lý giá và trạng thái riêng.",
          )}
        />
      ) : (
        <div className="ll-unit-list">
          {property.units.map((unit) => (
            <UnitCard
              key={unit.id}
              unit={unit}
              active={property.management_status === "active"}
              edit={() => setListingUnit(unit)}
              editUnit={() => setEditingUnit(unit)}
              changed={load}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UnitForm({
  propertyId,
  close,
  done,
  existing,
}: {
  propertyId: string;
  existing?: ManagedUnit;
  close: () => void;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    const optionalNumber = (key: string) =>
      f.get(key) === "" ? null : Number(f.get(key));
    try {
      await housingManagement(
        existing
          ? `landlord/units/${existing.id}`
          : `landlord/properties/${propertyId}/units`,
        existing ? "PATCH" : "POST",
        {
          ...(existing ? { revision: existing.unit_revision } : {}),
          unit_code: f.get("unit_code"),
          bedrooms: optionalNumber("bedrooms"),
          bathrooms: optionalNumber("bathrooms"),
          area_m2: optionalNumber("area_m2"),
          amenities: String(f.get("amenities") || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        },
      );
      done();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="ll-panel ll-form-panel">
      <div className="ll-section-heading">
        <div>
          <span className="ll-eyebrow">{t("BƯỚC 2")}</span>
          <h2>{t(existing ? "Sửa phòng hoặc căn" : "Thêm phòng hoặc căn")}</h2>
        </div>
        <button className="icon-button" onClick={close} aria-label={t("Đóng")}>
          <X />
        </button>
      </div>
      <form className="ll-form" onSubmit={submit}>
        <label>
          {t("Mã phòng")}
          <input
            name="unit_code"
            required
            placeholder="P.301"
            defaultValue={existing?.unit_code}
          />
        </label>
        <label>
          {t("Diện tích (m²)")}
          <input
            name="area_m2"
            defaultValue={existing?.area_m2 ?? undefined}
            type="number"
            min="1"
            step="0.1"
          />
        </label>
        <label>
          {t("Phòng ngủ")}
          <input
            name="bedrooms"
            defaultValue={existing?.bedrooms ?? undefined}
            type="number"
            min="0"
            step="0.5"
          />
        </label>
        <label>
          {t("Phòng tắm")}
          <input
            name="bathrooms"
            defaultValue={existing?.bathrooms ?? undefined}
            type="number"
            min="0"
            step="0.5"
          />
        </label>
        <label className="wide">
          {t("Tiện ích, cách nhau bằng dấu phẩy")}
          <input
            name="amenities"
            defaultValue={existing?.amenities.join(", ")}
            placeholder={t("wifi, điều hòa, chỗ để xe")}
          />
        </label>
        {error && <p className="ll-form-error wide">{error}</p>}
        <div className="ll-form-actions wide">
          <button type="button" className="secondary" onClick={close}>
            {t("Hủy")}
          </button>
          <button className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : <Plus />}{" "}
            {t(existing ? "Lưu thay đổi" : "Thêm phòng")}
          </button>
        </div>
      </form>
    </section>
  );
}

function UnitCard({
  unit,
  active,
  edit,
  editUnit,
  changed,
}: {
  unit: ManagedUnit;
  active: boolean;
  edit: () => void;
  editUnit: () => void;
  changed: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  async function action(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      await housingManagement(path, method, body);
      await changed();
    } catch (cause) {
      setError(
        (cause as Error).message +
          " " +
          Object.values((cause as ApiError).fields || {}).join(" "),
      );
    } finally {
      setBusy(false);
    }
  }
  const status = unit.publication_status;
  const editable = status !== "deleted";
  return (
    <article className="ll-unit-card">
      <div className="ll-unit-main">
        <span className="ll-unit-icon">
          <Home />
        </span>
        <div>
          <span className="ll-property-row">
            <h3>{unit.unit_code}</h3>
            {status && <Status value={status} />}
          </span>
          <p>
            {unit.area_m2 ? `${unit.area_m2} m²` : t("Chưa có diện tích")} ·{" "}
            {formatUi("{0} PN · {1} WC", [
              unit.bedrooms ?? "?",
              unit.bathrooms ?? "?",
            ])}
          </p>
          {unit.title && <strong>{unit.title}</strong>}
        </div>
      </div>
      <div className="ll-unit-side">
        <button className="secondary" onClick={editUnit}>
          {t("Sửa phòng")}
        </button>
        {unit.listing_id && (
          <button className="secondary" onClick={() => setPreview(true)}>
            {t("Xem trước")}
          </button>
        )}
        {unit.availability_status && (
          <span className={`ll-availability ${unit.availability_status}`}>
            {t(availabilityLabels[unit.availability_status])}
          </span>
        )}
        <button
          className="secondary"
          onClick={edit}
          disabled={!editable}
          title={
            !editable
              ? t("Ẩn tin trước khi sửa; tin đang chờ duyệt không sửa được.")
              : undefined
          }
        >
          {unit.listing_id ? t("Sửa tin") : t("Tạo tin")}
        </button>
      </div>
      {unit.listing_id && (
        <div className="ll-unit-actions">
          {["draft", "rejected", "hidden"].includes(status || "") && (
            <button
              disabled={busy || !active}
              title={
                !active
                  ? t("Địa điểm cần được xác minh trước khi gửi duyệt.")
                  : undefined
              }
              onClick={() =>
                void action(`landlord/listings/${unit.listing_id}/submit`, {
                  revision: unit.revision,
                })
              }
            >
              <Send size={15} /> {t("Gửi duyệt")}
            </button>
          )}
          {status === "published" && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void action(
                    `landlord/listings/${unit.listing_id}/availability`,
                    {
                      status:
                        unit.availability_status === "vacant"
                          ? "rented"
                          : "vacant",
                      revision: unit.revision,
                    },
                  )
                }
              >
                {unit.availability_status === "vacant"
                  ? t("Đánh dấu đã thuê")
                  : t("Mở lại phòng")}
              </button>
              {unit.availability_status === "vacant" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(
                      `landlord/listings/${unit.listing_id}/availability`,
                      {
                        status: "paused",
                        revision: unit.revision,
                      },
                    )
                  }
                >
                  {t("Tạm dừng nhận khách")}
                </button>
              )}
            </>
          )}
          {["published", "pending_review"].includes(status || "") && (
            <button
              disabled={busy}
              onClick={() =>
                void action(`landlord/listings/${unit.listing_id}/hide`, {
                  revision: unit.revision,
                })
              }
            >
              {t("Ẩn tin")}
            </button>
          )}
          {editable && (
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    t("Xóa tin này? Tin sẽ biến khỏi tìm kiếm ngay."),
                  )
                )
                  void action(
                    `landlord/listings/${unit.listing_id}`,
                    { revision: unit.revision },
                    "DELETE",
                  );
              }}
            >
              <Trash2 size={15} /> {t("Xóa tin")}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="ll-form-error" role="alert">
          {error}
        </p>
      )}
      {preview && unit.listing_id && (
        <ListingPreview id={unit.listing_id} close={() => setPreview(false)} />
      )}
    </article>
  );
}

type FeeRow = {
  code: string;
  label: string;
  amount: string; // empty: the amount is unknown ("Chưa rõ" for tenants), never 0
  billing_unit: string;
  required: boolean;
  refundable: boolean;
};

function feeCode(label: string, taken: Set<string>) {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "fee";
  let code = base,
    n = 2;
  while (taken.has(code)) code = `${base}_${n++}`;
  return code;
}

function ListingForm({
  unit,
  close,
  done,
  active = true,
}: {
  unit: ManagedUnit;
  active?: boolean;
  close: () => void;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(Boolean(unit.listing_id));
  const [error, setError] = useState(""),
    [listingId, setListingId] = useState(unit.listing_id);
  const [existing, setExisting] = useState<ManagedListing | null>(null);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [nonce] = useState(requestId);
  const [preview, setPreview] = useState(false);
  const intent = useRef<"save" | "preview" | "submit">("save");
  async function reload(id = listingId) {
    if (id)
      setExisting(
        await housingManagement<ManagedListing>(`landlord/listings/${id}`),
      );
  }

  useEffect(() => {
    if (!unit.listing_id) return;
    const controller = new AbortController();
    setLoading(true);
    housingManagement<ManagedListing>(
      `landlord/listings/${unit.listing_id}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((listing) => {
        setExisting(listing);
        setFees(
          listing.fees.map((fee) => ({
            code: fee.code,
            label: fee.label,
            amount: fee.amount == null ? "" : String(fee.amount),
            billing_unit: fee.billing_unit,
            required: fee.required,
            refundable: fee.refundable,
          })),
        );
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [unit.listing_id]);

  function addFee(label: string, billing_unit: string) {
    setFees((rows) => [
      ...rows,
      {
        code: feeCode(t(label), new Set(rows.map((r) => r.code))),
        label: t(label),
        amount: "",
        billing_unit,
        required: true,
        refundable: false,
      },
    ]);
  }
  const setFee = (index: number, patch: Partial<FeeRow>) =>
    setFees((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = intent.current;
    intent.current = "save";
    let savedId = listingId;
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    const payload = {
      request_id: nonce,
      title: f.get("title"),
      description: f.get("description"),
      rent_vnd: Number(f.get("rent_vnd")),
      deposit_vnd: f.get("deposit_vnd") ? Number(f.get("deposit_vnd")) : null,
      availability_from: f.get("availability_from") || null,
      fees: fees
        .filter((row) => row.label.trim())
        .map((row) => ({
          code: row.code,
          label: row.label.trim(),
          amount: row.amount === "" ? null : Number(row.amount),
          billing_unit: row.billing_unit,
          required: row.required,
          refundable: row.refundable,
        })),
    };
    try {
      let id = listingId;
      if (id)
        await housingManagement(`landlord/listings/${id}`, "PATCH", {
          ...payload,
          revision: existing?.revision ?? unit.revision,
        });
      else {
        const result = await housingManagement<{ id: string }>(
          `landlord/units/${unit.id}/listing`,
          "POST",
          payload,
        );
        id = result.id;
        setListingId(id);
      }
      savedId = id;
      if (id) {
        await reload(id);
        for (const file of files) {
          await uploadListingImage(
            id,
            file,
            String(f.get("image_alt") || payload.title),
          );
          setFiles((previous) => previous.filter((value) => value !== file));
        }
        const latest = await housingManagement<ManagedListing>(
          `landlord/listings/${id}`,
        );
        setExisting(latest);
        if (action === "submit") {
          await housingManagement(`landlord/listings/${id}/submit`, "POST", {
            revision: latest.revision,
          });
          done();
        } else if (action === "preview") setPreview(true);
        else {
          setError("");
        }
      }
    } catch (cause) {
      setError(
        (cause as Error).message +
          " " +
          Object.values((cause as ApiError).fields || {}).join(" "),
      );
      await reload(savedId).catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="ll-loading" role="status">
        <LoaderCircle className="spin" /> {t("Đang tải nội dung tin…")}
      </div>
    );
  return (
    <section className="ll-panel ll-form-panel">
      <div className="ll-section-heading">
        <div>
          <span className="ll-eyebrow">{t("BƯỚC 3")}</span>
          <h2>
            {listingId
              ? t("Cập nhật tin")
              : formatUi("Đăng tin cho {0}", [unit.unit_code])}
          </h2>
          <p>
            {t("Ghi rõ toàn bộ chi phí để người thuê ước tính đúng ngân sách.")}
          </p>
        </div>
        <button className="icon-button" onClick={close} aria-label={t("Đóng")}>
          <X />
        </button>
      </div>
      {existing?.publication_status === "rejected" &&
        existing.rejection_reason && (
          <div className="ll-review-note">
            <CircleAlert />
            <div>
              <strong>{t("Lý do cần bổ sung")}</strong>
              <p>{existing.rejection_reason}</p>
            </div>
          </div>
        )}
      {["published", "pending_review"].includes(
        existing?.publication_status || "",
      ) && (
        <p className="ll-review-note">
          {t(
            "Khi nội dung quan trọng thay đổi, tin sẽ về nháp và cần duyệt lại trước khi hiển thị.",
          )}
        </p>
      )}
      <form className="ll-form ll-listing-form" onSubmit={submit}>
        <label className="wide">
          {t("Tiêu đề")}
          <input
            name="title"
            maxLength={240}
            defaultValue={existing?.title || unit.title || ""}
            placeholder={t("Phòng sáng thoáng, gần trường học")}
          />
        </label>
        <label className="wide">
          {t("Mô tả")}
          <textarea
            name="description"
            rows={5}
            maxLength={5000}
            defaultValue={existing?.description || ""}
            placeholder={t(
              "Không gian, nội thất, quy định và những điều người thuê cần biết…",
            )}
          />
        </label>
        <label>
          {t("Giá thuê / tháng")}
          <input
            name="rent_vnd"
            type="number"
            min="0"
            defaultValue={existing?.rent_vnd}
          />
        </label>
        <label>
          {t("Tiền cọc")}
          <input
            name="deposit_vnd"
            type="number"
            min="0"
            defaultValue={existing?.deposit_vnd ?? undefined}
          />
        </label>
        <label>
          {t("Ngày có thể vào ở")}
          <input
            name="availability_from"
            type="date"
            defaultValue={existing?.availability_from?.slice(0, 10) || ""}
          />
        </label>
        <fieldset className="wide ll-fees">
          <legend>{t("Các khoản phí")}</legend>
          <p className="ll-form-hint">
            {t(
              "Để trống số tiền nếu chưa chốt; người thuê sẽ thấy “Chưa rõ” thay vì 0.",
            )}
          </p>
          {fees.map((row, index) => (
            <div className="ll-fee-row" key={row.code}>
              <input
                aria-label={t("Tên khoản phí")}
                value={row.label}
                maxLength={100}
                onChange={(e) => setFee(index, { label: e.target.value })}
              />
              <input
                aria-label={t("Số tiền")}
                type="number"
                min="0"
                value={row.amount}
                placeholder={t("Chưa rõ")}
                onChange={(e) => setFee(index, { amount: e.target.value })}
              />
              <select
                aria-label={t("Đơn vị tính")}
                value={row.billing_unit}
                onChange={(e) =>
                  setFee(index, { billing_unit: e.target.value })
                }
              >
                {Object.entries(unitLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={row.required}
                  onChange={(e) =>
                    setFee(index, { required: e.target.checked })
                  }
                />
                {t(" Bắt buộc")}
              </label>
              {row.billing_unit === "one_time" && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={row.refundable}
                    onChange={(e) =>
                      setFee(index, { refundable: e.target.checked })
                    }
                  />
                  {t(" Hoàn lại")}
                </label>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={formatUi("Bỏ khoản {0}", [row.label])}
                onClick={() =>
                  setFees((rows) => rows.filter((_, i) => i !== index))
                }
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <div className="ll-fee-suggestions">
            {feeSuggestions
              .filter((s) => !fees.some((row) => row.label === t(s.label)))
              .map((s) => (
                <button
                  type="button"
                  key={s.label}
                  onClick={() => addFee(s.label, s.billing_unit)}
                >
                  <Plus size={13} /> {t(s.label)}
                </button>
              ))}
            <button type="button" onClick={() => addFee("Khoản khác", "month")}>
              <Plus size={13} /> {t("Khoản khác")}
            </button>
          </div>
        </fieldset>
        {existing?.issues && Object.keys(existing.issues).length > 0 && (
          <div className="wide ll-checklist">
            <h3>{t("Cần hoàn thiện trước khi gửi duyệt")}</h3>
            <ul>
              {Object.entries(existing.issues).map(([key, value]) => (
                <li key={key}>{t(value)}</li>
              ))}
            </ul>
          </div>
        )}
        {existing && (
          <ListingGallery listing={existing} changed={() => reload()} />
        )}
        <label className="wide ll-file">
          <ImagePlus />
          <span>
            <strong>{t("Ảnh phòng")}</strong>
            <small>
              {t(
                "JPEG/PNG, tối đa 5 MB. Ảnh sẽ được kiểm duyệt trước khi hiển thị.",
              )}
            </small>
          </span>
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
        </label>
        {files.length > 0 && (
          <p className="wide ll-form-hint">
            {formatUi("{0} ảnh sẽ tải khi lưu nháp", [files.length])}
          </p>
        )}
        <label className="wide">
          {t("Mô tả ảnh")}
          <input
            name="image_alt"
            placeholder={t("Ví dụ: Phòng ngủ nhìn từ cửa vào")}
          />
        </label>
        {error && (
          <p className="ll-form-error wide" role="alert">
            {error}
          </p>
        )}
        <div className="ll-form-actions wide">
          <button type="button" className="secondary" onClick={close}>
            {t("Hủy")}
          </button>
          <button
            type="submit"
            className="secondary"
            disabled={busy}
            onClick={() => {
              intent.current = "preview";
            }}
          >
            {t("Lưu và xem trước")}
          </button>
          <button
            type="submit"
            className="secondary"
            disabled={busy || !active}
            onClick={() => {
              intent.current = "submit";
            }}
            title={
              !active
                ? t("Địa điểm cần được xác minh trước khi gửi duyệt.")
                : undefined
            }
          >
            {t("Lưu và gửi duyệt")}
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              intent.current = "save";
            }}
          >
            {busy ? <LoaderCircle className="spin" /> : <CheckCircle2 />}{" "}
            {t("Lưu bản nháp")}
          </button>
        </div>
      </form>
      {preview && listingId && (
        <ListingPreview id={listingId} close={() => setPreview(false)} />
      )}
    </section>
  );
}

function InboxPanel({
  contacts,
  changed,
  initialThread = "",
}: {
  contacts: ContactRequest[];
  initialThread?: string;
  changed: () => Promise<void>;
}) {
  const messenger = useContactMessenger();
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [proposal, setProposal] = useState<ContactRequest | null>(null);
  const [slots, setSlots] = useState<string[]>([]),
    [chosen, setChosen] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState<ContactRequest | null>(null),
    [reason, setReason] = useState("");
  const initialOpened = useRef("");
  useEffect(() => {
    const item = contacts.find((row) => row.id === initialThread);
    if (item && initialOpened.current !== item.id) {
      initialOpened.current = item.id;
      messenger.open(item.id, item.title, "landlord");
    }
  }, [initialThread, contacts, messenger]);
  async function action(item: ContactRequest, suffix: string, body: Data) {
    setBusy(item.id);
    setError("");
    try {
      await housingManagement(
        `landlord/contact-requests/${item.id}/${suffix}`,
        "POST",
        body,
      );
      await changed();
      messenger.refresh();
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }
  async function propose(item: ContactRequest) {
    setBusy(item.id);
    setError("");
    try {
      const page = await api<Data>("/landlord/viewing-options");
      setSlots((page.slots || []).filter((slot: string) => Date.parse(slot) !== Date.parse(item.viewing_slot || "")));
      setChosen([]);
      setProposal(item);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const filtered = contacts.filter(
    (item) =>
      filter === "all" ||
      (filter === "unread" && item.unread > 0) ||
      (filter === "viewing" && item.viewing_status === "requested") ||
      (filter === "payment" && item.payment_report?.status === "pending") ||
      (filter === "closed" &&
        (["resolved", "declined"].includes(item.status) ||
          item.viewing_status === "cancelled")),
  );
  return (
    <section className="ll-panel ll-inbox">
      <div className="ll-section-heading">
        <div>
          <span className="ll-eyebrow">{t("HỘP THƯ QUAN TÂM")}</span>
          <h2>{t("Yêu cầu liên hệ")}</h2>
          <p>
            {t(
              "Xác nhận lịch xem, trao đổi và phản hồi chuyển tiền với người thuê.",
            )}
          </p>
        </div>
      </div>
      {error && (
        <p className="ll-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="ll-filters">
        <select
          aria-label={t("Lọc yêu cầu liên hệ")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          {[
            ["all", "Tất cả yêu cầu"],
            ["unread", "Chưa đọc"],
            ["viewing", "Lịch xem cần xác nhận"],
            ["payment", "Chờ xác nhận chuyển tiền"],
            ["closed", "Đã xử lý"],
          ].map(([key, label]) => (
            <option key={key} value={key}>
              {t(label)}
            </option>
          ))}
        </select>
      </div>
      {!filtered.length ? (
        <EmptyState
          icon={<Inbox />}
          title={t("Chưa có yêu cầu")}
          text={t("Yêu cầu thật từ người thuê sẽ xuất hiện tại đây.")}
        />
      ) : (
        <div className="ll-contact-list">
          {filtered.map((item) => {
            const open = ["new", "contacted", "viewing"].includes(item.status),
              payment = item.payment_report;
            const closed =
              ["resolved", "declined"].includes(item.status) ||
              item.viewing_status === "cancelled";
            return (
              <article
                key={item.id}
                className={item.status === "new" ? "new" : ""}
              >
                <div className="ll-contact-top">
                  <span className="ll-contact-avatar">
                    {t("Khách").slice(0, 1)}
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>
                      {item.property_name}
                      {item.unit_code ? ` · ${item.unit_code}` : ""}
                    </p>
                  </div>
                  <Status value={item.status} />
                </div>
                <blockquote>{item.message}</blockquote>
                {item.viewing_slot && item.viewing_status && (
                  <div className={`ll-viewing ${item.viewing_status}`}>
                    <CalendarClock size={16} />
                    <span>
                      <strong>
                        {formatUi("Giờ xem người thuê chọn: {0}", [
                          dateTime(item.viewing_slot),
                        ])}
                      </strong>
                      <small>{t(viewingLabels[item.viewing_status])}</small>
                    </span>
                    {open && item.viewing_status === "requested" && (
                      <span className="ll-viewing-actions">
                        <button
                          className="primary"
                          disabled={busy === item.id}
                          onClick={() =>
                            void action(item, "viewing", {
                              decision: "confirm",
                              revision: item.revision,
                            })
                          }
                        >
                          <CheckCircle2 size={15} />
                          {t("Xác nhận giờ xem")}
                        </button>
                        <button
                          className="secondary"
                          disabled={busy === item.id}
                          onClick={() => void propose(item)}
                        >
                          {t("Không nhận giờ này")}
                        </button>
                      </span>
                    )}
                  </div>
                )}
                {open && item.viewing_status === "declined" && (
                  <div className="ll-handoff-card">
                    <strong>{t("Giờ bạn đề xuất cho người thuê")}</strong>
                    <ul>
                      {(item.viewing_options || []).map((slot) => (
                        <li key={slot}>{dateTime(slot)}</li>
                      ))}
                    </ul>
                    <button
                      className="secondary"
                      disabled={busy === item.id}
                      onClick={() => void propose(item)}
                    >
                      {t("Cập nhật giờ phù hợp")}
                    </button>
                  </div>
                )}
                {payment && (
                  <div className="ll-handoff-card" role="status">
                    <strong>
                      {t(
                        payment.status === "pending"
                          ? "Người thuê báo đã chuyển tiền"
                          : payment.status === "confirmed"
                            ? "Đã xác nhận nhận tiền · hoàn tất"
                            : "Đã phản hồi chưa nhận / chưa khớp",
                      )}
                    </strong>
                    <p>
                      {formatUi("Số tiền: {0} · ngày chuyển: {1}", [
                        money(payment.amount_vnd),
                        payment.paid_on.slice(0, 10),
                      ])}
                    </p>
                    <p>
                      {formatUi("Thỏa thuận: cọc {0} + tháng đầu {1}", [
                        money(payment.agreement.deposit_vnd || 0),
                        money(payment.agreement.first_month_vnd || 0),
                      ])}
                      {payment.agreement.move_in
                        ? formatUi(" · dọn vào {0}", [
                            payment.agreement.move_in,
                          ])
                        : ""}
                    </p>
                    {payment.reason && <p>{payment.reason}</p>}
                    {payment.status === "pending" && open && (
                      <div className="ll-viewing-actions">
                        <button
                          className="primary"
                          disabled={busy === item.id}
                          onClick={() => {
                            if (
                              window.confirm(
                                t(
                                  "Xác nhận đã nhận khoản tiền này? Yêu cầu sẽ hoàn tất và phòng được đánh dấu đã thuê.",
                                ),
                              )
                            )
                              void action(item, "payment-review", {
                                report_id: payment.id,
                                revision: payment.revision,
                                decision: "confirm",
                              });
                          }}
                        >
                          {t("Xác nhận đã nhận tiền")}
                        </button>
                        <button
                          className="secondary"
                          disabled={busy === item.id}
                          onClick={() => {
                            setRejecting(item);
                            setReason("");
                          }}
                        >
                          {t("Chưa nhận / không khớp")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <small>
                  {formatUi("Nhận lúc {0}", [dateTime(item.created_at)])}
                </small>
                <div className="ll-contact-actions">
                  <button
                    className="text-button"
                    onClick={() =>
                      messenger.open(item.id, item.title, "landlord")
                    }
                  >
                    <MessageSquareText size={15} />
                    {t("Nhắn tin với người thuê")}
                    {item.unread > 0 && (
                      <span className="ll-count">{item.unread}</span>
                    )}
                  </button>
                  {closed && payment?.status !== "pending" && (
                    <button
                      className="text-button"
                      disabled={busy === item.id}
                      onClick={() =>
                        void action(item, "archive", {
                          revision: item.revision,
                        })
                      }
                    >
                      <Trash2 size={15} />
                      {t("Xóa khỏi hộp thư")}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {proposal && (
        <Dialog
          title={t("Đề xuất giờ xem trong 7 ngày tới")}
          onClose={() => {
            if (!busy) setProposal(null);
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await action(proposal, "viewing-options", {
                  revision: proposal.revision,
                  slots: chosen,
                })
              )
                setProposal(null);
            }}
          >
            <p>
              {t(
                "Người thuê chỉ được chọn những giờ bạn đề xuất. Chọn ít nhất một khung giờ phù hợp.",
              )}
            </p>
            <div className="ll-proposal-days">
              {[...new Set(slots.map((slot) => slot.slice(0, 10)))].map(
                (day) => (
                  <fieldset key={day}>
                    <legend>{day.split("-").reverse().join("/")}</legend>
                    <div>
                      {slots
                        .filter((slot) => slot.startsWith(day))
                        .map((slot) => (
                          <label key={slot}>
                            <input
                              type="checkbox"
                              checked={chosen.includes(slot)}
                              onChange={(event) =>
                                setChosen((values) =>
                                  event.target.checked
                                    ? [...values, slot]
                                    : values.filter((value) => value !== slot),
                                )
                              }
                            />
                            {slot.slice(11, 16)}
                          </label>
                        ))}
                    </div>
                  </fieldset>
                ),
              )}
            </div>
            {!slots.length && (
              <p role="status">
                {t(
                  "Chưa có khung giờ khả dụng trong tuần tới. Hãy tải lại sau.",
                )}
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                disabled={Boolean(busy)}
                onClick={() => setProposal(null)}
              >
                {t("Hủy")}
              </button>
              <button
                className="primary"
                disabled={Boolean(busy) || !chosen.length}
              >
                {t("Gửi giờ thay thế")}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {rejecting?.payment_report && (
        <Dialog
          title={t("Phản hồi chuyển tiền")}
          onClose={() => {
            if (!busy) setRejecting(null);
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const payment = rejecting.payment_report!;
              if (
                await action(rejecting, "payment-review", {
                  report_id: payment.id,
                  revision: payment.revision,
                  decision: "reject",
                  reason,
                })
              )
                setRejecting(null);
            }}
          >
            <label>
              {t("Lý do / thông tin cần kiểm tra")}
              <textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button
              className="primary"
              disabled={Boolean(busy) || !reason.trim()}
            >
              {t("Gửi phản hồi")}
            </button>
          </form>
        </Dialog>
      )}
    </section>
  );
}

const viewingLabels: Record<string, string> = {
  requested: "Chờ bạn xác nhận",
  confirmed: "Bạn đã xác nhận; người thuê thấy lịch đã chốt",
  declined: "Bạn không nhận giờ này; người thuê sẽ chọn giờ khác",
  cancelled: "Người thuê đã hủy giờ xem",
};

const verificationLabels: Record<string, string> = {
  phone_call: "Gọi điện",
  video_call: "Gọi video",
  in_person: "Gặp trực tiếp",
};
const hostStatusLabels: Record<string, string> = {
  pending: "Người đăng chờ xác minh",
  verified: "Người đăng đã xác minh",
  needs_info: "Người đăng cần bổ sung hồ sơ",
};

function HostLine({
  status,
  name,
  type,
}: {
  status: string | null;
  name: string | null;
  type: keyof typeof posterLabels | null;
}) {
  return (
    <small className={`ll-host-line ${status || "missing"}`}>
      {name ? `${name} · ` : ""}
      {type ? `${t(posterLabels[type])} · ` : ""}
      {t(status ? hostStatusLabels[status] : "Người đăng chưa có hồ sơ")}
    </small>
  );
}

export function ModerationPanel({
  queue,
  changed,
}: {
  queue: ModerationQueue | null;
  changed: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState(""),
    [reasons, setReasons] = useState<Record<string, string>>({}),
    [methods, setMethods] = useState<Record<string, string>>({});
  async function run(key: string, path: string, body: unknown) {
    setBusy(key);
    setError("");
    try {
      await housingManagement(path, "POST", body);
      await changed();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }
  if (!queue) return null;
  return (
    <section className="ll-panel ll-moderation">
      <div className="ll-section-heading">
        <div>
          <span className="ll-eyebrow">{t("KIỂM DUYỆT")}</span>
          <h2>{t("Hàng chờ duyệt")}</h2>
          <p>
            {t(
              "Xác minh người đăng trước, rồi tới địa điểm và nội dung tin. Bạn không duyệt được hồ sơ, địa điểm hay tin của chính mình.",
            )}
          </p>
        </div>
      </div>
      {error && (
        <p className="ll-form-error" role="alert">
          {error}
        </p>
      )}
      <h3>{formatUi("Người đăng chờ xác minh ({0})", [queue.hosts.length])}</h3>
      {queue.hosts.length === 0 ? (
        <p className="muted">{t("Không có hồ sơ nào đang chờ.")}</p>
      ) : (
        <div className="ll-review-list">
          {queue.hosts.map((h) => (
            <article key={h.user_id}>
              <div>
                <strong>
                  {h.display_name} · {t(posterLabels[h.poster_type])}
                </strong>
                <p>
                  {h.legal_name} ·{" "}
                  <a href={`tel:${h.phone.replace(/[^0-9+]/g, "")}`}>
                    {h.phone}
                  </a>
                </p>
                {(h.broker_license_no || h.business_name || h.tax_code) && (
                  <small>
                    {[
                      h.broker_license_no &&
                        formatUi("Chứng chỉ: {0}", [h.broker_license_no]),
                      h.business_name,
                      h.tax_code && formatUi("MST: {0}", [h.tax_code]),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                )}
                <small>
                  {formatUi("{0} địa điểm, {1} tin đang chờ · cập nhật {2}", [
                    h.pending_properties,
                    h.pending_listings,
                    dateTime(h.updated_at),
                  ])}
                </small>
                <div className="ll-review-inputs">
                  <select
                    aria-label={t("Cách đã xác minh")}
                    value={methods[h.user_id] || ""}
                    onChange={(e) =>
                      setMethods({ ...methods, [h.user_id]: e.target.value })
                    }
                  >
                    <option value="">{t("Chọn cách đã xác minh")}</option>
                    {Object.entries(verificationLabels).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {t(label)}
                        </option>
                      ),
                    )}
                  </select>
                  <input
                    aria-label={t("Ghi chú hoặc lý do cần bổ sung")}
                    placeholder={t("Ghi chú nội bộ, hoặc lý do cần bổ sung")}
                    maxLength={500}
                    value={reasons[h.user_id] || ""}
                    onChange={(e) =>
                      setReasons({ ...reasons, [h.user_id]: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="ll-review-actions">
                <button
                  className="primary"
                  disabled={busy === h.user_id || !methods[h.user_id]}
                  onClick={() =>
                    void run(
                      h.user_id,
                      `moderation/host/${encodeURIComponent(h.user_id)}/review`,
                      {
                        revision: h.revision,
                        decision: "verify",
                        method: methods[h.user_id],
                        note: reasons[h.user_id]?.trim() || undefined,
                      },
                    )
                  }
                >
                  <BadgeCheck size={15} /> {t("Đã xác minh")}
                </button>
                <button
                  className="secondary"
                  disabled={busy === h.user_id}
                  onClick={() =>
                    void run(
                      h.user_id,
                      `moderation/host/${encodeURIComponent(h.user_id)}/review`,
                      {
                        revision: h.revision,
                        decision: "needs_info",
                        reason: reasons[h.user_id]?.trim() || undefined,
                      },
                    )
                  }
                >
                  {t("Cần bổ sung")}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <h3>
        {formatUi("Địa điểm chờ xác minh ({0})", [queue.properties.length])}
      </h3>
      {queue.properties.length === 0 ? (
        <p className="muted">{t("Không có địa điểm nào đang chờ.")}</p>
      ) : (
        <div className="ll-review-list">
          {queue.properties.map((p) => (
            <article key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <p>
                  <MapPin size={14} /> {addressText(p.address)}
                </p>
                <small>
                  {t(propertyLabels[p.property_type] || p.property_type)} ·{" "}
                  {formatUi("gửi lúc {0}", [dateTime(p.requested_at)])}
                </small>
                {p.lat != null && p.lng != null && (
                  <PrivateLocationMap lat={p.lat} lng={p.lng} />
                )}
                {!p.location_confirmed_at && (
                  <p>{t("Địa điểm chưa được xác nhận trên bản đồ.")}</p>
                )}
                <HostLine
                  status={p.host_status}
                  name={p.host_name}
                  type={p.poster_type}
                />
              </div>
              <button
                className="primary"
                disabled={
                  busy === p.id ||
                  p.host_status !== "verified" ||
                  !p.location_confirmed_at
                }
                onClick={() =>
                  void run(
                    p.id,
                    `moderation/housing/properties/${p.id}/approve`,
                    { revision: p.revision },
                  )
                }
              >
                <ShieldCheck size={15} /> {t("Xác minh địa điểm")}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
