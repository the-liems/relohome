import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  Building2,
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
  Send,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { dateTime } from "../api";
import { EmptyState } from "../components/UiStates";
import { housingManagement, uploadListingImage } from "./client";
import type {
  AvailabilityStatus,
  ContactRequest,
  ManagedListing,
  ManagedUnit,
  Overview,
  PropertyDetail,
  PropertySummary,
  PublicationStatus,
} from "./types";
import "./landlord.css";

type Tab = "overview" | "properties" | "inbox";

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

function addressText(address: Record<string, unknown>) {
  return String(address.full_address || address.formatted || address.address || "Chưa có địa chỉ");
}

function ErrorPanel({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="ll-error" role="alert">
      <CircleAlert aria-hidden="true" />
      <div><strong>Chưa tải được dữ liệu</strong><p>{message}</p></div>
      <button className="secondary" onClick={retry}><RefreshCw size={16} /> Thử lại</button>
    </div>
  );
}

export function LandlordWorkspace() {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [properties, setProperties] = useState<PropertySummary[]>([]);
  const [contacts, setContacts] = useState<ContactRequest[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createProperty, setCreateProperty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summary, propertyPage, inbox] = await Promise.all([
        housingManagement<Overview>("landlord/overview"),
        housingManagement<{ items: PropertySummary[] }>("landlord/properties"),
        housingManagement<{ items: ContactRequest[] }>("landlord/contact-requests"),
      ]);
      setOverview(summary);
      setProperties(propertyPage.items);
      setContacts(inbox.items);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="ll-workspace">
      <header className="ll-heading">
        <div>
          <span className="ll-kicker"><Building2 size={14} /> KHÔNG GIAN CHỦ TRỌ</span>
          <h1>Quản lý nhà cho thuê</h1>
          <p>Cập nhật nguồn cung, theo dõi quan tâm và xử lý yêu cầu từ người thuê tại một nơi.</p>
        </div>
        <div className="ll-heading-actions">
          <Link className="secondary" to="/ai"><ArrowLeft size={16} /> Về ReloHome</Link>
          <button className="primary" onClick={() => { setTab("properties"); setCreateProperty(true); }}>
            <Plus size={17} /> Thêm nhà
          </button>
        </div>
      </header>

      <nav className="ll-nav" aria-label="Quản lý nhà cho thuê">
        {([
          ["overview", "Tổng quan", BarChart3],
          ["properties", "Nhà & phòng", Building2],
          ["inbox", "Yêu cầu liên hệ", Inbox],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setSelected(null); }}>
            <Icon size={17} /> {label}
            {key === "inbox" && contacts.filter((item) => item.status === "new").length > 0 && (
              <span className="ll-count">{contacts.filter((item) => item.status === "new").length}</span>
            )}
          </button>
        ))}
      </nav>

      {error ? <ErrorPanel message={error} retry={() => void load()} /> : loading ? (
        <div className="ll-loading" role="status"><LoaderCircle className="spin" /> Đang chuẩn bị không gian quản lý…</div>
      ) : tab === "overview" ? (
        <OverviewPanel overview={overview} properties={properties} contacts={contacts} go={setTab} />
      ) : tab === "properties" ? selected ? (
        <PropertyPanel id={selected} back={() => setSelected(null)} changed={load} />
      ) : (
        <PropertiesPanel
          properties={properties}
          open={setSelected}
          creating={createProperty}
          setCreating={setCreateProperty}
          changed={load}
        />
      ) : (
        <InboxPanel contacts={contacts} changed={load} />
      )}
    </div>
  );
}

function OverviewPanel({ overview, properties, contacts, go }: {
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
      <section className="ll-metrics" aria-label="Tình hình vận hành">
        {stats.map(([label, value, Icon, tone]) => (
          <article key={label} className={`ll-metric ${tone}`}>
            <span><Icon size={20} /></span><strong>{value}</strong><p>{label}</p>
          </article>
        ))}
      </section>
      <div className="ll-overview-grid">
        <section className="ll-panel ll-performance">
          <div className="ll-section-heading">
            <div><span className="ll-eyebrow">HIỆU QUẢ TIN ĐĂNG</span><h2>Tín hiệu quan tâm thực tế</h2></div>
            {hasMeasurement && <small>Từ {dateTime(overview!.measured_since!)}</small>}
          </div>
          {hasMeasurement ? (
            <div className="ll-signal-grid">
              <div><Eye /><strong>{overview?.detail_views || 0}</strong><span>Lượt xem chi tiết</span></div>
              <div><Sparkles /><strong>{overview?.saves || 0}</strong><span>Lượt lưu</span></div>
              <div><Users /><strong>{overview?.contact_requests || 0}</strong><span>Yêu cầu liên hệ</span></div>
            </div>
          ) : (
            <div className="ll-empty-inline"><BarChart3 /><div><strong>Chưa đủ dữ liệu đo lường</strong><p>Số liệu sẽ xuất hiện khi tin đã duyệt bắt đầu có lượt xem, lưu hoặc liên hệ thật.</p></div></div>
          )}
        </section>
        <section className="ll-panel">
          <div className="ll-section-heading"><div><span className="ll-eyebrow">CẦN XỬ LÝ</span><h2>Việc tiếp theo</h2></div></div>
          <div className="ll-next-list">
            <button onClick={() => go("properties")}><span>{properties.filter((p) => p.status === "pending").length}</span><div><strong>Nhà chờ xác minh</strong><small>Hoàn thiện thông tin trước khi đăng tin</small></div><ChevronRight /></button>
            <button onClick={() => go("inbox")}><span>{contacts.filter((c) => c.status === "new").length}</span><div><strong>Yêu cầu liên hệ mới</strong><small>Phản hồi người thuê đang quan tâm</small></div><ChevronRight /></button>
          </div>
        </section>
      </div>
    </div>
  );
}

function PropertiesPanel({ properties, open, creating, setCreating, changed }: {
  properties: PropertySummary[];
  open: (id: string) => void;
  creating: boolean;
  setCreating: (value: boolean) => void;
  changed: () => Promise<void>;
}) {
  if (creating) return <PropertyForm close={() => setCreating(false)} done={async (id) => { setCreating(false); await changed(); open(id); }} />;
  return (
    <section className="ll-panel ll-properties">
      <div className="ll-section-heading">
        <div><span className="ll-eyebrow">DANH MỤC QUẢN LÝ</span><h2>Nhà và tòa nhà</h2><p>Mỗi địa điểm có thể chứa nhiều phòng hoặc căn cho thuê.</p></div>
        <button className="primary" onClick={() => setCreating(true)}><Plus size={17} /> Thêm nhà</button>
      </div>
      {properties.length === 0 ? (
        <EmptyState icon={<Building2 />} title="Chưa có nhà nào" text="Thêm địa điểm đầu tiên, sau đó tạo phòng và tin cho thuê." />
      ) : (
        <div className="ll-property-list">
          {properties.map((property) => (
            <button key={property.id} onClick={() => open(property.id)}>
              <span className="ll-property-icon"><Building2 /></span>
              <div className="ll-property-copy"><span className="ll-property-row"><strong>{property.name}</strong><Status value={property.status} /></span><p><MapPin size={14} /> {addressText(property.address)}</p><small>{propertyLabels[property.property_type] || property.property_type}</small></div>
              <div className="ll-property-facts"><span><strong>{property.unit_count}</strong> phòng</span><span><strong>{property.vacant_count}</strong> còn trống</span></div>
              <ChevronRight />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function PropertyForm({ close, done }: { close: () => void; done: (id: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await housingManagement<{ id: string }>("landlord/properties", "POST", {
        name: form.get("name"), property_type: form.get("property_type"),
        address: { full_address: form.get("address") },
        location: { lat: Number(form.get("lat")), lng: Number(form.get("lng")) },
      });
      done(result.id);
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  }
  return (
    <section className="ll-panel ll-form-panel">
      <div className="ll-section-heading"><div><span className="ll-eyebrow">BƯỚC 1</span><h2>Thêm nhà hoặc tòa nhà</h2><p>Thông tin sẽ được xác minh trước khi tin đầu tiên được hiển thị.</p></div><button className="icon-button" onClick={close} aria-label="Đóng"><X /></button></div>
      <form className="ll-form" onSubmit={submit}>
        <label className="wide">Tên dễ nhận biết<input name="name" required minLength={2} maxLength={160} placeholder="Ví dụ: Nhà trọ Nguyễn Trãi" /></label>
        <label>Loại hình<select name="property_type" defaultValue="room">{Object.entries(propertyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="wide">Địa chỉ đầy đủ<input name="address" required placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành" /></label>
        <label>Vĩ độ<input name="lat" type="number" min="8" max="24" step="any" required placeholder="21.0285" /></label>
        <label>Kinh độ<input name="lng" type="number" min="102" max="110" step="any" required placeholder="105.8542" /></label>
        <p className="ll-form-hint wide"><MapPin size={16} /> Tọa độ giúp nhà xuất hiện đúng vị trí trên bản đồ. Hãy kiểm tra kỹ trước khi gửi.</p>
        {error && <p className="ll-form-error wide" role="alert">{error}</p>}
        <div className="ll-form-actions wide"><button type="button" className="secondary" onClick={close}>Hủy</button><button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Plus />} Thêm nhà</button></div>
      </form>
    </section>
  );
}

function PropertyPanel({ id, back, changed }: { id: string; back: () => void; changed: () => Promise<void> }) {
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [error, setError] = useState("");
  const [addingUnit, setAddingUnit] = useState(false);
  const [listingUnit, setListingUnit] = useState<ManagedUnit | null>(null);
  const load = useCallback(async () => {
    setError("");
    try { setProperty(await housingManagement<PropertyDetail>(`landlord/properties/${id}`)); }
    catch (cause) { setError((cause as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <ErrorPanel message={error} retry={() => void load()} />;
  if (!property) return <div className="ll-loading"><LoaderCircle className="spin" /> Đang tải nhà…</div>;
  if (addingUnit) return <UnitForm propertyId={id} close={() => setAddingUnit(false)} done={async () => { setAddingUnit(false); await load(); await changed(); }} />;
  if (listingUnit) return <ListingForm unit={listingUnit} close={() => setListingUnit(null)} done={async () => { setListingUnit(null); await load(); await changed(); }} />;
  return (
    <section className="ll-panel ll-property-detail">
      <button className="ll-back" onClick={back}><ArrowLeft size={16} /> Tất cả nhà</button>
      <div className="ll-property-hero">
        <span className="ll-property-icon large"><Building2 /></span>
        <div><div className="ll-property-row"><h2>{property.name}</h2><Status value={property.management_status} /></div><p><MapPin size={15} /> {addressText(property.address)}</p><small>{propertyLabels[property.property_type] || property.property_type}</small></div>
        <button className="primary" onClick={() => setAddingUnit(true)}><Plus size={17} /> Thêm phòng</button>
      </div>
      {property.management_status === "pending" && <div className="ll-review-note"><CircleAlert /><div><strong>Địa điểm đang chờ xác minh</strong><p>Bạn có thể chuẩn bị phòng và bản nháp. Tin chỉ hiển thị sau khi địa điểm và nội dung được duyệt.</p></div></div>}
      <div className="ll-section-heading compact"><div><span className="ll-eyebrow">NGUỒN CUNG</span><h3>{property.units.length} phòng / căn</h3></div></div>
      {property.units.length === 0 ? <EmptyState icon={<Home />} title="Chưa có phòng" text="Thêm từng phòng hoặc căn để quản lý giá và trạng thái riêng." /> : (
        <div className="ll-unit-list">{property.units.map((unit) => <UnitCard key={unit.id} unit={unit} active={property.management_status === "active"} edit={() => setListingUnit(unit)} changed={load} />)}</div>
      )}
    </section>
  );
}

function UnitForm({ propertyId, close, done }: { propertyId: string; close: () => void; done: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const f = new FormData(event.currentTarget);
    try {
      await housingManagement(`landlord/properties/${propertyId}/units`, "POST", {
        unit_code: f.get("unit_code"), bedrooms: Number(f.get("bedrooms") || 0), bathrooms: Number(f.get("bathrooms") || 0),
        area_m2: f.get("area_m2") ? Number(f.get("area_m2")) : null,
        amenities: String(f.get("amenities") || "").split(",").map((v) => v.trim()).filter(Boolean),
      }); done();
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  }
  return <section className="ll-panel ll-form-panel"><div className="ll-section-heading"><div><span className="ll-eyebrow">BƯỚC 2</span><h2>Thêm phòng hoặc căn</h2></div><button className="icon-button" onClick={close} aria-label="Đóng"><X /></button></div><form className="ll-form" onSubmit={submit}>
    <label>Mã phòng<input name="unit_code" required placeholder="P.301" /></label><label>Diện tích (m²)<input name="area_m2" type="number" min="1" step="0.1" /></label><label>Phòng ngủ<input name="bedrooms" type="number" min="0" step="0.5" defaultValue="1" /></label><label>Phòng tắm<input name="bathrooms" type="number" min="0" step="0.5" defaultValue="1" /></label><label className="wide">Tiện ích, cách nhau bằng dấu phẩy<input name="amenities" placeholder="wifi, điều hòa, chỗ để xe" /></label>{error && <p className="ll-form-error wide">{error}</p>}<div className="ll-form-actions wide"><button type="button" className="secondary" onClick={close}>Hủy</button><button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Plus />} Thêm phòng</button></div>
  </form></section>;
}

function UnitCard({ unit, active, edit, changed }: { unit: ManagedUnit; active: boolean; edit: () => void; changed: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function action(path: string, body: unknown) { setBusy(true); setError(""); try { await housingManagement(path, "POST", body); await changed(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  return <article className="ll-unit-card"><div className="ll-unit-main"><span className="ll-unit-icon"><Home /></span><div><span className="ll-property-row"><h3>{unit.unit_code}</h3>{unit.publication_status && <Status value={unit.publication_status} />}</span><p>{unit.area_m2 ? `${unit.area_m2} m²` : "Chưa có diện tích"} · {unit.bedrooms ?? 0} PN · {unit.bathrooms ?? 0} WC</p>{unit.title && <strong>{unit.title}</strong>}</div></div><div className="ll-unit-side">{unit.availability_status && <span className={`ll-availability ${unit.availability_status}`}>{availabilityLabels[unit.availability_status]}</span>}<button className="secondary" onClick={edit}>{unit.listing_id ? "Sửa tin" : "Tạo tin"}</button></div>
    {unit.listing_id && <div className="ll-unit-actions">{["draft", "rejected", "hidden"].includes(unit.publication_status || "") && <button disabled={busy || !active} onClick={() => void action(`landlord/listings/${unit.listing_id}/submit`, {})}><Send size={15} /> Gửi duyệt</button>}{unit.publication_status === "published" && <><button disabled={busy} onClick={() => void action(`landlord/listings/${unit.listing_id}/availability`, { status: unit.availability_status === "vacant" ? "rented" : "vacant", revision: unit.revision })}>{unit.availability_status === "vacant" ? "Đánh dấu đã thuê" : "Mở lại phòng"}</button><button disabled={busy} onClick={() => void action(`landlord/listings/${unit.listing_id}/hide`, { revision: unit.revision })}>Ẩn tin</button></>}</div>}
    {error && <p className="ll-form-error" role="alert">{error}</p>}
  </article>;
}

function ListingForm({ unit, close, done }: { unit: ManagedUnit; close: () => void; done: () => void }) {
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(Boolean(unit.listing_id));
  const [error, setError] = useState(""), [listingId, setListingId] = useState(unit.listing_id);
  const [existing, setExisting] = useState<ManagedListing | null>(null);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!unit.listing_id) return;
    const controller = new AbortController();
    setLoading(true);
    housingManagement<ManagedListing>(`landlord/listings/${unit.listing_id}`, "GET", undefined, controller.signal)
      .then(setExisting)
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [unit.listing_id]);

  const fee = (code: string) => existing?.fees.find((item) => item.code === code)?.amount;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const f = new FormData(event.currentTarget);
    const fees = [["electricity", "Tiền điện", "kwh"], ["water", "Tiền nước", "m3"], ["internet", "Internet", "month"], ["parking", "Gửi xe", "vehicle_month"]]
      .flatMap(([code, label, billing_unit]) => f.get(code) ? [{ code, label, billing_unit, amount: Number(f.get(code)), required: code !== "parking", refundable: false }] : []);
    const payload = { title: f.get("title"), description: f.get("description"), rent_vnd: Number(f.get("rent_vnd")), deposit_vnd: f.get("deposit_vnd") ? Number(f.get("deposit_vnd")) : null, availability_from: f.get("availability_from") || null, fees };
    try {
      let id = listingId;
      if (id) await housingManagement(`landlord/listings/${id}`, "PATCH", { ...payload, revision: existing?.revision ?? unit.revision });
      else { const result = await housingManagement<{ id: string }>(`landlord/units/${unit.id}/listing`, "POST", payload); id = result.id; setListingId(id); }
      if (file && id) await uploadListingImage(id, file, String(f.get("image_alt") || payload.title));
      done();
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  }
  if (loading) return <div className="ll-loading" role="status"><LoaderCircle className="spin" /> Đang tải nội dung tin…</div>;
  return <section className="ll-panel ll-form-panel"><div className="ll-section-heading"><div><span className="ll-eyebrow">BƯỚC 3</span><h2>{listingId ? "Cập nhật tin" : `Đăng tin cho ${unit.unit_code}`}</h2><p>Ghi rõ toàn bộ chi phí để người thuê ước tính đúng ngân sách.</p></div><button className="icon-button" onClick={close} aria-label="Đóng"><X /></button></div><form className="ll-form ll-listing-form" onSubmit={submit}>
    <label className="wide">Tiêu đề<input name="title" required minLength={5} defaultValue={existing?.title || unit.title || ""} placeholder="Phòng sáng thoáng, gần trường học" /></label><label className="wide">Mô tả<textarea name="description" rows={5} maxLength={5000} defaultValue={existing?.description || ""} placeholder="Không gian, nội thất, quy định và những điều người thuê cần biết…" /></label><label>Giá thuê / tháng<input name="rent_vnd" type="number" min="1" required defaultValue={existing?.rent_vnd} placeholder="4500000" /></label><label>Tiền cọc<input name="deposit_vnd" type="number" min="0" defaultValue={existing?.deposit_vnd ?? undefined} placeholder="4500000" /></label><label>Ngày có thể vào ở<input name="availability_from" type="date" defaultValue={existing?.availability_from?.slice(0, 10) || ""} /></label>
    <fieldset className="wide ll-fees"><legend>Chi phí định kỳ</legend><label>Điện / kWh<input name="electricity" type="number" min="0" defaultValue={fee("electricity")} placeholder="4000" /></label><label>Nước / m³<input name="water" type="number" min="0" defaultValue={fee("water")} placeholder="30000" /></label><label>Internet / tháng<input name="internet" type="number" min="0" defaultValue={fee("internet")} placeholder="100000" /></label><label>Gửi xe / xe / tháng<input name="parking" type="number" min="0" defaultValue={fee("parking")} placeholder="100000" /></label></fieldset>
    <label className="wide ll-file"><ImagePlus /><span><strong>Ảnh phòng</strong><small>JPEG/PNG, tối đa 5 MB. Ảnh sẽ được kiểm duyệt trước khi hiển thị.</small></span><input type="file" accept="image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label><label className="wide">Mô tả ảnh<input name="image_alt" placeholder="Ví dụ: Phòng ngủ nhìn từ cửa vào" /></label>
    {error && <p className="ll-form-error wide" role="alert">{error}</p>}<div className="ll-form-actions wide"><button type="button" className="secondary" onClick={close}>Hủy</button><button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <CheckCircle2 />} Lưu bản nháp</button></div>
  </form></section>;
}

function InboxPanel({ contacts, changed }: { contacts: ContactRequest[]; changed: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  async function update(item: ContactRequest, status: ContactRequest["status"]) { setBusy(item.id); setError(""); try { await housingManagement(`landlord/contact-requests/${item.id}`, "PATCH", { status, revision: item.revision }); await changed(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(null); } }
  return <section className="ll-panel ll-inbox"><div className="ll-section-heading"><div><span className="ll-eyebrow">HỘP THƯ QUAN TÂM</span><h2>Yêu cầu liên hệ</h2><p>Chỉ tài khoản quản lý đã xác minh mới thấy và xử lý các yêu cầu này.</p></div></div>{error && <p className="ll-form-error" role="alert">{error}</p>}{contacts.length === 0 ? <EmptyState icon={<Inbox />} title="Chưa có yêu cầu" text="Yêu cầu thật từ người thuê sẽ xuất hiện tại đây." /> : <div className="ll-contact-list">{contacts.map((item) => <article key={item.id} className={item.status === "new" ? "new" : ""}><div className="ll-contact-top"><span className="ll-contact-avatar">{item.tenant_user_id.slice(0, 1).toUpperCase()}</span><div><strong>{item.title}</strong><p>{item.property_name}{item.unit_code ? ` · ${item.unit_code}` : ""}</p></div><Status value={item.status} /></div><blockquote>{item.message}</blockquote><small>Nhận lúc {dateTime(item.created_at)}</small><div className="ll-contact-actions">{item.status === "new" && <button className="primary" disabled={busy === item.id} onClick={() => void update(item, "contacted")}>Đã liên hệ</button>}{["new", "contacted"].includes(item.status) && <button className="secondary" disabled={busy === item.id} onClick={() => void update(item, "viewing")}>Đã hẹn xem</button>}{item.status !== "resolved" && <button className="text-button" disabled={busy === item.id} onClick={() => void update(item, "resolved")}>Hoàn tất</button>}</div></article>)}</div>}</section>;
}

function Status({ value }: { value: string }) {
  const labels: Record<string, string> = { pending: "Chờ xác minh", active: "Đã xác minh", revoked: "Đã thu hồi", new: "Mới", contacted: "Đã liên hệ", viewing: "Đã hẹn xem", resolved: "Hoàn tất", declined: "Đã từ chối", ...publicationLabels };
  return <span className={`ll-status ${value}`}>{labels[value] || value}</span>;
}
