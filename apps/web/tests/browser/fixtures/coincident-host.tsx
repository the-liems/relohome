// Browser-only fixture: production entrypoints never import this module.
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Map as LibreMap } from "maplibre-gl";
import { MapWorkspace } from "../../../src/components/MapWorkspace";
import { setUiPreferences } from "../../../src/uiPreferences";
import type { House } from "../../../src/types";

export let map: LibreMap;
export const chosen: string[] = [];
export const saved: string[] = [];
export const unselected: string[] = [];
let root: ReturnType<typeof createRoot>;
const originalAddSource = LibreMap.prototype.addSource;

function Host({ viewing = false }: { viewing?: boolean }) {
  const [selected, setSelected] = useState<string>();
  const [viewingIds, setViewingIds] = useState<string[]>([]);
  return createElement(MapWorkspace, {
    focus: {
      key: "fixture",
      viewport: { west: 105.79, east: 105.81, south: 21.02, north: 21.04 },
    },
    initialFilters: {},
    saved: new Set(saved),
    selectedId: viewing ? undefined : selected,
    selectedIds: viewing ? viewingIds : undefined,
    selectionLimit: viewing ? 3 : undefined,
    onSelectionDone: viewing ? () => {} : undefined,
    onUnselect: viewing
      ? async (h: House) => {
          unselected.push(h.id);
          setViewingIds((ids) => ids.filter((id) => id !== h.id));
        }
      : undefined,
    chat: { questions: [], busy: false, online: true, onSend: async () => {} },
    onSave: (h: House) => {
      saved.push(h.id);
    },
    onSelect: async (h: House) => {
      chosen.push(h.id);
      if (viewing) setViewingIds((ids) => [...ids, h.id]);
      else setSelected(h.id);
    },
    onExit: () => {},
  });
}

export function mount(viewing = false) {
  chosen.length = 0;
  saved.length = 0;
  unselected.length = 0;
  setUiPreferences({ locale: "vi", theme: "light" });
  LibreMap.prototype.addSource = function (...args) {
    if (args[0] === "ws-listings") map = this;
    return originalAddSource.apply(this, args);
  };
  const container = document.createElement("div");
  container.id = "coincident-host";
  // Match the real chat workspace's bounded flex parent so the list can scroll.
  container.style.cssText =
    "position:fixed;inset:0;z-index:10000;background:white;display:flex;flex-direction:column";
  document.body.append(container);
  root = createRoot(container);
  root.render(
    createElement(BrowserRouter, null, createElement(Host, { viewing })),
  );
}

export function pins() {
  return (
    (map?.getSource("ws-listings")?.serialize() as any)?.data?.features ?? []
  );
}

export function locale(value: "vi" | "en") {
  setUiPreferences({ locale: value });
}
export function theme(value: "light" | "dark") {
  setUiPreferences({ theme: value });
}
export function unmount() {
  root?.unmount();
  LibreMap.prototype.addSource = originalAddSource;
  document.getElementById("coincident-host")?.remove();
}
