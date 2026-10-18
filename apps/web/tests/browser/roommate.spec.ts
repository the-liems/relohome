import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { waitForUiMotion } from "./helpers/ui-motion";

const facts = {
  city: "hcm",
  area_ids: ["city:hcm"],
  budget: { min_vnd: 2000000, max_vnd: 5000000, fee_basis: "rent_only" },
  need: { kind: "looking_together" },
  move_in: { kind: "flexible" },
  self_traits: {
    gender: "male",
    smoking: "non_smoker",
    has_pets: false,
    cleanliness: "daily",
    sociability: "balanced",
  },
};
const profile = {
  profile_id: "anna",
  display_name: "Anna Nguyễn",
  introduction:
    "Tìm người cùng thuê phòng, tôn trọng không gian riêng và cùng thống nhất việc dọn dẹp.",
  facts,
  avatar_id: null,
};
const intro = {
  display_name: "Minh",
  introduction: "Tôi muốn tìm người cùng thuê phòng và sinh hoạt gọn gàng.",
  facts,
  preferences: {},
};
const compatibility = {
  score: null,
  label: null,
  positives: ["areas"],
  differences: [],
  missing: ["budget", "smoking", "pets_allowed"],
};

test("compact roommate profile keeps essentials visible and optional fields private", async ({
  page,
}, info) => {
  const calls = await fixture(page);
  const minimal = {
    ...intro,
    facts: {
      ...facts,
      budget: { ...facts.budget, min_vnd: 0 },
      self_traits: {},
    },
  };
  await page.route("**/web/api/roommate/me/intro", (route) =>
    route.fulfill({ json: minimal }),
  );
  await page.goto("/roommate?tab=profile");
  const editor = page.locator(".rm-profile-editor");
  await expect(editor.getByLabel("Tên hiển thị", { exact: true })).toHaveValue(
    "Minh",
  );
  await expect(
    editor.locator("input:visible, select:visible, textarea:visible"),
  ).toHaveCount(9);
  const gender = editor.getByLabel("Giới tính của bạn", { exact: true });
  await expect(gender).toBeVisible();
  await expect(gender).toHaveAttribute("required", "");
  const nameBox = await editor
    .getByLabel("Tên hiển thị", { exact: true })
    .boundingBox();
  const introductionBox = await editor
    .getByLabel("Giới thiệu ngắn", { exact: true })
    .boundingBox();
  expect(introductionBox!.y).toBeGreaterThan(nameBox!.y + nameBox!.height);
  expect(introductionBox!.width).toBeGreaterThanOrEqual(nameBox!.width);
  await page
    .getByRole("button", { name: "Xem trước để đăng nhu cầu", exact: true })
    .click();
  await expect(gender).toBeFocused();
  expect(
    calls.filter((c) => c.path === "/roommate/me/profile/preview"),
  ).toHaveLength(0);
  await gender.selectOption("male");
  await expect(
    editor.getByLabel("Từ · VND/người/tháng", { exact: true }).first(),
  ).toBeHidden();
  await expect(
    editor.getByLabel("Bạn hút thuốc thế nào?", { exact: true }),
  ).toBeHidden();
  await expect(editor.locator(":scope > details")).toHaveCount(1);
  await expect(
    editor.getByRole("combobox", { name: "Thời điểm vào ở", exact: true }),
  ).toBeVisible();
  expect(
    await editor
      .locator("h3")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(22);
  expect(
    await editor
      .locator("textarea")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: info.outputPath("roommate-profile-compact.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Xem trước để đăng nhu cầu", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Xác nhận đăng nhu cầu", exact: true }),
  ).toBeDisabled();
  expect(
    calls.find((c) => c.path === "/roommate/me/profile/preview")?.body,
  ).toEqual({
    ...minimal,
    facts: { ...minimal.facts, self_traits: { gender: "male" } },
  });
  expect(
    calls.filter((c) => c.path === "/roommate/me/profile/actions"),
  ).toHaveLength(0);
});

test("collapsing profile extras preserves budget, false traits, hard preferences and room consent", async ({
  page,
}) => {
  const calls = await fixture(page);
  const saved = {
    ...intro,
    facts: { ...facts, need: { kind: "has_room", willing_to_move: false } },
    preferences: {
      pets_allowed: { value: false, strength: "hard" },
      budget: { value: facts.budget, strength: "soft" },
    },
    room: { listing_id: "my-room", public_location_consent: true },
  };
  await page.route("**/web/api/roommate/me/intro", (route) => {
    if (route.request().method() === "PUT")
      calls.push({
        path: "/roommate/me/intro",
        body: route.request().postDataJSON(),
      });
    return route.fulfill({ json: saved });
  });
  await page.goto("/roommate?tab=profile");
  const editor = page.locator(".rm-profile-editor");
  await expect(editor.getByLabel("Tên hiển thị", { exact: true })).toHaveValue(
    "Minh",
  );
  await editor.getByText("Thông tin bổ sung", { exact: true }).click();
  await editor.getByText("Thói quen của bạn", { exact: true }).click();
  await expect(
    editor.getByLabel("Bạn có thú cưng?", { exact: true }),
  ).toHaveValue("false");
  await editor
    .getByText("Hiện phòng trên map (tùy chọn)", { exact: true })
    .click();
  await expect(
    editor.getByLabel(/Tôi đồng ý công khai vị trí phòng này/),
  ).toBeChecked();
  await editor.getByText("Thông tin bổ sung", { exact: true }).click();
  // The existing positive minimum is initially expanded, but can be hidden safely.
  await editor.getByText("Thêm mức tối thiểu", { exact: true }).first().click();
  await expect(
    editor.getByLabel("Từ · VND/người/tháng", { exact: true }).first(),
  ).toBeHidden();
  await editor.getByLabel("Tên hiển thị", { exact: true }).fill("Minh mới");
  await page
    .getByRole("button", { name: "Lưu bản giới thiệu riêng", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Đã lưu bản giới thiệu riêng" }),
  ).toBeVisible();
  expect(calls.find((c) => c.path === "/roommate/me/intro")?.body).toEqual({
    ...saved,
    display_name: "Minh mới",
  });
  expect(
    calls.filter((c) => c.path === "/roommate/me/profile/actions"),
  ).toHaveLength(0);
});

test("native validation reveals and focuses an incomplete optional field inside collapsed sections", async ({
  page,
}) => {
  const calls = await fixture(page);
  const incomplete = {
    ...intro,
    facts: {
      ...facts,
      self_traits: { gender: "male", quiet_hours: { start: "21:00", end: "" } },
    },
  };
  await page.route("**/web/api/roommate/me/intro", (route) => {
    if (route.request().method() === "PUT")
      calls.push({
        path: "/roommate/me/intro",
        body: route.request().postDataJSON(),
      });
    return route.fulfill({ json: incomplete });
  });
  await page.goto("/roommate?tab=profile");
  const editor = page.locator(".rm-profile-editor");
  await expect(editor.getByLabel("Tên hiển thị", { exact: true })).toHaveValue(
    "Minh",
  );
  const end = editor.getByLabel("Yên tĩnh đến", { exact: true }).first();
  await expect(end).toBeHidden();
  await page
    .getByRole("button", { name: "Lưu bản giới thiệu riêng", exact: true })
    .click();
  await expect(end).toBeVisible();
  await expect(end).toBeFocused();
  expect(calls.filter((c) => c.path === "/roommate/me/intro")).toHaveLength(0);
  await end.fill("22:00");
  await editor.getByText("Thông tin bổ sung", { exact: true }).click();
  await page
    .getByRole("button", { name: "Lưu bản giới thiệu riêng", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Đã lưu bản giới thiệu riêng" }),
  ).toBeVisible();
  expect(
    calls.find((c) => c.path === "/roommate/me/intro")?.body,
  ).toMatchObject({
    facts: { self_traits: { quiet_hours: { start: "21:00", end: "22:00" } } },
  });
});

test("compact discovery preserves stored filters and clears them only on request", async ({
  page,
}) => {
  const calls = await fixture(page);
  const criteria = {
    city: "hcm",
    self_facts: facts,
    preferences: { pets_allowed: { value: false, strength: "hard" } },
  };
  await page.route("**/web/api/roommate/me/criteria", (route) =>
    route.fulfill({ json: criteria }),
  );
  await page.goto("/roommate");
  const panel = page.locator(".rm-filter-panel");
  await expect(
    page.getByRole("link", { name: "Xem hồ sơ", exact: true }),
  ).toBeVisible();
  await expect(
    panel.locator("input:visible, select:visible, textarea:visible"),
  ).toHaveCount(1);
  await expect(
    panel.getByText("1 bộ lọc đang dùng", { exact: true }),
  ).toBeVisible();
  expect(calls.find((c) => c.path === "/roommate/search")?.body).toMatchObject({
    criteria,
  });
  const refine = panel.locator("form > details > summary");
  await refine.focus();
  await page.keyboard.press("Enter");
  await panel.getByText("Lọc theo người ở cùng", { exact: true }).click();
  await panel
    .getByText("Sinh hoạt và thói quen · tùy chọn", { exact: true })
    .click();
  await expect(
    panel.getByLabel("Chấp nhận thú cưng", { exact: true }),
  ).toHaveValue("false");
  await refine.click();
  await panel
    .getByRole("button", { name: "Tìm người phù hợp", exact: true })
    .click();
  expect(
    calls.filter((c) => c.path === "/roommate/search").at(-1)?.body,
  ).toMatchObject({ criteria });
  await refine.click();
  await panel
    .getByRole("button", { name: "Bỏ bộ lọc nâng cao", exact: true })
    .click();
  await expect(
    panel.getByText("1 bộ lọc đang dùng", { exact: true }),
  ).toHaveCount(0);
  expect(
    calls.filter((c) => c.path === "/roommate/search").at(-1)?.body,
  ).toMatchObject({ criteria: { ...criteria, preferences: {} } });
});

for (const locale of ["vi", "en"] as const) {
  test(`compact profile remains readable and accessible in ${locale}`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (locale) =>
        localStorage.setItem(
          "siu-ui-preferences",
          JSON.stringify({ locale, theme: locale === "vi" ? "light" : "dark" }),
        ),
      locale,
    );
    await fixture(page);
    await page.goto("/roommate?tab=profile");
    const editor = page.locator(".rm-profile-editor");
    await expect(editor.locator("textarea")).toBeVisible();
    await editor.locator(":scope > details > summary").click();
    await editor.locator("details").evaluateAll((sections) =>
      sections.forEach((section) => {
        section.open = true;
      }),
    );
    await waitForUiMotion(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .include(".rm-profile-editor")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: info.outputPath(`roommate-profile-expanded-${locale}.png`),
      fullPage: true,
    });
  });
}
async function fixture(
  page: Page,
  settings: {
    guest?: boolean;
    enabled?: boolean;
    eligible?: boolean;
    empty?: boolean;
    unavailable?: boolean;
    chat?: boolean;
    received?: boolean;
    unknownMessage?: boolean;
    noIntro?: boolean;
    legacyDemo?: boolean;
  } = {},
) {
  const payloads: { path: string; body: Record<string, unknown> }[] = [];
  let accepted = false,
    savedIntro: typeof intro | null = settings.noIntro
      ? null
      : structuredClone(intro),
    interrupted = false;
  let accessAccepted = settings.eligible !== false;
  const messages: {
    id: string;
    body: string;
    sender_id: string;
    created_at: string;
    key: string;
  }[] = [];
  await page.route("**/web/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/web/api",
      "",
    );
    const body = route.request().postDataJSON();
    if (body) payloads.push({ path, body });
    let data: unknown = {};
    if (path === "/session") {
      if (settings.guest)
        return route.fulfill({ status: 401, json: { detail: "Sign in" } });
      data = {
        id: "viewer",
        name: "Minh",
        email: "minh@example.test",
        preferences: {},
      };
    } else if (path === "/threads" || path === "/saved") data = [];
    else if (path === "/roommate/availability")
      data = {
        enabled: settings.enabled !== false,
        demo_enabled: settings.legacyDemo === true,
        cities: ["hcm", "hanoi", "danang"],
        terms_version: "roommate-1.0",
        features: settings.chat ? ["chat"] : [],
      };
    else if (path === "/roommate/access") {
      if (body) accessAccepted = true;
      data = {
        eligible: accessAccepted,
        terms_version: "roommate-1.0",
        moderator: false,
      };
    } else if (path === "/roommate/me/criteria") data = null;
    else if (path === "/roommate/areas/hcm")
      data = { areas: [{ area_id: "city:hcm", city: "hcm" }] };
    else if (path === "/roommate/search")
      data = {
        items: settings.empty ? [] : [{ profile, compatibility }],
        total: settings.empty ? 0 : 1,
        offset: 0,
        limit: 12,
      };
    else if (path === "/roommate/profiles/anna")
      data = settings.unavailable
        ? { available: false, profile_id: "anna" }
        : { available: true, profile };
    else if (path === "/roommate/me/bookmarks") data = { items: [] };
    else if (path === "/roommate/me/blocks") data = { items: [] };
    else if (path === "/roommate/me/privacy") data = { version: null };
    else if (path === "/roommate/me/intro") {
      if (body) savedIntro = body;
      data = savedIntro;
    } else if (path === "/roommate/me/profile") data = null;
    else if (path === "/roommate/me/profile/preview")
      data = { ...intro, profile_id: "viewer" };
    else if (path === "/roommate/me/contacts")
      data = {
        channels: [
          {
            channel_id: "phone1",
            version: 1,
            kind: "phone",
            value: "0901234567",
          },
        ],
      };
    else if (path === "/roommate/requests")
      data = { request_id: "request-one", direction: "sent" };
    else if (path === "/roommate/requests/request-one")
      data = {
        ...(settings.chat
          ? {
              mode: "chat",
              conversation_id: accepted ? "request-one" : null,
              conversation_state: accepted ? "active" : null,
              counterparty_id: "anna",
            }
          : {}),
        request_id: "request-one",
        direction: settings.received ? "received" : "sent",
        state: accepted ? "accepted" : "pending",
        available: true,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 604800000).toISOString(),
        grant_state: null,
        grant_expires_at: null,
        intro: { ...intro, reviewed_at: new Date().toISOString() },
        actions: accepted
          ? []
          : settings.received
            ? ["accept", "reject"]
            : ["withdraw"],
      };
    else if (path === "/roommate/chat/requests")
      data = {
        request_id: "request-one",
        direction: "sent",
        conversation_id: null,
      };
    else if (path === "/roommate/chat/requests/request-one/accept") {
      accepted = true;
      data = {
        request_id: "request-one",
        conversation_id: "request-one",
        state: "accepted",
      };
    } else if (path === "/roommate/chat/conversations")
      data = {
        items: accepted
          ? [
              {
                id: "request-one",
                request_id: "request-one",
                state: "active",
                counterparty_name: "Anna Nguyễn",
                unread: 0,
                updated_at: 1,
              },
            ]
          : [],
        has_more: false,
      };
    else if (path === "/roommate/chat/conversations/request-one/messages") {
      if (body) {
        let message = messages.find(
          (message) => message.key === body.client_message_id,
        );
        if (!message) {
          message = {
            id: "message-" + messages.length,
            body: body.body,
            sender_id: "viewer",
            created_at: new Date().toISOString(),
            key: body.client_message_id,
          };
          messages.push(message);
        }
        if (settings.unknownMessage && !interrupted) {
          interrupted = true;
          return route.abort("failed");
        }
        data = { message };
      } else
        data = {
          id: "request-one",
          request_id: "request-one",
          state: "active",
          counterparty_name: "Anna Nguyễn",
          viewer_id: "viewer",
          items: messages,
          has_more: false,
        };
    }
    await route.fulfill({ json: data });
  });
  return payloads;
}

for (const url of ["/roommate", "/roommate?tab=demo"]) {
  test(`only user profiles are shown at ${url}, even with legacy demo availability`, async ({
    page,
  }) => {
    const calls = await fixture(page, {
      chat: true,
      empty: true,
      legacyDemo: true,
    });
    await page.goto(url);
    await expect(page.locator(".rm-quick-search")).toBeVisible();
    await expect(
      page
        .locator(".rm-empty-actions")
        .getByRole("link", { name: "Đăng nhu cầu của tôi" }),
    ).toBeVisible();
    await expect(page.locator(".rm-source-switch")).toHaveCount(0);
    await expect(page.getByText(/DEMO/)).toHaveCount(0);
    expect(calls.some((call) => call.path.includes("/demo/"))).toBe(false);
  });
}

test("chat connection reuses intro without contact and survives browser focus", async ({
  page,
}) => {
  const calls = await fixture(page, { chat: true });
  await page.goto("/roommate/profiles/anna");
  await page
    .getByRole("button", { name: "Gửi yêu cầu kết nối", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Gửi yêu cầu kết nối" });
  await expect(dialog.getByText("Minh", { exact: true })).toBeVisible();
  await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Gửi yêu cầu kết nối", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Chờ phản hồi" }),
  ).toBeVisible();
  const sent = calls.find(
    (call) => call.path === "/roommate/chat/requests",
  )!.body;
  expect(sent.intro).toEqual(intro);
  expect(sent).not.toHaveProperty("contact");
  expect(sent).not.toHaveProperty("consent");
  expect(
    calls.filter((call) => call.path === "/roommate/requests"),
  ).toHaveLength(0);
});

test("a saved intro without gender must be completed before sending a chat request", async ({
  page,
}) => {
  const calls = await fixture(page, { chat: true });
  await page.route("**/web/api/roommate/me/intro", (route) =>
    route.fulfill({
      json: {
        ...intro,
        facts: {
          ...facts,
          self_traits: { ...facts.self_traits, gender: null },
        },
      },
    }),
  );
  await page.goto("/roommate/profiles/anna");
  await page
    .getByRole("button", { name: "Gửi yêu cầu kết nối", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Gửi yêu cầu kết nối" });
  const gender = dialog.getByLabel("Giới tính của bạn", { exact: true });
  await expect(gender).toBeVisible();
  await dialog
    .getByRole("button", { name: "Gửi yêu cầu kết nối", exact: true })
    .click();
  await expect(gender).toBeFocused();
  expect(
    calls.filter((call) => call.path === "/roommate/chat/requests"),
  ).toHaveLength(0);
  await gender.selectOption("other");
  await dialog
    .getByRole("button", { name: "Gửi yêu cầu kết nối", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Chờ phản hồi" }),
  ).toBeVisible();
  expect(
    calls.find((call) => call.path === "/roommate/chat/requests")?.body,
  ).toMatchObject({
    intro: { facts: { self_traits: { gender: "other" } } },
  });
});

test("accept opens in-app chat and ambiguous retry keeps the same message ID", async ({
  page,
}) => {
  const calls = await fixture(page, {
    chat: true,
    received: true,
    unknownMessage: true,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/roommate/requests/request-one");
  await page
    .getByRole("button", { name: "Đồng ý kết nối", exact: true })
    .click();
  const input = page.getByRole("textbox", { name: "Nội dung tin nhắn" });
  await expect(input).toBeVisible();
  const body = "Hello <script>alert(1)</script>";
  await input.fill(body);
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await page.getByRole("button", { name: "Thử lại cùng tin nhắn" }).click();
  await expect(
    page.locator(".contact-thread-list p").filter({ hasText: body }),
  ).toHaveCount(1);
  const sent = calls.filter((call) => call.path.endsWith("/messages"));
  expect(sent).toHaveLength(2);
  expect(sent[0].body.client_message_id).toEqual(
    sent[1].body.client_message_id,
  );
  expect(errors).toEqual([]);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
});

for (const initialCount of [60, 90]) {
  for (const update of [
    "send",
    "poll",
    ...(initialCount === 60 ? ["poll-gap"] : []),
  ]) {
    test(`chat history retains cursor boundaries after ${update} with ${initialCount} messages`, async ({
      page,
    }) => {
      await page.clock.install();
      await fixture(page, { chat: true, received: true });
      const message = (number: number, sender = "anna") => ({
        id: `history-${String(number).padStart(4, "0")}`,
        sender_id: sender,
        body: `Synthetic history ${number}`,
        created_at: new Date(Date.UTC(2026, 9, 17, 8, 0, number)).toISOString(),
      });
      const messages = Array.from({ length: initialCount }, (_, index) =>
        message(index + 1),
      );
      await page.route(
        "**/web/api/roommate/chat/conversations/request-one/messages**",
        async (route) => {
          if (route.request().method() === "POST") {
            const next = message(messages.length + 1, "viewer");
            next.body = route.request().postDataJSON().body;
            messages.push(next);
            return route.fulfill({ json: { message: next } });
          }
          const before = new URL(route.request().url()).searchParams.get(
            "before",
          );
          const end = before
            ? messages.findIndex((item) => item.id === before)
            : messages.length;
          const start = Math.max(0, end - 30);
          return route.fulfill({
            json: {
              id: "request-one",
              request_id: "request-one",
              state: "active",
              counterparty_name: "Anna Nguyễn",
              viewer_id: "viewer",
              items: messages.slice(start, end),
              has_more: start > 0,
            },
          });
        },
      );
      await page.goto("/roommate/requests/request-one");
      await page
        .getByRole("button", { name: "Đồng ý kết nối", exact: true })
        .click();
      const list = page.locator(".contact-thread-list");
      await expect(list.locator("li")).toHaveCount(30);
      const previous = page.getByRole("button", {
        name: "Tin nhắn trước",
        exact: true,
      });
      await previous.click();
      await expect(list.locator("li")).toHaveCount(60);
      if (update === "send") {
        await page
          .getByRole("textbox", { name: "Nội dung tin nhắn" })
          .fill(message(initialCount + 1).body);
        await page.getByRole("button", { name: "Gửi", exact: true }).click();
      } else {
        const extra = update === "poll-gap" ? 31 : 1;
        for (let i = 0; i < extra; i++)
          messages.push(message(messages.length + 1));
        await page.clock.fastForward(15_001);
      }
      const visibleCount = 60 + messages.length - initialCount;
      await expect(list.locator("li")).toHaveCount(visibleCount);
      await expect(list.locator("li p")).toHaveText(
        messages.slice(initialCount - 60).map((item) => item.body),
      );
      await page.clock.fastForward(15_001);
      await expect(list.locator("li")).toHaveCount(visibleCount);
      if (initialCount === 90) {
        await expect(previous).toBeVisible();
        await previous.click();
        await expect(list.locator("li p")).toHaveText(
          messages.map((item) => item.body),
        );
      }
      await expect(previous).toHaveCount(0);
    });
  }
}

test("delayed history cannot reopen a connection closed by a newer refresh", async ({
  page,
}) => {
  await page.clock.install();
  await fixture(page, { chat: true, received: true });
  const messages = Array.from({ length: 60 }, (_, index) => ({
    id: `delayed-${String(index).padStart(3, "0")}`,
    sender_id: "anna",
    body: `Earlier message ${index}`,
    created_at: new Date(Date.UTC(2026, 9, 17, 8, 0, index)).toISOString(),
  }));
  let closed = false;
  let releaseOlder!: () => void;
  const olderReady = new Promise<void>((resolve) => {
    releaseOlder = resolve;
  });
  await page.route(
    "**/web/api/roommate/chat/conversations/request-one/messages**",
    async (route) => {
      const older = new URL(route.request().url()).searchParams.has("before");
      const response = {
        id: "request-one",
        request_id: "request-one",
        state: closed ? "closed" : "active",
        counterparty_name: "Anna Nguyễn",
        viewer_id: "viewer",
        items: older ? messages.slice(0, 30) : messages.slice(30),
        has_more: !older,
      };
      if (older) await olderReady;
      return route.fulfill({ json: response });
    },
  );
  await page.goto("/roommate/requests/request-one");
  await page
    .getByRole("button", { name: "Đồng ý kết nối", exact: true })
    .click();
  const list = page.locator(".contact-thread-list");
  await expect(list.locator("li")).toHaveCount(30);
  const requested = page.waitForRequest((request) =>
    request.url().includes("/messages?before="),
  );
  await page
    .getByRole("button", { name: "Tin nhắn trước", exact: true })
    .click();
  await requested;
  closed = true;
  await page.clock.fastForward(15_001);
  const notice = page.getByText(
    "Kết nối đã dừng. Bạn vẫn có thể xem lịch sử còn được phép.",
    { exact: true },
  );
  await expect(notice).toBeVisible();
  releaseOlder();
  await expect(list.locator("li")).toHaveCount(60);
  await expect(notice).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Nội dung tin nhắn", exact: true }),
  ).toHaveCount(0);
});

test("account introduction updates the same roommate source without publishing", async ({
  page,
}) => {
  const calls = await fixture(page, { chat: true });
  await page.goto("/account");
  await page.getByRole("tab", { name: "Hồ sơ & bảo mật", exact: true }).click();
  const panel = page.locator(".account-roommate-intro");
  await panel.getByRole("button", { name: "Chỉnh sửa bản giới thiệu" }).click();
  await panel
    .getByLabel("Giới thiệu ngắn")
    .fill("Tôi muốn cùng thuê một căn nhà gọn gàng.");
  await panel
    .getByRole("button", { name: "Lưu bản giới thiệu", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("Đã lưu");
  await page.goto("/roommate/profiles/anna");
  await page
    .getByRole("button", { name: "Gửi yêu cầu kết nối", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Tôi muốn cùng thuê một căn nhà gọn gàng."),
  ).toBeVisible();
  expect(
    calls.filter((call) => call.path === "/roommate/me/profile/actions"),
  ).toHaveLength(0);
});
test("account gates intro access, suggests account name and keeps dirty edits on refresh", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/roommate/me/intro"))
      calls.push(request.method());
  });
  await fixture(page, { chat: true, eligible: false, noIntro: true });
  await page.goto("/account");
  await page.getByRole("tab", { name: "Hồ sơ & bảo mật", exact: true }).click();
  const panel = page.locator(".account-roommate-intro");
  await expect(
    panel.getByText("Không gian tìm người ở cùng", { exact: true }),
  ).toBeVisible();
  expect(calls).toEqual([]);
  await panel.getByLabel("Tôi xác nhận mình từ 18 tuổi.").check();
  await panel.getByLabel(/Tôi đồng ý quy tắc sử dụng/).check();
  await panel.getByRole("button", { name: "Xác nhận và tiếp tục" }).click();
  await expect(panel.getByLabel("Tên hiển thị", { exact: true })).toHaveValue(
    "Minh",
  );
  const introduction = panel.getByLabel("Giới thiệu ngắn");
  await introduction.fill("Bản đang sửa chưa lưu.");
  await page.evaluate(() =>
    window.dispatchEvent(new Event("roommate-intro-changed")),
  );
  await expect.poll(() => calls.length).toBeGreaterThan(1);
  await expect(introduction).toHaveValue("Bản đang sửa chưa lưu.");
  expect(calls).not.toContain("PUT");
});

for (const theme of ["light", "dark"] as const) {
  const locale = theme === "light" ? "vi" : "en";
  test(`roommate chat is accessible in ${theme}/${locale}`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      ({ theme, locale }) => {
        localStorage.setItem(
          "siu-ui-preferences",
          JSON.stringify({ theme, locale }),
        );
      },
      { theme, locale },
    );
    await fixture(page, { chat: true, received: true });
    await page.goto("/roommate/requests/request-one");
    await page
      .getByRole("button", {
        name: locale === "vi" ? "Đồng ý kết nối" : "Accept connection",
        exact: true,
      })
      .click();
    const panel = page.locator(".contact-messenger-panel");
    await expect(panel.locator("textarea")).toBeVisible();
    await panel
      .locator("textarea")
      .fill(locale === "vi" ? "Chào bạn!" : "Hello!");
    await waitForUiMotion(page);
    const audit = await new AxeBuilder({ page })
      .include(".contact-messenger-panel")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
    await panel.screenshot({
      path: info.outputPath(`roommate-chat-${theme}-${locale}.png`),
    });
  });
}

test("failed saved criteria never silently falls back to weaker intro defaults", async ({
  page,
}) => {
  const calls = await fixture(page, { chat: true });
  await page.route("**/web/api/roommate/me/criteria", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: { code: "service_unavailable" } },
    }),
  );
  await page.goto("/roommate");
  await expect(page.getByRole("alert")).toContainText(
    "Chưa kết nối được dịch vụ",
  );
  expect(calls.filter((call) => call.path === "/roommate/search")).toHaveLength(
    0,
  );
});

test("privacy export offers explicit downloads for remaining message pages", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await fixture(page, { chat: true });
  await page.route("**/web/api/roommate/availability", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        cities: ["hcm"],
        terms_version: "roommate-1.0",
        features: ["chat", "privacy"],
      },
    }),
  );
  await page.route("**/web/api/roommate/me/privacy/export", (route) =>
    route.fulfill({
      json: {
        chat_messages: [{ id: "own-message", body: "Synthetic own message" }],
        chat_messages_next: "next-own-message",
      },
    }),
  );
  await page.route(
    "**/web/api/roommate/me/privacy/chat-messages?before=next-own-message",
    (route) =>
      route.fulfill({
        json: {
          chat_messages: [
            {
              id: "earlier-own-message",
              body: "Synthetic earlier own message",
            },
          ],
          chat_messages_next: null,
        },
      }),
  );
  await page.goto("/roommate?tab=settings");
  const firstDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải thông tin của tôi" }).click();
  expect((await firstDownload).suggestedFilename()).toBe(
    "relohome-roommate-data.json",
  );
  const more = page.getByRole("button", { name: "Tải tiếp tin nhắn của tôi" });
  await expect(more).toBeVisible();
  const nextDownload = page.waitForEvent("download");
  await more.click();
  expect((await nextDownload).suggestedFilename()).toBe(
    "relohome-roommate-messages-2.json",
  );
  await expect(more).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("roommate guest, disabled and explicit age/terms gates", async ({
  page,
}) => {
  await fixture(page, { guest: true });
  await page.goto("/roommate/profiles/anna");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Tìm người",
  );
  await expect(page.getByText("Anna Nguyễn")).toHaveCount(0);
  await page.unrouteAll();
  await fixture(page, { enabled: false });
  await page.goto("/roommate");
  await expect(page.getByText("Roommate chưa được bật")).toBeVisible();
  await page.unrouteAll();
  const calls = await fixture(page, { eligible: false });
  await page.goto("/roommate");
  const continueButton = page.getByRole("button", {
    name: "Xác nhận và tiếp tục",
  });
  await expect(continueButton).toBeDisabled();
  await page.getByLabel("Tôi xác nhận mình từ 18 tuổi.").check();
  await page.getByLabel(/Tôi đồng ý quy tắc sử dụng/).check();
  await continueButton.click();
  expect(calls.find((c) => c.path === "/roommate/access")?.body).toEqual({
    adult: true,
    terms_version: "roommate-1.0",
  });
});
test("search, missing score, fresh detail and reviewed contact consent preserve payload", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.goto("/roommate");
  await page.getByRole("button", { name: "Tìm người phù hợp" }).click();
  await expect(page.getByText("Chưa đủ dữ liệu để chấm điểm")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("/100", { exact: false })).toHaveCount(0);
  await page.getByRole("link", { name: "Xem hồ sơ" }).click();
  await page.getByRole("button", { name: "Gửi yêu cầu kết nối" }).click();
  await page.getByRole("button", { name: "Xem lại trước khi gửi" }).click();
  const dialog = page.getByRole("dialog"),
    send = dialog.getByRole("button", { name: "Gửi yêu cầu", exact: true });
  await expect(send).toBeDisabled();
  await dialog.getByLabel(/Điện thoại: 0901234567/).check();
  await expect(send).toBeDisabled();
  await dialog.getByLabel(/Tôi đã xem lại bản giới thiệu/).check();
  await send.click();
  await expect(page).toHaveURL(/requests\/request-one/);
  const body = calls.find((c) => c.path === "/roommate/requests")!.body;
  expect(body).toMatchObject({
    recipient_id: "anna",
    consent: true,
    contact: { channel_id: "phone1", version: 1 },
    intro,
  });
  expect(body).not.toHaveProperty("actor_id");
  expect(typeof body.operation_key).toBe("string");
  expect(JSON.stringify(body)).not.toContain("0901234567");
});
test("responsive, keyboard and accessibility in both themes/languages with clean console", async ({
  page,
}, info) => {
  await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      errors.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/roommate");
    await page.getByRole("button", { name: "Tìm người phù hợp" }).click();
    await expect(page.getByRole("link", { name: "Xem hồ sơ" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Find a roommate", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Switch to dark|Chuyển sang tối/ })
    .click();
  const dark = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(dark.violations.map((v) => v.id)).toEqual([]);
  await page.screenshot({
    path: info.outputPath("roommate-dark-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "View profile", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "Send a connection request", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Send a connection request",
      exact: true,
    }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});
test("empty, stale profile and read error stay actionable", async ({
  page,
}) => {
  await fixture(page, { empty: true, unavailable: true });
  await page.goto("/roommate");
  await page.getByRole("button", { name: "Tìm người phù hợp" }).click();
  await expect(page.getByText("Chưa tìm thấy hồ sơ phù hợp")).toBeVisible();
  await page.goto("/roommate/profiles/anna");
  await expect(page.getByText("Hồ sơ không còn khả dụng")).toBeVisible();
  await expect(page.getByText("Anna Nguyễn")).toHaveCount(0);
  await page.route("**/web/api/roommate/availability", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: { code: "service_unavailable" } },
    }),
  );
  await page.goto("/roommate");
  await expect(page.getByRole("alert")).toContainText(
    "Chưa kết nối được dịch vụ",
  );
  await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
});
test("unknown write outcome is reconciled without sending a second connection", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.route("**/web/api/roommate/requests", async (route) => {
    calls.push({
      path: "/roommate/requests",
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      status: 503,
      json: { detail: { code: "operation_unknown" } },
    });
  });
  await page.route("**/web/api/roommate/operations/*", (route) =>
    route.fulfill({
      json: {
        status: "completed",
        result: { request_id: "request-one", direction: "sent" },
      },
    }),
  );
  await page.goto("/roommate/profiles/anna");
  await page
    .getByRole("button", { name: "Gửi yêu cầu kết nối", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Xem lại trước khi gửi", exact: true })
    .click();
  await page.getByLabel(/Điện thoại: 0901234567/).check();
  await page.getByLabel(/Tôi đã xem lại bản giới thiệu/).check();
  const send = page.getByRole("button", { name: "Gửi yêu cầu", exact: true });
  await send.click();
  await expect(send).toBeDisabled();
  await page
    .getByRole("button", { name: "Kiểm tra trạng thái", exact: true })
    .click();
  await expect(page).toHaveURL(/requests\/request-one/);
  expect(calls.filter((c) => c.path === "/roommate/requests")).toHaveLength(1);
});

for (const state of ["unread", "earlier", "seen", "replied"] as const) {
  test(`roommate read receipt follows the exact last unanswered message: ${state}`, async ({
    page,
  }) => {
    await fixture(page, { chat: true, received: true });
    const messages = [
      {
        id: "earlier",
        sender_id: "viewer",
        body: "Chào bạn.",
        created_at: "2026-10-17T01:00:00.000001Z",
      },
      {
        id: "last",
        sender_id: "viewer",
        body: "Mình đã gửi thông tin.",
        created_at: "2026-10-17T01:00:00.000002Z",
      },
      ...(state === "replied"
        ? [
            {
              id: "reply",
              sender_id: "anna",
              body: "Mình nhận được rồi.",
              created_at: "2026-10-17T01:01:00Z",
            },
          ]
        : []),
    ];
    await page.route(
      "**/roommate/chat/conversations/request-one/messages",
      (route) =>
        route.fulfill({
          json: {
            id: "request-one",
            request_id: "request-one",
            state: "active",
            counterparty_name: "Anna Nguyễn",
            viewer_id: "viewer",
            items: messages,
            has_more: false,
            ...(state === "unread"
              ? {}
              : {
                  counterparty_read_message_id:
                    state === "earlier" ? "earlier" : "last",
                }),
          },
        }),
    );
    await page.goto("/roommate/requests/request-one");
    await page
      .getByRole("button", { name: "Đồng ý kết nối", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Nội dung tin nhắn" }),
    ).toBeVisible();
    await expect(page.locator(".contact-thread-seen")).toHaveCount(
      state === "seen" ? 1 : 0,
    );
    if (state === "seen")
      await expect(
        page.locator(".contact-thread-list li.mine").last(),
      ).toContainText("Đã xem");
  });
}
