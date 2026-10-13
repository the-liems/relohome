import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

test.skip(
  process.env.RUN_SEARCH_SCOPE_ROOMMATE_BROWSER !== "1",
  "Real read providers + authorized DEMO opt-in",
);
async function signIn(page: Page) {
  if (
    process.env.ROOM_SCOPE_RESUME_RUN &&
    process.env.ROOM_SCOPE_RESUME_THREAD
  ) {
    // Reuse ONLY this harness's disposable test identity/history; no provider/LLM replay.
    const session = JSON.parse(
      execFileSync(
        "../.venv/Scripts/python.exe",
        [
          "-c",
          `
import json,sys
from pathlib import Path
from Frontend.store import Store
root=Path.cwd().parent
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
        { encoding: "utf8", env: { ...process.env, PYTHONPATH: ".." } },
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

test("DEMO is browseable without granting real consent; map links are labeled and disconnected", async ({
  page,
}) => {
  const datasetPath = execFileSync(
    "../.venv/Scripts/python.exe",
    [
      "-c",
      "from dotenv import dotenv_values; print(dotenv_values('../.env.local')['ROOMMATE_DEMO_DATASET'])",
    ],
    { encoding: "utf8" },
  ).trim();
  const dataset = JSON.parse(readFileSync("../" + datasetPath, "utf-8"));
  const hanoiCount = dataset.profiles.filter(
    (profile: any) => profile.content.facts.city === "hanoi",
  ).length;
  const mappedCount = dataset.profiles.filter(
    (profile: any) => profile.content.room,
  ).length;
  await signIn(page);
  await page.goto("/roommate?tab=demo");
  await expect(
    page.getByRole("heading", {
      name: "Hồ sơ DEMO — không phải người thật",
    }),
  ).toBeVisible();
  await expect(page.locator(".rm-candidate-list > li")).toHaveCount(
    Math.min(hanoiCount, 12),
  );
  await expect(
    page.getByText(`${hanoiCount} hồ sơ DEMO còn hiệu lực tại Hà Nội`, {
      exact: true,
    }),
  ).toBeVisible();
  if (hanoiCount > 12) {
    await page.getByRole("button", { name: "Sau", exact: true }).click();
    await expect(
      page.getByText(`13–${Math.min(24, hanoiCount)} / ${hanoiCount}`, {
        exact: true,
      }),
    ).toBeVisible();
  }
  const access = await (
    await page.request.get("/web/api/roommate/access")
  ).json();
  expect(access.eligible).toBe(false);
  const real = await page.request.post("/web/api/roommate/search", {
    headers: { "X-SIU-Request": "1" },
    data: { criteria: { city: "hanoi" } },
  });
  expect(real.status()).toBe(403);
  const ids = [
    ...new Set(
      dataset.profiles
        .filter((p: any) => p.content.room)
        .map((p: any) => p.content.room.listing_id),
    ),
  ];
  const request = (include_demo: boolean) =>
    page.request.post("/web/api/roommate/map/rooms", {
      headers: { "X-SIU-Request": "1" },
      data: { listing_ids: ids, include_demo },
    });
  const hidden = await request(false);
  expect(hidden.ok()).toBeTruthy();
  expect((await hidden.json()).items).toEqual([]);
  const shown = await request(true);
  expect(shown.ok()).toBeTruthy();
  const markers = (await shown.json()).items;
  expect(markers).toHaveLength(mappedCount);
  expect(
    markers.every(
      (p: any) =>
        p.source_kind === "demo" &&
        p.connections_enabled === false &&
        p.label.includes("minh họa"),
    ),
  ).toBe(true);
  expect(page.getByRole("button", { name: /Gửi yêu cầu kết nối/ })).toHaveCount(
    0,
  );
  console.log(
    JSON.stringify({
      case: "demo_isolation",
      people: dataset.profiles.length,
      mapped_demo_profiles: markers.length,
      real_consent_granted: false,
    }),
  );
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
  expect(roomPayload.items.some((i: any) => i.source_kind === "demo")).toBe(
    true,
  );
  const cards = page.locator(".ws-card .title-button");
  await expect(cards.first()).toBeVisible();
  let foundDemo = false;
  for (let i = 0; i < (await cards.count()); i++) {
    await cards.nth(i).click();
    await expect(page.locator(".ws-detail-body")).toBeVisible();
    if (await page.locator(".ws-roommate-badge").count()) {
      await expect(page.locator(".ws-roommate-badge").first()).toContainText(
        "DEMO",
      );
      foundDemo = true;
      break;
    }
    await page
      .getByRole("button", { name: "Đóng chi tiết", exact: true })
      .click();
  }
  expect(foundDemo).toBe(true);
  await page.screenshot({
    path: "../data/issue73-browser-results/actual-scope-demo-yellow.png",
  });
  expect(failures).toEqual([]);
});
