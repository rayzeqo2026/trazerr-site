import { test, expect } from "@playwright/test";
import { json, overflowX, AXE } from "./helpers.js";
import { JWT, linkHash, setup } from "./supabase-mock.js";

const CAND = { id: "c0ffee00-0000-4000-8000-000000000001", score: 86, why: ["Led a team of 9", "Trains new hires"], gap: "No budget ownership shown", location: "Newark, NJ", remoteOk: false, requested: null,
  profile: { headline: "Warehouse lead who trains teams", experience: "About 6 years", education: "", summary: "Leads a shift.", strengths: [{ name: "Team leadership", evidence: "Led a team of 9" }], roles: [], skills: ["Scheduling"] } };

for (const width of [390, 1280]) test("employers at " + width + "px: sign in, request access, then search and ask to talk", async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const state = { employer: null, requests: [] };
  let searched = null, asked = null;
  const seen = await setup(page, { row: null }, {
    employerme: r => json(r, r.request().headers().authorization === "Bearer " + JWT ? 200 : 401, { email: "hire@acme.com", employer: state.employer, requests: state.requests }),
    employerjoin: r => { const b = JSON.parse(r.request().postData()); state.employer = { company: b.company, contactName: b.contactName, website: b.website, jobTitle: b.jobTitle, status: "pending" }; return json(r, 200, { status: "pending" }); },
    searchtalent: r => { searched = JSON.parse(r.request().postData()); return json(r, 200, { poolSize: 14, candidates: [CAND] }); },
    contactrequest: r => { asked = JSON.parse(r.request().postData()); state.requests = [{ id: "q1", jobTitle: asked.jobTitle, status: "pending", createdAt: new Date().toISOString(), headline: CAND.profile.headline }]; return json(r, 200, { ok: true }); }
  });
  await page.goto("/employers.html", { waitUntil: "networkidle" });
  await expect(page.locator("#empSignin")).toBeVisible();
  await page.fill("#empEmail", "hire@acme.com");
  await page.click("#empSigninBtn");
  await expect(page.locator("#empSigninStatus")).toContainText("Check your email");
  expect(await page.evaluate(() => localStorage.getItem("trazerr.signinReturn"))).toBe("/employers.html");

  await page.goto("about:blank");
  await page.goto("/employers.html" + linkHash(), { waitUntil: "networkidle" });
  await page.fill("#jCompany", "Acme Logistics");
  await page.fill("#jName", "Pat Lee");
  await page.click("#jBtn");
  await expect(page.locator("#empApp")).toContainText("We're reviewing Acme Logistics");
  expect(await page.evaluate(() => location.hash)).toBe("");

  // After approval.
  state.employer.status = "approved";
  await page.reload({ waitUntil: "networkidle" });
  await page.fill("#sTitle", "Operations supervisor");
  await page.fill("#sLoc", "Newark, NJ");
  await page.click("#sBtn");
  await expect(page.locator(".emp-cand")).toHaveCount(1);
  await expect(page.locator(".emp-results h2")).toContainText("1 best fit");
  await expect(page.locator(".emp-cand")).toContainText("Led a team of 9");
  expect(searched).toMatchObject({ title: "Operations supervisor", location: "Newark, NJ", remote: false });
  await page.click("[data-ask='0']");
  await page.fill("#aMsg0", "We'd love to talk.");
  await page.click(".emp-ask button[type=submit]");
  await expect(page.locator(".emp-ask")).toContainText("Request sent");
  expect(asked).toEqual({ candidate: CAND.id, jobTitle: "Operations supervisor", message: "We'd love to talk." });
  await expect(page.locator("#sent")).toContainText("Waiting for a reply");

  expect(await overflowX(page)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.querySelector("#empSignOut").getBoundingClientRect().right), "Sign out fits on screen").toBeLessThanOrEqual(width - 8);
  await page.evaluate(AXE);
  const found = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] })).violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + ": " + v.nodes[0].target.join(" ")));
  expect(found).toEqual([]);
  expect(seen.errors).toEqual([]);
  expect(seen.reports).toEqual([]);
});
