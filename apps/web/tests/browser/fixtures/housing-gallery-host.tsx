import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { HousingDetail } from "../../../src/components/Housing";
import type { House } from "../../../src/types";
import { setUiPreferences } from "../../../src/uiPreferences";

let root: ReturnType<typeof createRoot>;
export function mount(house: House) {
  setUiPreferences({ locale: "vi", theme: "light" });
  const container = document.createElement("div");
  container.id = "gallery-dialog-host";
  document.body.append(container);
  root = createRoot(container);
  root.render(
    createElement(HousingDetail, {
      house,
      saved: false,
      selected: false,
      busy: false,
      onClose: () => root.unmount(),
      onSave: () => {},
    }),
  );
}
export function unmount() {
  root?.unmount();
  document.getElementById("gallery-dialog-host")?.remove();
}
