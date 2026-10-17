import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const listing = "aaaaaaaa-1111-4111-8111-111111111111";
const existingId = "bbbbbbbb-1111-4111-8111-111111111111";
const review = {
  id: existingId,
  property_id: "cccccccc-1111-4111-8111-111111111111",
  property_name: "Nhà Nguyễn Trãi",
  rating: 4,
  body: "Phòng sáng và trao đổi rõ ràng.",
  stage: "viewed",
  created_at: "2026-10-09T10:00:00Z",
  updated_at: "2026-10-09T10:00:00Z",
  reply_body: null,
  reply_at: null,
  author_label: "Người thuê",
};

async function fixture(
  page: Page,
  mode: "tenant" | "owner" | "moderator" = "tenant",
) {
  let mine: any = null,
    withdrawn = false,
    hidden = false,
    reply = "",
    reported = false,
    reviewed = false;
  let failSave = false,
    failRead = false;
  const calls: { path: string; method: string; body: any; search: string }[] =
    [];
  const house = {
    id: listing,
    title: "Phòng thử nghiệm đánh giá",
    address: "Hà Nội",
    price_vnd: 4500000,
    area_m2: 25,
    management: {
      publication_status: "published",
      availability_status: "vacant",
      accepts_contact_requests: false,
      availability_confirmed_at: null,
      host_rating: 4,
      host_review_count: 1,
    },
  };
  function summary() {
    const values = [
      review.rating,
      ...(mine && !withdrawn ? [mine.rating] : []),
    ];
    return {
      rating: values.reduce((a, b) => a + b, 0) / values.length,
      count: values.length,
      property_count: 1,
      histogram: Object.fromEntries(
        [1, 2, 3, 4, 5].map((n) => [n, values.filter((v) => v === n).length]),
      ),
    };
  }
  await page.route("**/web/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace("/web/api", ""),
      method = route.request().method();
    const body = route.request().postDataJSON();
    calls.push({ path, method, body, search: url.search });
    if (path === "/session")
      return route.fulfill({
        json: {
          id: mode,
          name: "Mai",
          email: "mai@example.test",
          preferences: {},
          ...(mode === "moderator" ? { is_admin: true } : {}),
        },
      });
    if (path === "/threads") return route.fulfill({ json: [] });
    if (path === "/status")
      return route.fulfill({ json: { domains: ["property"], status: "ok" } });
    if (path === "/saved")
      return route.fulfill({ json: [{ id: listing, thread_id: "", house }] });
    if (path === `/housing/${listing}`) return route.fulfill({ json: house });
    if (path.endsWith("/events"))
      return route.fulfill({ json: { recorded: true } });
    if (path.endsWith(`/housing/${listing}/reviews`)) {
      if (failRead)
        return route.fulfill({
          status: 503,
          json: { detail: "Chưa tải được đánh giá." },
        });
      return route.fulfill({
        json: {
          summary: summary(),
          property_summary: summary(),
          items: [review, ...(mine && !withdrawn ? [mine] : [])],
          mine: mine
            ? { ...mine, status: withdrawn ? "withdrawn" : "published" }
            : null,
          can_review: true,
          next_offset: null,
        },
      });
    }
    if (path.endsWith(`/housing/${listing}/review`)) {
      if (method === "DELETE") {
        withdrawn = true;
        return route.fulfill({ json: { withdrawn: true } });
      }
      if (failSave)
        return route.fulfill({
          status: 400,
          json: { detail: "Không đưa số điện thoại vào đánh giá." },
        });
      // The gateway names public authors from the account; anonymous ones stay unnamed.
      mine = {
        ...review,
        ...body,
        id: "dddddddd-1111-4111-8111-111111111111",
        author_name: body.is_anonymous === false ? "Mai" : null,
      };
      withdrawn = false;
      return route.fulfill({ json: mine });
    }
    if (path.endsWith("/landlord/overview"))
      return route.fulfill({
        json: {
          properties: 1,
          units: 1,
          vacant: 1,
          new_contacts: 0,
          measured_since: null,
          detail_views: 0,
          saves: 0,
          contact_requests: 0,
        },
      });
    if (path.endsWith("/landlord/properties"))
      return route.fulfill({ json: { items: [] } });
    if (path.endsWith("/landlord/contact-requests"))
      return route.fulfill({ json: { items: [] } });
    if (path.endsWith("/host/profile"))
      return route.fulfill({
        json: {
          profile:
            mode === "moderator"
              ? null
              : {
                  user_id: mode,
                  poster_type: "owner",
                  display_name: "Mai",
                  status: "verified",
                  revision: 1,
                },
          terms_version: null,
        },
      });
    if (path.endsWith("/moderation/housing/queue"))
      return route.fulfill(
        mode === "moderator"
          ? { json: { hosts: [], properties: [], listings: [] } }
          : { status: 403, json: { detail: "Forbidden" } },
      );
    if (path.endsWith("/moderation/housing/listings"))
      return route.fulfill({ json: { items: [], total: 0 } });
    if (path.endsWith("/landlord/reviews"))
      return route.fulfill({
        json: {
          summary: summary(),
          items: [{ ...review, reply_body: reply || null }],
          next_offset: null,
        },
      });
    if (path.endsWith("/reply")) {
      reply = body.body;
      return route.fulfill({ json: { reply_body: reply } });
    }
    if (path.endsWith("/report")) {
      reported = true;
      return route.fulfill({ json: { reported: true } });
    }
    if (path.endsWith("/moderation/housing/reviews"))
      return route.fulfill({
        json: {
          items: hidden
            ? []
            : [
                {
                  ...review,
                  report_count: 1,
                  reports: [
                    {
                      id: "report1",
                      reason: "Nội dung cần xem xét.",
                      created_at: review.created_at,
                    },
                  ],
                },
              ],
          flags: reviewed
            ? []
            : [
                {
                  id: "eeeeeeee-1111-4111-8111-111111111111",
                  host_name: "Chủ nhà thử nghiệm",
                  kind: "repeated_low_ratings",
                  evidence: {
                    qualifies: true,
                    author_count: 3,
                    property_count: 2,
                    review_count: 4,
                    window_days: 90,
                    computed_at: review.created_at,
                  },
                },
              ],
          next_offset: null,
        },
      });
    if (path.endsWith("/decision")) {
      hidden = true;
      return route.fulfill({ json: { status: "hidden" } });
    }
    if (path.includes("/flags/") && path.endsWith("/review")) {
      reviewed = true;
      return route.fulfill({ json: { reviewed: true } });
    }
    return route.fulfill({
      status: 404,
      json: { detail: "Missing test route" },
    });
  });
  return {
    calls,
    failSave: () => {
      failSave = true;
    },
    failRead: () => {
      failRead = true;
    },
    canRead: () => {
      failRead = false;
    },
    reported: () => reported,
  };
}
async function openDetail(page: Page) {
  await page.goto("/account");
  await page.getByRole("tab", { name: /Đã lưu/ }).click();
  await page.getByRole("button", { name: /Xem chi tiết/ }).click();
  await expect(
    page.getByRole("heading", { name: "Đánh giá chủ nhà" }),
  ).toBeVisible();
}
async function audit(page: Page) {
  // Check the settled theme, after finite color transitions have completed.
  await page.evaluate(() => Promise.all(
    document.getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => {})),
  ));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => v.id),
    JSON.stringify(result.violations.map((v) => v.nodes.map((n) => n.failureSummary))),
  ).toEqual([]);
}
test("tenant writes, edits, sorts and withdraws a review without exposing identity", async ({
  page,
}, info) => {
  const { calls } = await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openDetail(page);
  await expect(page.getByText(/Nhà đang xem:/)).toBeVisible();
  await page.getByRole("button", { name: "Viết đánh giá" }).click();
  await expect(
    page.getByRole("button", { name: "Lưu đánh giá" }),
  ).toBeDisabled();
  await page.getByText("5 sao", { exact: true }).click();
  await page
    .getByLabel("Nhận xét (không bắt buộc)")
    .fill("Trao đổi lịch xem thuận tiện.");
  await audit(page);
  await page.getByRole('heading',{name:'Đánh giá chủ nhà'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('tenant-review.png')});
  await page.getByRole("button", { name: "Lưu đánh giá" }).click();
  await expect(page.getByText("Đã lưu đánh giá của bạn.")).toBeVisible();
  // Anonymous unless the tenant chooses to show their account name.
  expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
    rating: 5,
    body: "Trao đổi lịch xem thuận tiện.",
    is_anonymous: true,
  });
  await page.getByRole("button", { name: "Sửa đánh giá" }).click();
  await expect(page.getByLabel("Nhận xét (không bắt buộc)")).toHaveValue(
    "Trao đổi lịch xem thuận tiện.",
  );
  await page.getByText("3 sao", { exact: true }).click();
  await page.getByRole("radio", { name: /Công khai/ }).check();
  await page.getByRole("button", { name: "Lưu đánh giá" }).click();
  await expect
    .poll(() => calls.filter((c) => c.method === "PUT").at(-1)?.body)
    .toEqual({ rating: 3, body: "Trao đổi lịch xem thuận tiện.", is_anonymous: false });
  const own = page.locator(".hr-review").filter({ hasText: "Trao đổi lịch xem thuận tiện." });
  await expect(own.locator(".hr-author strong")).toHaveText("Mai");
  await expect(own.locator(".hr-visibility")).toHaveText("Công khai");
  await page.getByLabel("Sắp xếp đánh giá").selectOption("lowest");
  await expect
    .poll(() => calls.some((c) => c.search.includes("sort=lowest")))
    .toBeTruthy();
  await page.getByRole("button", { name: "Rút đánh giá", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Rút đánh giá" })
    .getByRole("button", { name: "Rút đánh giá", exact: true })
    .click();
  await expect(
    page.getByText("Đã rút đánh giá. Điểm này không còn được tính."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("tenant errors preserve the rating and draft, and loading can be retried", async ({
  page,
}) => {
  const f = await fixture(page);
  f.failRead();
  await openDetail(page);
  await expect(page.getByText("Chưa tải được đánh giá.")).toBeVisible();
  f.canRead();
  await page
    .locator(".hr-panel")
    .getByRole("button", { name: "Thử lại" })
    .click();
  await page.getByRole("button", { name: "Viết đánh giá" }).click();
  await page.getByText("4 sao", { exact: true }).click();
  await page
    .getByLabel("Nhận xét (không bắt buộc)")
    .fill("Nội dung cần giữ khi lỗi.");
  f.failSave();
  await page.getByRole("button", { name: "Lưu đánh giá" }).click();
  await expect(page.getByLabel("Nhận xét (không bắt buộc)")).toHaveValue(
    "Nội dung cần giữ khi lỗi.",
  );
  await expect(page.getByRole("radio", { name: "4 sao" })).toBeChecked();
});
test("landlord replies and reports, with accessible dark mode", async ({
  page,
}, info) => {
  const f = await fixture(page, "owner");
  await page.goto("/landlord");
  await page
    .locator(".ll-nav")
    .getByRole("button", { name: "Đánh giá", exact: true })
    .click();
  await page.getByRole("button", { name: "Trả lời đánh giá" }).click();
  await page.getByLabel("Trả lời đánh giá").fill("Cảm ơn phản hồi của bạn.");
  await page.getByRole("button", { name: "Lưu phản hồi" }).click();
  await expect(page.getByText("Cảm ơn phản hồi của bạn.")).toBeVisible();
  await page.getByRole("button", { name: "Báo cáo đánh giá" }).click();
  await page.getByLabel("Lý do báo cáo").fill("Cần kiểm tra đúng địa điểm.");
  await page.getByRole("button", { name: "Gửi báo cáo" }).click();
  await expect.poll(f.reported).toBeTruthy();
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tenant reviews" }),
  ).toBeVisible();
  await page.getByRole('button',{name:'Switch to dark mode'}).focus();
  await page.getByRole('button',{name:'Switch to dark mode'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await audit(page);
  await page.screenshot({path:info.outputPath('landlord-review-dark-en.png')});
});
test("moderator hides a reported review and acknowledges a multi-property flag", async ({
  page,
}) => {
  const { calls } = await fixture(page, "moderator");
  await page.goto("/admin");
  await page
    .locator(".ll-nav")
    .getByRole("button", { name: "Đánh giá & báo cáo", exact: true })
    .click();
  await expect(page.getByText("Nội dung cần xem xét.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ẩn đánh giá" }),
  ).toBeDisabled();
  await page.getByLabel("Lý do ẩn đánh giá").fill("Nội dung vi phạm quy định.");
  await page.getByRole("button", { name: "Ẩn đánh giá" }).click();
  await expect(
    page.getByText("Chưa có báo cáo đánh giá cần xử lý."),
  ).toBeVisible();
  expect(calls.find((c) => c.path.endsWith("/decision"))?.body).toEqual({
    decision: "hide",
    reason: "Nội dung vi phạm quy định.",
  });
  await page.getByRole("button", { name: "Đã rà soát cảnh báo" }).click();
  await expect(page.getByText("Chưa có cảnh báo cần rà soát.")).toBeVisible();
  await audit(page);
});
