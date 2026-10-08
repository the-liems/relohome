import { formatUi } from "../uiPreferences";
import { t as uiText } from "../uiPreferences";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as LibreMap } from "maplibre-gl";
import {
  Bath,
  BedDouble,
  Check,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  Heart,
  House as HouseIcon,
  Layers,
  MapPin,
  MessageCircle,
  Navigation,
  Ruler,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { api, compactPrice, housePrice, safeUrl } from "../api";
import type { Data, House } from "../types";
import { mergePlaceCandidates } from "../placeCandidates";
import { searchScopeFeature } from "../searchScope";
import {
  cityForBox,
  scopedMapOptions,
  installMapScope,
  fitMapBox,
  focusMapPoint,
} from "../mapScope";
import {
  MAP_WORKSPACE,
  SORTS,
  formatAddress,
  listMode,
  mapRequest,
  searchRequest,
  shortPrice,
  stackListings,
  toHouse,
  viewportCount,
} from "../mapWorkspace";
import {
  BASEMAP_STYLE_URL,
  CLUSTER_COLOR,
  CLUSTER_RADIUS,
  MAP_THEME,
  PILL,
  POI_ICON_EXPRESSION,
  registerMapImages,
  tuneBasemap,
} from "../mapStyle";
import { HouseImage, Comparison, amenities as AMENITY_LABELS } from "./Housing";
import { HousingDirections } from "./HousingDirections";
import {
  MAX_COMPARISON_HOMES,
  toggleComparison,
  validCoordinates,
} from "../housingInteraction";
import { WorkspaceChat, type ChatDockProps } from "./WorkspaceChat";
import { ContentSkeleton } from "./UiStates";
import { roommate } from "../roommate/client";
import type { Availability } from "../roommate/types";
import "./roommateMap.css";

const PRICES = [
  0, 3_000_000, 5_000_000, 7_000_000, 10_000_000, 15_000_000, 20_000_000,
  30_000_000,
];
export const PROPERTY_TYPES: Record<string, string> = {
  room: "Phòng trọ",
  studio: "Studio",
  apartment: "Căn hộ",
  house: "Nhà nguyên căn",
  serviced_apartment: "Căn hộ dịch vụ",
  homestay: "Homestay",
};
const CHIP_LABELS: Record<string, string> = {
  district: "Khu vực",
  min_area_m2: "Từ (m²)",
  max_area_m2: "Đến (m²)",
  min_bathrooms: "WC từ",
  amenities: "Tiện nghi",
  min_price: "Giá từ",
  administrative_area_ids: "Phạm vi hành chính",
};
const PLACE_FIELDS = ["near", "route_from", "route_to"];
// POIs are only loaded close enough for them to be readable and the request to stay small.
const POI_MIN_ZOOM = 14;
type BBox = { west: number; south: number; east: number; north: number };
type RoomMarker = {
  listing_id: string;
  profile_id: string;
  display_name: string;
  source_kind: "real" | "demo";
  label: string;
};

export function MapWorkspace({
  focus,
  initialFilters,
  areaName,
  saved,
  selectedId,
  selectedIds,
  readOnly = false,
  chat,
  onSave,
  onSelect,
  onExit,
}: {
  // Viewport + filters from the latest housing answer; `key` changes when a new answer arrives.
  focus: { key: string; viewport?: BBox | null; searchScope?: Data } | null;
  initialFilters: Data;
  // Human name of the administrative scope the agent resolved (chip label instead of its ID).
  areaName?: string;
  saved: Set<string>;
  selectedId?: string;
  // Homes chosen for viewing (several); the plan home stays `selectedId`.
  selectedIds?: string[];
  readOnly?: boolean;
  chat: ChatDockProps;
  onSave: (h: House) => void;
  // Any listing (chat result or explored on the map) can be chosen; the backend re-reads it.
  onSelect: (h: House) => Promise<void>;
  onExit: () => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LibreMap | null>(null);
  const [ready, setReady] = useState(false),
    [mapError, setMapError] = useState("");
  const [filters, setFilters] = useState<Data>(initialFilters),
    [sort, setSort] = useState("newest");
  const [view, setView] = useState<{ bbox: BBox; zoom: number } | null>(null),
    [count, setCount] = useState<number | null>(null),
    [markers, setMarkers] = useState<House[]>([]),
    [clusters, setClusters] = useState<Data[]>([]);
  const [rows, setRows] = useState<House[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [listError, setListError] = useState("");
  const [stack, setStack] = useState<House[] | null>(null),
    [hovered, setHovered] = useState<string | null>(null),
    [detail, setDetail] = useState<House | null>(null),
    [listOpen, setListOpen] = useState(true),
    [sheet, setSheet] = useState(false),
    [selecting, setSelecting] = useState<string | null>(null);
  const [pois, setPois] = useState<Data | null>(null);
  const [roomMarkers, setRoomMarkers] = useState<RoomMarker[]>([]);
  const [demoAvailable, setDemoAvailable] = useState(false);
  const [includeDemo, setIncludeDemo] = useState(false);
  const [roomMapError, setRoomMapError] = useState("");
  const [comparisonHomes, setComparisonHomes] = useState<House[]>([]);
  const [comparing, setComparing] = useState(false);
  const [directions, setDirections] = useState<House | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    roommate<Availability>("/availability", "GET", undefined, abort.signal)
      .then((a) => {
        if (!abort.signal.aborted) {
          setDemoAvailable(Boolean(a.demo_enabled));
          setIncludeDemo(Boolean(a.demo_enabled));
        }
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  const roomIds = JSON.stringify(
    [
      ...new Set(
        [...markers, ...rows, ...(detail ? [detail] : [])].map((h) => h.id),
      ),
    ].sort(),
  );
  useEffect(() => {
    const abort = new AbortController();
    setRoomMarkers([]);
    setRoomMapError("");
    const ids: string[] = JSON.parse(roomIds);
    if (!ids.length) return;
    const load = () =>
      roommate<{ items: RoomMarker[] }>(
        "/map/rooms",
        "POST",
        {
          listing_ids: ids.slice(0, 250),
          include_demo: includeDemo,
        },
        abort.signal,
      )
        .then((data) => {
          if (!abort.signal.aborted) {
            setRoomMarkers(data.items);
            setRoomMapError("");
          }
        })
        .catch(() => {
          if (!abort.signal.aborted) {
            setRoomMarkers([]);
            setRoomMapError(
              "Chưa đọc được nhu cầu ghép trọ. Không ảnh hưởng danh sách nhà.",
            );
          }
        });
    void load();
    const timer = setInterval(() => void load(), 30000);
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      abort.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [roomIds, includeDemo]);
  const generation = useRef(0);
  const activeSearchScope =
    focus?.searchScope?.area_id &&
    !focus.searchScope.center &&
    !(filters.administrative_area_ids || []).includes(focus.searchScope.area_id)
      ? undefined
      : focus?.searchScope;

  useEffect(() => {
    if (!ready || !map.current) return;
    const m = map.current,
      feature = searchScopeFeature(activeSearchScope);
    (m.getSource("ws-search-scope") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: feature ? [feature] : [],
    });
    const center = activeSearchScope?.center;
    let marker: import("maplibre-gl").Marker | undefined;
    let cancelled = false;
    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
      void import("maplibre-gl").then(({ Marker }) => {
        if (cancelled) return;
        marker = new Marker({ color: "#dc2626" })
          .setLngLat([center.lng, center.lat])
          .addTo(m);
        marker
          .getElement()
          .setAttribute(
            "aria-label",
            focus?.searchScope?.label || uiText("Địa điểm tìm kiếm"),
          );
        marker.getElement().title =
          focus?.searchScope?.label || uiText("Địa điểm tìm kiếm");
      });
    }
    return () => {
      cancelled = true;
      marker?.remove();
    };
  }, [ready, focus?.key, activeSearchScope]);

  // Chat answers replace the area filters and move the map to the area the agent resolved.
  useEffect(() => {
    setFilters(initialFilters);
    setStack(null);
    const box = focus?.viewport;
    if (box && map.current)
      fitMapBox(map.current, box, { padding: 48, duration: 700 });
  }, [focus?.key, ready]);

  useEffect(() => {
    let disposed = false;
    import("maplibre-gl")
      .then(({ Map, NavigationControl, setWorkerUrl }) => {
        if (disposed || !container.current) return;
        setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        const box = focus?.viewport;
        const city = cityForBox(box);
        const m = new Map({
          container: container.current,
          style: BASEMAP_STYLE_URL,
          ...scopedMapOptions(container.current, city),
          attributionControl: { compact: true },
        });
        map.current = m;
        m.on("style.load", () => tuneBasemap(m));
        installMapScope(m, city);
        if (box) fitMapBox(m, box, { padding: 48, duration: 0 });
        // installMapScope already owns the guarded ResizeObserver. Redundant
        // resize() calls can interrupt camera movement as the sidebar changes.
        m.addControl(
          new NavigationControl({ showCompass: false }),
          "bottom-left",
        );
        m.on("error", () =>
          setMapError(
            "Chưa tải được một phần bản đồ. Danh sách vẫn dùng được.",
          ),
        );
        // Provider data must not wait for every external basemap tile to finish.
        // The style is sufficient to register our sources and report the viewport.
        m.on("style.load", () => {
          if (disposed || m.getSource("ws-search-scope")) return;
          tuneBasemap(m);
          registerMapImages(m);
          m.addSource("ws-search-scope", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          m.addLayer({
            id: "ws-search-scope-fill",
            type: "fill",
            source: "ws-search-scope",
            paint: { "fill-color": "#dc2626", "fill-opacity": 0.06 },
          });
          m.addLayer({
            id: "ws-search-scope-line",
            type: "line",
            source: "ws-search-scope",
            paint: {
              "line-color": "#dc2626",
              "line-width": 2,
              "line-dasharray": [3, 2],
            },
          });
          for (const id of ["ws-clusters", "ws-listings", "ws-choices"])
            m.addSource(id, {
              type: "geojson",
              data: { type: "FeatureCollection", features: [] },
            });
          m.addSource("ws-pois", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
            cluster: true,
            clusterMaxZoom: 16,
            clusterRadius: 38,
          });
          m.addLayer({
            id: "ws-poi-cluster",
            type: "circle",
            source: "ws-pois",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": MAP_THEME.cluster.low,
              "circle-radius": 13,
              "circle-opacity": 0.75,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#fff",
            },
          });
          m.addLayer({
            id: "ws-poi",
            type: "symbol",
            source: "ws-pois",
            filter: ["!", ["has", "point_count"]],
            layout: {
              "icon-image": POI_ICON_EXPRESSION,
              "icon-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                13,
                0.6,
                17,
                0.9,
              ],
              "icon-allow-overlap": true,
            },
          });
          m.addLayer({
            id: "ws-cluster-circle",
            type: "circle",
            source: "ws-clusters",
            paint: {
              "circle-color": CLUSTER_COLOR,
              "circle-radius": CLUSTER_RADIUS,
              "circle-stroke-width": 3,
              "circle-stroke-color": "#fff",
            },
          });
          m.addLayer({
            id: "ws-cluster-count",
            type: "symbol",
            source: "ws-clusters",
            layout: {
              "text-field": ["get", "label"],
              "text-size": 12,
              "text-font": ["Noto Sans Regular"],
            },
            paint: { "text-color": "#fff" },
          });
          // Normal price pills give way to each other (as in map-app); hovered/selected ones
          // are drawn on a second layer that always shows.
          for (const [id, filter, overlap] of [
            ["ws-listing", ["==", ["get", "state"], "normal"], false],
            ["ws-listing-active", ["!=", ["get", "state"], "normal"], true],
          ] as const) {
            m.addLayer({
              id,
              type: "symbol",
              source: "ws-listings",
              filter: filter as any,
              layout: {
                "icon-image": [
                  "case",
                  ["get", "roommate"],
                  PILL.roommate,
                  ["==", ["get", "state"], "selected"],
                  PILL.selected,
                  ["==", ["get", "state"], "hover"],
                  PILL.hover,
                  PILL.normal,
                ],
                "icon-text-fit": "both",
                "icon-text-fit-padding": [7, 11, 7, 11],
                "icon-allow-overlap": overlap,
                "text-allow-overlap": overlap,
                "icon-ignore-placement": overlap,
                "text-field": ["get", "label"],
                "text-size": 13,
                "text-font": ["Noto Sans Regular"],
                "symbol-sort-key": ["get", "rank"],
              },
              paint: {
                "text-color": [
                  "case",
                  ["get", "roommate"],
                  "#713f12",
                  ["==", ["get", "state"], "selected"],
                  "#ffffff",
                  MAP_THEME.housingMarker.text,
                ],
              },
            });
          }
          m.addLayer({
            id: "ws-choice",
            type: "circle",
            source: "ws-choices",
            paint: {
              "circle-color": MAP_THEME.primary,
              "circle-radius": 11,
              "circle-stroke-width": 3,
              "circle-stroke-color": "#fff",
            },
          });
          m.on("click", "ws-cluster-circle", (e) => {
            const f = e.features?.[0];
            if (f)
              m.easeTo({
                center: (f.geometry as any).coordinates,
                zoom: Math.min(m.getZoom() + 2, 18),
              });
          });
          m.on("click", "ws-poi-cluster", (e) => {
            const f = e.features?.[0];
            if (f)
              m.easeTo({
                center: (f.geometry as any).coordinates,
                zoom: Math.min(m.getZoom() + 1.5, 18),
              });
          });
          m.on("click", ["ws-listing", "ws-listing-active"], (e) => {
            const key = e.features?.[0]?.properties?.key;
            if (key) openStack(key);
          });
          m.on("click", "ws-choice", (e) => {
            const id = e.features?.[0]?.properties?.id;
            const choice = latest.current.choices.find((c) => c.id === id);
            if (choice) void latest.current.choose(choice);
          });
          for (const layer of [
            "ws-cluster-circle",
            "ws-listing",
            "ws-listing-active",
            "ws-choice",
            "ws-poi-cluster",
          ]) {
            m.on(
              "mouseenter",
              layer,
              () => (m.getCanvas().style.cursor = "pointer"),
            );
            m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
          }
          const report = () => {
            const b = m.getBounds();
            setView({
              bbox: {
                west: b.getWest(),
                south: b.getSouth(),
                east: b.getEast(),
                north: b.getNorth(),
              },
              zoom: m.getZoom(),
            });
          };
          m.on("moveend", report);
          report();
          setReady(true);
        });
      })
      .catch(() => setMapError("Không tải được bản đồ. Hãy thử lại."));
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      setReady(false);
    };
  }, []);

  // Viewport → count (map endpoint) → list page (search endpoint). Old responses are discarded.
  useEffect(() => {
    if (!view) return;
    const current = ++generation.current,
      abort = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setListError("");
      try {
        const result = await api<Data>(
          "/platform/housing/map",
          "POST",
          mapRequest(filters, view.bbox, view.zoom),
          abort.signal,
        );
        if (current !== generation.current) return;
        const total = viewportCount(result);
        setCount(total);
        setClusters(
          (result.features || []).filter((f: Data) => f.kind === "cluster"),
        );
        setMarkers(
          (result.features || [])
            .filter((f: Data) => f.kind === "listing")
            .map(toHouse),
        );
        if (!listMode(total, view.zoom)) {
          setRows([]);
          setCursor(null);
          return;
        }
        const page = await api<Data>(
          "/platform/housing/search",
          "POST",
          searchRequest(filters, view.bbox, sort),
          abort.signal,
        );
        if (current !== generation.current) return;
        setRows((page.results || []).map(toHouse));
        setCursor(page.page?.next_cursor || null);
      } catch (e) {
        if (
          !(e instanceof DOMException && e.name === "AbortError") &&
          current === generation.current
        )
          setListError(
            (e as Error).message || "Chưa tải được nhà trong vùng đang xem.",
          );
      } finally {
        if (current === generation.current) setLoading(false);
      }
    }, MAP_WORKSPACE.debounceMs);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [view, filters, sort]);

  // Amenity layer for the visible area (same Platform endpoint as map-app).
  useEffect(() => {
    if (!view || view.zoom < POI_MIN_ZOOM) {
      setPois(null);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      api<Data>(
        "/platform/places/map",
        "POST",
        { bounding_box: view.bbox },
        abort.signal,
      )
        .then(setPois)
        .catch(() => {});
    }, MAP_WORKSPACE.debounceMs);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [view]);

  async function more() {
    if (!view || !cursor) return;
    const current = generation.current;
    setLoading(true);
    try {
      const page = await api<Data>(
        "/platform/housing/search",
        "POST",
        searchRequest(filters, view.bbox, sort, cursor),
      );
      if (current !== generation.current) return;
      setRows((r) => [
        ...r,
        ...(page.results || [])
          .map(toHouse)
          .filter((h: House) => !r.some((x) => x.id === h.id)),
      ]);
      setCursor(page.page?.next_cursor || null);
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const stacks = useMemo(() => stackListings(markers), [markers]);
  function openStack(key: string) {
    const group = latest.current.stacks.find((s) => s.key === key);
    if (!group) return;
    if (group.houses.length === 1) void openDetail(group.houses[0]);
    else {
      setStack(group.houses);
      setListOpen(true);
      setSheet(true);
    }
  }
  const choices: Data[] = chat.questions.flatMap((q) =>
    mergePlaceCandidates(q.choices || []).map((c: Data) => ({
      ...c,
      field: q.field,
    })),
  );
  async function choose(choice: Data) {
    const placeChoice =
      choice.entity_type === "place" && PLACE_FIELDS.includes(choice.field);
    await send(
      `Chọn ${choice.label}`,
      placeChoice
        ? { place_choice: { field: choice.field, place_id: choice.id } }
        : {},
    );
  }
  const latest = useRef({ stacks, choices, choose });
  latest.current = { stacks, choices, choose };

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("ws-clusters") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: clusters.map((c) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [c.location.lng, c.location.lat],
        },
        properties: { label: String(c.count), count: c.count },
      })),
    });
    (m.getSource("ws-listings") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: stacks.map((s) => {
        const ids = s.houses.map((h) => h.id);
        const state =
          ids.includes(detail?.id || "") ||
          ids.includes(selectedId || "") ||
          ids.some((id) => selectedIds?.includes(id))
            ? "selected"
            : ids.includes(hovered || "")
              ? "hover"
              : "normal";
        const roomProfiles = roomMarkers.filter((p) =>
          ids.includes(p.listing_id),
        );
        const realRoom = roomProfiles.some((p) => p.source_kind === "real");
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
          properties: {
            key: s.key,
            state,
            roommate: roomProfiles.length > 0,
            rank: -s.houses.length,
            label:
              (roomProfiles.length
                ? `${realRoom ? "Ghép trọ" : "DEMO"} (${new Set(roomProfiles.map((p) => p.listing_id)).size} phòng) · `
                : "") +
              (s.houses.length > 1
                ? `${s.houses.length} căn`
                : shortPrice(s.houses[0])),
          },
        };
      }),
    });
    (m.getSource("ws-choices") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: choices
        .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
        .map((c) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [c.lng, c.lat] },
          properties: { id: c.id },
        })),
    });
    (m.getSource("ws-pois") as GeoJSONSource)?.setData(
      (pois as any) || { type: "FeatureCollection", features: [] },
    );
  }, [
    ready,
    clusters,
    stacks,
    hovered,
    detail?.id,
    selectedId,
    selectedIds?.join(","),
    JSON.stringify(choices),
    pois,
    roomMarkers,
  ]);

  async function openDetail(h: House) {
    setDetail(h);
    try {
      const full = await api<House>("/housing/" + encodeURIComponent(h.id));
      setDetail((d) => (d?.id === h.id ? { ...h, ...full } : d));
    } catch {
      setDetail((d) => (d?.id === h.id ? { ...d, detailError: true } : d));
    }
  }
  async function choose_house(h: House) {
    setSelecting(h.id);
    try {
      await onSelect(h);
    } finally {
      setSelecting(null);
    }
  }
  async function send(text: string, extra: Data = {}) {
    const box = map.current?.getBounds();
    const map_view = box
      ? {
          bounding_box: {
            west: box.getWest(),
            south: box.getSouth(),
            east: box.getEast(),
            north: box.getNorth(),
          },
          zoom: map.current!.getZoom(),
        }
      : undefined;
    await chat.onSend(
      text,
      map_view && spanOk(map_view.bounding_box)
        ? { map_view, ...extra }
        : extra,
    );
  }

  const listing = view ? listMode(count ?? Infinity, view.zoom) : false;
  const shown = stack || rows;
  const chips = Object.entries(filters).filter(
    ([k, v]) => k in CHIP_LABELS && v !== undefined && v !== null,
  );
  const price = filters.max_price?.amount || 0;
  const countLabel =
    count === null
      ? "…"
      : count > MAP_WORKSPACE.listMax
        ? `${MAP_WORKSPACE.listMax}+`
        : String(count);
  // What the map and list show right now, instead of repeating the listing text of the answer.
  const area = filters.district || areaName || "khu vực bạn hỏi";
  const summary =
    count === null
      ? `Mình đang khoanh vùng ${area} trên bản đồ…`
      : count === 0
        ? `Chưa có căn phù hợp trong vùng ${area}. Bạn thử nới ngân sách, đổi loại nhà hoặc kéo bản đồ sang khu bên cạnh.`
        : listing
          ? `Mình đã khoanh vùng ${area}: ${countLabel} căn phù hợp đang hiện ở danh sách bên trái. Bấm "Chọn căn này" khi bạn ưng một căn.`
          : `Mình đã khoanh vùng ${area} trên bản đồ: có ${countLabel} căn phù hợp. Phóng to vào khu bạn quan tâm, hoặc nói thêm ngân sách, số phòng ngủ để mình lọc.`;
  const isChosen = (id: string) =>
    selectedId === id || Boolean(selectedIds?.includes(id));
  const selectButton = (h: House, primary = false) => (
    <button
      className={primary ? "primary ws-select" : "ws-select-small"}
      disabled={readOnly || chat.busy || selecting !== null || isChosen(h.id)}
      onClick={() => void choose_house(h).catch(() => {})}
    >
      {isChosen(h.id) ? (
        <>
          <Check size={14} />
          {uiText(" Đã chọn")}
        </>
      ) : selecting === h.id ? (
        uiText("Đang chọn…")
      ) : (
        uiText("Chọn căn này")
      )}
    </button>
  );
  const compareButton = (h: House) => {
    const checked = comparisonHomes.some((home) => home.id === h.id);
    return (
      <button
        type="button"
        className={"ws-compare-toggle " + (checked ? "active" : "")}
        aria-pressed={checked}
        aria-label={formatUi("{0}: {1}", [
          checked ? uiText("Bỏ so sánh") : uiText("Thêm so sánh"),
          h.title,
        ])}
        disabled={!checked && comparisonHomes.length >= MAX_COMPARISON_HOMES}
        onClick={() =>
          setComparisonHomes((homes) => toggleComparison(homes, h))
        }
      >
        {checked ? <Check size={15} /> : <GitCompareArrows size={15} />}
        {checked ? uiText("Đã thêm") : uiText("So sánh")}
      </button>
    );
  };
  const directionsButton = (h: House, iconOnly = false) => (
    <button
      type="button"
      className={iconOnly ? "icon-button outlined ws-dir" : "secondary"}
      disabled={!validCoordinates(h.lat, h.lng)}
      onClick={() => setDirections(h)}
      aria-label={uiText("Chỉ đường từ vị trí của bạn")}
      title={uiText("Chỉ đường từ vị trí của bạn")}
    >
      <Navigation size={15} />
      {!iconOnly && uiText("Chỉ đường")}
    </button>
  );
  return (
    <div className={"map-workspace " + (listOpen ? "" : "list-closed")}>
      <aside
        className={"ws-list " + (sheet ? "open" : "")}
        aria-label={uiText("Nhà trong vùng bản đồ")}
      >
        <button
          className="ws-sheet-toggle"
          aria-expanded={sheet}
          onClick={() => setSheet(!sheet)}
        >
          {listing
            ? formatUi("{0} căn trong vùng này", [count ?? 0])
            : uiText("Danh sách nhà")}
        </button>
        <header className="ws-list-head">
          {readOnly && (
            <p className="muted small">
              {uiText(
                "Phương án đã lưu. Muốn đổi căn, hãy yêu cầu trong chat để cập nhật kế hoạch.",
              )}
            </p>
          )}
          <div>
            <span className="eyebrow">{uiText("NHÀ Ở QUANH ĐÂY")}</span>
            <h2>
              {stack
                ? formatUi("{0} tin chung điểm bản đồ", [stack.length])
                : formatUi("{0} lựa chọn", [countLabel])}
            </h2>
          </div>
          <button
            className="icon-button outlined"
            aria-label={uiText("Thu gọn danh sách")}
            onClick={() => setListOpen(false)}
          >
            <ChevronLeft size={18} />
          </button>
        </header>
        {stack && (
          <button
            className="text-button ws-unstack"
            onClick={() => setStack(null)}
          >
            <X size={14} />
            {uiText(" Bỏ lọc theo vị trí này")}
          </button>
        )}
        <div className="ws-list-body">
          {stack?.some((h) => h.location_accuracy !== "rooftop") && (
            <p className="notice">
              {uiText(
                "Một số tin có vị trí gần đúng nên dùng chung pin. Đây là các tin riêng, chưa xác nhận cùng một căn hay cùng địa chỉ thực tế.",
              )}
            </p>
          )}
          {listError && (
            <p className="notice error" role="alert">
              {listError}
            </p>
          )}
          {!stack && !listing && count !== null && (
            <div className="ws-zoom-hint">
              <MapPin size={20} />
              <p>
                {uiText("Vùng này có ")}
                {countLabel}
                {uiText(
                  " căn phù hợp bộ lọc. Phóng to bản đồ tới một khu cụ thể để xem từng căn.",
                )}
              </p>
            </div>
          )}
          {(stack || listing) &&
            shown.map((h) => (
              <article
                key={h.id}
                className={
                  "ws-card " +
                  (detail?.id === h.id ? "active" : "") +
                  (isChosen(h.id) ? " chosen" : "")
                }
                onMouseEnter={() => setHovered(h.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <button
                  className="ws-card-photo"
                  onClick={() => void openDetail(h)}
                  aria-label={"Xem " + h.title}
                >
                  <HouseImage house={h} />
                  {h.location_accuracy !== "rooftop" && (
                    <span className="ws-badge">
                      {uiText("Vị trí gần đúng")}
                    </span>
                  )}
                </button>
                <div className="ws-card-info">
                  <div className="ws-card-top">
                    <strong className="price">{compactPrice(h)}</strong>
                    <button
                      className={
                        "icon-button heart " + (saved.has(h.id) ? "saved" : "")
                      }
                      aria-label={
                        saved.has(h.id)
                          ? uiText("Bỏ lưu nhà")
                          : uiText("Lưu nhà")
                      }
                      onClick={() => onSave(h)}
                    >
                      <Heart
                        size={16}
                        fill={saved.has(h.id) ? "currentColor" : "none"}
                      />
                    </button>
                  </div>
                  {h.property_type && (
                    <span className="ws-type">
                      {PROPERTY_TYPES[h.property_type] || h.property_type}
                    </span>
                  )}
                  <button
                    className="title-button"
                    onClick={() => void openDetail(h)}
                  >
                    {h.title}
                  </button>
                  <Stats house={h} />
                  <p className="muted address">
                    <MapPin size={13} />
                    {h.address}
                  </p>
                  <div className="ws-card-actions">
                    {selectButton(h)}
                    {directionsButton(h, true)}
                  </div>
                  {compareButton(h)}
                </div>
              </article>
            ))}
          {!stack && listing && !rows.length && !loading && (
            <p className="muted">
              {uiText("Không có căn phù hợp trong vùng này.")}
            </p>
          )}
          {!stack && listing && cursor && (
            <button
              className="secondary ws-more"
              disabled={loading}
              onClick={() => void more()}
            >
              {uiText("Xem thêm ")}
              {MAP_WORKSPACE.pageSize}
              {uiText(" căn")}
            </button>
          )}
          {loading &&
            (rows.length === 0 ? (
              <ContentSkeleton label={uiText("Đang tải…")} rows={2} />
            ) : (
              <p className="muted small" role="status">
                {uiText("Đang tải…")}
              </p>
            ))}
        </div>
        {comparisonHomes.length > 0 && (
          <section
            className="ws-comparison-tray"
            aria-label={uiText("Các căn đang so sánh")}
          >
            <div className="ws-comparison-heading">
              <strong>
                <GitCompareArrows size={16} />
                {comparisonHomes.length}/4 {uiText("căn")}
              </strong>
              <button
                type="button"
                className="text-button"
                onClick={() => setComparisonHomes([])}
              >
                {uiText("Bỏ tất cả")}
              </button>
            </div>
            <ul>
              {comparisonHomes.map((h) => (
                <li key={h.id}>
                  <span title={h.title}>{h.title}</span>
                  <button
                    className="icon-button"
                    aria-label={formatUi("Bỏ so sánh: {0}", [h.title])}
                    onClick={() =>
                      setComparisonHomes((homes) =>
                        homes.filter((home) => home.id !== h.id),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="primary full"
              disabled={comparisonHomes.length < 2}
              onClick={() => setComparing(true)}
            >
              {comparisonHomes.length < 2
                ? uiText("Chọn thêm một căn để so sánh")
                : formatUi("So sánh {0} căn", [comparisonHomes.length])}
            </button>
          </section>
        )}
        <p className="ws-list-foot muted small">
          {uiText(
            "Dữ liệu theo vùng bản đồ hiện tại, không phải toàn thị trường.",
          )}
        </p>
      </aside>

      <section className="ws-map" aria-label={uiText("Bản đồ nhà ở")}>
        <div className="ws-top">
          <div className="ws-filterbar">
            {!listOpen && (
              <button
                className="ws-pill-button"
                onClick={() => setListOpen(true)}
              >
                <ChevronRight size={15} />
                {uiText(" Danh sách")}
              </button>
            )}
            <span className="ws-filter-label">
              <SlidersHorizontal size={15} />
              {uiText(" Bộ lọc")}
            </span>
            <select
              aria-label={uiText("Mức giá")}
              value={price}
              onChange={(e) => {
                const amount = Number(e.target.value);
                setFilters(({ max_price: _, ...f }) =>
                  amount
                    ? {
                        ...f,
                        max_price: { amount, currency: "VND", period: "month" },
                      }
                    : f,
                );
              }}
            >
              {(PRICES.includes(price)
                ? PRICES
                : [...PRICES, price].sort((a, b) => a - b)
              ).map((p) => (
                <option key={p} value={p}>
                  {p
                    ? formatUi("Dưới {0} triệu", [
                        (p / 1_000_000).toLocaleString("vi-VN"),
                      ])
                    : uiText("Mọi mức giá")}
                </option>
              ))}
            </select>
            <select
              aria-label={uiText("Loại nhà")}
              value={
                (Array.isArray(filters.property_type)
                  ? filters.property_type[0]
                  : filters.property_type) || ""
              }
              onChange={(e) =>
                setFilters(({ property_type: _, ...f }) =>
                  e.target.value ? { ...f, property_type: e.target.value } : f,
                )
              }
            >
              <option value="">{uiText("Loại nhà")}</option>
              {Object.entries(PROPERTY_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select
              aria-label={uiText("Phòng ngủ")}
              value={filters.min_bedrooms ?? ""}
              onChange={(e) =>
                setFilters(({ min_bedrooms: _a, max_bedrooms: _b, ...f }) =>
                  e.target.value
                    ? { ...f, min_bedrooms: Number(e.target.value) }
                    : f,
                )
              }
            >
              <option value="">{uiText("Phòng ngủ")}</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {uiText("Từ ")}
                  {n} PN
                </option>
              ))}
            </select>
            <select
              aria-label={uiText("Sắp xếp")}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {uiText(s.label)}
                </option>
              ))}
            </select>
            {chips.map(([k, v]) => (
              <span className="chip" key={k}>
                {uiText(CHIP_LABELS[k])}:{" "}
                {k === "administrative_area_ids"
                  ? areaName || uiText("đã chọn")
                  : chipValue(v)}
                <button
                  aria-label={uiText("Bỏ ") + uiText(CHIP_LABELS[k])}
                  onClick={() => setFilters(({ [k]: _, ...f }) => f)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <span className="ws-spacer" />
            <button className="ws-pill-button" onClick={onExit}>
              <MessageCircle size={15} />
              {uiText(" Về hội thoại")}
            </button>
          </div>
          <div className="ws-counter">
            <span>
              <HouseIcon size={16} /> <strong>{countLabel}</strong>
              {uiText(" chỗ ở")}
            </span>
            <span>
              <Layers size={15} />{" "}
              {pois ? (
                <>
                  <strong>
                    {(pois.features || []).length.toLocaleString("vi-VN")}
                  </strong>{" "}
                  {uiText("tiện ích")}
                </>
              ) : (
                uiText("Phóng to để xem tiện ích")
              )}
            </span>
          </div>
          {searchScopeFeature(activeSearchScope) && (
            <div className="search-scope-legend" role="note">
              <MapPin size={14} color="#dc2626" />
              {activeSearchScope?.geometry
                ? `${uiText("Ranh giới theo dữ liệu hiện tại")}: ${activeSearchScope.label || ""}`
                : activeSearchScope?.center
                  ? uiText(
                      "Ghim đỏ: điểm tìm kiếm · vòng nét đứt: bán kính tìm, không phải khoảng cách đi đường",
                    )
                  : uiText(
                      "Nét đứt: khung khu vực tìm kiếm, không phải ranh giới hành chính chính xác",
                    )}
            </div>
          )}
          {focus?.searchScope?.boundary_unavailable && (
            <div className="search-scope-legend" role="note">
              Chưa có ranh giới đúng đơn vị hành chính này trong dữ liệu. Map
              chỉ đưa tới các căn tìm được; không giả lập đường bao.
            </div>
          )}
          <div className="ws-roommate-legend" role="note">
            <span style={{ color: "#a16207" }}>●</span> Vàng: có nhu cầu ghép
            trọ công khai.
            {demoAvailable && (
              <label>
                <input
                  type="checkbox"
                  checked={includeDemo}
                  onChange={(e) => setIncludeDemo(e.target.checked)}
                />
                Hiện phòng DEMO — liên kết minh họa, không phải người thật
              </label>
            )}
            {roomMapError && <small role="status">{roomMapError}</small>}
          </div>
        </div>
        <div ref={container} className="ws-canvas" />
        {mapError && (
          <div className="map-error" role="status">
            {mapError}
          </div>
        )}
        <WorkspaceChat
          {...chat}
          text={chat.fromResult ? summary : chat.text}
          placeholder={uiText(
            "Hỏi ReloHome: căn dưới 10 triệu ở khu này, đổi sang Hà Đông…",
          )}
          caption={uiText('ReloHome hiểu "khu này" là vùng bản đồ đang xem.')}
          onSendText={(t, x) => send(t, x)}
          onChoose={choose}
        />
      </section>

      {detail && (
        <aside className="ws-detail" aria-label={uiText("Chi tiết nhà")}>
          <div className="ws-detail-photo">
            {safeUrl(detail.images?.[0]?.url || detail.images?.[0]) ? (
              <img
                src={detail.images[0].url || detail.images[0]}
                alt={detail.title}
              />
            ) : (
              <HouseImage house={detail} />
            )}
            <button
              className={
                "icon-button ws-photo-heart " +
                (saved.has(detail.id) ? "saved" : "")
              }
              aria-label={
                saved.has(detail.id) ? uiText("Bỏ lưu nhà") : uiText("Lưu nhà")
              }
              onClick={() => onSave(detail)}
            >
              <Heart
                size={18}
                fill={saved.has(detail.id) ? "currentColor" : "none"}
              />
            </button>
            <button
              className="icon-button ws-detail-close"
              aria-label={uiText("Đóng chi tiết")}
              onClick={() => setDetail(null)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="ws-detail-body">
            <h3>{detail.title}</h3>
            {roomMarkers
              .filter((p) => p.listing_id === detail.id)
              .map((p) => (
                <div className="ws-roommate-badge" key={p.profile_id}>
                  <strong>{p.label}</strong>
                  <p>{p.display_name}</p>
                  <a
                    href={
                      p.source_kind === "demo"
                        ? "/roommate?tab=demo"
                        : "/roommate/profiles/" +
                          encodeURIComponent(p.profile_id)
                    }
                  >
                    {p.source_kind === "demo"
                      ? "Xem hồ sơ DEMO (không kết nối)"
                      : "Xem nhu cầu ở ghép"}
                  </a>
                </div>
              ))}
            <strong className="price">{housePrice(detail)}</strong>
            <p className="muted address">
              <MapPin size={14} />
              {formatAddress(detail.address)}
            </p>
            <div className="ws-tiles">
              <div>
                <Ruler size={18} />
                <strong>
                  {detail.area_m2 != null ? `${detail.area_m2} m²` : "—"}
                </strong>
                <small>{uiText("Diện tích")}</small>
              </div>
              <div>
                <BedDouble size={18} />
                <strong>{detail.bedrooms ?? "—"}</strong>
                <small>{uiText("Phòng ngủ")}</small>
              </div>
              <div>
                <Bath size={18} />
                <strong>{detail.bathrooms ?? "—"}</strong>
                <small>{uiText("Phòng tắm")}</small>
              </div>
            </div>
            {(detail.amenities || []).length > 0 && (
              <>
                <h4>{uiText("Tiện nghi")}</h4>
                <div className="tags">
                  {detail.amenities.map((a: string) => (
                    <span className="tag" key={a}>
                      {AMENITY_LABELS[a] || a}
                    </span>
                  ))}
                </div>
              </>
            )}
            <div className="ws-nearby">
              <div>
                <h4>{uiText("Tiện ích xung quanh")}</h4>
                <small className="muted">
                  {uiText(
                    "Tiện ích luôn hiển thị trên bản đồ. Phóng to quanh căn này để xem y tế, trường học, mua sắm và giao thông.",
                  )}
                </small>
              </div>
              <button
                className="ws-pill-button"
                onClick={() => {
                  if (Number.isFinite(detail.lat) && map.current)
                    focusMapPoint(
                      map.current,
                      [detail.lng!, detail.lat!],
                      Math.max(map.current.getZoom(), 15.5),
                    );
                }}
              >
                <Layers size={14} />
                {uiText(" Xem quanh căn")}
              </button>
            </div>
            {Number.isFinite(detail.lat) && (
              <p className="muted small">
                {uiText("Toạ độ: ")}
                {detail.lat!.toFixed(6)}, {detail.lng!.toFixed(6)}
                {detail.location_accuracy !== "rooftop"
                  ? uiText(
                      " · vị trí gần đúng theo nguồn, hãy xác nhận số nhà với người cho thuê",
                    )
                  : uiText(" · vị trí chính xác theo nguồn")}
              </p>
            )}
            {detail.description && (
              <p className="ws-description">{detail.description}</p>
            )}
            {detail.detailError && (
              <p className="notice amber">
                {uiText(
                  "Chưa tải được đầy đủ tin; đang hiển thị dữ liệu danh sách.",
                )}
              </p>
            )}
          </div>
          <div className="ws-detail-actions">
            {directionsButton(detail)}
            {selectButton(detail, true)}
            {compareButton(detail)}
          </div>
        </aside>
      )}
      {comparing && (
        <Comparison
          houses={comparisonHomes}
          refresh
          onClose={() => setComparing(false)}
          onOpen={(h) => {
            setComparing(false);
            void openDetail(h);
          }}
        />
      )}
      {directions && (
        <HousingDirections
          house={directions}
          onClose={() => setDirections(null)}
        />
      )}
    </div>
  );
}

function Stats({ house: h }: { house: House }) {
  return (
    <div className="house-stats">
      {h.area_m2 != null && (
        <span>
          <Ruler size={13} />
          {h.area_m2} m²
        </span>
      )}
      {h.bedrooms != null && (
        <span>
          <BedDouble size={13} />
          {h.bedrooms} PN
        </span>
      )}
      {h.bathrooms != null && (
        <span>
          <Bath size={13} />
          {h.bathrooms} WC
        </span>
      )}
    </div>
  );
}

function spanOk(b: BBox) {
  return (
    b.west < b.east &&
    b.south < b.north &&
    b.east - b.west <= 3 &&
    b.north - b.south <= 3
  );
}

function chipValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v && typeof v === "object" && "amount" in (v as Data))
    return `${(v as Data).amount.toLocaleString("vi-VN")}đ`;
  return String(v);
}
