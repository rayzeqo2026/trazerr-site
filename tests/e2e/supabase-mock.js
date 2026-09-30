// A pretend Supabase, so the real sign-in library runs against known answers. Shared by the
// account and employer tests.
import { mockSite, json } from "./helpers.js";

export const SB = "https://mock.supabase.test";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
export const USER = { id: "11111111-2222-3333-4444-555555555555", email: "sam@example.com", aud: "authenticated", role: "authenticated" };
export const JWT = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: USER.id, email: USER.email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".sig";
export const linkHash = () => "#access_token=" + JWT + "&expires_in=3600&expires_at=" + (Math.floor(Date.now() / 1000) + 3600) + "&refresh_token=rt&token_type=bearer&type=magiclink";


// db holds the pretend tables: row (career record), alerts, talent (talent profile), otp.
export async function setup(page, db, api = {}) {
  const seen = await mockSite(page, {
    ...api,
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
    if (u.pathname === "/rest/v1/talent_profiles") {
      if (auth !== "Bearer " + JWT) return reply(401, { message: "not signed in" });
      if (m === "GET") return reply(200, db.talent ? [db.talent] : []);
      if (m === "POST") { const b = JSON.parse(route.request().postData()); db.talent = { public_id: "pub-1", ...(Array.isArray(b) ? b[0] : b) }; return reply(201); }
      if (m === "PATCH") { Object.assign(db.talent, JSON.parse(route.request().postData())); return reply(204); }
      if (m === "DELETE") { db.talent = null; return reply(204); }
    }
    if (u.pathname === "/rest/v1/job_alerts") {
      if (auth !== "Bearer " + JWT) return reply(401, { message: "not signed in" });
      db.alerts ||= [];
      if (m === "GET") return reply(200, db.alerts);
      if (m === "POST") {
        const row = JSON.parse(route.request().postData()); const one = Array.isArray(row) ? row[0] : row;
        if (db.alerts.some(a => a.query.toLowerCase() === one.query.toLowerCase() && a.location.toLowerCase() === one.location.toLowerCase())) return reply(409, { code: "23505", message: "duplicate" });
        if (db.alerts.length >= 3) return reply(403, { code: "42501", message: "new row violates row-level security policy" });
        db.alerts.push({ id: "al" + db.alerts.length, active: true, last_sent: null, ...one }); return reply(201);
      }
      if (m === "DELETE") { const id = u.searchParams.get("id").replace("eq.", ""); db.alerts = db.alerts.filter(a => a.id !== id); return reply(204); }
    }
    if (u.pathname === "/rest/v1/career_records") {
      if (auth !== "Bearer " + JWT) return reply(401, { message: "not signed in" });
      if (m === "GET") return reply(200, db.row ? [db.row] : []);
      if (m === "POST") { const body = JSON.parse(route.request().postData()); db.row = Array.isArray(body) ? body[0] : body; return reply(201, [db.row]); }
    }
    return reply(404, {});
  });
  return seen;
}
