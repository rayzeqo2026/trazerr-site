import { test, expect } from "@playwright/test";
import { mockSite, overflowX, AXE } from "./helpers.js";

const PAGES = ["/", "/privacy.html", "/terms.html", "/stats.html", "/employers.html"];
const WIDTHS = [320, 390, 820, 1280];

for (const theme of ["light", "dark"]) {
  test.describe(theme + " theme", () => {
    test.beforeEach(async ({ page }) => { await page.addInitScript(t => localStorage.setItem("trazerr.theme", t), theme); });

    for (const path of PAGES) {
      test(path + " loads without errors or sideways scrolling", async ({ page }) => {
        const seen = await mockSite(page);
        for (const w of WIDTHS) {
          await page.setViewportSize({ width: w, height: 800 });
          await page.goto(path, { waitUntil: "networkidle" });
          expect(await overflowX(page), "sideways scroll at " + w + "px").toBeLessThanOrEqual(0);
        }
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
        expect(seen.errors).toEqual([]);
        expect(seen.reports, "nothing blocked by the security rules").toEqual([]);
      });

      test(path + " has no serious accessibility problems", async ({ page }) => {
        await mockSite(page);
        await page.goto(path, { waitUntil: "networkidle" });
        await page.evaluate(AXE);
        const found = await page.evaluate(async () => {
          const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] });
          return r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(", "));
        });
        expect(found).toEqual([]);
      });
    }
  });
}

test("the phone header never overlaps the name and the icons", async ({ page }) => {
  await mockSite(page);
  for (const w of [320, 360, 390, 430]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto("/", { waitUntil: "networkidle" });
    const boxes = await page.evaluate(() => [".site-head .brand", "#acctBtn", "#themeToggle"].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, r: r.right }; }));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].l, "overlap at " + w + "px").toBeGreaterThanOrEqual(boxes[i - 1].r - 0.5);
  }
});

test("the theme switch changes and remembers the theme", async ({ page }) => {
  const seen = await mockSite(page);
  await page.goto("/", { waitUntil: "networkidle" });
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click("#themeToggle");
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
  await page.reload({ waitUntil: "networkidle" });
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
  expect(seen.events).toContain("theme_" + after);
});

test("errors in the page's own code are reported, at most 5 per visit", async ({ page }) => {
  const seen = await mockSite(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => { for (let i = 0; i < 7; i++) setTimeout(() => { throw new Error("Test failure " + i); }); Promise.reject(new Error("Test rejection")); });
  await page.waitForTimeout(500);
  expect(seen.reports.length).toBe(5);
  expect(seen.reports[0]).toMatchObject({ message: expect.stringContaining("Test"), where: "page" });
});

test("the page still works if its stylesheet fails to load", async ({ page }) => {
  const seen = await mockSite(page);
  await page.route("**/assets/site.css", r => r.abort());
  await page.goto("/", { waitUntil: "networkidle" });
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(1500);
  expect(seen.errors).toEqual([]);
});
