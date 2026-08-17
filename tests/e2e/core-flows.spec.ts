import { expect, test } from "@playwright/test";

const email = `e2e-${Date.now()}@example.com`;
const password = "correct-horse-battery";

test("anonymous users are redirected from protected pages", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Faccount|\/login\?callbackUrl=\/account/);
});

test("register, sign in, switch language, and update account", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /register|注册/i }).first().click();
  await page.locator('input[type="text"]').fill("E2E User");
  await page.locator('input[type="email"]').fill(`  ${email.toUpperCase()}  `);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();

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
  const languageButton = page.getByRole("button", { name: /EN|中/ }).first();
  await languageButton.click();
  await expect(page.locator("html")).toHaveAttribute("lang", /en|zh-CN/);
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

  const caption = page.locator(".hero-film-caption");
  if (await caption.count()) {
    const typography = await caption.evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: Number.parseFloat(style.fontSize), color: style.color };
    });
    expect(typography.fontSize).toBeGreaterThanOrEqual(12);
    expect(typography.color).not.toContain("0.42");
  }
});
