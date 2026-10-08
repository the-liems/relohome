import type { Profile } from "./types";
import { FactsForm } from "./FactsForm";
import { PreferencesForm } from "./PreferencesForm";
import { rt } from "./text";
export function ProfileEditor({
  value,
  change,
  complete = true,
}: {
  value: Profile;
  change: (value: Profile) => void;
  complete?: boolean;
}) {
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
    </>
  );
}
