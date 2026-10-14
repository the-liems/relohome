import { t as uiText } from "../uiPreferences";
import { useEffect, useRef, useState } from "react";
import { Expand, Layers, MapPin, RotateCw } from "lucide-react";
import type { Map as LibreMap, GeoJSONSource } from "maplibre-gl";
import { api, housePrice } from "../api";
import type { Data, House } from "../types";
import { Dialog } from "./Dialog";
import { tuneBasemap } from "../mapStyle";
import {
  cityForPoint,
  scopedMapOptions,
  installMapScope,
  fitMapPoints,
  focusMapPoint,
} from "../mapScope";

// Same MapLibre basemap and semantic colors as ReloHome examples/map-app/src/config/map-theme.ts.
const theme = {
  fill: "#d6efe9",
  border: "#176e69",
  selected: "#256348",
  route: "#347fd6",
};
export function MapPanel({
  houses = [],
  points = [],
  routing,
  selected,
  onSelect,
  onPick,
  filter,
  large = false,
  initialViewport,
  initialExplore = false,
  onViewport,
}: {
  houses?: House[];
  points?: Data[];
  routing?: Data;
  selected?: string;
  onSelect?: (h: House) => void;
  onPick?: (lat: number, lng: number) => void;
  filter?: Data;
  large?: boolean;
  initialViewport?: { center: [number, number]; zoom: number } | null;
  initialExplore?: boolean;
  onViewport?: (v: { center: [number, number]; zoom: number }) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LibreMap | null>(null),
    fitted = useRef(""),
    viewport = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false),
    [explore, setExplore] = useState(initialExplore),
    [explored, setExplored] = useState<House[]>([]),
    [truncated, setTruncated] = useState(false);
  const [clusters, setClusters] = useState<Data[]>([]),
    [inspected, setInspected] = useState<House | null>(null);
  const latest = useRef({ houses, points, onSelect, onPick, selected });
  latest.current = {
    houses: explore ? explored : houses,
    points,
    onSelect,
    onPick,
    selected,
  };
  useEffect(() => {
    let disposed = false;
    import("maplibre-gl")
      .then(({ Map, NavigationControl, setWorkerUrl }) => {
        if (disposed || !container.current) return;
        try {
          setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
          const first =
            initialViewport?.center ||
            houses
              .filter((h) => Number.isFinite(h.lng) && Number.isFinite(h.lat))
              .map((h) => [h.lng!, h.lat!] as [number, number])[0] ||
            points
              .map(
                (p) =>
                  [p.location?.lng ?? p.lng, p.location?.lat ?? p.lat] as [
                    number,
                    number,
                  ],
              )
              .find((p) => cityForPoint(p)) ||
            routing?.route?.geometry?.coordinates?.[0];
          const city = first ? (cityForPoint(first) ?? "hcm") : "hcm";
          const m = new Map({
            container: container.current,
            style: "https://tiles.openfreemap.org/styles/positron",
            ...scopedMapOptions(container.current, city, initialViewport),
            attributionControl: { compact: true },
          });
          map.current = m;
          m.on("style.load", () => tuneBasemap(m));
          installMapScope(m, city);
          fitted.current = "";
          m.on("moveend", () => {
            const c = m.getCenter();
            viewport.current = { center: [c.lng, c.lat], zoom: m.getZoom() };
            onViewport?.(viewport.current);
          });
          m.addControl(
            new NavigationControl({ showCompass: false }),
            "top-right",
          );
          m.on("error", () =>
            setError(
              "Chưa tải được một phần bản đồ. Danh sách kết quả vẫn dùng được.",
            ),
          );
          m.on("load", () => {
            if (disposed) return;
            tuneBasemap(m);
            m.addSource("siu-points", {
              type: "geojson",
              data: { type: "FeatureCollection", features: [] },
              cluster: true,
              clusterMaxZoom: 12,
              clusterRadius: 44,
            });
            m.addLayer({
              id: "clusters",
              type: "circle",
              source: "siu-points",
              filter: ["has", "point_count"],
              paint: {
                "circle-color": theme.border,
                "circle-radius": 22,
                "circle-stroke-width": 3,
                "circle-stroke-color": "#fff",
              },
            });
            m.addLayer({
              id: "counts",
              type: "symbol",
              source: "siu-points",
              filter: ["has", "point_count"],
              layout: {
                "text-field": ["get", "point_count_abbreviated"],
                "text-size": 13,
              },
              paint: { "text-color": "#fff" },
            });
            m.addLayer({
              id: "markers",
              type: "circle",
              source: "siu-points",
              filter: ["!", ["has", "point_count"]],
              paint: {
                "circle-color": [
                  "case",
                  ["get", "selected"],
                  theme.selected,
                  ["get", "poi"],
                  "#c7d7fe",
                  theme.fill,
                ],
                "circle-radius": 11,
                "circle-stroke-width": 2.5,
                "circle-stroke-color": theme.border,
              },
            });
            m.addSource("siu-server-clusters", {
              type: "geojson",
              data: { type: "FeatureCollection", features: [] },
            });
            m.addLayer({
              id: "server-clusters",
              type: "circle",
              source: "siu-server-clusters",
              paint: {
                "circle-color": theme.border,
                "circle-radius": 24,
                "circle-stroke-width": 3,
                "circle-stroke-color": "#fff",
              },
            });
            m.addLayer({
              id: "server-counts",
              type: "symbol",
              source: "siu-server-clusters",
              layout: {
                "text-field": ["to-string", ["get", "count"]],
                "text-size": 13,
              },
              paint: { "text-color": "#fff" },
            });
            m.addSource("siu-route", {
              type: "geojson",
              data: { type: "FeatureCollection", features: [] },
            });
            m.addLayer({
              id: "route-casing",
              type: "line",
              source: "siu-route",
              paint: { "line-width": 8, "line-color": "#fff" },
            });
            m.addLayer({
              id: "route",
              type: "line",
              source: "siu-route",
              paint: { "line-width": 4, "line-color": theme.route },
            });
            setReady(true);
            setError("");
          });
          m.on("click", async (event) => {
            const features = m.getLayer("markers")
              ? m.queryRenderedFeatures(event.point, {
                  layers: ["markers", "clusters", "server-clusters"],
                })
              : [];
            const feature = features[0];
            if (feature?.layer.id === "server-clusters") {
              m.easeTo({
                center: (feature.geometry as any).coordinates,
                zoom: Math.min(m.getZoom() + 2, 20),
              });
              return;
            }
            if (feature?.properties?.cluster) {
              const zoom = await (
                m.getSource("siu-points") as GeoJSONSource
              ).getClusterExpansionZoom(feature.properties.cluster_id);
              m.easeTo({ center: (feature.geometry as any).coordinates, zoom });
              return;
            }
            if (feature) {
              const h = latest.current.houses.find(
                (h) => h.id === feature.properties.id,
              );
              if (h?.exploratory) setInspected(h);
              else if (h) latest.current.onSelect?.(h);
            } else latest.current.onPick?.(event.lngLat.lat, event.lngLat.lng);
          });
        } catch {
          setError(
            "Thiết bị chưa hỗ trợ bản đồ tương tác. Bạn vẫn có thể xem danh sách và nhập tọa độ.",
          );
        }
      })
      .catch(() => setError("Không tải được bản đồ. Hãy thử lại."));
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      setReady(false);
    };
  }, [attempt]);
  const rows = explore ? explored : houses;
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const features = [
      ...rows.map((h) => ({ ...h, poi: false })),
      ...points.map((p) => ({
        ...p,
        id: p.id || p.name,
        lat: p.location?.lat ?? p.lat,
        lng: p.location?.lng ?? p.lng,
        poi: true,
      })),
    ]
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng!, p.lat!] },
        properties: { id: p.id, selected: p.id === selected, poi: p.poi },
      }));
    (m.getSource("siu-points") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features,
    });
    (m.getSource("siu-server-clusters") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: explore
        ? clusters.map((c) => ({
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [c.location.lng, c.location.lat],
            },
            properties: { count: c.count },
          }))
        : [],
    });
    const geometry = routing?.route?.geometry;
    (m.getSource("siu-route") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features:
        geometry?.type === "LineString"
          ? [{ type: "Feature", properties: {}, geometry }]
          : [],
    });
    const signature = JSON.stringify([
      features.map((f) => f.geometry),
      geometry,
    ]);
    if (explore || fitted.current === signature) return;
    fitted.current = signature;
    if (initialViewport) return;
    if (features.length) {
      fitMapPoints(
        m,
        features.map((f) => f.geometry.coordinates),
        { padding: 55, maxZoom: 15, duration: 500 },
      );
    } else if (geometry?.coordinates?.length && !explore) {
      const xy = geometry.coordinates as number[][];
      fitMapPoints(m, xy, { padding: 45, duration: 500 });
    }
  }, [rows, points, selected, routing, ready, explore, clusters]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !explore) return;
    let controller: AbortController | undefined,
      timer: ReturnType<typeof setTimeout>,
      generation = 0;
    const load = () => {
      clearTimeout(timer);
      controller?.abort();
      const current = ++generation;
      timer = setTimeout(async () => {
        controller = new AbortController();
        const bounds = m.getBounds();
        try {
          const allowed = [
            "currency",
            "price_period",
            "min_price",
            "max_price",
            "min_bedrooms",
            "max_bedrooms",
            "min_bathrooms",
            "min_area_m2",
            "max_area_m2",
            "district",
            "administrative_area_ids",
            "amenities",
            "nearby",
            "verification_requirement",
            "source_filters",
            "listing_type",
            "property_type",
            "text",
            "availability_from",
            "availability_to",
          ];
          const scoped = Object.fromEntries(
            Object.entries(filter || {}).filter(([k]) => allowed.includes(k)),
          );
          for (const key of ["listing_type", "property_type"]) {
            if (scoped[key] && !Array.isArray(scoped[key]))
              scoped[key] = [scoped[key]];
          }
          const region = filter?.bounding_box;
          const bounding_box = {
            west: Math.max(bounds.getWest(), region?.west ?? -180),
            south: Math.max(bounds.getSouth(), region?.south ?? -90),
            east: Math.min(bounds.getEast(), region?.east ?? 180),
            north: Math.min(bounds.getNorth(), region?.north ?? 90),
          };
          if (
            bounding_box.west >= bounding_box.east ||
            bounding_box.south >= bounding_box.north
          ) {
            setExplored([]);
            setClusters([]);
            setTruncated(false);
            return;
          }
          const result = await api<Data>(
            "/platform/housing/map",
            "POST",
            {
              ...scoped,
              bounding_box,
              zoom: m.getZoom(),
              limit: 500,
            },
            controller.signal,
          );
          if (current !== generation) return;
          setExplored(
            result.features
              .filter((f: Data) => f.kind === "listing")
              .map((f: Data) => ({
                ...f,
                id: f.listing_id,
                title: f.title,
                exploratory: true,
                address:
                  typeof f.address === "string"
                    ? f.address
                    : [f.address?.street, f.address?.district, f.address?.city]
                        .filter(Boolean)
                        .join(", "),
                lat: f.location?.lat,
                lng: f.location?.lng,
              })),
          );
          setClusters(
            result.features.filter((f: Data) => f.kind === "cluster"),
          );
          setTruncated(result.meta?.truncated);
          setError("");
        } catch (e) {
          if (!(e instanceof DOMException && e.name === "AbortError"))
            setError("Chưa tải được nhà trong vùng đang xem.");
        }
      }, 350);
    };
    load();
    m.on("moveend", load);
    return () => {
      ++generation;
      clearTimeout(timer);
      controller?.abort();
      m.off("moveend", load);
    };
  }, [explore, ready, filter]);
  return (
    <section
      className={"map-panel " + (large ? "map-large" : "")}
      data-service="map"
      data-map-ready={ready}
      aria-label={uiText("Bản đồ kết quả")}
    >
      <div className="map-toolbar">
        <span>
          <MapPin size={16} />
          {explore ? uiText("Khám phá khu vực") : uiText("Vị trí trên bản đồ")}
        </span>
        <div>
          {filter && !filter.commute && !filter.center && !filter.radius_m && (
            <button
              aria-label={uiText("Đổi chế độ bản đồ")}
              title={uiText("Khám phá khu vực theo bộ lọc hiện tại")}
              className={explore ? "icon-button active" : "icon-button"}
              onClick={() => setExplore(!explore)}
            >
              <Layers size={16} />
            </button>
          )}
          {!large && (
            <button
              className="icon-button"
              aria-label={uiText("Mở bản đồ lớn")}
              onClick={() => setExpanded(true)}
            >
              <Expand size={16} />
            </button>
          )}
        </div>
      </div>
      {inspected && (
        <Dialog
          title={uiText("Nhà trong khu vực đang xem")}
          onClose={() => setInspected(null)}
        >
          <h3>{inspected.title}</h3>
          <p>{inspected.address}</p>
          <strong>{housePrice(inspected)}</strong>
          <p className="muted">
            {uiText(
              "Đây là tin khám phá trên bản đồ, chưa thuộc nhóm kết quả của cuộc trò chuyện. Hãy yêu cầu AI tìm nhà tại khu vực này để đưa vào kế hoạch.",
            )}
          </p>
          <button
            className="secondary"
            onClick={async () => {
              try {
                setInspected({
                  ...(await api<House>(
                    "/housing/" + encodeURIComponent(inspected.id),
                  )),
                  exploratory: true,
                });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {uiText("Cập nhật thông tin tin nhà")}
          </button>
          {inspected.description && <p>{inspected.description}</p>}
        </Dialog>
      )}
      <div ref={container} className="map-canvas" />
      {error && (
        <div className="map-error" role="status">
          {uiText(error)}
          <button
            className="text-button"
            onClick={() => setAttempt((a) => a + 1)}
          >
            <RotateCw size={14} />
            {uiText(" Tải lại")}
          </button>
        </div>
      )}
      <div className="map-legend">
        <i />{" "}
        {explore
          ? uiText("Nhà trong vùng đang xem")
          : uiText("Các kết quả đang xem")}
        <i className="orange" />
        {uiText(" Đang chọn")}
        {truncated && (
          <span>{uiText(" · Kết quả có giới hạn, hãy phóng to")}</span>
        )}
      </div>
      {expanded && (
        <Dialog
          title={uiText("Bản đồ · Về cuộc trò chuyện khi đóng")}
          wide
          onClose={() => setExpanded(false)}
        >
          <MapPanel
            {...{ houses, points, routing, selected, onSelect, onPick, filter }}
            initialViewport={viewport.current}
            initialExplore={explore}
            onViewport={(v) => {
              viewport.current = v;
              if (map.current) focusMapPoint(map.current, v.center, v.zoom);
            }}
            large
          />
        </Dialog>
      )}
    </section>
  );
}
