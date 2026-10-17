import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { waitForUiMotion } from "./helpers/ui-motion";

async function fixture(page: Page) {
  await page.route("**/web/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          id: "layout-user",
          name: "An",
          email: "an@example.test",
          preferences: {},
        },
      });
    if (path.endsWith("/status"))
      return route.fulfill({
        json: { domains: ["property", "flight", "map", "relocation"] },
      });
    if (path.endsWith("/threads") || path.endsWith("/saved"))
      return route.fulfill({ json: [] });
    if (path.endsWith("/moving/services"))
      return route.fulfill({ json: { services: [] } });
    return route.fulfill({ json: {} });
  });
}

test("short welcome keeps all service choices and starter prompts above the composer", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const measurements: unknown[] = [];
  for (const [width, height] of [
    [1920, 990],
    [1536, 792],
    [1440, 900],
    [1024, 768],
    [768, 1024],
    [1366, 650],
    [390, 680],
    [320, 640],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      for (const resume of [false, true]) {
        await page.goto("/ai");
        await page.evaluate((resume) => {
          localStorage.setItem(
            "siu-ui-preferences",
            JSON.stringify({
              locale: "vi",
              theme: document.documentElement.dataset.theme,
            }),
          );
          if (resume)
            localStorage.setItem(
              "relohome-active-chat:layout-user",
              JSON.stringify({
                threadId: "th_layout",
                expiresAt: Date.now() + 86400000,
              }),
            );
          else localStorage.removeItem("relohome-active-chat:layout-user");
        }, resume);
        await page.reload();
        await expect(page.locator(".quick-card")).toHaveCount(6);
        await page.evaluate(() => document.fonts.ready);
        await waitForUiMotion(page);
        const geometry = await page
          .locator(".conversation-scroll")
          .evaluate((el) => {
            const box = el.getBoundingClientRect();
            return {
              overflow: el.scrollHeight - el.clientHeight,
              scrollTop: el.scrollTop,
              bottom: box.bottom,
              top: box.top,
              controls: [
                ...el.querySelectorAll(
                  ".welcome-heading, .welcome h1, .quick-card, .starter > button, .resume-chat, .welcome-note",
                ),
              ].map((control) => {
                const bounds = control.getBoundingClientRect();
                return {
                  top: bounds.top,
                  bottom: bounds.bottom,
                  height: bounds.height,
                  interactive: control.matches("button, a"),
                };
              }).filter((control) => control.height > 0 || control.interactive),
            };
          });
        measurements.push({ width, height, theme, resume, ...geometry });
        await page.screenshot({
          path: info.outputPath(`welcome-${theme}-${width}-${resume}.png`),
        });
        expect(geometry.overflow, JSON.stringify(geometry)).toBeLessThanOrEqual(
          1,
        );
        expect(geometry.scrollTop).toBe(0);
        for (const control of geometry.controls) {
          expect(control.top).toBeGreaterThanOrEqual(geometry.top - 1);
          expect(control.bottom).toBeLessThanOrEqual(geometry.bottom + 1);
          if (control.interactive) expect(control.height).toBeGreaterThanOrEqual(44);
        }
      }
    }
  }
  await info.attach("welcome-layout.json", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
});

test("moving payment label remains AA after actual animated theme switches", async ({
  page,
}, info) => {
  const duplicateKeys: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && message.text().includes("same key")) duplicateKeys.push(message.text());
  });
  await fixture(page);
  await page.emulateMedia({
    reducedMotion: "no-preference",
    colorScheme: "light",
  });
  await page.goto("/ai");
  await page.locator('.quick-card[data-service="relocation"]').click();
  await page.locator(".moving-booking").waitFor();
  const label = page.locator(".mv-payment-tile strong");
  const measurements: unknown[] = [];
  await label.scrollIntoViewIfNeeded();
  for (const theme of ["light", "dark", "light"] as const) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
      await page.locator(".theme-switch").focus();
      await page.locator(".theme-switch").click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await waitForUiMotion(page);
    const contrast = await label.evaluate((el) => {
      const rgb = (color: string) =>
        color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => value / 255);
      const luminance = (color: string) =>
        rgb(color)
          .map((value) =>
            value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
          )
          .reduce(
            (sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i],
            0,
          );
      const color = getComputedStyle(el).color;
      let parent: Element | null = el;
      while (
        parent &&
        ["rgba(0, 0, 0, 0)", "transparent"].includes(
          getComputedStyle(parent).backgroundColor,
        )
      )
        parent = parent.parentElement;
      const background = getComputedStyle(parent!).backgroundColor;
      const foregroundL = luminance(color),
        backgroundL = luminance(background);
      return {
        color,
        background,
        ratio:
          (Math.max(foregroundL, backgroundL) + 0.05) /
          (Math.min(foregroundL, backgroundL) + 0.05),
      };
    });
    measurements.push({ theme, ...contrast });
    await page.screenshot({
      path: info.outputPath(`moving-payment-${theme}.png`),
    });
    expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(
      4.5,
    );
    const audit = await new AxeBuilder({ page })
      .include(".mv-payment-tile")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations.map((v) => v.id)).toEqual([]);
  }
  await info.attach("moving-contrast.json", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
  expect(duplicateKeys).toEqual([]);
});
