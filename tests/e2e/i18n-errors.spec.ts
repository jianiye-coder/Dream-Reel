import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("dreamreel-lang", "en");
  });
});

test("document language follows the selected locale", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.getByRole("button", { name: "中" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("English registration flow never renders a Chinese-only API error", async ({ page }) => {
  await page.route("**/api/auth/register", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "注册失败" }),
    });
  });

  await page.goto("/login");
  await page.getByRole("button", { name: "Register", exact: true }).first().click();
  await page.locator('input[type="text"]').fill("Locale Test");
  await page.locator('input[type="email"]').fill("locale@example.com");
  await page.locator('input[type="password"]').fill("password123");
  await page.locator('button[type="submit"]').click();

  await expect(page.getByText("Registration failed, please try again")).toBeVisible();
  await expect(page.getByText("注册失败", { exact: true })).toHaveCount(0);
});
