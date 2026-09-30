import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockSite, buildDNA, json } from "./helpers.js";

// A pretend Supabase, so the real sign-in library runs against known answers.
const SB = "https://mock.supabase.test";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const USER = { id: "11111111-2222-3333-4444-555555555555", email: "sam@example.com", aud: "authenticated", role: "authenticated" };
const JWT = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: USER.id, email: USER.email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".sig";
const linkHash = () => "#access_token=" + JWT + "&expires_in=3600&expires_at=" + (Math.floor(Date.now() / 1000) + 3600) + "&refresh_token=rt&token_type=bearer&type=magiclink";

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page, db) {
  const seen = await mockSite(page, {
    authconfig: r => json(r, 200, { url: SB, anonKey: "anon-key" }),
    deleteaccount: r => { db.deleteAuthorized = r.request().headers().authorization === "Bearer " + JWT; db.row = null; return json(r, 200, { ok: true }); }
  });
  await page.route(SB + "/**", async route => {
    const u = new URL(route.request().url()), m = route.request().method(), auth = route.request().headers().authorization || "";
    const reply = (s, o) => route.fulfill({ status: s, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: o === undefined ? "" : JSON.stringify(o) });
    if (m === "OPTIONS") return reply(204);
    if (u.pathname === "/auth/v1/otp") { db.otp = JSON.parse(route.request().postData()); return reply(200, {}); }
    if (u.pathname === "/auth/v1/user") return auth === "Bearer " + JWT ? reply(200, USER) : reply(401, { msg: "bad" });
    if (u.pathname === "/auth/v1/logout") return reply(204);
    if (u.pathname === "/rest/v1/career_records") {
      if (auth !== "Bearer " + JWT) return reply(401, { message: "not signed in" });
      if (m === "GET") return reply(200, db.row ? [db.row] : []);
      if (m === "POST") { const body = JSON.parse(route.request().postData()); db.row = Array.isArray(body) ? body[0] : body; return reply(201, [db.row]); }
    }
    return reply(404, {});
  });
  return seen;
}

test("sign in by email link, save, download and delete everything", async ({ page }) => {
  const db = { row: null };
  const seen = await setup(page, db);
  await page.goto("/", { waitUntil: "networkidle" });
  expect(await page.evaluate(() => !!window.supabase), "sign-in code loads only when needed").toBe(false);

  // Save while signed out: asks for an email and remembers to save afterwards.
  await buildDNA(page);
  await page.click("#acctSaveBtn");
  await page.waitForSelector("#signinForm");
  expect(await page.evaluate(() => localStorage.getItem("trazerr.pendingAccountSave"))).toBeTruthy();
  await page.fill("#siEmail", "not-an-email");
  await page.click("#siBtn");
  await expect(page.locator("#siStatus")).not.toBeEmpty();
  await page.fill("#siEmail", "sam@example.com");
  await page.click("#siBtn");
  await expect.poll(() => db.otp && db.otp.email).toBe("sam@example.com");

  // Opening the emailed link signs in and finishes the save.
  await page.goto("about:blank");
  await page.goto("/" + linkHash(), { waitUntil: "networkidle" });
  await page.waitForSelector("#signOutBtn", { timeout: 10000 });
  expect(await page.evaluate(() => location.hash.includes("access_token")), "tokens are removed from the address").toBe(false);
  await expect.poll(() => db.row && db.row.user_id).toBe(USER.id);
  expect(db.row.career_dna.fullName).toBe("Sam Rivera");
  expect(db.row.resume && db.row.resume.text).toBeTruthy();

  // Still signed in after a reload; the record can be downloaded.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("#acctBtn")).toHaveAttribute("aria-label", /sam@example\.com|account/i);
  await page.click("#acctBtn");
  await page.waitForSelector("#acctOpen");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#acctDownload")]);
  const file = JSON.parse(readFileSync(await dl.path(), "utf8"));
  expect(file.careerDNA).toBeTruthy();
  expect(file.resume).toBeTruthy();

  // Delete everything: server record, this browser's copy and the session.
  await page.click("#delAsk");
  await page.click("#delYes");
  await expect.poll(() => db.row).toBeNull();
  expect(db.deleteAuthorized).toBe(true);
  await expect.poll(() => page.evaluate(() => [localStorage.getItem("trazerr.profile.v3"), localStorage.getItem("trazerr.resume.v1"), localStorage.getItem("trazerr.auth")])).toEqual([null, null, null]);
  expect(seen.errors).toEqual([]);
});

test("an expired sign-in link explains what to do", async ({ page }) => {
  await setup(page, { row: null });
  await page.goto("/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", { waitUntil: "networkidle" });
  await expect(page.locator(".saved-note")).toContainText(/expired|link/i);
});
