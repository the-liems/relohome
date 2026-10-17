import { test, expect } from "@playwright/test";

test("owner deletes a legacy avatar without losing the profile or reopening photo writes", async ({
  page,
}) => {
  const headers = { "X-SIU-Request": "1", Origin: "http://127.0.0.1:18503" };
  expect(
    (
      await page.request.post("/web/api/auth/login", {
        headers,
        data: {
          email: "linh@roommate.test",
          password: "roommate-test-password",
        },
      })
    ).ok(),
  ).toBe(true);
  const before = await (
    await page.request.get("/web/api/roommate/me/profile")
  ).json();
  expect(before.avatar_id).toBeTruthy();
  const photo = before.avatar_id;
  await page.goto("/roommate?tab=profile");
  const gallery = page.getByRole("region", {
    name: "Ảnh đã lưu trước đây",
    exact: true,
  });
  await expect(gallery.locator("img")).toHaveCount(1);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await gallery
    .getByRole("button", { name: "Xóa ảnh này", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Xóa ảnh", exact: true })
    .click();
  await expect(gallery).toHaveCount(0);
  const after = await (
    await page.request.get("/web/api/roommate/me/profile")
  ).json();
  expect(after.avatar_id).toBeNull();
  expect(after.content).toEqual(before.content);
  expect(after.state).toBe(before.state);
  expect(after.version).toBe(before.version + 1);
  expect(
    (await page.request.get("/web/api/roommate/media/" + photo)).status(),
  ).toBe(404);
  expect(
    (
      await page.request.post("/web/api/roommate/media", { headers, data: {} })
    ).status(),
  ).toBe(404);
});

test("Housing Admin filters profiles, resolves reports and restricts without personal consent", async ({
  page,
}) => {
  const headers = { "X-SIU-Request": "1", Origin: "http://127.0.0.1:18503" };
  expect(
    (
      await page.request.post("/web/api/auth/login", {
        headers,
        data: {
          email: "linh@roommate.test",
          password: "roommate-test-password",
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post("/web/api/roommate/media", { headers, data: {} })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.post("/web/api/roommate/reports", {
        headers,
        data: {
          profile_id: "fixture-reviewee",
          reason: "Admin integration report",
          operation_key: "admin-integration-report-01",
        },
      })
    ).ok(),
  ).toBe(true);
  await page.request.post("/web/api/logout", { headers });
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill("admin@roommate.test");
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill("roommate-test-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: "Ở ghép", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hồ sơ và báo cáo", exact: true }),
  ).toBeVisible();
  expect(
    await (await page.request.get("/web/api/roommate/access")).json(),
  ).toMatchObject({ moderator: true, eligible: false });
  await page.getByRole("button", { name: "Xem báo cáo", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Admin integration report",
  );
  await page
    .getByRole("button", { name: "Đánh dấu đã xem xét", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Hồ sơ", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Tìm tên hoặc mã hồ sơ", exact: true })
    .fill("Reviewee");
  const row = page.getByRole("row").filter({ hasText: "Reviewee" });
  await row.getByRole("button", { name: "Xem chi tiết", exact: true }).click();
  await page
    .getByRole("button", { name: "Hạn chế tài khoản", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Lý do xử lý")
    .fill("Temporary integration moderation test");
  await page
    .getByRole("button", { name: "Xác nhận xử lý", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const restricted = await page.request.get(
    "/web/api/roommate/moderation/profiles?status=restricted",
  );
  expect(
    (await restricted.json()).items.some(
      (p: { profile_id: string }) => p.profile_id === "fixture-reviewee",
    ),
  ).toBe(true);
  const history = await page.request.get(
    "/web/api/roommate/moderation/profiles/fixture-reviewee/history?offset=0&limit=20",
  );
  expect((await history.json()).items[0].reason).toBe(
    "Temporary integration moderation test",
  );
  expect(
    (
      await page.request.post(
        "/web/api/roommate/moderation/profiles/fixture-reviewee",
        {
          headers,
          data: {
            selected: false,
            reason: "Integration cleanup",
            operation_key: "admin-integration-restore-01",
          },
        },
      )
    ).ok(),
  ).toBe(true);
  await page.getByRole("button", { name: "Duyệt tin", exact: true }).click();
  await expect(
    page.getByLabel("Tìm tin theo tiêu đề hoặc phòng"),
  ).toBeVisible();
});

test("Roommate upload and review stay unavailable through the real gateway", async ({
  page,
}) => {
  const headers = { "X-SIU-Request": "1", Origin: "http://127.0.0.1:18503" };
  await page.goto("/roommate?signin=1");
  await page.getByLabel("Email", { exact: true }).fill("anna@roommate.test");
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill("roommate-test-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).focus();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("link", { name: "Hồ sơ của tôi", exact: true }).click();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  for (const endpoint of ["media", "moderation/media/photo-old"])
    expect(
      (
        await page.request.post("/web/api/roommate/" + endpoint, {
          headers,
          data: {},
        })
      ).status(),
    ).toBe(404);
  await page
    .getByRole("link", { name: "Quản lý cộng đồng", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Ảnh hồ sơ", exact: true }),
  ).toHaveCount(0);
});

test("private introduction does not publish; profile publication, pause and resume require review", async ({
  page,
}) => {
  await page.goto("/roommate?signin=1");
  await page
    .getByRole("button", { name: "Tạo tài khoản", exact: true })
    .click();
  await page.getByLabel("Tên hiển thị", { exact: true }).fill("Mai thử nghiệm");
  await page
    .getByLabel("Email", { exact: true })
    .fill("mai-" + Date.now() + "@roommate.test");
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill("roommate-test-password");
  await page
    .getByRole("button", { name: "Tạo tài khoản", exact: true })
    .click();
  await page.getByLabel("Tôi xác nhận mình từ 18 tuổi.").check();
  await page.getByLabel(/Tôi đồng ý quy tắc sử dụng/).check();
  await page.getByRole("button", { name: "Xác nhận và tiếp tục" }).click();
  await page.getByRole("link", { name: "Hồ sơ của tôi", exact: true }).click();
  await page.getByLabel("Tên hiển thị", { exact: true }).fill("Mai thử nghiệm");
  await page
    .getByLabel("Giới thiệu ngắn", { exact: false })
    .fill("Tôi muốn cùng tìm chỗ ở và thống nhất việc dọn dẹp.");
  await page
    .getByLabel("Thành phố muốn ở", { exact: true })
    .selectOption("hcm");
  await page
    .getByLabel("Nhu cầu của bạn", { exact: true })
    .selectOption("looking_together");
  await page
    .getByRole("checkbox", { name: "Toàn TP. Hồ Chí Minh", exact: true })
    .check();
  await page
    .getByRole("spinbutton", { name: "Đến · VND/người/tháng", exact: true })
    .fill("5000000");
  await page
    .getByRole("combobox", { name: "Cơ sở chi phí", exact: true })
    .selectOption("rent_only");
  await page
    .getByRole("combobox", { name: "Thời điểm vào ở", exact: true })
    .selectOption("flexible");
  await page
    .getByRole("button", { name: "Lưu bản giới thiệu riêng", exact: true })
    .click();
  await expect(
    page.getByText("Đã lưu bản giới thiệu riêng. Chưa đăng công khai."),
  ).toBeVisible();
  await expect(page.getByText("Chưa đăng", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Xem trước để đăng nhu cầu", exact: true })
    .click();
  const publish = page.getByRole("button", {
    name: "Xác nhận đăng nhu cầu",
    exact: true,
  });
  await expect(publish).toBeDisabled();
  await page.getByLabel(/Tôi đã xem lại nội dung và muốn công khai/).check();
  await publish.click();
  await expect(page.getByText("Đang tìm", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tạm dừng", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Xác nhận", exact: true })
    .click();
  await expect(page.getByText("Tạm dừng", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tiếp tục tìm", exact: true }).click();
  const resume = page
    .getByRole("dialog")
    .getByRole("button", { name: "Xác nhận", exact: true });
  await expect(resume).toBeDisabled();
  await page.getByLabel("Thông tin này còn đúng và tôi vẫn đang tìm.").check();
  await resume.click();
  await expect(page.getByText("Đang tìm", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Xóa nhu cầu", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Xác nhận", exact: true })
    .click();
  await expect(page.getByText("Đã xóa", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Tên hiển thị", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByLabel("Giới thiệu ngắn", { exact: false }),
  ).toHaveValue("");
});
test("real browser -> session gateway -> Roommate API -> SQLite: contactless connection, chat and close", async ({
  browser,
}) => {
  const senderContext = await browser.newContext(),
    recipientContext = await browser.newContext();
  const sender = await senderContext.newPage(),
    recipient = await recipientContext.newPage();
  const errors: string[] = [];
  for (const page of [sender, recipient])
    page.on("pageerror", (error) => errors.push(error.message));
  const signIn = async (page: typeof sender, email: string) => {
    await page.goto("/roommate?signin=1");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Mật khẩu", { exact: true })
      .fill("roommate-test-password");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).focus();
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Tìm người ở cùng", exact: true }),
    ).toBeVisible();
  };
  try {
    await signIn(sender, "anna@roommate.test");
    await sender.getByRole("button", { name: "Tìm người phù hợp" }).click();
    await sender
      .locator(".rm-candidate")
      .filter({
        has: sender.getByRole("heading", { name: "Linh", exact: true }),
      })
      .getByRole("link", { name: "Xem hồ sơ", exact: true })
      .click();
    await sender
      .getByRole("button", { name: "Gửi yêu cầu kết nối", exact: true })
      .click();
    await sender
      .getByRole("dialog")
      .getByRole("button", { name: "Gửi yêu cầu kết nối", exact: true })
      .click();
    await expect(sender).toHaveURL(/\/requests\//);
    const requestId = sender.url().split("/requests/")[1];
    await expect(sender.getByText("0901234567", { exact: true })).toHaveCount(
      0,
    );
    await signIn(recipient, "linh@roommate.test");
    await recipient.goto("/roommate/requests/" + requestId);
    await recipient
      .getByRole("button", { name: "Đồng ý kết nối", exact: true })
      .click();
    await expect(
      recipient.getByText("Đã đồng ý", { exact: true }),
    ).toBeVisible();
    const recipientInput = recipient.getByRole("textbox", {
      name: "Nội dung tin nhắn",
      exact: true,
    });
    await expect(recipientInput).toBeVisible();
    const staleActor = await recipient.request.post(
      `/web/api/roommate/chat/conversations/${requestId}/messages`,
      {
        headers: {
          "X-SIU-Request": "1",
          Origin: new URL(recipient.url()).origin,
          "X-Roommate-Actor": "fixture-anna",
        },
        data: {
          body: "This stale-account message must not be sent",
          client_message_id: "stale-account-key-001",
        },
      },
    );
    expect(staleActor.status()).toBe(409);
    await recipientInput.fill("Chào bạn, mình có thể trao đổi về chỗ ở nhé.");
    await recipient.getByRole("button", { name: "Gửi", exact: true }).click();
    await sender.reload();
    await sender.getByRole("button", { name: "Nhắn tin", exact: true }).click();
    await expect(sender.locator(".contact-thread-list")).toContainText(
      "Chào bạn, mình có thể trao đổi về chỗ ở nhé.",
    );
    await sender
      .getByRole("textbox", { name: "Nội dung tin nhắn", exact: true })
      .fill("Được bạn, chúng mình cùng xem nhu cầu nhé.");
    await sender.getByRole("button", { name: "Gửi", exact: true }).click();
    await recipient.reload();
    await recipient
      .getByRole("button", { name: "Nhắn tin", exact: true })
      .click();
    await expect(recipient.locator(".contact-thread-list")).toContainText(
      "Được bạn, chúng mình cùng xem nhu cầu nhé.",
    );
    await recipient
      .getByRole("button", { name: "Ngừng kết nối", exact: true })
      .click();
    await recipient
      .getByRole("dialog")
      .getByRole("button", { name: "Ngừng kết nối", exact: true })
      .click();
    await expect(
      recipient.getByText("0901234567", { exact: true }),
    ).toHaveCount(0);
    await sender.bringToFront();
    await sender.reload();
    await sender.getByRole("button", { name: "Nhắn tin", exact: true }).click();
    await expect(
      sender.getByText(
        "Kết nối đã dừng. Bạn vẫn có thể xem lịch sử còn được phép.",
      ),
    ).toBeVisible();
    await expect(
      sender.getByRole("textbox", { name: "Nội dung tin nhắn", exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await senderContext.close();
    await recipientContext.close();
  }
});

test("owner privacy erasure clears stale contact views while retaining the session", async ({
  page,
}) => {
  await page.goto("/roommate?signin=1");
  await page.getByLabel("Email", { exact: true }).fill("anna@roommate.test");
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill("roommate-test-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).focus();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("link", { name: "Cài đặt", exact: true }).click();
  const status = await page.request.get("/web/api/roommate/me/privacy");
  expect(status.status()).toBe(200);
  expect((await status.json()).version).toBeGreaterThan(0);
  await expect(
    page.getByText("0901234567", { exact: false }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Xóa thông tin Roommate", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Xác nhận xóa thông tin", exact: true })
    .click();
  await expect(
    page.getByText("Đã xóa hồ sơ và thông tin riêng Roommate.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("0901234567", { exact: false })).toHaveCount(0);
  expect((await page.request.get("/web/api/session")).status()).toBe(200);
});
