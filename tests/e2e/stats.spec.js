import { test, expect } from "@playwright/test";
import { mockSite, json, overflowX, AXE } from "./helpers.js";

const today = new Date().toISOString().slice(0, 10);
const STATS = {
  period: "30 days", totals: { visit: 1234, dna_built: 132, fit_check: 58, error_server: 1 },
  funnel: { "visits that started a Career DNA": "14%" }, recentFeedback: [],
  recentErrors: [{ at: new Date().toISOString(), where: "server", action: "analyze", message: "Anthropic 529" }],
  lastKeepalive: new Date().toISOString(), byDay: { [today]: { visit: 40, dna_built: 5 } }
};

test("the usage page asks for the key, then shows counts, errors and health", async ({ page }) => {
  const seen = await mockSite(page, {
    stats: (r, url) => url.searchParams.get("key") === "right-key" ? json(r, 200, STATS) : json(r, 404, { error: "Unknown request." }),
    dbstatus: r => json(r, 200, { configured: true, reachable: true, tableExists: true, services: { upstashRedis: "ok", anthropicKey: true, adzunaKeys: true, statsKey: true, errorAlerts: false } })
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/stats.html", { waitUntil: "networkidle" });
  await page.fill("#key", "wrong");
  await page.click("#keyForm button");
  await expect(page.locator("#gateStatus")).toContainText("didn't work");
  await page.fill("#key", "right-key");
  await page.click("#keyForm button");
  await expect(page.locator("#visits")).toHaveText("1,234");
  await expect(page.locator("#errors")).toContainText("Anthropic 529");
  await expect(page.locator("#health")).toContainText("Last ran");
  await expect(page.locator("#health")).toContainText("Off (add RESEND_API_KEY");
  expect(await overflowX(page)).toBeLessThanOrEqual(0);
  await page.evaluate(AXE);
  const found = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] })).violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id));
  expect(found).toEqual([]);
  // The key is remembered for this tab only.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("#visits")).toHaveText("1,234");
  expect(seen.errors).toEqual([]);
});
