import { expect, test, type Page } from "@playwright/test";

const email = `e2e-${Date.now()}@example.com`;
const password = "correct-horse-battery";

// Auth.js mints a new CSRF cookie for every auth request that arrives without one. On a cold
// dev server the page's first session fetches are still compiling when the form is submitted,
// and their late Set-Cookie can replace the cookie matching the token signIn() posts
// (MissingCSRF). Fetching the token up front (page.request shares the browser's cookie jar)
// means every later request carries a valid cookie.
async function primeCsrfCookie(page: Page) {
  expect((await page.request.get("/api/auth/csrf")).ok()).toBe(true);
}

test("anonymous users are redirected from protected pages", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Faccount|\/login\?callbackUrl=\/account/);
});

test("register, sign in, switch language, and update account", async ({ page, context }) => {
  await primeCsrfCookie(page);
  await page.goto("/login");
  await page.getByRole("button", { name: /register|注册/i }).first().click();
  await page.locator('input[type="text"]').fill("E2E User");
  await page.locator('input[type="email"]').fill(`  ${email.toUpperCase()}  `);
  await page.locator('input[type="password"]').fill(password);
  // Wait for the register request to finish: navigating away while it is in flight
  // aborts it and the account is never created.
  const registerResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/register") && response.request().method() === "POST",
  );
  await page.locator('button[type="submit"]').click();
  expect((await registerResponse).status()).toBe(201);
  // A successful registration signs the new account straight in.
  await expect(page).toHaveURL(/\/journal/, { timeout: 15_000 });

  // Sign out and back in with the normalised address.
  await context.clearCookies();
  await primeCsrfCookie(page);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/journal/);

  let firstDreamWrite = true;
  const savedBodies: Array<{ rawText?: string; sleepStart?: string; preSleepMeal?: string }> = [];
  const savedMethods: string[] = [];
  await page.route("**/api/dreams", async (route) => {
    const request = route.request();
    if (["POST", "PUT"].includes(request.method())) {
      savedMethods.push(request.method());
      savedBodies.push(request.postDataJSON());
      if (firstDreamWrite) {
        firstDreamWrite = false;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
    await route.continue();
  });

  await page.locator(".sleep-context-panel summary").click();
  await page.getByLabel(/Fell Asleep|入睡时间/i).fill("23:15");
  await page.getByLabel(/What you ate|昨晚吃了什么/i).fill("tea");
  await page.locator(".quick-textarea").fill("first draft of a station dream");
  await expect.poll(() => savedBodies.length, { timeout: 5_000 }).toBeGreaterThan(0);
  await page.locator(".quick-textarea").fill("latest draft of a station dream");
  await expect.poll(
    () => savedBodies.some((body) => body.rawText === "latest draft of a station dream"),
    { timeout: 6_000 },
  ).toBe(true);
  expect(savedBodies.at(-1)).toMatchObject({
    rawText: "latest draft of a station dream",
    sleepStart: "23:15",
    preSleepMeal: "tea",
  });
  expect(savedMethods).toEqual(expect.arrayContaining(["POST", "PUT"]));

  await page.goto("/account");
  await expect(page).toHaveURL(/\/account/);
  // The email comes from the client session, so once it shows the page is hydrated
  // and clicks are handled.
  await expect(page.getByText(email)).toBeVisible();

  const nameInput = page.getByPlaceholder("写在扉页上的名字");
  await expect(nameInput).toHaveValue("E2E User");
  await nameInput.fill("Renamed Dreamer");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "名字已更新" })).toBeVisible();

  await page.reload();
  await expect(page.getByText(email)).toBeVisible();
  await expect(nameInput).toHaveValue("Renamed Dreamer");
  await expect(page.locator(".nb-account .nb-owner")).toHaveText("Renamed Dreamer");

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("button", { name: "Switch to English" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "切换中文" }).first()).toBeVisible();
});

test("keyboard focus is visible and mobile microcopy stays readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toBeVisible();
  const focusStyle = await focused.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(Number.parseFloat(focusStyle.width)).toBeGreaterThanOrEqual(3);
  expect(focusStyle.style).not.toBe("none");

  // the smallest copy on the landing page is the mono kicker above the headline
  const kicker = page.locator("main .nb-kicker").first();
  await expect(kicker).toBeVisible();
  const fontSize = await kicker.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(12);
});
