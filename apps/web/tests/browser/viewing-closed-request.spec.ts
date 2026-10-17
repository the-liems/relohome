import { expect, test } from "@playwright/test";

for (const requestStatus of ["resolved", "declined", "viewing"]) {
  test(`viewing ${requestStatus}: closed requests need a new booking; open confirmations allow recording`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const nextSlot = "2026-10-12T09:00:00+07:00";
    const item = {
      listing_id: "listing-viewing",
      title: "Phòng kiểm thử lịch xem",
      status: "visit_due",
      snapshot: { address: "Hà Nội", price_vnd: 4500000 },
      viewing: { slot: "2026-10-09T09:00:00+07:00" },
      landlord: { request_status: requestStatus, viewing_status: "confirmed" },
    };
    const thread = {
      id: "th_viewing",
      title: "Kiểm tra lịch xem",
      updated: 1791540000,
      revision: 1,
      messages: [],
      runs: [],
      state: {
        plan: { version: 1, tasks: [] },
        intake: { user_confirmed_facts: {} },
        viewing: { max_selected: 4, items: [item], slots: [nextSlot] },
      },
    };
    const schedules: unknown[] = [];
    await page.route("**/web/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname.replace(
        "/web/api",
        "",
      );
      let data: unknown = {};
      if (path === "/session")
        data = { id: "tenant", name: "Mai", preferences: {} };
      else if (path === "/status")
        data = { status: "ok", domains: ["property"] };
      else if (path === "/threads" || path === "/saved") data = [];
      else if (path === "/threads/th_viewing") data = thread;
      else if (path === "/threads/th_viewing/viewings") data = thread.state.viewing;
      else if (path.endsWith("/viewings/schedule")) {
        schedules.push(route.request().postDataJSON());
        item.status = "viewing_scheduled";
        item.viewing.slot = nextSlot;
        item.landlord = { request_status: "new", viewing_status: "requested" };
        data = thread.state.viewing;
      }
      await route.fulfill({ json: data });
    });
    await page.goto("/ai/th_viewing?panel=plan&planTab=viewing");
    const panel = page.locator(".viewing-panel");
    await expect(panel.getByText(item.title, { exact: true })).toBeVisible();
    const record = panel.getByRole("button", {
      name: "Đã gặp, đồng ý",
      exact: true,
    });
    if (requestStatus === "viewing") {
      await expect(record).toBeVisible();
    } else {
      await expect(
        panel.getByText("Yêu cầu với chủ nhà đã đóng, đặt lại giờ để gửi lại", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(record).toHaveCount(0);
      await expect(page.getByRole("checkbox", { name: `Đặt lịch cho ${item.title}`, exact: true })).not.toBeChecked();
      await page.getByLabel(`Giờ xem · ${item.title}`, {exact: true}).selectOption(nextSlot);
      await page.getByRole("button", {name: "Đi tiếp", exact: true}).click();
      await page.getByRole("button", {name: "Xác nhận 1 lịch", exact: true}).click();
      await expect
        .poll(() => schedules)
        .toEqual([{ listing_id: item.listing_id, slot: nextSlot }]);
      await expect(
        panel.getByText("Đã gửi giờ hẹn, chờ chủ nhà xác nhận", {
          exact: true,
        }),
      ).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
