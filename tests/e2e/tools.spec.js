import { test, expect } from "@playwright/test";
import { mockSite, buildDNA, job, json, PROFILE } from "./helpers.js";

test.use({ viewport: { width: 390, height: 844 } });

test("pasting a resume builds a Career DNA", async ({ page }) => {
  const seen = await mockSite(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await buildDNA(page);
  await expect(page.locator("#oBody")).toContainText("Team leadership");
  expect(seen.events).toEqual(expect.arrayContaining(["dna_started", "dna_built"]));
  expect(seen.errors).toEqual([]);
});

test("uploading a Word resume reads its text and builds a Career DNA", async ({ page }) => {
  let sent = null;
  const seen = await mockSite(page, { analyze: (r) => { sent = JSON.parse(r.request().postData()); return json(r, 200, { profile: PROFILE }); } });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.setInputFiles("#file", new URL("../fixtures/resume.docx", import.meta.url).pathname);
  await expect(page.locator("#fileName")).toHaveText("resume.docx");
  await page.click("#analyzeBtn");
  await page.waitForSelector("#acctSaveBtn", { timeout: 15000 });
  expect(sent.kind).toBe("text");
  expect(sent.text).toContain("Led a team of 9");
  expect(seen.errors).toEqual([]);
  expect(seen.reports, "nothing blocked by the security rules").toEqual([]);
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

test("a link from a job alert email runs that search", async ({ page }) => {
  let asked = null;
  const seen = await mockSite(page, { jobs: (r, url) => { asked = Object.fromEntries(url.searchParams); return json(r, 200, { jobs: [job(1), job(2)], source: "adzuna", hasMore: false }); } });
  await page.goto("/?q=supervisor&where=Newark%2C+NJ&src=alert#jobs", { waitUntil: "networkidle" });
  await expect(page.locator("#jobList .job")).toHaveCount(2);
  expect(asked).toMatchObject({ q: "supervisor", where: "Newark, NJ" });
  expect(seen.events).toContain("alert_opened");
  expect(seen.errors).toEqual([]);
});

const JOB_DNA = { title: "Operations Supervisor", summary: "Leads a night shift and owns picking accuracy.", level: "Mid-level", mustHaves: ["3+ years in a warehouse"], niceToHaves: [], hidden: [], evidence: ["Led a team of 10 or more"] };

test("Job DNA from an uploaded Word posting: the text fills the box, then builds as usual", async ({ page }) => {
  let sent = null;
  const seen = await mockSite(page, { jobdna: r => { sent = JSON.parse(r.request().postData()); return json(r, 200, { dna: JOB_DNA }); } });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.setInputFiles("#postingFile", new URL("../fixtures/posting.docx", import.meta.url).pathname);
  await expect(page.locator("#postingText")).toHaveValue(/lead a night shift team of 10-15 associates/);
  await expect(page.locator("#postingFileName")).toHaveText("posting.docx");
  await page.click("#jobdnaBtn");
  await expect(page.locator("#oBody")).toContainText("Leads a night shift");
  expect(sent.text).toContain("Must have 3+ years");
  expect(sent.file).toBeUndefined();
  expect(seen.events).toContain("posting_file");
  expect(seen.errors).toEqual([]);
  expect(seen.reports).toEqual([]);
});

test("Job DNA from an uploaded PDF: the file is sent, and its text comes back for fit checks", async ({ page }) => {
  let sent = null, fitJob = null;
  const seen = await mockSite(page, {
    jobdna: r => { sent = JSON.parse(r.request().postData()); return json(r, 200, { dna: { ...JOB_DNA, postingText: "Operations Supervisor - Acme Logistics\nLead a night shift team of 10-15 associates. Must have 3+ years of warehouse experience and 1+ year leading a team." } }); },
    match: r => { fitJob = JSON.parse(r.request().postData()).job; return json(r, 200, { fit: { fitScore: 80, summary: "A good fit.", factors: [], strengths: [], gaps: [], unknowns: [], tips: [] } }); }
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await buildDNA(page);
  await page.keyboard.press("Escape");
  await page.fill("#postingText", "");
  await page.setInputFiles("#postingFile", new URL("../fixtures/posting.pdf", import.meta.url).pathname);
  await expect(page.locator("#jobdnaStatus")).toContainText("Ready to read posting.pdf");
  await page.click("#postingFitBtn");
  await expect(page.locator("#jobdnaStatus")).toContainText("Build Job DNA first");
  await page.click("#jobdnaBtn");
  await expect(page.locator("#oBody")).toContainText("Leads a night shift");
  expect(sent.file.kind).toBe("pdf");
  expect(sent.file.data.length).toBeGreaterThan(100);
  expect(sent.text).toBeUndefined();
  await expect(page.locator("#postingText")).toHaveValue(/Must have 3\+ years/);
  await page.click("#dnaFitBtn");
  await expect(page.locator("#oBody")).toContainText("A good fit.");
  expect(fitJob.description).toContain("Lead a night shift team");
  expect(seen.errors).toEqual([]);
});
