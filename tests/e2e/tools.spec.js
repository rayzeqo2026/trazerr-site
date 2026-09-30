import { test, expect } from "@playwright/test";
import { mockSite, buildDNA, job, json } from "./helpers.js";

test.use({ viewport: { width: 390, height: 844 } });

test("pasting a resume builds a Career DNA", async ({ page }) => {
  const seen = await mockSite(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await buildDNA(page);
  await expect(page.locator("#oBody")).toContainText("Team leadership");
  expect(seen.events).toEqual(expect.arrayContaining(["dna_started", "dna_built"]));
  expect(seen.errors).toEqual([]);
});

test("an analysis error is shown in plain words", async ({ page }) => {
  await mockSite(page, { analyze: r => json(r, 503, { error: "Trazerr is busy right now. Try again in a minute." }) });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.fill("#paste", "Sam Rivera\nWarehouse Lead, Example Co. 2019 - present\nLed a team of 9 and cut picking errors by 20%");
  await page.click("#analyzeBtn");
  await expect(page.locator("body")).toContainText("Trazerr is busy right now");
});

test("job search lists openings, and Check my fit works while a new search loads", async ({ page }) => {
  let release;
  const slow = new Promise(r => { release = r; });
  let calls = 0;
  const seen = await mockSite(page, {
    jobs: async (r) => { calls++; if (calls === 2) await slow; return json(r, 200, { jobs: calls === 1 ? [job(1), job(2)] : [job(3)], source: "adzuna", hasMore: false }); }
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await buildDNA(page);
  await page.keyboard.press("Escape");
  await page.fill("#jq", "supervisor");
  await page.click("#jobsBtn");
  await expect(page.locator("#jobList .job")).toHaveCount(2);
  // Start a second search that hasn't answered yet, then use a button from the first results.
  await page.fill("#jq", "lead");
  await page.click("#jobsBtn");
  await page.locator("#jobList [data-fit]").nth(1).click();
  await expect(page.locator("#oBody")).toContainText("A strong fit.");
  release();
  expect(seen.errors).toEqual([]);
});
