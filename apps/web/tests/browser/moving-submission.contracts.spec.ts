// Structural UI contracts only: no network stubs, fake GPS or provider data.
import { expect, test } from "@playwright/test";
import {
  movingDestinationPoint,
  movingQuoteFeedback,
  movingScheduleIssue,
} from "../../src/movingSubmission";
import type { Component, Message, Thread } from "../../src/types";

function reply(
  kind: string,
  text: string,
  components: Component[] = [],
  questions = [] as { text: string }[],
): Message {
  return {
    id: kind,
    role: "assistant",
    created: 0,
    content: {
      status: "done",
      response: { kind, text, questions },
      ui: { version: 1, plan_version: 1, components },
    },
  };
}
const thread = (messages: Message[]): Thread => ({
  id: "contract",
  title: "",
  updated: 0,
  revision: 1,
  state: {},
  messages,
  runs: [],
});
// Only existence is relevant to this UI contract; no invented prices/routes/providers.
const quoted: Component = {
  id: "new-result",
  type: "relocation",
  task_id: "",
  fetched_at: "",
  data: { quotes: [{}] },
};

test("HTTP 200 clarification exposes its questions rather than silently leaving the form", () => {
  const questions = [
    { text: "Select an available service" },
    { text: "Select an available service" },
  ];
  expect(
    movingQuoteFeedback(
      thread([reply("ASK_USER", "Long full-chat response", [], questions)]),
    ),
  ).toBe("Select an available service");
});

test("HTTP 200 business errors and unconnected/empty responses expose actionable feedback", () => {
  expect(
    movingQuoteFeedback(thread([reply("ERROR", "Provider unavailable")])),
  ).toBe("Provider unavailable");
  expect(
    movingQuoteFeedback(thread([reply("PARTIAL", "No services at pickup")])),
  ).toBe("No services at pickup");
  expect(movingQuoteFeedback(thread([]))).toContain("Chưa nhận được báo giá");
});

test("only a new successful quote opens review, not orders, another domain, or old repeated quotes", () => {
  for (const kind of ["ANSWER", "PARTIAL", "CLARIFY"])
    expect(
      movingQuoteFeedback(thread([reply(kind, "", [quoted])])),
    ).toBeUndefined();
  for (const component of [
    { ...quoted, type: "flight" },
    { ...quoted, data: { quotes: [{}], order: {} } },
    { ...quoted, data: { quotes: [] } },
  ])
    expect(
      movingQuoteFeedback(
        thread([reply("ANSWER", "Not a new quote", [component])]),
      ),
    ).toBe("Not a new quote");
  expect(
    movingQuoteFeedback(
      thread([
        reply("ANSWER", "", [quoted]),
        reply("PARTIAL", "Retry refused", [quoted]),
      ]),
    ),
  ).toBe("Retry refused");
  expect(
    movingQuoteFeedback(
      thread([reply("ERROR", "Do not use this quote", [quoted])]),
    ),
  ).toBe("Do not use this quote");
});

test("a plan clarification does not hide new quotes or dismiss the original questions", () => {
  const result = thread([
    reply(
      "CLARIFY",
      "Confirm the total budget",
      [quoted],
      [{ text: "Confirm the total budget" }],
    ),
  ]);
  expect(movingQuoteFeedback(result)).toBeUndefined();
  expect(result.messages[0].content.response?.questions).toEqual([
    { text: "Confirm the total budget" },
  ]);
  expect(movingQuoteFeedback(thread([reply("CLARIFY", "No quote yet")]))).toBe(
    "No quote yet",
  );
});

test("schedule validation uses Vietnam time and matches the server's 30-minute minimum", () => {
  const now = Date.parse("2026-10-11T10:00:00+07:00");
  expect(movingScheduleIssue("2026-10-11", "10:29", now)).toContain("30 phút");
  expect(movingScheduleIssue("2026-10-11", "10:30", now)).toBeUndefined();
  expect(movingScheduleIssue("2026-10-12", "10:00", now)).toBeUndefined();
  expect(movingScheduleIssue("", "10:00", now)).toContain("chọn ngày");
  for (const [date, time] of [
    ["2026-10-11", "25:00"],
    ["2026-02-30", "10:00"],
    ["bad", "10:00"],
  ])
    expect(movingScheduleIssue(date, time, now)).toContain("chưa hợp lệ");
});

test("a decided home is point B; before deciding, B needs a picked or pinned point", () => {
  // Shape-only points: the function never invents or changes coordinates.
  const home = { lat: 1, lng: 2, label: "decided home" };
  const pinned = { lat: 3, lng: 4, label: "user pin" };
  const viewing = { decided: false, point: null };
  expect(movingDestinationPoint(null, viewing)).toEqual({});
  expect(movingDestinationPoint(pinned, viewing)).toEqual({ point: pinned });
  expect(movingDestinationPoint(null, { decided: true, point: home })).toEqual({
    point: home,
  });
  // A point the user pinned (another address or a corrected gate) wins over the listing location.
  expect(
    movingDestinationPoint(pinned, { decided: true, point: home }),
  ).toEqual({ point: pinned });
  expect(
    movingDestinationPoint(null, { decided: true, point: null, loading: true })
      .issue,
  ).toContain("Đang lấy vị trí");
  expect(
    movingDestinationPoint(null, { decided: true, point: null }).issue,
  ).toContain("ghim cổng nhà");
});
