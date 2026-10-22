import { test, expect, type Page } from "@playwright/test";

const intro = {
  display_name: "Minh",
  introduction: "Tìm người ở cùng và tôn trọng không gian riêng.",
  facts: {
    city: "hcm",
    area_ids: ["city:hcm"],
    budget: { min_vnd: 0, max_vnd: 5000000, fee_basis: "rent_only" },
    need: { kind: "looking_together" },
    move_in: { kind: "flexible" },
    self_traits: {},
  },
  preferences: {},
};

async function fixture(page: Page, mode = "success") {
  let own = mode === "private" ? null : { state: "active", version: 4 };
  let failed = false;
  const writes: {
    path: string;
    body: Record<string, unknown>;
    actor: string | undefined;
  }[] = [];
  await page.route("**/web/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/web/api", "");
    const body = request.postDataJSON();
    if (body)
      writes.push({ path, body, actor: request.headers()["x-roommate-actor"] });
    let data: unknown = {};
    if (path === "/session")
      data = {
        id: "viewer",
        name: "Minh",
        email: "minh@example.test",
        preferences: {},
      };
    else if (path === "/threads" || path === "/saved") data = [];
    else if (path === "/roommate/availability")
      data = {
        enabled: true,
        features: ["chat"],
        cities: ["hcm"],
        terms_version: "roommate-1.0",
      };
    else if (path === "/roommate/access")
      data = { eligible: true, moderator: false };
    else if (path === "/roommate/me/intro") data = intro;
    else if (path === "/roommate/me/profile")
      data = own && { ...own, content: intro };
    else if (path === "/roommate/areas/hcm")
      data = { areas: [{ area_id: "city:hcm" }] };
    else if (path === "/roommate/chat/conversations")
      data = {
        items: [
          {
            id: "connection",
            request_id: "connection",
            state: mode === "closed" ? "closed" : "active",
            counterparty_name: "Lan",
            unread: 0,
          },
        ],
        has_more: false,
      };
    else if (path === "/roommate/requests/connection")
      data = {
        available: true,
        mode: "chat",
        request_id: "connection",
        direction: "sent",
        state: "accepted",
        conversation_id: "connection",
        conversation_state: "active",
        intro,
      };
    else if (path === "/roommate/chat/conversations/connection/messages") {
      data = body
        ? {
            message: {
              id: "new",
              sender_id: "viewer",
              body: body.body,
              created_at: "2026-10-18T09:00:01Z",
            },
          }
        : {
            id: "connection",
            request_id: "connection",
            viewer_id: "viewer",
            state: mode === "closed" ? "closed" : "active",
            counterparty_name: "Lan",
            unread: 0,
            has_more: false,
            own_profile: own,
            items: [
              {
                id: "old",
                sender_id: "lan",
                body: "Chốt lịch chuyển vào nhé",
                created_at: "2026-10-18T09:00:00Z",
              },
            ],
          };
    } else if (path === "/roommate/me/profile/actions") {
      if (mode === "unknown-uncommitted" && !failed) {
        failed = true;
        return route.abort("failed");
      }
      if (mode === "conflict" && !failed) {
        failed = true;
        own = { state: "active", version: 5 };
        return route.fulfill({
          status: 409,
          json: { detail: { code: "version_conflict" } },
        });
      }
      if (!own || body.expected_version !== own.version)
        return route.fulfill({
          status: 409,
          json: { detail: { code: "version_conflict" } },
        });
      own = { state: "resolved", version: own.version + 1 };
      if (mode === "unknown" && !failed) {
        failed = true;
        return route.abort("failed");
      }
      data = { ...own, content: intro };
    }
    return route.fulfill({ json: data });
  });
  await page.goto("/roommate/requests/connection");
  await page.getByRole("button", { name: "Nhắn tin", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Nội dung tin nhắn" });
  if (mode === "closed") await expect(composer).toBeHidden();
  else await expect(composer).toBeVisible();
  return writes;
}

async function showProfileAndReopenChat(page: Page) {
  await page
    .getByRole("button", { name: "Thu gọn tin nhắn", exact: true })
    .click();
  await page.locator('a[href="/roommate?tab=profile"]').click();
  await expect(page.getByLabel("Quản lý nhu cầu công khai")).toBeVisible();
  await page.getByRole("button", { name: /^Tin nhắn và cập nhật ·/ }).click();
  await page
    .locator(".contact-messenger-conversations")
    .getByRole("button", { name: /^Lan/ })
    .click();
}

test("confirming co-living removes only own listing and preserves chat and profile status", async ({
  page,
}, testInfo) => {
  const writes = await fixture(page);
  await showProfileAndReopenChat(page);
  const ownStatus = page.getByLabel("Quản lý nhu cầu công khai");
  await expect(ownStatus.getByText("Đang tìm", { exact: true })).toBeVisible();
  const resolve = page.getByRole("button", {
    name: "Xác nhận ở cùng & gỡ tin đăng",
    exact: true,
  });
  await expect(resolve).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("before-confirm.png"),
    fullPage: true,
  });
  await resolve.click();
  await expect(
    page.getByText("Đã xác nhận và gỡ tin của bạn.", { exact: true }),
  ).toBeVisible();
  await expect(resolve).toHaveCount(0);
  await expect(
    ownStatus.getByText("Đã tìm được", { exact: true }),
  ).toBeVisible();
  expect(
    writes.filter((w) => w.path === "/roommate/me/profile/actions"),
  ).toEqual([
    {
      path: "/roommate/me/profile/actions",
      body: { action: "resolve", expected_version: 4 },
      actor: "viewer",
    },
  ]);
  await expect(
    page.getByText("Chốt lịch chuyển vào nhé", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Nội dung tin nhắn" })
    .fill("Hẹn bạn ngày mai");
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect
    .poll(() => writes.filter((w) => w.path.endsWith("/messages")).length)
    .toBe(1);
  expect(
    writes.some(
      (w) =>
        w.path.endsWith("/close") ||
        ["delete", "publish"].includes(String(w.body.action)),
    ),
  ).toBe(false);
});

test("lost resolve response is reconciled by reading status without a second write", async ({
  page,
}) => {
  const writes = await fixture(page, "unknown");
  await showProfileAndReopenChat(page);
  await expect(
    page
      .getByLabel("Quản lý nhu cầu công khai")
      .getByText("Đang tìm", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Xác nhận ở cùng & gỡ tin đăng", exact: true })
    .click();
  await expect(
    page.getByText("Đã xác nhận và gỡ tin của bạn.", { exact: true }),
  ).toBeVisible();
  expect(
    writes.filter((w) => w.path === "/roommate/me/profile/actions"),
  ).toHaveLength(1);
  await expect(
    page
      .getByLabel("Quản lý nhu cầu công khai")
      .getByText("Đã tìm được", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Nội dung tin nhắn" }),
  ).toBeEnabled();
});

test("an uncommitted uncertain action retries only the originally reviewed version", async ({
  page,
}) => {
  const writes = await fixture(page, "unknown-uncommitted");
  await page
    .getByRole("button", { name: "Xác nhận ở cùng & gỡ tin đăng", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Kiểm tra trạng thái", exact: true }),
  ).toBeVisible();
  expect(
    writes.filter((w) => w.path === "/roommate/me/profile/actions"),
  ).toHaveLength(1);
  await page
    .getByRole("button", { name: "Thử lại cùng yêu cầu", exact: true })
    .click();
  await expect(
    page.getByText("Đã xác nhận và gỡ tin của bạn.", { exact: true }),
  ).toBeVisible();
  expect(
    writes
      .filter((w) => w.path === "/roommate/me/profile/actions")
      .map((w) => w.body.expected_version),
  ).toEqual([4, 4]);
});

test("a changed profile requires another explicit click with the refreshed version", async ({
  page,
}) => {
  const writes = await fixture(page, "conflict");
  const resolve = page.getByRole("button", {
    name: "Xác nhận ở cùng & gỡ tin đăng",
    exact: true,
  });
  await resolve.click();
  await expect(page.getByRole("alert")).toContainText("Hồ sơ đã thay đổi");
  await expect(resolve).toBeEnabled();
  expect(
    writes.filter((w) => w.path === "/roommate/me/profile/actions"),
  ).toHaveLength(1);
  await resolve.click();
  await expect(
    page.getByText("Đã xác nhận và gỡ tin của bạn.", { exact: true }),
  ).toBeVisible();
  expect(
    writes
      .filter((w) => w.path === "/roommate/me/profile/actions")
      .map((w) => w.body.expected_version),
  ).toEqual([4, 5]);
});

for (const mode of ["private", "closed"]) {
  test(`no resolve action for a ${mode} conversation/profile`, async ({
    page,
  }) => {
    const writes = await fixture(page, mode);
    await expect(
      page.getByText("Chốt lịch chuyển vào nhé", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Xác nhận ở cùng & gỡ tin đăng",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      writes.filter((w) => w.path === "/roommate/me/profile/actions"),
    ).toHaveLength(0);
  });
}
