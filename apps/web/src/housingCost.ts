import type { House } from "./types";

// Tenant cost estimate (SPEC-021, housing-platform-upgrade §7). Pure rules, no LLM:
// - only amounts the landlord published and quantities the tenant entered are used;
// - a missing amount or quantity is "unknown", never 0, and makes the total provisional;
// - optional fees and refundable deposits are shown separately from the monthly total.

export type Fee = NonNullable<House["fees"]>[number];
export type BillingUnit = Fee["billing_unit"];

export interface Usage {
  people?: number;
  kwh?: number;
  m3?: number;
  vehicles?: number;
}

// Which tenant quantity each usage unit needs. Units absent here are fixed per month or one-time.
const QUANTITY: Partial<Record<BillingUnit, keyof Usage>> = {
  kwh: "kwh",
  m3: "m3",
  person_month: "people",
  vehicle_month: "vehicles",
};

export interface CostLine {
  label: string;
  amount: number | null; // null: unknown amount or quantity not entered
  missing?: "amount" | "quantity";
  unit?: BillingUnit;
}

export interface CostEstimate {
  rent: number | null;
  monthly: CostLine[]; // rent + required recurring fees
  optional: CostLine[]; // optional recurring fees, not in the total
  oneTime: CostLine[]; // required non-refundable one-time fees
  deposit: number | null;
  monthlyKnown: number;
  monthlyComplete: boolean;
  moveInKnown: number;
  moveInComplete: boolean;
  feesPublished: boolean;
  pricePerM2: number | null;
  unknown: string[]; // labels of required items without a usable amount
}

const quantityOf = (
  usage: Usage,
  unit: BillingUnit,
): number | null | undefined => {
  const key = QUANTITY[unit];
  if (!key) return undefined; // fixed fee
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
};

function line(fee: Fee, usage: Usage): CostLine {
  const quantity = quantityOf(usage, fee.billing_unit);
  if (fee.amount == null)
    return {
      label: fee.label,
      amount: null,
      missing: "amount",
      unit: fee.billing_unit,
    };
  if (quantity === null)
    return {
      label: fee.label,
      amount: null,
      missing: "quantity",
      unit: fee.billing_unit,
    };
  return {
    label: fee.label,
    amount: Math.round(fee.amount * (quantity ?? 1)),
    unit: fee.billing_unit,
  };
}

export function monthlyRent(house: House): number | null {
  // Only a monthly VND price is comparable; other periods or currencies stay unknown.
  if (typeof house.price_vnd === "number") return house.price_vnd;
  const price = house.price;
  if (
    price &&
    typeof price.amount === "number" &&
    (!price.currency || price.currency === "VND") &&
    (!price.period || price.period === "month")
  )
    return price.amount;
  return null;
}

export function estimateCost(house: House, usage: Usage = {}): CostEstimate {
  const fees = house.fees || [];
  const rent = monthlyRent(house);
  const monthly: CostLine[] = [
    {
      label: "Tiền thuê",
      amount: rent,
      missing: rent == null ? "amount" : undefined,
    },
  ];
  const optional: CostLine[] = [];
  const oneTime: CostLine[] = [];
  for (const fee of fees) {
    if (fee.billing_unit === "one_time") {
      if (!fee.refundable && fee.required) oneTime.push(line(fee, usage));
      continue;
    }
    (fee.required ? monthly : optional).push(line(fee, usage));
  }
  const deposit =
    typeof house.deposit_vnd === "number" ? house.deposit_vnd : null;
  const sum = (lines: CostLine[]) =>
    lines.reduce((total, l) => total + (l.amount ?? 0), 0);
  const monthlyComplete =
    fees.length > 0 && monthly.every((l) => l.amount != null);
  const moveInLines = [
    { label: "Tiền cọc", amount: deposit },
    ...monthly,
    ...oneTime,
  ];
  const area = typeof house.area_m2 === "number" ? house.area_m2 : null;
  return {
    rent,
    monthly,
    optional,
    oneTime,
    deposit,
    monthlyKnown: sum(monthly),
    monthlyComplete,
    moveInKnown: sum(moveInLines),
    moveInComplete: monthlyComplete && moveInLines.every((l) => l.amount != null),
    feesPublished: fees.length > 0,
    pricePerM2:
      rent != null && area && area > 0 ? Math.round(rent / area) : null,
    unknown: [...monthly, ...oneTime]
      .filter((l) => l.missing === "amount")
      .map((l) => l.label),
  };
}
