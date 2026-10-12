import { expect, test } from "@playwright/test";
import {
  flightRequest,
  flightDefaults,
  requestDefaults,
  clarificationServices,
  vietnamToday,
  guidedReplyText,
} from "../../src/serviceRequest";
import type { Thread } from "../../src/types";

test("flight requests preserve a complete round trip through the existing chat message contract", () => {
  const message = flightRequest(
    {
      from: "SGN",
      to: "HAN",
      date: "2027-02-10",
      returnDate: "2027-02-13",
      trip: "round_trip",
      adults: "2",
    },
    "2027-02-01",
    true,
  );
  expect(message).toContain("Bổ sung cho yêu cầu chuyến bay hiện tại");
  expect(message).toContain("khứ hồi từ SGN đến HAN");
  expect(message).toContain("2027-02-10");
  expect(message).toContain("2027-02-13");
  expect(message).toContain("2 người lớn");
  expect(message).toContain("Chỉ tìm chuyến");
});

test("rejects equivalent airports, impossible/past dates, invalid return and passenger counts", () => {
  const draft = {
    from: "HAN",
    to: "DAD",
    date: "2027-02-10",
    returnDate: "2027-02-13",
    trip: "one_way" as const,
    adults: "1",
  };
  for (const values of [
    { from: "   " },
    { to: "Hà Nội" },
    { date: "2027-02-30" },
    { date: "2027-01-31" },
    { trip: "round_trip", returnDate: "2027-02-09" },
    { adults: "0" },
    { adults: "1.5" },
    { adults: "10" },
  ])
    expect(() =>
      flightRequest({ ...draft, ...values }, "2027-02-01"),
    ).toThrow();
  expect(flightRequest(draft, "2027-02-10")).not.toContain("ngày về");
  expect(vietnamToday(new Date("2027-02-09T18:00:00Z"))).toBe("2027-02-10");
});

test("form defaults come from the current service, never historical flight cards", () => {
  const thread = {
    state: {
      intake: {
        domains: ["flight"],
        constraints: {
          values: { origin: "SGN", flight_date: "2027-02-10", passengers: 2 },
        },
      },
      progress: {
        items: [
          {
            task_id: "pending:flight",
            agent: "flight",
            state: "waiting",
            task_status: "pending",
            inputs: {
              destination: "HAN",
              trip_type: "round_trip",
              return_date: "2027-02-13",
            },
          },
        ],
      },
    },
    messages: [
      {
        role: "assistant",
        content: {
          response: {
            kind: "CLARIFY",
            questions: [{ field: "flight.return_date" }],
          },
        },
      },
    ],
  } as unknown as Thread;
  expect(clarificationServices(thread)).toEqual(["flight"]);
  expect(flightDefaults(requestDefaults(thread, "flight"))).toMatchObject({
    from: "SGN",
    to: "HAN",
    date: "2027-02-10",
    returnDate: "2027-02-13",
    adults: "2",
    trip: "round_trip",
  });
  thread.state.intake = {
    domains: ["property"],
    constraints: { values: { city: "hanoi" } },
  };
  thread.state.progress.items = [];
  expect(requestDefaults(thread, "flight")).toEqual({});
  expect(clarificationServices(thread)).toEqual([]);
});

test("comparison questions and completed service results do not open search forms", () => {
  const thread = {
    state: { intake: { domains: ["property"] } },
    messages: [
      {
        role: "assistant",
        content: {
          response: {
            kind: "CLARIFY",
            questions: [{ field: "property.listing_ids" }],
          },
        },
      },
    ],
  } as unknown as Thread;
  expect(clarificationServices(thread)).toEqual([]);
  thread.messages[0].content.response = {
    kind: "ANSWER",
    text: "Có kết quả",
    questions: [],
  };
  expect(clarificationServices(thread)).toEqual([]);
});

test("route forms only replace route questions and keep other notices intact", () => {
  const thread = {
    state: {
      intake: {
        domains: ["map"],
        constraints: { values: { map_mode: "nearby" } },
      },
    },
    messages: [
      {
        role: "assistant",
        content: {
          response: {
            kind: "CLARIFY",
            text: "Bạn muốn tìm ở đâu?",
            questions: [{ field: "map.city", text: "Bạn muốn tìm ở đâu?" }],
          },
        },
      },
    ],
  } as unknown as Thread;
  expect(clarificationServices(thread)).toEqual([]);
  thread.state.intake.constraints.values.map_mode = "route";
  expect(clarificationServices(thread)).toEqual(["map"]);
  expect(
    guidedReplyText(
      "Thông tin cần bổ sung:\nBạn muốn tìm ở đâu?\nChưa có giao dịch nào.",
      thread.messages[0].content.response!.questions!,
      ["map"],
    ),
  ).toBe("Thông tin cần bổ sung:\nChưa có giao dịch nào.");
});
