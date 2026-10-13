import {
  Children,
  cloneElement,
  isValidElement,
  useRef,
  type ReactNode,
} from "react";

// Manual activation: arrow keys move focus only. Enter/Space invoke the original button handler.
export function TabList({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={className}
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        const tabs = Array.from(
          ref.current?.querySelectorAll<HTMLButtonElement>(
            '[role="tab"]:not([disabled])',
          ) || [],
        );
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        const next =
          event.key === "ArrowRight"
            ? (index + 1) % tabs.length
            : event.key === "ArrowLeft"
              ? (index + tabs.length - 1) % tabs.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : -1;
        if (next < 0) return;
        event.preventDefault();
        tabs.forEach((tab, i) => {
          tab.tabIndex = i === next ? 0 : -1;
        });
        tabs[next].focus();
      }}
    >
      {Children.map(children, (child) =>
        isValidElement<{ "aria-selected"?: boolean; tabIndex?: number }>(child)
          ? cloneElement(child, {
              tabIndex: child.props["aria-selected"] ? 0 : -1,
            })
          : child,
      )}
    </div>
  );
}
