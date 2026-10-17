import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const theme of ["light", "dark"] as const) {
  test(`Housing Admin opens roommate moderation without creating a personal profile (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.setItem(
        "siu-ui-preferences",
        JSON.stringify({ theme, locale: "vi" }),
      );
    }, theme);
    const writes: string[] = [];
    const actors: (string | undefined)[] = [];
    await page.route("**/web/api/**", async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace("/web/api", "");
      if (req.method() !== "GET") writes.push(path);
      if (path.startsWith("/roommate/"))
        actors.push(req.headers()["x-roommate-actor"]);
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
      else if (path === "/roommate/availability")
        json = {
          enabled: true,
          features: ["operation_drafts", "moderation"],
          cities: ["hcm"],
          terms_version: "roommate-1.0",
        };
      else if (path === "/roommate/access")
        json = {
          eligible: false,
          reason: "service_terms_required",
          moderator: true,
          terms_version: "roommate-1.0",
        };
      else if (path === "/roommate/moderation/summary")
        json = {
          active_profiles: 1,
          pending_reports: 0,
          pending_media: 0,
          pending_requests: 0,
        };
      else if (path === "/roommate/me/operation-drafts") json = { items: [] };
      else if (path === "/roommate/moderation/profiles")
        json = {
          items: [
            {
              profile_id: "candidate",
              display_name: "Linh",
              introduction: "Tìm bạn ở cùng",
              avatar_id: null,
              state: "active",
            },
          ],
          total: 1,
        };
      else if (path.startsWith("/roommate/moderation/"))
        json = { items: [], total: 0 };
      return route.fulfill({ json });
    });
    await page.goto("/admin?tab=roommate");
    await expect(
      page.getByRole("heading", { name: "Quản lý cộng đồng", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ở ghép", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("button", { name: "Ở ghép", exact: true }),
    ).toBeInViewport();
    await page.getByRole("button", { name: "Hồ sơ", exact: true }).click();
    await page.getByRole("button", { name: "Hạn chế", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Lý do xử lý")
      .fill("Nội dung vi phạm nội quy cộng đồng");
    await page
      .getByRole("button", { name: "Xác nhận xử lý", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(writes).toEqual([
      "/roommate/operation-drafts",
      "/roommate/moderation/profiles/candidate",
    ]);
    expect(actors.every((actor) => actor === "housing-admin")).toBe(true);
    const axe = await new AxeBuilder({ page }).include("main").analyze();
    expect(axe.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`roommate-admin-${theme}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Duyệt tin", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Duyệt tin", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });
}

for (const state of ["disabled", "denied", "unavailable"] as const) {
  test(`Roommate Admin handles ${state} without affecting Housing`, async ({
    page,
  }) => {
    let moderationCalls = 0;
    await page.route("**/web/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname.replace(
        "/web/api",
        "",
      );
      if (path === "/session")
        return route.fulfill({
          json: { id: "admin", name: "Admin", is_admin: true, preferences: {} },
        });
      if (path === "/roommate/availability")
        return route.fulfill(
          state === "unavailable"
            ? { status: 503, json: { detail: { code: "service_unavailable" } } }
            : { json: { enabled: state !== "disabled", features: [] } },
        );
      if (path === "/roommate/access")
        return route.fulfill({ json: { eligible: false, moderator: false } });
      if (path.startsWith("/roommate/moderation/")) moderationCalls++;
      return route.fulfill({
        json: { items: [], total: 0, hosts: [], properties: [], listings: [] },
      });
    });
    await page.goto("/admin?tab=roommate");
    if (state === "disabled")
      await expect(
        page.getByText("Roommate chưa được bật", { exact: true }),
      ).toBeVisible();
    else if (state === "denied")
      await expect(page.getByRole("alert")).toContainText(
        "quyền quản lý cộng đồng",
      );
    else await expect(page.getByRole("alert")).toBeVisible();
    expect(moderationCalls).toBe(0);
    await page.getByRole("button", { name: "Duyệt tin", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Duyệt tin", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });
}
