// UI/transport contract fixtures; no LLM, supplier requests, bookings or payments.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function fixture(page: Page, pending = false) {
  const turns: any[] = [],
    actions: any[] = [];
  let fail = false;
  const thread: any = {
    id: "th_input",
    title: "Hành trình của bạn",
    updated: Date.now() / 1000,
    revision: 1,
    runs: [],
    messages: [],
    state: {
      plan: { version: 1, tasks: [] },
      intake: {
        domains: [],
        constraints: { values: {} },
        user_confirmed_facts: {},
      },
      progress: { items: [] },
      task_status: {},
    },
  };
  if (pending) {
    thread.state.intake.domains = ["flight"];
    thread.state.intake.constraints.values = {
      origin: "SGN",
      flight_date: "2027-02-10",
      passengers: 2,
    };
    thread.state.progress.items = [
      {
        task_id: "pending:flight",
        agent: "flight",
        state: "waiting",
        task_status: "pending",
        inputs: {},
      },
    ];
    thread.messages = [
      {
        id: "ask-flight",
        role: "assistant",
        created: Date.now() / 1000,
        content: {
          status: "done",
          response: {
            kind: "CLARIFY",
            text: "Mình cần thêm thông tin:\nBạn bay tới đâu?\nBạn xác nhận trước khi đặt.",
            questions: [
              { field: "flight.destination", text: "Bạn bay tới đâu?" },
            ],
          },
        },
      },
    ];
  }
  await page.route("**/web/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
        "/web/api",
        "",
      ),
      method = route.request().method();
    let data: any = {};
    if (path === "/session")
      data = {
        id: "form-fixture",
        name: "Minh Anh",
        email: "form@example.test",
        preferences: {},
      };
    else if (path === "/status")
      data = {
        domains: ["property", "flight", "map", "relocation"],
        writes_enabled: false,
      };
    else if (path === "/saved") data = [];
    else if (path === "/threads" && method === "GET")
      data = thread.messages.length ? [thread] : [];
    else if (path === "/threads" || path === "/threads/th_input") data = thread;
    else if (path === "/roommate/availability")
      data = { enabled: false, demo_enabled: false };
    else if (path === "/threads/th_input/chat") {
      const body = route.request().postDataJSON();
      turns.push(body);
      if (fail)
        return route.fulfill({
          status: 502,
          json: { detail: "Dịch vụ đang bận. Hãy thử lại." },
        });
      thread.state.plan.tasks = [
        {
          id: "flight-search",
          agent: "flight",
          inputs: { origin: "SGN", destination: "HAN", date: "2027-02-10" },
        },
      ];
      thread.state.task_status = { "flight-search": "done" };
      thread.state.progress.items = [];
      thread.messages.push(
        {
          id: "user-search",
          role: "user",
          created: Date.now() / 1000,
          content: { text: body.message, status: "done" },
        },
        {
          id: "flight-answer",
          role: "assistant",
          created: Date.now() / 1000,
          content: {
            status: "done",
            response: { kind: "ANSWER", text: "Kết quả giao diện kiểm thử." },
            ui: {
              version: 1,
              plan_version: 1,
              components: [
                {
                  id: "flight-result",
                  task_id: "flight-search",
                  type: "flight",
                  fetched_at: new Date().toISOString(),
                  data: {
                    origin: "SGN",
                    destination: "HAN",
                    offers: [
                      {
                        id: "test-offer",
                        carrier: "Fixture Air",
                        fare_vnd: 1000000,
                        depart_at: "2027-02-10T08:00:00+07:00",
                        arrive_at: "2027-02-10T10:00:00+07:00",
                        expires_at: new Date(
                          Date.now() + 3600000,
                        ).toISOString(),
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      );
      data = thread;
    } else if (path === "/threads/th_input/action") {
      const body = route.request().postDataJSON();
      actions.push(body);
      thread.state.intake.user_confirmed_facts["selected:flight"] = {
        value: body.entity_id,
      };
      data = thread;
    }
    await route.fulfill({ json: data });
  });
  return {
    thread,
    turns,
    actions,
    setFail: (value: boolean) => {
      fail = value;
    },
  };
}

test("direct flight entry submits complete details through chat and opens selectable results", async ({
  page,
}) => {
  const { turns, actions } = await fixture(page);
  await page.goto("/ai");
  await page.getByRole("button", { name: /Tìm chuyến bay Sẵn sàng/ }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Nơi đi", { exact: true }).fill("SGN");
  await form.getByLabel("Nơi đến", { exact: true }).fill("HAN");
  await form.getByLabel("Ngày bay", { exact: true }).fill("2027-02-10");
  await form.getByLabel("Khứ hồi", { exact: true }).check();
  await form.getByLabel("Ngày về", { exact: true }).fill("2027-02-13");
  await form.getByLabel("Người lớn", { exact: true }).selectOption("2");
  await form
    .getByRole("button", { name: "Tìm chuyến bay", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Chuyến bay", exact: true }),
  ).toBeVisible();
  expect(turns).toHaveLength(1);
  expect(Object.keys(turns[0]).sort()).toEqual(["message", "request_id"]);
  expect(turns[0].message).toContain("khứ hồi từ SGN đến HAN");
  expect(turns[0].message).toContain("2027-02-13");
  await page
    .getByRole("button", { name: "Chỉnh hành trình", exact: true })
    .click();
  const edit = page.getByRole("dialog");
  await expect(edit.getByLabel("Nơi đi", { exact: true })).toHaveValue("SGN");
  await expect(edit.getByLabel("Ngày bay", { exact: true })).toHaveValue(
    "2027-02-10",
  );
  await edit
    .getByRole("button", { name: "Đổi nơi đi và nơi đến", exact: true })
    .click();
  await expect(edit.getByLabel("Nơi đi", { exact: true })).toHaveValue("HAN");
  await edit.getByRole("button", { name: "Hủy", exact: true }).click();
  expect(turns).toHaveLength(1);
  await page
    .getByRole("button", { name: "Chọn chuyến này", exact: true })
    .click();
  await expect.poll(() => actions.length).toBe(1);
  expect(actions[0]).toMatchObject({
    kind: "select",
    task_id: "flight-search",
    entity_id: "test-offer",
    plan_version: 1,
  });
});

test("chat clarification shows a prefilled form; closing/reopening and network failure retain edits", async ({
  page,
}) => {
  const { turns, setFail } = await fixture(page, true);
  await page.goto("/ai/th_input");
  const panel = page.getByRole("region", {
    name: "Bổ sung thông tin dịch vụ",
    exact: true,
  });
  await expect(panel.getByLabel("Nơi đi", { exact: true })).toHaveValue("SGN");
  await expect(panel.getByLabel("Ngày bay", { exact: true })).toHaveValue(
    "2027-02-10",
  );
  await expect(panel.getByLabel("Người lớn", { exact: true })).toHaveValue("2");
  await panel.getByLabel("Nơi đến", { exact: true }).fill("HAN");
  await panel
    .getByRole("button", { name: "Tiếp tục bằng chat", exact: true })
    .click();
  await expect(page.locator(".composer textarea")).toBeFocused();
  await expect(
    page.getByText("Bạn bay tới đâu?", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Điền thông tin bằng biểu mẫu" })
    .click();
  await expect(panel.getByLabel("Nơi đến", { exact: true })).toHaveValue("HAN");
  setFail(true);
  await panel
    .getByRole("button", { name: "Tìm chuyến bay", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("Dịch vụ đang bận");
  await expect(panel.getByLabel("Nơi đến", { exact: true })).toHaveValue("HAN");
  expect(turns[0].message).toContain("Bổ sung cho yêu cầu chuyến bay hiện tại");
  setFail(false);
  await panel
    .getByRole("button", { name: "Tìm chuyến bay", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Chuyến bay", exact: true }),
  ).toBeVisible();
});

test("service forms are responsive, keyboard accessible and readable in light/dark VI/EN", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/ai");
  for (const dark of [false, true]) {
    await page.setViewportSize({ width: 1440, height: 960 });
    if (dark)
      await page
        .getByRole("button", { name: "Chuyển sang chế độ tối", exact: true })
        .click();
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      await page
        .getByRole("button", { name: /Tìm chuyến bay Sẵn sàng/ })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Khứ hồi", { exact: true }).check();
      expect(
        await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      ).toBe(false);
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        audit.violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`flight-${dark ? "dark" : "light"}-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /Tìm chuyến bay Sẵn sàng/ }),
      ).toBeFocused();
    }
  }
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("button", { name: /Find a flight Ready/ }).click();
  const english = page.getByRole("dialog");
  await expect(
    english.getByRole("radio", { name: "Round trip" }),
  ).toBeVisible();
  await expect(
    english.getByRole("button", { name: "Find a flight", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("home and route tiles still open structured forms and roommate/guides keep their routes", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/ai");
  await expect(page.locator(".quick-card")).toHaveCount(6);
  await page.getByRole("button", { name: /Tìm nhà Một nơi/ }).click();
  const home = page.getByRole("dialog");
  await expect(home.getByLabel("Gần địa điểm")).toBeVisible();
  await home.getByRole("button", { name: "Hủy", exact: true }).click();
  await page.getByRole("button", { name: /Đường đi Khoảng cách/ }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Điểm đi", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("link", { name: "Ở ghép", exact: true }),
  ).toHaveAttribute("href", "/roommate");
  await expect(
    page.getByRole("link", { name: "Cẩm nang", exact: true }),
  ).toHaveAttribute("href", "/guides");
});

test("multi-service clarification keeps edits when switching forms and preserves known home/route criteria", async ({
  page,
}, info) => {
  const { thread, turns } = await fixture(page, true);
  thread.state.intake.domains = ["flight", "property", "map"];
  Object.assign(thread.state.intake.constraints.values, {
    city: "hanoi",
    max_price_vnd: 5000000,
    map_mode: "route",
    route_to: "Công ty tại Cầu Giấy",
  });
  thread.messages[0].content.response.questions.push(
    { field: "property.near", text: "Bạn cần ở gần nơi nào?" },
    { field: "map.route_from", text: "Bạn đi từ đâu?" },
  );
  await page.goto("/ai/th_input");
  const panel = page.getByRole("region", { name: "Bổ sung thông tin dịch vụ" });
  await panel.getByLabel("Nơi đến", { exact: true }).fill("HAN");
  await panel
    .getByRole("button", { name: "Tiêu chí tìm nhà", exact: true })
    .click();
  await expect(
    panel.locator('.request-pane:not([hidden]) select[name="city"]'),
  ).toHaveValue("Hà Nội");
  await expect(panel.locator('input[name="max"]')).toHaveValue("5000000");
  await panel
    .getByLabel("Gần địa điểm", { exact: true })
    .fill("Đại học Bách Khoa");
  await panel
    .getByRole("button", { name: "Thông tin đường đi", exact: true })
    .click();
  await expect(panel.getByLabel("Điểm đến", { exact: true })).toHaveValue(
    "Công ty tại Cầu Giấy",
  );
  await panel
    .getByRole("button", { name: "Thông tin chuyến bay", exact: true })
    .click();
  await expect(panel.getByLabel("Nơi đến", { exact: true })).toHaveValue("HAN");
  await panel
    .getByRole("button", { name: "Tiêu chí tìm nhà", exact: true })
    .click();
  await expect(panel.getByLabel("Gần địa điểm", { exact: true })).toHaveValue(
    "Đại học Bách Khoa",
  );
  expect(turns).toHaveLength(0);
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations.map((v) => v.id)).toEqual([]);
  await page.screenshot({ path: info.outputPath("inline-criteria.png") });
});
