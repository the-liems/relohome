// Pure state/error policies: no intercepted APIs, seeded listings or mocked agents.
import { expect, test } from "@playwright/test";
import { apiFailure } from "../../src/apiError";
import { OverlayPollGate } from "../../src/overlayPolling";
import { currentHousingTarget } from "../../src/serviceJourney";
import type { Thread } from "../../src/types";

test("proxy errors are distinct and never display an HTML server body", () => {
  const blocked = apiFailure(403, "<html>Just a moment...</html>", false);
  expect(blocked.code).toBe("ACCESS_BLOCKED");
  expect(blocked.message).toContain("403");
  expect(blocked.message).not.toContain("<html>");
  expect(apiFailure(502, null, false).message).toContain("Cổng kết nối");
  expect(apiFailure(200, null, false).code).toBe("INVALID_RESPONSE");
  expect(
    apiFailure(503, { detail: "Chưa nhận được kết quả từ dịch vụ." }).message,
  ).toContain("dịch vụ");
});

test("an unfinished new search cannot borrow a historical Housing workspace", () => {
  // IDs and empty UI metadata exercise navigation only, not provider responses.
  const thread: Thread = {
    id: "navigation",
    title: "",
    updated: 0,
    revision: 1,
    runs: [],
    state: {
      plan: {
        version: 2,
        tasks: [{ id: "current-search", agent: "property" }],
      },
      progress: { items: [{ task_id: "earlier-search" }] },
      task_status: {
        "earlier-search": "done",
        "current-search": "needs_input",
      },
    },
    messages: [
      {
        id: "earlier-result",
        role: "assistant",
        created: 0,
        content: {
          status: "done",
          ui: {
            version: 1,
            plan_version: 1,
            components: [
              {
                id: "earlier-map",
                type: "property",
                task_id: "earlier-search",
                fetched_at: "",
                data: {},
              },
            ],
          },
        },
      },
    ],
  };
  expect(currentHousingTarget(thread, null)).toBeUndefined();
  expect(currentHousingTarget(thread, "current-search")).toBeUndefined();
  expect(currentHousingTarget(thread, "earlier-search")?.c.id).toBe(
    "earlier-map",
  );
});

test("an empty thread never opens a historical map", () => {
  expect(currentHousingTarget(null, null)).toBeUndefined();
});

test("healthy optional overlays keep polling without overlapping requests", () => {
  const gate = new OverlayPollGate();
  expect(gate.begin()).toBe(true);
  expect(gate.begin()).toBe(false);
  gate.finish();
  expect(gate.begin()).toBe(true);
});

test("an overlay failure pauses automatic requests; a new scope or manual retry can resume", () => {
  const gate = new OverlayPollGate();
  expect(gate.begin()).toBe(true);
  gate.finish(true);
  gate.finish(); // finally must not accidentally clear the paused state.
  expect(gate.begin()).toBe(false);
  expect(gate.begin()).toBe(false);
  expect(new OverlayPollGate().begin()).toBe(true);
});
