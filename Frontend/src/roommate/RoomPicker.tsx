import { useEffect, useRef, useState } from "react";
import { api, money } from "../api";
import { MapPin, Search } from "lucide-react";
import type { City } from "./types";
import { rt } from "./text";
import { MAP_CITIES } from "../mapScope";

type Room = {
  listing_id: string;
  title: string;
  address: Record<string, unknown>;
  price: { amount: number; currency: string; period: string };
  thumbnail_url: string | null;
};
export function RoomPicker({
  city,
  identifier,
  select,
}: {
  city?: City | null;
  identifier: string;
  select: (identifier: string) => void;
}) {
  const [text, setText] = useState(""),
    [rooms, setRooms] = useState<Room[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setRooms([]);
    setError("");
    setText("");
    setBusy(false);
    return () => controller.current?.abort();
  }, [city]);
  async function search() {
    if (!city || busy) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    const [sw, ne] = MAP_CITIES[city].bounds;
    try {
      const response = await api<{ results: Room[] }>(
        "/platform/housing/search",
        "POST",
        {
          ...(text.trim() ? { text: text.trim() } : {}),
          bounding_box: {
            west: sw[0],
            south: sw[1],
            east: ne[0],
            north: ne[1],
          },
          listing_type: "rent",
          pagination: { limit: 12, cursor: null },
        },
        request.signal,
      );
      if (!request.signal.aborted) setRooms(response.results);
    } catch (e) {
      if (!request.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : rt("Chưa tìm được tin nhà.", "Could not search listings."),
        );
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="rm-room-picker">
      <p className="rm-hint">
        {rt(
          "Chọn tin phòng bạn đang có quyền ở. Việc liên kết tin chưa xác minh quyền sở hữu.",
          "Choose the listing for a room you have permission to occupy. Linking a listing does not verify ownership.",
        )}
      </p>
      <div className="rm-room-search">
        <label>
          {rt("Tìm tên đường hoặc tên tin", "Search street or listing title")}
          <input
            maxLength={200}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={rt(
              "Ví dụ: Duy Tân, studio…",
              "For example: street, studio…",
            )}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
          />
        </label>
        <button
          className="secondary"
          type="button"
          disabled={!city || busy}
          onClick={() => void search()}
        >
          <Search size={16} aria-hidden="true" />
          {busy
            ? rt("Đang tìm…", "Searching…")
            : rt("Tìm phòng của bạn", "Find your room")}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="rm-room-results">
        {rooms.map((room) => (
          <li key={room.listing_id}>
            <label>
              <input
                type="radio"
                name="roommate-linked-room"
                checked={identifier === room.listing_id}
                onChange={() => select(room.listing_id)}
              />
              <span>
                <strong>{room.title}</strong>
                <small>
                  <MapPin size={13} aria-hidden="true" />
                  {String(
                    room.address.raw ||
                      [
                        room.address.street,
                        room.address.ward,
                        room.address.district,
                        room.address.city,
                      ]
                        .filter(Boolean)
                        .join(", "),
                  )}
                </small>
                <small>
                  {money(room.price.amount, room.price.currency)} ·{" "}
                  {rt("Giá trên tin", "Listing price")}
                </small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {!busy && !error && rooms.length === 0 && text && (
        <p className="rm-hint">
          {rt(
            "Tìm tin đang có trên ReloHome bằng tên đường hoặc tên phòng.",
            "Find a ReloHome listing by street or room title.",
          )}
        </p>
      )}
      <details className="rm-disclosure">
        <summary>
          {rt("Tôi đã có mã tin nhà", "I already have a listing ID")}
        </summary>
        <label>
          {rt("Mã tin nhà", "Listing ID")}
          <input
            maxLength={200}
            value={identifier}
            onChange={(e) => select(e.target.value)}
          />
        </label>
      </details>
    </div>
  );
}
