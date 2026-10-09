import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { vehicleFamilies, vehicleFamily } from "../../src/movingCatalog";

test.skip(
  process.env.RUN_WORKSPACE_REPAIRS_BROWSER !== "1",
  "Actual providers/LLM read-only opt-in required",
);

async function signIn(page: Page) {
  const r = await page.request.post("/web/api/auth/register", {
    headers: { "X-SIU-Request": "1" },
    data: {
      name: "Workspace read verification",
      email: randomUUID() + "@example.invalid",
      password: randomUUID(),
    },
  });
  expect(r.ok()).toBeTruthy();
  await page.goto("/ai");
}

test("actual parallel Housing/Flight: pin, stable hover, next service and reopen from plan", async ({
  page,
}) => {
  await signIn(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const answer = page.waitForResponse(
    (r) => r.url().endsWith("/chat") && r.request().method() === "POST",
  );
  await page
    .locator(".composer textarea")
    .fill(
      "Tìm phòng trọ dưới 6 triệu đồng/tháng trong bán kính 2 km quanh Đại học Bách khoa Hà Nội. Đồng thời tìm chuyến bay từ Hà Nội tới Đà Nẵng ngày 20/10/2026 cho một người lớn. Chỉ tìm, không đặt.",
    );
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  const response = await answer;
  expect(response.status()).toBe(200);
  const snapshot = await response.json();
  expect(snapshot.state.plan.commit_actions).toEqual([]);
  const components = snapshot.messages.at(-1).content.ui.components;
  expect(components.map((c: any) => c.type)).toEqual(
    expect.arrayContaining(["property", "flight"]),
  );
  await expect(page.locator(".service-journey button")).toHaveCount(2);
  await expect(page.locator(".ws-list")).toBeVisible();
  await expect(page.locator(".search-scope-legend")).toBeVisible();
  await expect(page.locator(".maplibregl-marker[aria-label]")).toBeVisible();
  const button = page.locator(".ws-chat-show");
  await expect(button).toBeVisible();
  const before = await button.boundingBox();
  await page.mouse.move(
    before!.x + before!.width / 2,
    before!.y + before!.height / 2,
  );
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(80);
    const b = await button.boundingBox();
    expect(Math.abs(b!.x - before!.x)).toBeLessThan(1);
    expect(Math.abs(b!.y - before!.y)).toBeLessThan(1);
  }
  const choice = page.locator(".ws-list .ws-select-small").first();
  await expect(choice).toBeVisible({ timeout: 30000 });
  await choice.click();
  await expect(
    page.getByRole("region", { name: "Chuyến bay", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(250);
  await expect(
    page.getByRole("region", { name: "Chuyến bay", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Chọn chuyến này", exact: true })
    .first()
    .click();
  await expect(page.locator(".conversation-scroll")).toBeVisible();
  await expect(
    page.locator(".conversation-scroll .maplibregl-canvas"),
  ).toHaveCount(0);
  await page.locator(".plan-peek-tab").click();
  await page
    .locator(".plan-open-service")
    .filter({ hasText: "Tìm nhà" })
    .click();
  await expect(page.locator(".ws-canvas")).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      case: "real_parallel_workspace",
      domains: components.map((c: any) => c.type),
      hover_stable: true,
      automatic_next: true,
      plan_reopen: true,
    }),
  );
});

test("actual selected vehicle quote: form continuity and real OSRM route", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: /Chuyển đồ Chuyển đến/ }).click();
  const form = page.locator(".mv-request");
  await expect(form).toBeVisible();
  const catalog = page.waitForResponse(
    (r) => r.url().includes("/web/api/moving/services?") && r.status() === 200,
  );
  for (const [label, text] of [
    ["Địa chỉ lấy đồ", "Đại học Bách khoa Hà Nội"],
    ["Địa chỉ giao đồ", "Đại học Kinh tế Quốc dân"],
  ]) {
    const resolved = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith("/map/search") &&
        new URL(r.url()).searchParams.get("text") === text &&
        r.status() === 200,
    );
    const field = page.getByRole("textbox", { name: label, exact: true });
    await field.fill(text);
    const options = (await (await resolved).json()).results;
    const point = options.find(
      (p: any) =>
        p.name === text &&
        p.category === "university" &&
        p.match_type === "exact",
    );
    expect(point).toBeTruthy();
    const endpoint = page.locator(".mv-endpoint").filter({ has: field });
    await endpoint
      .locator(`button.place[data-place-id="${point.canonical_id}"]`)
      .click();
    await expect(endpoint.locator("small.ok")).toBeVisible();
  }
  const observed = await (await catalog).json();
  const service = observed.services.find(
    (s: any) =>
      s.delivery_type === "TRUCK" &&
      vehicleFamilies.some((f) => f.id === vehicleFamily(s)),
  );
  expect(service).toBeTruthy();
  const family = vehicleFamilies.find((f) => f.id === vehicleFamily(service))!;
  await page
    .getByRole("group", { name: "Loại xe AhaMove", exact: true })
    .getByRole("button", { name: family.label, exact: true })
    .click();
  const radio = page.locator(
    `input[name="ahamove-service"][value="${service.service_id}"]`,
  );
  if (!(await radio.count()))
    await page.getByRole("button", { name: /Xem thêm gói/ }).click();
  await radio.check();
  await page
    .locator('input[type="date"]')
    .fill(
      new Date(Date.now() + 7 * 3600000 + 86400000).toISOString().slice(0, 10),
    );
  await page.locator('input[type="time"]').fill("10:00");
  await page.evaluate(() => {
    const original = document.querySelector(".mv-request");
    (window as any).__quoteContinuity = { lostForm: false, remounted: false };
    const observer = new MutationObserver(() => {
      if (!document.querySelector(".mv-card")) {
        if (!document.querySelector(".mv-request"))
          (window as any).__quoteContinuity.lostForm = true;
        else if (document.querySelector(".mv-request") !== original)
          (window as any).__quoteContinuity.remounted = true;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    (window as any).__quoteObserver = observer;
  });
  const quoteResponse = page.waitForResponse(
    (r) => r.url().endsWith("/moving/quote") && r.request().method() === "POST",
  );
  const preview = page.waitForResponse(
    (r) =>
      r.url().endsWith("/platform/routes/entities") &&
      r.request().method() === "POST",
  );
  const started = Date.now();
  await page
    .getByRole("button", { name: "Xác nhận và lấy báo giá", exact: true })
    .click();
  const quote = await quoteResponse;
  expect(quote.status()).toBe(200);
  await expect(page.locator(".mv-card")).toHaveCount(1);
  const elapsed = Date.now() - started;
  const continuity = await page.evaluate(() => {
    (window as any).__quoteObserver.disconnect();
    return (window as any).__quoteContinuity;
  });
  expect(continuity).toEqual({ lostForm: false, remounted: false });
  const snapshot = await quote.json();
  const result = snapshot.messages
    .at(-1)
    .content.ui.components.find((c: any) => c.type === "relocation");
  expect(result.data.quotes[0].service_id).toBe(service.service_id);
  expect(result.data.agent_trace.uses_llm).toBe(false);
  expect(result.data.quotes[0].distance_km).toBeGreaterThan(0);
  const route = await preview;
  expect(route.status()).toBe(200);
  expect((await route.json()).route.geometry.type).toBe("LineString");
  console.log(
    JSON.stringify({
      case: "real_quote_and_route",
      elapsed_ms: elapsed,
      timing: result.data.agent_trace.timing,
      llm_calls: 0,
      continuity,
      osrm_status: route.status(),
    }),
  );
});
