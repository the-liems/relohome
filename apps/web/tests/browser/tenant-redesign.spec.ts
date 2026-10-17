import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, status = "agreed", payment?: string) {
  const item: any = {
    listing_id: "canvas-home",
    title: "Căn hộ Hòa Khánh",
    status,
    snapshot: { address: "Đà Nẵng", price_vnd: 5_000_000 },
    viewing: { slot: "2026-10-10T09:00:00+07:00" },
    agreement:
      status === "agreed" || status === "reported_paid"
        ? {
            deposit_vnd: 5_000_000,
            first_month_vnd: 5_000_000,
            move_in: "2026-11-01",
          }
        : undefined,
    landlord: {
      request_id: "request-1",
      request_status: "viewing",
      viewing_status: "confirmed",
    },
  };
  if (payment) {
    item.status = "reported_paid";
    item.reported_payment = { amount_vnd: 10_000_000, paid_on: "2026-10-15" };
    item.payment_report = {
      status: payment,
      ...(payment === "rejected"
        ? { reason: "Tôi chưa nhận được khoản tiền này." }
        : {}),
    };
  }
  const viewing: any = { items: [item], max_selected: 3, slots: [] };
  const thread = {
    id: "tenant-design",
    title: "Kế hoạch thuê nhà",
    messages: [],
    runs: [],
    state: {
      plan: { version: 1, tasks: [] },
      intake: { user_confirmed_facts: {} },
      viewing,
    },
  };
  const calls: { path: string; body: any }[] = [];
  await page.route("**/web/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace("/web/api", "");
    let body: any = {};
    if (req.method() === "POST") calls.push({ path, body: req.postDataJSON() });
    if (path === "/session")
      body = {
        id: "tenant",
        name: "An",
        email: "an@example.test",
        preferences: {},
      };
    else if (path === "/status")
      body = { domains: ["property", "flight", "relocation", "map"] };
    else if (path === "/profile/traveler") body = { traveler: null };
    else if (["/threads", "/saved"].includes(path)) body = [];
    else if (path === "/threads/tenant-design") body = thread;
    else if (path.endsWith("/viewings")) body = viewing;
    else if (path.endsWith("/viewings/paid")) {
      item.reported_payment = req.postDataJSON();
      item.payment_report = { status: "pending" };
      item.status = "reported_paid";
      body = viewing;
    } else if (path.endsWith("/viewings/reopen")) {
      item.status = "selected";
      delete item.agreement;
      body = viewing;
    }
    return route.fulfill({ json: body });
  });
  return { calls, item, viewing };
}

test("payment notice disappears after reporting; both actions require confirmation", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/ai/tenant-design?panel=plan&planTab=viewing");
  const card = page.locator(".viewing-item");
  await expect(card.locator(".viewing-payment-due")).toContainText(
    "Cần trả chủ nhà",
  );
  await expect(card.getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator(".bulk-footer")).toHaveCount(0);
  await card
    .getByRole("button", { name: "Báo đã trả chủ nhà", exact: true })
    .click();
  await card.getByLabel("Ngày trả", { exact: true }).fill("2026-10-15");
  await card.getByRole("button", { name: "Xác nhận", exact: true }).click();
  let dialog = page.getByRole("dialog", {
    name: "Bạn có chắc chắn xác nhận đã chuyển tiền?",
  });
  await expect(dialog).toBeVisible();
  expect(f.calls.some((c) => c.path.endsWith("/paid"))).toBe(false);
  await dialog.getByRole("button", { name: "Quay lại", exact: true }).click();
  await expect(card.getByLabel("Ngày trả", { exact: true })).toHaveValue(
    "2026-10-15",
  );
  await card
    .getByRole("button", { name: "Thỏa thuận không thành", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Bạn có chắc chắn thỏa thuận không thành?",
  });
  await expect(dialog).toBeVisible();
  expect(f.calls.some((c) => c.path.endsWith("/reopen"))).toBe(false);
  await dialog.getByRole("button", { name: "Quay lại", exact: true }).click();
  await card.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Đồng ý", exact: true })
    .click();
  await expect(card.locator(".viewing-payment-due")).toHaveCount(0);
  await expect(card.locator(".viewing-status")).toHaveClass(/pending/);
  await expect(card.locator(".viewing-preparation")).toHaveClass(/settled/);
  expect(f.calls.filter((c) => c.path.endsWith("/paid"))).toHaveLength(1);
});

test("falling-through confirmation performs the reopen only after agreement", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/ai/tenant-design?panel=plan&planTab=viewing");
  await page
    .getByRole("button", { name: "Báo đã trả chủ nhà", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Thỏa thuận không thành", exact: true })
    .click();
  expect(f.calls.some((c) => c.path.endsWith("/reopen"))).toBe(false);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Đồng ý", exact: true })
    .click();
  await expect
    .poll(() => f.calls.filter((c) => c.path.endsWith("/reopen")).length)
    .toBe(1);
});

for (const theme of ["light", "dark"])
  for (const payment of [undefined, "pending", "rejected", "confirmed"]) {
    test(`payment card ${payment || "unpaid"}, ${theme}`, async ({
      page,
    }, info) => {
      await page.emulateMedia({
        colorScheme: theme as "light" | "dark",
        reducedMotion: "reduce",
      });
      await fixture(page, "agreed", payment);
      await page.goto("/ai/tenant-design?panel=plan&planTab=viewing");
      const card = page.locator(".viewing-item");
      await expect(card).toBeVisible();
      await expect(card.locator(".viewing-payment-due")).toHaveCount(
        payment ? 0 : 1,
      );
      await expect(card.getByRole("checkbox")).toHaveCount(0);
      await expect(page.getByRole("tab")).toHaveCount(4);
      if (payment === "rejected") {
        await expect(card.locator(".viewing-landlord-note")).toContainText(
          "Chủ nhà nhắn",
        );
        await expect(
          card.getByRole("button", { name: "Phản hồi lại", exact: true }),
        ).toBeVisible();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: info.outputPath(`payment-${payment || "unpaid"}-${theme}.png`),
      });
    });
  }

test("after viewing hides selection and preparation; account has four tabs and merged security", async ({
  page,
}, info) => {
  await fixture(page, "visit_due");
  await page.goto("/ai/tenant-design?panel=plan&planTab=viewing");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.locator(".bulk-footer, .bulk-selection-tools, .viewing-preparation"),
  ).toHaveCount(0);
  await page.goto("/account?tab=security");
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(
    page.getByRole("tab", { name: "Hồ sơ & bảo mật" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Xóa dữ liệu trò chuyện", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Email đăng nhập", { exact: true })).toHaveCount(
    1,
  );
  await page.screenshot({
    path: info.outputPath("account-profile.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Sở thích AI" }).click();
  await expect(
    page.getByLabel("Tiện nghi quan tâm", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("header reveals on hover or keyboard focus and stays visible on touch devices", async ({
  page,
}, info) => {
  await fixture(page);
  await page.goto("/ai");
  const header = page.locator(".header-reveal .chat-header");
  if (info.project.name === "mobile")
    await expect(header).toHaveCSS("opacity", "1");
  else {
    await page.mouse.move(500, 400);
    await expect(header).toHaveCSS("opacity", "0");
    await page.mouse.move(200, 2);
    await expect(header).toHaveCSS("opacity", "1");
    await page.mouse.move(500, 400);
    await expect(header).toHaveCSS("opacity", "0");
    await header.getByRole("link", { name: "Mở tài khoản" }).focus();
    await expect(header).toHaveCSS("opacity", "1");
  }
  await expect(header).toHaveCSS("backdrop-filter", "blur(18px) saturate(1.5)");
});

for (const read of [false, true])
  test(`last unanswered tenant message seen=${read}`, async ({ page }) => {
    await fixture(page);
    await page.route(
      "**/housing/contact-requests/request-1/messages",
      (route) =>
        route.fulfill({
          json: {
            role: "tenant",
            viewer_id: "tenant",
            counterparty_read_at: read ? "2026-10-15T11:00:00Z" : null,
            request: {
              id: "request-1",
              title: "Căn hộ Hòa Khánh",
              tenant_user_id: "tenant",
              message: "Tôi quan tâm căn này.",
              status: "new",
              open: true,
              revision: 1,
              created_at: "2026-10-15T09:00:00Z",
            },
            messages: [
              {
                id: "last",
                sender_role: "tenant",
                sender_user_id: "tenant",
                body: "Tôi đã gửi thông tin.",
                created_at: "2026-10-15T10:00:00Z",
              },
            ],
          },
        }),
    );
    await page.goto("/ai/tenant-design?panel=plan&planTab=viewing");
    await page
      .getByRole("button", { name: "Nhắn chủ nhà", exact: true })
      .click();
    await expect(page.locator(".contact-thread-seen")).toHaveCount(
      read ? 1 : 0,
    );
    await expect(
      page.getByRole("button", { name: "Hủy yêu cầu", exact: true }),
    ).toBeVisible();
  });

test("review button is locked until the API permits it and move-in includes service fees", async ({
  page,
}, info) => {
  await fixture(page);
  const house = {
    id: "review-home",
    title: "Căn kiểm tra chi phí",
    address: "Đà Nẵng",
    price_vnd: 8_500_000,
    deposit_vnd: 8_500_000,
    fees: [
      {
        code: "service",
        label: "Phí dịch vụ",
        amount: 100_000,
        billing_unit: "month",
        required: true,
      },
    ],
    management: {
      accepts_contact_requests: true,
      poster_type: "owner",
      poster_name: "Cô Mai",
      host_verified: true,
    },
  };
  await page.route("**/web/api/saved", (route) =>
    route.fulfill({ json: [{ id: house.id, house, thread_id: "" }] }),
  );
  await page.route("**/web/api/housing/review-home", (route) =>
    route.fulfill({ json: house }),
  );
  await page.route("**/housing/review-home/reviews**", (route) =>
    route.fulfill({
      json: {
        items: [],
        mine: null,
        can_review: false,
        summary: { count: 0, property_count: 0, rating: null, histogram: {} },
      },
    }),
  );
  await page.route("**/housing/contact-requests/me", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.goto("/account?tab=saved");
  await page.locator(".title-button").click();
  const detail = page.getByRole("dialog", { name: "Chi tiết nhà" });
  await expect(
    detail.getByRole("button", { name: "Viết đánh giá", exact: true }),
  ).toBeDisabled();
  await expect(detail.locator(".review-locked")).toContainText(
    "Chỉ viết đánh giá sau khi bạn đã hẹn xem lịch và gặp chủ nhà.",
  );
  await expect(
    detail
      .locator(".housing-cost-summary > div")
      .filter({ hasText: "Cần chuẩn bị khi vào ở" }),
  ).toContainText("17.100.000");
  await expect(detail).not.toContainText("Giá thuê / m²");
  await page.screenshot({
    path: info.outputPath("housing-detail.png"),
    fullPage: true,
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`account canvas tabs and header spacing in ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await fixture(page);
    const history = {
      id: "history-thread",
      title: "Tìm căn hộ",
      updated: Date.now() / 1000,
      revision: 1,
      runs: [],
      state: {},
      messages: Array.from({ length: 3 }, (_, index) => [
        {
          id: `u-${index}`,
          role: "user",
          created: Date.now() / 1000 - index * 60,
          content: { text: `Yêu cầu tìm nhà ${index + 1}` },
        },
        {
          id: `a-${index}`,
          role: "assistant",
          created: Date.now() / 1000 - index * 60 + 1,
          content: {
            response: { kind: "ANSWER", text: "Đã tìm được phương án." },
          },
        },
      ]).flat(),
    };
    await page.route("**/web/api/threads", (route) =>
      route.fulfill({ json: [history] }),
    );
    await page.route("**/web/api/threads/history-thread", (route) =>
      route.fulfill({ json: history }),
    );
    await page.route("**/web/api/profile/traveler", (route) =>
      route.fulfill({ json: { traveler: null } }),
    );
    await page.route("**/web/api/saved", (route) =>
      route.fulfill({
        json: [1, 2].map((n) => ({
          id: `saved-${n}`,
          thread_id: "",
          house: {
            id: `saved-${n}`,
            title: `Căn hộ đã lưu ${n}`,
            address: "Đà Nẵng",
            price_vnd: 5_000_000,
          },
        })),
      }),
    );
    await page.goto("/account?tab=profile");
    const header = page.locator(".header-reveal .chat-header");
    await header
      .getByRole("link", { name: "Mở tài khoản", exact: true })
      .focus();
    await expect(header).toHaveCSS("opacity", "1");
    const title = page.getByRole("heading", {
      name: "Tài khoản của tôi",
      exact: true,
    });
    expect((await title.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await header.boundingBox())!.height,
    );
    await expect(
      page.getByRole("heading", { name: "Người đặt vé máy bay", exact: true }),
    ).toBeVisible();
    for (const [tab, label] of [
      ["profile", "Hồ sơ & bảo mật"],
      ["preferences", "Sở thích AI"],
      ["history", "Lịch sử yêu cầu"],
      ["saved", "Đã lưu"],
    ]) {
      await page.getByRole("tab", { name: new RegExp(label) }).click();
      if (tab === "history")
        await expect(page.locator(".request-history-card")).toHaveCount(3);
      if (tab === "saved")
        await expect(page.locator(".saved-grid .housing-card")).toHaveCount(2);
      if (tab === "preferences") {
        const columns = await page
          .locator(".account-preferences .form-grid")
          .evaluate(
            (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
          );
        expect(columns).toBe(info.project.name === "mobile" ? 1 : 4);
      }
      await page.screenshot({
        path: info.outputPath(`account-${tab}-${theme}.png`),
        fullPage: true,
      });
    }
  });
}

test("payment confirmation has English translations", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "siu-ui-preferences",
      JSON.stringify({ theme: "light", locale: "en" }),
    ),
  );
  await fixture(page);
  await page.goto("/ai/tenant-design?panel=plan&planTab=viewing");
  await page
    .getByRole("button", { name: "Report paid to landlord", exact: true })
    .click();
  await page.locator('input[name="paid_on"]').fill("2026-10-15");
  await page.locator(".agreement button.primary").click();
  const dialog = page.getByRole("dialog", {
    name: "Are you sure you want to confirm the transfer?",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Go back", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Agree", exact: true }),
  ).toBeVisible();
});

test("contact cancellation reads a fresh revision from the existing request endpoint", async ({
  page,
}) => {
  await fixture(page);
  let cancelled = false;
  const revisions: number[] = [];
  await page.route("**/housing/contact-requests/request-1/messages", (route) =>
    route.fulfill({
      json: {
        role: "tenant",
        viewer_id: "tenant",
        messages: [],
        request: {
          id: "request-1",
          title: "Căn hộ Hòa Khánh",
          tenant_user_id: "tenant",
          message: "Tôi quan tâm căn này.",
          status: cancelled ? "declined" : "new",
          open: !cancelled,
          created_at: "2026-10-15T09:00:00Z",
        },
      },
    }),
  );
  await page.route("**/housing/contact-requests/me", (route) =>
    route.fulfill({ json: { items: [{ id: "request-1", revision: 7 }] } }),
  );
  await page.route("**/housing/contact-requests/request-1/cancel", (route) => {
    revisions.push(route.request().postDataJSON().revision);
    cancelled = true;
    return route.fulfill({ json: { status: "declined", revision: 8 } });
  });
  await page.goto("/ai/tenant-design?panel=plan&planTab=viewing");
  await page.getByRole("button", { name: "Nhắn chủ nhà", exact: true }).click();
  await page.getByRole("button", { name: "Hủy yêu cầu", exact: true }).click();
  await expect(page.locator(".contact-thread")).toContainText(
    "Yêu cầu đã đóng",
  );
  expect(revisions).toEqual([7]);
});
