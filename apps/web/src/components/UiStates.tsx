import type { ReactNode } from "react";

export function ContentSkeleton({
  label,
  rows = 3,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <div className="skeleton-list" role="status" aria-busy="true">
      <span className="muted small">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i} aria-hidden="true">
          <span className="skeleton-block skeleton-thumb" />
          <span className="skeleton-copy">
            <span className="skeleton-block skeleton-line" />
            <span className="skeleton-block skeleton-line short" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-inline">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p className="muted">{text}</p>
      {children}
    </div>
  );
}
