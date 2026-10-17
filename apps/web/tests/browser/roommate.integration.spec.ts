import { test, expect } from "@playwright/test";

test("Housing Admin uses real Roommate moderation without accepting discovery terms", async ({
  page,
}) => {
  const headers = { "X-SIU-Request": "1", Origin: "http://127.0.0.1:18503" };
  const auth = await page.request.post("/web/api/auth/login", {
    headers,
    data: { email: "linh@roommate.test", password: "roommate-test-password" },
  });
  expect(auth.ok()).toBe(true);
  const upload = await page.request.post("/web/api/roommate/media", {
    headers: {
      ...headers,
      "X-Roommate-Operation": "admin-integration-photo-01",
      "Content-Type": "image/png",
    },
    data: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNeUAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  expect(upload.ok()).toBe(true);
  const media = await upload.json();
  const report = await page.request.post("/web/api/roommate/reports", {
    headers,
    data: {
      profile_id: "fixture-reviewee",
      reason: "Admin integration report",
      operation_key: "admin-integration-report-01",
    },
  });
  expect(report.ok()).toBe(true);
  await page.request.post("/web/api/logout", { headers });
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill("admin@roommate.test");
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill("roommate-test-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("button", { name: "Ở ghép", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Quản lý cộng đồng", exact: true }),
  ).toBeVisible();
  expect(
    await (await page.request.get("/web/api/roommate/access")).json(),
  ).toMatchObject({ moderator: true, eligible: false });
  await page
    .getByRole("button", { name: "Xử lý báo cáo", exact: true })
    .click();
  await page.getByRole("button", { name: "Đã xử lý", exact: true }).click();
  await expect(
    page.getByText("Admin integration report", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Ảnh hồ sơ", exact: true }).click();
  await page.getByRole("button", { name: "Duyệt ảnh", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Lý do xử lý")
    .fill("Reviewed in existing Admin workspace");
  await page
    .getByRole("button", { name: "Lưu kết quả duyệt", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const approved = await page.request.get(
    "/web/api/roommate/moderation/media?status=approved&offset=0&limit=20",
  );
  expect(
    (await approved.json()).items.some(
      (item: { media_id: string }) => item.media_id === media.media_id,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Hồ sơ", exact: true }).click();
  const candidate = page
    .locator("li")
    .filter({
      has: page.getByRole("heading", { name: "Reviewee", exact: true }),
    });
  await candidate.getByRole("button", { name: "Hạn chế", exact: true }).click();
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
      (item: { profile_id: string }) => item.profile_id === "fixture-reviewee",
    ),
  ).toBe(true);
  // Restore this shared fixture for other integration scenarios; original policy returns it paused.
  expect(
    (
      await page.request.post(
        "/web/api/roommate/moderation/profiles/fixture-reviewee",
        {
          headers,
          data: {
            selected: false,
            reason: "Integration test cleanup",
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

test("real photo upload, moderator review and explicit avatar selection", async ({
  page,
}) => {
  await page.goto("/roommate?signin=1");
  await page.getByLabel("Email", { exact: true }).fill("anna@roommate.test");
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill("roommate-test-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).focus();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("link", { name: "Hồ sơ của tôi", exact: true }).click();
  await page.getByLabel("Chọn ảnh JPEG hoặc PNG · tối đa 5 MB").setInputFiles({
    name: "synthetic-test.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNeUAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByText("Đang chờ duyệt", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dùng ảnh này", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Quản lý cộng đồng", exact: true })
    .click();
  await page.getByRole("button", { name: "Ảnh hồ sơ", exact: true }).click();
  await page.getByRole("button", { name: "Duyệt ảnh", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Lý do xử lý")
    .fill("Synthetic test image; no contact data.");
  await page
    .getByRole("button", { name: "Lưu kết quả duyệt", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Hồ sơ của tôi", exact: true }).click();
  await page.getByRole("button", { name: "Dùng ảnh này", exact: true }).click();
  await expect(
    page.getByText("Ảnh đại diện hiện tại", { exact: true }),
  ).toBeVisible();
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
