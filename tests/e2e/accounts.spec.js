import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildDNA, json } from "./helpers.js";
import { USER, JWT, linkHash, setup } from "./supabase-mock.js";

test.use({ viewport: { width: 390, height: 844 } });


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
  await page.waitForSelector(".acct-tabs", { timeout: 10000 });
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

  // Delete everything (Settings tab): server record, this browser's copy and the session.
  await page.click("#tab-settings");
  await page.click("#delAsk");
  await page.click("#delYes");
  await expect.poll(() => db.row).toBeNull();
  expect(db.deleteAuthorized).toBe(true);
  await expect.poll(() => page.evaluate(() => [localStorage.getItem("trazerr.profile.v3"), localStorage.getItem("trazerr.resume.v1"), localStorage.getItem("trazerr.auth")])).toEqual([null, null, null]);
  expect(seen.errors).toEqual([]);
  expect(seen.reports, "nothing blocked by the security rules").toEqual([]);
});

test("an expired sign-in link explains what to do", async ({ page }) => {
  await setup(page, { row: null });
  await page.goto("/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", { waitUntil: "networkidle" });
  await expect(page.locator(".saved-note")).toContainText(/expired|link/i);
});

test("job alerts: turn one on from a search while signed out, then manage it from the account", async ({ page }) => {
  const db = { row: null };
  const seen = await setup(page, db);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.fill("#jq", "supervisor");
  await page.fill("#jw", "Newark, NJ");
  await page.click("#jobsBtn");
  await expect(page.locator("#alertBox")).toBeVisible();
  await expect(page.locator("#alertTitle")).toHaveText("Get new \u201csupervisor\u201d jobs near Newark, NJ by email");
  await page.click("#alertBtn");
  await expect(page.locator("#oBody")).toContainText("your job alert for");
  await page.fill("#siEmail", "sam@example.com");
  await page.click("#siBtn");
  await expect.poll(() => db.otp && db.otp.email).toBe("sam@example.com");

  // Opening the emailed link turns the alert on.
  await page.goto("about:blank");
  await page.goto("/" + linkHash(), { waitUntil: "networkidle" });
  await expect(page.locator(".saved-note")).toContainText("You'll get new");
  expect(db.alerts).toMatchObject([{ user_id: USER.id, query: "supervisor", location: "Newark, NJ", remote: false }]);
  expect(seen.events).toContain("alert_created");
  await expect(page.locator("#acctAlerts li")).toHaveCount(1);
  await expect(page.locator("#acctAlerts li")).toContainText("Weekly");

  // Turning the same one on again says so; stopping it removes it.
  await page.keyboard.press("Escape");
  await page.fill("#jq", "Supervisor");
  await page.fill("#jw", "newark, nj");
  await page.click("#jobsBtn");
  await page.click("#alertBtn");
  await expect(page.locator("#alertStatus")).toHaveText("You already have this job alert.");
  await page.click("#acctBtn");
  await page.click("#tab-alerts");
  await page.locator("#acctAlerts [data-act=stop]").click();
  await expect(page.locator("#acctAlerts")).toContainText("No job alerts yet");
  expect(db.alerts).toEqual([]);
  expect(seen.errors).toEqual([]);
  expect(seen.reports).toEqual([]);
});
