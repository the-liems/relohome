// UI/transport contract fixtures; no LLM, supplier requests, bookings or payments.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function fixture(page: Page, pending = false, withMoving = false) {
  const turns: any[] = [],
    actions: any[] = [];
  let fail = false;
  let graphError = false;
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
  const movingStep = {
    task_id: "pending:relocation",
    agent: "relocation",
    state: "waiting",
    task_status: "needs_input",
    inputs: {},
    chosen: null,
  };
  if (withMoving && pending) {
    thread.state.intake.domains.push("relocation");
    thread.state.progress.items.push(movingStep);
    thread.messages[0].content.response.questions.push({
      field: "relocation.from_address",
      text: "Bạn chuyển đồ từ đâu?",
    });
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
      if (graphError) {
        thread.messages.push({
          id: "failed-search",
          role: "assistant",
          created: Date.now() / 1000,
          content: {
            status: "done",
            response: {
              kind: "ERROR",
              text: "Hệ thống chưa xử lý được yêu cầu trong lượt này. Không có giao dịch nào được thực hiện; bạn có thể thử lại.",
              data: { error: { node: "intake", code: "ERROR" } },
            },
          },
        });
        return route.fulfill({ status: 200, json: thread });
      }
      thread.state.plan.tasks = [
        {
          id: "flight-search",
          agent: "flight",
          inputs: { origin: "SGN", destination: "HAN", date: "2027-02-10" },
        },
      ];
      thread.state.task_status = { "flight-search": "done" };
      thread.state.progress.items = withMoving
        ? [
            {
              task_id: "flight-search",
              agent: "flight",
              state: "ready",
              task_status: "done",
              inputs: {},
              chosen: null,
            },
            movingStep,
          ]
        : [];
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
            response: {
              kind: withMoving ? "CLARIFY" : "ANSWER",
              text: "Kết quả giao diện kiểm thử.",
              questions: withMoving
                ? [
                    {
                      field: "relocation.from_address",
                      text: "Bạn chuyển đồ từ đâu?",
                    },
                  ]
                : [],
            },
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
      const flightStep = thread.state.progress.items.find(
        (i: any) => i.task_id === "flight-search",
      );
      if (flightStep)
        Object.assign(flightStep, {
          state: "confirmed",
          chosen: { id: body.entity_id, label: "Fixture Air" },
        });
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
    setGraphError: (value: boolean) => {
      graphError = value;
    },
  };
}

test("persistent compact header and simplified housing form work across themes and viewports", async ({ page }, info) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/ai");
  for (const theme of ["light", "dark"]) {
    const current = await page.locator("html").getAttribute("data-theme");
    if (current !== theme) await page.locator(".theme-switch").click();
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(width / 2, 500);
      await page.locator(".composer textarea").blur();
      const header = page.locator(".chat-header");
      await expect(header).toBeVisible();
      expect(await header.evaluate(el => getComputedStyle(el).transform)).toBe("none");
      await expect(page.locator(".chat-home-link")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Về chat", exact: true })).toHaveText("ReloHome");
      const headerBox = (await header.boundingBox())!;
      const welcomeBox = (await page.locator(".welcome").boundingBox())!;
      expect(headerBox.height).toBeLessThanOrEqual(width < 768 ? 104 : 72);
      expect(welcomeBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
      await page.getByRole("button", { name: /Tìm nhà Một nơi/ }).click();
      const dialog = page.getByRole("dialog");
      expect(await dialog.locator('.form-grid').first().locator('input,select').evaluateAll(nodes => nodes.map(node => node.getAttribute('name'))))
        .toEqual(["city", "district", "min", "max"]);
      const optional = dialog.getByRole("region", { name: "Tiêu chí chi tiết · không bắt buộc" });
      await expect(optional.getByLabel("Loại nhà")).toBeVisible();
      await expect(optional.getByLabel("Gần địa điểm")).toBeVisible();
      await expect(optional.locator('input,select')).toHaveCount(2);
      await expect(dialog.locator('details')).toHaveCount(0);
      await expect(dialog.locator('.required-mark')).toHaveCount(1);
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const violations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations;
      expect(violations.map(v => ({ id:v.id,targets:v.nodes.map(n=>n.target) }))).toEqual([]);
      await page.screenshot({ path:info.outputPath(`housing-${theme}-${width}.png`) });
      await page.keyboard.press("Escape");
    }
  }
});

test("required marks match native required fields in flight and route forms", async ({ page }) => {
  await fixture(page);
  await page.goto("/ai");
  for (const service of [/Tìm chuyến bay Sẵn sàng/, /Đường đi Khoảng cách/]) {
    await page.getByRole("button", { name:service }).click();
    const dialog = page.getByRole("dialog");
    if (service.source.startsWith("Tìm")) await dialog.getByLabel("Khứ hồi", { exact:true }).check();
    const missing = await dialog.locator('input:required,select:required,textarea:required,[aria-required="true"]').evaluateAll(nodes =>
      nodes.filter(node => !node.closest('label')?.querySelector('.required-mark')).map(node => node.getAttribute('name') || node.id));
    expect(missing).toEqual([]);
    await page.keyboard.press("Escape");
  }
});

test("housing form validates the range and submits only the explicit visible criteria", async ({ page }) => {
  const { turns } = await fixture(page);
  await page.goto("/ai");
  await page.getByRole("button", { name:/Tìm nhà Một nơi/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Thành phố", { exact:true }).selectOption("Thành phố Hồ Chí Minh");
  await dialog.getByLabel("Quận / khu vực", { exact:true }).fill("Bình Thạnh");
  await dialog.getByLabel("Giá từ · VND/tháng", { exact:true }).fill("6000000");
  await dialog.getByLabel("Đến · VND/tháng", { exact:true }).fill("5000000");
  await dialog.getByRole("button", { name:"Áp dụng", exact:true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Giá tối thiểu phải nhỏ hơn hoặc bằng giá tối đa.");
  expect(turns).toHaveLength(0);
  await dialog.getByLabel("Giá từ · VND/tháng", { exact:true }).fill("3000000");
  await dialog.getByLabel("Loại nhà", { exact:true }).selectOption("phòng trọ");
  await dialog.getByLabel("Gần địa điểm", { exact:true }).fill("Đại học HUTECH");
  await dialog.getByRole("button", { name:"Áp dụng", exact:true }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0].message).toBe("Tìm phòng trọ tại Bình Thạnh, Thành phố Hồ Chí Minh, gần Đại học HUTECH, giá từ 3000000 đồng/tháng, không quá 5000000 đồng/tháng.");
  expect(Object.keys(turns[0]).sort()).toEqual(["message", "request_id"]);
});

test("composer hints type, erase and loop until interaction without becoming a draft", async ({ page }) => {
  const { turns } = await fixture(page);
  await page.clock.install();
  await page.emulateMedia({ reducedMotion:"no-preference" });
  await page.goto("/ai");
  const input = page.getByRole("textbox", { name:"Tin nhắn cho ReloHome" });
  await expect(input).toBeVisible();
  const home = "Tôi muốn tìm nhà khu vực Bình Thạnh, thành phố Hồ Chí Minh dưới 5 triệu";
  const moving = "Tôi muốn chuyển đồ từ Bình Thạnh đến Gò Vấp";
  // React may mount/restart the effect after navigation or session loading.
  // Advance the fake clock until the rendered state matches, not a timestamp.
  const advanceUntilHint = async (description: string, matches: (hint: string) => boolean) => {
    await expect.poll(async () => {
      await page.clock.runFor(100);
      return matches((await input.getAttribute("placeholder")) ?? "");
    }, { message: description, intervals: [0], timeout: 15000 }).toBe(true);
  };
  await advanceUntilHint("the housing hint is partially typed", hint =>
    hint.startsWith("Tôi muốn") && home.startsWith(hint) && hint.length < home.length);
  await advanceUntilHint("the housing hint is complete", hint => hint === home);
  await advanceUntilHint("the housing hint starts erasing", hint =>
    hint.length > 0 && hint.length < home.length && home.startsWith(hint));
  await advanceUntilHint("the moving hint is complete", hint => hint === moving);
  await advanceUntilHint("the housing hint loops back", hint => hint === home);
  await expect(input).toHaveValue("");
  await expect(page.getByRole("button", { name:"Gửi tin nhắn", exact:true })).toBeDisabled();
  expect(turns).toHaveLength(0);
  await input.focus();
  await page.clock.runFor(20000);
  await expect(input).toHaveAttribute("placeholder", "Nhắn cho ReloHome…");
  await expect(input).toHaveValue("");
  await input.blur();
  await page.clock.runFor(20000);
  await expect(input).toHaveAttribute("placeholder", "Nhắn cho ReloHome…");
  await input.fill("Nội dung của tôi");
  await page.clock.runFor(5000);
  await expect(input).toHaveValue("Nội dung của tôi");
  await input.press("Shift+Enter");
  expect(turns).toHaveLength(0);
  await expect(input).toHaveValue("Nội dung của tôi\n");
});

test("composer hint respects reduced motion and follows the selected language", async ({ page }) => {
  await fixture(page);
  await page.clock.install();
  await page.emulateMedia({ reducedMotion:"reduce" });
  await page.goto("/ai");
  const input = page.getByRole("textbox", { name:"Tin nhắn cho ReloHome" });
  await expect(input).toHaveAttribute("placeholder", "Tôi muốn tìm nhà khu vực Bình Thạnh, thành phố Hồ Chí Minh dưới 5 triệu");
  await page.clock.runFor(20000);
  await expect(input).toHaveAttribute("placeholder", "Tôi muốn tìm nhà khu vực Bình Thạnh, thành phố Hồ Chí Minh dưới 5 triệu");
  await page.getByRole("button", { name:"EN", exact:true }).click();
  await expect(page.locator(".composer textarea")).toHaveAttribute("placeholder", /I am looking for a home in Binh Thanh/);
});

test("a pending Moving task never steals Flight input; choosing a flight offers an explicit next step", async ({
  page,
}) => {
  const { turns, actions } = await fixture(page, true, true);
  await page.goto("/ai/th_input");
  const form = page.getByRole("region", {
    name: "Bổ sung thông tin dịch vụ",
    exact: true,
  });
  await expect(form.getByLabel("Nơi đến", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("complementary", {
      name: "Thông tin chuyển đồ",
      exact: true,
    }),
  ).toHaveCount(0);
  await form.getByLabel("Nơi đến", { exact: true }).fill("HAN");
  await form
    .getByRole("button", { name: "Tìm chuyến bay", exact: true })
    .click();
  const flights = page.getByRole("region", { name: "Chuyến bay", exact: true });
  await expect(flights).toBeVisible();
  await flights
    .getByRole("button", { name: "Chọn chuyến này", exact: true })
    .click();
  await expect.poll(() => actions.length).toBe(1);
  await expect(flights).toBeVisible();
  const next = page.getByRole("region", {
    name: "Bước tiếp theo trong kế hoạch",
    exact: true,
  });
  await expect(
    next.getByRole("button", {
      name: "Bước tiếp theo: Chuyển đồ",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", {
      name: "Thông tin chuyển đồ",
      exact: true,
    }),
  ).toHaveCount(0);
  await next
    .getByRole("button", { name: "Bước tiếp theo: Chuyển đồ", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", {
      name: "Thông tin chuyển đồ",
      exact: true,
    }),
  ).toBeVisible();
  expect(turns).toHaveLength(1);
  expect(actions).toHaveLength(1);
  await page.getByRole("button", { name: "Về hội thoại", exact: true }).click();
  await expect(page.locator(".composer textarea")).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Bước tiếp theo trong kế hoạch",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("a home chosen for viewing offers Moving explicitly and keeps the destination undecided", async ({
  page,
}, info) => {
  const { thread, turns, actions } = await fixture(page);
  const home = {
    id: "viewing-only-home",
    title: "Căn đã chọn để hẹn xem",
    address: "Hà Nội",
    lat: 21.028,
    lng: 105.836,
    price_vnd: 4000000,
  };
  thread.state.plan.tasks = [
    { id: "home", agent: "property", inputs: { city: "Hà Nội" } },
  ];
  thread.state.task_status = { home: "done" };
  thread.state.progress.items = [
    {
      task_id: "home",
      agent: "property",
      state: "reviewed",
      task_status: "done",
      inputs: { city: "Hà Nội" },
      chosen: null,
    },
    {
      task_id: "pending:relocation",
      agent: "relocation",
      state: "waiting",
      task_status: "needs_input",
      inputs: { to_address: "selected:property" },
      after: ["home"],
      chosen: null,
    },
  ];
  thread.state.viewing = {
    items: [
      {
        task_id: "home",
        listing_id: home.id,
        status: "selected",
        title: home.title,
        snapshot: home,
      },
    ],
    max_selected: 3,
    slots: [],
  };
  thread.messages = [
    {
      id: "housing-result",
      role: "assistant",
      created: Date.now() / 1000,
      content: {
        status: "done",
        response: {
          kind: "ANSWER",
          text: "Đã tìm nhà. Bạn chọn căn để hẹn xem.",
        },
        ui: {
          version: 1,
          plan_version: 1,
          components: [
            {
              id: "home-result",
              task_id: "home",
              type: "property",
              fetched_at: new Date().toISOString(),
              data: {
                candidates: [home],
                area_name: "Hà Nội",
                search_request: { city: "Hà Nội" },
                map_context: {
                  viewport: {
                    west: 105.82,
                    south: 21.02,
                    east: 105.85,
                    north: 21.04,
                  },
                },
              },
            },
          ],
        },
      },
    },
  ];
  await page.route("**/web/api/platform/**", (route) =>
    route.fulfill({
      json: {
        type: "FeatureCollection",
        features: [],
        results: [],
        page: { returned_count: 0, next_cursor: null },
      },
    }),
  );
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#edf3ef" },
          },
        ],
      },
    }),
  );
  await page.goto("/ai/th_input");
  await expect(
    page.getByRole("region", { name: "Bản đồ nhà ở", exact: true }),
  ).toBeVisible();
  const step = page.getByRole("region", {
    name: "Bước tiếp theo trong kế hoạch",
    exact: true,
  });
  await expect(step).toContainText("Nhà mới được chọn để hẹn xem");
  await expect(
    page
      .getByRole("navigation", { name: "Dịch vụ trong kế hoạch" })
      .getByRole("region", { name: "Bước tiếp theo trong kế hoạch" }),
  ).toBeVisible();
  const reminderBox = await step.boundingBox();
  expect(reminderBox!.height).toBeLessThanOrEqual(52);
  expect(reminderBox!.width).toBeLessThan(360);
  await expect(page.getByRole("group", { name: "Gợi ý dịch vụ liên quan", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("complementary", {
      name: "Thông tin chuyển đồ",
      exact: true,
    }),
  ).toHaveCount(0);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    expect(
      await step.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include(".plan-next-step")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.screenshot({
    path: info.outputPath("home-next-step.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Chuyển sang chế độ tối", exact: true }).focus();
  await page
    .getByRole("button", { name: "Chuyển sang chế độ tối", exact: true })
    .click();
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 960 });
  const englishStep = page.getByRole("region", {
    name: "Next step in your plan",
    exact: true,
  });
  await expect(
    englishStep.getByRole("button", { name: "Next step: Moving", exact: true }),
  ).toBeVisible();
  expect(
    await englishStep.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .include(".plan-next-step")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("home-next-step-dark-en-320.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "VI", exact: true }).focus();
  await page.getByRole("button", { name: "VI", exact: true }).click();
  await step
    .getByRole("button", { name: "Bước tiếp theo: Chuyển đồ", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", {
      name: "Thông tin chuyển đồ",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    thread.state.intake.user_confirmed_facts["selected:property"],
  ).toBeUndefined();
  expect(turns).toHaveLength(0);
  expect(actions).toHaveLength(0);
});

test("HTTP 200 Agent errors keep the flight form and its draft until a successful retry", async ({
  page,
}) => {
  const { turns, setGraphError } = await fixture(page);
  setGraphError(true);
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
  await expect(form).toBeVisible();
  await expect(form.getByRole("alert")).toContainText(
    "Hệ thống chưa xử lý được yêu cầu",
  );
  await expect(form.getByLabel("Nơi đi", { exact: true })).toHaveValue("SGN");
  await expect(form.getByLabel("Ngày về", { exact: true })).toHaveValue(
    "2027-02-13",
  );
  await expect(form.getByLabel("Người lớn", { exact: true })).toHaveValue("2");
  expect(turns).toHaveLength(1);
  setGraphError(false);
  await form
    .getByRole("button", { name: "Tìm chuyến bay", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Chuyến bay", exact: true }),
  ).toBeVisible();
  expect(turns).toHaveLength(2);
});

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

test("inline clarification preserves entered fields when the Agent returns HTTP 200 ERROR", async ({
  page,
}) => {
  const { setGraphError, turns } = await fixture(page, true);
  setGraphError(true);
  await page.goto("/ai/th_input");
  const panel = page.getByRole("region", {
    name: "Bổ sung thông tin dịch vụ",
    exact: true,
  });
  await panel.getByLabel("Nơi đến", { exact: true }).fill("HAN");
  await panel
    .getByRole("button", { name: "Tìm chuyến bay", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Hệ thống chưa xử lý được yêu cầu",
  );
  await expect(panel.getByLabel("Nơi đến", { exact: true })).toHaveValue("HAN");
  await expect(panel.getByLabel("Người lớn", { exact: true })).toHaveValue("2");
  setGraphError(false);
  await panel
    .getByRole("button", { name: "Tìm chuyến bay", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Chuyến bay", exact: true }),
  ).toBeVisible();
  expect(turns).toHaveLength(2);
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
    if (dark) {
      await page
        .getByRole("button", { name: "Chuyển sang chế độ tối", exact: true }).focus();
      await page
        .getByRole("button", { name: "Chuyển sang chế độ tối", exact: true })
        .click();
    }
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
  await page.getByRole("button", { name: "EN", exact: true }).focus();
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

test("new housing form reads the serialized current goal, not historical budget and amenities", async ({ page }) => {
  const { thread, turns } = await fixture(page, true);
  thread.state.intake = { intent: { domains: ["property"] }, constraints: { values: { city: "hcm" } }, user_confirmed_facts: {} };
  thread.state.plan.tasks = [{ id: "new-home", agent: "property", inputs: { city: "hcm" } }];
  thread.state.progress.items = [
    { task_id: "old-home", agent: "property", state: "reviewed", inputs: { city: "hanoi", max_price_vnd: 5000000, must_have: ["air_conditioning"] } },
    { task_id: "new-home", agent: "property", state: "waiting", inputs: { city: "hcm" } },
  ];
  thread.messages[0].content.response.questions = [{ field: "property.near", text: "Bạn muốn tìm gần nơi nào?" }];
  await page.goto("/ai/th_input");
  const panel = page.getByRole("region", { name: "Bổ sung thông tin dịch vụ" });
  await expect(panel.getByLabel("Thành phố", { exact: true })).toHaveValue("Thành phố Hồ Chí Minh");
  await expect(panel.locator('input[name="max"]')).toHaveValue("");
  await expect(panel.locator('input[name="amenities"]')).toHaveCount(0);
  expect(turns).toHaveLength(0);
});

for (const withPrice of [false, true]) {
  test(`housing amenities clarification remains answerable in chat (${withPrice ? "mixed form" : "chat only"})`, async ({ page }) => {
    const { thread, turns } = await fixture(page, true);
    const question = { field: "property.must_have", text: "Bạn cần những tiện nghi nào?" };
    const price = { field: "property.max_price_vnd", text: "Ngân sách tối đa của bạn?" };
    thread.state.intake = { intent: { domains: ["property"] }, constraints: { values: { city: "hanoi" } }, user_confirmed_facts: {} };
    thread.state.progress.items = [];
    thread.messages[0].content.response = {
      kind: "CLARIFY",
      text: [question.text, ...(withPrice ? [price.text] : [])].join("\n"),
      questions: [question, ...(withPrice ? [price] : [])],
    };
    await page.goto("/ai/th_input");
    await expect(page.getByText(question.text, { exact: true })).toBeVisible();
    const panel = page.getByRole("region", { name: "Bổ sung thông tin dịch vụ" });
    if (withPrice) {
      await expect(panel).toBeVisible();
      await expect(panel.locator('input[name="max"]')).toBeVisible();
      await panel.locator("form").getByRole("button", { name: "Tiếp tục bằng chat", exact: true }).click();
      await expect(page.locator(".composer textarea")).toBeFocused();
    } else {
      await expect(panel).toHaveCount(0);
    }
    expect(turns).toHaveLength(0);
    await page.locator(".composer textarea").fill("Tôi cần máy lạnh và chỗ để xe.");
    await page.locator(".composer textarea").press("Enter");
    await expect.poll(() => turns.length).toBe(1);
    expect(turns[0].message).toBe("Tôi cần máy lạnh và chỗ để xe.");
  });
}

test("explicit service navigation binds its form to the clicked task among two routes", async ({ page }) => {
  const { thread, turns } = await fixture(page, true);
  thread.state.intake = { intent: { domains: ["map"] }, constraints: { values: {} }, user_confirmed_facts: {} };
  thread.state.plan.tasks = [
    { id: "route-a", agent: "map", inputs: { city: "hanoi", route_from: "A", route_to: "B" } },
    { id: "route-b", agent: "map", inputs: { city: "hanoi", route_from: "C", route_to: "D" } },
  ];
  thread.state.progress.items = thread.state.plan.tasks.map((t: any) => ({ task_id: t.id, agent: t.agent, inputs: t.inputs, state: "waiting" }));
  thread.messages[0].content.response = { kind: "ANSWER", text: "Hai tuyến cần bổ sung thông tin.", questions: [] };
  await page.goto("/ai/th_input");
  await page.getByRole("navigation", { name: "Dịch vụ trong kế hoạch" }).getByRole("button", { name: /Đường đi/ }).nth(1).click();
  const form = page.getByRole("dialog");
  await expect(form.getByLabel("Điểm đi", { exact: true })).toHaveValue("C");
  await expect(form.getByLabel("Điểm đến", { exact: true })).toHaveValue("D");
  expect(turns).toHaveLength(0);
});
