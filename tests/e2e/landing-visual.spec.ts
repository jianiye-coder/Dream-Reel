import { expect, test } from "@playwright/test";

for (const width of [320, 390, 430]) {
  for (const lang of ["zh", "en"] as const) {
    test(`landing hero ${width}px ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((selectedLanguage) => {
        localStorage.setItem("dreamreel-lang", selectedLanguage);
      }, lang);
      await page.goto("/");
      await page.addStyleTag({
        content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }",
      });
      await expect(page.locator(".morning-hero")).toHaveScreenshot(
        `landing-hero-${width}-${lang}.png`,
        { animations: "disabled" },
      );
    });
  }
}
