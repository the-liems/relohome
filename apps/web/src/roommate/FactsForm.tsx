import { useResource } from "./useResource";
import { RequiredMark } from "../components/RequiredMark";
import { BudgetFields, MoveInFields, QuietFields, SelectField } from "./Fields";
import { ErrorNotice } from "./ErrorNotice";
import { areaName, cityName, options, rt } from "./text";
import type { City, Facts, Traits } from "./types";
import { FormDisclosure } from "./FormDisclosure";
export function AreaFields({
  city,
  value,
  change,
  required = false,
}: {
  city?: City | null;
  value: string[];
  change: (ids: string[]) => void;
  required?: boolean;
}) {
  const areas = useResource<{ areas: { area_id: string }[] }>(
    city ? "/areas/" + city : null,
  );
  return (
    <fieldset className="rm-area-fields">
      <legend>
        {rt("Khu vực muốn ở", "Preferred areas")}
        <RequiredMark required={required} />
      </legend>
      <ErrorNotice error={areas.error} retry={areas.reload} />
      {areas.loading && (
        <p role="status">{rt("Đang tải khu vực…", "Loading areas…")}</p>
      )}
      {!city && (
        <p className="muted">
          {rt("Chọn thành phố trước.", "Select a city first.")}
        </p>
      )}
      {areas.value?.areas.map(({ area_id }) => (
        <label className="rm-check" key={area_id}>
          <input
            type="checkbox"
            checked={value.includes(area_id)}
            onChange={(e) =>
              change(
                e.target.checked
                  ? [...value, area_id]
                  : value.filter((id) => id !== area_id),
              )
            }
          />
          {areaName(area_id)}
        </label>
      ))}
      {required && !value.length && (
        <p className="rm-hint">
          {rt(
            "Chọn ít nhất một khu vực trước khi tiếp tục.",
            "Select at least one area before continuing.",
          )}
        </p>
      )}
    </fieldset>
  );
}
export function TraitsForm({
  value,
  change,
  includeGender = true,
}: {
  value: Traits;
  change: (value: Traits) => void;
  includeGender?: boolean;
}) {
  const set = (key: keyof Traits, next: unknown) =>
    change({ ...value, [key]: next });
  return (
    <div className="rm-fields">
      {includeGender && (
        <SelectField
          label={rt("Giới tính của bạn", "Your gender")}
          choices={options("gender")}
          value={value.gender}
          change={(v) => set("gender", v || null)}
        />
      )}
      <SelectField
        label={rt("Bạn hút thuốc thế nào?", "Your smoking habit")}
        choices={options("smoking")}
        value={value.smoking}
        change={(v) => set("smoking", v || null)}
      />
      <SelectField
        label={rt("Bạn có thú cưng?", "Do you have pets?")}
        choices={options("boolean")}
        value={value.has_pets == null ? "" : String(value.has_pets)}
        change={(v) => set("has_pets", v === "" ? null : v === "true")}
      />
      <SelectField
        label={rt("Bạn dọn dẹp thế nào?", "Your cleaning routine")}
        choices={options("cleanliness")}
        value={value.cleanliness}
        change={(v) => set("cleanliness", v || null)}
      />
      <SelectField
        label={rt(
          "Bạn dùng không gian chung thế nào?",
          "Your use of shared space",
        )}
        choices={options("sociability")}
        value={value.sociability}
        change={(v) => set("sociability", v || null)}
      />
      <QuietFields
        value={value.quiet_hours}
        change={(v) => set("quiet_hours", v)}
      />
    </div>
  );
}
export function FactsForm({
  value,
  change,
  required = false,
  fixedCity,
  includeTraits = true,
}: {
  value: Facts;
  change: (value: Facts) => void;
  required?: boolean;
  fixedCity?: City;
  includeTraits?: boolean;
}) {
  return (
    <>
      <div className="rm-fields">
        {!fixedCity && (
          <SelectField
            label={rt("Thành phố muốn ở", "Target city")}
            value={value.city}
            required={required}
            choices={["hcm", "hanoi", "danang"].map((city) => [
              city,
              cityName(city),
            ])}
            change={(v) =>
              change({ ...value, city: (v as City) || null, area_ids: [] })
            }
          />
        )}
        <SelectField
          label={rt("Nhu cầu của bạn", "Your housing situation")}
          value={value.need?.kind}
          required={required}
          choices={[
            ["looking_together", rt("Cùng tìm chỗ ở", "Find a place together")],
            [
              "has_room",
              rt(
                "Đã có phòng, tìm người ở cùng",
                "Have a room, looking for someone",
              ),
            ],
          ]}
          change={(v) =>
            change({
              ...value,
              need: v ? { kind: v as "has_room" | "looking_together" } : null,
            })
          }
        />
        {value.need?.kind === "has_room" && (
          <SelectField
            label={rt(
              "Bạn sẵn sàng chuyển chỗ ở?",
              "Would you move to another place?",
            )}
            required={required}
            choices={options("boolean")}
            value={
              value.need.willing_to_move == null
                ? ""
                : String(value.need.willing_to_move)
            }
            change={(v) =>
              change({
                ...value,
                need: {
                  kind: "has_room",
                  willing_to_move: v === "" ? null : v === "true",
                },
              })
            }
          />
        )}
      </div>
      <section className="rm-essential-group">
        <h3>{rt("Nơi ở và ngân sách", "Location and budget")}</h3>
        <AreaFields
          city={fixedCity || value.city}
          value={value.area_ids}
          change={(area_ids) =>
            change({ ...value, city: fixedCity || value.city, area_ids })
          }
          required={required}
        />
        <BudgetFields
          value={value.budget}
          change={(budget) => change({ ...value, budget })}
          required={required}
        />
        <MoveInFields
          value={value.move_in}
          change={(move_in) => change({ ...value, move_in })}
          required={required}
        />
      </section>
      {includeTraits && (
        <FormDisclosure
          title={rt(
            "Thói quen của bạn · không bắt buộc",
            "Your lifestyle · optional",
          )}
        >
          <TraitsForm
            value={value.self_traits}
            change={(self_traits) => change({ ...value, self_traits })}
          />
        </FormDisclosure>
      )}
    </>
  );
}
