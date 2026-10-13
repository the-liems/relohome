// Map visuals ported from ReloHome map-app (config/map-theme.ts, config/poi-groups.ts and the
// marker/basemap helpers in components/MapView.tsx) so the chat workspace matches that app.
import type {
  DataDrivenPropertyValueSpecification,
  ExpressionSpecification,
  Map as LibreMap,
} from "maplibre-gl";

export const BASEMAP_STYLE_URL =
  "https://tiles.openfreemap.org/styles/positron";

export const MAP_THEME = {
  primary: "#256348",
  primaryDark: "#182f24",
  route: "#347fd6",
  poiBorder: "#365364",
  housingMarker: {
    fill: "#d6efe9",
    border: "#176e69",
    text: "#0b675e",
    hoverFill: "#f0fcf9",
  },
  basemap: {
    land: "#ebf0f0",
    residential: "#f6f5f5",
    water: "#b0d0d9",
    waterway: "#96c0cd",
    park: "#d2f8e2",
    wood: "#c8f0d8",
    building: "#e5eaf0",
    buildingOutline: "#d2dae3",
    minorRoad: "#c2cdd8",
    majorRoad: "#a5b6c8",
    motorway: "#7f9bb8",
    roadInner: "#f6f5f5",
  },
  cluster: { low: "#788f9b", medium: "#5f7e91", high: "#405e70" },
  categories: {
    accommodation: "#788f9b",
    healthcare: "#e47bb6",
    shopping: "#63a6e9",
    education: "#63a6e9",
    food: "#ff9933",
    transport: "#63a6e9",
    utility: "#788f9b",
    lifestyle: "#36b95c",
  },
} as const;

// Cartographic palette: slate land/roads keep Emerald reserved for housing choices.
// The existing light palette above stays intact.
export const DARK_MAP_THEME = {
  primary: "#65d9ab",
  primaryDark: "#1d4c3f",
  housingMarker: {
    fill: "#203c3b",
    border: "#57b99c",
    text: "#c5f4e3",
    hoverFill: "#30574d",
    selectedText: "#09281e",
  },
  basemap: {
    land: "#182332",
    residential: "#202d3e",
    water: "#1e3d52",
    waterway: "#36566c",
    park: "#253c39",
    wood: "#293d38",
    building: "#314156",
    buildingOutline: "#3b4b5f",
    minorRoad: "#3d4d63",
    majorRoad: "#596e86",
    motorway: "#8296ad",
    roadInner: "#34465d",
    roadCasing: "#263548",
    label: "#cbd8e6",
    shieldText: "#263548",
    shieldHalo: "#f7f9f8",
  },
} as const;

function isDarkMap() {
  return document.documentElement.dataset.theme === "dark";
}

export function housingPriceColor(): ExpressionSpecification {
  const dark = isDarkMap();
  return [
    "case",
    ["get", "roommate"],
    "#713f12",
    ["==", ["get", "state"], "selected"],
    dark ? DARK_MAP_THEME.housingMarker.selectedText : "#ffffff",
    dark ? DARK_MAP_THEME.housingMarker.text : MAP_THEME.housingMarker.text,
  ];
}

export type PoiGroup = keyof typeof MAP_THEME.categories;
export const POI_GROUP_LABELS: Record<PoiGroup, string> = {
  accommodation: "Lưu trú",
  healthcare: "Y tế",
  shopping: "Mua sắm",
  education: "Giáo dục",
  food: "Ăn uống",
  transport: "Giao thông",
  utility: "Tiện ích",
  lifestyle: "Giải trí",
};
export const PILL = {
  normal: "ws-pill",
  hover: "ws-pill-hover",
  selected: "ws-pill-selected",
  roommate: "ws-pill-roommate",
};
export const POI_ICON_EXPRESSION: any = [
  "match",
  ["get", "group"],
  ...Object.keys(MAP_THEME.categories).flatMap((g) => [g, "poi-" + g]),
  "poi-utility",
];

const imageThemes = new WeakMap<LibreMap, boolean>();
export function registerMapImages(map: LibreMap) {
  const dark = isDarkMap();
  const theme = dark ? DARK_MAP_THEME : MAP_THEME;
  const changed = imageThemes.get(map) !== dark;
  const pills = [
    [PILL.roommate, "#fde047", "#a16207", "rgba(161, 98, 7, 0.2)", 4.5],
    [
      PILL.normal,
      theme.housingMarker.fill,
      theme.housingMarker.border,
      "rgba(24, 92, 86, 0.28)",
      4.5,
    ],
    [
      PILL.hover,
      theme.housingMarker.hoverFill,
      theme.primaryDark,
      "rgba(194, 65, 12, 0.26)",
      3.5,
    ],
    [
      PILL.selected,
      theme.primary,
      theme.primaryDark,
      "rgba(194, 65, 12, 0.28)",
      3.5,
    ],
  ] as const;
  for (const [name, fill, border, shadow, width] of pills) {
    if (map.hasImage(name) && !changed) continue;
    const image = pillImage(fill, border, shadow, width);
    if (image) {
      if (map.hasImage(name)) map.updateImage(name, image);
      else
        map.addImage(name, image, {
          pixelRatio: 2,
          stretchX: [[28, 92]],
          stretchY: [[22, 34]],
          content: [20, 12, 100, 44],
        });
    }
  }
  for (const [group, color] of Object.entries(MAP_THEME.categories) as [
    PoiGroup,
    string,
  ][]) {
    const name = "poi-" + group;
    if (map.hasImage(name)) continue;
    const image = poiIcon(group, color);
    if (image) map.addImage(name, image, { pixelRatio: 2 });
  }
  imageThemes.set(map, dark);
}

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element.getContext("2d");
}

function pillImage(
  fill: string,
  border: string,
  shadow: string,
  width: number,
) {
  const context = canvas(120, 56);
  if (!context) return null;
  context.shadowColor = shadow;
  context.shadowBlur = 7;
  context.shadowOffsetY = 3;
  context.fillStyle = fill;
  context.strokeStyle = border;
  context.lineWidth = width;
  context.beginPath();
  context.roundRect(7, 6, 106, 42, 18);
  context.fill();
  context.shadowColor = "transparent";
  context.stroke();
  return context.getImageData(0, 0, 120, 56);
}

function poiIcon(group: PoiGroup, color: string) {
  const context = canvas(56, 56);
  if (!context) return null;
  context.shadowColor = "rgba(25, 39, 54, 0.18)";
  context.shadowBlur = 5;
  context.shadowOffsetY = 1.5;
  context.fillStyle = color;
  context.beginPath();
  context.arc(28, 27, 19.5, 0, Math.PI * 2);
  context.fill();
  context.shadowColor = "transparent";
  context.strokeStyle = MAP_THEME.poiBorder;
  context.lineWidth = 3;
  context.stroke();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#ffffff";
  context.fillStyle = "#ffffff";
  glyph(context, group);
  return context.getImageData(0, 0, 56, 56);
}

function glyph(c: CanvasRenderingContext2D, group: PoiGroup) {
  const line = (points: number[][]) => {
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
  };
  if (group === "healthcare") {
    c.fillRect(25, 16, 6, 22);
    c.fillRect(17, 24, 22, 6);
  } else if (group === "shopping") {
    c.strokeRect(18, 21, 20, 17);
    c.beginPath();
    c.arc(28, 22, 7, Math.PI, 0);
    c.stroke();
  } else if (group === "education") {
    line([
      [15, 23],
      [28, 17],
      [41, 23],
      [28, 29],
      [15, 23],
    ]);
    line([
      [20, 27],
      [20, 34],
      [36, 34],
      [36, 27],
    ]);
  } else if (group === "food") {
    line([
      [20, 17],
      [20, 38],
    ]);
    line([
      [16, 17],
      [16, 25],
      [24, 25],
      [24, 17],
    ]);
    line([
      [35, 17],
      [35, 38],
    ]);
  } else if (group === "transport") {
    c.strokeRect(17, 17, 22, 20);
    line([
      [20, 24],
      [36, 24],
    ]);
  } else if (group === "accommodation") {
    c.strokeRect(17, 22, 22, 12);
    line([
      [17, 18],
      [17, 38],
    ]);
  } else if (group === "lifestyle") {
    line([
      [16, 24],
      [16, 32],
    ]);
    line([
      [20, 21],
      [20, 35],
    ]);
    line([
      [20, 28],
      [36, 28],
    ]);
    line([
      [36, 21],
      [36, 35],
    ]);
    line([
      [40, 24],
      [40, 32],
    ]);
  } else {
    line([
      [17, 37],
      [39, 37],
    ]);
    line([
      [20, 33],
      [20, 25],
    ]);
    line([
      [28, 33],
      [28, 25],
    ]);
    line([
      [36, 33],
      [36, 25],
    ]);
    line([
      [16, 23],
      [28, 17],
      [40, 23],
    ]);
  }
}

// Quieter basemap like map-app: hide noisy POI labels, soften land/building/road colours.
const observedMaps = new WeakSet<LibreMap>();
// Save only paints changed exclusively for dark mode. Layer instances expire on
// style reload, so switching back restores the provider's original light styling.
type DarkPaintProperty = "line-color" | "fill-color";
const originalPaints = new WeakMap<
  object,
  Map<
    DarkPaintProperty,
    DataDrivenPropertyValueSpecification<string> | undefined
  >
>();
export function tuneBasemap(map: LibreMap) {
  if (!observedMaps.has(map)) {
    observedMaps.add(map);
    const update = () => {
      // GeoJSON/route sources can still be loading while basemap paint is ready.
      // Apply appearance without recreating the map or waiting for every source.
      if (map.getStyle()) tuneBasemap(map);
    };
    window.addEventListener("siu:appearance-change", update);
    map.once("remove", () =>
      window.removeEventListener("siu:appearance-change", update),
    );
  }
  const dark = isDarkMap();
  const b = dark ? DARK_MAP_THEME.basemap : MAP_THEME.basemap;
  const noisy = /(poi|shop|restaurant|cafe|bar|lodging|transit|bus_stop)/i;
  for (const layer of map.getStyle().layers || []) {
    try {
      const instance = map.getLayer(layer.id)!;
      if (!dark) {
        const originals = originalPaints.get(instance);
        originals?.forEach((value, property) =>
          map.setPaintProperty(layer.id, property, value),
        );
        originalPaints.delete(instance);
      }
      const darkPaint = (property: DarkPaintProperty, value: string) => {
        let originals = originalPaints.get(instance);
        if (!originals) originalPaints.set(instance, (originals = new Map()));
        if (!originals.has(property))
          originals.set(property, map.getPaintProperty(layer.id, property));
        map.setPaintProperty(layer.id, property, value);
      };
      if (layer.type === "symbol" && layer.source === "openmaptiles") {
        // Provider road shields have a light sprite even in dark mode.
        const shield = /shield/.test(layer.id);
        map.setPaintProperty(
          layer.id,
          "text-color",
          dark
            ? shield
              ? DARK_MAP_THEME.basemap.shieldText
              : DARK_MAP_THEME.basemap.label
            : "#42564a",
        );
        map.setPaintProperty(
          layer.id,
          "text-halo-color",
          dark
            ? shield
              ? DARK_MAP_THEME.basemap.shieldHalo
              : DARK_MAP_THEME.basemap.land
            : "#f7f9f8",
        );
      }
      if (layer.type === "symbol" && noisy.test(layer.id))
        map.setLayoutProperty(layer.id, "visibility", "none");
      if (layer.type === "background")
        map.setPaintProperty(layer.id, "background-color", b.land);
      if (layer.type === "fill" && layer.id === "landuse_residential")
        map.setPaintProperty(layer.id, "fill-color", b.residential);
      if (layer.type === "fill" && layer.id === "building") {
        map.setPaintProperty(layer.id, "fill-color", b.building);
        map.setPaintProperty(layer.id, "fill-outline-color", b.buildingOutline);
        map.setPaintProperty(layer.id, "fill-opacity", dark ? 0.22 : 0.34);
      }
      if (layer.type === "fill" && layer.id === "water")
        map.setPaintProperty(layer.id, "fill-color", b.water);
      if (layer.type === "fill" && layer.id === "park")
        map.setPaintProperty(layer.id, "fill-color", b.park);
      if (layer.type === "fill" && layer.id === "landcover_wood")
        map.setPaintProperty(layer.id, "fill-color", b.wood);
      if (layer.type === "line" && layer.id === "waterway")
        map.setPaintProperty(layer.id, "line-color", b.waterway);
      if (
        layer.type === "line" &&
        /^(highway_minor|highway_path)$/.test(layer.id)
      )
        map.setPaintProperty(layer.id, "line-color", b.minorRoad);
      if (
        layer.type === "line" &&
        /^highway_major_(casing|subtle)$/.test(layer.id)
      )
        map.setPaintProperty(layer.id, "line-color", b.majorRoad);
      if (layer.type === "line" && layer.id === "highway_major_inner")
        map.setPaintProperty(layer.id, "line-color", b.roadInner);
      if (
        layer.type === "line" &&
        /^highway_motorway_(inner|subtle)$/.test(layer.id)
      )
        map.setPaintProperty(layer.id, "line-color", b.motorway);
      if (
        dark &&
        layer.type === "line" &&
        /^(highway|tunnel)_motorway_(bridge_)?(casing|inner)$/.test(layer.id)
      )
        darkPaint(
          "line-color",
          layer.id.endsWith("casing")
            ? DARK_MAP_THEME.basemap.roadCasing
            : b.motorway,
        );
      if (
        dark &&
        layer.type === "line" &&
        /^(railway|aeroway-|road_pier)/.test(layer.id)
      )
        darkPaint(
          "line-color",
          /casing|dashline/.test(layer.id) ? b.roadInner : b.majorRoad,
        );
      if (
        dark &&
        layer.type === "fill" &&
        /^(aeroway-area|road_area_pier|landcover_ice_shelf|landcover_glacier)$/.test(
          layer.id,
        )
      )
        darkPaint("fill-color", b.residential);
    } catch {
      // Optional basemap layers differ between style versions; skip what is absent.
    }
  }
  // Refresh existing overlays in place: preserve source data, camera and selection.
  if (map.hasImage(PILL.normal)) registerMapImages(map);
  for (const id of ["ws-listing", "ws-listing-active"])
    if (map.getLayer(id))
      map.setPaintProperty(id, "text-color", housingPriceColor());
}

export const CLUSTER_COLOR: any = [
  "step",
  ["get", "count"],
  MAP_THEME.cluster.low,
  50,
  MAP_THEME.cluster.medium,
  500,
  MAP_THEME.cluster.high,
];
export const CLUSTER_RADIUS: any = [
  "step",
  ["get", "count"],
  18,
  50,
  23,
  500,
  29,
];
