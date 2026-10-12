import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { vietnamToday } from "../../src/serviceRequest";

test.skip(
  process.env.RUN_RUNTIME_AUDIT !== "1",
  "Explicit real local services/LLM read audit opt-in",
);

async function signIn(page: Page) {
  const response = await page.request.post("/web/api/auth/register", {
    headers: { "X-SIU-Request": "1" },
    data: {
      name: "Runtime UI audit",
      email: randomUUID() + "@example.invalid",
      password: randomUUID(),
    },
  });
  expect(response.ok()).toBeTruthy();
}

test("real built gateway UI: flight tile form reaches the live provider without a second input turn", async ({ page }, info) => {
  await signIn(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/ai");
  await page.getByRole("button", { name: /Tìm chuyến bay Sẵn sàng/ }).click();
  const form = page.getByRole("dialog");
  const date = vietnamToday(new Date(Date.now() + 86400000));
  await form.getByLabel("Nơi đi", { exact: true }).fill("SGN");
  await form.getByLabel("Nơi đến", { exact: true }).fill("HAN");
  await form.getByLabel("Ngày bay", { exact: true }).fill(date);
  const answered = page.waitForResponse(r => r.url().endsWith("/chat") && r.request().method() === "POST", { timeout: 150000 });
  await form.getByRole("button", { name: "Tìm chuyến bay", exact: true }).click();
  const response = await answered;
  expect(response.status()).toBe(200);
  const data = await response.json();
  const content = [...data.messages].reverse().find((m: any) => m.role === "assistant")?.content;
  expect(content?.response?.kind).not.toBe("ERROR");
  expect(content?.response?.kind).not.toBe("CLARIFY");
  expect(data.state.plan.commit_actions).toEqual([]);
  const flights = (content?.ui?.components || []).filter((c: any) => c.type === "flight");
  expect(flights.flatMap((c: any) => c.data.offers || []).length).toBeGreaterThan(0);
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Chuyến bay", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("flight-form-live-desktop.png"), fullPage: true });
  // Launcher checkout configuration must reach the plan, even before a fare is selected.
  expect(data.state.checkout).toBeTruthy();
  await page.getByRole("button", { name: "Xem nhanh kế hoạch", exact: true }).click();
  const plan = page.getByRole("region", { name: "Kế hoạch trong cuộc trò chuyện", exact: true });
  await expect(plan.getByRole("tab", { name: "Thanh toán", exact: true })).toBeVisible();
  await plan.getByRole("tab", { name: "Thanh toán", exact: true }).click();
  await expect(plan.locator(".checkout-totals")).toBeVisible();
  await page.screenshot({ path: info.outputPath("checkout-tab-live.png"), fullPage: true });
});

test("real built gateway UI: housing answer renders map and keeps service navigation", async ({
  page,
}, info) => {
  await signIn(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/ai");
  const input = page.locator(".composer textarea");
  await input.fill(
    "Tìm phòng trọ tại Thành phố Hồ Chí Minh dưới 5 triệu đồng mỗi tháng",
  );
  const answered = page.waitForResponse(
    (r) => r.url().endsWith("/chat") && r.request().method() === "POST",
    { timeout: 150000 },
  );
  const viewport = page.waitForResponse(
    (r) =>
      r.url().endsWith("/platform/housing/map") &&
      r.request().method() === "POST",
    { timeout: 90000 },
  );
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  const response = await answered;
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.state.plan.commit_actions).toEqual([]);
  const mapResponse = await viewport;
  expect(mapResponse.status()).toBe(200);
  expect((await mapResponse.json()).features.length).toBeGreaterThan(0);
  await expect(page.locator(".maplibregl-canvas").first()).toBeVisible();
  await expect(
    page.getByRole("complementary", {
      name: "Nhà trong vùng bản đồ",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".ws-list").getByRole("status")).toHaveCount(0, {
    timeout: 45000,
  });
  await expect(page.locator(".ws-counter strong")).not.toHaveText("…");
  await page.screenshot({
    path: info.outputPath("housing-live-desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("real built gateway UI: viewing selection offers an explicit Moving next step without deciding the home", async ({ page }, info) => {
  await signIn(page);
  await page.goto("/ai");
  await page.locator(".composer textarea").fill("Tôi muốn tìm phòng trọ tại Quận 1, Thành phố Hồ Chí Minh dưới 5 triệu đồng/tháng và báo giá chuyển đồ tới căn tôi chọn. Chỉ tìm kiếm, chưa đặt xe.");
  const answered = page.waitForResponse(r => r.url().endsWith("/chat") && r.request().method() === "POST", { timeout: 150000 });
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  const response = await answered;
  expect(response.status()).toBe(200);
  const data = await response.json();
  await expect(page.getByRole("region", { name: "Bản đồ nhà ở", exact: true })).toBeVisible();
  const list = page.getByRole("complementary", { name: "Nhà trong vùng bản đồ", exact: true });
  await expect(list.getByRole("button", { name: "Chọn căn này", exact: true }).first()).toBeVisible({ timeout: 45000 });
  const selected = page.waitForResponse(r => r.url().endsWith("/action") && r.request().method() === "POST", { timeout: 45000 });
  await list.getByRole("button", { name: "Chọn căn này", exact: true }).first().click();
  const selection = await selected;
  expect(selection.status()).toBe(200);
  const next = await selection.json();
  expect(next.state.viewing.items.length).toBeGreaterThan(0);
  expect(next.state.intake.user_confirmed_facts["selected:property"]).toBeUndefined();
  expect(next.state.plan.commit_actions).toEqual([]);
  await expect(page.getByRole("region", { name: "Bản đồ nhà ở", exact: true })).toBeVisible();
  const step = page.getByRole("region", { name: "Bước tiếp theo trong kế hoạch", exact: true });
  await expect(step.getByRole("button", { name: "Bước tiếp theo: Chuyển đồ", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Thông tin chuyển đồ", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("housing-moving-next-step-live.png"), fullPage: true });
  await step.getByRole("button", { name: "Bước tiếp theo: Chuyển đồ", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Thông tin chuyển đồ", exact: true })).toBeVisible();
  expect(data.state.plan.commit_actions).toEqual([]);
});

test("real built gateway UI: incomplete flight chat opens an inline form and reaches live offers", async ({ page }, info) => {
  await signIn(page);
  await page.goto("/ai");
  await page.locator(".composer textarea").fill("Tôi muốn tìm chuyến bay, chỉ tìm kiếm chưa đặt vé.");
  const clarification = page.waitForResponse(r => r.url().endsWith("/chat") && r.request().method() === "POST", { timeout: 150000 });
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  expect((await clarification).status()).toBe(200);
  const form = page.getByRole("region", { name: "Bổ sung thông tin dịch vụ", exact: true });
  await expect(form).toBeVisible();
  await form.getByLabel("Nơi đi", { exact: true }).fill("SGN");
  await form.getByLabel("Nơi đến", { exact: true }).fill("HAN");
  await form.getByLabel("Ngày bay", { exact: true }).fill(vietnamToday(new Date(Date.now() + 86400000)));
  const answered = page.waitForResponse(r => r.url().endsWith("/chat") && r.request().method() === "POST", { timeout: 150000 });
  await form.getByRole("button", { name: "Tìm chuyến bay", exact: true }).click();
  const response = await answered;
  expect(response.status()).toBe(200);
  const data = await response.json();
  const content = [...data.messages].reverse().find((m: any) => m.role === "assistant")?.content;
  expect(content?.response?.kind).not.toBe("ERROR");
  expect(content?.response?.kind).not.toBe("CLARIFY");
  expect(data.state.plan.commit_actions).toEqual([]);
  const offers = (content?.ui?.components || []).flatMap((c: any) => c.type === "flight" ? c.data.offers || [] : []);
  expect(offers.length).toBeGreaterThan(0);
  await expect(page.getByRole("region", { name: "Chuyến bay", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("flight-inline-live-desktop.png"), fullPage: true });
});

test("real built UI: Moving geocodes A/B and loads real provider vehicle catalog", async ({
  page,
}, info) => {
  await signIn(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/ai");
  await page.getByRole("button", { name: /Chuyển đồ Chuyển đến/ }).click();
  await expect(page.locator(".mv-request")).toBeVisible();
  const catalog = page.waitForResponse(
    (r) => r.url().includes("/web/api/moving/services?") && r.status() === 200,
  );
  for (const [label, text] of [
    ["Địa chỉ lấy đồ", "Chợ Bến Thành"],
    ["Địa chỉ giao đồ", "Bưu điện Trung tâm Sài Gòn"],
  ]) {
    const field = page.getByRole("textbox", { name: label, exact: true });
    await field.fill(text);
    const endpoint = page.locator(".mv-endpoint").filter({ has: field });
    await endpoint.locator("button.place").first().click();
    await expect(endpoint.locator("small.ok")).toBeVisible();
  }
  const data = await (await catalog).json();
  expect(data.services.length).toBeGreaterThan(0);
  await expect(page.locator(".mv-endpoint small.ok")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Xác nhận và lấy báo giá", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("moving-live-desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("real built gateway UI: flight offers render from the live provider", async ({
  page,
}, info) => {
  await signIn(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/ai");
  await page
    .locator(".composer textarea")
    .fill(
      "Chỉ tìm chuyến bay từ Hà Nội đến Đà Nẵng ngày 15/11/2026 cho một người lớn, không đặt vé.",
    );
  const answered = page.waitForResponse(
    (r) => r.url().endsWith("/chat") && r.request().method() === "POST",
    { timeout: 150000 },
  );
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  const response = await answered;
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.state.plan.commit_actions).toEqual([]);
  const content = [...data.messages]
    .reverse()
    .find((message: any) => message.role === "assistant")?.content;
  const offers = (content?.ui?.components || []).flatMap((item: any) =>
    item.type === "flight" ? item.data.offers || [] : [],
  );
  expect(offers.length).toBeGreaterThan(0);
  await expect(
    page.getByRole("region", { name: "Chuyến bay", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("flight-live-desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
