import { useEffect, useRef } from "react";

// Progressive enhancement for presentation only; content always remains visible.
export function useUiMotion() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      !root.current ||
      !window.IntersectionObserver ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.motion = "visible";
            observer.unobserve(entry.target);
          }
      },
      { threshold: 0.12, rootMargin: "0px 0px 40px 0px" },
    );
    root.current
      .querySelectorAll<HTMLElement>(
        ".landing-section, .landing-journey, .landing-guide, .landing-final",
      )
      .forEach((section) => {
        section.dataset.motion = "ready";
        observer.observe(section);
      });
    return () => observer.disconnect();
  }, []);
  return root;
}
