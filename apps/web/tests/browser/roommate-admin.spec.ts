import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function fixture(
  page: Page,
  state: "enabled" | "disabled" | "denied" | "unavailable" = "enabled",
) {
  const calls: {
    path: string;
    method: string;
    body: unknown;
    actor?: string;
  }[] = [];
  const profile = {
    profile_id: "candidate",
    display_name: "Linh",
    introduction:
      "Tìm bạn ở cùng gọn gàng, cùng tìm chỗ ở tại TP. Hồ Chí Minh.",
    avatar_id: null,
    state: "active",
    version: 2,
    facts: {
      city: "hcm",
      area_ids: ["city:hcm"],
      budget: { min_vnd: 2000000, max_vnd: 4000000, fee_basis: "rent_only" },
      need: { kind: "looking_together" },
      move_in: { kind: "flexible" },
    },
    updated_at: new Date().toISOString(),
  };
  let reports = [
    {
      id: "report-one",
      target: "candidate",
      reason: "Nội dung cần được kiểm tra",
      status: "open",
      created: Date.now() / 1000,
    },
    {
      id: "report-two",
      target: "candidate",
      reason: "Thông tin chưa phù hợp",
      status: "open",
      created: Date.now() / 1000,
    },
  ];
  await page.route("**/web/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace("/web/api", "");
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      /* GET has no body. */
    }
    calls.push({
      path,
      method: req.method(),
      body,
      actor: req.headers()["x-roommate-actor"],
    });
    let json: unknown = {};
    if (path === "/session")
      json = {
        id: "housing-admin",
        name: "Admin",
        is_admin: true,
        preferences: {},
      };
    else if (path.endsWith("/moderation/housing/queue"))
      json = { hosts: [], properties: [], listings: [] };
    else if (path.endsWith("/moderation/housing/listings"))
      json = { items: [], total: 0 };
    else if (path === "/roommate/availability") {
      if (state === "unavailable")
        return route.fulfill({
          status: 503,
          json: { detail: { code: "service_unavailable" } },
        });
      json = {
        enabled: state !== "disabled",
        features: ["operation_drafts", "moderation", "media"],
        cities: ["hcm"],
        terms_version: "roommate-1.0",
      };
    } else if (path === "/roommate/access")
      json = {
        eligible: false,
        reason: "service_terms_required",
        moderator: state !== "denied",
        terms_version: "roommate-1.0",
      };
    else if (path === "/roommate/me/operation-drafts") json = { items: [] };
    else if (path === "/roommate/moderation/summary")
      json = {
        active_profiles: profile.state === "active" ? 1 : 0,
        restricted_profiles: profile.state === "restricted" ? 1 : 0,
        pending_reports: reports.length,
      };
    else if (path === "/roommate/moderation/reports")
      json = { items: reports, total: reports.length };
    else if (path.endsWith("/resolve")) {
      reports = reports.filter((r) => !path.includes(r.id));
      json = { status: "reviewed" };
    } else if (path === "/roommate/moderation/profiles") {
      const items =
        (!url.searchParams.get("q") ||
          profile.display_name
            .toLowerCase()
            .includes(url.searchParams.get("q")!.toLowerCase())) &&
        (!url.searchParams.get("city") ||
          url.searchParams.get("city") === "hcm") &&
        (!url.searchParams.get("status") ||
          url.searchParams.get("status") === profile.state)
          ? [profile]
          : [];
      json = { items, total: items.length };
    } else if (path.endsWith("/history")) json = { items: [], total: 0 };
    else if (path === "/roommate/moderation/profiles/candidate") {
      if (req.method() === "POST")
        profile.state = (body as { selected: boolean }).selected
          ? "restricted"
          : "paused";
      json =
        req.method() === "GET"
          ? { profile, restricted: profile.state === "restricted" }
          : { profile_id: "candidate", restricted: true };
    }
    return route.fulfill({ json });
  });
  return { calls };
}

for (const theme of ["light", "dark"] as const) {
  test(`Admin Roommate is usable without photos or personal consent (${theme})`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (theme) =>
        localStorage.setItem(
          "siu-ui-preferences",
          JSON.stringify({ theme, locale: "vi" }),
        ),
      theme,
    );
    const f = await fixture(page);
    await page.goto("/admin?tab=roommate");
    await expect(
      page.getByRole("heading", { name: "Hồ sơ và báo cáo", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ảnh hồ sơ", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Hồ sơ", exact: true }).click();
    await expect(page.getByText("Linh", { exact: true })).toBeVisible();
    // Leave room for the search icon despite shared input rules loaded later.
    await expect(
      page.getByRole("textbox", { name: "Tìm tên hoặc mã hồ sơ", exact: true }),
    ).toHaveCSS("padding-left", "38px");
    await expect(page.getByText("Đến 4.000.000", { exact: false })).toHaveCount(
      0,
    );
    expect(
      (await new AxeBuilder({ page }).include("main").analyze()).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`roommate-admin-${theme}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Xem chi tiết", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "2.000.000 – 4.000.000",
    );
    await expect(
      page.getByRole("heading", { name: "Lịch sử xử lý", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Hạn chế tài khoản", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Lý do xử lý")
      .fill("Nội dung không phù hợp sau xem xét");
    await page
      .getByRole("button", { name: "Xác nhận xử lý", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const mutation = f.calls.find(
      (c) =>
        c.path === "/roommate/moderation/profiles/candidate" &&
        c.method === "POST",
    );
    expect(mutation?.body).toMatchObject({
      selected: true,
      expected_version: 2,
    });
    expect(
      f.calls
        .filter((c) => c.path.startsWith("/roommate/"))
        .every((c) => c.actor === "housing-admin"),
    ).toBe(true);
    await page.getByRole("button", { name: "Duyệt tin", exact: true }).click();
    await expect(
      page.getByLabel("Tìm tin theo tiêu đề hoặc phòng"),
    ).toBeVisible();
  });
}

test("profile filters use the server and reports support explicit batch review", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/admin?tab=roommate");
  await page
    .getByRole("checkbox", { name: "Chọn báo cáo trong trang", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Đánh dấu đã xem xét", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("2 báo cáo");
  await page
    .getByRole("button", { name: "Xác nhận xử lý", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("2 thành công · 0 lỗi · 0 chưa gửi", { exact: true }),
  ).toBeVisible();
  expect(f.calls.filter((c) => c.path.endsWith("/resolve"))).toHaveLength(2);
  await page.getByRole("button", { name: "Hồ sơ", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Tìm tên hoặc mã hồ sơ", exact: true })
    .fill("Không có hồ sơ này");
  await expect(
    page.getByText("Không có nội dung trong mục này", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Tìm tên hoặc mã hồ sơ", exact: true })
    .fill("Linh");
  await expect(page.getByText("Linh", { exact: true })).toBeVisible();
  expect(page.url()).not.toContain("Linh");
  await page
    .getByRole("combobox", { name: "Thành phố", exact: true })
    .selectOption("hanoi");
  await expect(
    page.getByText("Không có nội dung trong mục này", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Xóa bộ lọc", exact: true }).click();
  await expect(page.getByText("Linh", { exact: true })).toBeVisible();
});

test("batch review keeps unknown reports selected and does not resend successful writes", async ({
  page,
}) => {
  const f = await fixture(page);
  let failures = 0;
  await page.route(
    "**/web/api/roommate/moderation/reports/report-two/resolve",
    (route) => {
      failures++;
      return route.fulfill({
        status: 503,
        json: { detail: { code: "operation_unknown" } },
      });
    },
  );
  await page.goto("/admin?tab=roommate");
  await page
    .getByRole("checkbox", { name: "Chọn báo cáo trong trang", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Đánh dấu đã xem xét", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Xác nhận xử lý", exact: true })
    .click();
  await expect(
    page.getByText("1 thành công · 0 lỗi · 1 chưa rõ kết quả · 0 chưa gửi", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "Chọn báo cáo report-two",
      exact: true,
    }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await expect(
    page.getByText("Thông tin chưa phù hợp", { exact: true }),
  ).toBeVisible();
  expect(failures).toBe(1);
  expect(
    f.calls.filter((call) => call.path.endsWith("report-one/resolve")),
  ).toHaveLength(1);
});

test("batch stops on an HTML 502 and preserves reports that were not sent", async ({
  page,
}) => {
  await fixture(page);
  const attempts: string[] = [];
  const items = ["one", "two", "three"].map((id) => ({
    id: "report-" + id,
    target: "candidate",
    reason: id,
    status: "open",
    created: 1,
  }));
  await page.route("**/web/api/roommate/moderation/reports?**", (route) =>
    route.fulfill({ json: { items, total: 3 } }),
  );
  await page.route(
    "**/web/api/roommate/moderation/reports/*/resolve",
    (route) => {
      attempts.push(route.request().url().split("/").at(-2)!);
      return route.fulfill({
        status: 502,
        contentType: "text/html",
        body: "<h1>Bad Gateway</h1>",
      });
    },
  );
  await page.goto("/admin?tab=roommate");
  await page
    .getByRole("checkbox", { name: "Chọn báo cáo trong trang", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Đánh dấu đã xem xét", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Xác nhận xử lý", exact: true })
    .click();
  await expect(
    page.getByText("0 thành công · 0 lỗi · 1 chưa rõ kết quả · 2 chưa gửi", {
      exact: true,
    }),
  ).toBeVisible();
  expect(attempts).toEqual(["report-one"]);
  for (const item of items)
    await expect(
      page.getByRole("checkbox", {
        name: "Chọn báo cáo " + item.id,
        exact: true,
      }),
    ).toBeChecked();
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await expect(page.getByText("one", { exact: true })).toBeVisible();
  expect(attempts).toEqual(["report-one"]);
});

for (const state of ["disabled", "denied", "unavailable"] as const) {
  test(`Admin Roommate handles ${state} while Housing stays available`, async ({
    page,
  }) => {
    const f = await fixture(page, state);
    await page.goto("/admin?tab=roommate");
    if (state === "disabled")
      await expect(
        page.getByText("Roommate chưa được bật", { exact: true }),
      ).toBeVisible();
    else await expect(page.getByRole("alert")).toBeVisible();
    expect(
      f.calls.filter((c) => c.path.startsWith("/roommate/moderation/")),
    ).toHaveLength(0);
    await page.getByRole("button", { name: "Duyệt tin", exact: true }).click();
    await expect(
      page.getByLabel("Tìm tin theo tiêu đề hoặc phòng"),
    ).toBeVisible();
  });
}
