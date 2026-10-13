// Actual local gateway, LLM, MCP/PostGIS and map. No provider interception/replay.
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

test.skip(
  process.env.RUN_HOUSING_COMPARISON_BROWSER !== "1",
  "Opt-in real read-only services (#75)",
);

test("user-reported legacy conversation reopens its saved housing map read-only without a new chat", async ({
  page,
}) => {
  const thread = process.env.HOUSING_COMPARISON_LEGACY_THREAD;
  test.skip(
    !thread,
    "Only an explicitly supplied local conversation; browse without changing it",
  );
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
store=Store(Path.cwd()/'data/siu-web.sqlite3')
row=store.one('SELECT owner FROM threads WHERE id=?',(sys.argv[1],))
assert row
print(json.dumps({'token':store.create_session(row['owner'])}))
`,
        thread!,
      ],
      { encoding: "utf8", env: process.env },
    ),
  );
  await page
    .context()
    .addCookies([
      {
        name: "siu_session",
        value: session.token,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(r.method()))
      writes.push(new URL(r.url()).pathname);
  });
  await page.goto("http://127.0.0.1:8503/ai/" + thread);
  await page.locator(".plan-peek-tab").click();
  await page
    .locator(".plan-open-service")
    .filter({ hasText: "Tìm nhà" })
    .click();
  await expect(page.locator(".ws-canvas")).toBeVisible();
  await expect(
    page.locator(".conversation-scroll .housing-comparison"),
  ).toHaveCount(0);
  expect(
    writes.some((path) =>
      /\/(chat|action|decision|quote|payment)(\/|$)/.test(path),
    ),
  ).toBe(false);
  console.log(
    JSON.stringify({
      case: "legacy_saved_map",
      thread,
      original_map_opened: true,
      chat_or_transaction_writes: 0,
    }),
  );
});

test("chosen home and original search/map survive separate three/four-way comparison and reload", async ({
  page,
}) => {
  test.setTimeout(360000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const resume = process.env.HOUSING_COMPARISON_RESUME_THREAD;
  if (resume) {
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
run=sys.argv[1]
assert run.startswith('issue75-browser-') and '/' not in run and '\\\\' not in run
store=Store(Path.cwd()/'logs/local'/run/'web.sqlite3')
row=store.one('SELECT t.owner,u.name,u.email FROM threads t JOIN users u ON t.owner=u.id WHERE t.id=?',(sys.argv[2],))
assert row and row['name']=='Issue 75 comparison verification' and row['email'].endswith('@example.invalid')
print(json.dumps({'token':store.create_session(row['owner'])}))
`,
          process.env.ROOM_SCOPE_RESUME_RUN!,
          resume,
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
  } else {
    const registration = await page.request.post("/web/api/auth/register", {
      headers: { "X-SIU-Request": "1" },
      data: {
        name: "Issue 75 comparison verification",
        email: randomUUID() + "@example.invalid",
        password: randomUUID(),
      },
    });
    expect(registration.ok()).toBe(true);
  }
  await page.goto("/ai");
  async function ask(text: string) {
    await page.locator(".composer textarea").fill(text);
    const pending = page.waitForResponse(
      (r) => r.url().endsWith("/chat") && r.request().method() === "POST",
      { timeout: 150000 },
    );
    await page
      .getByRole("button", { name: "Gửi tin nhắn", exact: true })
      .click();
    const response = await pending;
    expect(response.ok()).toBe(true);
    const thread = await response.json();
    expect(thread.state.plan?.commit_actions || []).toEqual([]);
    console.log(
      JSON.stringify({
        case: "comparison_turn",
        thread: thread.id,
        kind: thread.messages.at(-1).content.response.kind,
        text: thread.messages.at(-1).content.response.text,
      }),
    );
    return thread;
  }
  const first = resume
    ? await (await page.request.get("/web/api/threads/" + resume)).json()
    : await ask(
        "Tìm đúng 4 căn nhà ở Hà Nội dưới 7 triệu/tháng. Sau khi tôi chọn nhà, chuẩn bị chuyển đồ từ Đại học Bách khoa Hà Nội đến căn đó. Chỉ tra cứu, chưa đặt xe.",
      );
  const original = first.messages
    .flatMap((m: any) => m.content.ui?.components || [])
    .find((c: any) => c.type === "property" && !c.data.comparison);
  expect(original).toBeTruthy();
  const ids = original.data.candidates.map((c: any) => c.id);
  expect(ids).toHaveLength(4);
  if (!resume) {
    const selected = await page.request.post(
      `/web/api/threads/${first.id}/action`,
      {
        headers: { "X-SIU-Request": "1" },
        data: {
          request_id: randomUUID(),
          kind: "select",
          task_id: original.task_id,
          plan_version: first.state.plan.version,
          fetched_at: original.fetched_at,
          entity_id: ids[0],
        },
      },
    );
    expect(selected.ok()).toBe(true);
  }
  await page.goto("/ai/" + first.id);
  const lastReply = first.messages.at(-1).content;
  const completedThree =
    !!resume &&
    ["ANSWER", "PARTIAL"].includes(lastReply.response.kind) &&
    lastReply.ui?.components.some(
      (c: any) => c.data.comparison?.rows.length === 3,
    );
  if (!completedThree) {
    await expect(page.locator(".mv-request")).toBeVisible();
    await page
      .getByRole("button", { name: "Về hội thoại", exact: true })
      .click();
  }
  await expect(page.locator(".conversation-scroll")).toBeVisible();
  const second = completedThree
    ? first
    : await ask(
        "So sánh 3 căn đầu trong danh sách ban đầu về giá, cọc và diện tích. Giữ nguyên căn đã chọn và phương án chuyển đồ.",
      );
  const compare = second.messages
    .at(-1)
    .content.ui.components.find((c: any) => c.data.comparison);
  expect(compare.task_id).not.toBe(original.task_id);
  expect(compare.data.comparison.rows.map((r: any) => r.id).sort()).toEqual(
    ids.slice(0, 3).sort(),
  );
  expect(
    second.messages.at(-1).content.response.text.split(/\s+/).length,
  ).toBeLessThanOrEqual(65);
  const searchStep = second.state.progress.items.find(
    (i: any) => i.task_id === original.task_id,
  );
  expect(searchStep.chosen.id).toBe(ids[0]);
  expect(searchStep.inputs.max_price_vnd).toBe(7000000);
  expect(
    second.state.progress.items.filter((i: any) => i.agent === "property"),
  ).toHaveLength(1);
  const moveStep = second.state.progress.items.find(
    (i: any) => i.agent === "relocation",
  );
  expect(moveStep.inputs.to_address).toBe("selected:property");
  await expect(page.locator(".housing-comparison").last()).toBeVisible();
  await expect(
    page.locator(".housing-comparison details").last(),
  ).not.toHaveAttribute("open");
  // Plan -> original map, not scrolling the analysis. Reload must keep that identity.
  await page.reload();
  await page.locator(".plan-peek-tab").click();
  await page
    .locator(".plan-open-service")
    .filter({ hasText: "Tìm nhà" })
    .click();
  await expect(page.locator(".ws-canvas")).toBeVisible();
  await expect(
    page.locator(".conversation-scroll .housing-comparison"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Về hội thoại", exact: true }).click();
  await expect(page.locator(".housing-comparison").last()).toBeVisible();
  const third = await ask(
    "Thêm căn thứ tư trong danh sách ban đầu vào bảng. Kiểm tra các căn này với mức giá 5–7 triệu/tháng, nhưng không tìm mới và không thay căn đã chọn.",
  );
  const expanded = third.messages
    .at(-1)
    .content.ui.components.find((c: any) => c.data.comparison);
  expect(expanded.task_id).toBe(compare.task_id);
  expect(expanded.data.comparison.rows.map((r: any) => r.id).sort()).toEqual(
    [...ids].sort(),
  );
  expect(
    third.state.progress.items.find((i: any) => i.task_id === original.task_id)
      .chosen.id,
  ).toBe(ids[0]);
  expect(
    third.state.progress.items.find((i: any) => i.task_id === original.task_id)
      .inputs.max_price_vnd,
  ).toBe(7000000);
  const expectedOutside = expanded.data.comparison.rows
    .filter(
      (r: any) =>
        r.rent_vnd != null && (r.rent_vnd < 5000000 || r.rent_vnd > 7000000),
    )
    .map((r: any) => r.id)
    .sort();
  expect(
    expanded.data.comparison.price_outside_requested_range_ids.sort(),
  ).toEqual(expectedOutside);
  if (expectedOutside.length)
    await expect(page.locator(".housing-comparison").last()).toContainText(
      "ngoài khoảng giá",
    );
  const blocked = await page.request.post(
    `/web/api/threads/${first.id}/action`,
    {
      headers: { "X-SIU-Request": "1" },
      data: {
        request_id: randomUUID(),
        kind: "select",
        task_id: expanded.task_id,
        plan_version: third.state.plan.version,
        fetched_at: expanded.fetched_at,
        entity_id: ids[0],
      },
    },
  );
  expect(blocked.status()).toBe(409);
  console.log(
    JSON.stringify({
      case: "comparison_isolation",
      thread: first.id,
      search_task: original.task_id,
      comparison_task: compare.task_id,
      exact_ids: true,
      selected_home_preserved: true,
      original_map_opened: true,
      transactions: 0,
    }),
  );
  expect(errors).toEqual([]);
});
