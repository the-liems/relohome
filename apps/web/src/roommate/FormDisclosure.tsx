import type { ReactNode } from "react";

/** Keep optional values mounted, and reveal invalid fields before native focus. */
export function FormDisclosure({
  title,
  hint,
  children,
  defaultOpen = false,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="rm-disclosure"
      open={defaultOpen || undefined}
      onInvalidCapture={(event) => {
        let section = (event.target as HTMLElement).closest("details");
        while (section) {
          section.open = true;
          section = section.parentElement?.closest("details") || null;
        }
      }}
    >
      <summary>
        <span>{title}</span>
        {hint && <small>{hint}</small>}
      </summary>
      <div className="rm-disclosure-body">{children}</div>
    </details>
  );
}
