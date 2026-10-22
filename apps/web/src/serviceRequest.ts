import type { Data, Thread } from "./types";

export type FormService = "property" | "flight" | "map";
export type FlightDraft = {
  from: string;
  to: string;
  date: string;
  returnDate: string;
  trip: string;
  adults: string;
};
// Popular options from the existing Flight catalog; free text still goes to Agent resolution.
export const AIRPORT_OPTIONS = [
  {
    code: "HAN",
    city: "Hà Nội",
    name: "Nội Bài",
    aliases: ["hanoi", "ha noi"],
  },
  {
    code: "SGN",
    city: "TP. Hồ Chí Minh",
    name: "Tân Sơn Nhất",
    aliases: [
      "hcm",
      "ho chi minh",
      "thanh pho ho chi minh",
      "sai gon",
      "saigon",
    ],
  },
  {
    code: "DAD",
    city: "Đà Nẵng",
    name: "Đà Nẵng",
    aliases: ["danang", "da nang"],
  },
  {
    code: "CXR",
    city: "Nha Trang",
    name: "Cam Ranh",
    aliases: ["nha trang", "cam ranh"],
  },
  { code: "PQC", city: "Phú Quốc", name: "Phú Quốc", aliases: ["phu quoc"] },
  {
    code: "HPH",
    city: "Hải Phòng",
    name: "Cát Bi",
    aliases: ["hai phong", "cat bi"],
  },
];
const text = (value: unknown) =>
  typeof value === "string" && !value.startsWith("selected:") ? value : "";
const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
function airportIdentity(value: string) {
  const n = normalize(value);
  return (
    AIRPORT_OPTIONS.find((a) =>
      [a.code, a.city, a.name, ...a.aliases].some((v) => normalize(v) === n),
    )?.code || n
  );
}
export function vietnamToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export function flightDefaults(known: Data): FlightDraft {
  return {
    from: text(known.origin),
    to: text(known.destination),
    date: text(known.flight_date || known.date),
    returnDate: text(known.return_date),
    trip: known.trip_type === "round_trip" ? "round_trip" : "one_way",
    adults: String(known.passengers?.adults ?? known.passengers ?? 1),
  };
}
export function flightRequest(
  draft: FlightDraft,
  today = vietnamToday(),
  continuation = false,
): string {
  const from = draft.from.trim(),
    to = draft.to.trim();
  if (!from || !to) throw new Error("Hãy nhập nơi đi và nơi đến.");
  if (airportIdentity(from) === airportIdentity(to))
    throw new Error("Nơi đi và nơi đến phải khác nhau.");
  if (!validDate(draft.date) || draft.date < today)
    throw new Error("Hãy chọn ngày bay hôm nay hoặc trong tương lai.");
  if (
    draft.trip === "round_trip" &&
    (!validDate(draft.returnDate) || draft.returnDate < draft.date)
  )
    throw new Error("Ngày về phải cùng hoặc sau ngày đi.");
  const adults = Number(draft.adults);
  if (!Number.isInteger(adults) || adults < 1 || adults > 9)
    throw new Error("Hãy chọn từ 1 đến 9 người lớn.");
  return `${continuation ? "Bổ sung cho yêu cầu chuyến bay hiện tại: " : "Tìm chuyến bay "}${draft.trip === "round_trip" ? "khứ hồi" : "một chiều"} từ ${from} đến ${to}, ngày đi ${draft.date}${draft.trip === "round_trip" ? `, ngày về ${draft.returnDate}` : ""}, cho ${adults} người lớn. Chỉ tìm chuyến.`;
}

/** Only the current goal/plan supplies defaults. Historical cards cannot refill a new request. */
export function requestDefaults(
  thread: Thread | null,
  service: FormService,
  taskId?: string,
): Data {
  if (!thread) return {};
  const intake = thread.state.intake;
  // domains is a Python property, not a serialized field. Prefer the actual
  // API shape; support older client snapshots without borrowing old progress.
  const domains = intake?.intent?.domains ?? intake?.domains;
  const active = Array.isArray(domains) && domains.includes(service);
  if (!taskId && Array.isArray(domains) && !active) return {};
  const usable = (t: Data) =>
    t.agent === service &&
    !t.historical_search &&
    !["compare", "search_compare"].includes(t.inputs?.housing_mode);
  const tasks = (thread.state.plan?.tasks || []).filter(usable);
  const progress = (thread.state.progress?.items || []).filter(usable);
  const targets = tasks.filter((t: Data) => intake?.target_task_ids?.includes(t.id));
  const currentId = targets.length === 1 ? targets[0].id
    : tasks.length === 1 ? tasks[0].id
    : tasks.length === 0 && progress.some((i: Data) => i.task_id === `pending:${service}`)
      ? `pending:${service}` : undefined;
  const id = taskId || currentId;
  const task = id ? tasks.find((t: Data) => t.id === id) : undefined;
  const item = id ? progress.find((i: Data) => i.task_id === id) : undefined;
  if (taskId && !task && !item) return {};
  // Constraints belong to the current request, not another explicitly opened
  // historical task. Multiple tasks need an ID rather than a first-match guess.
  const values = active && (!taskId || taskId === currentId)
    ? intake?.constraints?.values || {} : {};
  // The current plan is authoritative over its own historical progress entry.
  return { ...(task?.inputs || item?.inputs || {}), ...values };
}
// Only fields with controls in the service form may trigger that form or hide
// their question text. Other criteria must remain answerable in chat.
const fields: Record<FormService, string[]> = {
  flight: [
    "origin",
    "destination",
    "date",
    "flight_date",
    "return_date",
    "passengers",
    "trip_type",
  ],
  property: [
    "city",
    "district",
    "near",
    "room_type",
    "max_price_vnd",
    "min_price_vnd",
  ],
  map: ["city", "route_from", "route_to", "route_profile"],
};
const locationFields = ["city", "district", "near"];

/** A populated location needs resolution/selection, not the same text form again.
 * The populated-field/choices checks also support responses from older backends.
 */
function handledByForm(question: Data, service: FormService, known: Data): boolean {
  const parts = String(question.field || "").split(".");
  const field = parts.at(-1)!;
  if ((parts.length > 1 && parts[0] !== service) || !fields[service].includes(field)) return false;
  if (question.reason === "location_not_found" || question.reason === "location_ambiguous") return false;
  if (service === "property" && locationFields.includes(field)) {
    if (question.choices?.length || question.options?.length) return false;
    if (typeof known[field] === "string" && known[field].trim()) return false;
  }
  return true;
}

export function clarificationServices(thread: Thread | null): FormService[] {
  const reply = [...(thread?.messages || [])]
    .reverse()
    .find((m) => m.role === "assistant")?.content.response;
  if (!reply || reply.kind !== "CLARIFY") return [];
  const active = new Set<string>([
    ...(thread?.state.intake?.intent?.domains ?? thread?.state.intake?.domains ?? []),
    ...(thread?.state.progress?.items || [])
      .filter((i: Data) => i.state === "waiting" && !i.chosen)
      .map((i: Data) => i.agent),
  ]);
  const routeRequest =
    requestDefaults(thread, "map").map_mode === "route" ||
    (reply.questions || []).some((q) => String(q.field).includes("route_"));
  return (["flight", "property", "map"] as FormService[]).filter(
    (service) =>
      active.has(service) &&
      (service !== "map" || routeRequest) &&
      (reply.questions || []).some((q) => handledByForm(q, service, requestDefaults(thread, service))),
  );
}

/** Presentation only: retain notices and explanations; replace exact input questions with controls. */
export function guidedReplyText(
  text: string,
  questions: Data[],
  services: FormService[],
): string {
  const handled = questions
    .filter((q) => q.reason !== "location_not_found" && q.reason !== "location_ambiguous")
    // A location clarification can explain ambiguity or an unavailable match.
    // Controls cannot replace that explanation, even when a full form is shown.
    .filter((q) => {
      const parts = String(q.field || "").split(".");
      return !(services.includes("property") && (parts.length === 1 || parts[0] === "property") &&
        ["city", "district", "near"].includes(parts.at(-1)!));
    })
    .filter((q) =>
      services.some((s) => {
        const parts = String(q.field || "").split(".");
        return (
          (parts.length === 1 || parts[0] === s) &&
          fields[s].includes(parts.at(-1)!)
        );
      }),
    )
    .map((q) => String(q.text || "").trim())
    .filter(Boolean);
  return text
    .split("\n")
    .filter((line) => !handled.includes(line.trim()))
    .join("\n");
}
