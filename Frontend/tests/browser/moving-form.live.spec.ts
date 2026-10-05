import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.skip(
  process.env.RUN_LIVE_MOVING_BROWSER !== "1",
  "Explicit real staging browser opt-in required",
);

for (const rejectFirst of [false, true]) {
  test(`real form continuity (${rejectFirst ? "rejection and retry" : "fresh thread"})`, async ({
    page,
  }) => {
    const response = await page.request.post("/web/api/auth/register", {
      headers: { "X-SIU-Request": "1" },
      data: {
        name: "Moving browser verification",
        email: randomUUID() + "@example.invalid",
        password: randomUUID(),
      },
    });
    expect(response.ok()).toBeTruthy();
    await page.goto("/ai");
    await page.getByRole("button", { name: /Chuyển đồ Chuyển đến/ }).click();
    const form = page.locator(".mv-request");
    await expect(form).toBeVisible();
    const discovered = page.waitForResponse(
      (r) =>
        r.url().includes("/web/api/moving/services?") && r.status() === 200,
    );
    for (const [label, text] of [
      ["Địa chỉ lấy đồ", "Chợ Bến Thành"],
      ["Địa chỉ giao đồ", "Bưu điện Trung tâm Sài Gòn"],
    ]) {
      await page.getByRole("textbox", { name: label, exact: true }).fill(text);
      const endpoint = page.locator(".mv-endpoint").filter({
        has: page.getByRole("textbox", { name: label, exact: true }),
      });
      await endpoint.locator("button.place").first().click();
      await expect(endpoint.locator("small.ok")).toBeVisible();
    }
    const service = page.getByRole("combobox", { name: "Gói dịch vụ AhaMove" });
    await expect(service).toBeEnabled();
    await expect
      .poll(() => service.locator("option").count())
      .toBeGreaterThan(1);
    // An operator selects a service actually returned by the provider, not a product rule.
    const catalog = await (await discovered).json();
    const observedId = catalog.services.find(
      (s: any) => s.delivery_type === "TRUCK",
    )?.service_id;
    expect(observedId).toBeTruthy();
    await service.selectOption(observedId!);
    const pickup = await page
      .getByRole("textbox", { name: "Địa chỉ lấy đồ", exact: true })
      .inputValue();
    const destination = await page
      .getByRole("textbox", { name: "Địa chỉ giao đồ", exact: true })
      .inputValue();
    const date = page.locator('input[type="date"]'),
      time = page.locator('input[type="time"]');
    const asLocal = (timestamp: number) => {
      const d = new Date(timestamp + 7 * 60 * 60 * 1000);
      return [d.toISOString().slice(0, 10), d.toISOString().slice(11, 16)];
    };
    if (rejectFirst) {
      const soon = asLocal(Date.now() + 10 * 60 * 1000);
      await date.fill(soon[0]);
      await time.fill(soon[1]);
      // > now passes the UI but < 30 minutes triggers the real backend's 422 guard.
      const rejected = page.waitForResponse(
        (r) =>
          r.url().endsWith("/moving/quote") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Xác nhận và lấy báo giá", exact: true })
        .click();
      expect((await rejected).status()).toBe(422);
      await expect(
        page.getByRole("button", {
          name: "Xác nhận và lấy báo giá",
          exact: true,
        }),
      ).toBeEnabled();
      await expect(form).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Địa chỉ lấy đồ", exact: true }),
      ).toHaveValue(pickup);
      await expect(
        page.getByRole("textbox", { name: "Địa chỉ giao đồ", exact: true }),
      ).toHaveValue(destination);
      await expect(service).toHaveValue(observedId!);
      await expect(page.locator(".mv-endpoint small.ok")).toHaveCount(2);
    }

    const future = asLocal(Date.now() + 24 * 60 * 60 * 1000);
    await date.fill(future[0]);
    await time.fill("10:00");
    await page.evaluate(() => {
      const original = document.querySelector(".mv-request");
      const state = { lostFormBeforeQuotes: false, remounted: false };
      (window as any).__movingUi = state;
      const watch = new MutationObserver(() => {
        if (!document.querySelector(".mv-card")) {
          if (!document.querySelector(".mv-request"))
            state.lostFormBeforeQuotes = true;
          else if (document.querySelector(".mv-request") !== original)
            state.remounted = true;
        }
      });
      watch.observe(document.body, { subtree: true, childList: true });
      (window as any).__movingWatch = watch;
    });
    const quoted = page.waitForResponse(
      (r) =>
        r.url().endsWith("/moving/quote") && r.request().method() === "POST",
    );
    const started = Date.now();
    await page
      .getByRole("button", { name: "Xác nhận và lấy báo giá", exact: true })
      .click();
    const quote = await quoted;
    expect(quote.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Chọn gói xe phù hợp", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".mv-card")).toHaveCount(1);
    const continuity = await page.evaluate(() => {
      (window as any).__movingWatch.disconnect();
      return (window as any).__movingUi;
    });
    expect(continuity).toEqual({
      lostFormBeforeQuotes: false,
      remounted: false,
    });
    const result = await quote.json();
    expect(result.state.plan.commit_actions).toEqual([]);
    console.log(
      JSON.stringify({
        case: "real_browser_form",
        rejectFirst,
        elapsed_ms: Date.now() - started,
        ...continuity,
      }),
    );
  });
}
