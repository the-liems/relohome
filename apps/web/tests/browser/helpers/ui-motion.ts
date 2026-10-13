import { expect, type Page } from "@playwright/test";

// Theme attributes update before CSS transitions finish. Check settled paints,
// while leaving animation enabled so the test exercises the real interaction.
export async function waitForUiMotion(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" &&
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              ).length,
        ),
      {
        timeout: 5000,
        message: "Finite UI animations should settle before visual assertions",
      },
    )
    .toBe(0);
}
