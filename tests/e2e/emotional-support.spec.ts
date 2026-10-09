import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { readFile } from "node:fs/promises";

// Synthetic session and mocked APIs: no personal records or paid model calls.
for (const lang of ["zh", "en"] as const) {
  for (const width of [390, 1440]) {
    test(`emotional support, notes and mode switching (${lang}, ${width})`, async ({ page, context }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((language) => localStorage.setItem("dreamreel-lang", language), lang);
      const secret = process.env.AUTH_SECRET || "e2e-auth-secret";
      const token = await encode({ secret, salt: "authjs.session-token", token: { sub: "7", id: "7", name: "Test User", email: "test@example.com" } });
      await context.addCookies([{ name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
      const sentGoals: string[] = [];
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/session") {
          return route.fulfill({ json: { user: { id: "7", name: "Test User" }, expires: "2099-01-01T00:00:00.000Z" } });
        }
        if (path === "/api/billing/status") return route.fulfill({ json: { isUnlimited: true, plan: "free", remaining: { analysis: 5, imageGenerations: 5 } } });
        if (path === "/api/chat-dream") {
          sentGoals.push(route.request().postDataJSON().goal);
          return route.fulfill({ json: { message: lang === "zh" ? "我们可以先聊醒来后的感受。" : "We can start with how you feel after waking.", questions: [], stage: "deepening", nextAction: "summarize", memory: { missingDetails: [], observedSignals: [] } } });
        }
        if (path === "/api/dreams") return route.fulfill({ json: { entry: { id: 7 } } });
        if (path === "/api/generate-title") return route.fulfill({ json: { title: "Morning notes" } });
        return route.fulfill({ status: 200, json: {} });
      });
      await page.goto("/journal?mode=chat");
      const support = page.getByRole("radio", { name: lang === "zh" ? "情绪支持" : "Emotional support" });
      await support.check();
      await expect(support).toBeChecked();
      await expect(page.getByRole("note")).toContainText(lang === "zh" ? "不是心理治疗或诊断" : "not therapy or diagnosis");
      const input = page.locator('textarea[name="dreamMessage"]');
      const statement = lang === "zh" ? "我记不得梦，但醒来后有些担心。" : "I do not remember the dream, but feel worried after waking.";
      await input.fill(statement);
      await input.press("Enter");
      await expect.poll(() => sentGoals).toEqual(["support"]);
      await expect(page.getByText(lang === "zh" ? "我们可以先聊醒来后的感受。" : "We can start with how you feel after waking.", { exact: true })).toBeVisible();
      await page.locator(".consultation-notes summary").click();
      await expect(page.locator(".consultation-notes textarea")).toHaveValue(new RegExp(statement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: lang === "zh" ? "下载个人记录" : "Download personal notes" }).click();
      const download = await downloaded;
      expect(download.suggestedFilename()).toMatch(/dream-reel-consultation-.*\.txt/);
      const contents = await readFile((await download.path())!, "utf8");
      expect(contents).toContain(statement);
      expect(contents).not.toContain(lang === "zh" ? "我们可以先聊醒来后的感受。" : "We can start with how you feel after waking.");
      await page.screenshot({ path: testInfo.outputPath("support.png"), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const recall = page.getByRole("radio", { name: lang === "zh" ? "回忆梦境" : "Dream recall" });
      await recall.focus();
      await page.keyboard.press("Space");
      await expect(recall).toBeChecked();
      await expect(page.getByRole("note")).toHaveCount(0);
      await input.fill(lang === "zh" ? "只记得走过一个车站。" : "I remember walking through a station.");
      await input.press("Enter");
      await expect.poll(() => sentGoals).toEqual(["support", "recall"]);
    });
  }
}
