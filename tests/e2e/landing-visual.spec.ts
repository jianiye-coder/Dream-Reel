import { expect, test, type Locator } from "@playwright/test";

import { writtenDate } from "../../src/lib/dates";
import { translations } from "../../src/lib/i18n";

// The phone hero, checked by layout rather than pixels. Pixel baselines can't stay honest here:
// the demo dream is typed in by JS timers (CSS `animations: "disabled"` can't stop it), the date
// line is today's date, and Playwright keeps one baseline per OS while CI runs on Linux and
// people run e2e on macOS. With reduced motion and a fixed clock the page is fully written at
// once, so what the screenshots were guarding (nothing clipped, overlapping or off-screen at
// 320–430px in either language) can be asserted directly. A screenshot is still attached to
// the report for a human look.
const MORNING = new Date("2026-03-14T06:42:00");

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, "element has a layout box").not.toBeNull();
  return b!;
}

for (const width of [320, 390, 430]) {
  for (const lang of ["zh", "en"] as const) {
    test(`landing hero ${width}px ${lang}`, async ({ page }, testInfo) => {
      const L = translations[lang].nbLanding;
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.clock.setFixedTime(MORNING);
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((selectedLanguage) => {
        localStorage.setItem("dreamreel-lang", selectedLanguage);
      }, lang);
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);

      const stage = page.locator(".nb-stage");
      const title = stage.getByRole("heading", { level: 1 });
      const body = stage.locator(".nb-hero-r .nb-body");
      const cta = stage.getByRole("link", { name: L.heroCta });
      const entry = stage.locator(".nb-entry");

      // phones skip the cover and open straight onto the written page
      await expect(stage.locator(".nb-cover")).toBeHidden();
      await expect(title).toHaveText(`${L.heroTitleA}${L.heroTitleB}${L.heroTitleEm}${L.heroTitleC}`);
      await expect(body).toHaveText(L.heroBody);
      await expect(cta).toHaveAttribute("href", "/journal");
      const { day, weekday } = writtenDate(MORNING, lang);
      await expect(stage.locator(".nb-date-line").first()).toContainText(`${day}${weekday}`);
      await expect(entry).toHaveText(L.demo.map((part) => part.text).join(""));
      await expect(stage.locator(".nb-clues .nb-note")).toHaveText(L.clues);

      // nothing scrolls sideways, and every hero block sits inside the viewport
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
      const blocks = [title, body, cta, stage.getByRole("link", { name: L.heroCtaQuiet }), entry];
      for (const block of blocks) {
        const b = await box(block);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(width);
      }

      // no line runs past its own box (a word or title too long to wrap at this width)
      for (const block of [title, body, entry]) {
        const runsOver = await block.evaluate((el) => el.scrollWidth > el.clientWidth);
        expect(runsOver, "a line runs past its box").toBe(false);
      }

      // the reading order holds: title above body above the calls to action, which don't overlap
      const [t, b, c] = [await box(title), await box(body), await box(cta)];
      expect(t.y + t.height).toBeLessThanOrEqual(b.y);
      expect(b.y + b.height).toBeLessThanOrEqual(c.y);
      const actions = await stage.locator(".nb-hero-r .nb-cta-row > *").all();
      const rects = await Promise.all(actions.map(box));
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const [p, q] = [rects[i], rects[j]];
          const overlap = p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
          expect(overlap, `calls to action ${i} and ${j} overlap`).toBe(false);
        }
      }

      await testInfo.attach(`landing-hero-${width}-${lang}.png`, {
        body: await stage.screenshot({ animations: "disabled", caret: "hide" }),
        contentType: "image/png",
      });
    });
  }
}
