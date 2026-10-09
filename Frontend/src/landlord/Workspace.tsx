import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  BadgeCheck,
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
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api, dateTime, money } from "../api";
import type { Data } from "../types";
import { formatUi, t } from "../uiPreferences";
import { EmptyState } from "../components/UiStates";
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
import "./landlord.css";

type Tab = "overview" | "properties" | "inbox" | "moderation";

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
  published: "Đang hiển thị",
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
  const [queue, setQueue] = useState<ModerationQueue | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createProperty, setCreateProperty] = useState(false);
  const [host, setHost] = useState<HostProfilePage | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);

  const loadQueue = useCallback(async () => {
    // Moderators are configured on the server; everyone else gets 403 and never sees the tab.
    try {
      setQueue(
        await housingManagement<ModerationQueue>("moderation/housing/queue"),
      );
    } catch {
      setQueue(null);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [hostPage, summary, propertyPage, inbox] = await Promise.all([
        housingManagement<HostProfilePage>("host/profile"),
        housingManagement<Overview>("landlord/overview"),
        housingManagement<{ items: PropertySummary[] }>("landlord/properties"),
        housingManagement<{ items: ContactRequest[] }>(
          "landlord/contact-requests",
        ),
        loadQueue(),
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
  }, [loadQueue]);

  useEffect(() => {
    void load();
  }, [load]);

  const newContacts = contacts.filter((item) => item.status === "new").length;
  const pendingReviews = queue
    ? queue.hosts.length + queue.properties.length + queue.listings.length
    : 0;
  // First visit in owner mode: the poster profile comes before anything else (host-mode-design §3.2).
  // Moderators who do not post themselves are not pushed into the poster form or banner.
  const showProfileForm =
    editingProfile ||
    (host !== null && !host.profile && properties.length === 0 && !queue);
  const showHostBanner = Boolean(host && (host.profile || !queue));
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
    ...(queue
      ? ([["moderation", "Duyệt tin", ShieldCheck, pendingReviews]] as [
          Tab,
          string,
          typeof Inbox,
          number,
        ][])
      : []),
  ];

  return (
    <div className="ll-workspace">
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
            void loadQueue();
          }}
        />
      ) : tab === "overview" ? (
        <OverviewPanel
          overview={overview}
          properties={properties}
          contacts={contacts}
          go={setTab}
        />
      ) : tab === "properties" ? (
        selected ? (
          <PropertyPanel
            id={selected}
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
        <InboxPanel contacts={contacts} changed={load} />
      ) : (
        <ModerationPanel queue={queue} changed={load} />
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
  go: (tab: Tab) => void;
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

type Place = { label: string; lat: number; lng: number };

function PropertyForm({
  close,
  done,
}: {
  close: () => void;
  done: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [address, setAddress] = useState(""),
    [places, setPlaces] = useState<Place[]>([]),
    [searching, setSearching] = useState(false),
    [point, setPoint] = useState<{ lat: string; lng: string }>({
      lat: "",
      lng: "",
    });
  async function findPlace() {
    setSearching(true);
    setError("");
    try {
      // Same verified place search as the moving form; the owner still confirms the point.
      const found = await api<Data>(
        "/map/search?text=" + encodeURIComponent(address),
      );
      // An administrative area centroid is not a house location.
      const results: Place[] = (found.results || [])
        .filter(
          (r: Data) => r.location && r.entity_type !== "administrative_area",
        )
        .map((r: Data) => ({
          label: r.display_name || r.name || "",
          lat: r.location.lat,
          lng: r.location.lng,
        }));
      setPlaces(results);
      if (!results.length)
        setError(t("Không tìm thấy vị trí phù hợp; hãy nhập tọa độ."));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSearching(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await housingManagement<{ id: string }>(
        "landlord/properties",
        "POST",
        {
          name: form.get("name"),
          property_type: form.get("property_type"),
          address: { full_address: address },
          location: { lat: Number(point.lat), lng: Number(point.lng) },
        },
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
          <h2>{t("Thêm nhà hoặc tòa nhà")}</h2>
          <p>
            {t(
              "Thông tin sẽ được xác minh trước khi tin đầu tiên được hiển thị.",
            )}
          </p>
        </div>
        <button className="icon-button" onClick={close} aria-label={t("Đóng")}>
          <X />
        </button>
      </div>
      <form className="ll-form" onSubmit={submit}>
        <label className="wide">
          {t("Tên dễ nhận biết")}
          <input
            name="name"
            required
            minLength={2}
            maxLength={160}
            placeholder={t("Ví dụ: Nhà trọ Nguyễn Trãi")}
          />
        </label>
        <label>
          {t("Loại hình")}
          <select name="property_type" defaultValue="room">
            {Object.entries(propertyLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          {t("Địa chỉ đầy đủ")}
          <span className="ll-inline-search">
            <input
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t(
                "Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành",
              )}
            />
            <button
              type="button"
              className="secondary"
              disabled={searching || address.trim().length < 2}
              onClick={() => void findPlace()}
            >
              <Search size={15} /> {t("Tìm vị trí")}
            </button>
          </span>
        </label>
        {places.length > 0 && (
          <div
            className="wide ll-place-results"
            role="group"
            aria-label={t("Vị trí gợi ý")}
          >
            {places.map((p) => (
              <button
                type="button"
                key={`${p.lat},${p.lng}`}
                className={
                  point.lat === String(p.lat) && point.lng === String(p.lng)
                    ? "active"
                    : ""
                }
                onClick={() =>
                  setPoint({ lat: String(p.lat), lng: String(p.lng) })
                }
              >
                <MapPin size={14} /> {p.label}
              </button>
            ))}
          </div>
        )}
        <label>
          {t("Vĩ độ")}
          <input
            type="number"
            min="8"
            max="24"
            step="any"
            required
            value={point.lat}
            onChange={(e) => setPoint({ ...point, lat: e.target.value })}
          />
        </label>
        <label>
          {t("Kinh độ")}
          <input
            type="number"
            min="102"
            max="110"
            step="any"
            required
            value={point.lng}
            onChange={(e) => setPoint({ ...point, lng: e.target.value })}
          />
        </label>
        <p className="ll-form-hint wide">
          <MapPin size={16} />{" "}
          {t(
            "Chọn vị trí gợi ý hoặc nhập tọa độ; kiểm tra kỹ để nhà hiện đúng chỗ trên bản đồ.",
          )}
        </p>
        {error && (
          <p className="ll-form-error wide" role="alert">
            {error}
          </p>
        )}
        <div className="ll-form-actions wide">
          <button type="button" className="secondary" onClick={close}>
            {t("Hủy")}
          </button>
          <button className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : <Plus />}{" "}
            {t("Thêm nhà")}
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
}: {
  id: string;
  back: () => void;
  changed: () => Promise<void>;
}) {
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [error, setError] = useState("");
  const [addingUnit, setAddingUnit] = useState(false);
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
  if (addingUnit)
    return (
      <UnitForm
        propertyId={id}
        close={() => setAddingUnit(false)}
        done={async () => {
          setAddingUnit(false);
          await refresh();
        }}
      />
    );
  if (listingUnit)
    return (
      <ListingForm
        unit={listingUnit}
        close={() => setListingUnit(null)}
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
        <button className="primary" onClick={() => setAddingUnit(true)}>
          <Plus size={17} /> {t("Thêm phòng")}
        </button>
      </div>
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

function UnitForm({
  propertyId,
  close,
  done,
}: {
  propertyId: string;
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
        `landlord/properties/${propertyId}/units`,
        "POST",
        {
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
          <h2>{t("Thêm phòng hoặc căn")}</h2>
        </div>
        <button className="icon-button" onClick={close} aria-label={t("Đóng")}>
          <X />
        </button>
      </div>
      <form className="ll-form" onSubmit={submit}>
        <label>
          {t("Mã phòng")}
          <input name="unit_code" required placeholder="P.301" />
        </label>
        <label>
          {t("Diện tích (m²)")}
          <input name="area_m2" type="number" min="1" step="0.1" />
        </label>
        <label>
          {t("Phòng ngủ")}
          <input name="bedrooms" type="number" min="0" step="0.5" />
        </label>
        <label>
          {t("Phòng tắm")}
          <input name="bathrooms" type="number" min="0" step="0.5" />
        </label>
        <label className="wide">
          {t("Tiện ích, cách nhau bằng dấu phẩy")}
          <input
            name="amenities"
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
            {t("Thêm phòng")}
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
  changed,
}: {
  unit: ManagedUnit;
  active: boolean;
  edit: () => void;
  changed: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function action(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      await housingManagement(path, method, body);
      await changed();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const status = unit.publication_status;
  const editable = !status || ["draft", "rejected", "hidden"].includes(status);
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
                void action(`landlord/listings/${unit.listing_id}/submit`, {})
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
}: {
  unit: ManagedUnit;
  close: () => void;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(Boolean(unit.listing_id));
  const [error, setError] = useState(""),
    [listingId, setListingId] = useState(unit.listing_id);
  const [existing, setExisting] = useState<ManagedListing | null>(null);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [file, setFile] = useState<File | null>(null);

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
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    const payload = {
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
      if (file && id)
        await uploadListingImage(
          id,
          file,
          String(f.get("image_alt") || payload.title),
        );
      done();
    } catch (cause) {
      setError((cause as Error).message);
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
      <form className="ll-form ll-listing-form" onSubmit={submit}>
        <label className="wide">
          {t("Tiêu đề")}
          <input
            name="title"
            required
            minLength={5}
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
            min="1"
            required
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
            accept="image/jpeg,image/png"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
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
          <button className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : <CheckCircle2 />}{" "}
            {t("Lưu bản nháp")}
          </button>
        </div>
      </form>
    </section>
  );
}

function InboxPanel({
  contacts,
  changed,
}: {
  contacts: ContactRequest[];
  changed: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  async function update(
    item: ContactRequest,
    status: ContactRequest["status"],
  ) {
    setBusy(item.id);
    setError("");
    try {
      await housingManagement(`landlord/contact-requests/${item.id}`, "PATCH", {
        status,
        revision: item.revision,
      });
      await changed();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="ll-panel ll-inbox">
      <div className="ll-section-heading">
        <div>
          <span className="ll-eyebrow">{t("HỘP THƯ QUAN TÂM")}</span>
          <h2>{t("Yêu cầu liên hệ")}</h2>
          <p>
            {t(
              "Chỉ tài khoản quản lý đã xác minh mới thấy và xử lý các yêu cầu này.",
            )}
          </p>
        </div>
      </div>
      {error && (
        <p className="ll-form-error" role="alert">
          {error}
        </p>
      )}
      {contacts.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={t("Chưa có yêu cầu")}
          text={t("Yêu cầu thật từ người thuê sẽ xuất hiện tại đây.")}
        />
      ) : (
        <div className="ll-contact-list">
          {contacts.map((item) => {
            const open = ["new", "contacted", "viewing"].includes(item.status);
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
                <small>
                  {formatUi("Nhận lúc {0}", [dateTime(item.created_at)])}
                </small>
                {open && (
                  <div className="ll-contact-actions">
                    {item.status === "new" && (
                      <button
                        className="primary"
                        disabled={busy === item.id}
                        onClick={() => void update(item, "contacted")}
                      >
                        {t("Đã liên hệ")}
                      </button>
                    )}
                    {item.status !== "viewing" && (
                      <button
                        className="secondary"
                        disabled={busy === item.id}
                        onClick={() => void update(item, "viewing")}
                      >
                        {t("Đã hẹn xem")}
                      </button>
                    )}
                    <button
                      className="text-button"
                      disabled={busy === item.id}
                      onClick={() => void update(item, "resolved")}
                    >
                      {t("Hoàn tất")}
                    </button>
                    <button
                      className="text-button"
                      disabled={busy === item.id}
                      onClick={() => void update(item, "declined")}
                    >
                      {t("Từ chối")}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

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

function ModerationPanel({
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
                <HostLine
                  status={p.host_status}
                  name={p.host_name}
                  type={p.poster_type}
                />
              </div>
              <button
                className="primary"
                disabled={busy === p.id || p.host_status !== "verified"}
                onClick={() =>
                  void run(
                    p.id,
                    `moderation/housing/properties/${p.id}/approve`,
                    {},
                  )
                }
              >
                <ShieldCheck size={15} /> {t("Xác minh địa điểm")}
              </button>
            </article>
          ))}
        </div>
      )}
      <h3>{formatUi("Tin chờ duyệt ({0})", [queue.listings.length])}</h3>
      {queue.listings.length === 0 ? (
        <p className="muted">{t("Không có tin nào đang chờ.")}</p>
      ) : (
        <div className="ll-review-list">
          {queue.listings.map((l) => (
            <article key={l.id}>
              <div>
                <strong>{l.title}</strong>
                <p>
                  {l.property_name}
                  {l.unit_code ? ` · ${l.unit_code}` : ""} ·{" "}
                  {addressText(l.address)}
                </p>
                <small>
                  {formatUi("Thuê {0} · cọc {1} · {2} khoản phí", [
                    money(l.rent_vnd),
                    l.deposit_vnd != null ? money(l.deposit_vnd) : t("chưa rõ"),
                    l.fee_count,
                  ])}
                </small>
                {l.description && (
                  <p className="ll-review-text">{l.description}</p>
                )}
                {l.pending_media.length > 0 && (
                  <div className="ll-review-media">
                    {l.pending_media.map((m) => (
                      <img
                        key={m.url}
                        src={m.url}
                        alt={m.alt || l.title}
                        loading="lazy"
                      />
                    ))}
                  </div>
                )}
                <HostLine
                  status={l.host_status}
                  name={l.host_name}
                  type={l.poster_type}
                />
                {l.property_status !== "active" && (
                  <p className="ll-form-error">
                    {t("Địa điểm của tin chưa được xác minh.")}
                  </p>
                )}
                <input
                  aria-label={t("Lý do cần bổ sung")}
                  placeholder={t("Lý do cần bổ sung (khi trả lại)")}
                  maxLength={500}
                  value={reasons[l.id] || ""}
                  onChange={(e) =>
                    setReasons({ ...reasons, [l.id]: e.target.value })
                  }
                />
              </div>
              <div className="ll-review-actions">
                <button
                  className="primary"
                  disabled={
                    busy === l.id ||
                    l.property_status !== "active" ||
                    l.host_status !== "verified"
                  }
                  onClick={() =>
                    void run(
                      l.id,
                      `moderation/housing/listings/${l.id}/review`,
                      { decision: "approve" },
                    )
                  }
                >
                  <CheckCircle2 size={15} /> {t("Duyệt và hiển thị")}
                </button>
                <button
                  className="secondary"
                  disabled={busy === l.id}
                  onClick={() =>
                    void run(
                      l.id,
                      `moderation/housing/listings/${l.id}/review`,
                      {
                        decision: "reject",
                        reason: reasons[l.id]?.trim() || undefined,
                      },
                    )
                  }
                >
                  {t("Trả lại để bổ sung")}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
