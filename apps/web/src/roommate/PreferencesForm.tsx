import type { City, Preference, Preferences } from "./types";
import { AreaFields } from "./FactsForm";
import { BudgetFields, MoveInFields, QuietFields, SelectField } from "./Fields";
import { options, rt } from "./text";
import type { ReactNode } from "react";
import { FormDisclosure } from "./FormDisclosure";
function Strength({
  value,
  change,
  children,
}: {
  value?: Preference<unknown> | null;
  change: (strength: "soft" | "hard") => void;
  children: ReactNode;
}) {
  return (
    <div className="rm-preference">
      {children}
      {value && (
        <label className="rm-check">
          <input
            type="checkbox"
            checked={value.strength === "hard"}
            onChange={(e) => change(e.target.checked ? "hard" : "soft")}
          />
          {rt("Bắt buộc đáp ứng", "Must meet this condition")}
        </label>
      )}
    </div>
  );
}
export function PreferencesForm({
  city,
  value,
  change,
}: {
  city?: City | null;
  value: Preferences;
  change: (value: Preferences) => void;
}) {
  function set(key: keyof Preferences, next: unknown) {
    change({
      ...value,
      [key]:
        next == null
          ? null
          : { value: next, strength: value[key]?.strength || "soft" },
    });
  }
  function strength(key: keyof Preferences, next: "soft" | "hard") {
    change({ ...value, [key]: { ...value[key], strength: next } });
  }
  const enums: [
    "gender" | "smoking" | "pets_allowed" | "cleanliness" | "sociability",
    string,
    string,
  ][] = [
    ["gender", rt("Giới tính mong muốn", "Preferred gender"), "gender"],
    ["smoking", rt("Chấp nhận hút thuốc", "Smoking tolerance"), "tolerance"],
    ["pets_allowed", rt("Chấp nhận thú cưng", "Pets allowed"), "boolean"],
    [
      "cleanliness",
      rt("Dọn dẹp mong muốn", "Preferred cleaning routine"),
      "cleanliness",
    ],
    [
      "sociability",
      rt("Không gian chung mong muốn", "Preferred shared space use"),
      "sociability",
    ],
  ];
  return (
    <div className="rm-preferences">
      <p className="rm-hint">
        {rt(
          "Để trống nghĩa là chưa chọn. Chỉ đánh dấu bắt buộc nếu bạn không muốn nhận kết quả khác điều kiện này.",
          "Blank means no preference. Mark a condition as required only if you want to exclude other results.",
        )}
      </p>
      <Strength value={value.areas} change={(v) => strength("areas", v)}>
        <AreaFields
          city={city}
          value={value.areas?.value.area_ids || []}
          change={(ids) => set("areas", ids.length ? { area_ids: ids } : null)}
        />
      </Strength>
      <Strength value={value.budget} change={(v) => strength("budget", v)}>
        <BudgetFields
          value={value.budget?.value}
          change={(v) => set("budget", v)}
        />
      </Strength>
      <Strength value={value.move_in} change={(v) => strength("move_in", v)}>
        <MoveInFields
          value={value.move_in?.value}
          change={(v) => set("move_in", v)}
        />
      </Strength>
      <FormDisclosure
        title={rt(
          "Sinh hoạt và thói quen · tùy chọn",
          "Lifestyle preferences · optional",
        )}
      >
        {enums.map(([key, label, kind]) => (
          <Strength
            key={key}
            value={value[key]}
            change={(v) => strength(key, v)}
          >
            <SelectField
              label={label}
              value={value[key]?.value == null ? "" : String(value[key]?.value)}
              choices={options(kind)}
              change={(v) =>
                set(
                  key,
                  v === "" ? null : key === "pets_allowed" ? v === "true" : v,
                )
              }
            />
          </Strength>
        ))}
        <Strength
          value={value.quiet_hours}
          change={(v) => strength("quiet_hours", v)}
        >
          <QuietFields
            value={value.quiet_hours?.value}
            change={(v) => set("quiet_hours", v)}
          />
        </Strength>
      </FormDisclosure>
    </div>
  );
}
