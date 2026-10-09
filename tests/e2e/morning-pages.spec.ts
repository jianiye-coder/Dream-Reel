import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";

import type { DrawingStroke } from "../../src/lib/morningDrawing";
type PageEntry = { date: string; content: string; drawing?: DrawingStroke[]; revision: number; updatedAt: string };

test.beforeEach(async ({ context, baseURL, page }) => {
  const token = await encode({
    token: { sub: "1", id: "1", name: "Morning Pages Test" },
    secret: process.env.AUTH_SECRET || "e2e-auth-secret",
    salt: "authjs.session-token",
  });
  await context.addCookies([{ name: "authjs.session-token", value: token, url: baseURL! }]);
  await page.addInitScript(() => localStorage.setItem("dreamreel-lang", "en"));
});

async function mockPages(page: import("@playwright/test").Page, options: { failSave?: boolean; conflict?: boolean; delay?: number } = {}) {
  const entries = new Map<string, PageEntry>();
  const writes: string[] = [];
  entries.set("2026-09-01", { date: "2026-09-01", content: "An earlier morning.", revision: 1, updatedAt: "2026-09-01T08:00:00Z" });
  await page.route("**/api/morning-pages**", async (route) => {
    const request = route.request();
    const date = new URL(request.url()).searchParams.get("date");
    if (request.method() === "GET") {
      return route.fulfill({ json: date ? { entry: entries.get(date) ?? null } : { entries: [...entries.values()] } });
    }
    const body = request.postDataJSON();
    if (request.method() === "DELETE") {
      entries.delete(body.date);
      return route.fulfill({ json: { ok: true } });
    }
    writes.push(body.content);
    if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
    if (options.failSave) return route.fulfill({ status: 500, json: { error: "INTERNAL_ERROR" } });
    if (options.conflict) return route.fulfill({ status: 409, json: { error: "CONFLICT" } });
    const entry = { date: body.date, content: body.content, drawing: body.drawing, revision: body.revision + 1, updatedAt: new Date().toISOString() };
    entries.set(body.date, entry);
    return route.fulfill({ json: { entry } });
  });
  return { entries, writes };
}

test("autosaves latest text, switches dates, finishes, downloads and deletes", async ({ page }) => {
  const { writes } = await mockPages(page, { delay: 600 });
  await page.goto("/morning-pages");
  const editor = page.getByRole("textbox", { name: "Morning page content" });
  await editor.fill("First thought");
  await expect.poll(() => writes.length).toBe(1);
  await editor.fill("The thought I actually want to keep.");
  await expect(page.locator("footer").getByRole("status")).toHaveText("Saved");
  expect(writes.at(-1)).toBe("The thought I actually want to keep.");
  await page.getByRole("button", { name: "Sep 1, 2026", exact: true }).click();
  await expect(editor).toHaveValue("An earlier morning.");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(editor).toHaveValue("The thought I actually want to keep.");
  await page.getByRole("button", { name: "Finish writing" }).click();
  await expect(page.getByRole("heading", { name: "Your morning page is saved" })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download text" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^morning-pages-.*\.txt$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe("The thought I actually want to keep.");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(editor).toHaveValue("");
});

test("failed save keeps text and prevents switching dates until retry succeeds", async ({ page }) => {
  const options = { failSave: true };
  await mockPages(page, options);
  await page.goto("/morning-pages");
  const editor = page.getByRole("textbox", { name: "Morning page content" });
  await editor.fill("Keep this even when offline.");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not complete");
  await page.getByRole("button", { name: "Sep 1, 2026", exact: true }).click();
  await expect(editor).toHaveValue("Keep this even when offline.");
  options.failSave = false;
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.locator("footer").getByRole("status")).toHaveText("Saved");
});

test("conflicts never overwrite another window and offer draft recovery", async ({ page }) => {
  const { writes } = await mockPages(page, { conflict: true });
  await page.goto("/morning-pages");
  await page.getByRole("textbox", { name: "Morning page content" }).fill("My local version");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("another window");
  await expect(page.getByRole("button", { name: "Finish writing" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Morning page content" }).fill("My local version updated");
  await page.waitForTimeout(1000);
  expect(writes).toHaveLength(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Load latest" }).click();
  await expect(page.getByRole("textbox", { name: "Morning page content" })).toHaveValue("");
});

test("load failure cannot turn an existing entry into an empty editable page", async ({ page }) => {
  await page.route("**/api/morning-pages**", (route) => route.fulfill({ status: 500, json: { error: "INTERNAL_ERROR" } }));
  await page.goto("/morning-pages");
  await expect(page.getByText("Could not load this page")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Morning page content" })).toHaveCount(0);
});

for (const width of [390, 1440]) {
  test(`responsive writing surface at ${width}px in both languages`, async ({ page }, testInfo) => {
    await mockPages(page);
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/morning-pages");
    await expect(page.getByRole("textbox", { name: "Morning page content" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`morning-pages-${width}-en.png`), fullPage: true });
    await page.getByRole("button", { name: "切换中文", exact: true }).click();
    await expect(page.getByRole("heading", { name: "晨间自由书写" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`morning-pages-${width}-zh.png`), fullPage: true });
  });
}

test("requires sign-in", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/morning-pages");
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
});

test("drawing autosaves, restores, erases, undoes, clears and exports a PNG", async ({ page }, testInfo) => {
  const { entries } = await mockPages(page);
  await page.goto("/morning-pages");
  await page.getByRole("button", { name: "Write / Draw" }).click();
  const canvas = page.getByRole("img", { name: "Handwriting and drawing canvas" });
  const bounds = (await canvas.boundingBox())!;
  const draw = async (fromX: number, fromY: number, toX: number, toY: number) => {
    await page.mouse.move(bounds.x + bounds.width * fromX, bounds.y + bounds.height * fromY);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * toX, bounds.y + bounds.height * toY, { steps: 12 });
    await page.mouse.up();
  };
  await page.getByRole("button", { name: "Green", exact: true }).click();
  await draw(.2, .2, .7, .7);
  await expect(page.locator("footer").getByRole("status")).toHaveText("Saved");
  const today = [...entries.keys()].find((date) => date !== "2026-09-01")!;
  expect(entries.get(today)?.drawing?.[0].color).toBe("#356859");
  const paintedPixels = () => canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext("2d")!;
    return context.getImageData(0, 0, 1000, 700).data.filter((alpha, index) => index % 4 === 3 && alpha > 0).length;
  });
  expect(await paintedPixels()).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  await page.getByRole("slider", { name: "Size" }).fill("10");
  await draw(.2, .2, .7, .7);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await paintedPixels()).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(paintedPixels).toBeLessThan(100);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear canvas" }).click();
  await expect.poll(paintedPixels).toBe(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Sep 1, 2026", exact: true }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect.poll(paintedPixels).toBeGreaterThan(100);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download drawing" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).subarray(1, 4).toString()).toBe("PNG");
  await page.screenshot({ path: testInfo.outputPath("morning-pages-drawing.png"), fullPage: true });
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("textbox", { name: "Morning page content" }).fill("Words alongside the sketch.");
  await page.getByRole("button", { name: "Finish writing" }).click();
  expect(entries.get(today)?.drawing?.length).toBe(1);
  expect(entries.get(today)?.content).toBe("Words alongside the sketch.");
});

test("touch drawing works on a narrow screen without overflow", async ({ page }, testInfo) => {
  const { entries } = await mockPages(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/morning-pages");
  await page.getByRole("button", { name: "Write / Draw" }).click();
  const canvas = page.getByRole("img", { name: "Handwriting and drawing canvas" });
  await canvas.scrollIntoViewIfNeeded();
  const bounds = (await canvas.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bounds.x + 40, y: bounds.y + 40 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: bounds.x + 120, y: bounds.y + 100 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator("footer").getByRole("status")).toHaveText("Saved");
  expect([...entries.values()].some((entry) => entry.drawing?.[0]?.points.length === 2)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("morning-pages-mobile-drawing.png"), fullPage: true });
});
