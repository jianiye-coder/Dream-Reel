import { expect, test, type Page } from "@playwright/test";

const run = Date.now();
const password = "correct-horse-battery";

// see core-flows.spec.ts: fetch the CSRF token before the first auth request on a cold dev server
async function primeCsrfCookie(page: Page) {
  expect((await page.request.get("/api/auth/csrf")).ok()).toBe(true);
}

async function registerAndOpenJournal(page: Page, email: string) {
  await primeCsrfCookie(page);
  await page.goto("/login");
  await page.getByRole("button", { name: /register|注册/i }).first().click();
  await page.locator('input[type="text"]').fill("Darkroom");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  const registered = page.waitForResponse((r) => r.url().endsWith("/api/auth/register") && r.request().method() === "POST");
  await page.locator('button[type="submit"]').click();
  expect((await registered).status()).toBe(201);
  await expect(page).toHaveURL(/\/journal/, { timeout: 15_000 });
}

// the AI providers aren't reachable in tests: analysis and the image come back from stubs,
// the image after a delay, so the print has to wait in the developer for it
async function stubProviders(page: Page, imageDelayMs: number) {
  await page.route("**/api/analyze-dream", (route) => route.fulfill({
    json: { title: "Grandmother's corridor", mood: "longing", stressScore: 3, people: [], locations: ["corridor"], symbols: ["door"], sleepInsight: "", visualBrief: "a long corridor, a half-open door" },
  }));
  await page.route("**/api/generate-image", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, imageDelayMs));
    await route.fulfill({ json: { imageUrl: "/images/dream-doors.jpg" } });
  });
}

const room = (page: Page) => page.getByRole("dialog");
const surfaced = /梦境已经显影|The dream has surfaced/;

test("the darkroom runs the whole ceremony the first time, offers skip after, and reopens on the line", async ({ page }) => {
  test.setTimeout(120_000);
  await registerAndOpenJournal(page, `e2e-darkroom-${run}@example.com`);
  await stubProviders(page, 2500);

  await page.locator(".quick-textarea").fill("I walked down my grandmother's corridor and every door was half open.");
  await page.getByRole("button", { name: /整理这个梦|Read this dream/ }).first().click();
  await page.getByRole("button", { name: /生成梦境图像|Generate Dream Image/ }).first().click();

  // first time: exposure under the safelight, no skip yet
  await expect(room(page)).toBeVisible();
  await expect(room(page).getByRole("heading", { name: /把梦投在相纸上|Projecting the dream onto paper/ })).toBeVisible();
  await expect(room(page).locator('li[aria-current="step"]')).toHaveText(/曝光|Expose/);
  await expect(room(page).getByRole("button", { name: /跳过|Skip/ })).toHaveCount(0);

  // the print rocks in the developer, then goes through stop, fixer and the wash
  await expect(room(page).locator('li[aria-current="step"]')).toHaveText(/显影|Develop/, { timeout: 10_000 });
  await expect(room(page).locator('li[aria-current="step"]')).toHaveText(/水洗|Wash/, { timeout: 30_000 });

  // and hangs on the line, captioned, with what to do next
  await expect(room(page).getByRole("heading", { name: surfaced })).toBeVisible({ timeout: 20_000 });
  await expect(room(page).getByRole("img", { name: /梦境图|Dream image/ })).toBeVisible();
  await expect(room(page).getByRole("button", { name: /和 AI 聊聊|Talk it through with AI/ })).toBeVisible();
  await expect(room(page).getByRole("button", { name: /保存图片|Download image/ })).toBeEnabled();

  // a second print: the ceremony starts again, and this time it can be skipped
  await room(page).getByRole("button", { name: /关闭|Close/ }).first().click();
  await expect(room(page)).toBeHidden();
  await page.getByRole("button", { name: /再显影一张|Develop another|生成梦境图像|Generate Dream Image/ }).first().click();
  await expect(room(page).getByRole("heading", { name: /把梦投在相纸上|Projecting the dream onto paper/ })).toBeVisible();
  await room(page).getByRole("button", { name: /跳过|Skip/ }).click();
  await expect(room(page).getByRole("heading", { name: surfaced })).toBeVisible({ timeout: 10_000 });

  // opening a print that already exists goes straight to the line: no ceremony, no skip
  await room(page).getByRole("button", { name: /关闭|Close/ }).first().click();
  await page.getByRole("button", { name: /查看图像|View image/ }).first().click();
  await expect(room(page).getByRole("heading", { name: surfaced })).toBeVisible();
  await expect(room(page).getByRole("button", { name: /跳过|Skip/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(room(page)).toBeHidden();
});

test("a print that doesn't come up says so in the dark and can be tried again", async ({ page }) => {
  test.setTimeout(90_000);
  await registerAndOpenJournal(page, `e2e-darkroom-failed-${run}@example.com`);
  await page.route("**/api/generate-image", (route) => route.fulfill({ status: 500, json: { error: "IMAGE_GENERATION_FAILED" } }));
  await page.route("**/api/analyze-dream", (route) => route.fulfill({
    json: { title: "Lake", mood: "calm", stressScore: 1, people: [], locations: ["lake"], symbols: [], sleepInsight: "", visualBrief: "" },
  }));

  await page.locator(".quick-textarea").fill("A still lake at dawn.");
  await page.getByRole("button", { name: /整理这个梦|Read this dream/ }).first().click();
  await page.getByRole("button", { name: /生成梦境图像|Generate Dream Image/ }).first().click();

  await expect(room(page).getByRole("heading", { name: /这一张没有显影出来|This print didn't come up/ })).toBeVisible({ timeout: 20_000 });
  await expect(room(page).getByRole("button", { name: /重新生成|Try again/ })).toBeVisible();
  await room(page).getByRole("button", { name: /返回梦境|Back to dream/ }).click();
  await expect(room(page)).toBeHidden();
});
