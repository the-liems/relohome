import { test, expect } from "@playwright/test";
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
test("real browser -> session gateway -> Roommate API -> SQLite: send, accept, read and revoke", async ({
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
      .getByRole("button", { name: "Xem lại trước khi gửi", exact: true })
      .click();
    await sender.getByLabel(/Điện thoại: 0901234567/).check();
    await sender.getByLabel(/Tôi đã xem lại bản giới thiệu/).check();
    await sender
      .getByRole("button", { name: "Gửi yêu cầu", exact: true })
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
    await recipient.getByLabel(/Điện thoại: 0901234567/).check();
    await recipient.getByLabel(/Tôi đồng ý chia sẻ kênh đã chọn/).check();
    await recipient
      .getByRole("dialog")
      .getByRole("button", { name: "Đồng ý kết nối", exact: true })
      .click();
    await expect(
      recipient.getByText("Đã đồng ý", { exact: true }),
    ).toBeVisible();
    await recipient.bringToFront();
    await recipient
      .getByRole("button", { name: "Xem liên hệ", exact: true })
      .click();
    await expect(
      recipient.getByText("0901234567", { exact: true }),
    ).toBeVisible();
    await recipient
      .getByRole("button", { name: "Thu hồi quyền liên hệ", exact: true })
      .click();
    await recipient
      .getByRole("dialog")
      .getByRole("button", { name: "Thu hồi quyền liên hệ", exact: true })
      .click();
    await expect(
      recipient.getByText("0901234567", { exact: true }),
    ).toHaveCount(0);
    await sender.bringToFront();
    await sender
      .getByRole("button", { name: "Tải lại trạng thái", exact: true })
      .click();
    await expect(sender.getByText(/Đã thu hồi/)).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await senderContext.close();
    await recipientContext.close();
  }
});
