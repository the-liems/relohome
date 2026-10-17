import { expect, test } from "@playwright/test";
import { estimateCost } from "../../src/housingCost";
import type { House } from "../../src/types";
const house: House = {
  id: "cost-home",
  title: "Cost fixture",
  price_vnd: 8_500_000,
  deposit_vnd: 8_500_000,
  fees: [
    {
      code: "service",
      label: "Phí dịch vụ",
      amount: 100_000,
      billing_unit: "month",
      required: true,
      refundable: false,
    },
  ],
};
test("move-in includes the deposit, every first-month service fee and required one-time fees", () => {
  const cost = estimateCost(house);
  expect(cost.monthlyKnown).toBe(8_600_000);
  expect(cost.moveInKnown).toBe(17_100_000);
  expect(cost.moveInComplete).toBe(true);
  const withFees = estimateCost({
    ...house,
    fees: [
      ...house.fees!,
      {
        code: "cleaning",
        label: "Cleaning",
        amount: 200_000,
        billing_unit: "one_time",
        required: true,
        refundable: false,
      },
      {
        code: "optional",
        label: "Optional",
        amount: 300_000,
        billing_unit: "month",
        required: false,
        refundable: false,
      },
    ],
  });
  expect(withFees.moveInKnown).toBe(17_300_000);
});
test("unknown usage, missing deposits and unpublished fees keep move-in provisional", () => {
  const metered = {
    ...house,
    fees: [
      ...house.fees!,
      {
        code: "power",
        label: "Điện",
        amount: 4_000,
        billing_unit: "kwh" as const,
        required: true,
        refundable: false,
      },
    ],
  };
  expect(estimateCost(metered).moveInComplete).toBe(false);
  expect(estimateCost(metered, { kwh: 50 }).moveInKnown).toBe(17_300_000);
  expect(estimateCost(metered, { kwh: 0 }).moveInComplete).toBe(true);
  expect(
    estimateCost({ ...house, deposit_vnd: undefined }).moveInComplete,
  ).toBe(false);
  expect(estimateCost({ ...house, fees: [] }).moveInComplete).toBe(false);
});
