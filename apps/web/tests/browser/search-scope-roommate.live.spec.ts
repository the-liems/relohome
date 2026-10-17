import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

test.skip(
  process.env.RUN_SEARCH_SCOPE_ROOMMATE_BROWSER !== "1",
  "Real read providers + user-profile access checks",
);
async function signIn(page: Page) {
  if (
    process.env.ROOM_SCOPE_RESUME_RUN &&
    process.env.ROOM_SCOPE_RESUME_THREAD
  ) {
    // Reuse ONLY this harness's disposable test identity/history; no provider/LLM replay.
    const session = JSON.parse(
      execFileSync(
        "node",
        [
          "../../scripts/python.mjs",
          "-c",
          `
import json,sys
from pathlib import Path
from relohome_gateway.store import Store
root=Path.cwd()
run=sys.argv[1]
assert run.startswith('issue73-browser-') and '/' not in run and '\\\\' not in run
store=Store(root/'logs/local'/run/'web.sqlite3')
row=store.one('SELECT t.owner,u.name,u.email FROM threads t JOIN users u ON t.owner=u.id WHERE t.id=?',(sys.argv[2],))
assert row and row['name']=='Issue 73 read verification' and row['email'].endswith('@example.invalid')
print(json.dumps({'token':store.create_session(row['owner'])}))
`,
          process.env.ROOM_SCOPE_RESUME_RUN,
          process.env.ROOM_SCOPE_RESUME_THREAD,
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
    await page.goto("/ai");
    return;
  }
  const r = await page.request.post("/web/api/auth/register", {
    headers: { "X-SIU-Request": "1" },
    data: {
      name: "Issue 73 read verification",
      email: randomUUID() + "@example.invalid",
      password: randomUUID(),
    },
  });
  expect(r.ok()).toBeTruthy();
  await page.goto("/ai");
}

test("retired demo links never grant consent or expose synthetic room markers", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/roommate?tab=demo");
  await expect(page.locator(".rm-source-switch")).toHaveCount(0);
  await expect(page.getByText(/DEMO/)).toHaveCount(0);
  const availability = await (
    await page.request.get("/web/api/roommate/availability")
  ).json();
  expect(availability.demo_enabled).toBe(false);
  const access = await (
    await page.request.get("/web/api/roommate/access")
  ).json();
  expect(access.eligible).toBe(false);
  const retired = await page.request.post("/web/api/roommate/demo/search", {
    headers: { "X-SIU-Request": "1" },
    data: { criteria: { city: "hanoi" } },
  });
  expect(retired.status()).toBe(404);
  const real = await page.request.post("/web/api/roommate/search", {
    headers: { "X-SIU-Request": "1" },
    data: { criteria: { city: "hanoi" } },
  });
  expect(real.status()).toBe(403);
  const markers = await page.request.post("/web/api/roommate/map/rooms", {
    headers: { "X-SIU-Request": "1" },
    data: { listing_ids: [], include_demo: true },
  });
  expect(markers.ok()).toBe(true);
  expect(await markers.json()).toEqual({ items: [], demo_enabled: false });
});

test("ready Housing before pending Moving; current administrative polygon and explicit back-to-chat", async ({
  page,
}) => {
  await signIn(page);
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  const reply = process.env.ROOM_SCOPE_RESUME_THREAD
    ? null
    : page.waitForResponse(
        (r) => r.url().endsWith("/chat") && r.request().method() === "POST",
        { timeout: 120000 },
      );
  if (reply)
    await page
      .locator(".composer textarea")
      .fill(
        "Tìm phòng trọ ở Cầu Giấy, Hà Nội dưới 6 triệu/tháng. Sau khi tôi chọn nhà thì chuyển đồ từ Đại học Bách khoa Hà Nội đến căn đó. Chỉ tìm và chuẩn bị phương án, chưa đặt xe.",
      );
  if (reply)
    await page
      .getByRole("button", { name: "Gửi tin nhắn", exact: true })
      .click();
  if (!reply) await page.goto("/ai/" + process.env.ROOM_SCOPE_RESUME_THREAD);
  const response = reply
    ? await reply
    : await page.request.get(
        "/web/api/threads/" + process.env.ROOM_SCOPE_RESUME_THREAD,
      );
  expect(response.ok()).toBeTruthy();
  const state = await response.json();
  console.log(
    JSON.stringify({
      case: "ready_pending_services",
      thread: state.id,
      kind: state.messages.at(-1).content.response.kind,
      text: state.messages.at(-1).content.response.text,
    }),
  );
  expect(state.state.plan.commit_actions).toEqual([]);
  const alreadySelected = state.state.progress?.items.some(
    (i: any) => i.agent === "property" && i.chosen,
  );
  if (!alreadySelected) {
    await expect(page.locator(".ws-canvas")).toBeVisible();
    await expect(page.locator(".search-scope-legend")).toContainText(
      "Phường Cầu Giấy",
    );
    const housing = state.messages
      .at(-1)
      .content.ui.components.find((c: any) => c.type === "property");
    expect(housing.data.map_context.search_scope.geometry.type).toMatch(
      /^(Polygon|MultiPolygon)$/,
    );
    expect(housing.data.search_request.administrative_area_ids).toHaveLength(1);
    await expect(page.locator(".maplibregl-marker[aria-label]")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Về hội thoại", exact: true })
      .click();
    await expect(page.locator(".conversation-scroll")).toBeVisible();
    await expect(
      page.locator(".conversation-scroll .maplibregl-canvas"),
    ).toHaveCount(0);
    await page.waitForTimeout(250);
    await expect(page.locator(".conversation-scroll")).toBeVisible();
    await page.locator(".plan-peek-tab").click();
    await page
      .locator(".plan-open-service")
      .filter({ hasText: "Tìm nhà" })
      .click();
    await expect(page.locator(".ws-canvas")).toBeVisible();
    await page.locator(".ws-list .ws-select-small").first().click();
  }
  await expect(page.locator(".mv-request")).toBeVisible();
  await expect(page.locator(".mv-request input[type=date]")).toHaveValue("");
  await expect(page.locator(".mv-request input[type=time]")).toHaveValue("");
  await page.getByRole("button", { name: "Về hội thoại", exact: true }).click();
  await expect(page.locator(".completed-result-detail").first()).toBeVisible();
  await page.locator(".plan-peek-tab").click();
  const roomResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/roommate/map/rooms") &&
      r.request().method() === "POST",
    { timeout: 60000 },
  );
  await page
    .locator(".plan-open-service")
    .filter({ hasText: "Tìm nhà" })
    .click();
  await expect(page.locator(".search-scope-legend")).toContainText(
    "Phường Cầu Giấy",
  );
  const roomPayload = await (await roomResponse).json();
  expect(
    roomPayload.items.every(
      (item: { source_kind: string }) => item.source_kind === "real",
    ),
  ).toBe(true);
  await expect(page.getByText(/Hiện phòng DEMO/)).toHaveCount(0);
  const cards = page.locator(".ws-card .title-button");
  await expect(cards.first()).toBeVisible();
  await cards.first().click();
  await expect(page.locator(".ws-detail-body")).toBeVisible();
  await expect(
    page.locator(".ws-roommate-badge").filter({ hasText: "DEMO" }),
  ).toHaveCount(0);
  expect(failures).toEqual([]);
});
