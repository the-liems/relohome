import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, House as HouseIcon } from "lucide-react";
import { safeUrl } from "../api";
import type { House } from "../types";
import { formatUi, t, useUiPreferences } from "../uiPreferences";
import "./houseGallery.css";

// Detail photos retain the API order. List-only homes can still show their cover.
function photos(house: House): { url: string; alt: string }[] {
  const seen = new Set<string>();
  const images = (Array.isArray(house.images) ? house.images : []).flatMap(
    (image: unknown) => {
      const item = typeof image === "string" ? { url: image } : image;
      if (!item || typeof item !== "object" || !("url" in item)) return [];
      const url = safeUrl(item.url);
      if (!url || seen.has(url)) return [];
      seen.add(url);
      return [
        {
          url,
          alt: "alt" in item && typeof item.alt === "string" ? item.alt : "",
        },
      ];
    },
  );
  const cover = safeUrl(house.thumbnail_url);
  return images.length
    ? images
    : cover
      ? [{ url: cover, alt: house.title }]
      : [];
}

export function HouseGallery({ house }: { house: House }) {
  // Subscribe for translated controls even when the parent does not read preferences.
  useUiPreferences();
  const images = photos(house);
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const thumbnails = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const index = Math.max(
    0,
    images.findIndex((image) => image.url === selected),
  );
  const current = images[index];
  const multiple = images.length > 1;
  const move = (delta: number) => {
    if (multiple)
      setSelected(images[(index + delta + images.length) % images.length].url);
  };
  useEffect(() => {
    const strip = thumbnails.current;
    const button = strip?.children[index] as HTMLElement | undefined;
    if (strip && button)
      strip.scrollTo({
        left:
          button.offsetLeft -
          strip.offsetLeft -
          (strip.clientWidth - button.clientWidth) / 2,
      });
  }, [index]);

  return (
    <div className="house-gallery" role="group" aria-label={t("Ảnh căn nhà")}>
      <div
        className="house-gallery-stage"
        role="group"
        tabIndex={multiple ? 0 : undefined}
        aria-label={
          multiple ? t("Dùng phím trái/phải hoặc vuốt để xem ảnh") : undefined
        }
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            move(event.key === "ArrowRight" ? 1 : -1);
          }
        }}
        onPointerDown={(event) => {
          if (
            event.pointerType === "mouse" ||
            (event.target as HTMLElement).closest("button")
          )
            return;
          swipe.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy))
            move(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        {current && !failed.has(current.url) ? (
          <img
            key={current.url}
            src={current.url}
            alt={
              current.alt || formatUi("{0} — ảnh {1}", [house.title, index + 1])
            }
            draggable={false}
            onError={() => setFailed((old) => new Set(old).add(current.url))}
          />
        ) : (
          <div className="house-placeholder">
            <HouseIcon size={30} />
            <span>{t(current ? "Không tải được ảnh này" : "Chưa có ảnh")}</span>
          </div>
        )}
        {multiple && (
          <>
            <button
              type="button"
              className="house-gallery-arrow previous"
              aria-label={t("Ảnh trước")}
              onClick={() => move(-1)}
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              className="house-gallery-arrow next"
              aria-label={t("Ảnh tiếp theo")}
              onClick={() => move(1)}
            >
              <ChevronRight size={22} />
            </button>
            <span
              className="house-gallery-count"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {formatUi("Ảnh {0} / {1}", [index + 1, images.length])}
            </span>
          </>
        )}
      </div>
      {multiple && (
        <div
          className="house-gallery-thumbnails"
          role="group"
          ref={thumbnails}
          aria-label={t("Chọn ảnh")}
        >
          {images.map((image, i) => (
            <button
              type="button"
              key={image.url}
              aria-label={formatUi("Xem ảnh {0}", [i + 1])}
              aria-pressed={i === index}
              onClick={() => setSelected(image.url)}
            >
              {failed.has(image.url) ? (
                <HouseIcon size={18} />
              ) : (
                <img
                  src={image.url}
                  alt=""
                  loading="lazy"
                  onError={() =>
                    setFailed((old) => new Set(old).add(image.url))
                  }
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
