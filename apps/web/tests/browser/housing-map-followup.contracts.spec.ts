import { expect, test } from "@playwright/test";
import { retainHousingWorkspace } from "../../src/serviceJourney";
import {
  clarificationServices,
  guidedReplyText,
} from "../../src/serviceRequest";
import type { Thread } from "../../src/types";

function thread(kind = "CLARIFY"): Thread {
  return {
    id: "t",
    state: {
      intake: {
        kind: "change",
        intent: { domains: ["property"] },
        constraints: { values: {} },
      },
    },
    messages: [
      {
        role: "assistant",
        content: { response: { kind, text: "", questions: [] } },
      },
    ],
  } as unknown as Thread;
}

test("only same-thread property follow-up errors/clarifications keep an open map", () => {
  for (const kind of ["ERROR", "CLARIFY"])
    expect(retainHousingWorkspace(thread(kind), "t")).toBe(true);
  expect(retainHousingWorkspace(thread(), "other")).toBe(false);
  expect(retainHousingWorkspace(null, "t")).toBe(false);
  expect(retainHousingWorkspace(thread("ANSWER"), "t")).toBe(false);
  for (const kind of ["new_goal", "unsupported"]) {
    const t = thread();
    t.state.intake.kind = kind;
    expect(retainHousingWorkspace(t, "t")).toBe(false);
  }
  for (const domains of [["flight"], ["property", "relocation"]]) {
    const t = thread();
    t.state.intake.intent.domains = domains;
    expect(retainHousingWorkspace(t, "t")).toBe(false);
  }
  for (const housing_mode of ["compare", "search_compare"]) {
    const t = thread();
    t.state.intake.constraints.values.housing_mode = housing_mode;
    expect(retainHousingWorkspace(t, "t")).toBe(false);
  }
});

test("a full form never hides why the location needs confirmation", () => {
  const t = thread();
  const question = {
    field: "near",
    text: 'Mình chưa có tọa độ đáng tin cậy cho "Cầu Giấy". Bạn ghim trên bản đồ nhé.',
  };
  t.messages[0].content.response!.questions = [question];
  const text = "Để làm tiếp, bạn cho mình biết thêm:\n" + question.text;
  expect(clarificationServices(t)).toEqual(["property"]);
  expect(guidedReplyText(text, [question], ["property"])).toBe(text);
});
