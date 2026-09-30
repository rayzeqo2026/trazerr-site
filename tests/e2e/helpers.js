// Shared setup for the browser tests. Every network call leaves the page mocked, so the tests
// never touch the real AI, job search, database or usage counts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SUPABASE_LIB = readFileSync(require.resolve("@supabase/supabase-js/dist/umd/supabase.js"));
export const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

export const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });

export const PROFILE = {
  fullName: "Sam Rivera", firstName: "Sam", headline: "A warehouse lead who trains people and cuts errors.",
  strengths: [{ name: "Team leadership", level: "verified", evidence: "Led a team of 9." }],
  hiddenTalent: [], directions: [{ role: "Operations supervisor", why: "You already lead a shift.", gap: "Show budget." }], unknowns: []
};
export const RESUME = "Sam Rivera\nWarehouse Lead, Example Co. 2019 - present\nLed a team of 9 and cut picking errors by 20%\nTrained new hires on safety procedures";

export function job(i, extra = {}) {
  return { id: "j" + i, title: "Shift Supervisor " + i, company: "Acme " + i, location: "Newark, NJ", description: "Lead a team on the warehouse floor. Train new staff.", url: "https://example.com/job/" + i, posted: new Date().toISOString(), salary: "$50,000", ...extra };
}

// Mocks the site's API and third-party requests, and collects page errors and error reports.
export async function mockSite(page, api = {}) {
  const seen = { errors: [], reports: [], events: [] };
  page.on("pageerror", e => seen.errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route(/supabase-js@/, r => r.fulfill({ status: 200, contentType: "text/javascript", body: SUPABASE_LIB }));
  await page.route("**/api/app?**", async route => {
    const url = new URL(route.request().url()), action = url.searchParams.get("action");
    if (action === "track") { try { seen.events.push(JSON.parse(route.request().postData()).e); } catch {} return route.fulfill({ status: 204 }); }
    if (action === "clienterror") { seen.reports.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 204 }); }
    if (api[action]) return api[action](route, url);
    if (action === "analyze") return json(route, 200, { profile: PROFILE });
    if (action === "jobs") return json(route, 200, { jobs: [job(1), job(2)], source: "adzuna", hasMore: false });
    if (action === "match") return json(route, 200, { fit: { fitScore: 82, summary: "A strong fit.", factors: [{ name: "Leadership", score: 90, note: "You lead a team of 9." }], strengths: [], gaps: [], unknowns: [], tips: [] } });
    return json(route, 404, { error: "Unknown request." });
  });
  return seen;
}

export async function buildDNA(page) {
  await page.fill("#paste", RESUME);
  await page.click("#analyzeBtn");
  await page.waitForSelector("#acctSaveBtn", { timeout: 15000 });
}

export const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
