import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import english from "./locales/en.json";

export type Theme = "light" | "dark";
export type Locale = "vi" | "en";
const storageKey = "siu-ui-preferences";
type Preferences = { theme: Theme; locale: Locale };
const listeners = new Set<() => void>();
function readPreferences(): Preferences {
  let saved: Partial<Preferences> = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {
    /* Optional browser storage. */
  }
  return {
    theme:
      saved?.theme === "light" || saved?.theme === "dark"
        ? saved.theme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
    locale: saved?.locale === "en" ? "en" : "vi",
  };
}
let current = readPreferences();
function applyPreferences() {
  document.documentElement.dataset.theme = current.theme;
  document.documentElement.lang = current.locale;
  document.documentElement.style.colorScheme = current.theme;
  // Wait for the stylesheet on initial module load; the browser chrome uses the same palette.
  requestAnimationFrame(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        getComputedStyle(document.documentElement).getPropertyValue("--ui-bg").trim(),
      );
  });
  window.dispatchEvent(
    new CustomEvent("siu:appearance-change", { detail: current }),
  );
}
applyPreferences();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function setUiPreferences(next: Partial<Preferences>) {
  current = { ...current, ...next };
  try {
    localStorage.setItem(storageKey, JSON.stringify(current));
  } catch {
    /* Keep preferences in memory. */
  }
  applyPreferences();
  listeners.forEach((listener) => listener());
}
window.addEventListener("storage", (event) => {
  if (event.key !== storageKey && event.key !== null) return;
  current = readPreferences();
  applyPreferences();
  listeners.forEach((listener) => listener());
});
export const uiPreferences = () => current;
export const useUiPreferences = () =>
  useSyncExternalStore(subscribe, uiPreferences, uiPreferences);

// Explicit UI labels only. Never translate provider data, addresses or request bodies.
export function t(value: string): string {
  if (typeof value !== "string") return value;
  if (current.locale === "vi") return value;
  const normalized = value.replace(/\s+/g, " ").trim();
  const translated = (english as Record<string, string>)[normalized];
  if (!translated) return value;
  return (
    (value.match(/^\s+/)?.[0] || "") +
    translated +
    (value.match(/\s+$/)?.[0] || "")
  );
}
export function formatUi(pattern: string, values: unknown[]): string {
  return t(pattern).replace(/\{(\d+)\}/g, (_, index: string) =>
    String(values[Number(index)]),
  );
}
export function AppearanceControls({ className = "" }: { className?: string }) {
  const { theme, locale } = useUiPreferences();
  return (
    <div className={"appearance-controls " + className}>
      <div className="language-switch" role="group" aria-label={t("Ngôn ngữ")}>
        <button
          type="button"
          aria-pressed={locale === "vi"}
          onClick={() => setUiPreferences({ locale: "vi" })}
          title="Tiếng Việt"
        >
          VI
        </button>
        <button
          type="button"
          aria-pressed={locale === "en"}
          onClick={() => setUiPreferences({ locale: "en" })}
          title="English"
        >
          EN
        </button>
      </div>
      <button
        type="button"
        className="theme-switch"
        aria-label={t(
          theme === "light"
            ? "Chuyển sang chế độ tối"
            : "Chuyển sang chế độ sáng",
        )}
        title={t(theme === "light" ? "Chế độ tối" : "Chế độ sáng")}
        onClick={() =>
          setUiPreferences({ theme: theme === "light" ? "dark" : "light" })
        }
      >
        {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
      </button>
    </div>
  );
}
