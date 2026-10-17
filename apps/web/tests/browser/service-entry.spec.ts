import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("welcome shows six equal service entries with Roommates and Guides working", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/web/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session")) return route.fulfill({ json: { id: "entry-user", name: "Test", email: "entry@example.test", preferences: {} } });
    if (path.endsWith("/status")) return route.fulfill({ json: { domains: ["property", "map", "flight", "relocation", "roommate"], writes_enabled: false } });
    if (path.endsWith("/threads") || path.endsWith("/saved")) return route.fulfill({ json: [] });
    if (path.endsWith("/roommate/availability")) return route.fulfill({ json: { enabled: true, cities: ["hcm", "hanoi", "danang"], terms_version: "roommate-1.0" } });
    if (path.endsWith("/roommate/access")) return route.fulfill({ json: { eligible: false, reason: "service_terms_required", terms_version: "roommate-1.0", moderator: false } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/ai");
  await expect(page.locator(".quick-grid > .quick-card")).toHaveCount(6);
  await expect(page.locator(".quick-grid > button")).toHaveCount(4);
  await expect(page.locator(".quick-grid > a")).toHaveCount(2);
  for (const [width, columns] of [[320, 2], [768, 2], [1440, 3]]) {
    await page.setViewportSize({ width, height: 960 });
    const boxes = await page.locator(".quick-card").evaluateAll(elements => elements.map(el => {
      const box = el.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    expect(new Set(boxes.map(box => Math.round(box.y))).size).toBe(6 / columns);
    expect(Math.max(...boxes.map(box => box.width)) - Math.min(...boxes.map(box => box.width))).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.getByRole("link", { name: "Ở ghép", exact: true }).click();
  await expect(page).toHaveURL(/\/roommate$/);
  await expect(page.getByRole("heading", { name: "Tìm người ở cùng", exact: true })).toBeVisible();
  await page.goto("/ai");
  await page.getByRole("link", { name: "Cẩm nang", exact: true }).click();
  await expect(page).toHaveURL(/\/guides$/);
  await expect(page.locator(".guides-list article")).toHaveCount(10);
  await page.getByRole("searchbox", { name: "Tìm trong cẩm nang", exact: true }).fill("tien dien");
  await expect(page.locator(".guides-list article").first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Tìm trong cẩm nang", exact: true }).fill("no-result-xyz");
  await expect(page.getByRole("heading", { name: "Chưa tìm thấy bài viết", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Xem tất cả bài viết", exact: true }).click();
  await expect(page.locator(".guides-list article")).toHaveCount(10);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations.map(v => v.id)).toEqual([]);
  }
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Guides for your next chapter", exact: true })).toBeVisible();
  await page.goto("/ai");
  await expect(page.getByRole("link", { name: "Roommates", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Guides", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("welcome-extra-services.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("guide library is public and opens original in-app articles", async ({ page }) => {
  await page.route("**/web/api/session", route => route.fulfill({ status: 401, json: {} }));
  await page.goto("/guides");
  await expect(page.getByRole("heading", { name: "Cẩm nang cuộc sống mới", exact: true })).toBeVisible();
  await expect(page.locator(".guides-list article")).toHaveCount(10);
  for (const link of await page.locator(".guides-list a").all()) {
    expect(await link.getAttribute("href")).toMatch(/^\/guides\?article=/);
  }
  await page.locator(".guides-list h2 a").first().click();
  await expect(page).toHaveURL(/\/guides\?article=xem-phong$/);
  await expect(page.getByRole("heading", { name: "Đi xem phòng: kiểm tra gì ngoài ảnh đăng?", exact: true })).toBeVisible();
  await expect(page.locator('.guides-reader-body > section[id^="guide-section-"]')).toHaveCount(3);
  if (await page.locator("html").getAttribute("data-theme") !== "dark") {
    await page.getByRole("button", { name: "Chuyển sang chế độ tối" }).focus();
    await page.getByRole("button", { name: "Chuyển sang chế độ tối" }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations.map(v => v.id)).toEqual([]);
  await page.getByRole("link", { name: "Tất cả cẩm nang" }).click();
  await expect(page.locator(".guides-list article")).toHaveCount(10);
});
