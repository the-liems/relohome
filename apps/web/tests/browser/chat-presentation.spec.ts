import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { waitForUiMotion } from "./helpers/ui-motion";

async function fixture(page: Page) {
  let signedIn = true;
  const writes: string[] = [];
  const thread = { id: "th_session", title: "Prompt không dùng làm tên thương hiệu", updated: Date.now() / 1000, revision: 1, runs: [], state: { plan: { tasks: [], version: 1 }, intake: { user_confirmed_facts: {} }, task_status: {} }, messages: [{ id: "reply", role: "assistant", created: Date.now() / 1000, content: { response: { kind: "ANSWER", text: "Nội dung phiên đang làm" } } }] };
  await page.route("**/web/api/**", route => {
    const path = new URL(route.request().url()).pathname.replace("/web/api", "");
    if (path === "/logout") signedIn = false;
    if (path === "/session" && !signedIn) return route.fulfill({ status: 401, json: { detail: "Vui lòng đăng nhập để tiếp tục." } });
    if (route.request().method() !== "GET") writes.push(path);
    const body = path === "/session" ? { id: "tenant", name: "An", email: "an@example.test", preferences: {} }
      : path === "/status" ? { domains: ["property", "map", "flight", "relocation"] }
      : path === "/threads" ? [thread] : path === "/threads/th_session" ? thread : path === "/saved" ? [] : {};
    return route.fulfill({ json: body });
  });
  return { thread, writes };
}

test("fixed ReloHome brand hides the archive and resumes only the current session without writing chat data locally", async ({ page }) => {
  const { writes } = await fixture(page);
  await page.goto("/ai/th_session");
  await expect(page.locator(".chat-title")).toHaveText("ReloHome");
  expect(await page.locator(".chat-title").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);
  await expect(page.getByRole("button", { name: "Lịch sử", exact: true })).toHaveCount(0);
  await expect(page.getByText("Nội dung phiên đang làm", { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("relohome-active-chat:tenant")!));
  expect(Object.keys(stored).sort()).toEqual(["expiresAt", "threadId"]);
  expect(stored.threadId).toBe("th_session");
  expect(stored.expiresAt - Date.now()).toBeGreaterThan(23 * 3600000);
  await page.getByRole("link", { name: "Cuộc trò chuyện mới", exact: true }).focus();
  await page.getByRole("link", { name: "Cuộc trò chuyện mới", exact: true }).click();
  const resume = page.getByRole("link", { name: "Tiếp tục phiên đang làm", exact: true });
  await expect(resume).toBeVisible();
  await resume.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ai\/th_session$/);
  await expect(page.getByText("Nội dung phiên đang làm", { exact: true })).toBeVisible();
  await page.goto("/account");
  await page.getByRole("tab", { name: "Hồ sơ & bảo mật", exact: true }).click();
  await expect(page.locator(".recent-activity")).toHaveCount(0);
  await expect(page.getByText("Hội thoại gần đây", { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem("relohome-active-chat:tenant"))).toBeNull();
});

test("expired or another owner's cache never resumes a conversation or deletes backend history", async ({ page }) => {
  const { writes } = await fixture(page);
  await page.addInitScript(() => {
    localStorage.setItem("relohome-active-chat:tenant", JSON.stringify({ threadId: "th_session", expiresAt: Date.now() - 1 }));
    localStorage.setItem("relohome-active-chat:other", JSON.stringify({ threadId: "th_session", expiresAt: Date.now() + 86400000 }));
  });
  await page.goto("/ai");
  await expect(page.locator(".quick-card")).toHaveCount(6);
  await expect(page.getByRole("link", { name: "Tiếp tục phiên đang làm" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("relohome-active-chat:tenant"))).toBeNull();
  expect(writes).toEqual([]);
});

test("landing service actions are visible keyboard-operable buttons in both palettes", async ({ page }) => {
  await fixture(page);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/");
    const action = page.getByRole("link", { name: "Lên kế hoạch cùng AI", exact: true });
    await action.scrollIntoViewIfNeeded();
    await action.focus();
    await expect(action).toBeFocused();
    const geometry = await action.boundingBox();
    expect(geometry!.height).toBeGreaterThanOrEqual(44);
    await waitForUiMotion(page);
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations.map(v => v.id)).toEqual([]);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ai$/);
    await expect(page.locator(".chat-title")).toHaveText("ReloHome");
  }
});
