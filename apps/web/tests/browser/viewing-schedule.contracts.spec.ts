import { expect, test } from "@playwright/test";
import {
  scheduleEligible,
  batchLimit,
  scheduleIssues,
  sendViewingBatch,
} from "../../src/viewingSchedule";
import { ApiError } from "../../src/apiError";

const slots = [
  "2027-02-10T09:00:00+07:00",
  "2027-02-10T10:00:00+07:00",
  "2027-02-10T10:15:00+07:00",
];
const view = () => ({
  max_selected: 3,
  slot_minutes: 30,
  slots,
  items: ["a", "b", "c"].map((listing_id) => ({
    listing_id,
    status: "selected",
    title: listing_id,
  })),
});
const entries = () => [
  { listing_id: "b", slot: slots[1] },
  { listing_id: "a", slot: slots[0] },
];

test("eligibility retains existing viewing lifecycle and batch cannot exceed server or UI cap", () => {
  expect(scheduleEligible({ status: "selected" })).toBe(true);
  expect(scheduleEligible({ status: "agreed" })).toBe(false);
  expect(scheduleEligible({ status: "visited" })).toBe(false);
  expect(scheduleEligible({ status: "backup", backup_from: "visited" })).toBe(
    false,
  );
  expect(
    scheduleEligible({
      status: "visit_due",
      landlord: { request_status: "resolved" },
    }),
  ).toBe(true);
  expect(batchLimit({ max_selected: 2 })).toBe(2);
  expect(batchLimit({ max_selected: 4 })).toBe(3);
});

test("review checks exact server slots, vanished candidates and overlap without inventing travel time", () => {
  const v = view();
  expect(scheduleIssues(v, entries())).toEqual({});
  expect(
    scheduleIssues(v, [
      { listing_id: "a", slot: slots[1] },
      { listing_id: "b", slot: slots[2] },
    ]),
  ).toHaveProperty("a");
  expect(
    scheduleIssues(v, [{ listing_id: "missing", slot: slots[0] }]),
  ).toHaveProperty("missing");
  expect(
    scheduleIssues(v, [{ listing_id: "a", slot: "2027-02-11T09:00:00+07:00" }]),
  ).toHaveProperty("a");
});

test("one confirmation sends chronologically and keeps exact legacy per-home payload", async () => {
  const calls: any[] = [];
  const v = view();
  const result = await sendViewingBatch(v, entries(), async (payload) => {
    calls.push(payload);
    return {
      items: [
        {
          listing_id: payload.listing_id,
          status: "viewing_scheduled",
          viewing: { slot: payload.slot },
        },
      ],
    };
  });
  expect(calls).toEqual([
    { listing_id: "a", slot: slots[0] },
    { listing_id: "b", slot: slots[1] },
  ]);
  expect(result.map((r) => r.status)).toEqual(["saved", "saved"]);
});

test("partial failure never rolls back successes or submits remaining homes", async () => {
  let calls = 0;
  const result = await sendViewingBatch(
    view(),
    [...entries(), { listing_id: "c", slot: slots[2] }],
    async (payload) => {
      calls++;
      if (calls === 2)
        throw new ApiError(409, "Không kịp tới lịch xem.", "not_reachable");
      return {
        items: [
          {
            listing_id: payload.listing_id,
            status: "viewing_scheduled",
            viewing: { slot: payload.slot },
          },
        ],
      };
    },
  );
  expect(calls).toBe(2);
  expect(result.map((r) => r.status)).toEqual(["saved", "failed", "not_sent"]);
});

test("auth rejection preserves successes and leaves denied and remaining entries unsent", async () => {
  let calls = 0;
  const result = await sendViewingBatch(view(), [...entries(), { listing_id: "c", slot: slots[2] }], async payload => {
    if (++calls === 2) throw new ApiError(401, "Đăng nhập để tiếp tục", "authentication_required");
    return { items: [{ listing_id: payload.listing_id, viewing: { slot: payload.slot } }] };
  });
  expect(calls).toBe(2);
  expect(result.map(r => r.status)).toEqual(["saved", "not_sent", "not_sent"]);
  expect(result[1].code).toBe("authentication_required");
});

test("transport ambiguity, missing success evidence and sync errors stop with truthful statuses", async () => {
  for (const error of [new ApiError(502, "Timeout"), new Error("network")]) {
    let calls = 0;
    const result = await sendViewingBatch(view(), entries(), async () => {
      calls++;
      throw error;
    });
    expect(calls).toBe(1);
    expect(result.map((r) => r.status)).toEqual(["unknown", "not_sent"]);
  }
  expect(
    (await sendViewingBatch(view(), entries(), async () => ({ items: [] })))[0]
      .status,
  ).toBe("unknown");
  expect(
    (
      await sendViewingBatch(view(), entries(), async (payload) => ({
        items: [
          {
            listing_id: payload.listing_id,
            viewing: { slot: payload.slot },
            landlord: { sync: "failed" },
          },
        ],
      }))
    )[0].status,
  ).toBe("sync_pending");
});

test("unchanged open appointments are skipped, but closed same-slot requests are explicitly rescheduled", async () => {
  const v: any = view();
  Object.assign(v.items[0], {
    status: "viewing_scheduled",
    viewing: { slot: slots[0] },
    landlord: { viewing_status: "requested", request_status: "new" },
  });
  let calls = 0;
  expect(
    (
      await sendViewingBatch(
        v,
        [{ listing_id: "a", slot: slots[0] }],
        async () => {
          calls++;
          return {};
        },
      )
    )[0].status,
  ).toBe("unchanged");
  expect(calls).toBe(0);
  v.items[0].landlord = {
    viewing_status: "cancelled",
    request_status: "resolved",
  };
  expect(
    (
      await sendViewingBatch(
        v,
        [{ listing_id: "a", slot: slots[0] }],
        async (payload) => {
          calls++;
          return {
            items: [
              {
                listing_id: "a",
                viewing: { slot: payload.slot },
                landlord: {
                  viewing_status: "requested",
                  request_status: "new",
                },
              },
            ],
          };
        },
      )
    )[0].status,
  ).toBe("saved");
  expect(calls).toBe(1);
});

test("owner proposals constrain each home and test mode still allows choosing a replacement", () => {
  const v = view();
  v.items[0] = {...v.items[0], status: "visit_due", landlord: {viewing_status:"declined",request_status:"new"}, available_slots: [slots[1]]} as any;
  expect(scheduleEligible(v.items[0])).toBe(true);
  expect(scheduleIssues(v,[{listing_id:"a",slot:slots[0]}])).toHaveProperty("a");
  expect(scheduleIssues(v,[{listing_id:"a",slot:slots[1]}])).toEqual({});
  (v.items[0] as any).available_slots = [];
  expect(scheduleIssues(v,[{listing_id:"a",slot:slots[1]}])).toHaveProperty("a");
});
