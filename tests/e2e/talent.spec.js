import { test, expect } from "@playwright/test";
import { buildDNA, json, overflowX } from "./helpers.js";
import { USER, JWT, linkHash, setup } from "./supabase-mock.js";

test.use({ viewport: { width: 390, height: 844 } });

const TALENT = { headline: "Warehouse lead who trains teams and cuts errors", summary: "Leads a shift of 9.", experience: "About 6 years", education: "", strengths: [{ name: "Team leadership", evidence: "Led a team of 9" }], roles: ["Operations supervisor"], skills: ["Scheduling"] };

test("candidates: preview the anonymous profile, go visible, then accept a contact request", async ({ page }) => {
  const db = { row: null, talent: null };
  let drafted = null, answered = null;
  let requests = [{ id: "r1", company: "Acme Logistics", website: "acme.com", jobTitle: "Shift supervisor", message: "We'd love to talk.", status: "pending", createdAt: new Date().toISOString() }];
  const seen = await setup(page, db, {
    talentdraft: r => { drafted = { auth: r.request().headers().authorization, body: JSON.parse(r.request().postData()) }; return json(r, 200, { profile: TALENT }); },
    myrequests: r => json(r, 200, { requests }),
    respondrequest: r => { answered = JSON.parse(r.request().postData()); requests = [{ ...requests[0], status: "accepted", contactName: "Pat Lee", email: "hire@acme.com" }]; return json(r, 200, { status: "accepted" }); }
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await buildDNA(page);
  await page.click("#talentBtn");
  await page.fill("#siEmail", "sam@example.com");
  await page.click("#siBtn");
  await expect.poll(() => db.otp && db.otp.email).toBe("sam@example.com");

  // Back from the emailed link: the profile preview is shown before anything is shared.
  await page.goto("about:blank");
  await page.goto("/" + linkHash(), { waitUntil: "networkidle" });
  await expect(page.locator("#acctTalent .talent-card")).toContainText("Warehouse lead who trains teams");
  expect(drafted.auth).toBe("Bearer " + JWT);
  expect(drafted.body.profile.fullName).toBe("Sam Rivera");
  expect(db.talent, "nothing is visible before choosing to").toBeNull();
  await page.fill("#talentLoc", "Newark, NJ");
  await page.check("#talentRemote");
  await page.click("#talentSave");
  await expect(page.locator(".talent-status")).toContainText("Employers can find you");
  expect(db.talent).toMatchObject({ user_id: USER.id, visible: true, location: "Newark, NJ", remote_ok: true, profile: TALENT });
  expect(seen.events).toContain("talent_opt_in");

  // A request is waiting; accepting shares details.
  await expect(page.locator("#acctRequests")).toContainText("Acme Logistics · Shift supervisor");
  await page.click("[data-req][data-accept='1']");
  await expect(page.locator("#acctRequests")).toContainText("Accepted. Contact: Pat Lee, hire@acme.com");
  expect(answered).toEqual({ id: "r1", accept: true });

  // Hide and remove.
  await page.click("#talentToggle");
  await expect(page.locator(".talent-status")).toContainText("Your profile is hidden");
  expect(db.talent.visible).toBe(false);
  await page.click("#talentRemove");
  await expect(page.locator("#talentStart")).toBeVisible();
  expect(db.talent).toBeNull();
  expect(await overflowX(page)).toBeLessThanOrEqual(0);
  expect(seen.errors).toEqual([]);
  expect(seen.reports).toEqual([]);
});
