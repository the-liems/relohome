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

test("backend-shaped intake supplies active form values without a serialized domains property", () => {
  const thread = { state: {
    intake: { intent: { domains: ["flight"] }, constraints: { values: { origin: "SGN", flight_date: "2027-02-10" } } },
    progress: { items: [{ task_id: "pending:flight", agent: "flight", inputs: { destination: "HAN" } }] },
  } } as unknown as Thread;
  expect(requestDefaults(thread, "flight")).toEqual({ origin: "SGN", destination: "HAN", flight_date: "2027-02-10" });
});

test("a new housing scope never inherits historical city, budget or amenities", () => {
  const thread = { state: {
    intake: { intent: { domains: ["property"] }, constraints: { values: { city: "hcm" } } },
    plan: { tasks: [{ id: "new", agent: "property", inputs: { city: "hcm" } }] },
    progress: { items: [
      { task_id: "old", agent: "property", inputs: { city: "hanoi", max_price_vnd: 5000000, must_have: ["air_conditioning"] } },
      { task_id: "new", agent: "property", inputs: { city: "hcm" } },
    ] },
  } } as unknown as Thread;
  expect(requestDefaults(thread, "property")).toEqual({ city: "hcm" });
  expect(requestDefaults(thread, "property", "old")).toEqual({ city: "hanoi", max_price_vnd: 5000000, must_have: ["air_conditioning"] });
});

test("the current plan replaces stale progress for the same task, including removed criteria", () => {
  const thread = { state: {
    intake: { intent: { domains: ["property"] }, constraints: { values: {} } },
    plan: { tasks: [{ id: "search", agent: "property", inputs: { city: "hcm" } }] },
    progress: { items: [{ task_id: "search", agent: "property", inputs: { city: "hanoi", max_price_vnd: 5000000 } }] },
  } } as unknown as Thread;
  expect(requestDefaults(thread, "property")).toEqual({ city: "hcm" });
});

test("pending defaults skip completed history and unrequested services stay blank", () => {
  const thread = { state: {
    intake: { intent: { domains: ["flight"] }, constraints: { values: { origin: "HAN" } } },
    progress: { items: [
      { task_id: "old-flight", agent: "flight", inputs: { origin: "SGN", destination: "DAD" } },
      { task_id: "pending:flight", agent: "flight", inputs: { destination: "CXR" } },
      { task_id: "old-home", agent: "property", inputs: { city: "hanoi", max_price_vnd: 5000000 } },
    ] },
  } } as unknown as Thread;
  expect(requestDefaults(thread, "flight")).toEqual({ origin: "HAN", destination: "CXR" });
  expect(requestDefaults(thread, "property")).toEqual({});
});

test("multiple same-domain tasks require identity and cannot override each other with global constraints", () => {
  const thread = { state: {
    intake: { intent: { domains: ["map"] }, constraints: { values: {} } },
    plan: { tasks: [
      { id: "route-a", agent: "map", inputs: { route_from: "A", route_to: "B" } },
      { id: "route-b", agent: "map", inputs: { route_from: "C", route_to: "D" } },
    ] },
  } } as unknown as Thread;
  expect(requestDefaults(thread, "map")).toEqual({});
  expect(requestDefaults(thread, "map", "route-b")).toEqual({ route_from: "C", route_to: "D" });
  thread.state.intake.constraints.values = { route_from: "Updated A" };
  thread.state.intake.target_task_ids = ["route-a"];
  expect(requestDefaults(thread, "map")).toEqual({ route_from: "Updated A", route_to: "B" });
  expect(requestDefaults(thread, "map", "route-b")).toEqual({ route_from: "C", route_to: "D" });
});

test("invalid IDs and comparison tasks do not silently open a different search", () => {
  const thread = { state: {
    intake: { intent: { domains: ["property"] }, constraints: { values: { city: "hcm" } } },
    plan: { tasks: [{ id: "compare", agent: "property", inputs: { housing_mode: "compare", city: "hanoi" } }] },
    progress: { items: [{ task_id: "compare", agent: "property", inputs: { housing_mode: "compare", city: "hanoi" } }] },
  } } as unknown as Thread;
  expect(requestDefaults(thread, "property", "missing")).toEqual({});
  expect(requestDefaults(thread, "property", "compare")).toEqual({});
});

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

test("housing questions without form controls stay in chat even alongside supported questions", () => {
  for (const field of ["must_have", "bedrooms", "min_area_m2"]) {
    for (const prefix of ["", "property."]) {
      const question = { field: prefix + field, text: "Bạn cần tiêu chí nào?" };
      const thread = {
        state: { intake: { intent: { domains: ["property"] } } },
        messages: [{ role: "assistant", content: { response: {
          kind: "CLARIFY", text: question.text, questions: [question],
        } } }],
      } as unknown as Thread;
      expect(clarificationServices(thread)).toEqual([]);
      expect(guidedReplyText(question.text, [question], ["property"]))
        .toBe(question.text);
      const price = { field: "property.max_price_vnd", text: "Ngân sách tối đa?" };
      thread.messages[0].content.response!.questions!.push(price);
      expect(clarificationServices(thread)).toEqual(["property"]);
      expect(guidedReplyText(`${question.text}\n${price.text}`, [question, price], ["property"]))
        .toBe(question.text);
    }
  }
});

test("location failures never reopen generic forms, including older backend responses", () => {
  for (const field of ["near", "district", "city"]) {
    for (const prefix of ["", "property."]) {
      for (const reason of [undefined, "location_not_found", "location_ambiguous"]) {
        const question = { field: prefix + field, reason, text: "Chưa định vị được địa điểm." };
        const thread = {
          state: { intake: { intent: { domains: ["property"] }, constraints: { values: { [field]: "Ocean Park 1", max_price_vnd: 5000000 } } } },
          messages: [{ role: "assistant", content: { response: { kind: "CLARIFY", text: question.text, questions: [question] } } }],
        } as unknown as Thread;
        expect(clarificationServices(thread)).toEqual([]);
        expect(guidedReplyText(question.text, [question], ["property"])).toBe(question.text);
        // A different genuinely missing value may still use a form.
        thread.messages[0].content.response!.questions!.push({ field: "property.room_type", text: "Loại nhà?" });
        expect(clarificationServices(thread)).toEqual(["property"]);
      }
    }
  }
});

test("typed location failures and location choices stay out of forms even without stored inputs", () => {
  for (const extra of [{ reason: "location_not_found" }, { reason: "location_ambiguous" }, { choices: [{ id: "real-id" }] }, { options: ["Real area"] }]) {
    const question = { field: "property.near", text: "Xác nhận địa điểm.", ...extra };
    const thread = {
      state: { intake: { intent: { domains: ["property"] } } },
      messages: [{ role: "assistant", content: { response: { kind: "CLARIFY", text: question.text, questions: [question] } } }],
    } as unknown as Thread;
    expect(clarificationServices(thread)).toEqual([]);
    expect(guidedReplyText(question.text, [question], ["property"])).toBe(question.text);
  }
  const missing = {
    state: { intake: { intent: { domains: ["property"] } } },
    messages: [{ role: "assistant", content: { response: { kind: "CLARIFY", questions: [{ field: "near", text: "Tìm ở đâu?" }] } } }],
  } as unknown as Thread;
  expect(clarificationServices(missing)).toEqual(["property"]);
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
