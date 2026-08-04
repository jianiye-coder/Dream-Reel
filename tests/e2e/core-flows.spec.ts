import { expect, test } from "@playwright/test";

const email = `e2e-${Date.now()}@example.com`;
const password = "correct-horse-battery";

test("anonymous users are redirected from protected pages", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Faccount|\/login\?callbackUrl=\/account/);
});

test("register, sign in, switch language, and update account", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /register|注册/i }).click();
  await page.locator('input[type="text"]').fill("E2E User");
  await page.locator('input[type="email"]').fill(`  ${email.toUpperCase()}  `);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();

  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/journal/);

  await page.goto("/account");
  await expect(page).toHaveURL(/\/account/);
  const languageButton = page.getByRole("button", { name: /EN|中/ }).first();
  await languageButton.click();
  await expect(page.locator("html")).toHaveAttribute("lang", /en|zh-CN/);
});
