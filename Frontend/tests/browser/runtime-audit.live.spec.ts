import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

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
