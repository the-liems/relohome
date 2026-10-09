import type { Profile } from "./types";
import { FactsForm } from "./FactsForm";
import { PreferencesForm } from "./PreferencesForm";
import { rt } from "./text";
import { useEffect, useState } from "react";
export function ProfileEditor({
  value,
  change,
  complete = true,
}: {
  value: Profile;
  change: (value: Profile) => void;
  complete?: boolean;
}) {
  const [roomId, setRoomId] = useState(value.room?.listing_id || "");
  useEffect(() => {
    if (value.room) setRoomId(value.room.listing_id);
  }, [value.room?.listing_id]);
  useEffect(() => {
    if (value.facts.need?.kind !== "has_room") setRoomId("");
  }, [value.facts.city, value.facts.need?.kind]);
  return (
    <>
      <div className="rm-fields">
        <label>
          {rt("Tên hiển thị", "Display name")}
          <input
            required={complete}
            maxLength={80}
            autoComplete="nickname"
            value={value.display_name || ""}
            onChange={(e) =>
              change({ ...value, display_name: e.target.value || null })
            }
          />
        </label>
      </div>
      <label>
        {rt("Giới thiệu ngắn", "Short introduction")}
        <textarea
          required={complete}
          rows={3}
          maxLength={1000}
          value={value.introduction || ""}
          onChange={(e) =>
            change({ ...value, introduction: e.target.value || null })
          }
        />
        <small>
          {rt(
            "Nói về nhu cầu ở cùng. Không ghi điện thoại, email hay link liên hệ ở đây.",
            "Describe your roommate needs. Do not include phone numbers, email or contact links here.",
          )}
        </small>
      </label>
      <FactsForm
        required={complete}
        value={value.facts}
        change={(facts) =>
          change({
            ...value,
            facts,
            room:
              facts.need?.kind === "has_room" && facts.city === value.facts.city
                ? value.room
                : null,
            preferences:
              facts.city !== value.facts.city
                ? { ...value.preferences, areas: null }
                : value.preferences,
          })
        }
      />
      <details className="rm-disclosure">
        <summary>
          {rt("Ưu tiên với người ở cùng", "Roommate preferences")}
        </summary>
        <PreferencesForm
          city={value.facts.city}
          value={value.preferences}
          change={(preferences) => change({ ...value, preferences })}
        />
      </details>
      {value.facts.need?.kind === "has_room" && (
        <details className="rm-disclosure">
          <summary>
            {rt(
              "Hiện phòng trên map (tùy chọn)",
              "Publish room on map (optional)",
            )}
          </summary>
          <p className="rm-hint">
            Chỉ khai báo phòng bạn đang có quyền ở. Vị trí căn được công khai
            khi đăng nhu cầu; không tự lấy từ nhà đã chọn trong chat.
          </p>
          <label>
            Mã tin nhà (listing ID)
            <input
              maxLength={200}
              value={roomId}
              onChange={(e) => {
                setRoomId(e.target.value);
                change({ ...value, room: null });
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={Boolean(value.room)}
              disabled={!roomId.trim()}
              onChange={(e) =>
                change({
                  ...value,
                  room: e.target.checked
                    ? {
                        listing_id: roomId.trim(),
                        public_location_consent: true,
                      }
                    : null,
                })
              }
            />
            Tôi đồng ý công khai vị trí phòng này và xác nhận đang tìm bạn trọ.
          </label>
          <small>
            Đây là khai báo của bạn, không phải chứng nhận quyền sở hữu từ
            ReloHome. Để trống mã tin nếu không muốn hiện vị trí.
          </small>
        </details>
      )}
    </>
  );
}
