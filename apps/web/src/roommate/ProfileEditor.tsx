import { RequiredMark } from "../components/RequiredMark";
import type { Profile } from "./types";
import { FactsForm, TraitsForm } from "./FactsForm";
import { FormDisclosure } from "./FormDisclosure";
import { PreferencesForm } from "./PreferencesForm";
import { options, rt } from "./text";
import { useEffect, useId, useState } from "react";
import { RoomPicker } from "./RoomPicker";
import { SelectField } from "./Fields";
export function ProfileEditor({
  value,
  change,
  complete = true,
}: {
  value: Profile;
  change: (value: Profile) => void;
  complete?: boolean;
}) {
  const introId = useId();
  const [roomId, setRoomId] = useState(value.room?.listing_id || "");
  useEffect(() => {
    if (value.room) setRoomId(value.room.listing_id);
  }, [value.room?.listing_id]);
  useEffect(() => {
    setRoomId(value.room?.listing_id || "");
  }, [value.facts.city, value.facts.need?.kind]);
  const additionalCount =
    Object.entries(value.facts.self_traits).filter(
      ([key, item]) => key !== "gender" && item != null,
    ).length +
    Object.values(value.preferences).filter(Boolean).length +
    Number(Boolean(value.room));
  return (
    <div className="rm-profile-editor">
      <section className="rm-essential-group">
        <h3>{rt("Giới thiệu về bạn", "About you")}</h3>
        <div className="rm-fields rm-intro-fields">
          <label>
            <span className="field-label">
              {rt("Tên hiển thị", "Display name")}
              <RequiredMark required={complete} />
            </span>
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
          <SelectField
            label={rt("Giới tính của bạn", "Your gender")}
            choices={options("gender")}
            value={value.facts.self_traits.gender}
            required={complete}
            placeholder={rt("Chọn giới tính", "Select your gender")}
            change={(gender) =>
              change({
                ...value,
                facts: {
                  ...value.facts,
                  self_traits: {
                    ...value.facts.self_traits,
                    gender: gender || null,
                  },
                },
              })
            }
          />
          <label className="rm-intro-description">
            <span className="field-label" id={introId + "-label"}>
              {rt("Giới thiệu ngắn", "Short introduction")}
              <RequiredMark required={complete} />
            </span>
            <textarea
              aria-labelledby={introId + "-label"}
              aria-describedby={introId + "-hint"}
              required={complete}
              rows={2}
              maxLength={1000}
              value={value.introduction || ""}
              onChange={(e) =>
                change({ ...value, introduction: e.target.value || null })
              }
            />
            <small id={introId + "-hint"}>
              {rt(
                "Nói về nhu cầu ở cùng. Không ghi điện thoại, email hay link liên hệ ở đây.",
                "Describe your roommate needs. Do not include phone numbers, email or contact links here.",
              )}
            </small>
          </label>
        </div>
      </section>
      <FactsForm
        includeTraits={false}
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
      <FormDisclosure
        title={rt("Thông tin bổ sung", "Additional information")}
        hint={
          additionalCount
            ? rt(
                `Không bắt buộc · đã điền ${additionalCount} mục`,
                `Optional · ${additionalCount} items provided`,
              )
            : rt(
                "Không bắt buộc · có thể bổ sung sau",
                "Optional · add details later",
              )
        }
      >
        <FormDisclosure title={rt("Thói quen của bạn", "Your lifestyle")}>
          <TraitsForm
            includeGender={false}
            value={value.facts.self_traits}
            change={(self_traits) =>
              change({
                ...value,
                facts: { ...value.facts, self_traits },
              })
            }
          />
        </FormDisclosure>
        <FormDisclosure
          title={rt("Ưu tiên với người ở cùng", "Roommate preferences")}
        >
          <PreferencesForm
            city={value.facts.city}
            value={value.preferences}
            change={(preferences) => change({ ...value, preferences })}
          />
        </FormDisclosure>
        {value.facts.need?.kind === "has_room" && (
          <FormDisclosure
            title={rt(
              "Hiện phòng trên map (tùy chọn)",
              "Publish room on map (optional)",
            )}
          >
            <p className="rm-hint">
              {rt(
                "Vị trí căn chỉ được công khai khi bạn đồng ý và đăng nhu cầu.",
                "The room location appears only when you consent and publish your profile.",
              )}
            </p>
            <RoomPicker
              city={value.facts.city}
              identifier={roomId}
              select={(id) => {
                setRoomId(id);
                change({ ...value, room: null });
              }}
            />
            <label className="rm-check">
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
              {rt(
                "Tôi đồng ý công khai vị trí phòng này và xác nhận đang tìm bạn trọ.",
                "I consent to showing this room location and confirm I am looking for a roommate.",
              )}
            </label>
            <small>
              {rt(
                "Để trống nếu không muốn hiện vị trí. Hồ sơ vẫn tìm được người phù hợp.",
                "Leave this empty to keep the location private. You can still find suitable roommates.",
              )}
            </small>
          </FormDisclosure>
        )}
      </FormDisclosure>
    </div>
  );
}
