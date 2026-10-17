// Opt-in real gateway/API/MCP/PostGIS + browser. No interception, replay,
// setGeolocation, seeded housing or invented real roommate profile.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
test.skip(
  process.env.RUN_HOUSING_CONTROLS_LIVE !== "1",
  "Requires real local read services",
);

async function register(page: Page) {
  if (process.env.HOUSING_CONTROLS_THREAD) {
    const session = JSON.parse(
      execFileSync(
        "node",
        [
          "../../scripts/python.mjs",
          "-c",
          `
import json,sys
from pathlib import Path
from relohome_gateway.store import Store
run=sys.argv[1]
assert run.startswith('issue79-browser-') and '/' not in run and '\\\\' not in run
store=Store(Path.cwd()/'logs/local'/run/'web.sqlite3')
row=store.one('SELECT t.owner,u.name,u.email FROM threads t JOIN users u ON u.id=t.owner WHERE t.id=?',(sys.argv[2],))
assert row and row['name']=='Issue79 browser verification' and row['email'].endswith('@example.invalid')
print(json.dumps({'token':store.create_session(row['owner'])}))
`,
          process.env.HOUSING_CONTROLS_RUN!,
          process.env.HOUSING_CONTROLS_THREAD,
        ],
        { encoding: "utf8", env: process.env },
      ),
    );
    await page.context().addCookies([
      {
        name: "siu_session",
        value: session.token,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    return;
  }
  const r = await page.request.post("/web/api/auth/register", {
    headers: { "X-SIU-Request": "1" },
    data: {
      name: "Issue79 browser verification",
      email: randomUUID() + "@example.invalid",
      password: randomUUID(),
    },
  });
  expect(r.ok()).toBe(true);
}

test("real Housing basket, four-way comparison, detail actions and actual denied GPS flow", async ({
  page,
}) => {
  await register(page);
  const resume = process.env.HOUSING_CONTROLS_THREAD;
  const created = resume
    ? await page.request.get("/web/api/threads/" + resume)
    : await page.request.post("/web/api/threads", {
        headers: { "X-SIU-Request": "1" },
        data: {},
      });
  expect(created.ok()).toBe(true);
  const thread = await created.json();
  // One real LLM read establishes the real map workspace. Controls thereafter use none.
  const answer = resume
    ? created
    : await page.request.post(`/web/api/threads/${thread.id}/chat`, {
        headers: { "X-SIU-Request": "1" },
        timeout: 180000,
        data: {
          request_id: randomUUID(),
          message:
            "Tìm nhà thuê ở Hà Nội dưới 8 triệu một tháng. Chỉ tìm thông tin, chưa đặt dịch vụ.",
        },
      });
  expect(answer.ok()).toBe(true);
  const state = await answer.json();
  await page.goto("/ai/" + thread.id);
  if (!(await page.locator(".ws-canvas").isVisible())) {
    await page.locator(".plan-peek-tab").click();
    await page
      .locator(".plan-open-service")
      .filter({ hasText: "Tìm nhà" })
      .click();
  }
  // City-wide results intentionally start clustered. Zoom the actual map instead
  // of inventing provider data or re-running the paid prompt.
  for (let i = 0; i < 8 && (await page.locator(".ws-card").count()) < 5; i++) {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect
      .poll(async () => await page.locator(".ws-card").count(), {
        timeout: 2200,
      })
      .toBeGreaterThanOrEqual(5)
      .catch(() => {});
  }
  await expect(page.locator(".ws-card").nth(4)).toBeVisible({ timeout: 20000 });
  const writes: string[] = [];
  page.on("request", (r) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(r.method()))
      writes.push(new URL(r.url()).pathname);
  });
  for (let i = 0; i < 4; i++)
    await page.locator(".ws-card").nth(i).locator(".ws-compare-toggle").click();
  await expect(page.locator(".ws-comparison-tray li")).toHaveCount(4);
  await expect(
    page.locator(".ws-card").nth(4).locator(".ws-compare-toggle"),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "So sánh 4 căn", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "So sánh các căn đã chọn" });
  await expect(dialog.locator("thead th")).toHaveCount(5);
  await expect(dialog.getByText("Đang đọc lại chi tiết các căn…")).toHaveCount(
    0,
    { timeout: 20000 },
  );
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await page
    .locator(".ws-comparison-tray li")
    .first()
    .getByRole("button")
    .click();
  await expect(page.locator(".ws-comparison-tray li")).toHaveCount(3);
  await page.locator(".ws-card").first().locator(".title-button").click();
  await expect(
    page.locator(".ws-detail-actions").getByRole("link"),
  ).toHaveCount(0);
  await expect(
    page.locator(".ws-detail-actions .ws-compare-toggle"),
  ).toBeVisible();
  // Default browser permission is not granted. No GPS coordinates are fabricated.
  await page
    .locator(".ws-detail-actions")
    .getByRole("button", { name: "Chỉ đường từ vị trí của bạn" })
    .click();
  const gps = page.getByRole("dialog", {
    name: "Từ vị trí của bạn tới căn nhà",
  });
  await expect(gps.getByRole("alert")).toBeVisible({ timeout: 35000 });
  await gps.getByRole("button", { name: "Đóng", exact: true }).click();
  expect(
    writes.filter((p) =>
      /\/(chat|action|decision|quote|payment)(\/|$)/.test(p),
    ),
  ).toEqual([]);
  const final = await (
    await page.request.get("/web/api/threads/" + thread.id)
  ).json();
  expect(final.revision).toBe(state.revision);
  expect(final.state.selected).toEqual(state.state.selected);
  await page.screenshot({ path: "../../data/issue79-housing-desktop.png" });
  await page
    .locator(".ws-detail")
    .getByRole("button", { name: "Đóng chi tiết", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".ws-sheet-toggle").click();
  await expect(page.locator(".ws-comparison-tray")).toBeVisible();
  await page
    .getByRole("button", { name: "So sánh 3 căn", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "So sánh các căn đã chọn" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../../data/issue79-housing-mobile.png" });
  console.log(
    JSON.stringify({
      case: "housing_controls",
      thread: thread.id,
      comparison_count: 4,
      control_llm_calls: 0,
      mutations: 0,
    }),
  );
});

test("Roommate opens user discovery from legacy demo links without granting consent", async ({
  page,
}) => {
  await register(page);
  await page.goto("/roommate?tab=demo");
  await expect(page.locator(".rm-source-switch")).toHaveCount(0);
  await expect(page.getByText(/DEMO/)).toHaveCount(0);
  // Only this disposable identity explicitly declares eligibility; it publishes no profile.
  const access = await (
    await page.request.get("/web/api/roommate/access")
  ).json();
  if (!access.eligible) {
    const consent = await page.request.post("/web/api/roommate/access", {
      headers: { "X-SIU-Request": "1" },
      data: {
        adult: true,
        terms_version: access.terms_version,
      },
    });
    expect(consent.ok()).toBe(true);
    await page.reload();
  }
  await expect(page.locator(".rm-filter-panel")).toBeVisible();
  await expect(page.locator(".rm-filter-panel details[open]")).toHaveCount(0);
  await expect(page.locator(".rm-quick-search")).toBeVisible();
  await expect(page.getByText(/hồ sơ · xếp hạng theo tiêu chí/)).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText(/DEMO .*\d{3}/)).toHaveCount(0);
  await page.screenshot({ path: "../../data/issue79-roommate-real-empty.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
