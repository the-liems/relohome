// Actual local gateway/LLM/MCP/PostGIS. No intercepted APIs or invented provider/GPS fixtures.
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

test.skip(
  process.env.RUN_HOUSING_MAP_INTERACTIONS_LIVE !== "1",
  "Opt-in actual read services and two LLM chats",
);
test("new named search ignores past filters; whole cards and actual POI icons open details", async ({
  page,
}) => {
  test.setTimeout(180000);
  const headers = { "X-SIU-Request": "1" };
  if (process.env.HOUSING_MAP_INTERACTIONS_THREAD) {
    const session = JSON.parse(
      execFileSync(
        "node",
        [
          "../../scripts/python.mjs",
          "-c",
          `
import sys,json
from pathlib import Path
from relohome_gateway.store import Store
store=Store(Path.cwd()/'data/siu-web.sqlite3')
row=store.one('SELECT t.owner,u.name,u.email FROM threads t JOIN users u ON u.id=t.owner WHERE t.id=?',(sys.argv[1],))
assert row and row['name']=='Issue119 read verification' and row['email'].endswith('@example.invalid')
print(json.dumps({'token':store.create_session(row['owner'])}))
`,
          process.env.HOUSING_MAP_INTERACTIONS_THREAD,
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
  } else
    expect(
      (
        await page.request.post("/web/api/auth/register", {
          headers,
          data: {
            name: "Issue119 read verification",
            email: randomUUID() + "@example.invalid",
            password: randomUUID(),
          },
        })
      ).ok(),
    ).toBe(true);
  async function search(message: string) {
    const created = await page.request.post("/web/api/threads", {
      headers,
      data: {},
    });
    expect(created.ok()).toBe(true);
    const thread = await created.json();
    const response = await page.request.post(
      `/web/api/threads/${thread.id}/chat`,
      { headers, timeout: 90000, data: { request_id: randomUUID(), message } },
    );
    expect(response.ok()).toBe(true);
    const snapshot = await response.json();
    expect(snapshot.state.plan.commit_actions).toEqual([]);
    const housing = snapshot.messages
      .at(-1)
      .content.ui.components.find((c: any) => c.type === "property");
    expect(housing).toBeTruthy();
    return { thread, housing };
  }
  let thread: any, housing: any;
  if (process.env.HOUSING_MAP_INTERACTIONS_THREAD) {
    const snapshot = await (
      await page.request.get(
        "/web/api/threads/" + process.env.HOUSING_MAP_INTERACTIONS_THREAD,
      )
    ).json();
    thread = snapshot;
    housing = snapshot.messages
      .at(-1)
      .content.ui.components.find((c: any) => c.type === "property");
  } else {
    await search(
      "Tìm phòng thuê trong Phường Hoàng Mai, Hà Nội dưới 5 triệu/tháng và có điều hòa. Chỉ tra cứu, không đặt dịch vụ.",
    );
    ({ thread, housing } = await search(
      "Tìm phòng ở Hà Nội dưới 5 triệu đồng mỗi tháng. Chỉ tra cứu, không đặt dịch vụ.",
    ));
  }
  expect(housing.data.search_request.amenities).toBeUndefined();
  expect(housing.data.search_request.district).toBeUndefined();
  expect(housing.data.map_context.search_scope.label).toBe("Thành phố Hà Nội");

  // Observe the real map instance only: retain its original addSource implementation,
  // real sources, camera, rendered-feature hit testing and provider requests.
  const source = await (
    await page.request.get("/src/components/MapWorkspace.tsx")
  ).text();
  const moduleUrl = source.match(
    /["'](\/node_modules\/\.vite\/deps\/maplibre-gl\.js[^"']*)["']/,
  )?.[1];
  expect(moduleUrl).toBeTruthy();
  await page.addInitScript((moduleUrl) => {
    void import(moduleUrl).then((library) => {
      const prototype = library.Map.prototype;
      const original = prototype.addSource;
      prototype.addSource = function (...args: any[]) {
        (window as any).__issue119Map = this;
        return original.apply(this, args);
      };
    });
  }, moduleUrl!);
  await page.goto("/ai/" + thread.id);
  if (!(await page.locator(".ws-canvas").isVisible())) {
    await page.locator(".plan-peek-tab").click();
    await page
      .locator(".plan-open-service")
      .filter({ hasText: "Tìm nhà" })
      .click();
  }
  await expect(
    page.getByRole("region", { name: "Bản đồ nhà ở", exact: true }),
  ).toHaveAttribute("aria-busy", "false", { timeout: 30000 });
  const filterToggle = page.locator(".ws-filter-toggle");
  if (await filterToggle.isVisible()) {
    await expect(page.locator(".ws-back-chat")).toBeVisible();
    await expect(filterToggle).toHaveAttribute("aria-expanded", "false");
    await filterToggle.click();
    await expect(page.getByRole("combobox", { name: "Mức giá" })).toHaveValue(
      "5000000",
    );
    await filterToggle.click();
    await expect(page.getByRole("combobox", { name: "Mức giá" })).toBeHidden();
  }
  await expect
    .poll(() => page.evaluate(() => (window as any).__issue119Map?.isMoving()))
    .toBe(false);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as any).__issue119Map?.getSource("ws-pois")),
      ),
    )
    .toBe(true);
  const candidate = housing.data.candidates.find(
    (h: any) => Number.isFinite(h.lat) && Number.isFinite(h.lng),
  );
  expect(candidate).toBeTruthy();
  await page.evaluate(
    ([lng, lat]) =>
      (window as any).__issue119Map.jumpTo({ center: [lng, lat], zoom: 16 }),
    [candidate.lng, candidate.lat],
  );
  const sheetToggle = page.locator(".ws-sheet-toggle");
  if (await sheetToggle.isVisible()) {
    if ((await sheetToggle.getAttribute("aria-expanded")) !== "true")
      await sheetToggle.click();
  }
  await expect(page.locator(".ws-card").first()).toBeVisible({
    timeout: 30000,
  });
  const card = page.locator(".ws-card").first();
  await card.locator(".price").click();
  await expect(page.getByLabel("Chi tiết nhà", { exact: true })).toBeVisible();
  await page.getByLabel("Đóng chi tiết", { exact: true }).click();
  await card.getByRole("button", { name: /^Thêm so sánh:/ }).click();
  await expect(page.getByLabel("Chi tiết nhà", { exact: true })).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: /^Bỏ so sánh:/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Chi tiết nhà", { exact: true })).toBeVisible();
  await page.getByLabel("Đóng chi tiết", { exact: true }).click();

  if (await sheetToggle.isVisible()) {
    if ((await sheetToggle.getAttribute("aria-expanded")) === "true")
      await sheetToggle.click();
    await expect(sheetToggle).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(() =>
        page
          .locator(".ws-list")
          .evaluate((el) => el.getBoundingClientRect().height),
      )
      .toBeLessThanOrEqual(50);
  }
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__issue119Map.queryRenderedFeatures({
            layers: ["ws-poi"],
          }).length,
      ),
    )
    .toBeGreaterThan(0);
  const point = await page.evaluate(() => {
    const map = (window as any).__issue119Map;
    const canvas = map.getCanvas().getBoundingClientRect();
    const feature = map
      .queryRenderedFeatures({ layers: ["ws-poi"] })
      .find((f: any) => {
        const p = map.project(f.geometry.coordinates);
        return (
          document.elementFromPoint(canvas.left + p.x, canvas.top + p.y) ===
          map.getCanvas()
        );
      });
    if (!feature) return null;
    const p = map.project(feature.geometry.coordinates);
    return { x: canvas.left + p.x, y: canvas.top + p.y };
  });
  expect(point).toBeTruthy();
  await page.mouse.click(point!.x, point!.y);
  await expect(
    page.getByLabel("Chi tiết tiện ích", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Boolean((window as any).__issue119Map.getLayer("ws-poi-cluster")),
    ),
  ).toBe(false);
  await page.getByLabel("Đóng chi tiết", { exact: true }).click();
  await page.locator(".ws-back-chat").click();
  await expect(page.locator(".conversation-scroll")).toBeVisible();
});
