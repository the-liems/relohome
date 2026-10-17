import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("public landing preserves the hero and makes every service discoverable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Tìm nơi ở mới.",
  );
  await expect(page.locator(".landing-hero-media img")).toHaveAttribute(
    "src",
    "/images/relohome-hero-home.png",
  );
  await expect
    .poll(() =>
      page
        .locator(".landing-hero-media img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".lp-service-index a")).toHaveCount(7);
  await expect(page.locator(".landing-service-grid")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Bắt đầu với AI", exact: true }),
  ).toHaveAttribute("href", "/ai");
  for (const href of await page
    .locator(".lp-service-index a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")!))) {
    await expect(page.locator(href)).toHaveCount(1);
  }
  await expect(page.locator("#next")).toContainText("Bạn tự chọn");
  await expect(page.locator("#landlord")).toContainText(
    "không phải phần mềm thu tiền thuê",
  );
  expect(errors).toEqual([]);
});

test("map and AI story controls change the illustration without submitting a task", async ({
  page,
  context,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.method() !== "HEAD" &&
      request.url().includes("/web/api")
    )
      writes.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Khu vực", exact: true }).click();
  await expect(page.locator(".lp-map-caption")).toContainText("Hiểu nhịp sống");
  await page.getByRole("button", { name: "Căn nhà", exact: true }).click();
  await expect(page.locator(".lp-map-caption")).toContainText(
    "Những căn bạn muốn cân nhắc",
  );
  const buttons = page.locator(".lp-step-selector button");
  for (let index = 0; index < 4; index++) {
    await buttons.nth(index).click();
    await expect(buttons.nth(index)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".lp-story-stage")).toContainText(
      `0${index + 1}`,
    );
  }
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Sao chép nhu cầu mẫu" }).click();
  await expect(page.getByRole("status")).toContainText("Đã sao chép");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Sau khi chọn nhà",
  );
  expect(writes).toEqual([]);
});

test("guide previews open the actual public articles, not placeholder destinations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".lp-guide-link")).toHaveCount(3);
  for (const id of ["xem-phong", "ngan-sach-thue", "hop-dong-thue"]) {
    await page.locator(`.lp-guide-link[href='/guides?article=${id}']`).click();
    await expect(page.locator(".guides-reader-header h1")).toBeVisible();
    await expect(page.locator('.guides-reader-body > section[id^="guide-section-"]')).toHaveCount(3);
    await page.goto("/");
  }
});

test("AI and landlord entry preserve the existing unauthenticated sign-in flow", async ({
  page,
}) => {
  // No account is created and no login response is fabricated.
  await page.goto("/");
  await page.getByRole("link", { name: "Bắt đầu với AI", exact: true }).click();
  await expect(page).toHaveURL(/\/ai$/);
  await expect(
    page.getByRole("heading", { name: "Chào bạn quay lại", exact: true }),
  ).toBeVisible();
  await page.goto("/");
  await page
    .getByRole("link", { name: "Mở không gian chủ nhà", exact: true })
    .click();
  await expect(page).toHaveURL(/\/landlord$/);
  await expect(
    page.getByRole("heading", { name: "Chào bạn quay lại", exact: true }),
  ).toBeVisible();
});

test("VI/EN and light/dark survive reload with no untranslated landing copy", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".landing-upgrade")).not.toContainText(
    /[àáảãạăâđèéêìíòóôơùúưỳý]/i,
  );
  await page.getByRole("button", { name: "Switch to dark mode" }).focus();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Find your next home",
  );
  await page.screenshot({
    path: info.outputPath("landing-en-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch to light mode" }).focus();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.getByRole("button", { name: "VI", exact: true }).focus();
  await page.getByRole("button", { name: "VI", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
});

test("mobile navigation supports keyboard Escape and anchored section links", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Mở điều hướng" });
  await opener.click();
  const navigation = page.getByRole("navigation", {
    name: "Điều hướng giới thiệu",
  });
  await navigation.getByRole("link", { name: "Dịch vụ", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await opener.click();
  await navigation.getByRole("link", { name: "Chủ nhà", exact: true }).click();
  await expect(page).toHaveURL(/#landlord$/);
  await expect(opener).toHaveAttribute("aria-expanded", "false");
});

for (const theme of ["light", "dark"] as const) {
  test(`responsive layout and WCAG checks (${theme}, desktop/mobile, VI/EN)`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/");
    for (const locale of ["vi", "en"]) {
      await page
        .getByRole("button", { name: locale.toUpperCase(), exact: true })
        .click();
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 960 });
        await expect(page.locator(".landing-hero-media img")).toHaveCSS(
          "animation-name",
          "none",
        );
        await expect(page.locator("#services")).not.toHaveAttribute(
          "data-motion",
          "ready",
        );
        await expect(
          page.getByRole("link", {
            name: locale === "vi" ? "Bắt đầu với AI" : "Start with AI",
            exact: true,
          }),
        ).toBeInViewport();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const audit = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(
          audit.violations.map((violation) => ({
            id: violation.id,
            nodes: violation.nodes.map((node) => node.target),
          })),
        ).toEqual([]);
      }
    }
    await page.getByRole("button", { name: "VI", exact: true }).focus();
    await page.getByRole("button", { name: "VI", exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`landing-vi-${theme}-desktop.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: info.outputPath(`landing-vi-${theme}-mobile.png`),
      fullPage: true,
    });
  });
}
