import { RequiredMark } from "../components/RequiredMark";
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
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { attentionItems } from "../housingActivity";
import { viewingReminders } from "./viewingDue";
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
import { ContactInbox } from "./ContactInbox";
import { RoomsInventory } from "./RoomsInventory";
import { ListingPreview } from "./ListingPreview";
import {
  ListingGallery,
  ListingsPanel,
  StatisticsPanel,
  ViewingCalendar,
} from "./ManagementPanels";
import { RevenuePanel } from "./RevenuePanel";
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
// Every listing states electricity and water; the service fee (parking included)
// is optional. Earlier rows match by code, by the code their label produces, or
// by an older English code, and keep their own code so saving changes nothing.
const fixedFees = [
  { code: "tien_dien", alias: "electricity", label: "Tiền điện", billing_unit: "kwh", mandatory: true },
  { code: "tien_nuoc", alias: "water", label: "Tiền nước", billing_unit: "m3", mandatory: true },
  { code: "phi_dich_vu", alias: "service", label: "Phí dịch vụ", billing_unit: "month", mandatory: false },
] as const;
// Further fees offered as one-click rows; the owner edits or removes them.
const feeSuggestions: { label: string; billing_unit: string }[] = [
  { label: "Internet", billing_unit: "month" },
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
  const [routeParams] = useSearchParams();
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
    if (editingProfile) return;
    let active = true;
    const refreshProfile = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const page = await housingManagement<HostProfilePage>("host/profile");
        if (active) setHost(page);
      } catch {
        // Keep the last known profile; explicit workspace loads show errors.
      }
    };
    const timer = window.setInterval(() => void refreshProfile(), 15000);
    window.addEventListener("focus", refreshProfile);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshProfile);
    };
  }, [editingProfile]);

  useEffect(() => {
    const refresh = () => void load(true);
    window.addEventListener("housing-contact-update", refresh);
    return () => window.removeEventListener("housing-contact-update", refresh);
  }, [load]);

  useEffect(() => {
    const request = routeParams.get("request"),
      listing = routeParams.get("listing"),
      property = routeParams.get("property");
    if (request) {
      setTab("inbox");
      setInboxThread(request);
      setSelected(null);
      setEditingProfile(false);
    } else if (property) {
      setTab("properties");
      setSelected(property);
      setEditListing(listing);
      setEditingProfile(false);
    } else if (routeParams.has("profile")) setEditingProfile(true);
  }, [routeParams]);
  const newContacts = attentionItems(contacts).total;
  const dueViewings = viewingReminders(contacts).length;
  // Ask once when adding the first home; subsequent homes reuse the account profile.
  const showProfileForm = editingProfile;
  const showHostBanner = Boolean(host);
  const startProperty = () => {
    setTab("properties");
    setSelected(null);
    setCreateProperty(true);
    setEditingProfile(needsProfile(host));
  };
  const tabs: [Tab, string, typeof Inbox, number][] = [
    ["overview", "Tổng quan", BarChart3, 0],
    ["properties", "Nhà & phòng", Building2, 0],
    ["inbox", "Yêu cầu liên hệ", Inbox, newContacts],
    ["listings", "Tin đăng", Home, 0],
    ["calendar", "Lịch xem nhà", CalendarClock, dueViewings],
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
          <button
            className="primary"
            onClick={startProperty}
            disabled={loading}
          >
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
              setInboxThread("");
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
          close={() => {
            setEditingProfile(false);
            setCreateProperty(false);
          }}
          saved={(page) => {
            setHost(page);
            setEditingProfile(false);
          }}
        />
      ) : tab === "overview" ? (
        <OverviewPanel
          overview={overview}
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
        <>
          <StatisticsPanel />
          <RevenuePanel />
        </>
      ) : tab === "properties" ? (
        selected ? (
          <PropertyPanel
            id={selected}
            initialListing={editListing}
            back={() => setSelected(null)}
            changed={load}
          />
        ) : ["rooms", "vacant"].includes(listingFilter) ? (
          <RoomsInventory
            properties={properties}
            vacant={listingFilter === "vacant"}
            open={setSelected}
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
        <ContactInbox
          properties={properties}
          contacts={contacts}
          initialThread={inboxThread}
        >
          {(items) => (
            <InboxPanel
              contacts={items}
              initialThread={inboxThread}
              changed={() => load(true)}
            />
          )}
        </ContactInbox>
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
  go,
}: {
  overview: Overview | null;
  go: (tab: Tab, filter?: string) => void;
}) {
  // Requests, viewings and interest signals have their own tabs; the overview
  // keeps supply and listing work only.
  const stats = [
    ["Nhà đang quản lý", overview?.properties || 0, Building2, "forest", ""],
    ["Phòng trong hệ thống", overview?.units || 0, Home, "blue", "rooms"],
    ["Phòng còn trống", overview?.vacant || 0, CheckCircle2, "teal", "vacant"],
  ] as const;
  return (
    <div className="ll-overview">
      <section className="ll-metrics" aria-label={t("Tình hình vận hành")}>
        {stats.map(([label, value, Icon, tone, filter]) => (
          <button
            type="button"
            key={label}
            className={`ll-metric ${tone}`}
            onClick={() => go("properties", filter)}
          >
            <span>
              <Icon size={20} />
            </span>
            <strong>{value}</strong>
            <p>{t(label)}</p>
          </button>
        ))}
      </section>
      <StatisticsPanel
        compact
        go={(value, filter) => go(value as Tab, filter)}
      />
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
          <span className="field-label">{t("Tên dễ nhận biết")}<RequiredMark /></span>
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
  if (addingUnit || listingUnit)
    return (
      <ListingForm
        key={listingUnit?.id || "new"}
        unit={listingUnit || undefined}
        propertyId={id}
        active={property.management_status === "active"}
        close={() => {
          setAddingUnit(false);
          setListingUnit(null);
          void refresh();
        }}
        done={async () => {
          setAddingUnit(false);
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
              changed={load}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UnitCard({
  unit,
  active,
  edit,
  changed,
}: {
  unit: ManagedUnit;
  active: boolean;
  edit: () => void;
  changed: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [unchanged, setUnchanged] = useState(false);
  async function action(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      await housingManagement(path, method, body);
      await changed();
    } catch (cause) {
      // A rejected listing goes back only after the owner changes something.
      if ((cause as ApiError).code === "listing_unchanged") setUnchanged(true);
      else
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
            {/* Vacancy only means something once tenants can see the listing. */}
            {status === "published" && unit.availability_status && (
              <span className={`ll-availability ${unit.availability_status}`}>
                {t(availabilityLabels[unit.availability_status])}
              </span>
            )}
          </span>
          <p>
            {unit.area_m2 ? `${unit.area_m2} m²` : t("Chưa có diện tích")} ·{" "}
            {formatUi("{0} PN · {1} WC", [
              unit.bedrooms ?? "?",
              unit.bathrooms ?? "?",
            ])}
            {unit.bathroom_type &&
              ` · ${t(unit.bathroom_type === "shared" ? "vệ sinh chung" : "vệ sinh khép kín")}`}
          </p>
          {unit.title && <strong>{unit.title}</strong>}
        </div>
      </div>
      <div className="ll-unit-side">
        {unit.listing_id && (
          <button className="secondary" onClick={() => setPreview(true)}>
            {t("Xem trước")}
          </button>
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
      {unchanged && (
        <Dialog
          title={t("Chưa thể gửi duyệt")}
          onClose={() => setUnchanged(false)}
        >
          <p>{t("Bạn phải bổ sung thêm thông tin phù hợp.")}</p>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setUnchanged(false)}
            >
              {t("Đóng")}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                setUnchanged(false);
                edit();
              }}
            >
              {t("Sửa tin")}
            </button>
          </div>
        </Dialog>
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
  /** A fixed row the form added: left empty, an optional one means "no such fee". */
  added?: boolean;
};

/** Visible required mark; the field's own `required` is what gets announced. */
const Required = () => (
  <span className="ll-required" aria-hidden="true">
    {" *"}
  </span>
);

/** The fixed fees always come first, in order; other rows follow. */
function withFixedFees(rows: FeeRow[]): FeeRow[] {
  const rest = [...rows];
  const fixed = fixedFees.map((fee) => {
    const index = rest.findIndex((row) =>
      [row.code, feeCode(row.label, new Set())].some(
        (code) => code === fee.code || code === fee.alias,
      ),
    );
    if (index >= 0) return rest.splice(index, 1)[0];
    return {
      code: fee.code,
      label: t(fee.label),
      amount: "",
      billing_unit: fee.billing_unit,
      required: true,
      refundable: false,
      added: true,
    };
  });
  return [...fixed, ...rest];
}

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
  propertyId,
  close,
  done,
  active = true,
}: {
  unit?: ManagedUnit;
  propertyId: string;
  active?: boolean;
  close: () => void;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(Boolean(unit?.listing_id));
  const [error, setError] = useState(""),
    [listingId, setListingId] = useState(unit?.listing_id);
  const [existing, setExisting] = useState<ManagedListing | null>(null);
  const [fees, setFees] = useState<FeeRow[]>(() => withFixedFees([]));
  const [bathroomType, setBathroomType] = useState(unit?.bathroom_type || "");
  const [files, setFiles] = useState<File[]>([]);
  const [nonce] = useState(requestId);
  const [roomId, setRoomId] = useState(unit?.id);
  const [roomRevision, setRoomRevision] = useState(unit?.unit_revision || 1);
  const [preview, setPreview] = useState(false);
  const intent = useRef<"save" | "preview" | "submit">("save");
  async function reload(id = listingId) {
    if (id)
      setExisting(
        await housingManagement<ManagedListing>(`landlord/listings/${id}`),
      );
  }

  useEffect(() => {
    if (!unit?.listing_id) return;
    const controller = new AbortController();
    setLoading(true);
    housingManagement<ManagedListing>(
      `landlord/listings/${unit?.listing_id}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((listing) => {
        setExisting(listing);
        setFees(
          withFixedFees(
            listing.fees.map((fee) => ({
              code: fee.code,
              label: fee.label,
              amount: fee.amount == null ? "" : String(fee.amount),
              billing_unit: fee.billing_unit,
              required: fee.required,
              refundable: fee.refundable,
            })),
          ),
        );
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [unit?.listing_id]);

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
        // An empty optional fee the form added means "none"; a saved fee with
        // no amount stays "amount unknown" until the owner fills it in.
        .filter(
          (row, index) =>
            row.label.trim() &&
            !(
              row.added &&
              fixedFees[index]?.mandatory === false &&
              row.amount === ""
            ),
        )
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
      if (
        !files.length &&
        !(existing?.media || []).some(
          (image) => image.moderation_status !== "rejected",
        )
      )
        throw new Error(t("Hãy tải ít nhất một ảnh phòng hợp lệ."));
      if (
        files.some(
          (file) =>
            !["image/jpeg", "image/png"].includes(file.type) ||
            file.size > 5 * 1024 * 1024,
        )
      )
        throw new Error(t("Ảnh phải là JPEG/PNG hợp lệ, tối đa 5 MB."));
      const room = {
        unit_code: String(f.get("unit_code") || "").trim(),
        area_m2: Number(f.get("area_m2")),
        bedrooms: Number(f.get("bedrooms")),
        bathrooms: Number(f.get("bathrooms")),
        bathroom_type: bathroomType || null,
        // Amenities are now written in the description; keep earlier tags as they were.
        amenities: unit?.amenities || [],
      };
      const result = await housingManagement<{
        id: string;
        unit_id: string;
        unit_revision: number;
      }>(
        roomId
          ? `landlord/units/${roomId}/room-listing`
          : `landlord/properties/${propertyId}/room-listing`,
        roomId ? "PUT" : "POST",
        {
          request_id: nonce,
          unit: room,
          listing: payload,
          ...(roomId
            ? {
                unit_revision: roomRevision,
                listing_revision: existing?.revision ?? unit?.revision,
              }
            : {}),
        },
      );
      const id = result.id;
      setRoomId(result.unit_id);
      setRoomRevision(result.unit_revision);
      setListingId(id);
      savedId = id;
      if (id) {
        await reload(id);
        for (const file of files) {
          await uploadListingImage(id, file, String(payload.title));
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
          <span className="ll-eyebrow">{t("BƯỚC 2")}</span>
          <h2>
            {listingId ? t("Cập nhật tin") : t("Thêm phòng và đăng tin")}
          </h2>
          <p>
            {t(
              "Nhập thông tin phòng và nội dung tin trong một lần. Ghi rõ toàn bộ chi phí để người thuê ước tính đúng ngân sách.",
            )}
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
        <h3 className="wide ll-form-section">{t("Thông tin phòng")}</h3>
        <label>
          <span>{t("Mã phòng")}<Required /></span>
          <input
            name="unit_code"
            required
            maxLength={80}
            defaultValue={unit?.unit_code || ""}
            placeholder="P.301"
          />
        </label>
        <label>
          <span>{t("Diện tích (m²)")}<Required /></span>
          <input
            name="area_m2"
            required
            type="number"
            min="1"
            step="0.1"
            defaultValue={unit?.area_m2 ?? undefined}
          />
        </label>
        <label>
          <span>{t("Phòng ngủ")}<Required /></span>
          <input
            name="bedrooms"
            required
            type="number"
            min="0"
            step="0.5"
            defaultValue={unit?.bedrooms ?? 0}
          />
        </label>
        <fieldset className="wide ll-bathroom">
          <legend>{t("Phòng tắm")}<Required /></legend>
          <div className="ll-choice-row">
            {(
              [
                ["shared", "Phòng vệ sinh chung"],
                ["private", "Phòng vệ sinh khép kín"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={"ll-choice" + (bathroomType === value ? " active" : "")}
              >
                <input
                  type="radio"
                  name="bathroom_type"
                  value={value}
                  required
                  checked={bathroomType === value}
                  onChange={() => setBathroomType(value)}
                />
                {t(label)}
              </label>
            ))}
          </div>
          {bathroomType && (
            <label className="ll-bathroom-count">
              <span className="field-label">{t(
                bathroomType === "shared"
                  ? "Số phòng vệ sinh chung"
                  : "Số phòng vệ sinh khép kín",
              )}<RequiredMark /></span>
              <input
                name="bathrooms"
                required
                type="number"
                min="1"
                step="0.5"
                defaultValue={unit?.bathrooms || 1}
              />
            </label>
          )}
        </fieldset>
        <h3 className="wide ll-form-section">{t("Nội dung tin đăng")}</h3>
        <label className="wide">
          <span>{t("Tiêu đề")}<Required /></span>
          <input
            name="title"
            required
            minLength={5}
            maxLength={240}
            defaultValue={existing?.title || unit?.title || ""}
            placeholder={t("Phòng sáng thoáng, gần trường học")}
          />
        </label>
        <label className="wide">
          <span>{t("Mô tả tiện ích")}<Required /></span>
          <textarea
            name="description"
            required
            rows={5}
            maxLength={5000}
            defaultValue={existing?.description || ""}
            placeholder={t(
              "Không gian, nội thất, tiện ích (wifi, máy lạnh, chỗ để xe…), quy định và những điều người thuê cần biết…",
            )}
          />
        </label>
        <label>
          <span>{t("Giá thuê / tháng")}<Required /></span>
          <input
            name="rent_vnd"
            type="number"
            min="1"
            required
            defaultValue={existing?.rent_vnd}
          />
        </label>
        <label>
          <span>{t("Tiền cọc")}<Required /></span>
          <input
            name="deposit_vnd"
            type="number"
            min="0"
            required
            defaultValue={existing?.deposit_vnd ?? undefined}
          />
        </label>
        <label>
          <span>{t("Ngày có thể vào ở")}<Required /></span>
          <input
            name="availability_from"
            type="date"
            required
            defaultValue={existing?.availability_from?.slice(0, 10) || ""}
          />
        </label>
        <fieldset className="wide ll-fees">
          <legend>{t("Các khoản phí")}<Required /></legend>
          <p className="ll-form-hint">
            {t(
              "Tiền điện và tiền nước là bắt buộc. Các khoản dịch vụ chỉ nhập nếu có.",
            )}
          </p>
          {fees.map((row, index) =>
            index < fixedFees.length ? (
              <div className="ll-fee-row ll-fee-fixed" key={row.code}>
                <span className="ll-fee-name">
                  <strong>
                    {row.label}
                    {fixedFees[index].mandatory && <Required />}
                  </strong>
                  {!fixedFees[index].mandatory && (
                    <small>{t("Nếu có · gồm cả phí giữ xe")}</small>
                  )}
                </span>
                <input
                  aria-label={formatUi("Số tiền {0}", [row.label])}
                  type="number"
                  min="0"
                  required={fixedFees[index].mandatory}
                  value={row.amount}
                  placeholder={t(
                    fixedFees[index].mandatory
                      ? "Nhập số tiền"
                      : row.added
                        ? "Nếu có"
                        : "Chưa rõ",
                  )}
                  onChange={(e) => setFee(index, { amount: e.target.value })}
                />
                <select
                  aria-label={formatUi("Đơn vị tính {0}", [row.label])}
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
              </div>
            ) : (
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
            ),
          )}
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
              intent.current = "save";
            }}
          >
            {busy && <LoaderCircle className="spin" />} {t("Lưu bản nháp")}
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
            className="primary"
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
            <Send size={16} /> {t("Lưu và gửi duyệt")}
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
  // The proposal window comes from the server setting HOUSING_VIEWING_PROPOSAL_DAYS.
  const [proposalDays, setProposalDays] = useState(7);
  const [rejecting, setRejecting] = useState<ContactRequest | null>(null),
    [reason, setReason] = useState("");
  const initialOpened = useRef("");
  useEffect(() => {
    const item = contacts.find((row) => row.id === initialThread);
    if (item && initialOpened.current !== item.id) {
      initialOpened.current = item.id;
      document
        .getElementById("contact-request-" + item.id)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
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
      if (Number.isInteger(page.days) && page.days > 0) setProposalDays(page.days);
      setSlots(
        (page.slots || []).filter(
          (slot: string) =>
            Date.parse(slot) !== Date.parse(item.viewing_slot || ""),
        ),
      );
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
                id={"contact-request-" + item.id}
                tabIndex={-1}
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
          title={formatUi("Đề xuất giờ xem trong {0} ngày tới", [proposalDays])}
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
              <span className="field-label">{t("Lý do / thông tin cần kiểm tra")}<RequiredMark /></span>
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
  viewerId,
}: {
  queue: ModerationQueue | null;
  changed: () => Promise<void>;
  viewerId: string;
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
            <article key={h.user_id} id={"moderation-identity-"+h.user_id} tabIndex={-1}>
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
                {(h.user_id === viewerId || h.can_review === false) && (
                  <p className="ll-form-hint">
                    {t("Hồ sơ của bạn cần một Admin khác xác minh.")}
                  </p>
                )}
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
                  disabled={
                    busy === h.user_id ||
                    !methods[h.user_id] ||
                    h.user_id === viewerId ||
                    h.can_review === false
                  }
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
                  disabled={
                    busy === h.user_id ||
                    h.user_id === viewerId ||
                    h.can_review === false
                  }
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
            <article key={p.id} id={"moderation-identity-"+p.id} tabIndex={-1}>
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
                  p.user_id === viewerId ||
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
